"""Redis-backed implementations of :class:`BudgetBackend`,
:class:`RateLimitBackend`, and :class:`IdempotencyBackend`.

The in-process defaults in :mod:`app.middleware.budget`,
:mod:`app.middleware.rate_limit`, and :mod:`app.middleware.idempotency`
enforce caps and dedup state within a single Python process. On a
multi-worker deploy or any serverless runtime each worker has its own
dict, so the effective org-wide cap becomes ``workers x configured``,
a cold start zeroes the running tally, and a duplicate request that
lands on a sibling worker would not be deduplicated. The Redis
backends move the state to a shared store and use server-side Lua
scripts so the check-and-mutate sequence stays atomic across workers.

All three backends share a single ``redis.Redis`` client (the
lifespan constructs one and passes it to each). Operators select the
backends via ``BUDGET_BACKEND=redis``, ``RATE_LIMIT_BACKEND=redis``,
and ``IDEMPOTENCY_BACKEND=redis``; ``REDIS_URI`` configures the
client. The optional ``[redis]`` extra in ``pyproject.toml`` carries
the ``redis`` package; the lazy import in this module mirrors the
LangChain / Postgres pattern so the dev / stub installs stay slim.
"""

from __future__ import annotations

import json
import time
import uuid
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Literal, Optional, Tuple

from app.middleware.budget import (
    DEFAULT_MONTHLY_TOKEN_CAP,
    BudgetBackend,
    _current_month_key,
)
from app.middleware.idempotency import (
    DEFAULT_TTL_SECONDS,
    CachedResponse,
    IdempotencyBackend,
)
from app.middleware.rate_limit import DEFAULT_LIMIT, RateLimitBackend


def _budget_key_ttl_seconds(month: Optional[str] = None) -> int:
    """Seconds until the budget key can be dropped after the billed month ends.

    Redis budget keys would otherwise accumulate one string per project
    per month forever. Expiring shortly after month rollover caps growth
    while keeping last month's tallies visible briefly for dashboards.
    """

    key = month or _current_month_key()
    year_s, mon_s = key.split("-", 1)
    year, mon = int(year_s), int(mon_s)
    last_dom = monthrange(year, mon)[1]
    month_end = datetime(year, mon, last_dom, tzinfo=timezone.utc) + timedelta(days=1)
    now = datetime.now(timezone.utc)
    ttl = int((month_end - now).total_seconds()) + 7 * 86_400
    return max(ttl, 86_400)


def build_redis_client(uri: str, **kwargs: Any) -> Any:
    """Build a sync ``redis.Redis`` client from ``uri``.

    The import lives inside the function so the ``redis`` package
    only needs to be installed when the operator opts into the Redis
    backends. Mirrors :func:`app.agents.llm._require_integration`'s
    lazy-import pattern: a missing package surfaces a clear
    operator-facing message instead of a generic ``ImportError``.

    ``decode_responses=True`` is forced because the Lua scripts
    return strings / lists of strings and the client-side parsing
    in this module assumes that.
    """

    try:
        import redis  # noqa: PLC0415 -- intentional lazy import
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "redis is not installed but BUDGET_BACKEND, "
            "RATE_LIMIT_BACKEND, or IDEMPOTENCY_BACKEND resolved to "
            '\'redis\'. Run `pip install ".[redis]"` (or `".[ai]"`) '
            "or set them all back to 'memory'."
        ) from exc

    return redis.Redis.from_url(uri, decode_responses=True, **kwargs)


def _iter_scan_keys(client: Any, pattern: str) -> Iterable[str]:
    """Yield Redis keys matching ``pattern`` via ``SCAN`` (cursor iteration)."""

    cursor = 0
    while True:
        cursor, batch = client.scan(cursor=cursor, match=pattern, count=100)
        for key in batch:
            yield key
        if cursor == 0:
            return


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


_BUDGET_RESERVE_LUA = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local requested = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if current + requested > cap then
    return 0
end
redis.call('INCRBY', KEYS[1], requested)
redis.call('EXPIRE', KEYS[1], ttl)
return 1
"""

_BUDGET_REFUND_LUA = """
local new = redis.call('DECRBY', KEYS[1], ARGV[1])
local ttl = tonumber(ARGV[2])
if new < 0 then
    redis.call('SET', KEYS[1], 0)
    redis.call('EXPIRE', KEYS[1], ttl)
    return 0
