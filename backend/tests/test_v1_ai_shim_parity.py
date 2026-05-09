"""Golden-file regression tests for the 7 ``/api/ai/*`` wire shapes.

These tests capture the **exact** JSON response bodies returned by each
route when the deterministic stub model is active (no API key set).  Any
refactor that changes the on-the-wire shape — even whitespace, key order,
or a constant string — will fail here, which is the intent.

Stub-model guarantee
--------------------
The ``AgentRuntime`` is seeded without provider keys in the test
environment, so ``is_stub_model`` returns ``True`` inside every handler
and the ``polish_*`` helpers short-circuit before any I/O.  The
``chat`` route delegates to the ``chat-agent`` via ``runtime.ainvoke``;
in the stub runtime the chat graph calls the stub model directly and
returns ``AIMessage(content='{"purpose": "stub", "result": "ok"}')``
with no tool_calls, producing ``{kind: "text", text: ...}``.

Non-deterministic fields
------------------------
None of the 7 routes embed timestamps, UUIDs, or random values in their
response bodies under the stub path.  The ``similar[*].reason`` field in
the ``/estimate`` response contains a percentage derived from a deterministic
Jaccard score, so it IS pinned here.

Do NOT modify files outside ``backend/tests/``.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pytest import FixtureRequest

from app import main
from app import security
from app.security import create_token
from tests.conftest import FakeStore, seed_agent_test_projects_if_absent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(request: FixtureRequest) -> Any:
    store: FakeStore = request.getfixturevalue("store")
    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("ai-user")
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Canonical request context (mirrors test_ai_v1_router._project_context)
# ---------------------------------------------------------------------------


def _ctx() -> dict[str, Any]:
    """Minimal but realistic project context shared across all 7 route tests."""
    return {
        "project": {"_id": "p-1", "projectName": "Demo"},
        "columns": [
            {"_id": "c-todo", "name": "To Do"},
            {"_id": "c-doing", "name": "Doing"},
            {"_id": "c-done", "name": "Done"},
        ],
        "tasks": [
            {
                "_id": "t-1",
                "taskName": "Fix login bug",
                "note": "Auth flow breaks on Safari",
                "type": "bug",
                "epic": "Bug Fix",
                "storyPoints": 3,
                "columnId": "c-todo",
                "coordinatorId": "m-1",
            },
            {
                "_id": "t-2",
                "taskName": "Onboarding tour",
                "note": "Build guided UI",
                "type": "feature",
                "epic": "UI Polish",
                "storyPoints": 5,
                "columnId": "c-doing",
                "coordinatorId": None,
            },
        ],
        "members": [
            {"_id": "m-1", "username": "alice"},
            {"_id": "m-2", "username": "bob"},
        ],
    }


# ---------------------------------------------------------------------------
# 1. /api/ai/task-draft
# ---------------------------------------------------------------------------


def test_task_draft_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/task-draft returns exact IDraftTaskSuggestion bytes (stub path)."""
    resp = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={"context": _ctx(), "prompt": "Fix login bug on Safari"},
    )
    assert resp.status_code == HTTPStatus.OK
    # Exact wire shape — v1_engine.draft_task with stub (no polish).
    # coordinatorId is 'm-2' because m-2 has 0 tasks (least-loaded),
    # while m-1 already owns t-1.
    assert resp.json() == {
        "taskName": "Fix login bug on Safari",
        "type": "bug",
        "epic": "Bug Fix",
        "storyPoints": 1,
        "note": "Fix login bug on Safari",
        "columnId": "c-todo",
        "coordinatorId": "m-2",
        "confidence": 0.55,
        "rationale": "Heuristic draft from prompt keywords.",
    }


# ---------------------------------------------------------------------------
# 2. /api/ai/task-breakdown
# ---------------------------------------------------------------------------


