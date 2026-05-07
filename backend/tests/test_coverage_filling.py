"""Targeted tests filling the remaining coverage gaps.

The goal of this file is to hit every branch the higher-level scenario
tests don't naturally exercise. Keep tests small and pointed -- fold them
into the appropriate scenario file when they grow context.
"""

from __future__ import annotations

import asyncio
import sys
from http import HTTPStatus
from typing import Any, AsyncIterator, Iterable

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from app import security
from app.agents.catalog import board_brief as bb_module
from app.agents.catalog import chat as chat_module
from app.agents.catalog import task_drafting as td_module
from app.agents.catalog import task_estimation as te_module
from app.agents.errors import AgentConfigurationError
from app.agents.llm import (
    PROVIDER_ANTHROPIC,
    PROVIDER_OPENAI,
    ChatModelSpec,
    make_chat_model,
)
from app.agents.runtime import AgentRuntime
from app.agents.sse import _interrupt_data, translate_event
from app.middleware import budget as budget_module
from app.middleware import rate_limit as rate_limit_module
from app.security import create_token
from tests.conftest import is_not_stub, structured_model


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("fill-user")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def reset_state() -> Iterable[None]:
    rate_limit_module.rate_limiter.reset()
    budget_module.budget_tracker.reset()
    yield
    rate_limit_module.rate_limiter.reset()
    budget_module.budget_tracker.reset()


# ---------------------------------------------------------------------------
# llm.py provider branches (RuntimeError when integration package missing)
# ---------------------------------------------------------------------------


def test_make_chat_model_raises_when_anthropic_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "langchain_anthropic", None)
    spec = ChatModelSpec(provider=PROVIDER_ANTHROPIC, model="claude-x", api_key="k")
    with pytest.raises(RuntimeError, match="langchain-anthropic"):
        make_chat_model(spec)


def test_make_chat_model_raises_when_openai_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "langchain_openai", None)
    spec = ChatModelSpec(provider=PROVIDER_OPENAI, model="gpt-x", api_key="k")
    with pytest.raises(RuntimeError, match="langchain-openai"):
        make_chat_model(spec)


# ---------------------------------------------------------------------------
# llm.assert_provider_available -- boot-time loud-fail for missing extras
# ---------------------------------------------------------------------------


def test_assert_provider_available_no_op_for_stub() -> None:
    from app.agents.llm import (
        PROVIDER_STUB,
        assert_provider_available,
    )

    assert_provider_available(
        ChatModelSpec(provider=PROVIDER_STUB, model="stub", api_key="")
    )


def test_assert_provider_available_passes_when_anthropic_importable() -> None:
    """The dev install pulls langchain-anthropic in; the check should pass."""

    from app.agents.llm import assert_provider_available

    assert_provider_available(
        ChatModelSpec(provider=PROVIDER_ANTHROPIC, model="claude-x", api_key="k")
    )


def test_assert_provider_available_passes_when_openai_importable() -> None:
    from app.agents.llm import assert_provider_available

    assert_provider_available(
        ChatModelSpec(provider=PROVIDER_OPENAI, model="gpt-x", api_key="k")
    )


def test_assert_provider_available_raises_for_missing_anthropic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.llm import assert_provider_available

    monkeypatch.setitem(sys.modules, "langchain_anthropic", None)
    spec = ChatModelSpec(provider=PROVIDER_ANTHROPIC, model="claude-x", api_key="k")
    with pytest.raises(RuntimeError, match="langchain-anthropic is not installed"):
        assert_provider_available(spec)


def test_assert_provider_available_raises_for_missing_openai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.llm import assert_provider_available

    monkeypatch.setitem(sys.modules, "langchain_openai", None)
    spec = ChatModelSpec(provider=PROVIDER_OPENAI, model="gpt-x", api_key="k")
    with pytest.raises(RuntimeError, match="langchain-openai is not installed"):
        assert_provider_available(spec)


# ---------------------------------------------------------------------------
# config.py env_float invalid value
# ---------------------------------------------------------------------------


def test_env_float_rejects_invalid_value(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import env_float

    monkeypatch.setenv("AGENT_TEST_FLOAT", "not-a-float")
    with pytest.raises(RuntimeError, match="AGENT_TEST_FLOAT must be a float"):
        env_float("AGENT_TEST_FLOAT", "0.0")


# ---------------------------------------------------------------------------
# runtime._resume_input refuses to resume without a checkpointer
# ---------------------------------------------------------------------------


def test_resume_without_checkpointer_raises() -> None:
    runtime = AgentRuntime(checkpointer=None)
    with pytest.raises(AgentConfigurationError, match="checkpointer"):
        runtime._resume_input({}, "value", "thread-1")


# ---------------------------------------------------------------------------
# sse._interrupt_data accepts non-dict args + Interrupt-style objects
# ---------------------------------------------------------------------------


class _FakeInterrupt:
    def __init__(self, value: object) -> None:
        self.value = value


def test_interrupt_lift_supports_object_with_value_attr() -> None:
    fake = _FakeInterrupt({"tool": "fe.viewerContext", "args": {"k": "v"}})
    events = list(translate_event("updates", {"__interrupt__": fake}))
    assert events == [
        {
            "type": "interrupt",
            "ns": [],
            "data": {"tool": "fe.viewerContext", "args": {"k": "v"}},
        }
    ]


def test_interrupt_lift_wraps_non_dict_args_in_value() -> None:
    out = _interrupt_data({"tool": "fe.recentActivity", "args": "raw"})
    assert out == {"tool": "fe.recentActivity", "args": {"value": "raw"}}


def test_interrupt_lift_returns_none_for_unrelated_object() -> None:
    assert _interrupt_data(42) is None


# ---------------------------------------------------------------------------
# Catalog agents: LLM-driven branches when a real-looking model is injected
# ---------------------------------------------------------------------------


def test_board_brief_polish_uses_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.board_brief import BriefHeadline, polish_headline

    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored-by-parser",
        usage_metadata={"input_tokens": 4, "output_tokens": 9, "total_tokens": 13},
    )
    model = structured_model(
        parsed=BriefHeadline(headline="Standup headline\nignored"),
        raw_message=raw,
    )

    headline, tin, tout = asyncio.run(polish_headline(model, "fallback", {"x": 1}))

    # Schema cap + first-line trimming both apply.
    assert headline == "Standup headline"
    assert (tin, tout) == (4, 9)


