"""Optional live-Postgres smoke tests for agent persistence.

Set ``PYTEST_AGENT_POSTGRES_URI`` to a throwaway database DSN to run this
module. Normal test runs skip it so developers do not accidentally mutate a
shared Postgres instance.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import AsyncExitStack
from typing import Any

import pytest

from app.agents import AgentRuntime
from app.agents.registry import AgentRegistry
from app.config import Settings

POSTGRES_URI = os.getenv("PYTEST_AGENT_POSTGRES_URI", "").strip()
pytestmark = pytest.mark.skipif(
    not POSTGRES_URI,
    reason="set PYTEST_AGENT_POSTGRES_URI to run the live Postgres smoke test",
)


def test_live_postgres_runtime_uses_one_pool_for_checkpoint_and_store() -> None:
    psycopg_pool = pytest.importorskip("psycopg_pool")
    pytest.importorskip("langgraph.checkpoint.postgres.aio")
    pytest.importorskip("langgraph.store.postgres.aio")
    pool_cls = psycopg_pool.AsyncConnectionPool

    async def run() -> None:
        shared_pool: Any = None
        async with AsyncExitStack() as stack:
            runtime = await AgentRuntime.from_settings_async(
                Settings(
                    agent_checkpoint_backend="postgres",
                    agent_store_backend="postgres",
                    agent_postgres_uri=POSTGRES_URI,
                    agent_pg_pool_size=1,
                ),
                stack=stack,
                registry=AgentRegistry(),
            )
            assert runtime.checkpointer is not None
            assert runtime.store is not None

            checkpoint_pool = getattr(runtime.checkpointer, "conn", None)
            store_pool = getattr(runtime.store, "conn", None)
            assert isinstance(checkpoint_pool, pool_cls)
            assert checkpoint_pool is store_pool
            shared_pool = checkpoint_pool

            async with shared_pool.connection() as conn:
                async with conn.cursor() as cursor:
                    await cursor.execute("SELECT 1 AS ok")
                    row = await cursor.fetchone()
                    assert row["ok"] == 1

        assert shared_pool is not None
        assert shared_pool.closed

    asyncio.run(run())
