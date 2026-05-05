"""Tests for the Stripe-style ``Idempotency-Key`` cache.

Covers the in-memory and Redis backends, the
:func:`fingerprint_request` / :func:`cache_key` helpers, the
:mod:`app.middleware.idempotency_guard` router helper, and the seven
opted-in routes that wire idempotency into their handlers.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from http import HTTPStatus
from typing import Any, Iterable, Optional

import fakeredis
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pytest import FixtureRequest
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from typing_extensions import TypedDict

from app import main
from app import security
from app.agents import AgentMetadata, BaseAgent
from app.agents.registry import registry as global_registry
from app.config import settings as app_settings
from app.middleware import budget as budget_module
from app.middleware import idempotency as _idempotency
from app.middleware import rate_limit as rate_limit_module
from app.middleware import redis_backends
from app.middleware.idempotency import (
    DEFAULT_TTL_SECONDS,
    CachedResponse,
    InMemoryIdempotencyBackend,
    cache_key,
    configure_idempotency_backend,
    fingerprint_request,
    idempotency_cache,
)
from app.middleware.idempotency_guard import (
    IdempotencyContext,
    check_idempotency,
)
from app.security import create_token
from app.auth import project_access as project_access_module
from app.routers import ai as ai_router_module
from tests.conftest import FakeStore, seed_agent_test_projects_if_absent


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_redis() -> Iterable[fakeredis.FakeRedis]:
    client = fakeredis.FakeRedis(decode_responses=True)
    yield client
    client.flushall()


@pytest.fixture(autouse=True)
def _restore_module_singletons() -> Iterable[None]:
    """Restore every module-level singleton between tests so a swap
    performed by one case never leaks into another (mirrors the
    sibling fixture in :mod:`tests.test_redis_backends`)."""

    original_idempotency = _idempotency.idempotency_cache
    original_budget = budget_module.budget_tracker
    original_rate_limit = rate_limit_module.rate_limiter
    if isinstance(original_idempotency, InMemoryIdempotencyBackend):
        original_idempotency.reset()
    if isinstance(original_budget, budget_module.InMemoryBudgetBackend):
        original_budget.reset()
    if isinstance(original_rate_limit, rate_limit_module.InMemoryRateLimitBackend):
        original_rate_limit.reset()
    yield
    configure_idempotency_backend(original_idempotency)
    budget_module.configure_budget_backend(original_budget)
    rate_limit_module.configure_rate_limit_backend(original_rate_limit)
    if isinstance(original_idempotency, InMemoryIdempotencyBackend):
        original_idempotency.reset()
    if isinstance(original_budget, budget_module.InMemoryBudgetBackend):
        original_budget.reset()
    if isinstance(original_rate_limit, rate_limit_module.InMemoryRateLimitBackend):
        original_rate_limit.reset()


@pytest.fixture()
def client(request: FixtureRequest) -> Iterable[TestClient]:
    store: FakeStore = request.getfixturevalue("store")
    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# fingerprint_request / cache_key
# ---------------------------------------------------------------------------


def test_fingerprint_is_stable_across_key_ordering() -> None:
    a = fingerprint_request("POST", "/x", {"a": 1, "b": 2})
    b = fingerprint_request("POST", "/x", {"b": 2, "a": 1})
    assert a == b


def test_fingerprint_changes_when_body_differs() -> None:
    a = fingerprint_request("POST", "/x", {"a": 1})
    b = fingerprint_request("POST", "/x", {"a": 2})
    assert a != b


def test_fingerprint_changes_when_path_differs() -> None:
    a = fingerprint_request("POST", "/x", {"a": 1})
    b = fingerprint_request("POST", "/y", {"a": 1})
    assert a != b


def test_fingerprint_changes_when_method_differs() -> None:
    a = fingerprint_request("POST", "/x", {"a": 1})
    b = fingerprint_request("PUT", "/x", {"a": 1})
    assert a != b


def test_fingerprint_handles_non_jsonable_via_default_str() -> None:
    """``default=str`` keeps odd-but-jsonable values hashable."""

    class Stamp:
        def __str__(self) -> str:
            return "stamp"

    assert fingerprint_request("POST", "/x", {"v": Stamp()}) == fingerprint_request(
        "POST", "/x", {"v": "stamp"}
    )


def test_cache_key_shape() -> None:
    assert cache_key("u-1", "/api/x", "abc-123") == "u-1:/api/x:abc-123"


# ---------------------------------------------------------------------------
# InMemoryIdempotencyBackend
# ---------------------------------------------------------------------------


def test_in_memory_reserve_returns_fresh_first() -> None:
    backend = InMemoryIdempotencyBackend()
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "fresh"


def test_in_memory_reserve_returns_in_flight_for_sibling_call() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp")
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "in_flight"


def test_in_memory_reserve_mismatch_pending_returns_distinct_state() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp-a")
    cached, state = backend.reserve("k", "fp-b")
    assert cached is None
    assert state == "mismatch_pending"


def test_in_memory_store_then_reserve_returns_completed() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp")
    backend.store("k", CachedResponse(200, {"ok": True}, {"X": "y"}, "fp"))
    cached, state = backend.reserve("k", "fp")
    assert state == "completed"
    assert cached is not None
    assert cached.status_code == 200
    assert cached.body == {"ok": True}
    assert cached.headers == {"X": "y"}
    assert cached.fingerprint == "fp"


def test_in_memory_store_without_pending_owner_is_ignored() -> None:
    backend = InMemoryIdempotencyBackend()
    assert backend.store("k", CachedResponse(200, {"ok": True}, {}, "fp")) is False


def test_in_memory_store_after_completed_slot_is_ignored() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp")
    assert backend.store("k", CachedResponse(200, {"ok": True}, {}, "fp")) is True
    assert backend.store("k", CachedResponse(200, {"later": True}, {}, "fp")) is False


def test_in_memory_store_after_expired_pending_is_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    moments = iter([100.0, 111.0])
    monkeypatch.setattr(_idempotency.time, "monotonic", lambda: next(moments))
    backend = InMemoryIdempotencyBackend(ttl_seconds=10)
    backend.reserve("k", "fp")

    assert backend.store("k", CachedResponse(200, {"ok": True}, {}, "fp")) is False


def test_in_memory_release_clears_pending_so_retry_is_fresh() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp")
    backend.release("k")
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "fresh"


def test_in_memory_release_is_a_noop_for_unknown_key() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.release("nope")
    cached, state = backend.reserve("nope", "fp")
    assert state == "fresh"
    assert cached is None


def test_in_memory_scoped_release_is_a_noop_for_unknown_key() -> None:
    backend = InMemoryIdempotencyBackend()
    assert backend.release("nope", "fp") is False


def test_in_memory_release_after_expired_pending_is_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    moments = iter([100.0, 111.0])
    monkeypatch.setattr(_idempotency.time, "monotonic", lambda: next(moments))
    backend = InMemoryIdempotencyBackend(ttl_seconds=10)
    backend.reserve("k", "fp")

    assert backend.release("k", "fp") is False


def test_in_memory_ttl_expiry_treats_slot_as_fresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An expired entry on read is dropped and the slot becomes fresh again."""

    times = iter([100.0, 100.0 + 200.0])

    def _fake_monotonic() -> float:
        return next(times)

    monkeypatch.setattr(_idempotency.time, "monotonic", _fake_monotonic)
    backend = InMemoryIdempotencyBackend(ttl_seconds=10)
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"
    # Second reserve: time has advanced past TTL; the entry is dropped
    # and the slot becomes fresh again.
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"


