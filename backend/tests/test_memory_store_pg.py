"""Tests for the Postgres-backed agent memory store.

Two test surfaces:

1. Pure-Python fakes for the psycopg pool/cursor so we can validate
   SQL shape, parameter binding, and result decoding without a live
   database. This keeps the hermetic test suite green above the
   coverage floor.

2. An optional live-Postgres smoke test, gated by
   ``PYTEST_AGENT_POSTGRES_URI``. When set we run the full
   remember/recall/forget cycle against the real DB so the SQL we
   send actually works against the engine -- mirrors
   :mod:`tests.test_agents_postgres_live`.

Pattern matches :mod:`tests.test_task_vector_pg` for the fake-psycopg
approach and :mod:`tests.test_agents_postgres_live` for the live skip.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import pytest

from app.agents.memory_store import MemoryEntry, MemoryScope
from app.agents.memory_store_pg import (
    PostgresMemoryStore,
    _row_to_entry,
    open_memory_store,
)


# ---------------------------------------------------------------------------
# Fake psycopg-style pool + cursor
# ---------------------------------------------------------------------------


class _FakeCursor:
    """Records executed SQL + binds and replays scripted result sets."""

    def __init__(self, parent: "_FakeConn") -> None:
        self.parent = parent
        self._rows: list[Any] = []
        self.description: Any = None
        self.rowcount: int = 0

    async def __aenter__(self) -> "_FakeCursor":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def execute(self, sql: str, args: tuple[Any, ...] = ()) -> None:
        self.parent.executed.append((sql.strip(), args))
        # Look up scripted result by a substring match against the SQL.
        for predicate, rows in self.parent.scripts:
            if predicate in sql:
                self._rows = list(rows)
                self.description = tuple(("col", None) for _ in range(9))
                self.rowcount = len(rows)
                return
        self._rows = []
        self.description = None
        self.rowcount = 0

    async def fetchall(self) -> list[Any]:
        return list(self._rows)

    async def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None


class _FakeConn:
    def __init__(
        self, executed: list[tuple[str, tuple[Any, ...]]], scripts: list[tuple[str, list[Any]]]
    ) -> None:
        self.executed = executed
        self.scripts = scripts

    @asynccontextmanager
    async def cursor(self) -> Any:
        cur = _FakeCursor(self)
        yield cur

    @asynccontextmanager
    async def transaction(self) -> Any:
        yield self


class _FakePool:
    """Mimics :class:`psycopg_pool.AsyncConnectionPool` for tests."""

    def __init__(self, scripts: list[tuple[str, list[Any]]] | None = None) -> None:
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self.scripts: list[tuple[str, list[Any]]] = list(scripts or [])

    @asynccontextmanager
    async def connection(self) -> Any:
        yield _FakeConn(self.executed, self.scripts)

    def script(self, sql_fragment: str, rows: list[Any]) -> None:
        self.scripts.append((sql_fragment, rows))


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# _row_to_entry decoder
# ---------------------------------------------------------------------------


def test_row_to_entry_decodes_dict_row() -> None:
    now = datetime.now(timezone.utc)
    row = {
        "id": uuid.uuid4(),
        "project_id": "p",
        "user_id": "u",
        "kind": "preference",
        "key": "ui.theme",
        "value": {"v": "dark"},
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
    }
    entry = _row_to_entry(row)
    assert isinstance(entry, MemoryEntry)
    assert entry.scope == MemoryScope(
        project_id="p", user_id="u", kind="preference"
    )
    assert entry.key == "ui.theme"
    assert entry.value == {"v": "dark"}
    assert entry.ttl_seconds is None


def test_row_to_entry_decodes_tuple_row() -> None:
    now = datetime.now(timezone.utc)
    row = (
        str(uuid.uuid4()),
        "p",
        None,
        "fact",
        "release.cadence",
        {"days": 7},
        now,
        now,
        None,
    )
    entry = _row_to_entry(row)
    assert entry.scope.user_id is None
    assert entry.value == {"days": 7}


def test_row_to_entry_parses_json_text_value() -> None:
    """A value column round-tripped as text JSON still decodes."""

    now = datetime.now(timezone.utc)
    row = {
        "id": "x",
        "project_id": "p",
        "user_id": None,
        "kind": "fact",
        "key": "k",
        "value": '{"raw": true}',  # text JSON, not dict
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
    }
    entry = _row_to_entry(row)
    assert entry.value == {"raw": True}


def test_row_to_entry_recovers_ttl_from_expires_at_minus_updated_at() -> None:
    now = datetime.now(timezone.utc)
    from datetime import timedelta

    row = {
        "id": "x",
        "project_id": "p",
        "user_id": "u",
        "kind": "preference",
        "key": "k",
        "value": {},
        "created_at": now,
        "updated_at": now,
        "expires_at": now + timedelta(seconds=90),
    }
    entry = _row_to_entry(row)
    assert entry.ttl_seconds == 90


def test_row_to_entry_handles_null_value_column() -> None:
    """A NULL value column shouldn't break the decoder."""

    now = datetime.now(timezone.utc)
    row = {
        "id": "x",
        "project_id": "p",
        "user_id": None,
        "kind": "fact",
        "key": "k",
        "value": None,
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
    }
    entry = _row_to_entry(row)
    assert entry.value == {}


