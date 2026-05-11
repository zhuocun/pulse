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
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        mid = await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        interrupts = mid.get("__interrupt__", [])
        assert interrupts
        payload = interrupts[0].value
        assert payload["tool"] == "fe.applyMutation"
        assert payload["args"]["stage"] == "apply"
        final = await chat_graph.ainvoke(
            Command(resume={"ok": True}),
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
            Command(resume={"ok": True}),
            config=cfg,
            context=ctx,
        )
        applied = done.get("mutation_applied_ids") or []
        assert applied == [pid]

    asyncio.run(run())
