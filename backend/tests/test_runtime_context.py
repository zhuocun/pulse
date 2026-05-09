"""Tests for Phase 4: per-call context model injection.

Verifies that:
1. The runtime injects ``chat_model`` onto the LangGraph context per call.
2. A context-supplied model takes priority over the agent's default.
3. The agent's default ``chat_model`` is used when no context override is given.
4. ``AgentRuntime.set_chat_model`` propagates the model via the context path.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.context import ChatContext
from app.agents.registry import AgentRegistry
from app.agents.runtime import AgentRuntime

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.runtime import get_runtime
from langgraph.store.base import BaseStore

from typing import TypedDict


# ---------------------------------------------------------------------------
# Minimal sentinel models
# ---------------------------------------------------------------------------


class _ModelA:
    """First sentinel model."""
    name = "model-a"


class _ModelB:
    """Second sentinel model."""
    name = "model-b"


class _DefaultModel:
    """Default model captured at build time."""
    name = "default-model"


# ---------------------------------------------------------------------------
# Test agent that records which model was used per call
# ---------------------------------------------------------------------------


class _RecordingState(TypedDict):
    model_name: str


class _ContextRecordingAgent(BaseAgent):
    """Agent whose single node reads ``chat_model`` off the per-call context.

    The node writes ``model.name`` into state so the test can assert which
    model was actually used without inspecting internal agent state.

    ``context_schema=ChatContext`` is declared so
    :meth:`~app.agents.runtime.AgentRuntime._build_context` injects the
    per-call model onto the context (same as all six catalog agents).
    """

    metadata = AgentMetadata(
        name="ctx-recording-agent",
        description="Records the model name from context per call.",
        context_schema=ChatContext,
    )

    def __init__(self) -> None:
        super().__init__(chat_model=_DefaultModel())

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        _default = self.chat_model  # captured fallback

        def record_model(state: _RecordingState) -> dict[str, Any]:
            rt = get_runtime(ChatContext)
            model = (rt.context or {}).get("chat_model") or _default
            return {"model_name": getattr(model, "name", str(model))}

        graph = StateGraph(_RecordingState, context_schema=ChatContext)
        graph.add_node("record", record_model)
        graph.add_edge(START, "record")
        graph.add_edge("record", END)
        return graph.compile(checkpointer=checkpointer, store=store)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_runtime(agent: BaseAgent) -> AgentRuntime:
    registry = AgentRegistry()
    registry.register(agent)
    return AgentRuntime(registry=registry)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_context_model_override_takes_priority() -> None:
    """A model supplied via ``context=`` beats the agent's default."""

    agent = _ContextRecordingAgent()
    runtime = _make_runtime(agent)

    async def run() -> str:
        final, _events = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
            context={"chat_model": _ModelA()},
        )
        return (final or {}).get("model_name", "")

    result = asyncio.run(run())
    assert result == "model-a"


def test_default_model_used_when_no_context_override() -> None:
    """When no context is supplied the agent's ``chat_model`` property is used."""

    agent = _ContextRecordingAgent()
    runtime = _make_runtime(agent)

    async def run() -> str:
        final, _events = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
        )
        return (final or {}).get("model_name", "")

    result = asyncio.run(run())
    assert result == "default-model"


def test_two_calls_each_use_their_own_context_model() -> None:
    """Two back-to-back calls with different context models use the right model each time."""

    agent = _ContextRecordingAgent()
    runtime = _make_runtime(agent)

    async def run() -> tuple[str, str]:
        final_a, _ = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
            context={"chat_model": _ModelA()},
        )
        final_b, _ = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
            context={"chat_model": _ModelB()},
        )
        name_a = (final_a or {}).get("model_name", "")
        name_b = (final_b or {}).get("model_name", "")
        return name_a, name_b

    name_a, name_b = asyncio.run(run())
    assert name_a == "model-a"
    assert name_b == "model-b"


def test_runtime_set_chat_model_propagates_via_context() -> None:
    """``AgentRuntime.set_chat_model`` is picked up by subsequent calls.

    After calling ``runtime.set_chat_model(name, model)`` the new model is
    used as the default for the named agent (injected via the context path by
    :meth:`~app.agents.runtime.AgentRuntime._build_context`).
    """

    agent = _ContextRecordingAgent()
    runtime = _make_runtime(agent)
    runtime.set_chat_model("ctx-recording-agent", _ModelA())

    async def run() -> str:
        final, _events = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
        )
        return (final or {}).get("model_name", "")

    result = asyncio.run(run())
    assert result == "model-a"


def test_context_override_beats_set_chat_model() -> None:
    """A per-call context model still wins over the runtime-set default."""

    agent = _ContextRecordingAgent()
    runtime = _make_runtime(agent)
    runtime.set_chat_model("ctx-recording-agent", _ModelA())  # set default to A

    async def run() -> str:
        final, _events = await runtime.arun_with_events(
            "ctx-recording-agent",
            {},
            context={"chat_model": _ModelB()},  # override with B
        )
        return (final or {}).get("model_name", "")

    result = asyncio.run(run())
    assert result == "model-b"  # B wins