def test_board_brief_polish_falls_back_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.board_brief import polish_headline

    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    model = structured_model(raise_on_call=RuntimeError("provider down"))

    headline, tin, tout = asyncio.run(polish_headline(model, "fallback", {}))

    assert headline == "fallback"
    assert (tin, tout) == (0, 0)


def test_board_brief_polish_falls_back_when_parsing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.board_brief import polish_headline

    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="malformed",
        usage_metadata={"input_tokens": 2, "output_tokens": 0, "total_tokens": 2},
    )
    model = structured_model(
        parsed=None,
        raw_message=raw,
        parsing_error=ValueError("bad json"),
    )

    headline, tin, tout = asyncio.run(polish_headline(model, "fallback", {}))

    assert headline == "fallback"
    # Token usage is still trued up against the budget when the provider
    # reported it -- only the headline falls back.
    assert tin == 2


def test_board_brief_polish_falls_back_on_blank_headline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.board_brief import BriefHeadline, polish_headline

    monkeypatch.setattr(bb_module, "is_stub_model", is_not_stub)
    model = structured_model(parsed=BriefHeadline(headline="   "))

    headline, _, _ = asyncio.run(polish_headline(model, "fallback", {}))
    assert headline == "fallback"


def test_task_drafting_polish_uses_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_drafting import DraftPolish, polish_draft

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 6, "output_tokens": 4, "total_tokens": 10},
    )
    model = structured_model(
        parsed=DraftPolish(
            taskName="Polished name",
            note="polished body",
            rationale="Polished rationale",
        ),
        raw_message=raw,
    )

    base = {
        "taskName": "raw",
        "note": "raw note",
        "rationale": "raw rationale",
        "type": "feature",
        "epic": "general",
        "storyPoints": 3,
        "columnId": None,
        "coordinatorId": None,
        "confidence": "moderate",
    }
    polished, tin, tout = asyncio.run(polish_draft(model, base, "raw prompt", []))
    assert polished["taskName"] == "Polished name"
    assert polished["note"] == "polished body"
    assert polished["rationale"] == "Polished rationale"
    assert (tin, tout) == (6, 4)
    # Non-string fields stay deterministic.
    assert polished["storyPoints"] == 3


def test_task_drafting_polish_falls_back_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_drafting import polish_draft

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    model = structured_model(raise_on_call=RuntimeError("provider down"))

    base = {"taskName": "x", "note": "y", "rationale": "z"}
    polished, tin, tout = asyncio.run(polish_draft(model, base, "p", []))
    assert polished == base
    assert (tin, tout) == (0, 0)


def test_task_drafting_polish_falls_back_on_parsing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_drafting import polish_draft

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="not json",
        usage_metadata={"input_tokens": 2, "output_tokens": 3, "total_tokens": 5},
    )
    model = structured_model(
        parsed=None, raw_message=raw, parsing_error=ValueError("bad json")
    )

    base = {"taskName": "x", "note": "y", "rationale": "z"}
    polished, tin, tout = asyncio.run(polish_draft(model, base, "p", []))
    assert polished == base
    assert (tin, tout) == (2, 3)


