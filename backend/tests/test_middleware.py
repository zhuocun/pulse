"""Tests for :mod:`app.middleware.rate_limit`, :mod:`app.middleware.budget`,
and the :mod:`app.middleware.idempotency` singleton smoke test."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.middleware import budget as budget_module
from app.middleware import idempotency as idempotency_module
from app.middleware import rate_limit
from app.middleware.budget import (
    DEFAULT_MONTHLY_TOKEN_CAP,
    BudgetTracker,
    _current_month_key,
)
from app.middleware.idempotency import InMemoryIdempotencyBackend
from app.middleware.rate_limit import DEFAULT_LIMIT, RateLimiter


# Sample limits the catalog actually uses (PRD §5A.8).
TRIAGE_LIMITS = (10, 60)


def test_rate_limiter_allows_under_limits() -> None:
    rl = RateLimiter()
    allowed, retry = rl.check("chat-agent", "u1", limits=(20, 200), now=0.0)
    assert allowed is True
    assert retry == 0


def test_rate_limiter_denies_over_minute_limit() -> None:
    rl = RateLimiter()
    per_minute, _ = TRIAGE_LIMITS
    for _ in range(per_minute):
        allowed, _ = rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=0.0)
        assert allowed
    allowed, retry = rl.check(
        "triage-agent", "u1", limits=TRIAGE_LIMITS, now=10.0
    )
    assert allowed is False
    assert retry >= 1


def test_rate_limiter_denies_over_hour_limit() -> None:
    rl = RateLimiter()
    per_minute, per_hour = TRIAGE_LIMITS
    now = 0.0
    for _ in range(per_hour // per_minute):
        for _ in range(per_minute):
            allowed, _ = rl.check(
                "triage-agent", "u1", limits=TRIAGE_LIMITS, now=now
            )
            assert allowed
        now += 61.0
    allowed, retry = rl.check(
        "triage-agent", "u1", limits=TRIAGE_LIMITS, now=now
    )
    assert allowed is False
    assert retry >= 1


def test_rate_limiter_resets_minute_window() -> None:
    rl = RateLimiter()
    per_minute, _ = TRIAGE_LIMITS
    for _ in range(per_minute):
        rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=0.0)
    allowed, _ = rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=61.0)
    assert allowed is True


def test_rate_limiter_resets_hour_window() -> None:
    rl = RateLimiter()
    per_minute, per_hour = TRIAGE_LIMITS
    now = 0.0
    for _ in range(per_hour // per_minute):
        for _ in range(per_minute):
            rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=now)
        now += 61.0
    blocked, _ = rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=now)
    assert blocked is False
    allowed, _ = rl.check(
        "triage-agent", "u1", limits=TRIAGE_LIMITS, now=now + 3700.0
    )
    assert allowed is True


def test_rate_limiter_unknown_agent_uses_default() -> None:
    rl = RateLimiter()
    allowed, _ = rl.check("ghost-agent", "u1", now=0.0)
    assert allowed is True
    assert DEFAULT_LIMIT == (60, 600)


def test_rate_limiter_now_default_uses_monotonic() -> None:
    rl = RateLimiter()
    allowed, retry = rl.check("chat-agent", "u-default", limits=(20, 200))
    assert allowed is True
    assert retry == 0


def test_rate_limiter_reset_clears_state() -> None:
    rl = RateLimiter()
    per_minute, _ = TRIAGE_LIMITS
    for _ in range(per_minute):
        rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=0.0)
    blocked, _ = rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=0.0)
    assert blocked is False
    rl.reset()
    allowed, _ = rl.check("triage-agent", "u1", limits=TRIAGE_LIMITS, now=0.0)
    assert allowed is True


def test_rate_limiter_module_singleton_exists() -> None:
    assert isinstance(rate_limit.rate_limiter, RateLimiter)


def test_budget_tracker_remaining_is_capped_at_zero() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    tracker.record("p1", 250)
    assert tracker.remaining("p1") == 0


def test_budget_tracker_can_spend() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    assert tracker.can_spend("p1", 50)
    tracker.record("p1", 50)
    assert tracker.can_spend("p1", 50)
    assert not tracker.can_spend("p1", 51)


def test_budget_tracker_record_default_zero() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    tracker.record("p1", 0)
    assert tracker.remaining("p1") == 100


def test_budget_tracker_rejects_negative_tokens() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    with pytest.raises(ValueError, match="non-negative"):
        tracker.record("p1", -1)


def test_budget_tracker_remaining_with_explicit_month() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    tracker.record("p1", 50)
    other_month = "1999-01"
    assert tracker.remaining("p1", month=other_month) == 100


def test_budget_tracker_reset_clears_state() -> None:
    tracker = BudgetTracker(monthly_cap=100)
    tracker.record("p1", 50)
    tracker.reset()
    assert tracker.remaining("p1") == 100


def test_budget_default_cap_constant() -> None:
    assert DEFAULT_MONTHLY_TOKEN_CAP == 1_000_000


def test_budget_module_singleton_exists() -> None:
    assert isinstance(budget_module.budget_tracker, BudgetTracker)


def test_budget_module_singleton_uses_settings_cap() -> None:
    from app.config import settings

    assert budget_module.budget_tracker.monthly_cap == settings.agent_budget_monthly_token_cap


def test_current_month_key_is_year_month() -> None:
    fixed = datetime(2026, 1, 7, tzinfo=timezone.utc)
    assert _current_month_key(fixed) == "2026-01"


def test_current_month_key_default_uses_now(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FrozenDatetime:
        @classmethod
        def now(cls, tz: object = None) -> datetime:
            return datetime(2030, 12, 5, tzinfo=timezone.utc)

    monkeypatch.setattr(budget_module, "datetime", _FrozenDatetime)
    assert _current_month_key() == "2030-12"


def test_idempotency_module_singleton_exists() -> None:
    assert isinstance(
        idempotency_module.idempotency_cache, InMemoryIdempotencyBackend
    )


# ---------------------------------------------------------------------------
# DI getter tests: get_rate_limiter
# ---------------------------------------------------------------------------


def test_get_rate_limiter_returns_app_state_when_set() -> None:
    """dependency_overrides path: app.state.rate_limiter is returned."""
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from app.middleware.rate_limit import RateLimiter, RateLimitBackend, get_rate_limiter

    fake = RateLimiter()
    mini_app = FastAPI()

    @mini_app.get("/_test/rate-limiter-id")
    def _route(limiter: RateLimitBackend = Depends(get_rate_limiter)) -> dict:
        return {"id": id(limiter)}

    mini_app.state.rate_limiter = fake

    with TestClient(mini_app, raise_server_exceptions=True) as client:
        resp = client.get("/_test/rate-limiter-id")
    assert resp.status_code == 200
    assert resp.json()["id"] == id(fake)


def test_get_rate_limiter_falls_back_to_singleton_when_state_missing() -> None:
    """No app.state.rate_limiter → module-level singleton is returned."""
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from app.middleware import rate_limit as rl_module
    from app.middleware.rate_limit import RateLimitBackend, get_rate_limiter

    mini_app = FastAPI()

    @mini_app.get("/_test/rate-limiter-id")
    def _route(limiter: RateLimitBackend = Depends(get_rate_limiter)) -> dict:
        return {"id": id(limiter)}

    with TestClient(mini_app, raise_server_exceptions=True) as client:
        resp = client.get("/_test/rate-limiter-id")
    assert resp.status_code == 200
    assert resp.json()["id"] == id(rl_module.rate_limiter)


# ---------------------------------------------------------------------------
# DI getter tests: get_budget_tracker
# ---------------------------------------------------------------------------


def test_get_budget_tracker_returns_app_state_when_set() -> None:
    """dependency_overrides path: app.state.budget_tracker is returned."""
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from app.middleware.budget import BudgetBackend, BudgetTracker, get_budget_tracker

    fake = BudgetTracker(monthly_cap=42)
    mini_app = FastAPI()

    @mini_app.get("/_test/budget-tracker-id")
    def _route(tracker: BudgetBackend = Depends(get_budget_tracker)) -> dict:
        return {"id": id(tracker)}

    mini_app.state.budget_tracker = fake

    with TestClient(mini_app, raise_server_exceptions=True) as client:
        resp = client.get("/_test/budget-tracker-id")
    assert resp.status_code == 200
    assert resp.json()["id"] == id(fake)


def test_get_budget_tracker_falls_back_to_singleton_when_state_missing() -> None:
    """No app.state.budget_tracker → module-level singleton is returned."""
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from app.middleware import budget as budget_mod
    from app.middleware.budget import BudgetBackend, get_budget_tracker

    mini_app = FastAPI()

    @mini_app.get("/_test/budget-tracker-id")
    def _route(tracker: BudgetBackend = Depends(get_budget_tracker)) -> dict:
        return {"id": id(tracker)}

    with TestClient(mini_app, raise_server_exceptions=True) as client:
        resp = client.get("/_test/budget-tracker-id")
    assert resp.status_code == 200
    assert resp.json()["id"] == id(budget_mod.budget_tracker)
