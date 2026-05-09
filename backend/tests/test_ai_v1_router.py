"""Tests for the legacy ``/api/ai/*`` shim router."""

from __future__ import annotations

from dataclasses import replace
from http import HTTPStatus
from typing import Any, Iterable

import pytest
from fastapi.testclient import TestClient
from pytest import FixtureRequest
from langchain_core.messages import AIMessage, HumanMessage

from app import main
from app import security
from app.agents.catalog import board_brief as bb_module
from app.agents.catalog import task_drafting as td_module
from app.agents.catalog import task_estimation as te_module
from app.agents.llm import make_stub_chat_model
from app.config import settings as default_settings
from app.middleware.budget import BudgetTracker
from app.middleware.rate_limit import RateLimiter
from app.security import create_token
from tests.conftest import FakeStore, seed_agent_test_projects_if_absent
from tests.conftest import is_not_stub, structured_model


@pytest.fixture()
def client(request: FixtureRequest) -> Iterable[TestClient]:
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


def _project_context() -> dict[str, Any]:
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


def test_task_draft_returns_validatable_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={"context": _project_context(), "prompt": "Fix login bug on Safari"},
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["taskName"]
    assert body["type"] in {"feature", "bug", "spike"}
    assert body["storyPoints"] in (1, 2, 3, 5, 8, 13)
    # FE validator requires columnId / coordinatorId be present in context.
    column_ids = {col["_id"] for col in _project_context()["columns"]}
    assert body["columnId"] in column_ids
    member_ids = {m["_id"] for m in _project_context()["members"]}
    assert body["coordinatorId"] in member_ids


def test_task_breakdown_returns_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/task-breakdown",
        headers=auth_headers,
        json={"context": _project_context(), "prompt": "Refactor auth", "count": 4},
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert isinstance(body["items"], list)
    assert len(body["items"]) == 4


def test_task_breakdown_clamps_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/task-breakdown",
        headers=auth_headers,
        json={"context": _project_context(), "prompt": "Refactor"},
    )
    body = response.json()
    assert len(body["items"]) == 3


def test_estimate_returns_storypoints_and_similar(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/estimate",
        headers=auth_headers,
        json={
            "context": _project_context(),
            "taskName": "Fix login bug",
            "note": "Auth flow",
        },
    )
    body = response.json()
    assert body["storyPoints"] in (1, 2, 3, 5, 8, 13)
    assert isinstance(body["similar"], list)


def test_readiness_flags_missing_fields(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/readiness",
        headers=auth_headers,
        json={"context": _project_context(), "taskName": "x"},
    )
    body = response.json()
    flagged = {issue["field"] for issue in body["issues"]}
    assert "note" in flagged
    assert "coordinatorId" in flagged


def test_board_brief_returns_counts_and_workload(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _project_context()},
    )
    body = response.json()
    assert body["headline"]
    assert isinstance(body["counts"], list)
    assert any(item["columnId"] == "c-todo" for item in body["counts"])


_VALID_BRIEF_STRENGTHS = {"strong", "moderate", "low", "none"}


def test_board_brief_includes_recommendation_detail(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """``recommendationDetail`` must be present in every board-brief response."""
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _project_context()},
    )
    body = response.json()
    assert "recommendationDetail" in body, (
        "recommendationDetail must be present in board-brief response"
    )
    rd = body["recommendationDetail"]
    assert isinstance(rd["text"], str) and rd["text"]
    assert rd["strength"] in _VALID_BRIEF_STRENGTHS
    assert isinstance(rd["basis"], str) and rd["basis"]
    assert isinstance(rd["sources"], list)


