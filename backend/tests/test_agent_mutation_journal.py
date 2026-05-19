"""Coverage tests for ``app.services.agent_mutation_journal``.

The module touches a real Mongo collection in production. Tests stub
``db_collection`` and ``task_service.update`` so each branch -- including
the duplicate-record idempotency, the malformed task_updates fallbacks,
the forbidden-update bailout, and the journal-entry test helper -- is
exercised deterministically without a database.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import pytest
from bson import ObjectId

from app.services import agent_mutation_journal


class FakeJournalCollection:
    def __init__(self) -> None:
        self.documents: List[Dict[str, Any]] = []
        self.updates: List[tuple[Dict[str, Any], Dict[str, Any]]] = []

    def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for doc in self.documents:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None

    def insert_one(self, payload: Dict[str, Any]) -> None:
        self.documents.append({**payload, "_id": ObjectId()})

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any]) -> None:
        self.updates.append((query, update))
        doc = self.find_one(query)
        if doc is not None:
            doc.update(update.get("$set", {}))


@pytest.fixture()
def fake_collection(monkeypatch: pytest.MonkeyPatch) -> FakeJournalCollection:
    coll = FakeJournalCollection()
    monkeypatch.setattr(
        agent_mutation_journal, "db_collection", lambda _name: coll
    )
    return coll


def test_normalize_undo_diff_handles_non_dict_and_filters_non_lists() -> None:
    assert agent_mutation_journal._normalize_undo_diff(None) == {}
    assert agent_mutation_journal._normalize_undo_diff("not-a-dict") == {}
    out = agent_mutation_journal._normalize_undo_diff(
        {
            "task_updates": [{"task_id": "t1"}],
            "column_updates": "not-a-list",
            "bulk_apply": [{"k": "v"}],
            "ignored_key": [1, 2, 3],
        }
    )
    assert out == {
        "task_updates": [{"task_id": "t1"}],
        "bulk_apply": [{"k": "v"}],
    }


def test_record_apply_journal_rejects_blank_ids(
    fake_collection: FakeJournalCollection,
) -> None:
    created, status_txt = agent_mutation_journal.record_apply_journal(
        user_id="u1",
        project_id="p1",
        proposal_id="   ",
        undo_diff={},
    )
    assert (created, status_txt) == (False, "missing_proposal_id")

    created, status_txt = agent_mutation_journal.record_apply_journal(
        user_id="u1",
        project_id="   ",
        proposal_id="pr1",
        undo_diff={},
    )
    assert (created, status_txt) == (False, "missing_project_id")
    assert fake_collection.documents == []


def test_record_apply_journal_persists_then_replays(
    fake_collection: FakeJournalCollection,
) -> None:
    created, status_txt = agent_mutation_journal.record_apply_journal(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
        undo_diff={"task_updates": [{"task_id": "t1", "field": "taskName"}]},
    )
    assert (created, status_txt) == (True, "recorded")
    assert len(fake_collection.documents) == 1
    persisted = fake_collection.documents[0]
    assert persisted["undo_diff"] == {
        "task_updates": [{"task_id": "t1", "field": "taskName"}]
    }
    assert persisted["undoneAt"] is None

    # Replay: same (user, proposal) is a no-op and returns already_recorded.
    created, status_txt = agent_mutation_journal.record_apply_journal(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
        undo_diff={"task_updates": [{"task_id": "t1", "field": "taskName"}]},
    )
    assert (created, status_txt) == (False, "already_recorded")
    assert len(fake_collection.documents) == 1


def test_undo_mutation_not_found(
    fake_collection: FakeJournalCollection,
) -> None:
    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="missing",
    )
    assert (ok, status_txt) == (False, "not_found")


def test_undo_mutation_already_undone_is_idempotent(
    fake_collection: FakeJournalCollection,
) -> None:
    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p1",
            "proposal_id": "pr1",
            "undo_diff": {},
            "undoneAt": "2026-01-01T00:00:00Z",
        }
    )
    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (True, "already_undone")
    # No additional update writes were issued.
    assert fake_collection.updates == []


def test_undo_mutation_project_mismatch(
    fake_collection: FakeJournalCollection,
) -> None:
    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p-other",
            "proposal_id": "pr1",
            "undo_diff": {},
            "undoneAt": None,
        }
    )
    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (False, "project_mismatch")


def test_undo_mutation_applies_task_updates_and_skips_malformed(
    monkeypatch: pytest.MonkeyPatch,
    fake_collection: FakeJournalCollection,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: List[Dict[str, Any]] = []

    def fake_update(body: Dict[str, Any], user_id: str) -> Optional[str]:
        calls.append({"body": body, "user_id": user_id})
        # Simulate a write miss on the second valid update so the
        # warning branch is exercised.
        if body["_id"] == "t-missing":
            return None
        return "Task updated"

    monkeypatch.setattr(
        agent_mutation_journal.task_service, "update", fake_update
    )

    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p1",
            "proposal_id": "pr1",
            "undo_diff": {
                "task_updates": [
                    "not-a-dict",
                    {"task_id": None, "field": "taskName", "from": "x"},
                    {"task_id": "t1", "field": "", "from": "x"},
                    {"task_id": "t1", "field": "taskName", "from": "old"},
                    {"task_id": "t-missing", "field": "note", "from": "n"},
                ],
            },
            "undoneAt": None,
        }
    )

    with caplog.at_level(logging.WARNING):
        ok, status_txt = agent_mutation_journal.undo_mutation(
            user_id="u1",
            project_id="p1",
            proposal_id="pr1",
        )

    assert (ok, status_txt) == (False, "partial_failure")
    # Only the two well-formed rows reach ``task_service.update``.
    assert [c["body"]["_id"] for c in calls] == ["t1", "t-missing"]
    # ``projectId`` is forwarded from the journal row.
    assert all(c["body"]["projectId"] == "p1" for c in calls)
    # Partial failure must leave the journal reversible (no ``undoneAt``).
    assert fake_collection.updates == []
    assert fake_collection.documents[0]["undoneAt"] is None
    assert any("Undo task update missed" in rec.message for rec in caplog.records)


def test_undo_mutation_partial_failure_leaves_journal_reversible(
    monkeypatch: pytest.MonkeyPatch,
    fake_collection: FakeJournalCollection,
) -> None:
    """When some valid undo rows miss, the journal must stay reversible."""

    def fake_update(body: Dict[str, Any], user_id: str) -> Optional[str]:
        if body["_id"] == "t-ok":
            return "Task updated"
        return None

    monkeypatch.setattr(
        agent_mutation_journal.task_service, "update", fake_update
    )

    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p1",
            "proposal_id": "pr1",
            "undo_diff": {
                "task_updates": [
                    {"task_id": "t-ok", "field": "taskName", "from": "a"},
                    {"task_id": "t-miss", "field": "taskName", "from": "b"},
                ],
            },
            "undoneAt": None,
        }
    )

    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (False, "partial_failure")
    assert fake_collection.updates == []
    assert fake_collection.documents[0]["undoneAt"] is None


def test_undo_mutation_marks_undone_when_all_valid_rows_succeed(
    monkeypatch: pytest.MonkeyPatch,
    fake_collection: FakeJournalCollection,
) -> None:
    monkeypatch.setattr(
        agent_mutation_journal.task_service,
        "update",
        lambda body, user_id: "Task updated",
    )

    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p1",
            "proposal_id": "pr1",
            "undo_diff": {
                "task_updates": [
                    {"task_id": "t1", "field": "taskName", "from": "old"},
                    {"task_id": "t2", "field": "note", "from": "n"},
                ],
            },
            "undoneAt": None,
        }
    )

    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (True, "undone")
    assert fake_collection.updates and "undoneAt" in (
        fake_collection.updates[-1][1]["$set"]
    )


def test_undo_mutation_returns_forbidden_when_update_blocked(
    monkeypatch: pytest.MonkeyPatch,
    fake_collection: FakeJournalCollection,
) -> None:
    monkeypatch.setattr(
        agent_mutation_journal.task_service,
        "update",
        lambda body, user_id: "Forbidden",
    )

    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "p1",
            "proposal_id": "pr1",
            "undo_diff": {
                "task_updates": [
                    {"task_id": "t1", "field": "taskName", "from": "x"},
                ]
            },
            "undoneAt": None,
        }
    )

    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="p1",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (False, "forbidden")
    # Journal row is NOT marked undone when the reversal was rejected.
    assert fake_collection.updates == []


def test_undo_mutation_ignores_non_list_task_updates(
    monkeypatch: pytest.MonkeyPatch,
    fake_collection: FakeJournalCollection,
) -> None:
    called = False

    def fake_update(*_args: Any, **_kwargs: Any) -> Optional[str]:
        nonlocal called
        called = True
        return "Task updated"

    monkeypatch.setattr(
        agent_mutation_journal.task_service, "update", fake_update
    )

    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "project_id": "",  # falsy project_id so ``projectId`` is not forwarded
            "proposal_id": "pr1",
            "undo_diff": {"task_updates": "not-a-list"},
            "undoneAt": None,
        }
    )

    ok, status_txt = agent_mutation_journal.undo_mutation(
        user_id="u1",
        project_id="",
        proposal_id="pr1",
    )
    assert (ok, status_txt) == (True, "undone")
    assert called is False


def test_journal_entry_for_tests_returns_document(
    fake_collection: FakeJournalCollection,
) -> None:
    fake_collection.documents.append(
        {
            "_id": ObjectId(),
            "user_id": "u1",
            "proposal_id": "pr1",
            "marker": "hello",
        }
    )
    found = agent_mutation_journal.journal_entry_for_tests("u1", "pr1")
    assert found is not None
    assert found["marker"] == "hello"
    assert agent_mutation_journal.journal_entry_for_tests("u1", "missing") is None