def test_row_to_entry_wraps_non_dict_scalar_value() -> None:
    """Defensive: a stored bool/int/str shouldn't crash the Pydantic model."""

    now = datetime.now(timezone.utc)
    row = {
        "id": "x",
        "project_id": "p",
        "user_id": None,
        "kind": "fact",
        "key": "k",
        "value": 42,
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
    }
    entry = _row_to_entry(row)
    assert entry.value == {"_": 42}


# ---------------------------------------------------------------------------
# remember / recall / forget against the fake pool
# ---------------------------------------------------------------------------


def _stub_returning_row(scope: MemoryScope, key: str, value: dict) -> list[Any]:
    now = datetime.now(timezone.utc)
    return [
        {
            "id": uuid.uuid4(),
            "project_id": scope.project_id,
            "user_id": scope.user_id,
            "kind": scope.kind,
            "key": key,
            "value": value,
            "created_at": now,
            "updated_at": now,
            "expires_at": None,
        }
    ]


def test_pg_remember_per_user_uses_per_user_upsert_sql() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    pool.script("INSERT INTO agent_memory", _stub_returning_row(scope, "k", {"v": 1}))

    entry = _run(store.remember(scope, "k", {"v": 1}))
    assert entry.scope == scope
    last_sql, last_args = pool.executed[-1]
    # Per-user upsert always supplies user_id positionally.
    assert "user_id IS NOT NULL" in last_sql
    assert last_args[2] == "u"  # user_id arg at position 2


def test_pg_remember_project_wide_uses_project_wide_upsert_sql() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    pool.script("INSERT INTO agent_memory", _stub_returning_row(scope, "k", {"v": 1}))

    _run(store.remember(scope, "k", {"v": 1}))
    last_sql, last_args = pool.executed[-1]
    assert "user_id IS NULL" in last_sql
    # No user_id arg -- the 3rd positional is kind, not user_id.
    assert last_args[2] == "fact"


def test_pg_remember_passes_value_as_json_string() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    pool.script("INSERT INTO agent_memory", _stub_returning_row(scope, "k", {"v": 1}))
    _run(store.remember(scope, "k", {"a": [1, 2, 3]}))
    last_sql, last_args = pool.executed[-1]
    # value arg position depends on scope; just confirm we serialised to JSON.
    serialised = [a for a in last_args if isinstance(a, str) and a.startswith("{")]
    assert serialised, f"expected json string in {last_args!r}"
    assert json.loads(serialised[0]) == {"a": [1, 2, 3]}