end
redis.call('EXPIRE', KEYS[1], ttl)
return new
"""


class RedisBudgetBackend:
    """Per-(project, month) token cap backed by a Redis string per bucket.

    The reserve path uses a Lua script so the GET-check-INCRBY sequence
    is one round-trip and atomic across workers; without that, two
    workers racing through the gate could both pass when only one
    slot remained, exactly the failure mode the in-process
    ``threading.Lock`` was working around. ``record`` is a plain
    INCRBY (no cap check, mirrors the in-process ``record``);
    ``refund`` runs a small Lua script that DECRBYs and clamps to 0
    so an over-refund cannot push the tally negative.

    Keys live under ``{prefix}{project_id}:{month_key}`` where
    ``prefix`` defaults to ``"budget:"``. The prefix is overridable
    so tests can isolate state without flushing the shared db, and so
    a single Redis instance can host budgets for multiple deployments.
    """

    def __init__(
        self,
        client: Any,
        *,
        monthly_cap: int = DEFAULT_MONTHLY_TOKEN_CAP,
        prefix: str = "budget:",
    ) -> None:
        self._client = client
        self.monthly_cap = monthly_cap
        self._prefix = prefix
        # ``register_script`` returns a Script object that wraps
        # EVALSHA + EVAL fallback so the script is uploaded once and
        # subsequent calls are a single round-trip on the SHA hit.
        self._reserve_script = client.register_script(_BUDGET_RESERVE_LUA)
        self._refund_script = client.register_script(_BUDGET_REFUND_LUA)

    def _key(self, project_id: str, month: Optional[str] = None) -> str:
        return f"{self._prefix}{project_id}:{month or _current_month_key()}"

    def remaining(self, project_id: str, month: Optional[str] = None) -> int:
        raw = self._client.get(self._key(project_id, month))
        spent = int(raw) if raw is not None else 0
        return max(0, self.monthly_cap - spent)

    def can_spend(self, project_id: str, tokens: int = 1) -> bool:
        return self.remaining(project_id) >= tokens

    def reserve(self, project_id: str, tokens: int) -> bool:
        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        ttl = _budget_key_ttl_seconds()
        result = self._reserve_script(
            keys=[self._key(project_id)],
            args=[tokens, self.monthly_cap, ttl],
        )
        return int(result) == 1

    def record(self, project_id: str, tokens: int) -> None:
        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        key = self._key(project_id)
        self._client.incrby(key, tokens)
        self._client.expire(key, _budget_key_ttl_seconds())

    def refund(self, project_id: str, tokens: int) -> None:
        if tokens < 0:
            raise ValueError("tokens must be non-negative")
        ttl = _budget_key_ttl_seconds()
        self._refund_script(keys=[self._key(project_id)], args=[tokens, ttl])

    def reset(self) -> None:
        """Delete every key under this backend's prefix.

        SCAN-then-DELETE rather than FLUSHDB so a Redis instance
        shared across deployments (or sharing the rate-limit prefix)
        stays intact. Test-only; production code should never call
        this.
        """

        for key in _iter_scan_keys(self._client, f"{self._prefix}*"):
            self._client.delete(key)


# ---------------------------------------------------------------------------
# Rate limit
# ---------------------------------------------------------------------------


# Sliding-window rate limit:
#   KEYS[1] = minute-window sorted set
#   KEYS[2] = hour-window sorted set
#   ARGV[1] = now (unix seconds, float)
#   ARGV[2] = per-minute limit
#   ARGV[3] = per-hour limit
#   ARGV[4] = unique member to ZADD on success
#
# Eviction-then-count-then-conditional-add keeps the sequence atomic
# so two workers cannot both pass when only one slot remains. Both
# sets get an EXPIRE so abandoned (agent, user) buckets do not leak
# Redis memory after the user goes idle.
_RATE_LIMIT_CHECK_LUA = """
local minute_key = KEYS[1]
local hour_key = KEYS[2]
local now = tonumber(ARGV[1])
local per_minute = tonumber(ARGV[2])
local per_hour = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', minute_key, '-inf', now - 60)
redis.call('ZREMRANGEBYSCORE', hour_key, '-inf', now - 3600)

local minute_count = redis.call('ZCARD', minute_key)
if minute_count >= per_minute then
    local oldest = redis.call('ZRANGE', minute_key, 0, 0, 'WITHSCORES')
    local retry = math.ceil(60 - (now - tonumber(oldest[2])))
    if retry < 1 then retry = 1 end
    return {0, retry}
end

