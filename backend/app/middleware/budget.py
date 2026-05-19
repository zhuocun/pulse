"""Per-project monthly token budget (PRD v2.1 §5A.7 step 4 + §6.4).

Pluggable backend so the same gate code in the routers works against an
in-process dict (the default -- perfect for tests and single-process
dev), Redis (production, shared across workers via Lua-script
atomicity), or Postgres (production, shared across workers via
``INSERT ... ON CONFLICT DO UPDATE`` atomicity). The contract is the
same either way: route handlers depend only on :class:`BudgetBackend`,
and the FastAPI lifespan swaps the module-level :data:`budget_tracker`
to whichever concrete backend ``BUDGET_BACKEND`` selects.

The Redis implementation lives in :mod:`app.middleware.redis_backends`;
the Postgres implementation in :mod:`app.middleware.budget_pg`. Both
are imported lazily so installs that only need the in-memory default
don't pay the cost of optional dependencies.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable

from fastapi import Request

from app.config import settings

DEFAULT_MONTHLY_TOKEN_CAP = 1_000_000


def _current_month_key(now: Optional[datetime] = None) -> str:
    moment = now or datetime.now(timezone.utc)
    return f"{moment.year:04d}-{moment.month:02d}"


@runtime_checkable
class BudgetBackend(Protocol):
    """Per-(project, month) token cap.

    Both the in-process implementation below and the Redis
    implementation in :mod:`app.middleware.redis_backends` satisfy
    this protocol. Route handlers depend on the protocol -- never on a
    concrete class -- so the backend is swappable at lifespan time
    without touching the gates.

    ``monthly_cap`` is exposed as a plain attribute (not a method) to
    keep the existing ``budget_tracker.monthly_cap`` reads in the test
    suite working unchanged.
    """

    monthly_cap: int

    def remaining(
        self, project_id: str, month: Optional[str] = None
    ) -> int: ...

    def can_spend(self, project_id: str, tokens: int = 1) -> bool: ...

    def reserve(self, project_id: str, tokens: int) -> bool: ...

    def record(self, project_id: str, tokens: int) -> None: ...

    def refund(self, project_id: str, tokens: int) -> None: ...

    def reset(self) -> None: ...


@dataclass
class InMemoryBudgetBackend:
    """In-process budget tracker using a ``threading.Lock``-guarded dict.

    The previous design split spend into two phases (pre-book at gate
    time, true-up after the call) but never persisted the pre-book so
    concurrent requests could collectively overshoot the cap. This
    version exposes :meth:`reserve` (records up front, returns
    ``False`` if it would exceed the cap) and :meth:`refund` (returns
    unspent tokens after the run) so the gate is genuinely atomic
    *within a single process*. Multi-worker / serverless deployments
    should switch to ``RedisBudgetBackend`` -- otherwise each worker
    enforces the cap against its own private dict and the effective
    org-wide cap becomes ``workers x configured`` (and a cold start
    zeroes the running tally).
    """

    monthly_cap: int = DEFAULT_MONTHLY_TOKEN_CAP
    _spend: dict[tuple[str, str], int] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def remaining(
        self, project_id: str, month: Optional[str] = None
    ) -> int:
        """Return the tokens still available for ``project_id`` this month."""

        m = month or _current_month_key()
        with self._lock:
            return max(
                0, self.monthly_cap - self._spend.get((project_id, m), 0)
            )

    def can_spend(self, project_id: str, tokens: int = 1) -> bool:
        """Whether ``tokens`` more would still fit in the cap."""

        return self.remaining(project_id) >= tokens

    def reserve(self, project_id: str, tokens: int) -> bool:
        """Atomically reserve ``tokens`` if room remains.

        Returns ``True`` and adds ``tokens`` to the tally on success;
        returns ``False`` without mutating state when the request would
        exceed the cap. Combined with :meth:`refund` this lets the
        gate enforce a real upper bound under concurrency.
        """

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        key = (project_id, m)
        with self._lock:
            current = self._spend.get(key, 0)
            if current + tokens > self.monthly_cap:
                return False
            self._spend[key] = current + tokens
        return True

    def record(self, project_id: str, tokens: int) -> None:
        """Add ``tokens`` to the current-month tally (no cap check)."""

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        key = (project_id, m)
        with self._lock:
            self._spend[key] = self._spend.get(key, 0) + tokens

    def refund(self, project_id: str, tokens: int) -> None:
        """Return previously-reserved tokens to the available pool."""

        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        m = _current_month_key()
        key = (project_id, m)
        with self._lock:
            self._spend[key] = max(
                0, self._spend.get(key, 0) - tokens
            )

    def reset(self) -> None:
        """Clear the tally (test helper)."""

        with self._lock:
            self._spend.clear()


# Backwards-compat alias. Test code (and anything else that constructs
# the in-memory tracker directly) keeps importing ``BudgetTracker``;
# the only change for those call sites is that the class name now
# explicitly says "InMemory" in its canonical form.
BudgetTracker = InMemoryBudgetBackend


# Module-level singleton. Routers reach it via ``from app.middleware
# import budget`` + ``budget.budget_tracker.X()`` so they pick up
# :func:`configure_budget_backend` swaps without reloading the module.
budget_tracker: BudgetBackend = InMemoryBudgetBackend(
    monthly_cap=settings.agent_budget_monthly_token_cap
)


def configure_budget_backend(backend: BudgetBackend) -> None:
    """Replace the module-level :data:`budget_tracker`.

    Called from the FastAPI lifespan when ``BUDGET_BACKEND=redis``,
    and from test setup to install a fresh in-process tracker between
    scenarios that need true isolation. Returns nothing -- the swap
    is global to this module's namespace.
    """

    global budget_tracker
    budget_tracker = backend


def get_budget_tracker(request: Request) -> BudgetBackend:
    """FastAPI dependency: returns the per-app budget tracker backend.

    Reads from ``request.app.state.budget_tracker`` so tests can override via
    ``app.dependency_overrides[get_budget_tracker] = ...``. Falls back to the
    module-level singleton when state is not populated.
    """
    return getattr(request.app.state, "budget_tracker", budget_tracker)


# ---------------------------------------------------------------------------
# Backend factory
#
# Selects an implementation by name. Used by the FastAPI lifespan to wire
# the per-app :data:`budget_tracker` and by test harnesses that want to
# swap backends without touching ``app.main``. Returning ``None`` for the
# postgres / redis paths defers construction to the caller (which owns
# the connection pool / client lifetime), mirroring the
# :func:`app.agents.checkpointing.build_checkpointer` /
# :func:`open_checkpointer` split.
# ---------------------------------------------------------------------------


SUPPORTED_BUDGET_BACKENDS: frozenset[str] = frozenset(
    {"memory", "redis", "postgres"}
)


def build_budget_backend(
    backend: str,
    *,
    monthly_cap: int = DEFAULT_MONTHLY_TOKEN_CAP,
    redis_client: Optional[object] = None,
    postgres_pool: Optional[object] = None,
) -> BudgetBackend:
    """Construct a :class:`BudgetBackend` for ``backend``.

    - ``"memory"`` → fresh :class:`InMemoryBudgetBackend`.
    - ``"redis"`` → :class:`RedisBudgetBackend` (requires ``redis_client``).
    - ``"postgres"`` → :class:`PostgresBudgetBackend` (requires
      ``postgres_pool`` -- an :class:`~psycopg_pool.AsyncConnectionPool`,
      typically the one shared with the LangGraph checkpoint saver).

    Lazy imports keep the optional Redis / psycopg deps out of the
    in-memory path so installs that never select them stay slim.
    """

    normalized = (backend or "").strip().lower() or "memory"
    if normalized == "memory":
        return InMemoryBudgetBackend(monthly_cap=monthly_cap)
    if normalized == "redis":
        if redis_client is None:
            raise RuntimeError(
                "BUDGET_BACKEND=redis requires a redis client; pass one "
                "from app.middleware.redis_backends.build_redis_client(...)"
            )
        from app.middleware.redis_backends import RedisBudgetBackend

        return RedisBudgetBackend(redis_client, monthly_cap=monthly_cap)
    if normalized == "postgres":
        if postgres_pool is None:
            raise RuntimeError(
                "BUDGET_BACKEND=postgres requires an AsyncConnectionPool; "
                "pass one from "
                "app.agents.checkpointing.enter_agent_postgres_pool(...)"
            )
        from app.middleware.budget_pg import PostgresBudgetBackend

        return PostgresBudgetBackend(postgres_pool, monthly_cap=monthly_cap)
    raise RuntimeError(
        f"Unsupported BUDGET_BACKEND={backend!r}; "
        f"expected one of {', '.join(sorted(SUPPORTED_BUDGET_BACKENDS))}."
    )
