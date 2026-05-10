"""Vector-augmented similar-task paths for catalog agents."""

from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.search import SearchAgent
from app.agents.catalog.task_estimation import TaskEstimationAgent
from app.config import settings


def test_search_rank_merges_pgvector_hits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.config.settings",
        dataclasses.replace(settings, agent_vector_search_enabled=True),
    )
    monkeypatch.setattr(
        "app.agents.task_vector_pg.fetch_vector_neighbours_for_project",
        lambda **_: [{"id": "pg-extra", "text": "Only in store", "score": 0.9}],
    )

    agent = SearchAgent()
    graph = agent.build(checkpointer=InMemorySaver(), store=InMemoryStore())
    cfg: dict[str, Any] = {"configurable": {"thread_id": "vec-search-1"}}

    async def run() -> dict[str, Any]:
        from app.agents.context import ChatContext

        ctx: ChatContext = {"project_id": "p-vec"}
        await graph.ainvoke(
            {"messages": [], "query": "login", "kind": "tasks"},
            config=cfg,
            context=ctx,
        )
        resume = {"candidates": [{"id": "t-1", "text": "Local task"}]}
        return await graph.ainvoke(Command(resume=resume), config=cfg, context=ctx)

    final = asyncio.run(run())
    ids = final["ranking"]["ids"]
    assert "pg-extra" in ids
    assert "t-1" in ids


def test_estimation_logs_when_vector_merge_raises(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "app.config.settings",
        dataclasses.replace(settings, agent_vector_search_enabled=True),
    )

    def boom(**_: object) -> list[dict[str, Any]]:
        raise RuntimeError("vector down")

    monkeypatch.setattr(
        "app.agents.task_vector_pg.fetch_vector_neighbours_for_project",
        boom,
    )

    agent = TaskEstimationAgent()
    graph = agent.build(checkpointer=InMemorySaver(), store=InMemoryStore())
    cfg = {"configurable": {"thread_id": "vec-est-1"}}

    async def run() -> dict[str, Any]:
        from app.agents.context import ChatContext

        ctx: ChatContext = {"project_id": "p1"}
        return await graph.ainvoke(
            {
                "project_id": "p1",
                "task_draft": {"taskName": "hello"},
                "similar_tasks": [{"id": "s1", "text": "similar"}],
            },
            config=cfg,
            context=ctx,
        )

    caplog.set_level(logging.WARNING)
    asyncio.run(run())
    assert any(
        "Vector-augmented similar merge failed" in r.message for r in caplog.records
    )


def test_estimation_merges_vector_hits_when_prefetch_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.config.settings",
        dataclasses.replace(settings, agent_vector_search_enabled=True),
    )
    monkeypatch.setattr(
        "app.agents.task_vector_pg.fetch_vector_neighbours_for_project",
        lambda **_: [{"id": "vhit", "text": "from pg", "score": 0.8}],
    )

    agent = TaskEstimationAgent()
    graph = agent.build(checkpointer=InMemorySaver(), store=InMemoryStore())
    cfg = {"configurable": {"thread_id": "vec-est-ok"}}

    async def run() -> dict[str, Any]:
        from app.agents.context import ChatContext

        ctx: ChatContext = {"project_id": "p1"}
        return await graph.ainvoke(
            {
                "project_id": "p1",
                "task_draft": {"taskName": "hello"},
                "similar_tasks": [{"id": "s1", "text": "similar"}],
            },
            config=cfg,
            context=ctx,
        )

    final = asyncio.run(run())
    neighbours = final.get("embedding_neighbors") or []
    ids = {n.get("id") for n in neighbours}
    assert "vhit" in ids or "s1" in ids


def test_search_vector_block_continues_when_prefetch_embed_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "app.config.settings",
        dataclasses.replace(settings, agent_vector_search_enabled=True),
    )
    idx = {"i": 0}

    async def flaky_embed(texts: list[str]) -> list[list[float]]:
        idx["i"] += 1
        if idx["i"] == 1:
            raise RuntimeError("prefetch down")
        return [[1.0, 0.0]] * len(texts)

    monkeypatch.setattr("app.tools.be_tools.embed_async", flaky_embed)

    agent = SearchAgent()
    graph = agent.build(checkpointer=InMemorySaver(), store=InMemoryStore())
    cfg: dict[str, Any] = {"configurable": {"thread_id": "vec-search-err"}}

    async def run() -> dict[str, Any]:
        from app.agents.context import ChatContext

        ctx: ChatContext = {"project_id": "p-vec"}
        await graph.ainvoke(
            {"messages": [], "query": "login", "kind": "tasks"},
            config=cfg,
            context=ctx,
        )
        resume = {"candidates": [{"id": "t-1", "text": "Local task"}]}
        return await graph.ainvoke(Command(resume=resume), config=cfg, context=ctx)

    caplog.set_level(logging.WARNING)
    final = asyncio.run(run())
    assert final["ranking"]["ids"]
    assert any(
        "Vector-augmented search candidates failed" in r.message
        for r in caplog.records
    )


def test_estimation_vector_block_survives_prefetch_embed_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "app.config.settings",
        dataclasses.replace(settings, agent_vector_search_enabled=True),
    )
    idx = {"i": 0}

    async def flaky_embed(texts: list[str]) -> list[list[float]]:
        idx["i"] += 1
        if idx["i"] == 1:
            raise RuntimeError("prefetch down")
        return [[1.0, 0.0]] * len(texts)

    monkeypatch.setattr("app.tools.be_tools.embed_async", flaky_embed)

    agent = TaskEstimationAgent()
    graph = agent.build(checkpointer=InMemorySaver(), store=InMemoryStore())
    cfg = {"configurable": {"thread_id": "vec-est-embed"}}

    async def run() -> dict[str, Any]:
        from app.agents.context import ChatContext

        ctx: ChatContext = {"project_id": "p1"}
        return await graph.ainvoke(
            {
                "project_id": "p1",
                "task_draft": {"taskName": "hello"},
                "similar_tasks": [{"id": "s1", "text": "similar"}],
            },
            config=cfg,
            context=ctx,
        )

    caplog.set_level(logging.WARNING)
    asyncio.run(run())
    assert any(
        "Vector-augmented similar merge failed" in r.message for r in caplog.records
    )
