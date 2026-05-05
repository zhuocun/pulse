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
PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        "[EMAIL]",
    ),
    (
        re.compile(
            r"\b(?:Bearer\s+|sk-|pk_|ghp_|gho_|token[:=])\S{10,}",
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