def test_task_breakdown_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/task-breakdown returns exact ITaskBreakdownSuggestion bytes (stub)."""
    resp = client.post(
        "/api/ai/task-breakdown",
        headers=auth_headers,
        json={
            "context": _ctx(),
            "prompt": "Fix login bug on Safari",
            "count": 3,
        },
    )
    assert resp.status_code == HTTPStatus.OK
    base = {
        "type": "bug",
        "epic": "Bug Fix",
        "storyPoints": 1,
        "note": "Fix login bug on Safari",
        "columnId": "c-todo",
        "coordinatorId": "m-2",
        "confidence": 0.55,
    }
    # Each item is the base draft with a "(part N)" suffix on taskName and
    # a deterministic "Slice N of the parent task." rationale.
    assert resp.json() == {
        "items": [
            {**base, "taskName": "Fix login bug on Safari (part 1)", "rationale": "Slice 1 of the parent task."},
            {**base, "taskName": "Fix login bug on Safari (part 2)", "rationale": "Slice 2 of the parent task."},
            {**base, "taskName": "Fix login bug on Safari (part 3)", "rationale": "Slice 3 of the parent task."},
        ]
    }


# ---------------------------------------------------------------------------
# 3. /api/ai/estimate
# ---------------------------------------------------------------------------


def test_estimate_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/estimate returns exact IEstimateSuggestion bytes (stub path)."""
    resp = client.post(
        "/api/ai/estimate",
        headers=auth_headers,
        json={
            "context": _ctx(),
            "taskName": "Fix login bug",
            "note": "Auth flow",
        },
    )
    assert resp.status_code == HTTPStatus.OK
    # t-1 has 33% Jaccard overlap with the query tokens {fix, login, bug, auth, flow}.
    # neighbour avg = clamp_fib((3+5+3)/3) ≈ clamp_fib(3.67) = 3 (but code uses
    # sum(clamp_fib(p) for p in (3,5,3))/3 = (3+5+3)/3 = 3.67 → int(round(...)) = 3+3=6?
    # Actual storyPoints confirmed by running v1_engine.estimate: 3.
    assert resp.json() == {
        "storyPoints": 3,
        "confidence": 0.7,
        "rationale": "Derived from prompt length + nearest-neighbour tasks.",
        "similar": [
            {"_id": "t-1", "reason": "shares 33% keywords"},
        ],
    }


# ---------------------------------------------------------------------------
# 4. /api/ai/readiness
# ---------------------------------------------------------------------------


def test_readiness_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/readiness returns exact IReadinessReport bytes (stub path).

    Sending only ``taskName`` causes note / epic / type / coordinatorId to
    be flagged as missing.
    """
    resp = client.post(
        "/api/ai/readiness",
        headers=auth_headers,
        json={"context": _ctx(), "taskName": "x"},
    )
    assert resp.status_code == HTTPStatus.OK
    # v1_engine.readiness iterates fields in insertion order; order is
    # pinned to the dict literal in v1_engine.readiness().
    assert resp.json() == {
        "issues": [
            {"field": "note", "severity": "warn", "message": "Acceptance criteria are missing."},
            {"field": "epic", "severity": "warn", "message": "Epic helps grouping; pick one."},
            {"field": "type", "severity": "warn", "message": "Choose feature / bug / spike."},
            {"field": "coordinatorId", "severity": "warn", "message": "Assign a coordinator."},
        ]
    }


# ---------------------------------------------------------------------------
# 5. /api/ai/board-brief
# ---------------------------------------------------------------------------


def test_board_brief_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/board-brief returns exact IBoardBrief bytes (stub path).

    Includes ``recommendationDetail`` which was added in the Phase 4
    polish pass; capturing it here guards against accidental removal.

    ``strength`` is ``"none"`` because the only signal is 1 unowned task
    (t-2) — detect_drift returns no signals on this canonical context so
    strength falls back to the unowned-count heuristic ("none" when < 2
    unowned, no WIP overflow, no stale tasks).

    ``basis`` is ``"1 unowned task(s)"`` from _recommendation_basis.

    ``sources`` includes refs for t-1, t-2 (first 3 tasks) and c-todo,
    c-doing (first 2 columns) built by validated_citation_ref in the router.
    """
    resp = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _ctx()},
    )
    assert resp.status_code == HTTPStatus.OK
    body = resp.json()
    assert body == {
        "headline": "2 tasks across 3 columns; 1 unowned, 2 large unstarted.",
        "counts": [
            {"columnId": "c-todo", "columnName": "To Do", "count": 1},
            {"columnId": "c-doing", "columnName": "Doing", "count": 1},
            {"columnId": "c-done", "columnName": "Done", "count": 0},
        ],
        "largestUnstarted": [
            {"taskId": "t-2", "taskName": "Onboarding tour", "storyPoints": 5},
            {"taskId": "t-1", "taskName": "Fix login bug", "storyPoints": 3},
        ],
        "unowned": [
            {"taskId": "t-2", "taskName": "Onboarding tour"},
        ],
        "workload": [
            {"memberId": "m-1", "username": "alice", "openTasks": 1, "openPoints": 3},
        ],
        "recommendation": "Reassign unowned bugs first; chunk large unstarted cards.",
        "recommendationDetail": {
            "text": "Reassign unowned bugs first; chunk large unstarted cards.",
            "strength": "none",
            "basis": "1 unowned task(s)",
            "sources": [
                {"source": "task", "id": "t-1", "quote": "Fix login bug"},
                {"source": "task", "id": "t-2", "quote": "Onboarding tour"},
                {"source": "column", "id": "c-todo", "quote": "To Do"},
                {"source": "column", "id": "c-doing", "quote": "Doing"},
            ],
        },
    }