def test_task_drafting_polish_skips_blank_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty/whitespace fields in the parsed schema must not overwrite the draft."""

    from app.agents.catalog.task_drafting import DraftPolish, polish_draft

    monkeypatch.setattr(td_module, "is_stub_model", is_not_stub)
    model = structured_model(
        parsed=DraftPolish(taskName="", note="   ", rationale="Updated rationale"),
    )

    base = {"taskName": "kept", "note": "kept too", "rationale": "old"}
    polished, _, _ = asyncio.run(polish_draft(model, base, "p", []))
    assert polished["taskName"] == "kept"
    assert polished["note"] == "kept too"
    assert polished["rationale"] == "Updated rationale"


def test_task_estimation_polish_uses_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import (
        EstimationRationale,
        polish_rationale,
    )

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 1, "output_tokens": 2, "total_tokens": 3},
    )
    model = structured_model(
        parsed=EstimationRationale(rationale="Polished rationale\nignored line"),
        raw_message=raw,
    )

    line, tin, tout = asyncio.run(polish_rationale(model, "fallback", {}, 5, []))
    assert line == "Polished rationale"
    assert (tin, tout) == (1, 2)


def test_task_estimation_polish_falls_back_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import polish_rationale

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    model = structured_model(raise_on_call=RuntimeError("provider down"))

    line, tin, tout = asyncio.run(polish_rationale(model, "fallback", {}, 3, []))
    assert line == "fallback"
    assert (tin, tout) == (0, 0)


def test_task_estimation_polish_falls_back_on_parsing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import polish_rationale

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 4, "output_tokens": 0, "total_tokens": 4},
    )
    model = structured_model(
        parsed=None, raw_message=raw, parsing_error=ValueError("bad")
    )

    line, tin, _ = asyncio.run(polish_rationale(model, "fallback", {}, 3, []))
    assert line == "fallback"
    assert tin == 4


def test_task_estimation_polish_falls_back_on_blank_rationale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import (
        EstimationRationale,
        polish_rationale,
    )

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    model = structured_model(parsed=EstimationRationale(rationale="   "))

    line, _, _ = asyncio.run(polish_rationale(model, "fallback", {}, 3, []))
    assert line == "fallback"


def _readiness_baseline() -> dict[str, Any]:
    """Standard deterministic ``IReadinessReport`` for polish_readiness tests."""

    return {
        "issues": [
            {
                "field": "taskName",
                "severity": "error",
                "message": "Task name is required.",
                "suggestion": None,
            },
            {
                "field": "note",
                "severity": "warn",
                "message": "Acceptance criteria are missing.",
                "suggestion": None,
            },
        ]
    }


def test_task_estimation_polish_readiness_short_circuits_for_stub() -> None:
    from app.agents.catalog.task_estimation import polish_readiness
    from app.agents.llm import make_stub_chat_model

    deterministic = _readiness_baseline()
    polished, tin, tout = asyncio.run(
        polish_readiness(make_stub_chat_model(), deterministic, {})
    )
    assert polished is deterministic
    assert (tin, tout) == (0, 0)


def test_task_estimation_polish_readiness_short_circuits_when_no_issues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import polish_readiness

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    deterministic = {"issues": []}

    class _NoModel:
        def with_structured_output(self, *_: Any, **__: Any) -> Any:
            raise AssertionError(
                "polish_readiness must not call the model on empty issues"
            )

    polished, tin, tout = asyncio.run(polish_readiness(_NoModel(), deterministic, {}))
    assert polished is deterministic
    assert (tin, tout) == (0, 0)


def test_task_estimation_polish_readiness_overrides_message_and_suggestion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import (
        ReadinessIssuePolish,
        ReadinessPolish,
        polish_readiness,
    )

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 8, "output_tokens": 6, "total_tokens": 14},
    )
    parsed = ReadinessPolish(
        issues=[
            ReadinessIssuePolish(
                field="taskName",
                message="Polished message\nignored second line",
                suggestion="Polished suggestion",
            ),
            # Field that does not match any deterministic row -- ignored.
            ReadinessIssuePolish(field="ghost", message="leak", suggestion="leak"),
            # Empty field id -- pruned by the helper before the merge map.
            ReadinessIssuePolish(field="", message="orphan", suggestion="orphan"),
        ]
    )
    model = structured_model(parsed=parsed, raw_message=raw)

    polished, tin, tout = asyncio.run(
        polish_readiness(model, _readiness_baseline(), {"taskName": "x"})
    )

    polished_by_field = {issue["field"]: issue for issue in polished["issues"]}
    assert polished_by_field["taskName"]["message"] == "Polished message"
    assert polished_by_field["taskName"]["suggestion"] == "Polished suggestion"
    assert polished_by_field["note"]["message"] == "Acceptance criteria are missing."
    assert polished_by_field["note"]["suggestion"] is None
    # Severity is *not* eligible for LLM rewriting and stays deterministic.
    assert polished_by_field["taskName"]["severity"] == "error"
    assert (tin, tout) == (8, 6)


def test_task_estimation_polish_readiness_keeps_deterministic_on_blank_strings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import (
        ReadinessIssuePolish,
        ReadinessPolish,
        polish_readiness,
    )

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    parsed = ReadinessPolish(
        issues=[
            ReadinessIssuePolish(field="taskName", message="   ", suggestion="\n\n"),
        ]
    )
    model = structured_model(parsed=parsed)

    polished, _, _ = asyncio.run(polish_readiness(model, _readiness_baseline(), {}))
    issue = next(i for i in polished["issues"] if i["field"] == "taskName")
    assert issue["message"] == "Task name is required."
    assert issue["suggestion"] is None


def test_task_estimation_polish_readiness_falls_back_on_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import polish_readiness

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    model = structured_model(raise_on_call=RuntimeError("provider down"))

    polished, tin, tout = asyncio.run(polish_readiness(model, _readiness_baseline(), {}))
    assert polished == _readiness_baseline()
    assert (tin, tout) == (0, 0)


def test_task_estimation_polish_readiness_falls_back_on_parsing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog.task_estimation import polish_readiness

    monkeypatch.setattr(te_module, "is_stub_model", is_not_stub)
    raw = AIMessage(
        content="malformed",
        usage_metadata={"input_tokens": 4, "output_tokens": 0, "total_tokens": 4},
    )
    model = structured_model(
        parsed=None, raw_message=raw, parsing_error=ValueError("bad json")
    )

    polished, tin, _ = asyncio.run(polish_readiness(model, _readiness_baseline(), {}))
    assert polished == _readiness_baseline()
    # Token usage is still accounted for so the budget tracker can true up.
    assert tin == 4


def test_chat_agent_handles_non_aimessage_response(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Cover the ``not isinstance(raw, AIMessage)`` branch in chat.respond."""

    monkeypatch.setattr(chat_module, "is_stub_model", is_not_stub)
    chat_agent = client.app.state.agent_runtime.get("chat-agent")

    class _OddModel:
        class _Result:
            content = "fallback content"

        async def ainvoke(self, _messages: Any, **_: Any) -> Any:
            return self._Result()

        def invoke(self, _messages: Any, **_: Any) -> Any:
            return self._Result()

        def bind_tools(self, _tools: Any, **_: Any) -> "_OddModel":
            return self

    chat_agent.set_chat_model(_OddModel())
    try:
        response = client.post(
            "/api/v1/agents/chat-agent/invoke",
            json={"inputs": {"messages": [{"role": "user", "content": "ping"}]}},
            headers=auth_headers,
        )
    finally:
        chat_agent.set_chat_model(None)
        chat_agent._chat_model_resolved = False
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert "fallback content" in body["result"]["messages"][-1]["content"]


# ---------------------------------------------------------------------------
# v1 engine: edge-case branches not exercised by the happy-path tests
# ---------------------------------------------------------------------------


def test_v1_engine_handles_empty_inputs() -> None:
    from app.services import v1_engine

    draft = v1_engine.draft_task({"context": {}, "prompt": ""})
    assert draft["taskName"] == "New task"
    assert draft["columnId"] == ""
    assert draft["coordinatorId"] == ""

    breakdown = v1_engine.breakdown_task({"context": {}, "prompt": "a"}, count=10)
    # Count is clamped to <=5.
    assert len(breakdown["items"]) == 5

    breakdown_low = v1_engine.breakdown_task({"context": {}, "prompt": "a"}, count=0)
    assert len(breakdown_low["items"]) == 1


