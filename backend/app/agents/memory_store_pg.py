"""Postgres-backed :class:`MemoryStore`.

Multi-worker-safe durable storage for agent memory. Uses the same
``psycopg`` + ``psycopg_pool.AsyncConnectionPool`` pattern as
:mod:`app.agents.checkpointing` so the same connection pool that backs
LangGraph checkpoints can be reused.

Schema lives at ``docs/operations/agent-memory.sql``; run it once per
Postgres cluster before enabling this backend. The table layout:

.. code-block:: sql

    agent_memory(
        id uuid PRIMARY KEY,
        project_id text NOT NULL,
        user_id text NULL,
        kind text NOT NULL,
        key text NOT NULL,
        value jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        expires_at timestamptz NULL
    )

with partial unique indexes over ``(project_id, user_id, kind, key)``
for per-user scopes and ``(project_id, kind, key)`` for project-wide
scopes (because Postgres treats NULLs as distinct in plain unique
constraints, the project-wide variant needs its own ``WHERE
user_id IS NULL`` partial index).

Upserts use ``INSERT ... ON CONFLICT ... DO UPDATE`` so concurrent
``remember`` calls don't race. ``recall`` with ``query`` is a simple
``ILIKE`` over ``value::text || ' ' || key`` -- vector search remains a
separate concern owned by :mod:`app.agents.task_vector_pg`.

Wiring into the agent runtime is deliberately deferred to a future
workstream; this module ships the storage primitives with full test
coverage.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Optional

from app.agents.memory_store import MemoryEntry, MemoryScope, MemoryStore

if TYPE_CHECKING:  # pragma: no cover - import-time only
    from app.config import Settings

logger = logging.getLogger(__name__)


_DEFAULT_TABLE = "agent_memory"


# ---------------------------------------------------------------------------
# SQL fragments
#
# Kept as module-level constants so test suites can match on the exact
# query when running against a fake connection. Each constant is
# prepared with ``{table}`` so we can re-target a non-default table name
# (handy for testing alongside production data on the same database).
# ---------------------------------------------------------------------------


_UPSERT_PER_USER_SQL = """
INSERT INTO {table}
    (id, project_id, user_id, kind, key, value, created_at, updated_at, expires_at)
VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
ON CONFLICT (project_id, user_id, kind, key)
    WHERE user_id IS NOT NULL
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at,
    expires_at = EXCLUDED.expires_at
RETURNING id, project_id, user_id, kind, key, value, created_at, updated_at, expires_at
"""

_UPSERT_PROJECT_WIDE_SQL = """
INSERT INTO {table}
    (id, project_id, user_id, kind, key, value, created_at, updated_at, expires_at)
VALUES (%s, %s, NULL, %s, %s, %s::jsonb, %s, %s, %s)
ON CONFLICT (project_id, kind, key)
    WHERE user_id IS NULL
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at,
    expires_at = EXCLUDED.expires_at
RETURNING id, project_id, user_id, kind, key, value, created_at, updated_at, expires_at
"""


_RECALL_BASE_SQL = """
SELECT id, project_id, user_id, kind, key, value, created_at, updated_at, expires_at
FROM {table}
WHERE project_id = %s
  AND kind = %s
  AND (expires_at IS NULL OR expires_at > %s)
"""


_FORGET_PER_USER_SQL = """
DELETE FROM {table}
WHERE project_id = %s AND user_id = %s AND kind = %s AND key = %s
"""


_FORGET_PROJECT_WIDE_SQL = """
DELETE FROM {table}
WHERE project_id = %s AND user_id IS NULL AND kind = %s AND key = %s
"""


_LIST_SCOPES_SQL = """
SELECT DISTINCT user_id, kind
FROM {table}
WHERE project_id = %s
  AND (expires_at IS NULL OR expires_at > %s)
