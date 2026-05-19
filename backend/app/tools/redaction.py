"""Server-side redaction for PRD v2.1 §5A.10 / §6.7.

The redactor walks structured payloads looking for PII / secret patterns
and replaces them with stable tokens (``[EMAIL]``, ``[SSN]`` ...). It is
used both before logging and before agent input is checkpointed so secrets
never make it to long-term storage.

The patterns are intentionally conservative: order matters because the
broader ``CARD`` pattern would otherwise eat matches the more specific
``SSN`` pattern catches.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Order matters: more-specific patterns must run before broader ones to avoid
# the broad CARD pattern stealing matches that the SSN pattern would catch.
# JWT must appear before the broad SECRET pattern so a full header.payload.sig
# token is claimed as [SECRET] by the JWT rule rather than only the prefix.
PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "[EMAIL]",
    ),
    (
        # JWT-shaped tokens (header.payload.signature, base64url encoded).
        re.compile(
            r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
        ),
        "[SECRET]",
    ),
    (
        re.compile(
            r"\b(?:Bearer\s+|sk-ant-|xoxb-|xoxp-|SG\.|ya29\."
            r"|sk-|pk_|ghp_|gho_|token[:=])\S{10,}",
            re.IGNORECASE,
        ),
        "[SECRET]",
    ),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(r"\b\d{13,19}\b"), "[CARD]"),
]


@dataclass(frozen=True)
class RedactionSpan:
    """One ``(start, end)`` span that was rewritten to ``pattern``."""

    pattern: str
    start: int
    end: int


def redact(text: str) -> tuple[str, list[RedactionSpan]]:
    """Apply redaction patterns; return ``(redacted, spans)``.

    Spans index into the *original* ``text`` (PRD §5A.10). To keep the
    indexes honest under cascading replacements we scan once with each
    pattern over the original string, mark the matched ranges as claimed
    (so the broader CARD pattern cannot steal a substring of an SSN
    match), then apply replacements left-to-right at the very end.
    """

    spans: list[RedactionSpan] = []
    claimed: list[tuple[int, int]] = []

    def _is_claimed(start: int, end: int) -> bool:
        for cstart, cend in claimed:
            if start < cend and end > cstart:
                return True
        return False

    rewrites: list[tuple[int, int, str]] = []
    for pattern, replacement in PATTERNS:
        for match in pattern.finditer(text):
            if _is_claimed(match.start(), match.end()):
                continue
            spans.append(RedactionSpan(replacement, match.start(), match.end()))
            claimed.append((match.start(), match.end()))
            rewrites.append((match.start(), match.end(), replacement))

    rewrites.sort(key=lambda triple: triple[0])
    if not rewrites:
        spans.sort(key=lambda s: (s.start, s.end))
        return text, spans

    pieces: list[str] = []
    cursor = 0
    for start, end, replacement in rewrites:
        pieces.append(text[cursor:start])
        pieces.append(replacement)
        cursor = end
    pieces.append(text[cursor:])
    spans.sort(key=lambda s: (s.start, s.end))
    return "".join(pieces), spans


_TASK_PII_FIELDS = ("taskName", "note", "epic", "coordinatorId")


def redact_task_fields(task: dict) -> dict:  # type: ignore[type-arg]
    """Return a copy of ``task`` with PII patterns stripped from task-card fields.

    Only the fields that are forwarded to the LLM polish call are redacted;
    the caller's original dict is never mutated.
    """
    out = dict(task)
    for field in _TASK_PII_FIELDS:
        value = out.get(field)
        if isinstance(value, str):
            out[field] = redact(value)[0]
    return out


def redact_dict(obj: object) -> object:
    """Recursively redact strings inside a JSON-serialisable structure."""

    if isinstance(obj, str):
        return redact(obj)[0]
    if isinstance(obj, dict):
        return {k: redact_dict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_dict(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(redact_dict(v) for v in obj)
    return obj


# ---------------------------------------------------------------------------
# Prompt-injection heuristics
# ---------------------------------------------------------------------------
# These detect common attack shapes embedded in tool returns / user text so
# the agent can fence the content as ``<untrusted_tool_result flags="...">``
# and observability hooks can alert on the rate.  Pattern names are stable
# strings used by tests + dashboards; reorder freely but do not rename without
# updating ``tests/test_redaction.py`` and the alert rules.

INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "ignore_previous_instructions",
        re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    ),
    (
        "disregard_prior",
        re.compile(r"disregard\s+(all\s+)?prior", re.IGNORECASE),
    ),
    (
        "you_are_now",
        re.compile(r"you\s+are\s+now\b", re.IGNORECASE),
    ),
    (
        "embedded_system_tag",
        # Matches a fake role marker anywhere except at column 0 of the input
        # (legitimate system prompts open the string, never appear mid-text).
        re.compile(r"(?<!^)\bsystem\s*:", re.IGNORECASE | re.MULTILINE),
    ),
    (
        "role_tag_injection",
        re.compile(
            r"<\/?(system|user|assistant|untrusted_tool_result)\b[^>]*>",
            re.IGNORECASE,
        ),
    ),
    (
        "act_as_privileged_role",
        # "act as" within ~30 chars of an elevated role keyword.
        re.compile(
            r"act\s+as\b[^\n]{0,30}\b(admin|root|developer|superuser)\b",
            re.IGNORECASE,
        ),
    ),
]


def flag_injection_attempts(text: str) -> list[str]:
    """Return the names of every injection pattern matched in ``text``.

    Pure read-only scan: the input is not modified. Caller chooses what to
    do (tag the envelope, drop the result, alert observability) based on
    the returned list. An empty list means no patterns fired.

    Names are emitted in match order, deduplicated, so a single flag does
    not appear twice even if the underlying regex finds multiple hits.
    """

    if not isinstance(text, str) or not text:
        return []

    seen: set[str] = set()
    out: list[str] = []
    for name, pattern in INJECTION_PATTERNS:
        if name in seen:
            continue
        if pattern.search(text):
            seen.add(name)
            out.append(name)
    return out