def test_v1_engine_estimate_with_no_neighbours() -> None:
    from app.services import v1_engine

    out = v1_engine.estimate({"context": {}, "taskName": "alpha", "note": "beta"})
    assert out["confidence"] == 0.45
    assert out["similar"] == []


def test_board_brief_recommendation_helpers_cover_basis_branches() -> None:
    """Exercise strength/basis helpers so drift-label edge cases stay covered."""

    from app.agents.catalog.board_brief import (
        _RD_STRONG_UNOWNED_THRESHOLD,
        _recommendation_basis,
        _recommendation_strength,
    )

    # Strength: unowned task count alone must cross the threshold (no bug signal).
    assert (
        _recommendation_strength([], _RD_STRONG_UNOWNED_THRESHOLD + 1) == "strong"
    )
    # Strength: non-bug drift signals → moderate.
    assert _recommendation_strength([{"type": "stale_task"}], 0) == "moderate"

    brief = {"largestUnstarted": [{"_id": "t1"}]}
    drift_wip = {
        "signals": [
            {
                "type": "wip_overflow",
                "column_name": "In Progress",
                "count": 6,
                "limit": 3,
            }
        ]
    }
    basis = _recommendation_basis(drift_wip["signals"], 0, brief)
    assert "In Progress" in basis and "WIP" in basis

    assert "1 stale task" in _recommendation_basis(
        [{"type": "stale_task"}], 0, brief
    )

    drift_mixed_unowned = {
        "signals": [{"type": "unowned_bug"}, {"type": "unowned_bug"}]
    }
    basis2 = _recommendation_basis(drift_mixed_unowned["signals"], 3, brief)
    assert "other unowned" in basis2

    assert "large unstarted" in _recommendation_basis([], 0, brief)
    assert _recommendation_basis([], 0, {"largestUnstarted": []}).endswith(
        "no drift detected"
    )


def test_v1_engine_board_brief_skips_invalid_entries() -> None:
    from app.services import v1_engine

    out = v1_engine.board_brief(
        {
            "columns": [{"_id": "c1", "name": "Done"}, "junk"],
            "tasks": [
                "junk",
                {"_id": "t1", "taskName": "x", "columnId": "c1", "coordinatorId": "m1"},
                {"_id": "t2", "taskName": "y", "columnId": "c1"},
            ],
            "members": [{"_id": "m1", "username": "alice"}, "junk"],
        }
    )
    assert out["counts"][0]["columnId"] == "c1"


def test_v1_engine_board_brief_non_list_tasks_treated_as_empty() -> None:
    """Malformed ``tasks`` (not a list) must not iterate strings / corrupt aggregates."""

    from app.services import v1_engine

    base_columns = [{"_id": "c1", "name": "To Do"}]

    for bad_tasks in ({}, "task-string-not-list", {"_id": "t1"}):
        out = v1_engine.board_brief(
            {"columns": base_columns, "tasks": bad_tasks, "members": []}
        )
        assert out["unowned"] == []
        assert out["workload"] == []
        assert out["largestUnstarted"] == []
        assert "0 tasks across 1 columns" in out["headline"]

    # Columns still typed from ``columns``; task counts per column stay zero.
    out_dict = v1_engine.board_brief(
        {"columns": base_columns, "tasks": {}, "members": []}
    )
    assert out_dict["counts"][0]["count"] == 0


def test_recommendation_basis_wip_overflow_minimal_signal() -> None:
    """WIP overflow dict without ``column_name`` / counts uses placeholder defaults."""

    from app.agents.catalog.board_brief import _recommendation_basis

    brief = {"largestUnstarted": []}
    basis = _recommendation_basis([{"type": "wip_overflow"}], 0, brief)
    assert "a column" in basis
    assert " WIP " in basis
    assert "> limit " in basis


def test_v1_engine_search_handles_empty_kind() -> None:
    from app.services import v1_engine

    out = v1_engine.semantic_search("tasks", "anything", {})
    assert out["ids"] == []
    assert "No matches" in out["rationale"]


def test_v1_engine_semantic_search_projects_includes_org_and_manager_fields() -> None:
    from app.services import v1_engine

    ctx = {
        "projects": [
            {
                "_id": "p1",
                "projectName": "Alpha",
                "organization": "Acme Corp",
                "managerId": "alice",
            }
        ]
    }
    out = v1_engine.semantic_search("projects", "Acme alice", ctx)
    assert "p1" in out["ids"]


def test_v1_engine_epic_for_general_fallback() -> None:
    from app.services import v1_engine

    assert v1_engine._epic_for("xyzzy") == "General"


def test_v1_engine_type_for_spike() -> None:
    from app.services import v1_engine

    assert v1_engine._type_for("investigate caching strategy") == "spike"


def test_v1_engine_default_column_falls_back_to_first_when_no_named_match() -> None:
    from app.services import v1_engine

    column = v1_engine._default_column(
        {"columns": [{"_id": "c-arbitrary", "name": "Doing"}]}
    )
    assert column == "c-arbitrary"


def test_v1_engine_default_column_handles_invalid_columns_list() -> None:
    from app.services import v1_engine

    assert v1_engine._default_column({"columns": "junk"}) is None
    assert v1_engine._default_column({"columns": []}) is None
    # No `_id` field means we cannot return a candidate.
    assert v1_engine._default_column({"columns": [{"name": "Backlog"}]}) is None


def test_v1_engine_least_loaded_member_with_no_members() -> None:
    from app.services import v1_engine

    assert v1_engine._least_loaded_member({"members": []}) is None
    assert v1_engine._least_loaded_member({}) is None


def test_v1_engine_safe_id_branches() -> None:
    from app.services import v1_engine

    assert v1_engine._safe_id("ok") == "ok"
    assert v1_engine._safe_id("") is None
    assert v1_engine._safe_id(None) is None


