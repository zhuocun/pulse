"""Concurrency smoke-test for BaseAgent.acompile.

Verifies that when two asyncio tasks race on a cold-cache acompile() call,
only a single build() invocation occurs (the second task waits behind the
async lock and then reuses the cached result).
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional
from unittest.mock import MagicMock

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore

from app.agents.base import AgentMetadata, BaseAgent


# ---------------------------------------------------------------------------
# Minimal concrete agent for tests -- build() is mocked per test.
# ---------------------------------------------------------------------------


class _SimpleAgent(BaseAgent):
    metadata = AgentMetadata(name="test-compile-agent")

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        # Concrete agents must implement build(); callers will mock it.
        raise NotImplementedError  # pragma: no cover


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_acompile_concurrent_calls_invoke_build_once() -> None:
    """Two concurrent acompile() calls must trigger build() exactly once.

    The asyncio.Lock inside acompile() serialises both tasks; the second
    task finds the cache already populated and skips build().
    """

    async def _run() -> None:
        agent = _SimpleAgent()
        fake_graph = MagicMock(spec=Pregel)
        build_call_count = 0

        def counting_build(**kwargs: Any) -> Pregel:
            nonlocal build_call_count
            build_call_count += 1
            return fake_graph

        agent.build = counting_build  # type: ignore[method-assign]

        results = await asyncio.gather(
            agent.acompile(),
            agent.acompile(),
        )

        assert build_call_count == 1, (
            f"Expected build() to be called exactly once, but it was called "
            f"{build_call_count} time(s). "
            "The asyncio.Lock in acompile() should prevent duplicate builds."
        )
        assert results[0] is fake_graph
        assert results[1] is fake_graph

    asyncio.run(_run())


def test_acompile_returns_cached_result_on_second_call() -> None:
    """Repeated acompile() calls with the same (checkpointer, store) hit the cache."""

    async def _run() -> None:
        agent = _SimpleAgent()
        fake_graph = MagicMock(spec=Pregel)
        build_call_count = 0

        def counting_build(**kwargs: Any) -> Pregel:
            nonlocal build_call_count
            build_call_count += 1
            return fake_graph

        agent.build = counting_build  # type: ignore[method-assign]

        first = await agent.acompile()
        second = await agent.acompile()

        assert build_call_count == 1
        assert first is fake_graph
        assert second is fake_graph

    asyncio.run(_run())


def test_acompile_force_triggers_rebuild() -> None:
    """acompile(force=True) must bypass the cache and call build() again."""

    async def _run() -> None:
        agent = _SimpleAgent()
        fake_graph = MagicMock(spec=Pregel)
        build_call_count = 0

        def counting_build(**kwargs: Any) -> Pregel:
            nonlocal build_call_count
            build_call_count += 1
            return fake_graph

        agent.build = counting_build  # type: ignore[method-assign]

        await agent.acompile()
        await agent.acompile(force=True)

        assert build_call_count == 2

    asyncio.run(_run())


def test_acompile_different_checkpointer_triggers_rebuild() -> None:
    """Changing the checkpointer invalidates the cache and rebuilds the graph."""

    async def _run() -> None:
        agent = _SimpleAgent()
        fake_graph_a = MagicMock(spec=Pregel)
        fake_graph_b = MagicMock(spec=Pregel)
        graphs = [fake_graph_a, fake_graph_b]
        build_call_count = 0

        def counting_build(**kwargs: Any) -> Pregel:
            nonlocal build_call_count
            result = graphs[build_call_count]
            build_call_count += 1
            return result

        agent.build = counting_build  # type: ignore[method-assign]

        checkpointer_a = MagicMock(spec=BaseCheckpointSaver)
        checkpointer_b = MagicMock(spec=BaseCheckpointSaver)

        result_a = await agent.acompile(checkpointer=checkpointer_a)
        result_b = await agent.acompile(checkpointer=checkpointer_b)

        assert build_call_count == 2
        assert result_a is fake_graph_a
        assert result_b is fake_graph_b

    asyncio.run(_run())
