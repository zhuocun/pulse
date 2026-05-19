"""Tests for the in-memory durable agent memory store.

Validates the :class:`MemoryStore` protocol via the
:class:`InMemoryMemoryStore` backend:

- remember/recall/forget round-trip
- scope isolation (project_id, user_id, kind partitioning)
- query filtering (substring match on value/key)
- TTL expiry
- ``list_scopes`` enumeration

The Postgres backend's tests live in :mod:`tests.test_memory_store_pg`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.agents.memory_store import (
    InMemoryMemoryStore,
    MemoryEntry,
    MemoryScope,
    MemoryStore,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(coro):
    """Sync wrapper matching the project's existing async-test pattern."""

    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Basic CRUD
# ---------------------------------------------------------------------------


def test_in_memory_remember_recall_round_trip() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p1", user_id="u1", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "ui.theme", {"value": "dark"})
        return await store.recall(scope)

    entries = _run(run())
    assert len(entries) == 1
    only = entries[0]
    assert only.key == "ui.theme"
    assert only.value == {"value": "dark"}
    assert only.scope == scope
    assert only.created_at <= only.updated_at
    assert only.ttl_seconds is None
    assert only.expires_at is None


def test_in_memory_remember_is_an_upsert() -> None:
    """A second remember on the same key overwrites value + updated_at."""

    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")

    async def run() -> tuple[MemoryEntry, MemoryEntry]:
        first = await store.remember(scope, "release.cadence", {"days": 14})
        second = await store.remember(scope, "release.cadence", {"days": 7})
        return first, second

    first, second = _run(run())
    assert first.id == second.id  # id is stable across upserts
    assert second.value == {"days": 7}
    assert second.created_at == first.created_at
    assert second.updated_at >= first.updated_at


def test_in_memory_forget_returns_true_only_when_entry_existed() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> tuple[bool, bool, list[MemoryEntry]]:
        await store.remember(scope, "k", {"v": 1})
        first = await store.forget(scope, "k")
        second = await store.forget(scope, "k")
        return first, second, await store.recall(scope)

    first, second, remaining = _run(run())
    assert first is True
    assert second is False
    assert remaining == []


def test_in_memory_remember_rejects_empty_key() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    with pytest.raises(ValueError):
        _run(store.remember(scope, "", {"v": 1}))


def test_in_memory_remember_rejects_negative_ttl() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    with pytest.raises(ValueError):
        _run(store.remember(scope, "k", {"v": 1}, ttl_seconds=-1))


def test_in_memory_recall_rejects_negative_limit() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id=None, kind="fact")
    with pytest.raises(ValueError):
        _run(store.recall(scope, limit=-1))


# ---------------------------------------------------------------------------
# Scope isolation
# ---------------------------------------------------------------------------


def test_in_memory_scope_isolation_across_projects() -> None:
    store = InMemoryMemoryStore()
    a = MemoryScope(project_id="proj-A", user_id="u", kind="preference")
    b = MemoryScope(project_id="proj-B", user_id="u", kind="preference")

    async def run() -> tuple[list[MemoryEntry], list[MemoryEntry]]:
        await store.remember(a, "k", {"in": "A"})
        await store.remember(b, "k", {"in": "B"})
        return await store.recall(a), await store.recall(b)

    out_a, out_b = _run(run())
    assert [e.value for e in out_a] == [{"in": "A"}]
    assert [e.value for e in out_b] == [{"in": "B"}]


def test_in_memory_scope_isolation_across_users() -> None:
    store = InMemoryMemoryStore()
    u1 = MemoryScope(project_id="p", user_id="alice", kind="preference")
    u2 = MemoryScope(project_id="p", user_id="bob", kind="preference")

    async def run() -> tuple[list[MemoryEntry], list[MemoryEntry]]:
        await store.remember(u1, "ui.theme", {"value": "dark"})
        await store.remember(u2, "ui.theme", {"value": "light"})
        return await store.recall(u1), await store.recall(u2)

    out_a, out_b = _run(run())
    assert [e.value for e in out_a] == [{"value": "dark"}]
    assert [e.value for e in out_b] == [{"value": "light"}]


def test_in_memory_scope_isolation_project_wide_vs_per_user() -> None:
    """user_id=None is a distinct scope from any per-user scope."""

    store = InMemoryMemoryStore()
    project_wide = MemoryScope(project_id="p", user_id=None, kind="preference")
    per_user = MemoryScope(project_id="p", user_id="u1", kind="preference")

    async def run() -> tuple[list[MemoryEntry], list[MemoryEntry]]:
        await store.remember(project_wide, "k", {"who": "team"})
        await store.remember(per_user, "k", {"who": "alice"})
        return await store.recall(project_wide), await store.recall(per_user)

    a, b = _run(run())
    assert [e.value for e in a] == [{"who": "team"}]
    assert [e.value for e in b] == [{"who": "alice"}]


