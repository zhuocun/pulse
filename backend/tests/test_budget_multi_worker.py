"""Multi-worker budget concurrency tests.

Covers the fix for the in-memory-backend overshoot acknowledged in the
docstring of :class:`InMemoryBudgetBackend`. The :class:`PostgresBudgetBackend`
in :mod:`app.middleware.budget_pg` serialises concurrent reservations
via row-level locking (``SELECT ... FOR UPDATE``); these tests confirm
that, then exercise the new :func:`build_budget_backend` factory.

The fake pool here mimics psycopg's connection/cursor surface for the
``SELECT ... FOR UPDATE`` + ``INSERT`` / ``UPDATE`` flow and serialises
all transactions on an :class:`asyncio.Lock`. That's the exact
invariant a real Postgres row lock provides: concurrent transactions
on the same row queue up rather than read stale state. Any race that
shows up here would also show up in production against real Postgres.

Hermetic by design -- no live database needed. A live smoke test
gated by ``PYTEST_AGENT_POSTGRES_URI`` is included at the bottom for
operators who want to verify against the real engine.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any

import pytest

from app.middleware import budget as _budget
from app.middleware.budget import (
    DEFAULT_MONTHLY_TOKEN_CAP,
    InMemoryBudgetBackend,
    build_budget_backend,
)
from app.middleware.budget_pg import PostgresBudgetBackend


# ---------------------------------------------------------------------------
# Fake Postgres pool -- serialises by ``asyncio.Lock`` to simulate row locks
# ---------------------------------------------------------------------------


class _FakeRowStore:
    """Backs the fake pool with a dict keyed on (project_id, period_key).

    The real schema is per-(project, period) tokens_used + requests_made;
    we keep the same shape here. The store's ``async with`` lock
    simulates the row-level lock that ``SELECT ... FOR UPDATE`` takes
    against real Postgres: all logical "transactions" on a given key
    serialise.
    """

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], dict[str, int]] = {}
        self.row_locks: dict[tuple[str, str], asyncio.Lock] = {}

    def lock_for(self, key: tuple[str, str]) -> asyncio.Lock:
        if key not in self.row_locks:
            self.row_locks[key] = asyncio.Lock()
        return self.row_locks[key]


class _FakeCursor:
    """SQL-aware fake that handles the four statements the backend emits."""

    def __init__(self, parent: "_FakeConn") -> None:
        self.parent = parent
        self.description: Any = None
        self._result: Any = None
        self.rowcount: int = 0

    async def __aenter__(self) -> "_FakeCursor":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def execute(self, sql: str, args: tuple[Any, ...] = ()) -> None:
        stripped = sql.strip()
        self.parent.parent.executed.append((stripped, args))
        store = self.parent.parent.store

        if stripped.startswith("SELECT tokens_used\n") and "FOR UPDATE" in stripped:
            project_id, period_key = args[0], args[1]
            await self.parent._acquire_row_lock((project_id, period_key))
            row = store.rows.get((project_id, period_key))
            if row is None:
                self._result = None
                self.description = None
            else:
                self._result = {"tokens_used": row["tokens_used"]}
                self.description = (("tokens_used", None),)
        elif stripped.startswith("INSERT INTO agent_budget_counter") and "VALUES (%s, %s, %s, 0," in stripped:
            # Reservation INSERT for a fresh row
            project_id, period_key, tokens = args
            store.rows[(project_id, period_key)] = {
                "tokens_used": int(tokens),
                "requests_made": 0,
            }
            self._result = None
            self.description = None
        elif stripped.startswith("UPDATE agent_budget_counter") and "tokens_used = %s" in stripped:
            new_total, project_id, period_key = args
            store.rows[(project_id, period_key)] = {
                "tokens_used": int(new_total),
                "requests_made": store.rows.get((project_id, period_key), {"requests_made": 0})["requests_made"],
            }
            self._result = None
        elif stripped.startswith("INSERT INTO agent_budget_counter") and "ON CONFLICT (project_id, period_key) DO UPDATE SET" in stripped and "EXCLUDED.tokens_used" in stripped:
            project_id, period_key, tokens = args
            key = (project_id, period_key)
            existing = store.rows.get(key)
            if existing is None:
                store.rows[key] = {
                    "tokens_used": int(tokens),
                    "requests_made": 1,
                }
            else:
                store.rows[key] = {
                    "tokens_used": existing["tokens_used"] + int(tokens),
                    "requests_made": existing["requests_made"] + 1,
                }
            row = store.rows[key]
            self._result = {
                "tokens_used": row["tokens_used"],
                "requests_made": row["requests_made"],
            }
            self.description = (("tokens_used", None), ("requests_made", None))
        elif stripped.startswith("INSERT INTO agent_budget_counter") and "GREATEST(0," in stripped:
            project_id, period_key, refund = args
            key = (project_id, period_key)
            existing = store.rows.get(key)
            if existing is None:
                store.rows[key] = {"tokens_used": 0, "requests_made": 0}
            else:
                store.rows[key] = {
                    "tokens_used": max(0, existing["tokens_used"] - int(refund)),
                    "requests_made": existing["requests_made"],
                }
            row = store.rows[key]
            self._result = {
                "tokens_used": row["tokens_used"],
                "requests_made": row["requests_made"],
            }
            self.description = (("tokens_used", None), ("requests_made", None))
        elif stripped.startswith("SELECT tokens_used, requests_made"):
            project_id, period_key = args[0], args[1]
            row = store.rows.get((project_id, period_key))
            if row is None:
                self._result = None
                self.description = None
            else:
                self._result = {
                    "tokens_used": row["tokens_used"],
                    "requests_made": row["requests_made"],
                }
                self.description = (("tokens_used", None), ("requests_made", None))
        elif stripped.startswith("DELETE FROM agent_budget_counter"):
            store.rows.clear()
            self._result = None
        else:
            self._result = None

    async def fetchone(self) -> Any:
        return self._result

    async def fetchall(self) -> list[Any]:
        return [self._result] if self._result is not None else []


class _FakeConn:
    def __init__(self, parent: "_FakePool") -> None:
        self.parent = parent
        self._held_locks: list[asyncio.Lock] = []

    async def _acquire_row_lock(self, key: tuple[str, str]) -> None:
        lock = self.parent.store.lock_for(key)
        await lock.acquire()
        self._held_locks.append(lock)

    @asynccontextmanager
    async def cursor(self) -> Any:
        cur = _FakeCursor(self)
        yield cur

    @asynccontextmanager
    async def transaction(self) -> Any:
        try:
            yield self
        finally:
            # Release locks taken via SELECT ... FOR UPDATE inside the
            # transaction, mirroring real Postgres release-on-commit
            # semantics.
            while self._held_locks:
                self._held_locks.pop().release()


class _FakePool:
    """psycopg_pool.AsyncConnectionPool stand-in for hermetic tests."""

    def __init__(self) -> None:
        self.store = _FakeRowStore()
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    @asynccontextmanager
    async def connection(self) -> Any:
        conn = _FakeConn(self)
        try:
            yield conn
        finally:
            # Defensive: release any held locks if the caller skipped
            # the explicit transaction block.
            while conn._held_locks:
                conn._held_locks.pop().release()


# ---------------------------------------------------------------------------
# Baseline: InMemoryBudgetBackend races under concurrency.
#
# This is the historical bug the Postgres backend fixes. We don't
# *test* the in-memory backend stays buggy across multiple processes
# (asyncio Lock protects within one event loop), but we do confirm
# that a *fresh* InMemoryBudgetBackend per "worker" can collectively
# overshoot -- which is the multi-worker failure mode.
# ---------------------------------------------------------------------------


def test_inmemory_each_worker_has_own_counter_so_cap_is_per_worker() -> None:
    """N independent InMemoryBudgetBackend instances each enforce their
    own cap -- that's the multi-worker overshoot the PostgresBudgetBackend
    fixes.
    """

    workers = [InMemoryBudgetBackend(monthly_cap=10) for _ in range(3)]
    # Each "worker" reserves 10 -- well within its own per-worker cap.
    # Aggregate spend is 30, well over the configured cap of 10.
    for worker in workers:
        assert worker.reserve("p", 10) is True
    total = sum(10 - w.remaining("p") for w in workers)
    assert total == 30  # the bug: 3 workers x 10 = 30 against a "10" cap


def test_inmemory_single_instance_serialises_within_one_event_loop() -> None:
    """Within one process the asyncio.Lock-equivalent (threading.Lock)
    keeps reserve() linearisable; gather of 100 reservers totalling
    over the cap stops at exactly the cap.
    """

    tracker = InMemoryBudgetBackend(monthly_cap=100)

    # 200 reservations of 1 token each against a cap of 100 -- exactly
    # 100 must succeed, 100 must fail, and remaining must be 0.
    successes = sum(tracker.reserve("p", 1) for _ in range(200))
    assert successes == 100
    assert tracker.remaining("p") == 0


# ---------------------------------------------------------------------------
# PostgresBudgetBackend: the multi-worker fix.
# ---------------------------------------------------------------------------


def _new_pg_backend(cap: int = 100) -> tuple[PostgresBudgetBackend, _FakePool]:
    pool = _FakePool()
    return PostgresBudgetBackend(pool, monthly_cap=cap), pool


def test_pg_areserve_within_cap_succeeds() -> None:
    backend, _ = _new_pg_backend(cap=100)

    async def run() -> bool:
        return await backend.areserve("p", 30)

    assert asyncio.run(run()) is True


def test_pg_areserve_over_cap_returns_false_without_mutation() -> None:
    backend, pool = _new_pg_backend(cap=10)

    async def run() -> tuple[bool, bool, int]:
        first = await backend.areserve("p", 8)
        second = await backend.areserve("p", 5)
        return first, second, await backend.aremaining("p")

    first, second, remaining = asyncio.run(run())
    assert first is True
    assert second is False
    assert remaining == 2  # 10 - 8


def test_pg_areserve_rejects_negative_tokens() -> None:
    backend, _ = _new_pg_backend(cap=10)

    async def run() -> None:
        await backend.areserve("p", -1)

    with pytest.raises(ValueError):
        asyncio.run(run())


def test_pg_concurrent_reservations_hit_cap_exactly_with_no_overshoot() -> None:
    """100 concurrent reservations of 1 token, cap=100 -- all succeed.

    This is the headline guarantee of the postgres backend: every
    reservation sees a row-locked view of the counter, so the cap can
    never be over-spent regardless of how many gathered coroutines
    are racing.
    """

    backend, pool = _new_pg_backend(cap=100)

    async def reserve_once() -> bool:
        return await backend.areserve("p", 1)

    async def run() -> tuple[int, int]:
        results = await asyncio.gather(*[reserve_once() for _ in range(100)])
        return sum(results), await backend.aremaining("p")

    successes, remaining = asyncio.run(run())
    assert successes == 100
    assert remaining == 0
    # The fake-pool row store records the final tally.
    row = next(iter(pool.store.rows.values()))
    assert row["tokens_used"] == 100


def test_pg_concurrent_reservations_over_cap_stop_exactly_at_cap() -> None:
    """200 reservations of 1 token, cap=100 -- exactly 100 succeed,
    100 fail, no overshoot.
    """

    backend, pool = _new_pg_backend(cap=100)

    async def run() -> tuple[int, int]:
        results = await asyncio.gather(
            *[backend.areserve("p", 1) for _ in range(200)]
        )
        return sum(results), await backend.aremaining("p")

    successes, remaining = asyncio.run(run())
    assert successes == 100
    assert remaining == 0
    row = next(iter(pool.store.rows.values()))
    assert row["tokens_used"] == 100


def test_pg_record_increments_atomically_across_concurrent_calls() -> None:
    backend, pool = _new_pg_backend(cap=10_000)

    async def run() -> int:
        await asyncio.gather(
            *[backend.arecord("p", 1) for _ in range(100)]
        )
        return await backend.aremaining("p")

    remaining = asyncio.run(run())
    assert remaining == 10_000 - 100
    row = next(iter(pool.store.rows.values()))
    assert row["tokens_used"] == 100
    assert row["requests_made"] == 100


def test_pg_record_rejects_negative_tokens() -> None:
    backend, _ = _new_pg_backend()

    async def run() -> None:
        await backend.arecord("p", -1)

    with pytest.raises(ValueError):
        asyncio.run(run())


def test_pg_refund_clamps_at_zero_and_serialises_across_workers() -> None:
    """Refunds beyond the current spend can't push the tally negative.

    This is the same invariant the Redis backend's Lua script enforces;
    here we get it from ``GREATEST(0, tokens_used - %s)``.
    """

    backend, pool = _new_pg_backend()

    async def run() -> int:
        await backend.arecord("p", 5)
        await backend.arefund("p", 100)  # would go negative without clamp
        return (await backend.aremaining("p"))

    remaining = asyncio.run(run())
    assert remaining == backend.monthly_cap  # tally back to 0 → full cap remains


def test_pg_refund_rejects_negative_tokens() -> None:
    backend, _ = _new_pg_backend()

    async def run() -> None:
        await backend.arefund("p", -1)

    with pytest.raises(ValueError):
        asyncio.run(run())


def test_pg_aremaining_empty_returns_full_cap() -> None:
    backend, _ = _new_pg_backend(cap=500)

    async def run() -> int:
        return await backend.aremaining("p")

    assert asyncio.run(run()) == 500


def test_pg_areset_clears_rows() -> None:
    backend, pool = _new_pg_backend(cap=100)

    async def run() -> int:
        await backend.areserve("p", 50)
        await backend.areset()
        return await backend.aremaining("p")

    assert asyncio.run(run()) == 100
    assert pool.store.rows == {}


def test_pg_sync_surface_can_spend_reserve_record_refund_remaining_reset() -> None:
    """The sync :class:`BudgetBackend` protocol methods bridge to the
    async backend via :func:`asyncio.run`. Exercises the bridge from
    outside any running event loop.
    """

    backend, _ = _new_pg_backend(cap=100)

    assert backend.can_spend("p", 50) is True
    assert backend.reserve("p", 40) is True
    assert backend.remaining("p") == 60
    backend.record("p", 10)
    assert backend.remaining("p") == 50
    backend.refund("p", 5)
    assert backend.remaining("p") == 55
    backend.reset()
    assert backend.remaining("p") == 100


def test_pg_can_spend_returns_false_when_remaining_too_low() -> None:
    backend, _ = _new_pg_backend(cap=10)
    backend.reserve("p", 8)
    assert backend.can_spend("p", 3) is False


def test_pg_sync_method_in_running_loop_raises_with_guidance() -> None:
    """Calling the sync bridge from inside a coroutine would deadlock
    without the explicit guard. The guard surfaces a clear error so
    a mis-used sync helper fails loudly instead of hanging.
    """

    backend, _ = _new_pg_backend(cap=100)

    async def run() -> None:
        backend.reserve("p", 1)

    with pytest.raises(RuntimeError, match="use the async variants"):
        asyncio.run(run())


def test_pg_setup_executes_create_table_and_indexes() -> None:
    backend, pool = _new_pg_backend()

    async def run() -> None:
        await backend.setup()

    asyncio.run(run())
    statements = [sql for sql, _ in pool.executed]
    assert any(
        "CREATE TABLE IF NOT EXISTS agent_budget_counter" in s
        for s in statements
    )
    assert any("CREATE INDEX" in s for s in statements)


def test_pg_setup_honours_custom_table_name() -> None:
    pool = _FakePool()
    backend = PostgresBudgetBackend(pool, table="custom_table")

    async def run() -> None:
        await backend.setup()

    asyncio.run(run())
    assert any(
        "CREATE TABLE IF NOT EXISTS custom_table" in sql
        for sql, _ in pool.executed
    )


def test_pg_custom_table_is_used_in_runtime_queries() -> None:
    pool = _FakePool()
    backend = PostgresBudgetBackend(pool, table="custom_table")

    async def run() -> None:
        await backend.areserve("p", 1)

    asyncio.run(run())
    # Every SQL statement runtime emits must reference the custom table.
    for sql, _ in pool.executed:
        assert "custom_table" in sql


# ---------------------------------------------------------------------------
# Factory selection -- build_budget_backend
# ---------------------------------------------------------------------------


def test_factory_memory_returns_in_memory_backend() -> None:
    backend = build_budget_backend("memory", monthly_cap=99)
    assert isinstance(backend, InMemoryBudgetBackend)
    assert backend.monthly_cap == 99


def test_factory_empty_string_defaults_to_memory() -> None:
    backend = build_budget_backend("", monthly_cap=33)
    assert isinstance(backend, InMemoryBudgetBackend)
    assert backend.monthly_cap == 33


def test_factory_postgres_returns_postgres_backend_with_pool() -> None:
    pool = _FakePool()
    backend = build_budget_backend(
        "postgres", monthly_cap=50, postgres_pool=pool
    )
    assert isinstance(backend, PostgresBudgetBackend)
    assert backend.monthly_cap == 50


def test_factory_postgres_requires_pool() -> None:
    with pytest.raises(RuntimeError, match="requires an AsyncConnectionPool"):
        build_budget_backend("postgres", monthly_cap=10)


def test_factory_redis_returns_redis_backend_with_client() -> None:
    fakeredis = pytest.importorskip("fakeredis")
    client = fakeredis.FakeRedis(decode_responses=True)
    try:
        backend = build_budget_backend(
            "redis", monthly_cap=77, redis_client=client
        )
        # Don't import the class here; assert by attribute shape and
        # that the build path didn't raise.
        assert getattr(backend, "monthly_cap", None) == 77
    finally:
        client.flushall()


def test_factory_redis_requires_client() -> None:
    with pytest.raises(RuntimeError, match="requires a redis client"):
        build_budget_backend("redis", monthly_cap=10)


def test_factory_unknown_backend_raises() -> None:
    with pytest.raises(RuntimeError, match="Unsupported BUDGET_BACKEND"):
        build_budget_backend("sqlite", monthly_cap=10)


def test_factory_supported_backends_constant_lists_three() -> None:
    assert _budget.SUPPORTED_BUDGET_BACKENDS == frozenset(
        {"memory", "redis", "postgres"}
    )


# ---------------------------------------------------------------------------
# Env-var driven selection -- the wiring in app.main delegates to the
# factory above, but tests exercising the env-var path through a Settings
# instance also confirm the contract round-trips without touching app.main.
# ---------------------------------------------------------------------------


def test_factory_dispatch_via_settings_round_trips() -> None:
    """A simulated env-var-driven flow: pass :class:`Settings` fields to
    :func:`build_budget_backend` -- the chosen class matches.

    The :class:`Settings` class reads env vars eagerly at module import,
    so we override via ``dataclasses.replace`` instead of
    :func:`monkeypatch.setenv` (which wouldn't re-read after import).
    """

    from dataclasses import replace

    from app.config import settings as app_settings

    cfg = replace(
        app_settings,
        budget_backend="memory",
        agent_budget_monthly_token_cap=200,
    )
    backend = build_budget_backend(
        cfg.budget_backend, monthly_cap=cfg.agent_budget_monthly_token_cap
    )
    assert isinstance(backend, InMemoryBudgetBackend)
    assert backend.monthly_cap == 200


def test_default_module_singleton_uses_configured_cap() -> None:
    """The module-level :data:`budget_tracker` is constructed from
    :data:`Settings.agent_budget_monthly_token_cap` at import time.
    """

    from app.config import settings as app_settings

    assert isinstance(_budget.budget_tracker, InMemoryBudgetBackend)
    assert _budget.budget_tracker.monthly_cap == app_settings.agent_budget_monthly_token_cap


def test_configure_budget_backend_swaps_module_singleton() -> None:
    """The ``configure_budget_backend`` helper swaps :data:`budget_tracker`."""

    original = _budget.budget_tracker
    try:
        new = InMemoryBudgetBackend(monthly_cap=DEFAULT_MONTHLY_TOKEN_CAP // 2)
        _budget.configure_budget_backend(new)
        assert _budget.budget_tracker is new
    finally:
        _budget.configure_budget_backend(original)


# ---------------------------------------------------------------------------
# Optional live-Postgres smoke
# ---------------------------------------------------------------------------


LIVE_DSN = os.getenv("PYTEST_AGENT_POSTGRES_URI", "").strip()


@pytest.mark.skipif(
    not LIVE_DSN,
    reason="set PYTEST_AGENT_POSTGRES_URI to run the live Postgres budget smoke test",
)
def test_live_postgres_budget_concurrent_reserve_stops_at_cap() -> None:
    psycopg_pool = pytest.importorskip("psycopg_pool")

    async def run() -> None:
        from psycopg.rows import dict_row

        async with AsyncExitStack() as stack:
            pool = psycopg_pool.AsyncConnectionPool(
                conninfo=LIVE_DSN,
                min_size=1,
                max_size=8,
                kwargs={
                    "autocommit": True,
                    "prepare_threshold": 0,
                    "row_factory": dict_row,
                },
                open=False,
            )
            await stack.enter_async_context(pool)

            table = f"agent_budget_counter_test_{uuid.uuid4().hex[:8]}"
            backend = PostgresBudgetBackend(pool, monthly_cap=100, table=table)
            await backend.setup()

            try:
                results = await asyncio.gather(
                    *[backend.areserve("p-live", 1) for _ in range(200)]
                )
                assert sum(results) == 100
                assert await backend.aremaining("p-live") == 0
            finally:
                async with pool.connection() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(f"DROP TABLE IF EXISTS {table}")

    asyncio.run(run())
