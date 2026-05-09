"""Idempotency check with Prometheus counters for mismatch / in-flight outcomes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status

from app.middleware.idempotency_guard import IdempotencyContext, check_idempotency
from app.observability.metrics import record_idempotency


async def check_idempotency_with_metrics(
    request: Request,
    payload: dict[str, Any],
    *,
    auth_subject: str,
    route: str,
    operation_id: str | None = None,
) -> IdempotencyContext:
    """Wrap :func:`check_idempotency` so 422 / 409 outcomes get counted."""

    try:
        return await check_idempotency(
            request,
            payload,
            auth_subject=auth_subject,
            operation_id=operation_id,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
            record_idempotency(route, "mismatch")
        elif exc.status_code == status.HTTP_409_CONFLICT:
            record_idempotency(route, "in_flight")
        raise