def test_in_memory_late_store_after_ttl_does_not_clobber_new_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A slow request cannot overwrite a recycled pending slot."""

    moments = iter([100.0, 111.0, 112.0, 112.0])
    monkeypatch.setattr(_idempotency.time, "monotonic", lambda: next(moments))
    backend = InMemoryIdempotencyBackend(ttl_seconds=10)

    assert backend.reserve("k", "fp-old")[1] == "fresh"
    assert backend.reserve("k", "fp-new")[1] == "fresh"
    stored = backend.store("k", CachedResponse(200, {"old": True}, {}, "fp-old"))

    assert stored is False
    cached, state = backend.reserve("k", "fp-new")
    assert cached is None
    assert state == "in_flight"


def test_in_memory_late_release_after_ttl_does_not_clear_new_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A late failure cannot release a newer pending reservation."""

    moments = iter([100.0, 111.0, 112.0, 112.0])
    monkeypatch.setattr(_idempotency.time, "monotonic", lambda: next(moments))
    backend = InMemoryIdempotencyBackend(ttl_seconds=10)

    assert backend.reserve("k", "fp-old")[1] == "fresh"
    assert backend.reserve("k", "fp-new")[1] == "fresh"
    released = backend.release("k", "fp-old")

    assert released is False
    cached, state = backend.reserve("k", "fp-new")
    assert cached is None
    assert state == "in_flight"


def test_in_memory_reset_clears_state() -> None:
    backend = InMemoryIdempotencyBackend()
    backend.reserve("k", "fp")
    backend.reset()
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"
    assert cached is None


def test_in_memory_configurable_ttl_seconds_is_honored() -> None:
    backend = InMemoryIdempotencyBackend(ttl_seconds=42)
    assert backend.ttl_seconds == 42


def test_in_memory_default_ttl_matches_constant() -> None:
    assert InMemoryIdempotencyBackend().ttl_seconds == DEFAULT_TTL_SECONDS


def test_module_singleton_is_in_memory_by_default() -> None:
    assert isinstance(idempotency_cache, InMemoryIdempotencyBackend)


def test_configure_swap_replaces_module_singleton() -> None:
    sentinel = InMemoryIdempotencyBackend(ttl_seconds=7)
    configure_idempotency_backend(sentinel)
    assert _idempotency.idempotency_cache is sentinel


