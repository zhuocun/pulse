"""Tests for the Redis-backed rate-limit + budget implementations and
the lifespan factory that selects them.

Uses :mod:`fakeredis` as a drop-in replacement for the real ``redis``
client (Lua scripts, sorted sets, scan, expire all work) so the test
suite stays hermetic and the 100% coverage gate keeps passing without
a live Redis. The same Lua scripts run against both fakeredis and a
real Redis Server, so a green test here is meaningful evidence that
production will behave identically.

Coverage targets:
    - :class:`RedisBudgetBackend` -- reserve atomicity, refund clamp,
      record, can_spend, remaining, reset.
    - :class:`RedisRateLimitBackend` -- minute / hour limit hits,
      retry-after, wall-clock window slide, reset.
    - :func:`app.main._configure_middleware_backends` -- both ``memory``
      paths, both ``redis`` paths, the unknown-backend rejection, and
      the missing-URI rejection.
    - The ``configure_*_backend`` swap helpers.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable

import fakeredis
import pytest

from app import main
from app.config import settings as app_settings
from app.middleware import budget as _budget
from app.middleware import rate_limit as _rate_limit
from app.middleware import redis_backends


# ---------------------------------------------------------------------------
# Shared fakeredis fixture + autouse swap-back so test pollution cannot leak.
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_redis() -> Iterable[fakeredis.FakeRedis]:
    """A fresh fakeredis instance per test.

    ``decode_responses=True`` mirrors :func:`build_redis_client`'s
    forced setting so the Lua return values come back as strings/lists
    of strings (which the backends parse with ``int(...)``).
    """

    client = fakeredis.FakeRedis(decode_responses=True)
    yield client
    client.flushall()


@pytest.fixture(autouse=True)
def _restore_module_singletons() -> Iterable[None]:
    """Swap the module-level singletons back to a fresh in-memory
    backend after each test so a swap performed by one case never
    leaks into another."""

    original_budget = _budget.budget_tracker
    original_rate_limit = _rate_limit.rate_limiter
    yield
    _budget.configure_budget_backend(original_budget)
    _rate_limit.configure_rate_limit_backend(original_rate_limit)
    if isinstance(original_budget, _budget.InMemoryBudgetBackend):
        original_budget.reset()
    if isinstance(original_rate_limit, _rate_limit.InMemoryRateLimitBackend):
        original_rate_limit.reset()


# ---------------------------------------------------------------------------
# RedisBudgetBackend
# ---------------------------------------------------------------------------


def test_redis_budget_reserve_within_cap_returns_true(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=100)
    assert backend.reserve("p-a", 30) is True
    assert backend.reserve("p-a", 40) is True
    # 70 of 100 spent.
    assert backend.remaining("p-a") == 30


def test_redis_budget_reserve_over_cap_returns_false_without_mutation(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    assert backend.reserve("p-a", 8) is True
    assert backend.reserve("p-a", 5) is False
    # The failed reservation must not have moved the tally.
    assert backend.remaining("p-a") == 2


def test_redis_budget_reserve_rejects_negative_tokens(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    with pytest.raises(ValueError, match="non-negative"):
        backend.reserve("p-a", -1)


def test_redis_budget_record_adds_without_cap_check(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    # ``record`` mirrors the in-memory path: no cap check, used for
    # post-call true-up after the provider reports usage.
    backend.record("p-a", 50)
    assert backend.remaining("p-a") == 0


def test_redis_budget_record_rejects_negative_tokens(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    with pytest.raises(ValueError, match="non-negative"):
        backend.record("p-a", -1)


def test_redis_budget_refund_clamps_to_zero(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=100)
    backend.reserve("p-a", 5)
    # Refunding more than was reserved must not push the tally negative
    # -- a misbehaving caller could otherwise inflate ``remaining`` past
    # the cap.
    backend.refund("p-a", 999)
    assert backend.remaining("p-a") == 100


def test_redis_budget_refund_rejects_negative_tokens(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    with pytest.raises(ValueError, match="non-negative"):
        backend.refund("p-a", -1)


def test_redis_budget_can_spend_reflects_remaining(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    backend.reserve("p-a", 8)
    assert backend.can_spend("p-a", tokens=2) is True
    assert backend.can_spend("p-a", tokens=3) is False


def test_redis_budget_remaining_no_spend_yet(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=42)
    assert backend.remaining("p-untouched") == 42


def test_redis_budget_remaining_explicit_month(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """Passing ``month`` lets callers query historical or future buckets."""

    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    fake_redis.set("budget:p-a:1999-01", "7")
    assert backend.remaining("p-a", month="1999-01") == 3


def test_redis_budget_reset_only_clears_own_prefix(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """``reset()`` SCAN+DELs the prefix; unrelated keys stay intact.

    Production should never call ``reset()`` (it's a test helper),
    but if it ever does the blast radius must stay scoped.
    """

    backend = redis_backends.RedisBudgetBackend(
        fake_redis, monthly_cap=10, prefix="budget:"
    )
    backend.reserve("p-a", 3)
    fake_redis.set("ratelimit:foo:bar", "untouched")
    fake_redis.set("other:keep-me", "intact")

    backend.reset()

    assert backend.remaining("p-a") == 10
    assert fake_redis.get("ratelimit:foo:bar") == "untouched"
    assert fake_redis.get("other:keep-me") == "intact"


def test_redis_budget_buckets_are_per_project(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisBudgetBackend(fake_redis, monthly_cap=10)
    backend.reserve("p-a", 8)
    # ``p-b`` shares the cap shape but not the tally.
    assert backend.remaining("p-b") == 10
    assert backend.reserve("p-b", 9) is True


# ---------------------------------------------------------------------------
# RedisRateLimitBackend
# ---------------------------------------------------------------------------


def test_redis_rate_limit_allows_under_cap(fake_redis: fakeredis.FakeRedis) -> None:
    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    for _ in range(5):
        allowed, retry = backend.check("agent-x", "u-1", limits=(10, 100))
        assert allowed is True
        assert retry == 0


def test_redis_rate_limit_blocks_at_minute_cap(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    for _ in range(3):
        backend.check("agent-x", "u-1", limits=(3, 100), now=1000.0)
    allowed, retry = backend.check("agent-x", "u-1", limits=(3, 100), now=1000.0)
    assert allowed is False
    assert 1 <= retry <= 60


def test_redis_rate_limit_blocks_at_hour_cap(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    # Spread requests across a long horizon so the minute window is
    # never the breached one -- the hour cap is.
    for i in range(5):
        backend.check("agent-x", "u-1", limits=(100, 5), now=1000.0 + i * 70)
    allowed, retry = backend.check(
        "agent-x", "u-1", limits=(100, 5), now=1000.0 + 5 * 70
    )
    assert allowed is False
    assert retry > 60  # still inside the hour window


def test_redis_rate_limit_minute_window_slides(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """An entry older than 60s no longer counts toward the minute cap."""

    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    for _ in range(2):
        backend.check("agent-x", "u-1", limits=(2, 100), now=1000.0)
    blocked, _ = backend.check("agent-x", "u-1", limits=(2, 100), now=1010.0)
    assert blocked is False
    # 61s later both prior entries fall out of the minute window.
    allowed, _ = backend.check("agent-x", "u-1", limits=(2, 100), now=1071.0)
    assert allowed is True


def test_redis_rate_limit_buckets_are_per_user_and_agent(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    for _ in range(2):
        backend.check("agent-x", "u-1", limits=(2, 100), now=1000.0)
    # Same agent, different user: independent bucket.
    allowed, _ = backend.check("agent-x", "u-2", limits=(2, 100), now=1000.0)
    assert allowed is True
    # Same user, different agent: independent bucket.
    allowed, _ = backend.check("agent-y", "u-1", limits=(2, 100), now=1000.0)
    assert allowed is True


def test_redis_rate_limit_default_limits_when_none_passed(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """The DEFAULT_LIMIT (60, 600) applies when ``limits`` is not provided."""

    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    allowed, retry = backend.check("agent-x", "u-1")
    assert allowed is True
    assert retry == 0


def test_redis_rate_limit_default_now_uses_wall_clock(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """When ``now`` is not passed, the backend reads ``time.time()``.

    Validates the branch by passing nothing and confirming a real
    timestamp got recorded (one entry in the minute zset).
    """

    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    backend.check("agent-x", "u-1", limits=(5, 50))
    minute_key, _ = backend._keys("agent-x", "u-1")
    assert fake_redis.zcard(minute_key) == 1


def test_redis_rate_limit_reset_only_clears_own_prefix(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    backend = redis_backends.RedisRateLimitBackend(fake_redis, prefix="ratelimit:")
    backend.check("agent-x", "u-1", limits=(5, 50), now=1000.0)
    fake_redis.set("budget:p-a:1999-01", "untouched")
    fake_redis.set("other:keep-me", "intact")

    backend.reset()

    minute_key, _ = backend._keys("agent-x", "u-1")
    assert fake_redis.zcard(minute_key) == 0
    assert fake_redis.get("budget:p-a:1999-01") == "untouched"
    assert fake_redis.get("other:keep-me") == "intact"


def test_redis_rate_limit_uniques_members_under_same_timestamp(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    """Two requests with the same ``now=`` must both record a member.

    Without the per-call UUID4 suffix, ZADD with the same score would
    collapse to a single entry and the second request would silently
    bypass the cap.
    """

    backend = redis_backends.RedisRateLimitBackend(fake_redis)
    for _ in range(3):
        backend.check("agent-x", "u-1", limits=(10, 100), now=1000.0)
    minute_key, _ = backend._keys("agent-x", "u-1")
    assert fake_redis.zcard(minute_key) == 3


# ---------------------------------------------------------------------------
# build_redis_client
# ---------------------------------------------------------------------------


def test_build_redis_client_returns_a_real_redis_instance() -> None:
    """Smoke-test that the URI resolves to a usable client.

    We point at a clearly-unreachable host and only check that the
    construction itself doesn't raise -- the actual connection is
    deferred to the first command, which is fine because the lifespan
    is the only caller and it does not ping at construction time.
    """

    client = redis_backends.build_redis_client("redis://127.0.0.1:1/0")
    # ``decode_responses=True`` is forced by the helper; verify by
    # reading the option off the client.
    assert client.connection_pool.connection_kwargs["decode_responses"] is True


# ---------------------------------------------------------------------------
# configure_*_backend swap helpers
# ---------------------------------------------------------------------------


def test_configure_budget_backend_swaps_the_module_singleton(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    redis_backend = redis_backends.RedisBudgetBackend(
        fake_redis, monthly_cap=10
    )
    _budget.configure_budget_backend(redis_backend)
    assert _budget.budget_tracker is redis_backend
    # Round-trip a reserve through the swapped singleton.
    assert _budget.budget_tracker.reserve("p-a", 5) is True


def test_configure_rate_limit_backend_swaps_the_module_singleton(
    fake_redis: fakeredis.FakeRedis,
) -> None:
    redis_backend = redis_backends.RedisRateLimitBackend(fake_redis)
    _rate_limit.configure_rate_limit_backend(redis_backend)
    assert _rate_limit.rate_limiter is redis_backend
    allowed, _ = _rate_limit.rate_limiter.check(
        "agent-x", "u-1", limits=(5, 50)
    )
    assert allowed is True


# ---------------------------------------------------------------------------
# main._configure_middleware_backends -- lifespan factory
# ---------------------------------------------------------------------------


def test_configure_middleware_backends_builds_fresh_memory_backends() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        redis_uri="",
    )
    backends = main._configure_middleware_backends(cfg)
    assert isinstance(backends.budget_tracker, _budget.InMemoryBudgetBackend)
    assert isinstance(backends.rate_limiter, _rate_limit.InMemoryRateLimitBackend)
    assert backends.budget_tracker is not _budget.budget_tracker
    assert backends.rate_limiter is not _rate_limit.rate_limiter


def test_configure_middleware_backends_rejects_unknown_rate_limit_backend() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="cassandra",
        budget_backend="memory",
        redis_uri="redis://x",
    )
    with pytest.raises(RuntimeError, match="RATE_LIMIT_BACKEND"):
        main._configure_middleware_backends(cfg)


def test_configure_middleware_backends_rejects_unknown_budget_backend() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="dynamodb",
        redis_uri="redis://x",
    )
    with pytest.raises(RuntimeError, match="BUDGET_BACKEND"):
        main._configure_middleware_backends(cfg)


def test_configure_middleware_backends_requires_redis_uri_for_redis_backend() -> None:
    cfg = replace(
        app_settings,
        rate_limit_backend="redis",
        budget_backend="memory",
        redis_uri="",
    )
    with pytest.raises(RuntimeError, match="REDIS_URI is empty"):
        main._configure_middleware_backends(cfg)


def test_configure_middleware_backends_builds_redis_backends_via_fakeredis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Patch ``build_redis_client`` to return fakeredis so the lifespan
    factory's redis branch is exercised end-to-end without a live
    Redis."""

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(
        redis_backends, "build_redis_client", lambda _uri: fake
    )
    cfg = replace(
        app_settings,
        rate_limit_backend="redis",
        budget_backend="redis",
        redis_uri="redis://stub",
    )

    backends = main._configure_middleware_backends(cfg)

    assert isinstance(backends.budget_tracker, redis_backends.RedisBudgetBackend)
    assert isinstance(backends.rate_limiter, redis_backends.RedisRateLimitBackend)
    # Confirm the app-owned backends round-trip through the fake.
    assert backends.budget_tracker.reserve("p-a", 5) is True
    allowed, _ = backends.rate_limiter.check(
        "agent-x", "u-1", limits=(5, 50)
    )
    assert allowed is True


def test_configure_middleware_backends_handles_whitespace_and_case(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Backends names are lowercased and stripped before dispatch.

    Operators routinely write ``BUDGET_BACKEND=Redis `` or similar in
    their .env; the factory should still pick the right branch.
    """

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(
        redis_backends, "build_redis_client", lambda _uri: fake
    )
    cfg = replace(
        app_settings,
        rate_limit_backend="  Redis ",
        budget_backend="REDIS",
        redis_uri="redis://stub",
    )

    backends = main._configure_middleware_backends(cfg)

    assert isinstance(backends.budget_tracker, redis_backends.RedisBudgetBackend)
    assert isinstance(backends.rate_limiter, redis_backends.RedisRateLimitBackend)


def test_configure_middleware_backends_only_builds_the_selected_side(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A mixed config (rate_limit=redis, budget=memory) must only switch one."""

    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(
        redis_backends, "build_redis_client", lambda _uri: fake
    )
    cfg = replace(
        app_settings,
        rate_limit_backend="redis",
        budget_backend="memory",
        redis_uri="redis://stub",
    )
    backends = main._configure_middleware_backends(cfg)

    assert isinstance(backends.budget_tracker, _budget.InMemoryBudgetBackend)
    assert isinstance(backends.rate_limiter, redis_backends.RedisRateLimitBackend)


def test_configure_middleware_backends_blank_string_collapses_to_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty string for backend name is treated as the default ``memory``.

    Operators routinely template ``RATE_LIMIT_BACKEND=`` in CI configs
    expecting the documented default; the factory should not blow up
    on the empty string.
    """

    cfg = replace(
        app_settings,
        rate_limit_backend="",
        budget_backend="",
        redis_uri="",
    )
    backends = main._configure_middleware_backends(cfg)

    assert isinstance(backends.budget_tracker, _budget.InMemoryBudgetBackend)
    assert isinstance(backends.rate_limiter, _rate_limit.InMemoryRateLimitBackend)
