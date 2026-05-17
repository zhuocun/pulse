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


_VALID_BRIEF_STRENGTHS = {"strong", "moderate", "none"}


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


def test_task_drafting_unwraps_similar_envelope() -> None:
    """FE may return the schema-conformant ``{"similar": [...]}`` envelope
    instead of a raw list; the agent must unwrap it before downstream
    nodes consume the items as ``{id, text}`` dicts."""
    agent = global_registry.get("task-drafting-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    snapshot = {"project_id": "p1", "columns": [], "tasks": []}
    similar_envelope = {"similar": [{"id": "t1", "text": "build auth"}]}
    final = _drive(
        graph,
        {"project_id": "p1", "prompt": "build SSO"},
        [snapshot, similar_envelope],
        thread_id="draft-envelope-1",
    )
    assert final["similar_tasks"] == [{"id": "t1", "text": "build auth"}]
    assert final["draft"]["taskName"] == "build SSO"


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


def test_task_estimation_unwraps_similar_envelope() -> None:
    """Same envelope-unwrap contract as task-drafting: ``{"similar": [...]}``
    from the FE must be flattened to a list of ``{id, text}`` items."""
    agent = global_registry.get("task-estimation-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    similar_envelope = {
        "similar": [{"id": "n1", "text": "implement login form"}]
    }
    final = _drive(
        graph,
        {
            "project_id": "p1",
            "task_draft": {"taskName": "implement signup", "note": "n"},
        },
        [similar_envelope],
        thread_id="est-envelope-1",
    )
    assert final["similar_tasks"] == [
        {"id": "n1", "text": "implement login form"}
    ]
    assert final["estimate"]["storyPoints"] in (1, 2, 3, 5, 8, 13)


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

        async def ainvoke(self, _messages: Any, **__: Any) -> Any:
            return {"raw": raw, "parsed": parsed, "parsing_error": None}

    class _FakeModel:
        def with_structured_output(self, _schema: Any, **__: Any) -> Any:
            return _FakeRunnable()

    # Patch is_stub_model so the stub-model short-circuit does not fire.
    import app.agents.catalog.task_estimation as te_mod

    original = te_mod.is_stub_model
    te_mod.is_stub_model = lambda _m: False
    try:
        polished, tin, tout = asyncio.run(
            polish_readiness(_FakeModel(), deterministic, {"taskName": "fix-login"})
        )
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
    assert agent.metadata.recursion_limit == 18


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
    assert nudges[0]["summary"] == "Triage"


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


# ---------------------------------------------------------------------------
# Defect 1: board-brief agent with id-keyed snapshot populates counts/unstarted/unowned
# ---------------------------------------------------------------------------


def test_board_brief_id_keyed_snapshot_populates_brief_fields() -> None:
    """board-brief agent must produce non-empty counts with FE-style id-keyed snapshots.

    The v1_engine uses ``col.get("_id")``; without normalisation (Defect 1)
    counts/largestUnstarted/unowned are always empty lists.  This test
    supplies a snapshot with ``id`` keys only and asserts the brief includes
    a non-empty ``counts`` array AND at least one of ``largestUnstarted`` or
    ``unowned`` is populated.
    """
    agent = global_registry.get("board-brief-agent")
    checkpointer, store = _persistence()
    graph = agent.compile(checkpointer=checkpointer, store=store)
    # ``id``-keyed snapshot (FE shape); no ``_id`` present.
    snapshot = {
        "project_id": "p1",
        "columns": [
            {"id": "col-todo", "name": "Todo"},
            {"id": "col-done", "name": "Done"},
        ],
        "tasks": [
            # Unstarted task in non-done column (no storyPoints = large proxy)
            {
                "id": "t-unstarted",
                "taskName": "Unstarted big task",
                "columnId": "col-todo",
                "type": "feature",
                "storyPoints": 13,
            },
            # Unowned task (no coordinatorId)
            {
                "id": "t-unowned",
                "taskName": "Unowned task",
                "columnId": "col-todo",
                "type": "feature",
            },
        ],
    }
    final = _drive(graph, {"project_id": "p1"}, [snapshot], thread_id="brief-id-keyed-1")
    brief = final["brief"]
    # counts must be non-empty when columns and tasks are present
    assert isinstance(brief["counts"], list), "counts must be a list"
    assert len(brief["counts"]) > 0, (
        "counts must be non-empty when id-keyed snapshot has columns; "
        "empty means _normalize_snapshot_for_v1_engine is not called"
    )
    # At least one of largestUnstarted or unowned must be populated
    has_unstarted = bool(brief.get("largestUnstarted"))
    has_unowned = bool(brief.get("unowned"))
    assert has_unstarted or has_unowned, (
        f"largestUnstarted={brief.get('largestUnstarted')!r} and "
        f"unowned={brief.get('unowned')!r} are both empty; "
        "snapshot normalization may not be working"
    )


# ---------------------------------------------------------------------------
# Defect 4: chat agent falls back gracefully when provider raises
# ---------------------------------------------------------------------------


def test_chat_agent_provider_error_falls_back_to_stub_reply() -> None:
    """chat-agent must complete with a non-empty assistant message when ainvoke raises.

    Verifies Defect 4: the real-model branch wraps the provider call in
    try/except and produces a safe AIMessage instead of propagating the
    exception.
    """
    import app.agents.catalog.chat as chat_mod

    agent = global_registry.get("chat-agent")
    checkpointer, store = _persistence()

    # Build a fake chat model whose ainvoke raises RuntimeError.
    class _FailingModel:
        async def ainvoke(self, _messages: Any, **__: Any) -> Any:
            raise RuntimeError("provider down")

        def bind_tools(self, _tools: Any) -> "_FailingModel":
            return self

    # Patch is_stub_model to return False so the real-model branch is entered.
    original_is_stub = chat_mod.is_stub_model
    chat_mod.is_stub_model = lambda _m: False
    # Inject the failing model via the public set_chat_model API.
    agent.set_chat_model(_FailingModel())

    try:
        graph = agent.compile(checkpointer=checkpointer, store=store)
        cfg = {"configurable": {"thread_id": "chat-error-1"}}

        async def run() -> dict[str, Any]:
            return await graph.ainvoke(
                {"project_id": "p1", "messages": [HumanMessage(content="hello")]},
                config=cfg,
            )

        final = asyncio.run(run())
    finally:
        chat_mod.is_stub_model = original_is_stub
        # Re-register a fresh agent instance so subsequent tests are not affected.
        global_registry.clear()
        _ensure_catalog_registered()

    messages = final.get("messages") or []
    assert messages, "must have at least one message in final state"
    last = messages[-1]
    assert last.content, "fallback reply must be non-empty"
    # Demo-state hardening: the silently-degraded reply must carry a visible
    # marker so the operator/audience can tell the live provider wasn't used.
    from app.agents.catalog.chat import _DEGRADED_REPLY_PREFIX

    assert _DEGRADED_REPLY_PREFIX in last.content


def test_chat_agent_propagates_cancellation_through_provider_call() -> None:
    """chat-agent must NOT swallow CancelledError from the provider call.

    The defensive try/except around ``bound.ainvoke`` re-raises
    ``asyncio.CancelledError`` and ``GeneratorExit`` so cooperative shutdown
    still propagates correctly.
    """
    import app.agents.catalog.chat as chat_mod

    agent = global_registry.get("chat-agent")
    checkpointer, store = _persistence()

    class _CancellingModel:
        async def ainvoke(self, _messages: Any, **__: Any) -> Any:
            raise asyncio.CancelledError("client disconnected")

        def bind_tools(self, _tools: Any) -> "_CancellingModel":
            return self

    original_is_stub = chat_mod.is_stub_model
    chat_mod.is_stub_model = lambda _m: False
    agent.set_chat_model(_CancellingModel())

    try:
        graph = agent.compile(checkpointer=checkpointer, store=store)
        cfg = {"configurable": {"thread_id": "chat-cancel-1"}}

        async def run() -> Any:
            return await graph.ainvoke(
                {"project_id": "p1", "messages": [HumanMessage(content="hi")]},
                config=cfg,
            )

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(run())
    finally:
        chat_mod.is_stub_model = original_is_stub
        global_registry.clear()
        _ensure_catalog_registered()


# ---------------------------------------------------------------------------
# Defect 1 (defensive): _normalize_snapshot_for_v1_engine handles edge shapes
# ---------------------------------------------------------------------------


def test_normalize_snapshot_skips_non_dict_items_and_preserves_existing_id() -> None:
    """``_add_id`` returns the item unchanged when it is not a dict, and when
    it already carries ``_id``. Covers both early-return branches in the
    helper that the happy-path test does not exercise.
    """
    from app.agents.catalog.board_brief import _normalize_snapshot_for_v1_engine

    snapshot = {
        "project_id": "p1",
        # Non-dict items in a list (defensive: helper must not crash)
        "columns": [None, "string-not-a-dict", {"id": "col-1", "name": "Todo"}],
        # Item that already has _id (helper must return it unchanged)
        "tasks": [
            {"_id": "t-pre", "taskName": "Pre-normalised"},
            {"id": "t-new", "taskName": "Needs id"},
        ],
        # Member item with both id and _id (no overwrite expected)
        "members": [{"id": "m-1", "_id": "m-1-existing", "name": "M"}],
    }
    out = _normalize_snapshot_for_v1_engine(snapshot)
    assert out["columns"][0] is None
    assert out["columns"][1] == "string-not-a-dict"
    assert out["columns"][2]["_id"] == "col-1"
    # Item that already had _id is unchanged (no double-add or overwrite).
    assert out["tasks"][0] == {"_id": "t-pre", "taskName": "Pre-normalised"}
    assert out["tasks"][1]["_id"] == "t-new"
    # Member with both id and _id is unchanged: existing _id wins.
    assert out["members"][0]["_id"] == "m-1-existing"


# ---------------------------------------------------------------------------
# _shared.py polish-merge helpers (extracted from per-agent _merge bodies)
# ---------------------------------------------------------------------------


def test_cap_polished_text_returns_fallback_for_non_string() -> None:
    from app.agents.catalog._shared import cap_polished_text

    assert cap_polished_text(None, max_chars=10, fallback="det") == "det"
    assert cap_polished_text(42, max_chars=10, fallback="det") == "det"


def test_cap_polished_text_first_line_and_strip_and_cap() -> None:
    from app.agents.catalog._shared import cap_polished_text

    assert (
        cap_polished_text("  hello world\nignored", max_chars=5, fallback="x")
        == "hello"
    )


def test_cap_polished_text_blank_returns_fallback() -> None:
    from app.agents.catalog._shared import cap_polished_text

    assert cap_polished_text("   ", max_chars=10, fallback="x") == "x"


def test_filter_to_allowed_ids_strips_unknown_and_non_string() -> None:
    from app.agents.catalog._shared import filter_to_allowed_ids

    assert filter_to_allowed_ids(["a", "b", "c", 7, None], {"a", "c"}) == ["a", "c"]


def test_filter_to_allowed_ids_non_list_returns_empty() -> None:
    from app.agents.catalog._shared import filter_to_allowed_ids

    assert filter_to_allowed_ids(None, {"a"}) == []
    assert filter_to_allowed_ids("not a list", {"a"}) == []


def test_merge_keyed_string_updates_handles_non_list_inputs() -> None:
    from app.agents.catalog._shared import merge_keyed_string_updates

    out = merge_keyed_string_updates(
        None,
        None,
        key_from_parsed=lambda x: x,
        key_from_deterministic=lambda x, _i: x,
        string_fields={"summary": 10},
    )
    assert out == []


def test_merge_keyed_string_updates_passes_through_non_dict_items() -> None:
    from app.agents.catalog._shared import merge_keyed_string_updates

    out = merge_keyed_string_updates(
        [],
        ["not-a-dict", {"id": "a", "summary": "x"}],
        key_from_parsed=lambda x: x,
        key_from_deterministic=lambda d, _i: d.get("id"),
        string_fields={"summary": 5},
    )
    assert out == ["not-a-dict", {"id": "a", "summary": "x"}]


def test_fetch_similar_node_short_circuits_when_pre_populated() -> None:
    """Returning ``{}`` when ``similar_tasks`` is already on state lets a
    JSON caller (e.g. the v1 ``/api/ai`` shim) pre-populate the field
    and skip the FE interrupt that the v2.1 SSE surface uses.  v2.1
    callers don't pre-populate so they still hit the interrupt branch.
    """

    from app.agents.catalog._shared import fetch_similar_node

    state = {"similar_tasks": [{"id": "t-1", "text": "neighbour"}]}
    assert fetch_similar_node(state) == {}


def test_search_fetch_candidates_short_circuits_when_pre_populated() -> None:
    """Same short-circuit contract as :func:`fetch_similar_node`, but
    inside the search-agent's own ``fetch_candidates`` closure.
    Exercised through the compiled graph because the closure is not
    importable directly.
    """

    agent = SearchAgent()
    graph = agent.build(checkpointer=None, store=None)
    # Pre-populate ``candidates``; the short-circuit branch returns
    # ``{}``, the ``rank`` node embeds the supplied candidates, and the
    # run completes without ever raising the FE interrupt.  ``rank`` is
    # an async node (it ``await``s the embeddings provider), so we use
    # ``ainvoke``.
    result = asyncio.run(
        graph.ainvoke(
            {
                "query": "ignored",
                "candidates": [{"id": "x-1", "text": "hello world"}],
            }
        )
    )
    assert "ranking" in result
    assert result["ranking"]["ids"] == ["x-1"]

