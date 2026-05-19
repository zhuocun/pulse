"""Durable memory store for the Board Copilot agent.

Provides a small, backend-agnostic contract for storing and recalling
user / team preferences, facts, and shortcuts across sessions. Until
this module landed, the agent only had short-term checkpoint state +
task-similarity vectors; anything the user told the agent (``"always
use the design template for new bug reports"``, ``"PR titles need a
jira link"``) was forgotten between requests.

This module defines:

- :class:`MemoryScope`, :class:`MemoryEntry` — typed Pydantic payloads
  the future ``remember`` / ``forget`` tools (out of scope for this
  workstream) will pass to and receive from the store.
- :class:`MemoryStore` — Protocol every backend conforms to. Routers
  and tools depend on this Protocol, never on a concrete class, so the
  backend can be swapped at lifespan time.
- :class:`InMemoryMemoryStore` — the default for tests / dev. Holds
  entries in a dict guarded by an ``asyncio.Lock``; TTL enforcement is
  lazy (checked at read time).

The Postgres implementation lives in :mod:`app.agents.memory_store_pg`
and is imported lazily by the runtime so installs without psycopg keep
working. The schema for the postgres backend is at
``docs/operations/agent-memory.sql``.

Wiring into agents and the ``remember`` / ``forget`` tools is
intentionally deferred to a separate workstream; this module ships the
storage primitives with full test coverage and no behaviour changes to
existing routes.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------------------
# Typed payloads
# ---------------------------------------------------------------------------


class MemoryScope(BaseModel):
    """Identifies a logical namespace for memory entries.

    ``user_id`` is optional; ``None`` means the entry is project-wide
    (visible to every collaborator on the project). ``kind`` partitions
    semantically distinct caches under the same scope -- a
    ``"preference"`` and a ``"shortcut"`` with the same key never
    collide.
    """

    model_config = ConfigDict(frozen=True)

    project_id: str
    user_id: Optional[str] = None
    kind: str

    def matches(self, other: "MemoryScope") -> bool:
        """Whether two scopes refer to the exact same bucket."""

        return (
            self.project_id == other.project_id
            and self.user_id == other.user_id
            and self.kind == other.kind
        )


class MemoryEntry(BaseModel):
    """A single key/value memory bound to a scope.

    ``value`` is a free-form JSON-safe dict; the catalog layer is
    responsible for typing the payload further (e.g. a
    ``"preference"`` may always carry a ``{"label", "value"}`` shape).

    ``ttl_seconds`` is the *configured* TTL; the read side uses
    ``expires_at`` (or, for stores without persistence, recomputes it
    from ``updated_at + ttl_seconds``) to decide if an entry has expired.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    scope: MemoryScope
    key: str
    value: dict
    created_at: datetime
    updated_at: datetime
    ttl_seconds: Optional[int] = None
    expires_at: Optional[datetime] = None

    def is_expired(self, *, now: Optional[datetime] = None) -> bool:
        """Whether the entry has passed its expiry.

        Returns ``False`` when the entry has no TTL configured.
        """

        if self.expires_at is None:
            return False
        moment = now or datetime.now(timezone.utc)
        return moment >= self.expires_at


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class MemoryStore(Protocol):
    """Storage contract for durable agent memory.

    Backends:

    - :class:`InMemoryMemoryStore` -- in-process dict, tests and dev.
    - :class:`app.agents.memory_store_pg.PostgresMemoryStore` -- shared
      Postgres table, multi-worker safe.

    All methods are async because the postgres backend is async; the
    in-memory backend trivially satisfies the protocol by ``await``-ing
    nothing.
    """

    async def remember(
        self,
        scope: MemoryScope,
        key: str,
        value: dict,
        *,
        ttl_seconds: Optional[int] = None,
    ) -> MemoryEntry: ...

    async def recall(
        self,
        scope: MemoryScope,
        *,
        key: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> list[MemoryEntry]: ...

    async def forget(self, scope: MemoryScope, key: str) -> bool: ...

    async def list_scopes(self, project_id: str) -> list[MemoryScope]: ...


# ---------------------------------------------------------------------------
# In-memory backend
# ---------------------------------------------------------------------------


def _scope_key(scope: MemoryScope) -> tuple[str, Optional[str], str]:
    return (scope.project_id, scope.user_id, scope.kind)


def _compute_expires_at(
    *, ttl_seconds: Optional[int], now: datetime
) -> Optional[datetime]:
    if ttl_seconds is None:
        return None
    if ttl_seconds < 0:
        raise ValueError("ttl_seconds must be non-negative")
    return now + timedelta(seconds=ttl_seconds)


class InMemoryMemoryStore:
    """In-process :class:`MemoryStore` backed by a dict.

    Guarded by an :class:`asyncio.Lock` so concurrent ``remember`` /
    ``forget`` calls on the same scope serialise within one event
    loop. Process-local only: multi-worker deploys must switch to
    :class:`PostgresMemoryStore`.

    TTL enforcement is lazy -- expired entries stay in the dict until a
    read or write to the same key prunes them, at which point ``forget``
    semantics apply. :meth:`recall` filters out expired entries on the
    fly so callers never observe them.
    """

    def __init__(self) -> None:
        self._data: dict[
            tuple[str, Optional[str], str], dict[str, MemoryEntry]
        ] = {}
        self._lock = asyncio.Lock()

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
        now = datetime.now(timezone.utc)
        expires_at = _compute_expires_at(ttl_seconds=ttl_seconds, now=now)
        async with self._lock:
            bucket = self._data.setdefault(_scope_key(scope), {})
            existing = bucket.get(key)
            entry = MemoryEntry(
                id=existing.id if existing is not None else str(uuid.uuid4()),
                scope=scope,
                key=key,
                value=dict(value),
                created_at=existing.created_at if existing is not None else now,
                updated_at=now,
                ttl_seconds=ttl_seconds,
                expires_at=expires_at,
            )
            bucket[key] = entry
            return entry

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
        async with self._lock:
            bucket = self._data.get(_scope_key(scope), {})
            entries = [e for e in bucket.values() if not e.is_expired(now=now)]
        if key is not None:
            entries = [e for e in entries if e.key == key]
        if query:
            needle = query.casefold()

            def _matches(entry: MemoryEntry) -> bool:
                # Match the value's JSON-ish text representation
                # case-insensitively. Postgres backend mirrors this with
                # an ILIKE; both are deliberately simple substring
                # matches -- vector search is a separate concern.
                blob = repr(entry.value)
                return needle in blob.casefold() or needle in entry.key.casefold()

            entries = [e for e in entries if _matches(e)]
            # Query → recency-first ordering, mirroring postgres backend.
            entries.sort(key=lambda e: e.updated_at, reverse=True)
        else:
            # No query → stable ordering by (key, updated_at) so tests
            # don't rely on dict insertion order across Python versions.
            entries.sort(key=lambda e: (e.key, e.updated_at))
        return entries[:limit]

    async def forget(self, scope: MemoryScope, key: str) -> bool:
        async with self._lock:
            bucket = self._data.get(_scope_key(scope))
            if bucket is None or key not in bucket:
                return False
            del bucket[key]
            if not bucket:
                del self._data[_scope_key(scope)]
            return True

    async def list_scopes(self, project_id: str) -> list[MemoryScope]:
        now = datetime.now(timezone.utc)
        out: list[MemoryScope] = []
        async with self._lock:
            for (pid, uid, kind), bucket in self._data.items():
                if pid != project_id:
                    continue
                # Skip scopes whose entries are all expired -- they're
                # effectively gone even though we haven't pruned yet.
                if not any(not e.is_expired(now=now) for e in bucket.values()):
                    continue
                out.append(MemoryScope(project_id=pid, user_id=uid, kind=kind))
        # Deterministic ordering: by (user_id is None desc, user_id, kind).
        # Project-wide scopes (user_id=None) come first, then per-user
        # scopes sorted by user_id then kind. This matches the postgres
        # backend so tests against either don't have to special-case.
        out.sort(key=lambda s: (s.user_id is not None, s.user_id or "", s.kind))
        return out

    async def reset(self) -> None:
        """Clear all entries (test helper)."""

        async with self._lock:
            self._data.clear()


__all__ = [
    "InMemoryMemoryStore",
    "MemoryEntry",
    "MemoryScope",
    "MemoryStore",
]
