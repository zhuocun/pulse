"""chat-agent mutation HITL lifecycle (GA §1)."""

from __future__ import annotations

import asyncio

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.chat import ChatAgent
from app.agents.llm import make_stub_chat_model


@pytest.fixture()
def chat_graph():
    agent = ChatAgent()
    return agent.compile(checkpointer=InMemorySaver(), store=InMemoryStore())


def _ctx():
    return {
        "chat_model": make_stub_chat_model(),
        "project_id": "p-test",
        "autonomy_level": "plan",
    }


def test_chat_stub_mutation_emits_proposal_and_interrupts(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-pro-1"}}
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="plan __PROPOSE_MUTATION__")]},
            config=cfg,
            context=_ctx(),
        )
        evts = first.get("events") or []
        assert any(
            isinstance(e, dict) and e.get("kind") == "mutation_proposal"
            for e in evts
        )
        assert "__interrupt__" in first

    asyncio.run(run())


def test_chat_reject_resume_no_apply_interrupt(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-rej-1"}}
        ctx = _ctx()
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        final = await chat_graph.ainvoke(
            Command(resume={"accepted": False}),
            config=cfg,
            context=ctx,
        )
        assert "__interrupt__" not in final
        tail = final["messages"][-1].content
        assert "unchanged" in tail.lower()

    asyncio.run(run())


def test_chat_accept_applies_second_interrupt_then_finishes(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-app-1"}}
        ctx = _ctx()
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        # The approval interrupt now uses the split tool name.
        first_interrupts = first.get("__interrupt__") or []
        assert first_interrupts
        first_payload = first_interrupts[0].value
        assert first_payload["tool"] == "fe.requestMutationApproval"
        mid = await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        interrupts = mid.get("__interrupt__", [])
        assert interrupts
        payload = interrupts[0].value
        assert payload["tool"] == "fe.applyApprovedMutation"
        # New apply contract carries an approval_id, not a stage.
        assert payload["args"]["approval_id"]
        final = await chat_graph.ainvoke(
            Command(resume={"status": "applied", "details": {}}),
            config=cfg,
            context=ctx,
        )
        assert final.get("mutation_applied_ids")

    asyncio.run(run())


def test_mutation_applied_ids_records_once(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-once-1"}}
        ctx = _ctx()
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        ev = next(
            e
            for e in (first.get("events") or [])
            if isinstance(e, dict) and e.get("kind") == "mutation_proposal"
        )
        pid = ev["proposal"]["proposal_id"]
        await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        done = await chat_graph.ainvoke(
            Command(resume={"status": "applied", "details": {}}),
            config=cfg,
            context=ctx,
        )
        applied = done.get("mutation_applied_ids") or []
        assert applied == [pid]

    asyncio.run(run())


def test_chat_malformed_resume_payload_treated_as_rejection(chat_graph) -> None:
    """Non-dict / missing-``accepted`` resume payloads must not auto-accept.

    Pre-hardening, a truthy non-dict (e.g. ``1`` or ``"yes"``) was silently
    coerced to ``{"accepted": True}`` and triggered the apply interrupt.  Now
    the agent treats it as a rejection and tells the user.
    """

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-malformed-1"}}
        ctx = _ctx()
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        final = await chat_graph.ainvoke(
            Command(resume="yes"),  # truthy non-dict — historically auto-accepted
            config=cfg,
            context=ctx,
        )
        assert "__interrupt__" not in final
        tail = final["messages"][-1].content
        assert "unchanged" in tail.lower()

    asyncio.run(run())


def test_chat_apply_non_success_shape_treated_as_failure(chat_graph) -> None:
    """The FE-tool contract requires ``{applied: true}``; anything else fails.

    An empty dict or a dict without ``applied: true`` used to be reported as
    "Applied!" to the user; now the user sees a refresh-and-retry message and
    ``mutation_applied_ids`` stays empty so the idempotency guard isn't burned.
    """

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-apply-shape-1"}}
        ctx = _ctx()
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        final = await chat_graph.ainvoke(
            # Non-empty dict so LangGraph consumes the interrupt, but missing
            # the required ``applied: true`` flag — pre-fix this was reported
            # to the user as "Applied!".
            Command(resume={"ok": True}),
            config=cfg,
            context=ctx,
        )
        assert not final.get("mutation_applied_ids")
        tail = final["messages"][-1].content
        assert "refresh" in tail.lower()

    asyncio.run(run())


def test_chat_apply_with_edited_diff_reaches_fe_apply(chat_graph) -> None:
    """A user-edited diff on the accept resume must reach ``fe.applyApprovedMutation``.

    Pre-fix the decision dict preserved ``edited_diff`` but the finalize node
    used the original proposal diff for the apply stage, so any user edit
    during approval was silently dropped.
    """

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "mut-edit-1"}}
        ctx = _ctx()
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        edited = {
            "task_updates": [
                {
                    "task_id": "edited-task-1",
                    "field": "taskName",
                    "from": "Before",
                    "to": "User-Edited Title",
                }
            ]
        }
        mid = await chat_graph.ainvoke(
            Command(resume={"accepted": True, "edited_diff": edited}),
            config=cfg,
            context=ctx,
        )
        # The edited diff must be on the apply-stage interrupt payload, not
        # just stashed on the decision.
        interrupts = mid.get("__interrupt__") or []
        assert interrupts, "expected the apply-stage interrupt"
        payload = interrupts[0].value
        assert payload["tool"] == "fe.applyApprovedMutation"
        assert payload["args"]["diff"] == edited

    asyncio.run(run())


def test_chat_blank_proposal_id_drops_loudly() -> None:
    """A ``mutation_pending`` with a blank ``proposal_id`` must abort cleanly.

    Historically the empty string survived all the way into
    ``mutation_applied_ids``, which broke the duplicate-apply guard for every
    later proposal in the same thread.
    """

    from app.agents.catalog.chat import _mutation_hitl

    out = _mutation_hitl({"mutation_pending": {"proposal_id": "  "}})
    assert out["mutation_pending"] is None
    assert "missing id" in out["messages"][0].content


def test_chat_real_model_read_tool_call_interrupts_and_resumes(
    chat_graph, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real-provider tool calls must flow through v2.1 FE interrupts."""

    class _FakeBound:
        calls = 0

        async def ainvoke(self, messages, config=None):  # type: ignore[no-untyped-def]
            self.calls += 1
            if self.calls == 1:
                return AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-tasks",
                            "name": "listTasks",
                            "args": {"projectId": "p-test"},
                            "type": "tool_call",
                        }
                    ],
                )
            return AIMessage(content="Found one matching task.")

    fake = _FakeBound()
    import app.agents.catalog.chat as chat_module

    monkeypatch.setattr(chat_module, "_get_bound", lambda _model: fake)
    monkeypatch.setattr(chat_module, "is_stub_model", lambda _model: False)

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "real-tool-1"}}
        ctx = _ctx() | {"chat_model": object()}
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="list the tasks")]},
            config=cfg,
            context=ctx,
        )
        interrupts = first.get("__interrupt__") or []
        assert interrupts
        assert interrupts[0].value == {
            "tool": "fe.listTasks",
            "args": {"projectId": "p-test", "project_id": "p-test"},
        }

        final = await chat_graph.ainvoke(
            Command(resume={"tasks": [{"_id": "t1", "taskName": "Fix auth"}]}),
            config=cfg,
            context=ctx,
        )
        assert final["messages"][-1].content == "Found one matching task."

    asyncio.run(run())


def test_chat_real_model_get_task_tool_call_uses_fe_argument_casing(
    chat_graph, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _FakeBound:
        async def ainvoke(self, messages, config=None):  # type: ignore[no-untyped-def]
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-task",
                        "name": "getTask",
                        "args": {"taskId": "t1", "projectId": "p-test"},
                        "type": "tool_call",
                    }
                ],
            )

    import app.agents.catalog.chat as chat_module

    monkeypatch.setattr(chat_module, "_get_bound", lambda _model: _FakeBound())
    monkeypatch.setattr(chat_module, "is_stub_model", lambda _model: False)

    async def run() -> None:
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="open task t1")]},
            config={"configurable": {"thread_id": "real-tool-casing-1"}},
            context=_ctx() | {"chat_model": object()},
        )
        interrupts = first.get("__interrupt__") or []
        assert interrupts
        assert interrupts[0].value == {
            "tool": "fe.getTask",
            "args": {
                "projectId": "p-test",
                "project_id": "p-test",
                "taskId": "t1",
                "task_id": "t1",
            },
        }

    asyncio.run(run())


def test_chat_real_model_mutation_tool_call_enters_hitl(
    chat_graph, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Organic provider proposals should use the same HITL lane as stub proposals."""

    class _FakeBound:
        async def ainvoke(self, messages, config=None):  # type: ignore[no-untyped-def]
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-proposal",
                        "name": "requestMutationApproval",
                        "args": {
                            "proposal_id": "organic-1",
                            "description": "Rename the task",
                            "risk": "low",
                            "diff": {
                                "task_updates": [
                                    {
                                        "task_id": "t1",
                                        "field": "taskName",
                                        "from": "Old title",
                                        "to": "New title",
                                    }
                                ]
                            },
                        },
                        "type": "tool_call",
                    }
                ],
            )

    import app.agents.catalog.chat as chat_module

    monkeypatch.setattr(chat_module, "_get_bound", lambda _model: _FakeBound())
    monkeypatch.setattr(chat_module, "is_stub_model", lambda _model: False)

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "organic-proposal-1"}}
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="rename this task")]},
            config=cfg,
            context=_ctx() | {"chat_model": object()},
        )
        events = first.get("events") or []
        proposal_events = [
            event
            for event in events
            if isinstance(event, dict) and event.get("kind") == "mutation_proposal"
        ]
        assert proposal_events
        assert proposal_events[0]["proposal"]["proposal_id"] == "organic-1"
        interrupts = first.get("__interrupt__") or []
        assert interrupts
        assert interrupts[0].value["tool"] == "fe.requestMutationApproval"

    asyncio.run(run())
