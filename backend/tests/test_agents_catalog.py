"""Tests for the Board Copilot v2.1 agent catalog (PRD §5A)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.board_brief import BoardBriefAgent
from app.agents.catalog.chat import ChatAgent, _last_user_text
from app.agents.catalog.search import SearchAgent
from app.agents.catalog.task_drafting import TaskDraftingAgent, _draft_from_prompt
from app.agents.catalog.task_estimation import (
    TaskEstimationAgent,
    _estimate_for,
    _readiness,
)
from app.agents.catalog.triage import TriageAgent, _nudges_for
from app.agents.llm import make_stub_chat_model
from app.agents.registry import registry as global_registry


_AGENT_CLASSES = (
    BoardBriefAgent,
    TaskDraftingAgent,
    TaskEstimationAgent,
    ChatAgent,
    TriageAgent,
    SearchAgent,
)


def _ensure_catalog_registered() -> None:
    """Register one fresh instance of each catalog agent.

    Re-importing the catalog modules would not re-run their top-level
    ``registry.register(...)`` calls (Python caches modules), so we register
    explicitly using the already-imported classes -- this keeps ``isinstance``
    checks valid in the assertions below.
    """

    for cls in _AGENT_CLASSES:
        if cls.metadata.name not in global_registry:
            global_registry.register(cls())


@pytest.fixture(autouse=True)
def reset_registry() -> Any:
    """Make every test start with the same in-memory catalog registry."""

    global_registry.clear()
    _ensure_catalog_registered()
    yield
    global_registry.clear()
    _ensure_catalog_registered()


def _persistence() -> tuple[InMemorySaver, InMemoryStore]:
    return InMemorySaver(), InMemoryStore()


def _drive(
    graph: Any, inputs: dict[str, Any], resumes: list[Any], thread_id: str
) -> dict[str, Any]:
    """Run the graph through any number of interrupts using ``Command(resume=...)``."""

    cfg = {"configurable": {"thread_id": thread_id}}

    async def run() -> dict[str, Any]:
        result = await graph.ainvoke(inputs, config=cfg)
        for resume in resumes:
            result = await graph.ainvoke(Command(resume=resume), config=cfg)
        return result

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# discovery / registration
# ---------------------------------------------------------------------------


def test_discover_registers_all_v21_agents() -> None:
    names = set(global_registry.names())
    assert {
        "board-brief-agent",
        "task-drafting-agent",
        "task-estimation-agent",
        "chat-agent",
        "triage-agent",
    } <= names


# ---------------------------------------------------------------------------
# board-brief-agent
# ---------------------------------------------------------------------------


def test_board_brief_metadata() -> None:
    agent = global_registry.get("board-brief-agent")
    assert isinstance(agent, BoardBriefAgent)
    assert agent.metadata.recursion_limit == 6
    assert agent.metadata.version == "1.0.0"
    assert agent.metadata.description


_VALID_BRIEF_STRENGTHS = {"strong", "moderate", "low", "none"}


def test_board_brief_runs_end_to_end() -> None:
    agent = global_registry.get("board-brief-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {
        "project_id": "p1",
        "columns": [
            {"id": "c1", "name": "Todo"},
            {"id": "c2", "name": "Done"},
        ],
        "tasks": [
            {"id": "t1", "columnId": "c1", "type": "feature"},
            {"id": "t2", "column": "Done", "type": "feature"},
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="brief-1")
    brief = final["brief"]
    # IBoardBrief shape: headline, counts, largestUnstarted, unowned, workload, recommendation
    assert brief["headline"]
    assert isinstance(brief["counts"], list)
    assert isinstance(brief["largestUnstarted"], list)
    assert isinstance(brief["unowned"], list)
    assert isinstance(brief["workload"], list)
    assert brief["recommendation"]
    assert any(message.content for message in final["messages"])


def test_board_brief_message_includes_recommendation_detail() -> None:
    """The final AIMessage and suggestion payload must carry ``recommendationDetail``."""
    agent = global_registry.get("board-brief-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {
        "project_id": "p1",
        "columns": [{"id": "c1", "name": "Todo"}, {"id": "c2", "name": "Done"}],
        "tasks": [
            {"id": "t1", "taskName": "Fix crash", "columnId": "c1", "type": "bug"},
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="brief-rd-1")
    # The AIMessage content must include recommendationDetail.
    messages = final["messages"]
    assert messages
    payload = json.loads(messages[-1].content)
    assert "recommendationDetail" in payload, (
        "AIMessage content must include recommendationDetail"
    )
    rd = payload["recommendationDetail"]
    assert rd["strength"] in _VALID_BRIEF_STRENGTHS
    assert isinstance(rd["text"], str)
    assert isinstance(rd["basis"], str)
    assert isinstance(rd["sources"], list)


def test_board_brief_strength_strong_when_unowned_bug() -> None:
    """An unowned bug task must yield ``recommendationDetail.strength == "strong"``."""
    agent = global_registry.get("board-brief-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {
        "project_id": "p1",
        "columns": [{"id": "c1", "name": "Todo"}],
        "tasks": [
            # Bug with no coordinatorId → unowned_bug signal → "strong"
            {"id": "bug-1", "taskName": "Crash", "columnId": "c1", "type": "bug"},
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="brief-strong-1")
    payload = json.loads(final["messages"][-1].content)
    assert payload["recommendationDetail"]["strength"] == "strong"


def test_board_brief_strength_none_when_no_signals() -> None:
    """A clean board with no drift signals must yield ``"none"``."""
    agent = global_registry.get("board-brief-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {
        "project_id": "p1",
        "columns": [{"id": "c1", "name": "Todo"}],
        "tasks": [
            # Owned feature task, no stale date → no signals
            {
                "id": "t-ok",
                "taskName": "Build feature",
                "columnId": "c1",
                "type": "feature",
                "coordinatorId": "u1",
            }
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="brief-none-1")
    payload = json.loads(final["messages"][-1].content)
    assert payload["recommendationDetail"]["strength"] == "none"


# ---------------------------------------------------------------------------
# task-drafting-agent
# ---------------------------------------------------------------------------


def test_task_drafting_metadata() -> None:
    agent = global_registry.get("task-drafting-agent")
    assert isinstance(agent, TaskDraftingAgent)
    assert agent.metadata.recursion_limit == 12


def test_task_drafting_single_draft() -> None:
    agent = global_registry.get("task-drafting-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {"project_id": "p1", "columns": [], "tasks": []}
    similar = [{"id": "t1", "text": "build auth"}]
    final = _drive(
        graph,
        {"project_id": "p1", "prompt": "build SSO"},
        [snapshot, similar],
        thread_id="draft-1",
    )
    draft = final["draft"]
    assert draft["taskName"] == "build SSO"
    assert draft["type"] == "feature"


def test_task_drafting_breakdown_axis_emits_items() -> None:
    agent = global_registry.get("task-drafting-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {"project_id": "p1", "columns": [], "tasks": []}
    similar: list[dict[str, Any]] = []
    final = _drive(
        graph,
        {"project_id": "p1", "prompt": "build auth", "breakdown_axis": "frontend"},
        [snapshot, similar],
        thread_id="draft-2",
    )
    draft = final["draft"]
    assert draft["axis"] == "frontend"
    assert len(draft["items"]) == 3


def test_task_drafting_helper_builds_default_draft() -> None:
    draft = _draft_from_prompt("hello")
    assert draft["taskName"] == "hello"
    assert draft["type"] == "feature"
    assert draft["storyPoints"] == 3


# ---------------------------------------------------------------------------
# task-estimation-agent
# ---------------------------------------------------------------------------


def test_task_estimation_metadata() -> None:
    agent = global_registry.get("task-estimation-agent")
    assert isinstance(agent, TaskEstimationAgent)
    assert agent.metadata.recursion_limit == 8


def test_task_estimation_runs_with_neighbours() -> None:
    agent = global_registry.get("task-estimation-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    similar = [{"id": "n1", "text": "implement login form"}]
    final = _drive(
        graph,
        {
            "project_id": "p1",
            "task_draft": {"taskName": "implement signup", "note": "needs tests"},
        },
        [similar],
        thread_id="est-1",
    )
    assert final["estimate"]["confidence"] == "moderate"
    assert final["estimate"]["storyPoints"] in (1, 2, 3, 5, 8, 13)
    assert final["readiness"]["ready"] is False
    assert any(i["field"] == "coordinatorId" for i in final["readiness"]["issues"])
    payload = json.loads(final["messages"][-1].content)
    assert "estimate" in payload and "readiness" in payload


def test_task_estimation_runs_without_neighbours() -> None:
    agent = global_registry.get("task-estimation-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    final = _drive(
        graph,
        {
            "project_id": "p1",
            "task_draft": {
                "taskName": "x",
                "note": "y",
                "coordinatorId": "u9",
            },
        },
        [[]],
        thread_id="est-2",
    )
    assert final["estimate"]["confidence"] == "low"
    assert final["embedding_neighbors"] == []
    assert final["readiness"]["ready"] is True


def test_task_estimation_helpers() -> None:
    points = _estimate_for({"taskName": "x" * 200, "note": "y"}, [{"id": "n1"}])
    assert points >= 1
    readiness = _readiness({})
    assert readiness["ready"] is False
    issue_fields = {i["field"] for i in readiness["issues"]}
    assert "taskName" in issue_fields
    assert "note" in issue_fields
    assert "coordinatorId" in issue_fields
    full = _readiness({"taskName": "x", "note": "y", "coordinatorId": "u1"})
    assert full["ready"] is True
    assert "Required" in full["rationale"]


def test_readiness_issues_shape_flows_into_polish_readiness() -> None:
    """_readiness() now emits the ``issues`` shape that polish_readiness expects.

    This exercises the previously-broken path: when the deterministic helper
    returned ``missing`` instead of ``issues``, polish_readiness short-circuited
    on ``if not issues: return deterministic, 0, 0`` and the LLM was never
    called.  Confirm the shape is compatible and the merge succeeds.
    """
    from app.agents.catalog.task_estimation import (
        ReadinessIssuePolish,
        ReadinessPolish,
        polish_readiness,
    )
    from langchain_core.messages import AIMessage

    deterministic = _readiness({"taskName": "fix-login"})
    # The issues list must be non-empty so polish path is entered.
    assert deterministic["issues"], "expected at least one issue from _readiness()"

    # Build a minimal stub model whose with_structured_output returns a
    # ReadinessPolish -- validates that the merge loop runs without error.
    parsed = ReadinessPolish(
        issues=[
            ReadinessIssuePolish(
                field="note",
                message="Add acceptance criteria so QA can verify.",
                suggestion="List the expected outcomes.",
            )
        ]
    )
    raw = AIMessage(
        content="",
        usage_metadata={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
    )

    class _FakeRunnable:
        def invoke(self, _messages: Any, **__: Any) -> Any:
            return {"raw": raw, "parsed": parsed, "parsing_error": None}

    class _FakeModel:
        def with_structured_output(self, _schema: Any, **__: Any) -> Any:
            return _FakeRunnable()

    # Patch is_stub_model so the stub-model short-circuit does not fire.
    import app.agents.catalog.task_estimation as te_mod

    original = te_mod.is_stub_model
    te_mod.is_stub_model = lambda _m: False
    try:
        polished, tin, tout = polish_readiness(_FakeModel(), deterministic, {"taskName": "fix-login"})
    finally:
        te_mod.is_stub_model = original

    by_field = {i["field"]: i for i in polished["issues"]}
    assert by_field["note"]["message"] == "Add acceptance criteria so QA can verify."
    assert by_field["coordinatorId"]["severity"] == "error"
    assert (tin, tout) == (3, 2)


# ---------------------------------------------------------------------------
# chat-agent
# ---------------------------------------------------------------------------


def test_chat_metadata() -> None:
    agent = global_registry.get("chat-agent")
    assert isinstance(agent, ChatAgent)
    assert agent.metadata.recursion_limit == 15


def test_chat_replies_with_user_text_and_supports_multi_turn() -> None:
    agent = global_registry.get("chat-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    cfg = {"configurable": {"thread_id": "chat-1"}}

    async def run() -> tuple[dict[str, Any], dict[str, Any]]:
        first = await graph.ainvoke(
            {
                "project_id": "p1",
                "messages": [HumanMessage(content="hello")],
            },
            config=cfg,
        )
        second = await graph.ainvoke(
            {
                "messages": [HumanMessage(content="follow up")],
            },
            config=cfg,
        )
        return first, second

    first, second = asyncio.run(run())
    assert any(
        "hello" in (m.content or "") for m in first["messages"] if hasattr(m, "content")
    )
    # Multi-turn keeps all messages thanks to the add_messages reducer.
    assert len(second["messages"]) >= 4


def test_chat_handles_empty_history() -> None:
    agent = global_registry.get("chat-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    cfg = {"configurable": {"thread_id": "chat-empty"}}

    async def run() -> dict[str, Any]:
        return await graph.ainvoke({}, config=cfg)

    final = asyncio.run(run())
    assert any("How can I help" in (m.content or "") for m in final["messages"])


def test_chat_last_user_text_helpers() -> None:
    # Empty / missing messages.
    assert _last_user_text({}) == ""

    # When the most recent message has non-string content the helper falls back
    # to an earlier string-content message.
    state = {
        "messages": [
            HumanMessage(content="abc"),
            HumanMessage(content=["a", "b"]),
        ]
    }
    assert _last_user_text(state) == "abc"

    # Direct trailing string-content message.
    state2 = {"messages": [HumanMessage(content="hello")]}
    assert _last_user_text(state2) == "hello"

    # Only non-string content -> falls through and returns "".
    state3 = {"messages": [HumanMessage(content=["only", "list"])]}
    assert _last_user_text(state3) == ""


# ---------------------------------------------------------------------------
# triage-agent
# ---------------------------------------------------------------------------


def test_triage_metadata() -> None:
    agent = global_registry.get("triage-agent")
    assert isinstance(agent, TriageAgent)
    assert agent.metadata.recursion_limit == 6


def test_triage_runs_end_to_end() -> None:
    agent = global_registry.get("triage-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {
        "columns": [{"id": "c1", "name": "Todo"}],
        "tasks": [
            {"id": "bug-1", "columnId": "c1", "type": "bug"},
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="triage-1")
    nudges = final["nudges"]
    assert nudges
    assert nudges[0]["type"] == "unowned_bug"
    assert nudges[0]["severity"] == "critical"
    assert json.loads(final["messages"][-1].content) == nudges


def test_triage_no_signals_emits_empty_nudges() -> None:
    nudges = _nudges_for({"signals": [], "severity": "info"})
    assert nudges == []


def test_triage_unknown_signal_type_uses_default_title() -> None:
    nudges = _nudges_for(
        {
            "signals": [{"type": "mystery"}],
            "severity": "warn",
        }
    )
    assert nudges[0]["title"] == "Triage"


# ---------------------------------------------------------------------------
# llm stub
# ---------------------------------------------------------------------------


def test_make_stub_chat_model_emits_purpose_payload() -> None:
    model = make_stub_chat_model(purpose="board-brief")
    response = model.invoke("hello")
    payload = json.loads(response.content)
    assert payload == {"purpose": "board-brief", "result": "ok"}


def test_make_stub_chat_model_default_purpose() -> None:
    model = make_stub_chat_model()
    response = model.invoke("anything")
    payload = json.loads(response.content)
    assert payload["purpose"] == "stub"