ORDER BY user_id NULLS FIRST, kind
"""


def _row_to_entry(row: Any) -> MemoryEntry:
    """Convert a psycopg ``dict_row`` (or tuple) row to :class:`MemoryEntry`.

    The row factory configured in
    :func:`app.agents.checkpointing.enter_agent_postgres_pool` is
    ``dict_row``, but tests inject simpler tuple-returning fakes -- we
    accept both.
    """

    if isinstance(row, dict):
        get = row.get
    else:
        # Positional access matches the column order of the SELECT/RETURNING
        # statements above.
        keys = (
            "id",
            "project_id",
            "user_id",
            "kind",
            "key",
            "value",
            "created_at",
            "updated_at",
            "expires_at",
        )
        as_dict = dict(zip(keys, row))
        get = as_dict.get

    value = get("value")
    if isinstance(value, (bytes, str)):
        # Postgres returns jsonb as a parsed object via psycopg by
        # default, but if a caller round-trips text we still want a
        # dict here.
        value = json.loads(value)
    if value is None:
        value = {}

    ttl_seconds: Optional[int] = None
    expires_at = get("expires_at")
    updated_at = get("updated_at")
    if expires_at is not None and updated_at is not None:
        # Recover the configured TTL so consumers can re-display it.
        delta = expires_at - updated_at
        ttl_seconds = max(0, int(delta.total_seconds()))

    return MemoryEntry(
        id=str(get("id")),
        scope=MemoryScope(
            project_id=str(get("project_id")),
            user_id=get("user_id"),
            kind=str(get("kind")),
        ),
        key=str(get("key")),
        value=value if isinstance(value, dict) else {"_": value},
        created_at=get("created_at"),
        updated_at=updated_at,
        ttl_seconds=ttl_seconds,
        expires_at=expires_at,
    )


class PostgresMemoryStore(MemoryStore):
    """Async :class:`MemoryStore` backed by a Postgres table.

    Construction takes an :class:`~psycopg_pool.AsyncConnectionPool` so
    the pool's lifetime can be owned by the FastAPI lifespan via
    :func:`app.agents.checkpointing.enter_agent_postgres_pool`. The pool
    is the same pattern as :class:`AsyncPostgresSaver` /
    :class:`AsyncPostgresStore` use, so when both this store and the
    checkpoint saver are configured for Postgres with the same DSN, a
    single pool is shared.

    The :meth:`setup` coroutine is idempotent: it executes the same
    ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``
    statements as the SQL file at ``docs/operations/agent-memory.sql``.
    Operators should still prefer running the SQL file out-of-band
    (it's reviewable in a migration PR), but :meth:`setup` exists so
    test harnesses don't need a separate provisioning step.
    """

    def __init__(self, pool: Any, *, table: str = _DEFAULT_TABLE) -> None:
        self._pool = pool
        self._table = table

    # -- helpers ---------------------------------------------------------

    def _sql(self, template: str) -> str:
        return template.format(table=self._table)

    async def _execute(
        self, sql: str, args: tuple[Any, ...]
    ) -> list[Any]:
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, args)
                if cur.description is None:
                    return []
                rows = await cur.fetchall()
                return list(rows)

    # -- protocol --------------------------------------------------------

    async def setup(self) -> None:
        """Idempotently create the schema.

        Mirrors ``docs/operations/agent-memory.sql``; operators may run
        the SQL file out-of-band instead.
        """

        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS {self._table} (
                id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
                project_id text NOT NULL,
                user_id text NULL,
                kind text NOT NULL,
                key text NOT NULL,
                value jsonb NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NULL
            )
            """,
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {self._table}_scope_user_key
                ON {self._table} (project_id, user_id, kind, key)
                WHERE user_id IS NOT NULL
            """,
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {self._table}_scope_project_key
                ON {self._table} (project_id, kind, key)
                WHERE user_id IS NULL
            """,
            f"""
            CREATE INDEX IF NOT EXISTS {self._table}_scope_lookup
                ON {self._table} (project_id, kind, updated_at DESC)
            """,
            f"""
            CREATE INDEX IF NOT EXISTS {self._table}_expires_at
                ON {self._table} (expires_at)
                WHERE expires_at IS NOT NULL
            """,
        ]
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                for stmt in statements:
                    await cur.execute(stmt)

    async def remember(
        self,
        scope: MemoryScope,
        key: str,
        value: dict,
        *,
        ttl_seconds: Optional[int] = None,
    ) -> MemoryEntry:
        if not key:
            raise ValueError("key must be a non-empty string")
        if ttl_seconds is not None and ttl_seconds < 0:
            raise ValueError("ttl_seconds must be non-negative")

        now = datetime.now(timezone.utc)
        expires_at = (
            now + timedelta(seconds=ttl_seconds)
            if ttl_seconds is not None
            else None
        )
        entry_id = str(uuid.uuid4())
        value_json = json.dumps(value)

        if scope.user_id is None:
            sql = self._sql(_UPSERT_PROJECT_WIDE_SQL)
            args: tuple[Any, ...] = (
                entry_id,
                scope.project_id,
                scope.kind,
                key,
                value_json,
                now,
                now,
                expires_at,
            )
        else:
            sql = self._sql(_UPSERT_PER_USER_SQL)
            args = (
                entry_id,
                scope.project_id,
                scope.user_id,
                scope.kind,
                key,
                value_json,
                now,
                now,
                expires_at,
            )

        rows = await self._execute(sql, args)
        if not rows:  # pragma: no cover - defensive
            raise RuntimeError(
                "agent_memory upsert returned no row; check schema deployment"
            )
        return _row_to_entry(rows[0])

    async def recall(
        self,
        scope: MemoryScope,
        *,
        key: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        if limit < 0:
            raise ValueError("limit must be non-negative")
        now = datetime.now(timezone.utc)

        clauses: list[str] = []
        args: list[Any] = [scope.project_id, scope.kind, now]
        if scope.user_id is None:
            clauses.append("user_id IS NULL")
        else:
            clauses.append("user_id = %s")
            args.append(scope.user_id)
        if key is not None:
            clauses.append("key = %s")
            args.append(key)
        order = "key ASC, updated_at ASC"
        if query:
            # ILIKE over the JSON text + key so a recall("design") finds
            # entries whose value mentions "design" anywhere. The cast
            # to text plus concatenation guarantees we cover both the
            # key column and the JSON content in one predicate.
            clauses.append("(value::text ILIKE %s OR key ILIKE %s)")
            needle = f"%{query}%"
            args.extend([needle, needle])
            order = "updated_at DESC"
        args.append(limit)

        sql = self._sql(_RECALL_BASE_SQL)
        if clauses:
            sql = sql + " AND " + " AND ".join(clauses)
        sql = sql + f" ORDER BY {order} LIMIT %s"

        rows = await self._execute(sql, tuple(args))
        return [_row_to_entry(r) for r in rows]

    async def forget(self, scope: MemoryScope, key: str) -> bool:
        if not key:
            raise ValueError("key must be a non-empty string")
        if scope.user_id is None:
            sql = self._sql(_FORGET_PROJECT_WIDE_SQL)
            args = (scope.project_id, scope.kind, key)
        else:
            sql = self._sql(_FORGET_PER_USER_SQL)
            args = (scope.project_id, scope.user_id, scope.kind, key)
        async with self._pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, args)
                return cur.rowcount > 0

    async def list_scopes(self, project_id: str) -> list[MemoryScope]:
        now = datetime.now(timezone.utc)
        rows = await self._execute(
            self._sql(_LIST_SCOPES_SQL), (project_id, now)
        )
        out: list[MemoryScope] = []
        for row in rows:
            if isinstance(row, dict):
                uid = row.get("user_id")
                kind = row.get("kind")
            else:
                uid, kind = row[0], row[1]
            out.append(
                MemoryScope(
                    project_id=project_id,
                    user_id=uid,
                    kind=str(kind),
                )
            )
        return out