def test_in_memory_scope_isolation_across_kinds() -> None:
    store = InMemoryMemoryStore()
    pref = MemoryScope(project_id="p", user_id="u", kind="preference")
    fact = MemoryScope(project_id="p", user_id="u", kind="fact")

    async def run() -> tuple[list[MemoryEntry], list[MemoryEntry]]:
        await store.remember(pref, "k", {"in": "pref"})
        await store.remember(fact, "k", {"in": "fact"})
        return await store.recall(pref), await store.recall(fact)

    a, b = _run(run())
    assert [e.value for e in a] == [{"in": "pref"}]
    assert [e.value for e in b] == [{"in": "fact"}]


def test_in_memory_forget_on_one_scope_leaves_others_intact() -> None:
    store = InMemoryMemoryStore()
    a = MemoryScope(project_id="proj-A", user_id="u", kind="preference")
    b = MemoryScope(project_id="proj-B", user_id="u", kind="preference")

    async def run() -> tuple[bool, list[MemoryEntry]]:
        await store.remember(a, "k", {"in": "A"})
        await store.remember(b, "k", {"in": "B"})
        deleted = await store.forget(a, "k")
        return deleted, await store.recall(b)

    deleted, out_b = _run(run())
    assert deleted is True
    assert [e.value for e in out_b] == [{"in": "B"}]


# ---------------------------------------------------------------------------
# Recall variations
# ---------------------------------------------------------------------------


def test_in_memory_recall_by_key_filters_to_exact_match() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "ui.theme", {"v": "dark"})
        await store.remember(scope, "ui.language", {"v": "en"})
        return await store.recall(scope, key="ui.theme")

    entries = _run(run())
    assert len(entries) == 1
    assert entries[0].key == "ui.theme"


def test_in_memory_recall_query_matches_value_substring() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "k1", {"note": "design template"})
        await store.remember(scope, "k2", {"note": "code review template"})
        await store.remember(scope, "k3", {"note": "unrelated"})
        return await store.recall(scope, query="template")

    entries = _run(run())
    assert {e.key for e in entries} == {"k1", "k2"}


def test_in_memory_recall_query_matches_key_substring() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "ui.theme", {"v": 1})
        await store.remember(scope, "language", {"v": 2})
        return await store.recall(scope, query="theme")

    entries = _run(run())
    assert [e.key for e in entries] == ["ui.theme"]


def test_in_memory_recall_query_orders_most_recently_updated_first() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "k1", {"note": "alpha"})
        # Small sleep ensures distinct updated_at timestamps even on
        # platforms with low clock resolution.
        await asyncio.sleep(0.01)
        await store.remember(scope, "k2", {"note": "alpha"})
        await asyncio.sleep(0.01)
        await store.remember(scope, "k3", {"note": "alpha"})
        return await store.recall(scope, query="alpha")

    entries = _run(run())
    assert [e.key for e in entries] == ["k3", "k2", "k1"]


def test_in_memory_recall_limit_caps_results() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        for i in range(5):
            await store.remember(scope, f"k{i}", {"v": i})
        return await store.recall(scope, limit=3)

    entries = _run(run())
    assert len(entries) == 3


def test_in_memory_recall_empty_scope_returns_empty_list() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    assert _run(store.recall(scope)) == []


# ---------------------------------------------------------------------------
# TTL expiry
# ---------------------------------------------------------------------------


def test_in_memory_ttl_zero_expires_immediately() -> None:
    """``ttl_seconds=0`` means the entry is expired the moment it lands.

    Boundary test for the lazy-expiry pruning -- a strict
    ``now >= expires_at`` comparison treats a zero TTL as immediately
    expired, which matches the documented semantics for the postgres
    backend (NOW() vs expires_at in SQL).
    """

    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "k", {"v": 1}, ttl_seconds=0)
        return await store.recall(scope)

    assert _run(run()) == []


def test_in_memory_ttl_future_entries_survive_recall() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "k", {"v": 1}, ttl_seconds=3600)
        return await store.recall(scope)

    entries = _run(run())
    assert len(entries) == 1
    assert entries[0].ttl_seconds == 3600
    assert entries[0].expires_at is not None


def test_memory_entry_is_expired_with_explicit_now() -> None:
    """Direct check on :meth:`MemoryEntry.is_expired` -- mocking the clock."""

    now = datetime.now(timezone.utc)
    entry = MemoryEntry(
        id="x",
        scope=MemoryScope(project_id="p", user_id=None, kind="preference"),
        key="k",
        value={},
        created_at=now,
        updated_at=now,
        ttl_seconds=60,
        expires_at=now + timedelta(seconds=60),
    )
    assert entry.is_expired(now=now + timedelta(seconds=30)) is False
    assert entry.is_expired(now=now + timedelta(seconds=60)) is True
    assert entry.is_expired(now=now + timedelta(seconds=61)) is True


