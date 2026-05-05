"""Per-agent, per-user rate limiting (PRD v2.1 §5A.8).

Pluggable backend symmetric to :mod:`app.middleware.budget`. The
in-process implementation keeps a rolling window per ``(agent,
user)`` pair using ``collections.deque`` of timestamps; the Redis
implementation in :mod:`app.middleware.redis_backends` uses sorted
sets keyed under a per-instance prefix so two workers cannot race
past the cap. The contract -- ``check(agent, user_id, *,
limits=None, now=None) -> (allowed, retry_after_seconds)`` -- is the
same either way, and the FastAPI lifespan swaps the module-level
:data:`rate_limiter` to whichever concrete backend
``RATE_LIMIT_BACKEND`` selects.

Limits come from :class:`AgentMetadata.rate_limit` and are passed
through on every check; the limiter does not own a default-limits
table.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Protocol, Tuple, runtime_checkable

DEFAULT_LIMIT: tuple[int, int] = (60, 600)


@dataclass
class _Window:
    """Rolling-window timestamps for a single (agent, user) bucket.

    A fixed-window counter (the previous design) admits 2x bursts at
    minute boundaries; a deque of timestamps gives true rolling-window
    semantics for an N-per-window limit at the cost of O(N) memory.
    Both deques are bounded by ``per_minute`` and ``per_hour`` so the
    footprint is naturally capped per active key.
    """

    minute: deque[float] = field(default_factory=deque)
    hour: deque[float] = field(default_factory=deque)


def _evict_older_than(window: deque[float], cutoff: float) -> None:
    while window and window[0] <= cutoff:
        window.popleft()


@runtime_checkable
class RateLimitBackend(Protocol):
    """Per-(agent, user) rolling-window quota.

    Both the in-process implementation below and the Redis
    implementation in :mod:`app.middleware.redis_backends` satisfy
    this protocol. Route handlers depend on the protocol, never on a
    concrete class, so the lifespan can swap the backend without
    touching the gates.
    """

    def check(
        self,
        agent: str,
        user_id: str,
        *,
        limits: Optional[Tuple[int, int]] = None,
        now: Optional[float] = None,
    ) -> tuple[bool, int]: ...

    def reset(self) -> None: ...


@dataclass
class InMemoryRateLimitBackend:
    """In-process, monotonic-clock rolling-window rate limiter.

    A ``threading.Lock`` guards the shared dict so two requests racing
    through the gate within the same worker cannot both pass when only
    one slot remains. Across workers the in-process backend cannot
    enforce a single cap -- production deployments should switch to
    ``RedisRateLimitBackend``.
    """

    _state: dict[tuple[str, str], _Window] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def check(
        self,
        agent: str,
        user_id: str,
        *,
        limits: Optional[Tuple[int, int]] = None,
        now: Optional[float] = None,
    ) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)``.

        ``retry_after_seconds`` is ``0`` when the request is allowed
        and the seconds remaining in the breached window when not.
        """

        per_minute, per_hour = (
            limits if limits is not None else DEFAULT_LIMIT
        )
        ts = time.monotonic() if now is None else now
        key = (agent, user_id)
        with self._lock:
            window = self._state.setdefault(key, _Window())
            _evict_older_than(window.minute, ts - 60.0)
            _evict_older_than(window.hour, ts - 3600.0)

            if len(window.minute) >= per_minute:
                retry = max(1, math.ceil(60.0 - (ts - window.minute[0])))
                return False, retry
            if len(window.hour) >= per_hour:
                retry = max(1, math.ceil(3600.0 - (ts - window.hour[0])))
                return False, retry

            window.minute.append(ts)
            window.hour.append(ts)
        return True, 0

    def reset(self) -> None:
        with self._lock:
            self._state.clear()


# Backwards-compat alias for tests / direct-construction call sites.
RateLimiter = InMemoryRateLimitBackend


# Module-level singleton. Routers reach it via ``from app.middleware
# import rate_limit`` + ``rate_limit.rate_limiter.check(...)`` so they
# pick up :func:`configure_rate_limit_backend` swaps without
# reloading the module.
rate_limiter: RateLimitBackend = InMemoryRateLimitBackend()


def configure_rate_limit_backend(backend: RateLimitBackend) -> None:
    """Replace the module-level :data:`rate_limiter`.

    Called from the FastAPI lifespan when ``RATE_LIMIT_BACKEND=redis``,
    and from test setup to install a fresh in-process limiter between
    scenarios that need true isolation. Returns nothing -- the swap
    is global to this module's namespace.
    """

    global rate_limiter
    rate_limiter = backend