local hour_count = redis.call('ZCARD', hour_key)
if hour_count >= per_hour then
    local oldest = redis.call('ZRANGE', hour_key, 0, 0, 'WITHSCORES')
    local retry = math.ceil(3600 - (now - tonumber(oldest[2])))
    if retry < 1 then retry = 1 end
    return {0, retry}
end

redis.call('ZADD', minute_key, now, member)
redis.call('ZADD', hour_key, now, member)
redis.call('EXPIRE', minute_key, 120)
redis.call('EXPIRE', hour_key, 7200)

return {1, 0}
"""


class RedisRateLimitBackend:
    """Sliding-window rate limit backed by Redis sorted sets.

    Two sorted sets per ``(agent, user)`` -- one per window -- with
    timestamps as scores. ``check`` runs a single Lua script that
    evicts old entries, counts what's left, and conditionally adds a
    new entry; the eviction-count-add sequence is atomic so two
    workers cannot both pass when only one slot remains. ``EXPIRE``
    on the keys keeps Redis memory bounded after a bucket goes idle.

    The score is the wall-clock time (``time.time()``), not the
    process-local monotonic clock the in-process backend uses --
    Redis is shared across processes so they don't share a monotonic
    reference. Members are made unique with a per-call UUID4 suffix
    so two requests that arrive in the same microsecond don't
    collapse to a single ZSET entry (and thus a missed throttle).
    """

    def __init__(
        self,
        client: Any,
        *,
        prefix: str = "ratelimit:",
    ) -> None:
        self._client = client
        self._prefix = prefix
        self._check_script = client.register_script(_RATE_LIMIT_CHECK_LUA)

    def _keys(self, agent: str, user_id: str) -> Tuple[str, str]:
        base = f"{self._prefix}{agent}:{user_id}"
        return f"{base}:m", f"{base}:h"

    def check(
        self,
        agent: str,
        user_id: str,
        *,
        limits: Optional[Tuple[int, int]] = None,
        now: Optional[float] = None,
    ) -> tuple[bool, int]:
        per_minute, per_hour = limits if limits is not None else DEFAULT_LIMIT
        ts = time.time() if now is None else now
        member = f"{ts}:{uuid.uuid4().hex[:8]}"
        minute_key, hour_key = self._keys(agent, user_id)
        result = self._check_script(
            keys=[minute_key, hour_key],
            args=[ts, per_minute, per_hour, member],
        )
        allowed = int(result[0]) == 1
        retry_after = int(result[1])
        return allowed, retry_after

    def reset(self) -> None:
        """Delete every rate-limit key under this backend's prefix."""

        for key in _iter_scan_keys(self._client, f"{self._prefix}*"):
            self._client.delete(key)


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


# SET NX EX is the canonical "reserve if absent" primitive; if it
# returns OK we own the slot and the caller runs fresh, otherwise the
# existing value (pending sentinel or stored response) is what the
# caller needs to see. Returning the value via a single Lua script
# collapses the SET-then-GET race that a non-atomic implementation
# would otherwise have.
#
#   KEYS[1] = cache key
#   ARGV[1] = JSON-encoded pending sentinel
#   ARGV[2] = TTL in seconds
_IDEMPOTENCY_RESERVE_LUA = """
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
    return false
end
local current = redis.call('GET', KEYS[1])
if not current then
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return false
end
local ok = pcall(cjson.decode, current)
if not ok then
    redis.call('DEL', KEYS[1])
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    return false
end
return current
"""


# Convert a pending reservation into a completed response only if the
# slot still belongs to the same fingerprint. This prevents a slow
# request from clobbering a newer reservation after the old pending TTL
# expired and the key was reused.
#
#   KEYS[1] = cache key
#   ARGV[1] = expected fingerprint
#   ARGV[2] = JSON-encoded completed response
#   ARGV[3] = TTL in seconds
_IDEMPOTENCY_STORE_LUA = """
local current = redis.call('GET', KEYS[1])
if not current then
    return 0
end
local ok, decoded = pcall(cjson.decode, current)
if not ok then
    return 0
end
if decoded['status'] ~= 'pending' then
    return 0
end
if tostring(decoded['fingerprint'] or '') ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""


# Drop a failed pending reservation only if it still belongs to this
# request. A late exception from an expired request must not delete a
# newer in-flight reservation that reused the key.
#
#   KEYS[1] = cache key
#   ARGV[1] = expected fingerprint
_IDEMPOTENCY_RELEASE_LUA = """
local current = redis.call('GET', KEYS[1])
if not current then
    return 0
