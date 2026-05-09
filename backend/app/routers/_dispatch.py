"""Shared scaffolding for the five structured v1 AI routes.

Each ``/api/ai/<route>`` handler (task-draft, task-breakdown, estimate,
readiness, board-brief, search) follows the same 18-step scaffolding:
auth → meta → unwrap → idempotency-replay → gate → limits → redact →
agent-run → suggestion-lookup → 502-fallback → budget-reconcile →
idem-store → record → return. :func:`run_v1_route` captures that common
path. Route-specific logic is isolated into two small callables:

- ``project_inputs(payload, project_id) -> dict``
  Build the agent input dict from the (already-unwrapped) payload.
- ``find_body(final_state, events) -> Any | None``
  Project the agent output onto the legacy JSON envelope.
  Return ``None`` to trigger a 502 (agent did not emit the expected
  surface).

The optional ``agent_error_fallback(payload) -> Any | None`` lets a
route supply a deterministic result when the agent is unavailable
(``AgentError``).  When omitted the ``AgentError`` propagates normally.

The chat route is *not* handled here because it uses
``_gate_with_reservation`` (reserve-based budget) and an
``asyncio.wait_for`` timeout, which are unique to the multi-round chat
loop.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException, Request, status

from app.agents import AgentRuntime
from app.agents.errors import AgentError
from app.agents.limits import enforce_request_limits
from app.middleware.budget import BudgetBackend
from app.middleware.idempotency_guard import IdempotencyContext
from app.middleware.idempotency_metrics import check_idempotency_with_metrics
from app.middleware.rate_limit import RateLimitBackend
from app.observability.metrics import record_idempotency
from app.security import current_user_id


async def run_v1_route(
    *,
    request: Request,
    payload: Dict[str, Any],
    auth_payload: Dict[str, Any],
    runtime: AgentRuntime,
    rate_limiter: RateLimitBackend,
    budget_tracker: BudgetBackend,
    project_inputs: Callable[[Dict[str, Any], Optional[str]], Dict[str, Any]],
    find_body: Callable[[Any, List[Any]], Any],
    agent_error_fallback: Optional[Callable[[Dict[str, Any]], Any]] = None,
) -> Any:
    """Execute the common scaffolding for a structured v1 AI route.

    Args:
        request: The FastAPI ``Request`` object.
        payload: Raw request body dict (not yet unwrapped).
        auth_payload: Decoded JWT payload from ``current_user_payload``.
        runtime: The application ``AgentRuntime``.
        rate_limiter: Rate-limit backend.
        budget_tracker: Budget-tracking backend.
        project_inputs: ``(payload, project_id) -> inputs dict``.
            Called after gate & limits with the unwrapped payload.
        find_body: ``(final_state, events) -> body | None``.
            Should locate the expected suggestion event and return
            ``suggestion["payload"]``, or ``None`` to trigger a 502.
        agent_error_fallback: Optional ``(payload) -> body | None``.
            When provided, an :class:`~app.agents.errors.AgentError` is
            caught and the return value of this callable is used as the
            response body (bypassing budget reconciliation).  When omitted
            ``AgentError`` propagates to the outer ``_idem_fail`` handler.

    Returns:
        The JSON-serialisable response body.

    Raises:
        :class:`~fastapi.HTTPException` on gate / limit / 502 failures.
    """
    # Import helpers from the parent module here to avoid circular imports.
    from app.routers.ai import (  # noqa: PLC0415
        _gate,
        _idem_fail,
        _idempotent_replay,
        _legacy_ai_route_meta,
        _maybe_unwrap_legacy_payload,
        _project_id_from_payload,
        _reconcile_token_budget,
    )

    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem: IdempotencyContext = await check_idempotency_with_metrics(
        request,
        payload,
        auth_subject=user_id,
        route=route_path,
        operation_id=meta.idempotency_operation,
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(
            request,
            user_id,
            project_id,
            rate_limiter=rate_limiter,
            budget_tracker=budget_tracker,
            agent_label=agent_label,
        )
        enforce_request_limits(payload, request=request)

        inputs: Dict[str, Any] = project_inputs(payload, project_id)

        body: Any = None
        final_state: Any = None
        custom_events: List[Any] = []
        if agent_error_fallback is not None:
            try:
                final_state, custom_events = await runtime.arun_with_events(
                    meta.catalog_agent_name,
                    inputs,
                    user_id=user_id,
                )
            except AgentError:
                body = agent_error_fallback(payload)
        else:
            final_state, custom_events = await runtime.arun_with_events(
                meta.catalog_agent_name,
                inputs,
                user_id=user_id,
            )

        if body is None:
            if final_state is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={
                        "error": {
                            "code": "agent_unavailable",
                            "message": "Agent did not emit an expected result.",
                        }
                    },
                )
            body = find_body(final_state, custom_events)
            if body is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={
                        "error": {
                            "code": "agent_unavailable",
                            "message": "Agent did not emit an expected result.",
                        }
                    },
                )
            _reconcile_token_budget(
                project_id, budget_tracker, final_state, custom_events
            )

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


def _find_suggestion(events: List[Any], surface: str) -> Optional[Any]:
    """Return the first ``{kind: "suggestion", surface: <surface>}`` event payload."""
    event = next(
        (
            e
            for e in events
            if isinstance(e, dict)
            and e.get("kind") == "suggestion"
            and e.get("surface") == surface
        ),
        None,
    )
    return event["payload"] if event is not None else None