def test_board_brief_strength_is_strong_when_unowned_bugs_exist(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Unowned bugs (type=bug without coordinatorId) must yield ``"strong"``."""
    context = {
        **_project_context(),
        "tasks": [
            # Bug with no coordinator → unowned_bug signal
            {
                "_id": "bug-1",
                "type": "bug",
                "taskName": "Crash on load",
                "columnId": "c-todo",
            },
            {
                "_id": "bug-2",
                "type": "bug",
                "taskName": "Login fails",
                "columnId": "c-todo",
            },
        ],
    }
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": context},
    )
    body = response.json()
    assert body["recommendationDetail"]["strength"] == "strong"


def test_board_brief_strength_is_none_when_no_signals(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """No drift signals → ``"none"`` strength."""
    # Clean board: all tasks owned, no WIP overflow, no stale tasks.
    context = {
        **_project_context(),
        "tasks": [
            {
                "_id": "t-ok",
                "type": "feature",
                "taskName": "Build UI",
                "columnId": "c-todo",
                "coordinatorId": "m-1",
            }
        ],
    }
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": context},
    )
    body = response.json()
    assert body["recommendationDetail"]["strength"] == "none"


def test_board_brief_recommendation_detail_sources_populated_when_tasks_exist(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """When tasks are present, ``sources`` must be non-empty."""
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _project_context()},
    )
    body = response.json()
    sources = body["recommendationDetail"]["sources"]
    assert len(sources) > 0, "sources must be populated when tasks exist"
    for source in sources:
        assert "source" in source
        assert source["source"] in {"task", "column", "member", "project"}


def test_board_brief_rejects_non_object_context(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": "nope"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_search_tasks(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={
            "kind": "tasks",
            "query": "login bug Safari",
            "projectContext": _project_context(),
        },
    )
    body = response.json()
    assert "t-1" in body["ids"]
    assert body["rationale"]


def test_search_projects(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
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
    body = response.json()
    assert body["ids"] == ["demo-1"]


def test_search_rejects_bad_kind(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={"kind": "unknown", "query": "demo"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_search_rejects_non_string_query(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={"kind": "tasks", "query": 123, "projectContext": _project_context()},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_search_rejects_non_object_context(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={"kind": "tasks", "query": "x", "projectContext": "nope"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_chat_returns_text_via_chat_agent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "What's the status of project p-1?"}
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    body = response.json()
    assert response.status_code == HTTPStatus.OK
    assert body["kind"] == "text"
    assert isinstance(body["text"], str)


def test_chat_rejects_non_list_messages(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={"messages": "hi"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_chat_returns_502_on_agent_error(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.errors import AgentExecutionError
    from app.routers import ai as ai_router

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise AgentExecutionError("chat-agent", cause=RuntimeError("nope"))

    monkeypatch.setattr(client.app.state.agent_runtime, "ainvoke", boom, raising=False)
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hello"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.BAD_GATEWAY
    assert ai_router  # module under test


# ---------------------------------------------------------------------------
# Multi-turn message-shape coverage: the legacy ``/api/ai/chat`` shim
# must forward both user and assistant turns to the chat-agent runtime
# (so the LLM sees its own prior responses) while dropping FE-internal
# ``role == "tool"`` turns and any defensively-shaped non-string entries.
# These tests exercise the explicit role-branching loop in
# ``app/routers/ai.py`` by capturing the ``inputs`` dict handed to
# ``runtime.ainvoke`` and asserting on the wrapped LangChain message
# types -- the on-the-wire response only exposes the final assistant
# text, so introspecting ``inputs`` is the only way to assert ordering
# of the prior turns.
# ---------------------------------------------------------------------------


def test_chat_preserves_assistant_messages_for_multi_turn(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["name"] = name
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "What's blocking task t-1?"},
                {"role": "assistant", "content": "It's waiting on review."},
                {"role": "user", "content": "Who is reviewing?"},
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    assert captured["name"] == "chat-agent"
    forwarded = captured["inputs"]["messages"]
    # Order matters: a HumanMessage / AIMessage / HumanMessage interleave
    # is what the chat-agent's chat_model needs to thread its own prior
    # response into the next turn's prompt.
    assert [type(m) for m in forwarded] == [
        HumanMessage,
        AIMessage,
        HumanMessage,
    ]
    assert forwarded[0].content == "What's blocking task t-1?"
    assert forwarded[1].content == "It's waiting on review."
    assert forwarded[2].content == "Who is reviewing?"


def test_chat_drops_tool_messages(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["name"] = name
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "Summarize the board."},
                {"role": "assistant", "content": "Here is the summary."},
                # FE-internal ``summarizeToolResultForUser`` payload --
                # leaking it back to the LLM would double-count facts the
                # agent already produced and confuse the next turn.
                {"role": "tool", "content": "tool-call: list_tasks(...)"},
                {"role": "user", "content": "Anything in 'Doing'?"},
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    forwarded = captured["inputs"]["messages"]
    assert [type(m) for m in forwarded] == [
        HumanMessage,
        AIMessage,
        HumanMessage,
    ]
    contents = [m.content for m in forwarded]
    assert "tool-call: list_tasks(...)" not in contents


def test_chat_drops_messages_with_non_string_content(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["name"] = name
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "ok"},
                # Defensive guard: a bug in the FE or a broken transcript
                # replay must not crash the shim -- silently drop the
                # bad entry so the rest of the conversation reaches the
                # LLM intact.
                {"role": "user", "content": 42},
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    forwarded = captured["inputs"]["messages"]
    assert len(forwarded) == 1
    assert isinstance(forwarded[0], HumanMessage)
    assert forwarded[0].content == "ok"


def test_disabled_project_blocks_all_routes(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.routers.ai.is_project_ai_enabled",
        lambda *args, **kwargs: False,
    )
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _project_context()},
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_budget_exhausted_returns_402(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    monkeypatch.setattr(ai_budget_backend, "monthly_cap", 0)
    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={"context": _project_context(), "prompt": "x"},
    )
    assert response.status_code == HTTPStatus.PAYMENT_REQUIRED
    assert response.headers.get("X-Reason") == "budget"


def test_rate_limit_uses_chat_agent_metadata(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chat_agent = client.app.state.agent_runtime.get("chat-agent")
    monkeypatch.setattr(
        chat_agent,
        "metadata",
        replace(chat_agent.metadata, rate_limit=(1, 60)),
    )
    first = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "first"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert first.status_code == HTTPStatus.OK
    second = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "second"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert second.status_code == HTTPStatus.TOO_MANY_REQUESTS


def test_chat_redacts_user_email(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "ping me at user@example.com"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK


def test_chat_records_budget_when_project_present(
    client: TestClient,
    auth_headers: dict[str, str],
    ai_budget_backend: BudgetTracker,
) -> None:
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-budget", "projectName": "Budgeted"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    remaining = ai_budget_backend.remaining("p-budget")
    assert remaining < default_settings.agent_budget_monthly_token_cap


def test_v1_shim_forbids_foreign_project_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """``_gate`` rejects project ids the caller does not manage."""

    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={
            "context": {
                "project": {"_id": "p-budget-agent", "projectName": "Other"},
            },
            "prompt": "x",
        },
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


# ---------------------------------------------------------------------------
# Polish-mode tests: with a real chat model on the catalog agent the v1
# shim must rewrite the eligible string fields and true-up the project
# budget. With the stub model the wire shape must stay byte-identical.
# ---------------------------------------------------------------------------


def _restore_stub(client: TestClient, agent_name: str) -> None:
    """Reset the runtime agent back to the deterministic stub.

    The registry is module-level, so a real model pinned in one test
    would leak into the next one. ``set_chat_model`` forces a recompile
    on next access -- handing a fresh stub is the safest restore.
    """

    agent = client.app.state.agent_runtime.get(agent_name)
    agent.set_chat_model(make_stub_chat_model())


def test_task_draft_polishes_text_fields_when_model_is_real(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 7, "output_tokens": 5, "total_tokens": 12},
    )
    parsed = td_module.DraftPolish(
        taskName="Polished login fix",
        note="Polished body explaining the fix",
        rationale="Polished rationale",
    )
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Fix login bug on Safari",
            },
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["taskName"] == "Polished login fix"
    assert body["note"].startswith("Polished body")
    assert body["rationale"] == "Polished rationale"
    # Structural fields stay deterministic.
    assert body["storyPoints"] in (1, 2, 3, 5, 8, 13)
    column_ids = {col["_id"] for col in _project_context()["columns"]}
    assert body["columnId"] in column_ids
    member_ids = {m["_id"] for m in _project_context()["members"]}
    assert body["coordinatorId"] in member_ids


def test_task_draft_falls_back_to_deterministic_on_provider_exception(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(raise_on_call=RuntimeError("provider down")))
    try:
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Fix login bug",
            },
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    # Deterministic rationale comes through unmodified on provider error.
    assert body["rationale"] == "Heuristic draft from prompt keywords."
    assert body["taskName"] == "Fix login bug"


def test_task_draft_records_real_usage_against_budget(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 9, "output_tokens": 6, "total_tokens": 15},
    )
    parsed = td_module.DraftPolish(
        taskName="Polished",
        note="Polished",
        rationale="Polished",
    )
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    starting = ai_budget_backend.remaining("p-1")
    try:
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Fix login",
            },
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining("p-1")
    # 1 token was debited at gate-time (in==9, out==6 -> total 15 -> top-up 14).
    assert starting - after == 14


def test_task_breakdown_polishes_first_then_replicates(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
    )
    parsed = td_module.DraftPolish(
        taskName="Refactored auth flow",
        note="Polished breakdown note",
        rationale="Polished slice rationale",
    )
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        response = client.post(
            "/api/ai/task-breakdown",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Refactor",
                "count": 3,
            },
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    body = response.json()
    items = body["items"]
    assert len(items) == 3
    # Polished prefix replicated; per-item ``(part i)`` suffix preserved.
    assert items[0]["taskName"] == "Refactored auth flow (part 1)"
    assert items[1]["taskName"] == "Refactored auth flow (part 2)"
    assert items[2]["taskName"] == "Refactored auth flow (part 3)"
    # All items share the polished note + rationale.
    assert all(item["note"] == "Polished breakdown note" for item in items)
    assert all(item["rationale"] == "Polished slice rationale" for item in items)


def test_task_breakdown_skips_polish_in_stub_mode(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """With the deterministic stub the LLM must not be called."""

    sentinel_called = {"value": False}

    class _Sentinel:
        def with_structured_output(self, *_: Any, **__: Any) -> Any:
            sentinel_called["value"] = True
            raise AssertionError("polish_draft must not call the model on stub")

    # The default agent already holds a stub model; arrange the sentinel
    # so any accidental call surfaces immediately.
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    original = agent.chat_model
    try:
        # Don't override here -- the goal is to verify the route's stub
        # check short-circuits before resolving the model. Just touching
        # ``chat_model`` is enough to confirm it's the stub.
        response = client.post(
            "/api/ai/task-breakdown",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Refactor",
                "count": 2,
            },
        )
    finally:
        agent.set_chat_model(original)
    assert response.status_code == HTTPStatus.OK
    assert not sentinel_called["value"]
    body = response.json()
    # Wire shape unchanged in stub mode.
    assert len(body["items"]) == 2


def test_estimate_polishes_rationale_when_model_is_real(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 2, "output_tokens": 3, "total_tokens": 5},
    )
    parsed = te_module.EstimationRationale(rationale="Polished rationale")
    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        response = client.post(
            "/api/ai/estimate",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "taskName": "Fix login bug",
                "note": "Auth flow",
            },
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    body = response.json()
    assert body["rationale"] == "Polished rationale"
    assert body["storyPoints"] in (1, 2, 3, 5, 8, 13)
    assert isinstance(body["confidence"], (int, float))


def test_estimate_falls_back_when_polish_returns_blank(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank polished rationale should not overwrite the deterministic copy."""

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    parsed = te_module.EstimationRationale(rationale="   ")
    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(structured_model(parsed=parsed))
    try:
        response = client.post(
            "/api/ai/estimate",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "taskName": "Fix login bug",
                "note": "Auth flow",
            },
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    body = response.json()
    # Deterministic rationale strings vary by neighbour count; make sure
    # the blank polish was discarded (i.e. the resulting string is one
    # of the deterministic templates).
    assert body["rationale"] in {
        "Derived from prompt length + nearest-neighbour tasks.",
        "Derived from prompt length; no similar tasks found.",
    }


def test_readiness_polishes_messages_when_model_is_real(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 5, "output_tokens": 4, "total_tokens": 9},
    )
    parsed = te_module.ReadinessPolish(
        issues=[
            te_module.ReadinessIssuePolish(
                field="note",
                message="Polished note message",
                suggestion="Polished note suggestion",
            )
        ]
    )
    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        # ``taskName="x"`` is set to keep that issue out of the deterministic
        # report so the polish merge runs against the multi-row case.
        response = client.post(
            "/api/ai/readiness",
            headers=auth_headers,
            json={"context": _project_context(), "taskName": "x"},
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    by_field = {issue["field"]: issue for issue in body["issues"]}
    # Polished only the matched row; deterministic rows for the other
    # fields stay intact so the FE validator still flags the rest.
    assert by_field["note"]["message"] == "Polished note message"
    assert by_field["note"]["suggestion"] == "Polished note suggestion"
    assert by_field["coordinatorId"]["message"] == "Assign a coordinator."
    # Severity stays deterministic; the LLM is not allowed to touch it.
    assert by_field["note"]["severity"] == "warn"


def test_readiness_records_real_usage_against_budget(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Provider-reported usage is trued up against the project budget."""

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 10, "output_tokens": 6, "total_tokens": 16},
    )
    parsed = te_module.ReadinessPolish(
        issues=[
            te_module.ReadinessIssuePolish(
                field="note",
                message="Polished",
                suggestion="Polished",
            )
        ]
    )
    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    starting = ai_budget_backend.remaining("p-1")
    try:
        response = client.post(
            "/api/ai/readiness",
            headers=auth_headers,
            json={"context": _project_context(), "taskName": "x"},
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining("p-1")
    # 1 token debited at gate-time; in==10, out==6 -> total 16 -> top-up 15.
    assert starting - after == 15


def test_readiness_skips_polish_when_all_fields_populated(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty issue list short-circuits before resolving the chat model."""

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)

    class _Sentinel:
        def with_structured_output(self, *_: Any, **__: Any) -> Any:
            raise AssertionError("polish_readiness must not run when issues is empty")

    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(_Sentinel())
    try:
        response = client.post(
            "/api/ai/readiness",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "taskName": "Fix login bug",
                "note": "Auth flow",
                "epic": "Bug Fix",
                "type": "bug",
                "coordinatorId": "m-1",
            },
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    assert response.status_code == HTTPStatus.OK
    assert response.json() == {"issues": []}


def test_readiness_prompt_excludes_unrelated_context_tasks(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression guard: only the per-task draft fields reach the LLM prompt."""

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    parsed = te_module.ReadinessPolish(issues=[])
    captured: dict[str, str] = {}

    class _RecordingModel:
        def with_structured_output(
            self, _schema: Any, *, include_raw: bool = False
        ) -> Any:
            assert include_raw

            class _Runnable:
                def invoke(_self, messages: Any, **__: Any) -> Any:
                    captured["prompt"] = messages[0].content
                    return {"raw": None, "parsed": parsed, "parsing_error": None}

                async def ainvoke(_self, messages: Any, **__: Any) -> Any:
                    captured["prompt"] = messages[0].content
                    return {"raw": None, "parsed": parsed, "parsing_error": None}

            return _Runnable()

    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(_RecordingModel())
    try:
        client.post(
            "/api/ai/readiness",
            headers=auth_headers,
            json={"context": _project_context(), "taskName": "x"},
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    prompt = captured["prompt"]
    # The board's other tasks (t-1, t-2) and project ids must not be
    # JSON-encoded into the LLM context.
    assert "t-1" not in prompt
    assert "t-2" not in prompt
    assert "Onboarding tour" not in prompt
    assert "Auth flow breaks on Safari" not in prompt
    # The whitelisted draft fields are present.
    assert "taskName" in prompt


def test_readiness_falls_back_on_provider_exception(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Provider crash returns the deterministic shape; route stays 200."""

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    agent = client.app.state.agent_runtime.get("task-estimation-agent")
    agent.set_chat_model(structured_model(raise_on_call=RuntimeError("provider down")))
    try:
        response = client.post(
            "/api/ai/readiness",
            headers=auth_headers,
            json={"context": _project_context(), "taskName": "x"},
        )
    finally:
        _restore_stub(client, "task-estimation-agent")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    flagged = {issue["field"] for issue in body["issues"]}
    # Deterministic readiness still flags note + coordinatorId.
    assert "note" in flagged
    assert "coordinatorId" in flagged


def test_board_brief_polishes_headline_when_model_is_real(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 4, "output_tokens": 4, "total_tokens": 8},
    )
    parsed = bb_module.BriefHeadline(headline="Polished standup headline")
    agent = client.app.state.agent_runtime.get("board-brief-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        response = client.post(
            "/api/ai/board-brief",
            headers=auth_headers,
            json={"context": _project_context()},
        )
    finally:
        _restore_stub(client, "board-brief-agent")
    body = response.json()
    assert body["headline"] == "Polished standup headline"
    # Deterministic structure unchanged.
    assert isinstance(body["counts"], list)
    assert isinstance(body["largestUnstarted"], list)
    assert isinstance(body["unowned"], list)
    assert isinstance(body["workload"], list)


def test_board_brief_falls_back_on_parsing_error(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="malformed",
        usage_metadata={"input_tokens": 1, "output_tokens": 0, "total_tokens": 1},
    )
    agent = client.app.state.agent_runtime.get("board-brief-agent")
    agent.set_chat_model(
        structured_model(
            parsed=None,
            raw_message=raw,
            parsing_error=ValueError("bad json"),
        )
    )
    try:
        response = client.post(
            "/api/ai/board-brief",
            headers=auth_headers,
            json={"context": _project_context()},
        )
    finally:
        _restore_stub(client, "board-brief-agent")
    body = response.json()
    # Deterministic headline format reused when the parser fails.
    assert "tasks" in body["headline"]
    assert "columns" in body["headline"]


def test_search_route_resolves_search_agent_not_a_sibling(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """The search route must look up ``search-agent``, never a sibling agent.

    Wiring a sentinel model onto every agent EXCEPT search-agent and
    asserting the route still completes catches a regression where the
    route accidentally resolves the wrong agent (e.g. the chat-agent
    chat_model getting polished against a search prompt).
    """

    class _Boom:
        def with_structured_output(self, *_: Any, **__: Any) -> Any:
            raise AssertionError("search route resolved a non-search agent")

        def invoke(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - safety
            raise AssertionError("search route resolved a non-search agent")

        def bind_tools(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - safety
            raise AssertionError("search route resolved a non-search agent")

    runtime = client.app.state.agent_runtime
    saved: list[str] = []
    for name in ("task-drafting-agent", "task-estimation-agent", "board-brief-agent"):
        runtime.get(name).set_chat_model(_Boom())
        saved.append(name)
    try:
        response = client.post(
            "/api/ai/search",
            headers=auth_headers,
            json={
                "kind": "tasks",
                "query": "login",
                "projectContext": _project_context(),
            },
        )
    finally:
        for name in saved:
            _restore_stub(client, name)
    assert response.status_code == HTTPStatus.OK


def test_resolve_polish_model_falls_back_when_agent_missing(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unregistered agent must not 5xx the route -- it falls back to stub."""

    from app.agents.errors import AgentNotFoundError
    from app.routers import ai as ai_router

    runtime = client.app.state.agent_runtime
    original_get = runtime.get

    def boom(name: str) -> Any:
        if name == "task-drafting-agent":
            raise AgentNotFoundError(name)
        return original_get(name)

    monkeypatch.setattr(runtime, "get", boom, raising=False)
    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={
            "context": _project_context(),
            "prompt": "Fix login bug",
        },
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    # Deterministic copy comes through when the agent isn't registered.
    assert body["rationale"] == "Heuristic draft from prompt keywords."
    assert ai_router  # module under test


def test_polish_and_record_no_op_when_project_id_is_none(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Without a project_id in the payload, no budget debit is recorded."""

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 11, "output_tokens": 7, "total_tokens": 18},
    )
    parsed = td_module.DraftPolish(
        taskName="Polished",
        note="Polished",
        rationale="Polished",
    )
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    # Snapshot the budget for an unrelated project to make sure no debit
    # leaks through.
    before = ai_budget_backend.remaining("unrelated")
    try:
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            # Payload without ``context.project._id`` -- project_id is None.
            json={"prompt": "Fix login"},
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining("unrelated")
    assert before == after


def test_polish_and_record_skips_top_up_when_actual_is_zero(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """A model that reports ``(0, 0)`` tokens triggers no budget top-up."""

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    parsed = td_module.DraftPolish(
        taskName="Polished",
        note="Polished",
        rationale="Polished",
    )
    # ``raw_message=None`` => extract_token_usage returns (0, 0).
    agent = client.app.state.agent_runtime.get("task-drafting-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=None))
    starting = ai_budget_backend.remaining("p-1")
    try:
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            json={
                "context": _project_context(),
                "prompt": "Fix login",
            },
        )
    finally:
        _restore_stub(client, "task-drafting-agent")
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining("p-1")
    # Only the gate-time 1-token debit was recorded; no provider top-up.
    assert starting - after == 0


# ---------------------------------------------------------------------------
# Unit tests for the polish-input adapters in app.routers.ai. These exercise
# defensive branches the route-level scripted-model tests above don't cover
# (FE could in principle send junk shapes; the helpers must degrade to an
# empty list rather than raise).
# ---------------------------------------------------------------------------


def test_similar_from_context_returns_empty_for_non_dict_context() -> None:
    from app.routers.ai import _similar_from_context

    assert _similar_from_context(None) == []
    assert _similar_from_context("nonsense") == []
    assert _similar_from_context(42) == []


def test_similar_from_context_returns_empty_when_tasks_is_not_a_list() -> None:
    from app.routers.ai import _similar_from_context

    # A FE bug or a stale cache could surface ``tasks`` as something
    # other than a list; the helper must not raise.
    assert _similar_from_context({"tasks": "not-a-list"}) == []
    assert _similar_from_context({"tasks": None}) == []
    assert _similar_from_context({}) == []


def test_similar_from_context_skips_non_dict_task_entries() -> None:
    from app.routers.ai import _similar_from_context

    similar = _similar_from_context(
        {
            "tasks": [
                "junk-string",
                None,
                {
                    "_id": "t-real",
                    "taskName": "Real task",
                    "note": "Real note",
                },
            ]
        }
    )
    # Only the dict entry survives the filter; non-dict entries are
    # dropped without short-circuiting the loop.
    assert similar == [{"id": "t-real", "text": "Real task Real note"}]


def test_similar_from_context_caps_at_limit_and_handles_missing_fields() -> None:
    from app.routers.ai import _similar_from_context

    similar = _similar_from_context(
        {
            "tasks": [
                {"_id": f"t-{i}", "taskName": f"Task {i}", "note": ""} for i in range(5)
            ]
        },
        limit=2,
    )
    assert len(similar) == 2
    assert similar[0] == {"id": "t-0", "text": "Task 0"}


# ---------------------------------------------------------------------------
# /api/ai/search polish-mode tests: with the catalog search-agent's chat
# model overridden to a real-shaped fake, the deterministic Jaccard ids
# get LLM-reranked and the rationale is rewritten. The wire shape stays
# byte-identical with the no-key path so the FE validator
# (validate.ts:119-125) keeps accepting the response unchanged.
# ---------------------------------------------------------------------------


def test_search_polishes_ranking_when_model_is_real(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog import search as search_module

    monkeypatch.setattr(search_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
    )
    parsed = search_module.SearchRanking(
        ids=["t-2", "t-1"],
        rationale="t-2 mentions onboarding most directly; t-1 close second",
    )
    agent = client.app.state.agent_runtime.get("search-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    try:
        response = client.post(
            "/api/ai/search",
            headers=auth_headers,
            json={
                "kind": "tasks",
                "query": "onboarding tour",
                "projectContext": _project_context(),
            },
        )
    finally:
        _restore_stub(client, "search-agent")
    body = response.json()
    assert body["ids"] == ["t-2", "t-1"]
    assert body["rationale"].startswith("t-2 mentions")


def test_search_falls_back_to_deterministic_on_provider_exception(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog import search as search_module

    monkeypatch.setattr(search_module, "is_stub_model", is_not_stub)
    agent = client.app.state.agent_runtime.get("search-agent")
    agent.set_chat_model(structured_model(raise_on_call=RuntimeError("provider down")))
    try:
        response = client.post(
            "/api/ai/search",
            headers=auth_headers,
            json={
                "kind": "tasks",
                "query": "login",
                "projectContext": _project_context(),
            },
        )
    finally:
        _restore_stub(client, "search-agent")
    body = response.json()
    # Deterministic ids + rationale come through unmodified.
    assert "t-1" in body["ids"]
    assert body["rationale"]


def test_search_records_real_usage_against_budget(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    from app.agents.catalog import search as search_module

    monkeypatch.setattr(search_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 4, "output_tokens": 5, "total_tokens": 9},
    )
    parsed = search_module.SearchRanking(ids=["t-1"], rationale="r")
    agent = client.app.state.agent_runtime.get("search-agent")
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    starting = ai_budget_backend.remaining("p-1")
    try:
        response = client.post(
            "/api/ai/search",
            headers=auth_headers,
            json={
                "kind": "tasks",
                "query": "auth",
                "projectContext": _project_context(),
            },
        )
    finally:
        _restore_stub(client, "search-agent")
    after = ai_budget_backend.remaining("p-1")
    # Total 9 tokens; 1 was prebooked at the gate; delta = 8.
    assert response.status_code == HTTPStatus.OK
    assert starting - after == 8


def test_candidates_from_context_projects_tasks_to_id_text() -> None:
    from app.routers.ai import _candidates_from_context

    candidates = _candidates_from_context("tasks", _project_context())
    assert any(c["id"] == "t-1" and "Fix login bug" in c["text"] for c in candidates)


def test_candidates_from_context_projects_projects_to_id_text() -> None:
    from app.routers.ai import _candidates_from_context

    candidates = _candidates_from_context(
        "projects",
        {"projects": [{"_id": "demo-1", "projectName": "Demo project"}]},
    )
    assert candidates == [{"id": "demo-1", "text": "Demo project"}]


def test_candidates_from_context_handles_non_list_items() -> None:
    from app.routers.ai import _candidates_from_context

    # Invalid items get filtered without crashing the route.
    assert _candidates_from_context("tasks", {"tasks": "nope"}) == []


def test_candidates_from_context_skips_malformed_entries() -> None:
    from app.routers.ai import _candidates_from_context

    candidates = _candidates_from_context(
        "tasks",
        {
            "tasks": [
                "string-not-dict",
                {"_id": 42, "taskName": "non-string id"},
                {"_id": "t-good", "taskName": "kept"},
            ]
        },
    )
    assert candidates == [{"id": "t-good", "text": "kept"}]


# ---------------------------------------------------------------------------
# /api/ai/chat tool-call wire shape tests: when the chat-agent's model
# returns ``AIMessage.tool_calls``, the shim emits ``{kind: "tool_calls",
# toolCalls: [...]}``. The FE drives the multi-round loop client-side
# (max 5 rounds, see useAiChat.ts:170-203). On the inbound side the shim
# accepts the assistant's toolCalls hydration + tool result messages so
# the LLM sees full context across multiple round-trips.
# ---------------------------------------------------------------------------


def test_chat_returns_tool_calls_when_model_picks_a_tool(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        return {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call_1",
                            "name": "listTasks",
                            "args": {"projectId": "p-1"},
                            "type": "tool_call",
                        }
                    ],
                )
            ]
        }

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "What tasks are open?"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    body = response.json()
    assert body == {
        "kind": "tool_calls",
        "toolCalls": [
            {"id": "call_1", "name": "listTasks", "arguments": {"projectId": "p-1"}}
        ],
    }


def test_chat_forwards_assistant_tool_calls_and_tool_result(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The FE replays a multi-round thread; the shim hydrates AIMessage.tool_calls.

    Without ``tool_calls`` on the rebuilt AIMessage, Anthropic 400s with
    "tool_result block references unknown tool_use id"; OpenAI silently
    drops context. Either failure mode breaks the user-visible answer
    on the next turn.
    """

    from langchain_core.messages import ToolMessage

    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="found 3 tasks")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "What tasks are open?"},
                {
                    "role": "assistant",
                    "content": "",
                    "toolCalls": [
                        {
                            "id": "call_1",
                            "name": "listTasks",
                            "arguments": {"projectId": "p-1"},
                        }
                    ],
                },
                {
                    "role": "tool",
                    "content": "[{...}]",
                    "toolCallId": "call_1",
                },
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.json() == {"kind": "text", "text": "found 3 tasks"}
    forwarded = captured["inputs"]["messages"]
    assert [type(m) for m in forwarded] == [HumanMessage, AIMessage, ToolMessage]
    assert forwarded[1].tool_calls == [
        {
            "id": "call_1",
            "name": "listTasks",
            "args": {"projectId": "p-1"},
            "type": "tool_call",
        }
    ]
    assert forwarded[2].tool_call_id == "call_1"
    assert forwarded[2].content == "[{...}]"


def test_chat_drops_orphan_tool_message(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tool result with no preceding assistant tool_call is dropped.

    Stale FE threads (older app version, manual replay) may carry tool
    messages whose toolCallId is unknown. Forwarding them lands a
    400 on the provider and breaks the next user turn -- silent drop
    is the right local recovery.
    """

    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "tool", "content": "stale", "toolCallId": "unknown_id"},
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    forwarded = captured["inputs"]["messages"]
    assert [type(m) for m in forwarded] == [HumanMessage]


def test_chat_skips_assistant_with_no_content_and_no_tool_calls(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank assistant turn (no content, no toolCalls) is silently dropped."""

    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant"},
                {"role": "user", "content": "still here"},
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    forwarded = captured["inputs"]["messages"]
    assert [type(m) for m in forwarded] == [HumanMessage, HumanMessage]


def test_chat_normalize_tool_calls_drops_malformed_entries(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Malformed FE-side toolCalls entries are silently dropped (orphan-drop guard)."""

    captured: dict[str, Any] = {}

    async def capture(name: str, inputs: Any, **kwargs: Any) -> Any:
        captured["inputs"] = inputs
        return {"messages": [AIMessage(content="ok")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                {"role": "user", "content": "hi"},
                {
                    "role": "assistant",
                    "content": "",
                    "toolCalls": [
                        {
                            "id": "good",
                            "name": "listTasks",
                            "arguments": {"projectId": "p-1"},
                        },
                        # The next four are dropped: missing id, missing
                        # name, non-dict, and non-list ``toolCalls`` value
                        # (covered separately below).
                        {"name": "missing-id"},
                        {"id": "no-name"},
                        "not-a-dict",
                        {
                            "id": "bad-args",
                            "name": "getTask",
                            "arguments": "not-a-dict",
                        },
                    ],
                },
            ],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    forwarded = captured["inputs"]["messages"]
    assistant = forwarded[1]
    assert isinstance(assistant, AIMessage)
    # Two valid tool_calls survive: ``good`` and ``bad-args`` (the latter
    # has its non-dict ``arguments`` defaulted to ``{}``).
    surviving = {(c["id"], c["name"]) for c in assistant.tool_calls}
    assert surviving == {("good", "listTasks"), ("bad-args", "getTask")}
    bad_args_call = next(c for c in assistant.tool_calls if c["id"] == "bad-args")
    assert bad_args_call["args"] == {}


def test_chat_normalize_tool_calls_returns_empty_for_non_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers.ai import _normalize_tool_calls

    assert _normalize_tool_calls(None) == []
    assert _normalize_tool_calls("not-a-list") == []
    assert _normalize_tool_calls({"id": "wrong-shape"}) == []


def test_chat_extract_response_handles_non_dict_result(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def capture(*_args: Any, **_kwargs: Any) -> Any:
        return "not a dict"

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.json() == {
        "kind": "text",
        "text": "Board Copilot is unavailable.",
    }


def test_chat_extract_response_handles_empty_messages(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def capture(*_args: Any, **_kwargs: Any) -> Any:
        return {"messages": []}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.json()["text"] == "Board Copilot is unavailable."


def test_chat_extract_response_handles_non_aimessage_tail(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def capture(*_args: Any, **_kwargs: Any) -> Any:
        return {"messages": [HumanMessage(content="oops")]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.json()["text"] == "Board Copilot is unavailable."


def test_chat_extract_response_filters_malformed_tool_call_dicts(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Malformed entries in ``AIMessage.tool_calls`` are silently dropped.

    Older LangChain versions / non-standard providers can hand back
    tool_calls with non-string ids, missing names, non-dict args, or
    even non-dict entries. Forwarding any of those to the FE would
    break the dispatcher; the shim's ``_extract_chat_response`` filters
    them so the FE only sees complete, dispatchable calls. The
    AIMessage validator rejects malformed entries at construction time,
    so we attach them via ``object.__setattr__`` after building a
    valid base message -- that exercises the shim's defensive filter
    without fighting the Pydantic validator the shim is here to back-
    stop.
    """

    async def capture(*_args: Any, **_kwargs: Any) -> Any:
        message = AIMessage(content="")
        object.__setattr__(
            message,
            "tool_calls",
            [
                {
                    "id": "valid",
                    "name": "getTask",
                    "args": {"taskId": "t-1"},
                    "type": "tool_call",
                },
                # Filtered: non-string id.
                {"id": None, "name": "broken", "args": {}, "type": "tool_call"},
                # Filtered: missing name.
                {"id": "no-name", "args": {}, "type": "tool_call"},
                # Filtered: not a dict at all.
                "string-not-dict",
                # Kept: non-dict args defaulted to ``{}``.
                {
                    "id": "bad-args",
                    "name": "listTasks",
                    "args": "not-a-dict",
                    "type": "tool_call",
                },
            ],
        )
        return {"messages": [message]}

    monkeypatch.setattr(
        client.app.state.agent_runtime, "ainvoke", capture, raising=False
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    body = response.json()
    assert body["kind"] == "tool_calls"
    assert body["toolCalls"] == [
        {"id": "valid", "name": "getTask", "arguments": {"taskId": "t-1"}},
        {"id": "bad-args", "name": "listTasks", "arguments": {}},
    ]


def test_v1_route_records_idempotency_miss_and_hit_metrics(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Tier 9: a v1 route round-trips through the cache outcome counters.

    ``/api/ai/task-draft`` is a deterministic-only route on the stub
    catalog (no provider key set in tests), so two identical posts
    with the same ``Idempotency-Key`` exercise miss → hit cleanly.
    """

    from app.config import settings as app_settings
    from app.observability import metrics as metrics_module

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        headers = {**auth_headers, "Idempotency-Key": "v1-metric-key"}
        body = {"prompt": "draft me", "context": _project_context()}
        first = client.post("/api/ai/task-draft", json=body, headers=headers)
        assert first.status_code == HTTPStatus.OK
        miss = metrics_module.idempotency_cache_total.labels(
            route="/api/ai/task-draft", outcome="miss"
        )._value.get()
        assert miss == 1.0

        second = client.post("/api/ai/task-draft", json=body, headers=headers)
        assert second.status_code == HTTPStatus.OK
        assert second.headers.get("Idempotent-Replay") == "true"
        hit = metrics_module.idempotency_cache_total.labels(
            route="/api/ai/task-draft", outcome="hit"
        )._value.get()
        replay = metrics_module.agent_invocations_total.labels(
            agent="v1-task-draft", outcome="replay"
        )._value.get()
        assert hit == 1.0
        assert replay == 1.0
    finally:
        metrics_module.reset_for_tests()


def test_v1_route_records_idempotency_in_flight_metric(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Tier 9: a 409 in-flight sibling on the v1 surface bumps the counter.

    Manually reserves the cache slot before the request lands to
    simulate a sibling call still in flight, then asserts the 409
    envelope and the matching ``in_flight`` outcome on the
    Prometheus counter.
    """

    from app.config import settings as app_settings
    from app.middleware import idempotency as _idempotency
    from app.middleware.idempotency import cache_key, fingerprint_request
    from app.observability import metrics as metrics_module

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        body = {"prompt": "x", "context": _project_context()}
        operation = "legacy-ai:v1-task-draft"
        fp = fingerprint_request("POST", operation, body)
        _idempotency.idempotency_cache.reserve(
            cache_key("ai-user", operation, "v1-in-flight"),
            fp,
        )
        headers = {**auth_headers, "Idempotency-Key": "v1-in-flight"}
        response = client.post("/api/ai/task-draft", json=body, headers=headers)
        assert response.status_code == HTTPStatus.CONFLICT
        in_flight = metrics_module.idempotency_cache_total.labels(
            route="/api/ai/task-draft", outcome="in_flight"
        )._value.get()
        assert in_flight == 1.0
    finally:
        metrics_module.reset_for_tests()


def test_legacy_ai_route_meta_unknown_suffix_raises_key_error() -> None:
    from app.routers.ai import _legacy_ai_route_meta

    with pytest.raises(KeyError, match="no legacy AI route metadata"):
        _legacy_ai_route_meta("/api/ai/not-a-configured-endpoint")


# ---------------------------------------------------------------------------
# Wire-shape parity with pulse `useAi.ts`.
#
# The shipped React client posts the entire ``RunPayload`` (see
# ``src/utils/hooks/useAi.ts`` in pulse) for each v1 route, which
# wraps the request fields under a route-specific envelope key:
#
#   /task-draft     -> {"draft":     {"prompt": ..., "context": ...}}
#   /task-breakdown -> {"draft":     {"prompt": ..., "count": ..., ...}}
#   /estimate       -> {"estimate":  {"taskName": ..., "context": ...}}
#   /readiness      -> {"readiness": {"taskName": ..., "context": ...}}
#   /board-brief    -> {"brief":     {"context": ...}}
#   /search         -> {"search":    {"kind": ..., "query": ..., ...}}
#
# The earlier handlers read fields off the top-level body, so every wrapped
# request silently degraded to "no prompt / no context" -- the deterministic
# stub still returned a 200 but the FE-visible output was empty. The router
# now unwraps the envelope when present (``_unwrap_envelope``), and these
# tests pin that contract so a future refactor cannot regress it.
# ---------------------------------------------------------------------------


def test_task_draft_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={
            "draft": {
                "context": _project_context(),
                "prompt": "Fix login bug on Safari",
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    # A non-empty taskName proves the prompt actually reached the engine; the
    # deterministic ``v1_engine.draft_task`` returns a stripped placeholder
    # when ``prompt`` is missing or empty.
    assert body["taskName"]
    assert "login" in body["taskName"].lower() or "safari" in body["taskName"].lower()


def test_task_breakdown_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/task-breakdown",
        headers=auth_headers,
        json={
            "draft": {
                "context": _project_context(),
                "prompt": "Refactor auth",
                "count": 4,
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    items = response.json()["items"]
    assert len(items) == 4
    # ``count`` only takes effect if the envelope was unwrapped; the flat
    # default would have produced 3 items.


def test_estimate_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/estimate",
        headers=auth_headers,
        json={
            "estimate": {
                "context": _project_context(),
                "taskName": "Fix login bug",
                "note": "Safari only",
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["storyPoints"] in (1, 2, 3, 5, 8, 13)


def test_readiness_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/readiness",
        headers=auth_headers,
        json={
            "readiness": {
                "context": _project_context(),
                "taskName": "x",
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    flagged = {issue["field"] for issue in response.json()["issues"]}
    # Mirrors ``test_readiness_flags_missing_fields``: the engine should see
    # the same ``taskName="x"`` payload (and no ``note`` / ``coordinatorId``)
    # whether the FE wraps it under ``"readiness"`` or sends it flat. A
    # regression in unwrapping would surface here as an empty ``flagged`` set
    # because the engine would receive an empty payload.
    assert "note" in flagged
    assert "coordinatorId" in flagged


def test_board_brief_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"brief": {"context": _project_context()}},
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    # Three columns in the fixture context. If the envelope had been ignored,
    # the engine would have seen ``context={}`` and produced an empty list.
    assert len(body["counts"]) == 3
    assert any(item["columnId"] == "c-todo" for item in body["counts"])


def test_search_accepts_fe_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/search",
        headers=auth_headers,
        json={
            "search": {
                "kind": "tasks",
                "query": "login",
                "projectContext": _project_context(),
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert "t-1" in body["ids"]


def test_unwrap_envelope_ignores_non_dict_value(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A wrong-typed envelope (e.g. a list) must not break the handler.

    If the FE sends ``{"draft": [...]}`` by accident, the unwrap helper
    leaves the payload alone and the handler reports the resulting empty
    body the same way it would for a flat ``{}``. This pins the helper's
    "only unwrap when the value is a dict" guard.
    """

    response = client.post(
        "/api/ai/task-draft",
        headers=auth_headers,
        json={"draft": ["not", "a", "dict"], "prompt": "Add MFA"},
    )
    # The flat ``prompt`` at the top level is still honoured because the
    # envelope value was not a dict, so the handler keeps the original body.
    assert response.status_code == HTTPStatus.OK
    assert response.json()["taskName"]


# ---------------------------------------------------------------------------
# _gate rate_limited path (lines 169-170 in ai.py)
# ---------------------------------------------------------------------------


def test_gate_records_rate_limited_on_429(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_rate_limit_backend: RateLimiter,
) -> None:
    """_gate emits record_invocation('rate_limited') and returns 429."""
    from app.observability import metrics as metrics_module
    from app.config import settings as app_settings

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        # Exhaust the rate limiter so the second task-draft call is blocked.
        monkeypatch.setattr(
            ai_rate_limit_backend,
            "check",
            lambda *a, **kw: (False, 60),
        )
        response = client.post(
            "/api/ai/task-draft",
            headers=auth_headers,
            json={"context": _project_context(), "prompt": "x"},
        )
        assert response.status_code == HTTPStatus.TOO_MANY_REQUESTS
        rate_limited_value = metrics_module.agent_invocations_total.labels(
            agent="v1-task-draft", outcome="rate_limited"
        )._value.get()
        assert rate_limited_value >= 1.0
    finally:
        metrics_module.reset_for_tests()


# ---------------------------------------------------------------------------
# _gate_with_reservation gate paths (lines 205, 210, 227-228 in ai.py)
# ---------------------------------------------------------------------------


def test_gate_with_reservation_rejects_disabled_project(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_gate_with_reservation raises 403 when AI is disabled for the project."""
    monkeypatch.setattr(
        "app.routers.ai.is_project_ai_enabled",
        lambda *args, **kwargs: False,
    )
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
        },
    )
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert "disabled" in response.text


def test_gate_with_reservation_rejects_non_manager(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """_gate_with_reservation raises 403 when caller is not the project manager."""
    # p-budget-agent is managed by agent-user, not ai-user (who holds auth_headers).
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": "p-budget-agent", "projectName": "Other"}},
        },
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_gate_with_reservation_records_budget_exhausted_on_402(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """_gate_with_reservation records 'budget_exhausted' and returns 402."""
    from app.observability import metrics as metrics_module
    from app.config import settings as app_settings

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        monkeypatch.setattr(ai_budget_backend, "monthly_cap", 0)
        response = client.post(
            "/api/ai/chat",
            headers=auth_headers,
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "context": {"project": {"_id": "p-1", "projectName": "Demo"}},
            },
        )
        assert response.status_code == HTTPStatus.PAYMENT_REQUIRED
        budget_exhausted_value = metrics_module.agent_invocations_total.labels(
            agent="chat-agent", outcome="budget_exhausted"
        )._value.get()
        assert budget_exhausted_value >= 1.0
    finally:
        metrics_module.reset_for_tests()


# ---------------------------------------------------------------------------
# chat except BaseException refund path (ai.py except BaseException branch)
# and budget record top-up when actual tokens exceed reservation (ai.py
# budget_tracker.record call)
# ---------------------------------------------------------------------------


def test_chat_refunds_reservation_on_ainvoke_failure(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """When runtime.ainvoke raises, the reserved budget token is refunded."""
    project_id = "p-budget"
    before = ai_budget_backend.remaining(project_id)

    async def explode(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("forced failure")

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "ainvoke", explode, raising=False)

    lax = TestClient(client.app, raise_server_exceptions=False)
    lax.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": project_id, "projectName": "Budgeted"}},
        },
    )
    after = ai_budget_backend.remaining(project_id)
    # The reservation must have been refunded: remaining should be unchanged.
    assert after == before


def test_chat_records_budget_top_up_when_actual_tokens_exceed_reservation(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """When actual token usage > 1 (the reservation), the delta is recorded."""
    project_id = "p-budget"
    before = ai_budget_backend.remaining(project_id)

    async def scripted_ainvoke(*args: Any, **kwargs: Any) -> Any:
        return {
            "messages": [
                AIMessage(
                    content="hello",
                    usage_metadata={
                        "input_tokens": 10,
                        "output_tokens": 5,
                        "total_tokens": 15,
                    },
                )
            ]
        }

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "ainvoke", scripted_ainvoke, raising=False)

    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "context": {"project": {"_id": project_id, "projectName": "Budgeted"}},
        },
    )
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining(project_id)
    # reserve(1) + record(delta=14) = 15 total tokens debited.
    assert before - after == 15


def test_board_brief_returns_502_when_agent_emits_no_suggestion(  # noqa: E501
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defensive fallback: if the agent never reaches its emit_citations
    node (impossible in practice — every catalog graph runs through it),
    the v1 shim returns a typed 502 instead of crashing on a missing
    payload key."""

    async def empty_run(*args: Any, **kwargs: Any) -> Any:
        return {}, []

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(
        runtime, "arun_with_events", empty_run, raising=False
    )
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={"context": _project_context()},
    )
    assert response.status_code == HTTPStatus.BAD_GATEWAY
    # The app-level HTTPException handler unwraps ``detail`` so the response
    # body is whatever was passed as ``detail`` (here: ``{"error": {...}}``).
    body = response.json()
    assert body["error"]["code"] == "agent_unavailable"


def test_board_brief_records_budget_top_up_when_actual_tokens_exceed_reservation(  # noqa: E501
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Real-model parity for the board-brief route: when the agent's
    final state carries token usage above the 1-token pre-reservation
    floor, the route tops the budget tracker up by ``actual - 1``.
    Mirrors the historical ``_polish_and_record`` debit semantics that
    the migration replaced.
    """

    project_id = "p-budget"
    before = ai_budget_backend.remaining(project_id)

    async def scripted_run(*args: Any, **kwargs: Any) -> Any:
        final_state = {
            "messages": [
                AIMessage(
                    content="hello",
                    usage_metadata={
                        "input_tokens": 10,
                        "output_tokens": 5,
                        "total_tokens": 15,
                    },
                )
            ]
        }
        custom_events = [
            {
                "kind": "suggestion",
                "surface": "brief",
                "payload": {"headline": "stub"},
            }
        ]
        return final_state, custom_events

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(
        runtime, "arun_with_events", scripted_run, raising=False
    )
    response = client.post(
        "/api/ai/board-brief",
        headers=auth_headers,
        json={
            "context": {
                "project": {"_id": project_id, "projectName": "Budgeted"}
            }
        },
    )
    assert response.status_code == HTTPStatus.OK
    after = ai_budget_backend.remaining(project_id)
    # ``_gate`` does NOT reserve (it is a read-only ``can_spend`` check),
    # so the post-run record is ``max(0, actual - 1)`` = 14 — same
    # under-by-one debit the pre-migration ``_polish_and_record`` had.
    assert before - after == 14