def test_pg_remember_sets_expires_at_when_ttl_given() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    pool.script("INSERT INTO agent_memory", _stub_returning_row(scope, "k", {"v": 1}))
    _run(store.remember(scope, "k", {"v": 1}, ttl_seconds=60))
    _, last_args = pool.executed[-1]
    # expires_at is the last positional arg in the upsert call.
    assert isinstance(last_args[-1], datetime)


def test_pg_remember_no_ttl_passes_null_for_expires_at() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    pool.script("INSERT INTO agent_memory", _stub_returning_row(scope, "k", {"v": 1}))
    _run(store.remember(scope, "k", {"v": 1}))
    _, last_args = pool.executed[-1]
    assert last_args[-1] is None


def test_pg_remember_rejects_empty_key() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    with pytest.raises(ValueError):
        _run(store.remember(scope, "", {"v": 1}))


def test_pg_remember_rejects_negative_ttl() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    with pytest.raises(ValueError):
        _run(store.remember(scope, "k", {"v": 1}, ttl_seconds=-1))


def test_pg_recall_filters_by_user_when_scope_has_user() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    _run(store.recall(scope))
    last_sql, _ = pool.executed[-1]
    assert "user_id = %s" in last_sql


def test_pg_recall_filters_by_null_user_when_scope_is_project_wide() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    _run(store.recall(scope))
    last_sql, _ = pool.executed[-1]
    assert "user_id IS NULL" in last_sql


def test_pg_recall_with_query_uses_ilike_and_orders_by_updated_at_desc() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    _run(store.recall(scope, query="template"))
    last_sql, last_args = pool.executed[-1]
    assert "ILIKE" in last_sql
    assert "ORDER BY updated_at DESC" in last_sql
    assert "%template%" in last_args


def test_pg_recall_without_query_orders_by_key_asc() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    _run(store.recall(scope))
    last_sql, _ = pool.executed[-1]
    assert "ORDER BY key ASC, updated_at ASC" in last_sql


def test_pg_recall_with_key_filters_to_exact_key() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    _run(store.recall(scope, key="ui.theme"))
    last_sql, last_args = pool.executed[-1]
    assert "key = %s" in last_sql
    assert "ui.theme" in last_args


def test_pg_recall_rejects_negative_limit() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    with pytest.raises(ValueError):
        _run(store.recall(scope, limit=-1))


def test_pg_recall_decodes_rows_into_entries() -> None:
    pool = _FakePool()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    pool.script(
        "SELECT id, project_id",
        _stub_returning_row(scope, "k", {"v": 1}),
    )
    store = PostgresMemoryStore(pool)
    entries = _run(store.recall(scope))
    assert len(entries) == 1
    assert entries[0].key == "k"


def test_pg_forget_per_user_uses_per_user_delete_sql() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    # rowcount is set by the fake based on scripted rows; set to 1 to
    # simulate a successful delete.
    pool.script("DELETE FROM agent_memory\nWHERE project_id = %s AND user_id = %s", [{"_": 1}])
    out = _run(store.forget(scope, "k"))
    assert out is True
    last_sql, last_args = pool.executed[-1]
    assert "user_id = %s" in last_sql
    assert last_args == ("p", "u", "preference", "k")


def test_pg_forget_project_wide_uses_null_user_delete_sql() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    pool.script("DELETE FROM agent_memory\nWHERE project_id = %s AND user_id IS NULL", [{"_": 1}])
    out = _run(store.forget(scope, "k"))
    assert out is True
    last_sql, last_args = pool.executed[-1]
    assert "user_id IS NULL" in last_sql
    assert last_args == ("p", "fact", "k")


def test_pg_forget_returns_false_when_no_row_deleted() -> None:
    pool = _FakePool()  # no scripts -> rowcount stays 0
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    assert _run(store.forget(scope, "k")) is False


def test_pg_forget_rejects_empty_key() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    with pytest.raises(ValueError):
        _run(store.forget(scope, ""))


