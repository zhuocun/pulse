"""Router-side helper for the :mod:`app.middleware.idempotency` cache.

Centralises the header-parse + reserve + store + release dance so the
agent and AI routers can opt in with three short calls (check at the
top, store before returning, release on exception) instead of
re-implementing the Stripe-style protocol in every handler.
Fingerprints and cache keys incorporate :func:`~app.middleware.idempotency.canonical_idempotency_path` via the helpers in that module.

Header parsing is strict by design: an empty string is treated as
"no header" so a FE that sends ``Idempotency-Key: `` does not silently
collide with an unrelated request, oversized keys (>255 chars per
Stripe's documented cap) are 400 to keep the cache key bounded, and
keys with characters outside ``[A-Za-z0-9_\\-:./]`` are 400 because
they end up concatenated into the cache key string and a stray
control char or ``"`` would invite injection through any logging /
Redis CLI exposure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, status

from app.middleware import idempotency as _idempotency
from app.middleware.idempotency import CachedResponse


_MAX_KEY_LENGTH = 255
_KEY_RE = re.compile(r"^[A-Za-z0-9_\-:./]+$")


@dataclass
class IdempotencyContext:
    """Per-request handle returned by :func:`check_idempotency`.

    A handler reads ``cached_response`` first: a non-``None`` value is
    a hit and the handler returns it directly (the caller stamps
    ``Idempotent-Replay: true``). Otherwise the handler runs the
    normal flow and calls :meth:`store` before returning, or
    :meth:`release` from an exception handler so the slot does not
    block legitimate retries for 24h.

    ``enabled`` is ``False`` when the request did not send the header;
    callers should still construct the context but treat the absent
    cached_response as the unconditional run path. :meth:`store` /
    :meth:`release` are no-ops in that case so handlers do not need to
    branch.
    """

    enabled: bool
    cache_key: Optional[str]
    fingerprint: Optional[str]
    cached_response: Optional[CachedResponse] = None

    def store(
        self,
        status_code: int,
        body: Any,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        """Persist a successful 2xx response into the cache slot."""

        if not self.enabled or self.cache_key is None or self.fingerprint is None:
            return
        _idempotency.idempotency_cache.store(
            self.cache_key,
            CachedResponse(
                status_code=status_code,
                body=body,
                headers=dict(headers or {}),
                fingerprint=self.fingerprint,
            ),
        )

    def release(self) -> None:
        """Drop the in-flight reservation so a real retry can proceed."""

        if not self.enabled or self.cache_key is None:
            return
        _idempotency.idempotency_cache.release(self.cache_key, self.fingerprint)


async def check_idempotency(
    request: Request,
    payload: Any,
    *,
    auth_subject: str,
) -> IdempotencyContext:
    """Look up ``Idempotency-Key`` in the cache and return the per-request context.

    No header -> ``ctx.enabled = False`` and the handler runs
    unconditionally. With a header we reserve the slot atomically; on
    completed-replay the cached response is returned via
    ``ctx.cached_response`` for the handler to serve, on
    fingerprint-mismatch we raise 422, on a sibling in-flight call we
    raise 409.
    """

    raw = request.headers.get("Idempotency-Key", "").strip()
    if not raw:
        return IdempotencyContext(enabled=False, cache_key=None, fingerprint=None)
    if len(raw) > _MAX_KEY_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_idempotency_key",
                "message": (
                    f"Idempotency-Key must be at most {_MAX_KEY_LENGTH} characters."
                ),
            },
        )
    if not _KEY_RE.match(raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "invalid_idempotency_key",
                "message": (
                    "Idempotency-Key may only contain "
                    "letters, digits, and the characters _ - : . /"
                ),
            },
        )

    path = request.url.path
    fingerprint = _idempotency.fingerprint_request(request.method, path, payload)
    key = _idempotency.cache_key(auth_subject, path, raw)

    cached, state = _idempotency.idempotency_cache.reserve(key, fingerprint)
    if state == "completed":
        # Stripe's behaviour: a key that resolved to a different body
        # is a client bug -- they reused a key for a different payload
        # -- and serving the original cached response would be wrong.
        if cached is not None and cached.fingerprint != fingerprint:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "error": "idempotency_key_reused",
                    "message": (
                        "This Idempotency-Key was already used for a "
                        "request with a different body."
                    ),
                },
            )
        return IdempotencyContext(
            enabled=True,
            cache_key=key,
            fingerprint=fingerprint,
            cached_response=cached,
        )
    if state == "mismatch_pending":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "idempotency_key_reused",
                "message": (
                    "This Idempotency-Key was already used for a "
                    "request with a different body."
                ),
            },
        )
    if state == "in_flight":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "idempotency_key_in_progress",
                "message": (
                    "A request with this Idempotency-Key is still in progress."
                ),
            },
        )
    return IdempotencyContext(
        enabled=True,
        cache_key=key,
        fingerprint=fingerprint,
    )
