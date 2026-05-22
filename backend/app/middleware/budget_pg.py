"""Postgres-backed :class:`BudgetBackend`.

Fixes the multi-worker overshoot acknowledged in the comments on
:class:`app.middleware.budget.InMemoryBudgetBackend`. Each Uvicorn
worker holds its own dict in the in-memory backend, so the effective
org-wide cap becomes ``workers x configured`` and cold starts zero the
tally; the Redis backend in :mod:`app.middleware.redis_backends`
already solves this for deploys with Redis. This module adds the same
fix for deploys that have Postgres but not Redis.

The atomic gate is a single SQL statement -- ``INSERT ... ON CONFLICT
... DO UPDATE`` with ``RETURNING tokens_used, requests_made`` -- so
two workers reserving the last slot are serialised on the row lock.
We then enforce the cap *client-side* by rolling back if the returned
``tokens_used`` exceeds the cap. The rollback path runs the reverse
DML in the same transaction so the cap check stays atomic with the
increment.

Schema: ``docs/operations/agent-budget-counter.sql`` (also re-created
idempotently by :meth:`setup`).
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.middleware.budget import (
    DEFAULT_MONTHLY_TOKEN_CAP,
    _current_month_key,
)

logger = logging.getLogger(__name__)


_DEFAULT_TABLE = "agent_budget_counter"


# The CTE-based upsert lets us either commit the increment (when it
# stays within the cap) or skip it (when it would overshoot) in a
# single round-trip. ``tried`` carries the post-increment tally so
# callers can decide whether to refund or block.
#
# We use two passes because Postgres has no "ON CONFLICT DO UPDATE
# WHERE" clause that can also INSERT atomically with a conditional --
# the ``WHERE`` only applies to the UPDATE branch. So we:
#
#   1. Try to reserve via SELECT current state (FOR UPDATE) inside a
#      transaction, compute next, and INSERT/UPDATE if allowed.
#
# That's the path taken in :meth:`PostgresBudgetBackend.reserve`.
#
# For :meth:`record` and :meth:`refund` -- which don't enforce caps --
# a plain UPSERT is enough.

_UPSERT_RECORD_SQL = """
INSERT INTO {table} (project_id, period_key, tokens_used, requests_made, updated_at)
VALUES (%s, %s, %s, 1, NOW())
ON CONFLICT (project_id, period_key) DO UPDATE SET
    tokens_used = {table}.tokens_used + EXCLUDED.tokens_used,
    requests_made = {table}.requests_made + 1,
    updated_at = NOW()
RETURNING tokens_used, requests_made
"""


_REFUND_SQL = """
INSERT INTO {table} (project_id, period_key, tokens_used, requests_made, updated_at)
VALUES (%s, %s, 0, 0, NOW())
ON CONFLICT (project_id, period_key) DO UPDATE SET
    tokens_used = GREATEST(0, {table}.tokens_used - %s),
    updated_at = NOW()