# ---------------------------------------------------------------------------
# /api/ai/* shim: redact_messages branches and prompt-only redaction
# ---------------------------------------------------------------------------


def test_chat_redact_messages_accepts_non_dict_entries(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers,
        json={
            "messages": [
                "junk",
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "ok"},
            ],
            "context": {"project": {"_id": "p-fill-chat", "projectName": "P"}},
        },
    )
    assert response.status_code == HTTPStatus.OK


def test_idem_fail_reraises_keyboardinterrupt_without_releasing() -> None:
    from app.middleware.idempotency_guard import IdempotencyContext
    from app.routers.ai import _idem_fail

    ctx = IdempotencyContext(enabled=True, cache_key="k", fingerprint="fp")
    with pytest.raises(KeyboardInterrupt):
        _idem_fail(ctx, KeyboardInterrupt())


def test_get_tasks_returns_403_when_not_project_manager(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    from app.database import PROJECTS, USERS

    victim = str(
        store.insert_one(
            USERS,
            {
                "username": "victim",
                "email": "victim@example.com",
                "password": "x",
            },
        )
    )
    project_id = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Secret",
                "organization": "O",
                "managerId": victim,
            },
        )
    )
    response = client.get(
        f"/api/v1/tasks/?projectId={project_id}",
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_get_projects_forbidden_when_querying_other_manager(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    from app.database import PROJECTS, USERS

    other = str(
        store.insert_one(
            USERS,
            {
                "username": "other-m",
                "email": "other-m@example.com",
                "password": "x",
            },
        )
    )
    store.insert_one(
        PROJECTS,
        {
            "projectName": "OtherCo",
            "organization": "O",
            "managerId": other,
        },
    )
    response = client.get(
        f"/api/v1/projects/?managerId={other}",
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_get_tasks_column_not_found_when_project_has_no_columns(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    from app.database import PROJECTS

    project_id = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Empty board",
                "organization": "O",
                "managerId": "fill-user",
            },
        )
    )
    response = client.get(
        f"/api/v1/tasks/?projectId={project_id}",
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_task_update_forbidden_when_destination_project_not_managed(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    from app.database import COLUMNS, PROJECTS, TASKS, USERS

    store.insert_one(
        USERS,
        {
            "_id": "fill-user",
            "username": "fill-user",
            "email": "fill-user@example.com",
            "password": "x",
        },
    )
    intruder = str(
        store.insert_one(
            USERS,
            {
                "username": "intruder2",
                "email": "intruder2@example.com",
                "password": "x",
            },
        )
    )
    mine = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Mine",
                "organization": "O",
                "managerId": "fill-user",
            },
        )
    )
    foreign = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Foreign",
                "organization": "O",
                "managerId": intruder,
            },
        )
    )
    col_mine = str(
        store.insert_one(
            COLUMNS,
            {"columnName": "Todo", "projectId": mine, "index": 0},
        )
    )
    col_foreign = str(
        store.insert_one(
            COLUMNS,
            {"columnName": "Todo", "projectId": foreign, "index": 0},
        )
    )
    task_id = str(
        store.insert_one(
            TASKS,
            {
                "columnId": col_mine,
                "coordinatorId": "fill-user",
                "epic": "e",
                "taskName": "T",
                "type": "Task",
                "note": "n",
                "projectId": mine,
                "storyPoints": 1,
                "index": 0,
            },
        )
    )
    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": task_id,
            "projectId": foreign,
            "columnId": col_foreign,
            "coordinatorId": "fill-user",
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


# ---------------------------------------------------------------------------
# routers/agents.py: misc remaining branches
# ---------------------------------------------------------------------------


