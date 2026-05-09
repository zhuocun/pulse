"""Stripe-style ``Idempotency-Key`` request cache for the agent surface.

Without an idempotency layer a naive client retry (FE timeout, network
blip, browser auto-retry) silently re-runs the agent and double-debits
the per-project monthly token budget enforced by
:mod:`app.middleware.budget`. The cache short-circuits a duplicate
request -- same caller, same canonical route identity (see
:func:`canonical_idempotency_path`), same key, same body fingerprint --
straight to the original response, skipping every gate and the agent
run so the original call's spend is the only one that lands.

Pluggable backend symmetric to :mod:`app.middleware.budget` and
:mod:`app.middleware.rate_limit`. The in-process implementation below
keeps a ``threading.Lock``-guarded dict; the Redis implementation in
:mod:`app.middleware.redis_backends` uses a single ``SET NX EX`` Lua
script so the reservation step is atomic across workers. Routers reach
the singleton via :data:`idempotency_cache`, and the FastAPI lifespan
swaps it via :func:`configure_idempotency_backend` based on
``IDEMPOTENCY_BACKEND``.

Semantics mirror Stripe:

* No header on the request -> bypass the cache entirely.
* First call with a key -> reserve, run handler, store the 2xx.
* Replay with the same key + same body fingerprint -> return the
  cached ``(status_code, body, headers)`` and stamp
  ``Idempotent-Replay: true`` so callers / observers can tell.
* Replay with the same key but a *different* fingerprint -> 422
  ``idempotency_key_reused``. Stripe's behaviour: a key in flight or
  already used cannot be applied to a different request body (the
  in-flight case compares fingerprints before returning 409).
* Sibling call while the original is still running with the *same*
  fingerprint -> 409 ``idempotency_key_in_progress``.
* Failed handler (exception, non-2xx) releases the reservation so a
  real retry can proceed. Only successful 2xx responses are cached.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional, Protocol, Tuple, runtime_checkable


DEFAULT_TTL_SECONDS = 86_400


def canonical_idempotency_path(url_path: str) -> str:
    """Return the stable path segment used in fingerprints and cache keys.

    The AI router mounts twice (``/api/v1/ai`` and ``/api/ai``); requests to
    either prefix must collide on the same idempotency slot. Everything else
    keeps the request path (with trailing slashes stripped) so existing
    fingerprints stay aligned with historical behaviour for non-AI routes.
    """

    path = url_path.split("?", 1)[0]
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    if path.startswith("/api/v1/ai/"):
        return "/api/ai/" + path.removeprefix("/api/v1/ai/")
    return path


def fingerprint_request(method: str, path: str, body: Any) -> str:
    """Return a stable SHA-256 fingerprint for ``(method, canonical_path, body)``.

    ``json.dumps(..., sort_keys=True, default=str, separators=...)``
    canonicalises the body so two semantically-identical payloads (key
    ordering aside) hash to the same value -- the comparison Stripe
    uses to detect "same key, different body". ``default=str`` keeps
    odd-but-jsonable values (``UUID``, ``datetime``) hashable without
    raising -- the FE wire shape is plain JSON in practice but the
    helper is also called from internal code that may pass anything
    the handler accepted.
    """

    logical_path = canonical_idempotency_path(path)
    canonical = json.dumps(
        {"method": method, "path": logical_path, "body": body},
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def cache_key(scope: str, path: str, key: str) -> str:
    """Compose the per-(subject, canonical_path, client-key) cache slot identifier.

    Scoping by ``scope`` (the auth subject) and the canonical path means two
    users sharing the same key cannot read each other's cached responses,
    and the same key on a different logical handler is a fresh slot rather
    than a fingerprint mismatch.
    """

    return f"{scope}:{canonical_idempotency_path(path)}:{key}"


@dataclass(frozen=True)
class CachedResponse:
    """A successful 2xx response captured for replay.

    Stored alongside the body fingerprint so a follow-up call with the
    same key but a different body can be detected and rejected without
    serving the wrong cached response.
    """

    status_code: int
    body: Any
    headers: Dict[str, str]
    fingerprint: str


@runtime_checkable
class IdempotencyBackend(Protocol):
    """Per-(subject, canonical route, client-key) request cache.

    Both the in-process implementation below and the Redis
    implementation in :mod:`app.middleware.redis_backends` satisfy
    this protocol. Route handlers depend on the protocol -- never on a
    concrete class -- so the backend is swappable at lifespan time
    without touching the gates.
    """

    ttl_seconds: int

    def reserve(
        self, key: str, fingerprint: str
    ) -> Tuple[
        Optional[CachedResponse],
        Literal["fresh", "in_flight", "completed", "mismatch_pending"],
    ]: ...

    def store(self, key: str, response: CachedResponse) -> bool: ...

    def release(self, key: str, fingerprint: Optional[str] = None) -> bool: ...

    def reset(self) -> None: ...


class _Pending:
    """Sentinel marking an in-flight reservation in the in-memory store.

    Carries the fingerprint so a sibling call with the same key but a
    different body can be rejected even before the original handler
    returns -- otherwise a true concurrent retry of a *different*
    payload would race past the check and get its response cached
    against the same slot.
    """

    __slots__ = ("fingerprint",)

    def __init__(self, fingerprint: str) -> None:
        self.fingerprint = fingerprint


@dataclass
class _Slot:
    """In-memory cache entry; either a pending reservation or a stored response."""

    expires_at: float
    pending: Optional[_Pending] = None
    response: Optional[CachedResponse] = None


@dataclass
class InMemoryIdempotencyBackend:
    """In-process idempotency cache using a ``threading.Lock``-guarded dict.

    The lock makes the reserve-or-replay decision atomic *within a
    single process*: two requests racing through the gate cannot both
    pass with status ``"fresh"`` and both run the agent. Multi-worker /
    serverless deployments should switch to ``RedisIdempotencyBackend``
    -- otherwise each worker keeps its own private slot map and a
    duplicate request that lands on a sibling worker will not be
    deduplicated.

    TTL uses :func:`time.monotonic` (process-local clock, immune to
    NTP jumps that would let an entry seem alive past its real expiry
    on the wall clock). On expired-on-read the slot is treated as
    fresh and overwritten in place; we don't run a background sweeper
    because the slot count is bounded by the active client population
    and dropping a stale entry on access is sufficient.
    """

    ttl_seconds: int = DEFAULT_TTL_SECONDS
    _slots: Dict[str, _Slot] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def reserve(
        self, key: str, fingerprint: str
    ) -> Tuple[
        Optional[CachedResponse],
        Literal["fresh", "in_flight", "completed", "mismatch_pending"],
    ]:
        now = time.monotonic()
        with self._lock:
            slot = self._slots.get(key)
            if slot is not None and slot.expires_at <= now:
                # Expired: drop and treat as fresh.
                slot = None
            if slot is None:
                self._slots[key] = _Slot(
                    expires_at=now + self.ttl_seconds,
                    pending=_Pending(fingerprint=fingerprint),
                )
                return None, "fresh"
            if slot.response is not None:
                return slot.response, "completed"
            pending = slot.pending
            if pending is not None and pending.fingerprint != fingerprint:
                return None, "mismatch_pending"
            return None, "in_flight"

    def store(self, key: str, response: CachedResponse) -> bool:
        now = time.monotonic()
        with self._lock:
            slot = self._slots.get(key)
            if slot is None:
                return False
            if slot.expires_at <= now:
                self._slots.pop(key, None)
                return False
            pending = slot.pending
            if pending is None or pending.fingerprint != response.fingerprint:
                return False
            self._slots[key] = _Slot(
                expires_at=now + self.ttl_seconds,
                response=response,
            )
            return True

    def release(self, key: str, fingerprint: Optional[str] = None) -> bool:
        with self._lock:
            if fingerprint is None:
                return self._slots.pop(key, None) is not None
            slot = self._slots.get(key)
            if slot is None:
                return False
            if slot.expires_at <= time.monotonic():
                self._slots.pop(key, None)
                return False
            pending = slot.pending
            if pending is None or pending.fingerprint != fingerprint:
                return False
            self._slots.pop(key, None)
            return True

    def reset(self) -> None:
        """Clear every cached slot (test helper)."""

        with self._lock:
            self._slots.clear()


# Module-level singleton. Routers reach it via ``from app.middleware
# import idempotency`` + ``idempotency.idempotency_cache.X(...)`` so
# they pick up :func:`configure_idempotency_backend` swaps without
# reloading the module.
idempotency_cache: IdempotencyBackend = InMemoryIdempotencyBackend()


def configure_idempotency_backend(backend: IdempotencyBackend) -> None:
    """Replace the module-level :data:`idempotency_cache`.

    Called from the FastAPI lifespan when ``IDEMPOTENCY_BACKEND=redis``
    or when the configured TTL needs to take effect on the in-memory
    backend, and from test setup to install a fresh cache between
    scenarios that need true isolation.
    """

    global idempotency_cache
    idempotency_cache = backend
