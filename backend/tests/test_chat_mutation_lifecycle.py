"""chat-agent mutation HITL lifecycle (GA §1)."""

from __future__ import annotations

import asyncio

import pytest
from langchain_core.messages import HumanMessage
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