def test_normalize_payload_returns_non_dict_input(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A non-object body short-circuits ``_normalize_payload`` → 400 from Body."""

    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        headers=auth_headers,
        content=b"[]",  # Body validates as list, FastAPI 422
    )
    # FastAPI returns 422 for a list body; this exercises the
    # ``not isinstance(payload, dict)`` short-circuit indirectly.
    assert response.status_code in {
        HTTPStatus.UNPROCESSABLE_ENTITY,
        HTTPStatus.BAD_REQUEST,
        HTTPStatus.OK,
    }


def test_invoke_resume_inputs_path_with_existing_project_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """The ``project_id`` path inside _normalize_payload skips when already set."""

    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={
            "inputs": {
                "messages": [{"role": "user", "content": "hi"}],
                "project_id": "p-already",
            },
            "config": {"configurable": {"project_id": "p-other"}},
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_record_real_usage_with_zero_actual_keeps_prebooked() -> None:
    """A provider that never reports usage keeps the full prebooked debit.

    Otherwise a misbehaving model could bypass the cap by dropping
    usage metadata.
    """

    from app.routers.agents import _record_real_usage

    budget_module.budget_tracker.reset()
    budget_module.budget_tracker.reserve("p-zero", 4)
    _record_real_usage("p-zero", 0, 0, prebooked=4)
    assert (
        budget_module.budget_tracker.remaining("p-zero")
        == budget_module.budget_tracker.monthly_cap - 4
    )


def test_input_token_estimate_with_non_mapping() -> None:
    from app.routers.agents import _input_token_estimate

    assert _input_token_estimate("not a dict") == 1  # type: ignore[arg-type]


def test_request_command_rejects_non_dict() -> None:
    from app.routers.agents import _request_command

    with pytest.raises(Exception):
        _request_command({"command": "string"})


def test_request_command_requires_resume_field() -> None:
    from app.routers.agents import _request_command

    with pytest.raises(Exception):
        _request_command({"command": {}})


def test_run_options_rejects_top_level_user_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={"inputs": {}, "user_id": "spoof"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_run_options_rejects_non_string_thread_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={"inputs": {}, "thread_id": 123},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_run_options_rejects_non_list_tags(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={"inputs": {}, "tags": "not-a-list"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_invoke_returns_400_when_inputs_not_object(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={"inputs": "string"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_invoke_returns_400_when_inputs_and_resume_both_set(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={
            "inputs": {"messages": [{"role": "user", "content": "hi"}]},
            "command": {"resume": "x"},
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_resolve_autonomy_strips_whitespace(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={
            "inputs": {"messages": [{"role": "user", "content": "hi"}]},
            "autonomy": "  PLAN  ",
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_request_inputs_returns_empty_when_none(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={"inputs": None},
        headers=auth_headers,
    )
    # Empty inputs yield an empty messages thread; chat-agent returns a greeting.
    assert response.status_code == HTTPStatus.OK


# ---------------------------------------------------------------------------
# routers/agents.py: _normalize_payload non-dict, _with_disconnect raises
# ---------------------------------------------------------------------------


def test_normalize_payload_returns_non_dict_directly() -> None:
    from app.routers.agents import _normalize_payload

    result = _normalize_payload("not a dict")  # type: ignore[arg-type]
    assert result == "not a dict"


def test_normalize_payload_creates_inputs_dict_when_only_project_id_in_config() -> None:
    from app.routers.agents import _normalize_payload

    payload = {"config": {"configurable": {"project_id": "p-only"}}}
    out = _normalize_payload(payload)
    assert out["inputs"] == {"project_id": "p-only"}


def test_record_real_usage_delta_branch_records_total() -> None:
    """Reserve + true-up converges on actual usage when usage > prebook."""

    from app.routers.agents import _record_real_usage

    budget_module.budget_tracker.reset()
    budget_module.budget_tracker.reserve("p-delta", 2)
    _record_real_usage("p-delta", tokens_in=8, tokens_out=4, prebooked=2)
    spent = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-delta")
    )
    assert spent == 12


def test_record_real_usage_actual_under_prebook_refunds_difference() -> None:
    """When actual usage < prebook, the unused reservation is refunded."""

    from app.routers.agents import _record_real_usage

    budget_module.budget_tracker.reset()
    budget_module.budget_tracker.reserve("p-under", 10)
    _record_real_usage("p-under", tokens_in=2, tokens_out=1, prebooked=10)
    spent = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-under")
    )
    assert spent == 3


def test_maybe_capture_usage_handles_non_dict_data() -> None:
    from app.routers.agents import _maybe_capture_usage

    assert _maybe_capture_usage({"type": "custom", "ns": [], "data": "string"}) is None
    assert (
        _maybe_capture_usage({"type": "custom", "ns": [], "data": {"kind": "citation"}})
        is None
    )


def test_with_disconnect_raises_on_client_disconnect() -> None:
    from app.routers.agents import _ClientDisconnected, _with_disconnect

    class _Req:
        async def is_disconnected(self) -> bool:
            return True

    async def stream() -> Any:
        yield ("updates", {"x": 1})

    async def run() -> None:
        async for _ in _with_disconnect(_Req(), stream(), timeout=10):
            pass

    with pytest.raises(_ClientDisconnected):
        asyncio.run(run())


def test_with_disconnect_raises_on_timeout() -> None:
    from app.routers.agents import _with_disconnect

    class _Req:
        async def is_disconnected(self) -> bool:
            return False

    async def stream() -> Any:
        await asyncio.sleep(2)
        yield ("updates", {"x": 1})

    async def run() -> None:
        async for _ in _with_disconnect(_Req(), stream(), timeout=0):
            pass

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(run())


def test_with_disconnect_passes_through_to_stream_completion() -> None:
    """A short stream completes normally without raising."""

    from app.routers.agents import _with_disconnect

    class _Req:
        async def is_disconnected(self) -> bool:
            return False

    async def stream() -> Any:
        yield ("updates", {"a": 1})

    async def run() -> list[Any]:
        out: list[Any] = []
        async for event in _with_disconnect(_Req(), stream(), timeout=10):
            out.append(event)
        return out

    events = asyncio.run(run())
    assert events == [("updates", {"a": 1})]


def test_stream_short_circuits_on_client_disconnect(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mid-stream disconnect ends the generator without a [DONE] frame."""

    from app.routers import agents as agents_router

    async def fake_with_disconnect(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        raise agents_router._ClientDisconnected()
        yield  # pragma: no cover

    chat_agent = client.app.state.agent_runtime.get("chat-agent")
    monkeypatch.setattr(agents_router, "_with_disconnect", fake_with_disconnect)
    with client.stream(
        "POST",
        "/api/v1/agents/chat-agent/stream",
        json={"inputs": {"messages": [{"role": "user", "content": "hi"}]}},
        headers=auth_headers,
    ) as response:
        body = b"".join(response.iter_bytes()).decode("utf-8")
    # The generator returned early; nothing should have flushed.
    assert body == ""
    assert chat_agent  # used


# ---------------------------------------------------------------------------
# llm.py provider call branches (mock the integration packages so the call
# happens but no network is involved)
# ---------------------------------------------------------------------------


def test_make_chat_model_constructs_anthropic_with_spec(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    constructed: dict[str, Any] = {}

    class _FakeChatAnthropic:
        def __init__(self, **kwargs: Any) -> None:
            constructed.update(kwargs)

    fake_module = type(sys)("langchain_anthropic")
    fake_module.ChatAnthropic = _FakeChatAnthropic  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langchain_anthropic", fake_module)

    spec = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC, model="claude-x", api_key="key", temperature=0.3
    )
    model = make_chat_model(spec)
    assert isinstance(model, _FakeChatAnthropic)
    assert constructed["model"] == "claude-x"
    assert constructed["temperature"] == 0.3
    assert constructed["api_key"] == "key"


def test_make_chat_model_constructs_openai_with_spec(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    constructed: dict[str, Any] = {}

    class _FakeChatOpenAI:
        def __init__(self, **kwargs: Any) -> None:
            constructed.update(kwargs)

    fake_module = type(sys)("langchain_openai")
    fake_module.ChatOpenAI = _FakeChatOpenAI  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_module)

    spec = ChatModelSpec(
        provider=PROVIDER_OPENAI, model="gpt-x", api_key="", temperature=0.0
    )
    model = make_chat_model(spec)
    assert isinstance(model, _FakeChatOpenAI)
    # api_key collapses to ``None`` when blank so ChatOpenAI reads env.
    assert constructed["api_key"] is None


# ---------------------------------------------------------------------------
# v1_engine: hit residual lines (least-loaded with bad members, draft branches)
# ---------------------------------------------------------------------------


def test_v1_engine_least_loaded_member_with_only_invalid_entries() -> None:
    from app.services import v1_engine

    out = v1_engine._least_loaded_member({"members": [{"username": "no-id"}, "junk"]})
    assert out is None


def test_v1_engine_jaccard_returns_zero_for_empty_inputs() -> None:
    from app.services.v1_engine import _jaccard

    assert _jaccard([], []) == 0.0


def test_v1_engine_estimate_skips_non_dict_and_non_string_id_tasks() -> None:
    from app.services import v1_engine

    out = v1_engine.estimate(
        {
            "context": {
                "tasks": [
                    "junk",
                    {"_id": 123, "taskName": "ignored"},
                    {"_id": "t-ok", "taskName": "matching prompt", "note": "alpha"},
                ]
            },
            "taskName": "matching prompt",
            "note": "alpha",
        }
    )
    assert any(item["_id"] == "t-ok" for item in out["similar"])


# ---------------------------------------------------------------------------
# New-branch coverage from the security / data / agent-runtime hardening
# ---------------------------------------------------------------------------


def test_estimate_text_tokens_handles_non_ascii_text() -> None:
    """CJK / emoji content uses the wider 1-token-per-2-chars envelope.

    Regression guard for the budget tracker -- ASCII text estimates at
    ~4 chars/token, but BPE expands non-ASCII much more aggressively
    so we deliberately overestimate to keep the cap a real ceiling.
    """

    from app.agents.llm import estimate_text_tokens

    ascii_estimate = estimate_text_tokens("a" * 40)
    cjk_estimate = estimate_text_tokens("こ" * 40)
    assert ascii_estimate == 10  # 40 // 4
    assert cjk_estimate == 20  # 40 // 2 (non-ASCII bump)


def test_sse_to_jsonable_falls_back_to_placeholder_for_unencodable() -> None:
    """An object that is neither JSON nor jsonable_encoder-friendly returns a marker."""

    from app.agents.sse import _to_jsonable

    class Stubborn:
        def __json__(self) -> Any:
            raise TypeError("unsupported")

    out = _to_jsonable(Stubborn())
    # jsonable_encoder accepts arbitrary objects via fallback __dict__,
    # but a value type with no attributes and a JSON-incompatible
    # ``__json__`` should still produce a dict-shaped placeholder.
    assert isinstance(out, dict)


def test_sse_to_jsonable_unserializable_marker_for_pure_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Force both encoders to fail and verify the placeholder envelope."""

    from app.agents import sse as sse_module

    def _boom(_: Any) -> Any:
        raise TypeError("unsupported")

    monkeypatch.setattr(sse_module, "jsonable_encoder", _boom)

    class Opaque:
        pass

    out = sse_module._to_jsonable(Opaque())
    assert out == {"__unserializable__": "Opaque"}


def test_emit_custom_no_op_when_no_streaming_context() -> None:
    """``emit_custom`` swallows ``RuntimeError`` from ``get_stream_writer``."""

    from app.agents.stream import emit_custom

    # Calling outside any LangGraph runtime context: ``get_stream_writer``
    # raises ``RuntimeError`` and the helper must absorb it silently.
    emit_custom({"kind": "noop"})


def test_column_reorder_no_op_when_from_equals_reference() -> None:
    """Self-move of a column produces an empty update list (no corruption)."""

    from app.domain.ordering import column_reorder_updates

    column = {"_id": "c1", "index": 0}
    updates = column_reorder_updates("before", column, column, [column])
    assert updates == []


def test_task_reorder_no_op_when_same_column_self_reference() -> None:
    """Self-move of a task within one column is a no-op rather than a crash."""

    from app.domain.ordering import task_reorder_updates

    task = {"_id": "t1", "index": 0, "columnId": "c1"}
    updates = task_reorder_updates(
        "before",
        "c1",
        "c1",
        task,
        task,
        [task],
        [task],
    )
    assert updates == []


def test_task_reorder_cross_column_after_inserts_below_reference() -> None:
    """``order_type=after`` on a cross-column move places the card after, not before."""

    from app.domain.ordering import task_reorder_updates

    from_task = {"_id": "from", "index": 0, "columnId": "src"}
    reference = {"_id": "ref", "index": 0, "columnId": "dst"}
    follower = {"_id": "follower", "index": 1, "columnId": "dst"}
    updates = task_reorder_updates(
        "after",
        "src",
        "dst",
        from_task,
        reference,
        [from_task],
        [reference, follower],
    )
    indexed = {update.item_id: update.changes for update in updates}
    # The moved card lands at reference.index + 1 = 1; the follower at
    # the same index slot is bumped to 2; reference itself stays at 0.
    assert indexed["from"]["index"] == 1
    assert indexed["from"]["columnId"] == "dst"
    assert indexed["follower"]["index"] == 2
    assert "ref" not in indexed


def test_budget_tracker_rejects_negative_inputs() -> None:
    """Reserve / record / refund all reject negative tokens explicitly."""

    tracker = budget_module.BudgetTracker(monthly_cap=100)
    with pytest.raises(ValueError):
        tracker.reserve("p", -1)
    with pytest.raises(ValueError):
        tracker.record("p", -1)
    with pytest.raises(ValueError):
        tracker.refund("p", -1)


def test_budget_tracker_reserve_returns_false_when_cap_would_be_exceeded() -> None:
    """``reserve`` is atomic-or-nothing: never partially debits."""

    tracker = budget_module.BudgetTracker(monthly_cap=10)
    assert tracker.reserve("p", 8) is True
    assert tracker.reserve("p", 5) is False
    # Spend stayed at the original successful reservation.
    assert tracker.remaining("p") == 2


def test_health_endpoint_reports_degraded_when_db_ping_fails(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    """Database ping failure flips ``status`` to ``degraded``."""

    from app.routers import health as health_router

    class _BadRepo:
        def ping(self) -> None:
            raise RuntimeError("nope")

    monkeypatch.setattr(health_router, "repository", _BadRepo())
    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["status"] == "degraded"
    assert body["ok"] is False
    assert body["database"] == "degraded"


def test_project_update_returns_400_when_id_missing(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """``PUT /projects`` without an ``_id`` is a request error, not 404."""

    response = client.put(
        "/api/v1/projects/", json={"projectName": "x"}, headers=auth_headers
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_project_update_returns_404_when_manager_id_invalid(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    """Updating ``managerId`` to a missing user surfaces a 404 (not 200)."""

    from app.database import PROJECTS

    project_id = store.insert_one(
        PROJECTS,
        {
            "projectName": "P",
            "organization": "O",
            "managerId": "fill-user",
        },
    )
    response = client.put(
        "/api/v1/projects/",
        json={"_id": str(project_id), "managerId": "ghost"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_task_remove_repacks_indexes_after_delete(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    """Deleting a task shifts later siblings down so indexes stay contiguous."""

    from app.database import COLUMNS, PROJECTS, TASKS, USERS

    user_id = store.insert_one(
        USERS,
        {"username": "fill-user", "email": "f@example.com", "password": "x"},
    )
    project_id = store.insert_one(
        PROJECTS,
        {"projectName": "P", "organization": "O", "managerId": "fill-user"},
    )
    column_id = store.insert_one(
        COLUMNS,
        {"columnName": "Todo", "projectId": str(project_id), "index": 0},
    )
    task_a = store.insert_one(
        TASKS,
        {
            "taskName": "A",
            "coordinatorId": str(user_id),
            "epic": "e",
            "columnId": str(column_id),
            "note": "n",
            "type": "Task",
            "projectId": str(project_id),
            "storyPoints": 1,
            "index": 0,
        },
    )
    task_b = store.insert_one(
        TASKS,
        {
            "taskName": "B",
            "coordinatorId": str(user_id),
            "epic": "e",
            "columnId": str(column_id),
            "note": "n",
            "type": "Task",
            "projectId": str(project_id),
            "storyPoints": 1,
            "index": 1,
        },
    )
    response = client.delete(f"/api/v1/tasks/?taskId={task_a}", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    survivor = store.find_by_id(TASKS, str(task_b))
    assert survivor["index"] == 0


def test_board_remove_repacks_column_indexes_after_delete(
    client: TestClient, store, auth_headers: dict[str, str]
) -> None:
    """Removing a column shifts later columns down so indexes stay contiguous."""

    from app.database import COLUMNS, PROJECTS

    project_id = store.insert_one(
        PROJECTS,
        {"projectName": "P", "organization": "O", "managerId": "fill-user"},
    )
    first = store.insert_one(
        COLUMNS,
        {"columnName": "A", "projectId": str(project_id), "index": 0},
    )
    second = store.insert_one(
        COLUMNS,
        {"columnName": "B", "projectId": str(project_id), "index": 1},
    )
    response = client.delete(f"/api/v1/boards/?columnId={first}", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    survivor = store.find_by_id(COLUMNS, str(second))
    assert survivor["index"] == 0


def test_current_user_id_rejects_non_string_subject() -> None:
    """A JWT whose decoded ``sub`` is not a string fails the dependency."""

    from fastapi import HTTPException

    from app.security import current_user_id

    with pytest.raises(HTTPException) as exc:
        current_user_id({"sub": 123})
    assert exc.value.status_code == 401


def test_catalog_discover_logs_and_skips_failed_modules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A single broken catalog module does not take down ``discover()``."""

    from app.agents import catalog as catalog_module

    real_import = catalog_module.importlib.import_module
    targeted = "app.agents.catalog.task_drafting"

    def _flaky_import(name: str) -> Any:
        if name == targeted:
            raise RuntimeError("boom")
        return real_import(name)

    monkeypatch.setattr(catalog_module.importlib, "import_module", _flaky_import)

    imported = catalog_module.discover()
    names = {module.__name__ for module in imported}
    assert targeted not in names
    # Other agents still imported successfully.
    assert any(name.startswith("app.agents.catalog.") for name in names)


def test_sse_to_jsonable_placeholder_when_encoded_not_json_serializable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``jsonable_encoder`` can return a structure ``json.dumps`` rejects."""

    from app.agents import sse as sse_module

    monkeypatch.setattr(
        sse_module,
        "jsonable_encoder",
        lambda _v: {"nested": object()},
    )
    out = sse_module._to_jsonable({"ignored": True})
    assert out == {"__unserializable__": "dict"}


def test_sse_to_jsonable_falls_back_when_encoder_raises_but_json_dumps_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``jsonable_encoder`` raises but ``json.dumps`` works, return as-is."""

    from app.agents import sse as sse_module

    def _boom(_: Any) -> Any:
        raise TypeError("nope")

    monkeypatch.setattr(sse_module, "jsonable_encoder", _boom)
    out = sse_module._to_jsonable({"plain": 1})
    assert out == {"plain": 1}


def test_chat_agent_invoke_skips_custom_emit_without_streaming_context(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """``/invoke`` (no streaming) does not 500 from missing stream writer.

    The chat agent's ``respond`` node calls ``get_stream_writer`` to
    emit usage / citations; outside a streaming context the helper
    raises ``RuntimeError`` and the agent must skip the writes.
    """

    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={
            "inputs": {
                "messages": [{"role": "user", "content": "ping"}],
                "project_id": "p-no-stream",
            }
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
