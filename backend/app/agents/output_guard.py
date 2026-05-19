"""Pre-apply output classifier for chat-agent mutations.

Cheap, deterministic pattern guard that runs immediately before a
``applyApprovedMutation`` resolves.  Catches the three things the
chat-agent regression review flagged as still possible after the
identity + envelope hardening:

1. The model "narrates" extra actions that are NOT in the approved
   mutation payload (e.g. agent says "I'll also archive the column"
   when only a rename was approved).
2. Reasoning leans on bulk-delete language without the viewer having
   asked for it -- a classic "tool result told me to clean up" attack.
3. Reasoning references a project that is not the scoped project,
   suggesting cross-tenant data exfil or accidental side-effects.
4. The reasoning literally says "ignore approval / bypass policy" --
   prompt-injection attempt that survived the envelope.

Per the design doc the function is intentionally pattern-only -- no
model call -- so it adds <1ms to every apply and cannot itself be
manipulated.  When ``safe=False`` the chat-agent refuses the apply and
emits an error event.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Compiled patterns
# ---------------------------------------------------------------------------

# Action verbs we treat as "executing": present-tense or first-person.
# "Will/about to/going to/proceed to/then" stays on the verb side because we
# want to flag promises of future action, not narrative past tense.  The
# optional ``also``/``then``/``and`` slot in front of the verb catches
# secondary actions that share an earlier intent prefix, e.g.
# "I'll rename ... and then archive ...".
_ACTION_VERB_RE = re.compile(
    r"\b(?:i'll|i\s+will|i\s+am\s+going\s+to|i'm\s+going\s+to|going\s+to|"
    r"about\s+to|proceed\s+to|next\s+(?:i'll|i\s+will)|then\s+i'll|"
    r"also\s+(?:i'll|i\s+will|going\s+to|about\s+to))"
    r"(?:\s+(?:also|then|and|also\s+then|then\s+also))?\s+"
    r"(?:delete|remove|archive|reassign|rename|move|update|create|"
    r"change|edit|drop|clear|reset|merge|split|close|reopen|assign)\b",
    re.IGNORECASE,
)

# Bulk language: "all", "every", "everything", "each", "wipe", "purge",
# "delete all", "clear out", "nuke"... paired with an action verb.
_BULK_DELETE_RE = re.compile(
    r"\b(?:wipe|purge|nuke|clear\s+out|delete\s+all|remove\s+all|"
    r"delete\s+every|remove\s+every|drop\s+all|reset\s+everything)\b",
    re.IGNORECASE,
)

# Explicit viewer-authorised bulk keywords that suppress _BULK_DELETE_RE.
# Presence in the reasoning string means the user explicitly asked for it.
_BULK_AUTHORISED_RE = re.compile(
    r"\b(?:user\s+(?:asked|requested|said|wants)|per\s+(?:user|viewer)|"
    r"as\s+(?:requested|asked)|the\s+viewer\s+(?:asked|requested))\b",
    re.IGNORECASE,
)

# "ignore" / "override" / "bypass" near "approval" / "policy" / "guardrails".
_BYPASS_RE = re.compile(
    r"\b(?:ignore|override|bypass|skip|circumvent|disregard)\b"
    r"[^\n]{0,40}\b(?:approval|policy|guard(?:rail)?s?|safety|hitl|"
    r"human\s*in\s*the\s*loop|review)\b",
    re.IGNORECASE,
)

# Match a Mongo-style 24-hex object id (used for project_id throughout the
# project) or a short slug-like id.  Used to spot cross-project references.
_PROJECT_ID_LIKE_RE = re.compile(r"\b[a-fA-F0-9]{24}\b|\bproject[-_/:]\s*([a-zA-Z0-9-]{4,32})\b")


def _project_ids_from_text(text: str) -> set[str]:
    """Pull plausible project identifiers out of a free-text reasoning blob."""

    ids: set[str] = set()
    for match in _PROJECT_ID_LIKE_RE.finditer(text):
        full = match.group(0)
        ids.add(full)
        captured = match.group(1)
        if captured:
            ids.add(captured)
    return ids


def _diff_actions(mutation: dict[str, Any]) -> set[str]:
    """Best-effort set of action kinds present in the approved mutation."""

    diff = mutation.get("diff") if isinstance(mutation, dict) else None
    if not isinstance(diff, dict):
        return set()
    out: set[str] = set()
    if diff.get("task_updates"):
        out.add("update")
        out.add("rename")
        out.add("edit")
    if diff.get("column_updates"):
        out.add("update")
        out.add("rename")
    for bulk in diff.get("bulk_apply") or []:
        if isinstance(bulk, dict):
            op = bulk.get("operation")
            if isinstance(op, str):
                out.add(op.lower())
    return out


def classify_pre_mutation(
    reasoning: str,
    pending_mutation: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return ``{"safe": bool, "reasons": list[str]}`` for an apply attempt.

    * ``reasoning`` is the model's recent text (last AIMessage content or
      a concatenation thereof).  Empty / non-string input is treated as
      safe -- the absence of reasoning is not itself suspicious.
    * ``pending_mutation`` is the proposal payload that was previously
      approved.  ``None`` is unsafe: there is no approved mutation to
      apply against.

    The function is conservative on the *unsafe* side (false positives
    cause a refusal that the viewer can retry by rephrasing); it is not
    a perfect classifier.  Tests pin the canonical reason strings.
    """

    reasons: list[str] = []

    if not isinstance(pending_mutation, dict) or not pending_mutation:
        reasons.append("no_pending_mutation")
        # Without a proposal there is nothing to apply.  Return early so the
        # downstream pattern checks don't get to look at the reasoning -- a
        # missing payload is already disqualifying.
        return {"safe": False, "reasons": reasons}

    text = reasoning if isinstance(reasoning, str) else ""

    if _BYPASS_RE.search(text):
        reasons.append("bypass_approval_language")

    if _BULK_DELETE_RE.search(text) and not _BULK_AUTHORISED_RE.search(text):
        reasons.append("unauthorised_bulk_delete")

    # Extra-action narration: an action verb is promised in the reasoning
    # that doesn't map to anything in the approved diff.
    if text:
        diff_actions = _diff_actions(pending_mutation)
        for match in _ACTION_VERB_RE.finditer(text):
            phrase = match.group(0).lower()
            verb = re.search(
                r"\b(?:delete|remove|archive|reassign|rename|move|update|"
                r"create|change|edit|drop|clear|reset|merge|split|close|"
                r"reopen|assign)\b",
                phrase,
            )
            if not verb:
                continue
            verb_kind = verb.group(0).lower()
            # Direct overlap or class overlap (rename->update etc.)
            if verb_kind in diff_actions:
                continue
            if verb_kind in {"rename", "edit", "change"} and "update" in diff_actions:
                continue
            reasons.append("action_outside_approved_diff")
            break

    # Cross-project reference: text mentions a project_id that is not the
    # one carried on the approved mutation.  The check is best-effort
    # because reasoning rarely echoes a real id -- but when it does, a
    # mismatch is a strong signal of a cross-tenant leak attempt.
    approved_pid = ""
    diff = pending_mutation.get("diff") if isinstance(pending_mutation, dict) else None
    if isinstance(diff, dict):
        approved_pid = str(diff.get("project_id") or "")
    if not approved_pid:
        approved_pid = str(pending_mutation.get("project_id") or "")
    if approved_pid and text:
        ids_in_text = _project_ids_from_text(text)
        # Strip the approved id from the candidate set; anything left is a
        # foreign reference.
        ids_in_text.discard(approved_pid)
        ids_in_text.discard(f"project-{approved_pid}")
        if ids_in_text:
            reasons.append("cross_project_reference")

    return {"safe": not reasons, "reasons": reasons}


__all__ = ["classify_pre_mutation"]
