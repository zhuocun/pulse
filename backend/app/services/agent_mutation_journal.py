"""Server-side journal for applied agent mutation proposals (GA §1).

Stores a reverse diff per ``(user_id, proposal_id)`` so the FE undo toast
can call :func:`undo_mutation` safely without trusting client-built undo
payloads as the only source of truth.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.database import AGENT_MUTATION_JOURNAL, collection as db_collection, now
from app.observability.metrics import record_agent_mutation_event
from app.services import task_service

logger = logging.getLogger(__name__)


def _normalize_undo_diff(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in ("task_updates", "column_updates", "bulk_apply"):
        val = raw.get(key)
        if isinstance(val, list):
            out[key] = val
    return out


def record_apply_journal(
    *,
    user_id: str,
    project_id: str,
    proposal_id: str,
    undo_diff: dict[str, Any],
) -> tuple[bool, str]:
    """Persist undo snapshot for a proposal. Idempotent: duplicate calls no-op.

    Returns ``(created, message)`` where ``created`` is False when the row
    already existed (replay / duplicate FE ack).
    """

    if not proposal_id.strip():
        return False, "missing_proposal_id"
    if not project_id.strip():
        return False, "missing_project_id"
    coll = db_collection(AGENT_MUTATION_JOURNAL)
    existing = coll.find_one({"user_id": user_id, "proposal_id": proposal_id})
    if existing:
        record_agent_mutation_event("journal_replay_skip")
        return False, "already_recorded"
    coll.insert_one(
        {
            "user_id": user_id,
            "project_id": project_id,
            "proposal_id": proposal_id,
            "undo_diff": _normalize_undo_diff(undo_diff),
            "createdAt": now(),
            "undoneAt": None,
        }
    )
    record_agent_mutation_event("accepted_recorded")
    return True, "recorded"


def undo_mutation(
    *,
    user_id: str,
    project_id: str,
    proposal_id: str,
) -> tuple[bool, str]:
    """Apply stored reverse diff once. Idempotent if already undone or missing."""

    coll = db_collection(AGENT_MUTATION_JOURNAL)
    doc = coll.find_one({"user_id": user_id, "proposal_id": proposal_id})
    if doc is None:
        return False, "not_found"
    if doc.get("undoneAt") is not None:
        record_agent_mutation_event("undo_replay_skip")
        return True, "already_undone"
    if str(doc.get("project_id") or "") != str(project_id):
        return False, "project_mismatch"

    undo_diff = doc.get("undo_diff") or {}
    task_updates = undo_diff.get("task_updates") or []
    if isinstance(task_updates, list):
        for row in task_updates:
            if not isinstance(row, dict):
                continue
            task_id = row.get("task_id")
            field = row.get("field")
            prior = row.get("from")
            if (
                not isinstance(task_id, str)
                or not isinstance(field, str)
                or not field
            ):
                continue
            body: dict[str, Any] = {"_id": task_id, field: prior}
            if doc.get("project_id"):
                body["projectId"] = doc["project_id"]
            result = task_service.update(body, user_id)
            if result is None:
                logger.warning(
                    "Undo task update missed task_id=%r field=%r user=%r",
                    task_id,
                    field,
                    user_id,
                )
            elif result == "Forbidden":
                return False, "forbidden"

    coll.update_one(
        {"_id": doc["_id"]},
        {"$set": {"undoneAt": now(), "updatedAt": now()}},
    )
    record_agent_mutation_event("undone")
    return True, "undone"


def journal_entry_for_tests(
    user_id: str,
    proposal_id: str,
) -> Optional[dict[str, Any]]:
    """Test helper: return raw journal doc or ``None``."""

    return db_collection(AGENT_MUTATION_JOURNAL).find_one(
        {"user_id": user_id, "proposal_id": proposal_id}
    )