async def open_memory_store(
    backend: str,
    *,
    pool: Optional[Any] = None,
    settings: Optional["Settings"] = None,
    table: str = _DEFAULT_TABLE,
) -> Optional[MemoryStore]:
    """Factory: build a memory store for ``backend``.

    - ``"none"`` / ``""`` / ``"disabled"`` → ``None``
    - ``"memory"`` → :class:`InMemoryMemoryStore`
    - ``"postgres"`` → :class:`PostgresMemoryStore` over ``pool`` (or a
      pool resolved from ``settings`` via
      :func:`app.agents.checkpointing.resolve_agent_postgres_uri`)

    The future wiring step (out of scope here) will call this from the
    FastAPI lifespan inside an :class:`AsyncExitStack` so the pool's
    lifetime is bounded by the app.
    """

    normalized = (backend or "").strip().lower()
    if normalized in {"", "none", "off", "disabled"}:
        return None
    if normalized == "memory":
        from app.agents.memory_store import InMemoryMemoryStore

        return InMemoryMemoryStore()
    if normalized == "postgres":
        if pool is None:
            raise RuntimeError(
                "open_memory_store(backend='postgres') requires a pool; "
                "pass one from app.agents.checkpointing.enter_agent_postgres_pool"
            )
        return PostgresMemoryStore(pool, table=table)
    raise RuntimeError(
        f"Unsupported AGENT_MEMORY_BACKEND: {backend!r}; "
        "expected one of: none, memory, postgres"
    )


__all__ = [
    "PostgresMemoryStore",
    "open_memory_store",
]
