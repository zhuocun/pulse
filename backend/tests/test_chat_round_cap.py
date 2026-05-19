"""Server-side defensive cap on FE tool-call rounds.

The chat-agent respond node counts AIMessages with tool_calls in state
history; past MAX_SERVER_TOOL_ROUNDS it returns an error frame instead
of invoking the provider. Mirrors the FE's defensive cap in
useAgentToolResolver.ts so a misbehaving client cannot loop forever.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore

from app.agents.catalog.chat import ChatAgent, MAX_SERVER_TOOL_ROUNDS


@pytest.fixture()
def chat_graph() -> Any:
    """Compile a chat-agent graph against in-memory checkpointer + store."""
    agent = ChatAgent()
    return agent.compile(checkpointer=InMemorySaver(), store=InMemoryStore())


def _ctx(model: Any | None = None) -> dict[str, Any]:
    """Return a ChatContext dict suitable for an ainvoke call."""
    # A model that immediately returns plain text on the round-cap path is
    # never invoked, so a None is acceptable when only the cap is exercised.
    return {
        "project_id": "p-test",
        "autonomy_level": "plan",
        **({"chat_model": model} if model is not None else {}),
    }


def _ai_with_tool_calls(idx: int) -> AIMessage:
    """Build an AIMessage that the round counter treats as one tool round."""
    return AIMessage(
        content="",
        tool_calls=[
            {
                "id": f"call_{idx}",
                "name": "listProjects",
                "args": {},
            }
        ],
    )


def _tool_msg_for(idx: int, content: str = "[]") -> ToolMessage:
    return ToolMessage(content=content, tool_call_id=f"call_{idx}")


def test_round_cap_is_eight() -> None:
    """The constant matches the FE-side useAgentToolResolver.ts cap."""
    assert MAX_SERVER_TOOL_ROUNDS == 8


def test_respond_emits_cap_error_when_history_already_at_cap(chat_graph) -> None:
    """A state history with MAX rounds already used aborts respond.

    We seed the state with eight AIMessage+ToolMessage pairs so the
    counter equals MAX_SERVER_TOOL_ROUNDS before respond runs; the node
    must short-circuit to the error frame instead of calling the model.
    """

    async def run() -> None:
        messages: list[Any] = [HumanMessage(content="please look up everything")]
        for idx in range(MAX_SERVER_TOOL_ROUNDS):
            messages.append(_ai_with_tool_calls(idx))
            messages.append(_tool_msg_for(idx))
        cfg = {"configurable": {"thread_id": "cap-1"}}
        # Use a stub-friendly state: the respond node's cap-check runs
        # before any stub-vs-provider branch, so a None model is fine.
        result = await chat_graph.ainvoke(
            {"messages": messages},
            config=cfg,
            context=_ctx(),
        )
        events = result.get("events") or []
        codes = [e.get("code") for e in events if isinstance(e, dict)]
        assert "tool_round_cap_reached" in codes
        tail = result["messages"][-1].content
        assert "tool round limit" in tail.lower() or "rephrase" in tail.lower()

    asyncio.run(run())


def test_respond_under_cap_does_not_emit_error(chat_graph) -> None:
    """Below the cap the respond node runs normally on the stub path."""

    async def run() -> None:
        # One tool round used; well under cap.
        messages: list[Any] = [
            HumanMessage(content="hello"),
            _ai_with_tool_calls(0),
            _tool_msg_for(0),
        ]
        cfg = {"configurable": {"thread_id": "cap-under-1"}}
        result = await chat_graph.ainvoke(
            {"messages": messages},
            config=cfg,
            context=_ctx(),
        )
        events = result.get("events") or []
        codes = [e.get("code") for e in events if isinstance(e, dict)]
        assert "tool_round_cap_reached" not in codes

    asyncio.run(run())


def test_tool_rounds_used_is_written_to_state(chat_graph) -> None:
    """The respond node persists tool_rounds_used so the cap is observable."""

    async def run() -> None:
        # Two AI-with-tool-calls + their tool results => counter starts at 2.
        messages: list[Any] = [
            HumanMessage(content="check projects then tasks"),
            _ai_with_tool_calls(0),
            _tool_msg_for(0),
            _ai_with_tool_calls(1),
            _tool_msg_for(1),
        ]
        cfg = {"configurable": {"thread_id": "cap-count-1"}}
        result = await chat_graph.ainvoke(
            {"messages": messages},
            config=cfg,
            context=_ctx(),
        )
        # The stub model never emits tool_calls so the counter stays at 2.
        assert result.get("tool_rounds_used") == 2

    asyncio.run(run())