def test_pg_list_scopes_decodes_dict_rows() -> None:
    pool = _FakePool()
    pool.script(
        "SELECT DISTINCT user_id, kind",
        [
            {"user_id": None, "kind": "preference"},
            {"user_id": "u1", "kind": "preference"},
            {"user_id": "u1", "kind": "fact"},
        ],
    )
    store = PostgresMemoryStore(pool)
    scopes = _run(store.list_scopes("p"))
    triples = {(s.project_id, s.user_id, s.kind) for s in scopes}
    assert triples == {
        ("p", None, "preference"),
        ("p", "u1", "preference"),
        ("p", "u1", "fact"),
    }


def test_pg_list_scopes_decodes_tuple_rows() -> None:
    pool = _FakePool()
    pool.script(
        "SELECT DISTINCT user_id, kind",
        [(None, "preference"), ("u1", "fact")],
    )
    store = PostgresMemoryStore(pool)
    scopes = _run(store.list_scopes("p"))
    assert {(s.user_id, s.kind) for s in scopes} == {
        (None, "preference"),
        ("u1", "fact"),
    }


def test_pg_setup_executes_create_statements() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool)
    _run(store.setup())
    statements = [sql for sql, _ in pool.executed]
    assert any("CREATE TABLE IF NOT EXISTS agent_memory" in s for s in statements)
    assert any("CREATE UNIQUE INDEX" in s for s in statements)


def test_pg_setup_honours_custom_table_name() -> None:
    pool = _FakePool()
    store = PostgresMemoryStore(pool, table="custom_table")
    _run(store.setup())
    assert any(
        "CREATE TABLE IF NOT EXISTS custom_table" in sql
        for sql, _ in pool.executed
    )


def test_pg_open_memory_store_returns_postgres_backend_with_pool() -> None:
    pool = _FakePool()
    store = _run(open_memory_store("postgres", pool=pool))
    assert isinstance(store, PostgresMemoryStore)


# ---------------------------------------------------------------------------
# Optional live-Postgres smoke
# ---------------------------------------------------------------------------


LIVE_DSN = os.getenv("PYTEST_AGENT_POSTGRES_URI", "").strip()


@pytest.mark.skipif(
    not LIVE_DSN,
    reason="set PYTEST_AGENT_POSTGRES_URI to run the live Postgres memory smoke test",
)
def test_live_postgres_memory_round_trip() -> None:
    """Full remember/recall/forget against a real Postgres."""

    psycopg_pool = pytest.importorskip("psycopg_pool")

    async def run() -> None:
        from psycopg.rows import dict_row

        async with AsyncExitStack() as stack:
            pool = psycopg_pool.AsyncConnectionPool(
                conninfo=LIVE_DSN,
                min_size=1,
                max_size=2,
                kwargs={
                    "autocommit": True,
                    "prepare_threshold": 0,
                    "row_factory": dict_row,
                },
                open=False,
            )
            await stack.enter_async_context(pool)

            # Use a uniquely-named table so concurrent test runs don't collide.
            table = f"agent_memory_test_{uuid.uuid4().hex[:8]}"
            store = PostgresMemoryStore(pool, table=table)
            await store.setup()

            try:
                scope = MemoryScope(
                    project_id="p-live", user_id="u-live", kind="preference"
                )
                # Remember
                entry = await store.remember(scope, "ui.theme", {"value": "dark"})
                assert entry.value == {"value": "dark"}

                # Recall by key
                fetched = await store.recall(scope, key="ui.theme")
                assert len(fetched) == 1
                assert fetched[0].value == {"value": "dark"}

                # Scope isolation
                other = MemoryScope(
                    project_id="p-live", user_id="u-other", kind="preference"
                )
                await store.remember(other, "ui.theme", {"value": "light"})
                assert (await store.recall(scope))[0].value == {"value": "dark"}

                # Forget
                deleted = await store.forget(scope, "ui.theme")
                assert deleted is True
                assert await store.recall(scope, key="ui.theme") == []
            finally:
                async with pool.connection() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(f"DROP TABLE IF EXISTS {table}")

    asyncio.run(run())