def test_memory_entry_without_expiry_is_never_expired() -> None:
    now = datetime.now(timezone.utc)
    entry = MemoryEntry(
        id="x",
        scope=MemoryScope(project_id="p", user_id=None, kind="preference"),
        key="k",
        value={},
        created_at=now,
        updated_at=now,
    )
    assert entry.is_expired() is False
    assert entry.is_expired(now=now + timedelta(days=365)) is False


# ---------------------------------------------------------------------------
# list_scopes
# ---------------------------------------------------------------------------


def test_in_memory_list_scopes_returns_distinct_buckets() -> None:
    store = InMemoryMemoryStore()

    async def run() -> list[MemoryScope]:
        await store.remember(
            MemoryScope(project_id="p", user_id=None, kind="preference"),
            "k",
            {"v": 1},
        )
        await store.remember(
            MemoryScope(project_id="p", user_id="u1", kind="preference"),
            "k",
            {"v": 2},
        )
        await store.remember(
            MemoryScope(project_id="p", user_id="u1", kind="fact"),
            "k",
            {"v": 3},
        )
        # Different project -- must not surface here.
        await store.remember(
            MemoryScope(project_id="other", user_id="u1", kind="preference"),
            "k",
            {"v": 4},
        )
        return await store.list_scopes("p")

    scopes = _run(run())
    triples = {(s.project_id, s.user_id, s.kind) for s in scopes}
    assert triples == {
        ("p", None, "preference"),
        ("p", "u1", "preference"),
        ("p", "u1", "fact"),
    }


def test_in_memory_list_scopes_skips_buckets_with_only_expired_entries() -> None:
    store = InMemoryMemoryStore()

    async def run() -> list[MemoryScope]:
        await store.remember(
            MemoryScope(project_id="p", user_id="u", kind="ephemeral"),
            "k",
            {"v": 1},
            ttl_seconds=0,
        )
        await store.remember(
            MemoryScope(project_id="p", user_id="u", kind="durable"),
            "k",
            {"v": 1},
        )
        return await store.list_scopes("p")

    scopes = _run(run())
    assert [s.kind for s in scopes] == ["durable"]


def test_in_memory_list_scopes_returns_empty_for_unknown_project() -> None:
    store = InMemoryMemoryStore()
    assert _run(store.list_scopes("nonexistent")) == []


# ---------------------------------------------------------------------------
# Protocol compliance + helper paths
# ---------------------------------------------------------------------------


def test_in_memory_store_satisfies_protocol() -> None:
    store = InMemoryMemoryStore()
    assert isinstance(store, MemoryStore)


def test_in_memory_reset_clears_state() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")

    async def run() -> list[MemoryEntry]:
        await store.remember(scope, "k", {"v": 1})
        await store.reset()
        return await store.recall(scope)

    assert _run(run()) == []


def test_memory_scope_matches_helper() -> None:
    s1 = MemoryScope(project_id="p", user_id="u", kind="preference")
    s2 = MemoryScope(project_id="p", user_id="u", kind="preference")
    s3 = MemoryScope(project_id="p", user_id="other", kind="preference")
    assert s1.matches(s2)
    assert not s1.matches(s3)


def test_remember_clones_value_dict_so_caller_mutation_doesnt_leak() -> None:
    store = InMemoryMemoryStore()
    scope = MemoryScope(project_id="p", user_id="u", kind="preference")
    payload = {"value": "dark"}

    async def run() -> MemoryEntry:
        await store.remember(scope, "ui.theme", payload)
        payload["value"] = "light"  # mutate after handoff
        out = await store.recall(scope)
        return out[0]

    entry = _run(run())
    assert entry.value == {"value": "dark"}


# ---------------------------------------------------------------------------
# Factory dispatch (open_memory_store) -- exercised here for the
# in-memory / disabled paths; postgres factory tested in the pg module.
# ---------------------------------------------------------------------------


def test_open_memory_store_memory_returns_in_memory_backend() -> None:
    from app.agents.memory_store_pg import open_memory_store

    store = _run(open_memory_store("memory"))
    assert isinstance(store, InMemoryMemoryStore)


def test_open_memory_store_disabled_returns_none() -> None:
    from app.agents.memory_store_pg import open_memory_store

    for backend in ("none", "", "off", "disabled", "  NONE  "):
        assert _run(open_memory_store(backend)) is None


def test_open_memory_store_unsupported_raises() -> None:
    from app.agents.memory_store_pg import open_memory_store

    with pytest.raises(RuntimeError, match="Unsupported AGENT_MEMORY_BACKEND"):
        _run(open_memory_store("sqlite"))


def test_open_memory_store_postgres_requires_pool() -> None:
    from app.agents.memory_store_pg import open_memory_store

    with pytest.raises(RuntimeError, match="requires a pool"):
        _run(open_memory_store("postgres"))