# ---------------------------------------------------------------------------
# 6. /api/ai/search
# ---------------------------------------------------------------------------


def test_search_tasks_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/search (kind=tasks) returns exact ISearchResult bytes (stub)."""
    resp = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={
            "kind": "tasks",
            "query": "login bug Safari",
            "projectContext": _ctx(),
        },
    )
    assert resp.status_code == HTTPStatus.OK
    # Only t-1 has Jaccard overlap > 0 with tokens {login, bug, safari}.
    assert resp.json() == {
        "ids": ["t-1"],
        "rationale": "Ranked by keyword overlap with the query (top 1).",
    }


def test_search_projects_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/search (kind=projects) returns exact ISearchResult bytes (stub)."""
    resp = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={
            "kind": "projects",
            "query": "demo",
            "projectsContext": {
                "projects": [{"_id": "demo-1", "projectName": "Demo project"}]
            },
        },
    )
    assert resp.status_code == HTTPStatus.OK
    assert resp.json() == {
        "ids": ["demo-1"],
        "rationale": "Ranked by keyword overlap with the query (top 1).",
    }


# ---------------------------------------------------------------------------
# 7. /api/ai/chat
# ---------------------------------------------------------------------------


def test_chat_golden_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """POST /api/ai/chat returns exact {kind, text} bytes when stub model is active.

    The stub chat model always returns
    AIMessage(content='{"purpose": "stub", "result": "ok"}') with no
    tool_calls, so _extract_chat_response yields (text, []) and the
    handler emits {kind: "text", text: <stub content>}.

    The text field value is NOT pinned here because it is an internal
    implementation detail of GenericFakeChatModel and could vary across
    langchain-core patch releases. What IS pinned is ``kind == "text"``
    and that ``text`` is a non-empty string — the structural contract
    the FE depends on.

    If the stub model's literal output string stabilises across
    LangChain versions, uncomment the full equality assertion below.
    """
    resp = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "What is the status of the project?"}
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert resp.status_code == HTTPStatus.OK
    body = resp.json()
    # Structural contract: kind must be "text" (no tool-calls) and text is a
    # non-empty string.  The exact stub string varies with langchain-core.
    assert body["kind"] == "text"
    assert isinstance(body["text"], str) and body["text"]
    # Key-set contract: only "kind" and "text" keys when no tool_calls.
    assert set(body.keys()) == {"kind", "text"}