# ---------------------------------------------------------------------------
# RedisIdempotencyBackend
# ---------------------------------------------------------------------------


def test_redis_idempotency_reserve_fresh(fake_redis: fakeredis.FakeRedis) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "fresh"


def test_redis_idempotency_reserve_in_flight(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp")
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "in_flight"


def test_redis_idempotency_reserve_mismatch_pending(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp-a")
    cached, state = backend.reserve("k", "fp-b")
    assert cached is None
    assert state == "mismatch_pending"


def test_redis_idempotency_corrupt_value_is_cleared_as_fresh(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    fake_redis.set(backend._key("k"), "not-json")
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "fresh"
    cached, state = backend.reserve("k", "fp")
    assert cached is None
    assert state == "in_flight"


def test_redis_idempotency_store_then_reserve_returns_completed(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp")
    backend.store(
        "k",
        CachedResponse(
            status_code=200,
            body={"deep": {"nested": [1, 2, 3]}, "x": "y"},
            headers={"X-Echo": "1"},
            fingerprint="fp",
        ),
    )
    cached, state = backend.reserve("k", "fp")
    assert state == "completed"
    assert cached is not None
    assert cached.status_code == 200
    assert cached.body == {"deep": {"nested": [1, 2, 3]}, "x": "y"}
    assert cached.headers == {"X-Echo": "1"}
    assert cached.fingerprint == "fp"


def test_redis_idempotency_release(fake_redis: fakeredis.FakeRedis) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp")
    backend.release("k")
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"
    assert cached is None


def test_redis_idempotency_ttl_expiry(fake_redis: fakeredis.FakeRedis) -> None:
    """An expired Redis slot becomes fresh again on the next reserve."""

    backend = redis_backends.RedisIdempotencyBackend(fake_redis, ttl_seconds=10)
    backend.reserve("k", "fp")
    # Force the slot to expire by deleting; ``EXPIRE 0`` is the
    # idiomatic alternative but FakeRedis tolerates either.
    fake_redis.delete(backend._key("k"))
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"
    assert cached is None


def test_redis_idempotency_late_store_after_ttl_does_not_clobber_new_owner(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis, ttl_seconds=10)

    assert backend.reserve("k", "fp-old")[1] == "fresh"
    fake_redis.delete(backend._key("k"))
    assert backend.reserve("k", "fp-new")[1] == "fresh"
    stored = backend.store("k", CachedResponse(200, {"old": True}, {}, "fp-old"))

    assert stored is False
    cached, state = backend.reserve("k", "fp-new")
    assert cached is None
    assert state == "in_flight"


def test_redis_idempotency_late_release_after_ttl_does_not_clear_new_owner(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis, ttl_seconds=10)

    assert backend.reserve("k", "fp-old")[1] == "fresh"
    fake_redis.delete(backend._key("k"))
    assert backend.reserve("k", "fp-new")[1] == "fresh"
    released = backend.release("k", "fp-old")

    assert released is False
    cached, state = backend.reserve("k", "fp-new")
    assert cached is None
    assert state == "in_flight"


def test_redis_idempotency_store_ignores_corrupt_pending_slot(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp")
    fake_redis.set(backend._key("k"), "not-json")

    stored = backend.store("k", CachedResponse(200, {"ok": True}, {}, "fp"))

    assert stored is False
    assert fake_redis.get(backend._key("k")) == "not-json"


def test_redis_idempotency_release_ignores_corrupt_pending_slot(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    backend.reserve("k", "fp")
    fake_redis.set(backend._key("k"), "not-json")

    released = backend.release("k", "fp")

    assert released is False
    assert fake_redis.get(backend._key("k")) == "not-json"


def test_redis_idempotency_reset_only_clears_own_prefix(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis, prefix="idempotency:")
    backend.reserve("k", "fp")
    fake_redis.set("budget:p-a:1999-01", "untouched")
    fake_redis.set("ratelimit:foo:bar", "untouched")
    backend.reset()
    assert fake_redis.get("budget:p-a:1999-01") == "untouched"
    assert fake_redis.get("ratelimit:foo:bar") == "untouched"
    cached, state = backend.reserve("k", "fp")
    assert state == "fresh"


def test_redis_idempotency_default_ttl_matches_constant(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisIdempotencyBackend(fake_redis)
    assert backend.ttl_seconds == DEFAULT_TTL_SECONDS


def test_redis_idempotency_store_default_str_for_non_jsonable(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """``default=str`` keeps the JSON encode robust against odd values."""

    backend = redis_backends.RedisIdempotencyBackend(fake_redis)

    class Stamp:
        def __str__(self) -> str:
            return "stamp"

    backend.reserve("k", "fp")
    backend.store(
        "k",
        CachedResponse(
            status_code=200,
            body={"v": Stamp()},
            headers={},
            fingerprint="fp",
        ),
    )
    cached, state = backend.reserve("k", "fp")
    assert state == "completed"
    assert cached is not None
    assert cached.body == {"v": "stamp"}


# ---------------------------------------------------------------------------
# idempotency_guard.check_idempotency
# ---------------------------------------------------------------------------


class _StubRequest:
    """Minimal stand-in for :class:`fastapi.Request` for direct helper tests."""

    def __init__(
        self,
        *,
        idempotency_key: str = "",
        method: str = "POST",
        path: str = "/api/x",
    ) -> None:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
        self.headers = headers
        self.method = method

        class _URL:
            def __init__(self, p: str) -> None:
                self.path = p

        self.url = _URL(path)


def _run(coro: Any) -> Any:
    """Run an async helper from a sync test.

    ``asyncio.run`` builds a fresh loop per call -- safe even after
    sibling async tests have closed the previous one.
    """

    return asyncio.run(coro)


def test_check_idempotency_disabled_when_header_absent() -> None:
    ctx = _run(
        check_idempotency(_StubRequest(), {"a": 1}, auth_subject="u-1")  # type: ignore[arg-type]
    )
    assert isinstance(ctx, IdempotencyContext)
    assert ctx.enabled is False
    assert ctx.cache_key is None
    assert ctx.fingerprint is None


def test_check_idempotency_disabled_when_header_is_blank() -> None:
    """Empty / whitespace-only header is treated as absent."""

    ctx = _run(
        check_idempotency(  # type: ignore[arg-type]
            _StubRequest(idempotency_key="   "),
            {"a": 1},
            auth_subject="u-1",
        )
    )
    assert ctx.enabled is False


def test_check_idempotency_rejects_oversized_key() -> None:
    with pytest.raises(HTTPException) as exc:
        _run(
            check_idempotency(  # type: ignore[arg-type]
                _StubRequest(idempotency_key="x" * 256),
                {"a": 1},
                auth_subject="u-1",
            )
        )
    assert exc.value.status_code == HTTPStatus.BAD_REQUEST
    assert exc.value.detail["error"] == "invalid_idempotency_key"


def test_check_idempotency_rejects_invalid_characters() -> None:
    with pytest.raises(HTTPException) as exc:
        _run(
            check_idempotency(  # type: ignore[arg-type]
                _StubRequest(idempotency_key="abc\nXSS"),
                {"a": 1},
                auth_subject="u-1",
            )
        )
    assert exc.value.status_code == HTTPStatus.BAD_REQUEST
    assert exc.value.detail["error"] == "invalid_idempotency_key"


def test_check_idempotency_returns_fresh_context_for_first_call() -> None:
    ctx = _run(
        check_idempotency(  # type: ignore[arg-type]
            _StubRequest(idempotency_key="abc-123"),
            {"a": 1},
            auth_subject="u-1",
        )
    )
    assert ctx.enabled is True
    assert ctx.cache_key == "u-1:/api/x:abc-123"
    assert ctx.cached_response is None


def test_check_idempotency_returns_cached_response_on_replay() -> None:
    _idempotency.idempotency_cache.reserve(
        "u-1:/api/x:abc-123",
        fingerprint_request("POST", "/api/x", {"a": 1}),
    )
    _idempotency.idempotency_cache.store(
        "u-1:/api/x:abc-123",
        CachedResponse(
            status_code=200,
            body={"ok": True},
            headers={"X": "y"},
            fingerprint=fingerprint_request("POST", "/api/x", {"a": 1}),
        ),
    )
    ctx = _run(
        check_idempotency(  # type: ignore[arg-type]
            _StubRequest(idempotency_key="abc-123"),
            {"a": 1},
            auth_subject="u-1",
        )
    )
    assert ctx.cached_response is not None
    assert ctx.cached_response.body == {"ok": True}


def test_check_idempotency_raises_422_on_fingerprint_mismatch() -> None:
    _idempotency.idempotency_cache.reserve(
        "u-1:/api/x:abc-123",
        fingerprint_request("POST", "/api/x", {"a": 1}),
    )
    _idempotency.idempotency_cache.store(
        "u-1:/api/x:abc-123",
        CachedResponse(
            status_code=200,
            body={"ok": True},
            headers={},
            fingerprint=fingerprint_request("POST", "/api/x", {"a": 1}),
        ),
    )
    with pytest.raises(HTTPException) as exc:
        _run(
            check_idempotency(  # type: ignore[arg-type]
                _StubRequest(idempotency_key="abc-123"),
                {"a": 2},
                auth_subject="u-1",
            )
        )
    assert exc.value.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert exc.value.detail["error"] == "idempotency_key_reused"


def test_check_idempotency_raises_409_on_in_flight_sibling() -> None:
    _idempotency.idempotency_cache.reserve(
        "u-1:/api/x:abc-123",
        fingerprint_request("POST", "/api/x", {"a": 1}),
    )
    with pytest.raises(HTTPException) as exc:
        _run(
            check_idempotency(  # type: ignore[arg-type]
                _StubRequest(idempotency_key="abc-123"),
                {"a": 1},
                auth_subject="u-1",
            )
        )
    assert exc.value.status_code == HTTPStatus.CONFLICT
    assert exc.value.detail["error"] == "idempotency_key_in_progress"


def test_check_idempotency_raises_422_when_pending_fingerprint_differs() -> None:
    _idempotency.idempotency_cache.reserve(
        "u-1:/api/x:abc-123",
        fingerprint_request("POST", "/api/x", {"a": 1}),
    )
    with pytest.raises(HTTPException) as exc:
        _run(
            check_idempotency(  # type: ignore[arg-type]
                _StubRequest(idempotency_key="abc-123"),
                {"a": 2},
                auth_subject="u-1",
            )
        )
    assert exc.value.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert exc.value.detail["error"] == "idempotency_key_reused"


def test_idempotency_context_store_and_release_are_noops_when_disabled() -> None:
    ctx = IdempotencyContext(enabled=False, cache_key=None, fingerprint=None)
    # Both methods should silently no-op so handlers do not need to branch.
    ctx.store(200, {"ok": True})
    ctx.release()


def test_idempotency_context_store_persists_when_enabled() -> None:
    _idempotency.idempotency_cache.reserve("k", "fp")
    ctx = IdempotencyContext(enabled=True, cache_key="k", fingerprint="fp")
    ctx.store(200, {"ok": True}, {"X": "y"})
    cached, state = _idempotency.idempotency_cache.reserve("k", "fp")
    assert state == "completed"
    assert cached is not None
    assert cached.body == {"ok": True}
    assert cached.headers == {"X": "y"}


def test_idempotency_context_release_clears_pending_when_enabled() -> None:
    _idempotency.idempotency_cache.reserve("k", "fp")
    ctx = IdempotencyContext(enabled=True, cache_key="k", fingerprint="fp")
    ctx.release()
    cached, state = _idempotency.idempotency_cache.reserve("k", "fp")
    assert state == "fresh"
    assert cached is None


# ---------------------------------------------------------------------------
# Lifespan factory: idempotency-specific paths
# ---------------------------------------------------------------------------


def test_lifespan_rejects_unknown_idempotency_backend() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="postgres",
        redis_uri="redis://x",
    )
    with pytest.raises(RuntimeError, match="IDEMPOTENCY_BACKEND"):
        main._configure_middleware_backends(cfg)


def test_lifespan_requires_redis_uri_when_idempotency_is_redis() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="redis",
        redis_uri="",
    )
    with pytest.raises(RuntimeError, match="REDIS_URI is empty"):
        main._configure_middleware_backends(cfg)


def test_lifespan_swaps_to_redis_idempotency_via_fakeredis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_backends, "build_redis_client", lambda _uri: fake)
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="redis",
        idempotency_ttl_seconds=99,
        redis_uri="redis://stub",
    )
    main._configure_middleware_backends(cfg)
    assert isinstance(
        _idempotency.idempotency_cache,
        redis_backends.RedisIdempotencyBackend,
    )
    assert _idempotency.idempotency_cache.ttl_seconds == 99


def test_lifespan_all_memory_path_honors_custom_ttl() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="memory",
        idempotency_ttl_seconds=123,
        redis_uri="",
    )
    main._configure_middleware_backends(cfg)
    assert isinstance(_idempotency.idempotency_cache, InMemoryIdempotencyBackend)
    assert _idempotency.idempotency_cache.ttl_seconds == 123


def test_lifespan_redis_other_keeps_memory_idempotency_with_custom_ttl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If only rate-limit / budget go to redis, idempotency stays memory
    but with the configured TTL applied."""

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_backends, "build_redis_client", lambda _uri: fake)
    cfg = replace(
        app_settings,
        rate_limit_backend="redis",
        budget_backend="memory",
        idempotency_backend="memory",
        idempotency_ttl_seconds=77,
        redis_uri="redis://stub",
    )
    main._configure_middleware_backends(cfg)
    assert isinstance(_idempotency.idempotency_cache, InMemoryIdempotencyBackend)
    assert _idempotency.idempotency_cache.ttl_seconds == 77


# ---------------------------------------------------------------------------
# Router-level integration tests for /api/v1/agents/{name}/invoke
# ---------------------------------------------------------------------------


class _IdemProbe(TypedDict, total=False):
    text: str


class _IdemAgent(BaseAgent):
    metadata = AgentMetadata(
        name="idem-noise",
        description="Test agent for idempotency tests.",
        version="1.0.0",
        recursion_limit=4,
        allowed_autonomy=("plan",),
        rate_limit=(60, 600),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def speak(state: _IdemProbe) -> dict[str, Any]:
            writer = get_stream_writer()
            writer({"kind": "usage", "tokensIn": 5, "tokensOut": 7})
            return {"text": "ok"}

        graph: StateGraph = StateGraph(_IdemProbe)
        graph.add_node("speak", speak)
        graph.add_edge(START, "speak")
        graph.add_edge("speak", END)
        return graph.compile(checkpointer=checkpointer, store=store)


@pytest.fixture()
def idem_agent() -> Iterable[_IdemAgent]:
    agent = _IdemAgent()
    global_registry.register(agent)
    try:
        yield agent
    finally:
        global_registry.unregister(agent.name)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    return {"Authorization": f"Bearer {create_token('idem-user')}"}


def test_invoke_replays_response_with_idempotency_key(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    headers = {**auth_headers, "Idempotency-Key": "abc-123"}
    body = {
        "inputs": {"text": "hello", "project_id": "p-replay"},
        "autonomy": "plan",
    }
    first = client.post("/api/v1/agents/idem-noise/invoke", json=body, headers=headers)
    assert first.status_code == HTTPStatus.OK
    spent_after_first = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-replay")
    )
    assert spent_after_first > 0

    second = client.post("/api/v1/agents/idem-noise/invoke", json=body, headers=headers)
    assert second.status_code == HTTPStatus.OK
    assert second.headers.get("Idempotent-Replay") == "true"
    assert second.json() == first.json()
    spent_after_second = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-replay")
    )
    assert spent_after_first == spent_after_second, "replay must not re-debit"


def test_invoke_rejects_same_key_with_different_body(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    headers = {**auth_headers, "Idempotency-Key": "diff-body"}
    first = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json={"inputs": {"text": "hello"}, "autonomy": "plan"},
        headers=headers,
    )
    assert first.status_code == HTTPStatus.OK
    second = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json={"inputs": {"text": "DIFFERENT"}, "autonomy": "plan"},
        headers=headers,
    )
    assert second.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert second.json()["error"] == "idempotency_key_reused"


def test_invoke_returns_409_for_in_flight_sibling(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    """Manually reserve the slot to simulate an in-flight sibling call."""

    body = {"inputs": {"text": "x"}, "autonomy": "plan"}
    fp = fingerprint_request("POST", "/api/v1/agents/idem-noise/invoke", body)
    _idempotency.idempotency_cache.reserve(
        cache_key("idem-user", "/api/v1/agents/idem-noise/invoke", "in-flight-key"),
        fp,
    )
    response = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json=body,
        headers={**auth_headers, "Idempotency-Key": "in-flight-key"},
    )
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.json()["error"] == "idempotency_key_in_progress"


def test_invoke_without_header_runs_unconditionally(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    body = {"inputs": {"text": "hi"}, "autonomy": "plan"}
    first = client.post(
        "/api/v1/agents/idem-noise/invoke", json=body, headers=auth_headers
    )
    second = client.post(
        "/api/v1/agents/idem-noise/invoke", json=body, headers=auth_headers
    )
    assert first.status_code == HTTPStatus.OK
    assert second.status_code == HTTPStatus.OK
    assert "Idempotent-Replay" not in second.headers


def test_invoke_handler_crash_releases_reservation(
    store: FakeStore,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Forcing ainvoke to raise must drop the reservation so a follow-up
    call with the same key can proceed normally. Uses
    ``raise_server_exceptions=False`` so the unhandled-error 500 path
    is exercised instead of bubbling out of the test client.
    """

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("agent exploded")

    body = {"inputs": {"text": "x"}, "autonomy": "plan"}
    headers = {**auth_headers, "Idempotency-Key": "crash-key"}

    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app, raise_server_exceptions=False) as crash_client:
        runtime = crash_client.app.state.agent_runtime
        monkeypatch.setattr(runtime, "ainvoke", boom, raising=False)
        crashed = crash_client.post(
            "/api/v1/agents/idem-noise/invoke", json=body, headers=headers
        )
        assert crashed.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        monkeypatch.undo()
        retry = crash_client.post(
            "/api/v1/agents/idem-noise/invoke", json=body, headers=headers
        )
        assert retry.status_code == HTTPStatus.OK
        assert "Idempotent-Replay" not in retry.headers


def test_invoke_empty_idempotency_key_is_treated_as_absent(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json={"inputs": {"text": "hi"}, "autonomy": "plan"},
        headers={**auth_headers, "Idempotency-Key": "  "},
    )
    assert response.status_code == HTTPStatus.OK
    assert "Idempotent-Replay" not in response.headers


def test_invoke_oversized_idempotency_key_is_400(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json={"inputs": {"text": "hi"}, "autonomy": "plan"},
        headers={**auth_headers, "Idempotency-Key": "k" * 256},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["error"] == "invalid_idempotency_key"


def test_invoke_invalid_chars_in_idempotency_key_is_400(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/idem-noise/invoke",
        json={"inputs": {"text": "hi"}, "autonomy": "plan"},
        headers={**auth_headers, "Idempotency-Key": "abc XSS"},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json()["error"] == "invalid_idempotency_key"


# ---------------------------------------------------------------------------
# Router-level integration: /api/ai/{chat, structured routes}
# ---------------------------------------------------------------------------


def _project_context() -> dict[str, Any]:
    return {
        "project": {"_id": "p-idem", "projectName": "IdemDemo"},
        "columns": [
            {"_id": "c-todo", "name": "To Do"},
            {"_id": "c-doing", "name": "Doing"},
            {"_id": "c-done", "name": "Done"},
        ],
        "tasks": [
            {
                "_id": "t-1",
                "taskName": "Fix login",
                "note": "auth",
                "type": "bug",
                "epic": "Bug Fix",
                "storyPoints": 3,
                "columnId": "c-todo",
                "coordinatorId": "m-1",
            },
        ],
        "members": [{"_id": "m-1", "username": "alice"}],
    }


_AI_ROUTE_PAYLOADS: list[tuple[str, dict[str, Any]]] = [
    (
        "/api/ai/task-draft",
        {"context": _project_context(), "prompt": "Fix the login flow"},
    ),
    (
        "/api/ai/task-breakdown",
        {"context": _project_context(), "prompt": "Build onboarding"},
    ),
    (
        "/api/ai/estimate",
        {
            "context": _project_context(),
            "taskName": "Fix login",
            "note": "Safari only",
        },
    ),
    (
        "/api/ai/readiness",
        {
            "context": _project_context(),
            "taskName": "Fix login",
            "note": "Safari only",
            "epic": "Bug Fix",
            "type": "bug",
        },
    ),
    (
        "/api/ai/board-brief",
        {"context": _project_context()},
    ),
    (
        "/api/ai/search",
        {
            "kind": "tasks",
            "query": "login",
            "projectContext": _project_context(),
        },
    ),
    (
        "/api/ai/chat",
        {
            "messages": [{"role": "user", "content": "ping?"}],
            "context": {"project": {"_id": "p-idem", "projectName": "IdemDemo"}},
        },
    ),
]


@pytest.mark.parametrize("route,payload", _AI_ROUTE_PAYLOADS)
def test_ai_route_replays_with_idempotency_key(
    client: TestClient,
    auth_headers: dict[str, str],
    route: str,
    payload: dict[str, Any],
) -> None:
    headers = {**auth_headers, "Idempotency-Key": f"key-{route.split('/')[-1]}"}
    first = client.post(route, json=payload, headers=headers)
    assert first.status_code == HTTPStatus.OK
    second = client.post(route, json=payload, headers=headers)
    assert second.status_code == HTTPStatus.OK
    assert second.headers.get("Idempotent-Replay") == "true"
    assert second.json() == first.json()


@pytest.mark.parametrize("route,payload", _AI_ROUTE_PAYLOADS)
def test_ai_route_rejects_mismatched_fingerprint(
    client: TestClient,
    auth_headers: dict[str, str],
    route: str,
    payload: dict[str, Any],
) -> None:
    key = f"mismatch-{route.split('/')[-1]}"
    headers = {**auth_headers, "Idempotency-Key": key}
    first = client.post(route, json=payload, headers=headers)
    assert first.status_code == HTTPStatus.OK
    # Tweak the payload so the fingerprint differs.
    bumped = {**payload, "_canary": "different"}
    second = client.post(route, json=bumped, headers=headers)
    assert second.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert second.json()["error"] == "idempotency_key_reused"


@pytest.mark.parametrize(
    "route,payload",
    [
        (route, payload)
        for route, payload in _AI_ROUTE_PAYLOADS
        if route
        in {
            "/api/ai/task-breakdown",
            "/api/ai/estimate",
            "/api/ai/readiness",
        }
    ],
)
def test_ai_route_gate_failure_releases_reservation(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    route: str,
    payload: dict[str, Any],
) -> None:
    """A gate-rejection (here: project AI disabled, returns 403) inside
    the route's try block must clear the slot so a follow-up call with
    the same key can proceed once the gate passes."""

    monkeypatch.setattr(
        ai_router_module,
        "is_project_ai_enabled",
        lambda *args, **kwargs: False,
    )
    headers = {**auth_headers, "Idempotency-Key": f"gate-{route.split('/')[-1]}"}
    response = client.post(route, json=payload, headers=headers)
    assert response.status_code == HTTPStatus.FORBIDDEN
    monkeypatch.setattr(
        ai_router_module,
        "is_project_ai_enabled",
        project_access_module.is_project_ai_enabled,
    )
    retry = client.post(route, json=payload, headers=headers)
    assert retry.status_code == HTTPStatus.OK
    assert "Idempotent-Replay" not in retry.headers


def test_ai_chat_handler_crash_releases_reservation(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 502 from a downstream agent crash must release the slot so the
    follow-up call with the same key can proceed normally. Uses the
    router's existing ``AgentError`` -> 502 translation so the
    response is captured cleanly without disabling test-client error
    propagation.
    """

    from app.agents.errors import AgentExecutionError

    async def boom(*args: Any, **kwargs: Any) -> Any:
        raise AgentExecutionError("chat-agent", cause=RuntimeError("nope"))

    runtime = client.app.state.agent_runtime
    original_ainvoke = runtime.ainvoke
    monkeypatch.setattr(runtime, "ainvoke", boom, raising=False)
    headers = {**auth_headers, "Idempotency-Key": "ai-crash"}
    payload = {
        "messages": [{"role": "user", "content": "x"}],
        "context": {"project": {"_id": "p-idem", "projectName": "IdemDemo"}},
    }
    crashed = client.post("/api/ai/chat", json=payload, headers=headers)
    assert crashed.status_code == HTTPStatus.BAD_GATEWAY
    monkeypatch.setattr(runtime, "ainvoke", original_ainvoke, raising=False)
    retry = client.post("/api/ai/chat", json=payload, headers=headers)
    assert retry.status_code == HTTPStatus.OK
    assert "Idempotent-Replay" not in retry.headers


# ---------------------------------------------------------------------------
# Router-level integration tests for /api/v1/agents/{name}/stream (SSE)
# ---------------------------------------------------------------------------


def test_stream_replays_completion_marker_with_idempotency_key(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    """Initial POST streams SSE; a retry with the same key short-circuits
    to a 200 JSON marker carrying ``Idempotent-Replay: true`` instead of
    re-running the agent. The wire stream itself is not stored -- only
    the completion marker is cached, which is enough to dedupe a real
    network retry.
    """

    headers = {**auth_headers, "Idempotency-Key": "stream-replay"}
    body = {"inputs": {"text": "hello", "project_id": "p-replay"}, "autonomy": "plan"}
    with client.stream(
        "POST",
        "/api/v1/agents/idem-noise/stream",
        json=body,
        headers=headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        # Drain so the generator runs to completion and stores the marker.
        b"".join(response.iter_bytes())
    spent_after_first = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-replay")
    )
    assert spent_after_first > 0

    second = client.post("/api/v1/agents/idem-noise/stream", json=body, headers=headers)
    assert second.status_code == HTTPStatus.OK
    assert second.headers.get("Idempotent-Replay") == "true"
    assert second.json() == {"status": "stream_completed"}
    spent_after_second = (
        budget_module.budget_tracker.monthly_cap
        - budget_module.budget_tracker.remaining("p-replay")
    )
    assert spent_after_first == spent_after_second, "replay must not re-debit"


def test_stream_rejects_same_key_with_different_body(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    headers = {**auth_headers, "Idempotency-Key": "stream-diff-body"}
    with client.stream(
        "POST",
        "/api/v1/agents/idem-noise/stream",
        json={"inputs": {"text": "hello"}, "autonomy": "plan"},
        headers=headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        b"".join(response.iter_bytes())
    second = client.post(
        "/api/v1/agents/idem-noise/stream",
        json={"inputs": {"text": "DIFFERENT"}, "autonomy": "plan"},
        headers=headers,
    )
    assert second.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert second.json()["error"] == "idempotency_key_reused"


def test_stream_returns_409_for_in_flight_sibling(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    """Manually reserve the slot to simulate an in-flight sibling call."""

    body = {"inputs": {"text": "x"}, "autonomy": "plan"}
    fp = fingerprint_request("POST", "/api/v1/agents/idem-noise/stream", body)
    _idempotency.idempotency_cache.reserve(
        cache_key("idem-user", "/api/v1/agents/idem-noise/stream", "stream-in-flight"),
        fp,
    )
    response = client.post(
        "/api/v1/agents/idem-noise/stream",
        json=body,
        headers={**auth_headers, "Idempotency-Key": "stream-in-flight"},
    )
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.json()["error"] == "idempotency_key_in_progress"


def test_stream_resume_skips_idempotency_check(
    client: TestClient,
    idem_agent: _IdemAgent,
    auth_headers: dict[str, str],
) -> None:
    """Resume calls are idempotent via thread-state; the router must not
    refuse a resume because a sibling reservation exists for the same
    key. We simulate this by reserving the slot first, then posting a
    ``command.resume`` body -- it should bypass the idempotency check
    and reach the agent (where it surfaces an SSE error envelope because
    no thread is mid-interrupt).
    """

    key = "stream-resume-key"
    # Reserve as if a sibling already used this key.
    _idempotency.idempotency_cache.reserve(
        cache_key("idem-user", "/api/v1/agents/idem-noise/stream", key),
        "fp-other",
    )
    with client.stream(
        "POST",
        "/api/v1/agents/idem-noise/stream",
        json={"command": {"resume": "go"}},
        headers={**auth_headers, "Idempotency-Key": key},
    ) as response:
        # If idempotency had been checked, this would be 409. Instead the
        # resume short-circuits the gate and returns the SSE stream.
        assert response.status_code == HTTPStatus.OK
        b"".join(response.iter_bytes())
