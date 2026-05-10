"""Tests for the production-backend guards.

Covers:
    - :func:`app.main._is_multi_worker_or_multi_instance` — all detection
      signals (production-shaped env vars, WEB_CONCURRENCY, UVICORN_WORKERS)
      and the edge cases (single-worker, garbage values).
    - :func:`app.main._validate_memory_agent_backends` — WARNING when
      a memory agent backend is used on a production-shaped or multi-worker
      deploy; soft DEBUG log only on a single-worker local-dev run.
    - :func:`app.main._configure_middleware_backends` — WARNING when
      memory middleware backends (idempotency / rate-limit / budget) are used
      on a production-shaped or multi-worker deploy; no warning on local-dev.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Iterable

import pytest

from app import main
from app.config import settings as app_settings
from app.middleware import budget as _budget
from app.middleware import idempotency as _idempotency
from app.middleware import rate_limit as _rate_limit


# ---------------------------------------------------------------------------
# Autouse fixture: restore middleware singletons after each test so a swap
# performed by one test cannot leak into another.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _restore_middleware_singletons() -> Iterable[None]:
    original_budget = _budget.budget_tracker
    original_rate_limit = _rate_limit.rate_limiter
    original_idempotency = _idempotency.idempotency_cache
    yield
    _budget.configure_budget_backend(original_budget)
    _rate_limit.configure_rate_limit_backend(original_rate_limit)
    _idempotency.configure_idempotency_backend(original_idempotency)


# ---------------------------------------------------------------------------
# _is_multi_worker_or_multi_instance
# ---------------------------------------------------------------------------


def test_is_multi_false_with_no_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """No production env vars and no worker-count vars → single-worker."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is False
    assert reason == ""


def test_is_multi_true_when_vercel_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """Any production-shaped env var triggers the multi-instance path."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is True
    assert "VERCEL" in reason


def test_is_multi_true_when_web_concurrency_greater_than_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WEB_CONCURRENCY=4 indicates multiple Uvicorn/Gunicorn workers."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is True
    assert "WEB_CONCURRENCY" in reason
    assert "4" in reason


def test_is_multi_false_when_web_concurrency_is_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WEB_CONCURRENCY=1 is explicitly a single-worker deployment."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "1")
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is False
    assert reason == ""


def test_is_multi_false_when_web_concurrency_is_garbage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-integer WEB_CONCURRENCY is silently ignored (treated as single-worker)."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "garbage")
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is False
    assert reason == ""


def test_is_multi_true_when_uvicorn_workers_greater_than_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """UVICORN_WORKERS=2 also triggers the multi-worker path."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.setenv("UVICORN_WORKERS", "2")

    is_multi, reason = main._is_multi_worker_or_multi_instance()

    assert is_multi is True
    assert "UVICORN_WORKERS" in reason


# ---------------------------------------------------------------------------
# _validate_memory_agent_backends
# ---------------------------------------------------------------------------


def test_validate_memory_agent_backends_warns_on_production_with_checkpoint_memory(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """WARNING is emitted when VERCEL=1 and checkpoint backend is memory."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="memory",
        agent_store_backend="memory",
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        main._validate_memory_agent_backends(cfg)  # must not raise

    assert any("AGENT_CHECKPOINT_BACKEND" in r.getMessage() for r in caplog.records)


def test_validate_memory_agent_backends_warning_names_agent_store_backend(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Warning message names AGENT_STORE_BACKEND when the store backend is memory."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    # Checkpoint is postgres (not the problem), store is memory (the problem).
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="memory",
        agent_postgres_uri="postgres://localhost/test",
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        main._validate_memory_agent_backends(cfg)  # must not raise

    assert any("AGENT_STORE_BACKEND" in r.getMessage() for r in caplog.records)


def test_validate_memory_agent_backends_warns_not_raises_for_local_dev(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """On a single-worker local-dev run a DEBUG log is emitted, no RuntimeError."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="memory",
        agent_store_backend="memory",
    )

    with caplog.at_level(logging.DEBUG, logger="app.main"):
        main._validate_memory_agent_backends(cfg)  # must not raise

    assert any("memory" in record.message for record in caplog.records)


def test_validate_memory_agent_backends_no_op_when_both_postgres(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No warning or error when both backends are postgres."""
    monkeypatch.setenv("VERCEL", "1")

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        agent_postgres_uri="postgres://localhost/test",
    )

    # Should not raise regardless of the production-shaped env.
    main._validate_memory_agent_backends(cfg)


# ---------------------------------------------------------------------------
# _configure_middleware_backends — multi-instance warnings for memory backends
# ---------------------------------------------------------------------------


def test_configure_middleware_backends_warns_on_vercel_with_idempotency_memory(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """WARNING is emitted when VERCEL=1 and idempotency backend is memory."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="memory",
        redis_uri="",
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        main._configure_middleware_backends(cfg)  # must not raise

    assert any("IDEMPOTENCY_BACKEND" in r.getMessage() for r in caplog.records)


def test_configure_middleware_backends_warns_on_vercel_lists_all_memory_backends(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Warning message lists every offending memory backend in one message."""
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="memory",
        redis_uri="",
    )

    with caplog.at_level(logging.WARNING, logger="app.main"):
        main._configure_middleware_backends(cfg)  # must not raise

    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "RATE_LIMIT_BACKEND" in messages
    assert "BUDGET_BACKEND" in messages
    assert "IDEMPOTENCY_BACKEND" in messages


def test_configure_middleware_backends_no_raise_for_local_dev_all_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """On a single-worker local-dev run, all-memory middleware is allowed."""
    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="memory",
        redis_uri="",
    )

    # Must not raise; local dev and single-process test runs are fine.
    main._configure_middleware_backends(cfg)


def test_configure_middleware_backends_raises_on_web_concurrency_without_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WEB_CONCURRENCY>1 with memory backends is a hard misconfiguration."""

    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        rate_limit_backend="memory",
        budget_backend="memory",
        idempotency_backend="memory",
        redis_uri="",
    )

    with pytest.raises(RuntimeError, match="WEB_CONCURRENCY"):
        main._configure_middleware_backends(cfg)


def test_configure_middleware_backends_allows_web_concurrency_with_full_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Multi-worker env vars are safe when all three middleware backends use Redis."""

    import fakeredis

    from app.middleware import redis_backends

    for var in main._PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        rate_limit_backend="redis",
        budget_backend="redis",
        idempotency_backend="redis",
        redis_uri="redis://127.0.0.1:1/0",
    )

    fake = fakeredis.FakeRedis()
    monkeypatch.setattr(redis_backends, "build_redis_client", lambda _uri: fake)

    backends = main._configure_middleware_backends(cfg)

    assert isinstance(backends.rate_limiter, redis_backends.RedisRateLimitBackend)