end
local ok, decoded = pcall(cjson.decode, current)
if not ok then
    return 0
end
if decoded['status'] ~= 'pending' then
    return 0
end
if tostring(decoded['fingerprint'] or '') ~= ARGV[1] then
    return 0
end
redis.call('DEL', KEYS[1])
return 1
"""


class RedisIdempotencyBackend:
    """Per-(subject, path, key) request cache backed by a Redis string.

    Each slot is a single JSON-encoded blob -- pending sentinel before
    the handler completes, then overwritten with the captured response
    on success -- and the reserve path is a Lua script so the
    SET-NX-then-GET sequence is one atomic round-trip across workers.
    Without that, two workers racing through the gate could both pass
    with status ``"fresh"`` and both run the agent, exactly the
    failure mode the in-process ``threading.Lock`` was working around.

    Slots live under ``{prefix}{cache_key}`` where ``prefix`` defaults
    to ``"idempotency:"``. The prefix is overridable so tests can
    isolate state without flushing the shared db, and so a single
    Redis instance can host idempotency caches for multiple
    deployments alongside the budget / rate-limit prefixes.
    """

    def __init__(
        self,
        client: Any,
        *,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        prefix: str = "idempotency:",
    ) -> None:
        self._client = client
        self.ttl_seconds = ttl_seconds
        self._prefix = prefix
        # ``register_script`` returns a Script object that wraps
        # EVALSHA + EVAL fallback so the script is uploaded once and
        # subsequent calls are a single round-trip on the SHA hit.
        self._reserve_script = client.register_script(_IDEMPOTENCY_RESERVE_LUA)
        self._store_script = client.register_script(_IDEMPOTENCY_STORE_LUA)
        self._release_script = client.register_script(_IDEMPOTENCY_RELEASE_LUA)

    def _key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def reserve(
        self, key: str, fingerprint: str
    ) -> Tuple[
        Optional[CachedResponse],
        Literal["fresh", "in_flight", "completed", "mismatch_pending"],
    ]:
        pending_blob = json.dumps(
            {"status": "pending", "fingerprint": fingerprint, "response": None},
            separators=(",", ":"),
        )
        result = self._reserve_script(
            keys=[self._key(key)],
            args=[pending_blob, self.ttl_seconds],
        )
        # The Lua ``return false`` reply round-trips as ``None`` (or in
        # some redis-py versions an empty string); both mean "we just
        # took the slot".
        if not result:
            return None, "fresh"
        decoded = json.loads(result)
        if decoded.get("status") == "completed":
            response = decoded.get("response") or {}
            cached = CachedResponse(
                status_code=int(response.get("status_code", 200)),
                body=response.get("body"),
                headers=dict(response.get("headers") or {}),
                fingerprint=str(decoded.get("fingerprint", "")),
            )
            return cached, "completed"
        if str(decoded.get("fingerprint", "")) != fingerprint:
            return None, "mismatch_pending"
        return None, "in_flight"

    def store(self, key: str, response: CachedResponse) -> bool:
        blob = json.dumps(
            {
                "status": "completed",
                "fingerprint": response.fingerprint,
                "response": {
                    "status_code": response.status_code,
                    "body": response.body,
                    "headers": response.headers,
                },
            },
            separators=(",", ":"),
            default=str,
        )
        result = self._store_script(
            keys=[self._key(key)],
            args=[response.fingerprint, blob, self.ttl_seconds],
        )
        return int(result or 0) == 1

    def release(self, key: str, fingerprint: Optional[str] = None) -> bool:
        if fingerprint is None:
            return bool(self._client.delete(self._key(key)))
        result = self._release_script(
            keys=[self._key(key)],
            args=[fingerprint],
        )
        return int(result or 0) == 1

    def reset(self) -> None:
        """Delete every key under this backend's prefix.

        SCAN-then-DELETE rather than FLUSHDB so a Redis instance
        shared across deployments (or sharing the budget / rate-limit
        prefix) stays intact. Test-only; production code should never
        call this.
        """

        for key in _iter_scan_keys(self._client, f"{self._prefix}*"):
            self._client.delete(key)


__all__ = [
    "BudgetBackend",
    "IdempotencyBackend",
    "RateLimitBackend",
    "RedisBudgetBackend",
    "RedisIdempotencyBackend",
    "RedisRateLimitBackend",
    "build_redis_client",
]