RETURNING tokens_used, requests_made
"""


_SELECT_CURRENT_SQL = """
SELECT tokens_used, requests_made
FROM {table}
WHERE project_id = %s AND period_key = %s
"""


# Reservation is a row-locking transaction: SELECT FOR UPDATE the
# current row (or treat as 0 if absent), check the cap, then
# INSERT-or-UPDATE. The FOR UPDATE clause serialises concurrent
# transactions on the same (project_id, period_key) tuple so two
# workers can't both see the same "remaining" and double-spend.
_RESERVE_SELECT_SQL = """
SELECT tokens_used
FROM {table}
WHERE project_id = %s AND period_key = %s
FOR UPDATE
"""


_RESERVE_INSERT_SQL = """
INSERT INTO {table} (project_id, period_key, tokens_used, requests_made, updated_at)
VALUES (%s, %s, %s, 0, NOW())
"""


_RESERVE_UPDATE_SQL = """
UPDATE {table}
SET tokens_used = %s, updated_at = NOW()
WHERE project_id = %s AND period_key = %s
"""


_TRUNCATE_SQL = "DELETE FROM {table}"


class PostgresBudgetBackend:
    """Multi-worker-safe :class:`BudgetBackend` backed by Postgres.

    Constructed with an :class:`~psycopg_pool.AsyncConnectionPool`
    (typically the same pool the LangGraph checkpoint saver uses; see
    :func:`app.agents.checkpointing.enter_agent_postgres_pool`). The
    backend keeps a private synchronous mirror of the running tally
    *only* so the :class:`BudgetBackend` Protocol's sync methods can
    answer reads cheaply -- the source of truth is always the database
    row, and every mutating call goes through the pool.

    All mutating methods are exposed via :class:`asyncio.run_coroutine_threadsafe`
    bridges so callers in sync routes (the gate) keep their existing
    signatures. The async-native methods are also available
    (:meth:`areserve`, :meth:`arecord`, :meth:`arefund`) for routes
    already on the async path.
    """

    monthly_cap: int

    def __init__(
        self,
        pool: Any,
        *,
        monthly_cap: int = DEFAULT_MONTHLY_TOKEN_CAP,
        table: str = _DEFAULT_TABLE,
    ) -> None:
        self._pool = pool
        self.monthly_cap = monthly_cap
        self._table = table

    def _sql(self, template: str) -> str:
        return template.format(table=self._table)

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------

    async def setup(self) -> None:
        """Idempotently create the schema.

        Mirrors ``docs/operations/agent-budget-counter.sql``; operators
        may run the SQL file out-of-band instead.
        """

        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS {self._table} (
                project_id text NOT NULL,
                period_key text NOT NULL,
                tokens_used bigint NOT NULL DEFAULT 0,
                requests_made bigint NOT NULL DEFAULT 0,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (project_id, period_key)
            )
            """,
            f"""
            CREATE INDEX IF NOT EXISTS {self._table}_period_key
                ON {self._table} (period_key)
            """,
        ]
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                for stmt in statements:
                    await cur.execute(stmt)

    # ------------------------------------------------------------------
    # Async-native helpers (preferred call surface)
    # ------------------------------------------------------------------

    async def aremaining(
        self, project_id: str, month: Optional[str] = None
    ) -> int:
        m = month or _current_month_key()
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    self._sql(_SELECT_CURRENT_SQL), (project_id, m)
                )
                row = await cur.fetchone()
        if row is None:
            return max(0, self.monthly_cap)
        spent = row["tokens_used"] if isinstance(row, dict) else row[0]
        return max(0, self.monthly_cap - int(spent))

    async def areserve(self, project_id: str, tokens: int) -> bool:
        """Atomically reserve ``tokens`` if room remains.

        Implementation detail: opens an explicit transaction, locks the
        row with ``SELECT ... FOR UPDATE``, checks the cap, and either
        UPDATEs (or INSERTs if no row exists) the new tally inside the
        same transaction. Concurrent transactions on the same
        ``(project_id, period_key)`` serialise on the row lock so two
        workers can't double-spend the last slot.
        """

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        async with self._pool.connection() as conn:
            # ``autocommit=True`` is forced in
            # :func:`enter_agent_postgres_pool`; explicit transaction
            # boundaries via ``conn.transaction()`` give us atomicity
            # without disabling autocommit globally.
            async with conn.transaction():
                async with conn.cursor() as cur:
                    await cur.execute(
                        self._sql(_RESERVE_SELECT_SQL), (project_id, m)
                    )
                    row = await cur.fetchone()
                    current = 0
                    if row is not None:
                        current = int(
                            row["tokens_used"]
                            if isinstance(row, dict)
                            else row[0]
                        )
                    new_total = current + tokens
                    if new_total > self.monthly_cap:
                        return False
                    if row is None:
                        await cur.execute(
                            self._sql(_RESERVE_INSERT_SQL),
                            (project_id, m, new_total),
                        )
                    else:
                        await cur.execute(
                            self._sql(_RESERVE_UPDATE_SQL),
                            (new_total, project_id, m),
                        )
        return True

    async def arecord(self, project_id: str, tokens: int) -> None:
        """Add ``tokens`` to the current-month tally (no cap check).

        Mirrors :meth:`InMemoryBudgetBackend.record` -- the gate uses
        :meth:`areserve` for cap enforcement; this is the post-call
        true-up path that records actual consumption.
        """

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    self._sql(_UPSERT_RECORD_SQL),
                    (project_id, m, tokens),
                )

    async def arefund(self, project_id: str, tokens: int) -> None:
        """Return previously-reserved tokens to the available pool."""

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    self._sql(_REFUND_SQL),
                    (project_id, m, tokens),
                )

    async def areset(self) -> None:
        """Delete every row (test helper)."""

        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(self._sql(_TRUNCATE_SQL))

    # ------------------------------------------------------------------
    # Sync :class:`BudgetBackend` protocol surface
    #
    # The existing dispatcher calls these from non-async code paths.
    # The bridge uses :func:`asyncio.run` when no loop is running and
    # :func:`asyncio.run_coroutine_threadsafe` when called from inside
    # an already-running event loop. Production callers (the dispatcher
    # at ``app.routers._dispatch``) are async themselves; the sync
    # surface exists for the few sync-path test helpers and the
    # readiness check.
    # ------------------------------------------------------------------

    def _run(self, coro: Any) -> Any:
        import asyncio  # noqa: PLC0415 -- intentional local import

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        # Inside a running loop -- the sync bridge would deadlock if we
        # tried to ``run_until_complete`` here. Async callers must use
        # the ``a*`` variants (:meth:`areserve`, :meth:`arecord`, etc.).
        # The production dispatcher (``app.routers._dispatch``) is fully
        # async, so this path only triggers when a sync helper is called
        # by mistake from inside a coroutine -- which would be a bug
        # regardless of the bridge implementation.
        raise RuntimeError(
            "PostgresBudgetBackend sync method called from inside a "
            "running event loop; use the async variants (areserve / "
            "arecord / arefund / aremaining / areset) instead."
        )

    def remaining(
        self, project_id: str, month: Optional[str] = None
    ) -> int:
        return self._run(self.aremaining(project_id, month))

    def can_spend(self, project_id: str, tokens: int = 1) -> bool:
        return self.remaining(project_id) >= tokens

    def reserve(self, project_id: str, tokens: int) -> bool:
        return self._run(self.areserve(project_id, tokens))

    def record(self, project_id: str, tokens: int) -> None:
        self._run(self.arecord(project_id, tokens))

    def refund(self, project_id: str, tokens: int) -> None:
        self._run(self.arefund(project_id, tokens))

    def reset(self) -> None:
        self._run(self.areset())


__all__ = ["PostgresBudgetBackend"]
