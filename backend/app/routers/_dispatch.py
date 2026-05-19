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

The chat route is *not* handled here because it uses an
``asyncio.wait_for`` timeout unique to the multi-round chat loop.
Structured routes share the same reserve-at-gate + reconcile-after-run
budget path implemented below.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException, Request, status

from app.agents import AgentRuntime
from app.agents.errors import AgentError, AgentNotFoundError
from app.agents.limits import enforce_request_limits
from app.agents.llm import is_chat_model_allowed, make_chat_model_for_id
from app.config import settings as default_settings
from app.middleware.budget import BudgetBackend
from app.middleware.idempotency_guard import IdempotencyContext
from app.middleware.idempotency_metrics import check_idempotency_with_metrics
from app.middleware.rate_limit import RateLimitBackend
from app.observability.metrics import record_idempotency
from app.security import current_user_id


CHAT_MODEL_OVERRIDE_HEADER = "X-Pulse-Model"


def chat_model_override_from_request(
    request: Request,
    *,
    settings: Any = None,
) -> Optional[Dict[str, Any]]:
    """Resolve the ``X-Pulse-Model`` header into a context dict, or ``None``.

    Returns ``{"chat_model": <BaseChatModel>}`` when the header is
    present and points to an allowlisted model id; the runtime's
    :meth:`AgentRuntime._build_context` picks up this key and overrides
    the agent's default.  Returns ``None`` when the header is absent so
    callers can fall through to the agent default.

    Raises :class:`fastapi.HTTPException` (400 ``unsupported_chat_model``)
    when the header is present but the value is not in the allowlist;
    operators get a clear signal rather than silent fallback.
    """

    raw = request.headers.get(CHAT_MODEL_OVERRIDE_HEADER)
    if raw is None:
        return None
    model_id = raw.strip()
    if not model_id:
        return None
    cfg = settings if settings is not None else default_settings
    if not is_chat_model_allowed(model_id, cfg):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": {
                    "code": "unsupported_chat_model",
                    "message": (
                        f"Chat model {model_id!r} is not in "
                        "AGENT_CHAT_MODEL_ALLOWLIST."
                    ),
                }
            },
        )
    return {"chat_model": make_chat_model_for_id(model_id, settings=cfg)}


def project_chat_model_from_map(
    project_id: Optional[str],
    *,
    settings: Any = None,
) -> Optional[Dict[str, Any]]:
    """Resolve per-project default chat model from the env map (header still wins in merge)."""

    if not project_id or not str(project_id).strip():
        return None
    cfg = settings if settings is not None else default_settings
    model_id = cfg.agent_project_chat_model_map.get(str(project_id).strip())
    if not model_id:
        return None
    if not is_chat_model_allowed(model_id, cfg):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": {
                    "code": "misconfigured_project_chat_model",
                    "message": (
                        f"AGENT_PROJECT_CHAT_MODEL_MAP entry for project "
                        f"{project_id!r} points to {model_id!r}, which is not "
                        "allowed by AGENT_CHAT_MODEL_ALLOWLIST."
                    ),
                }
            },
        )
    return {"chat_model": make_chat_model_for_id(model_id, settings=cfg)}


def merged_v1_chat_context(
    *,
    project_id: Optional[str],
    request: Request,
    settings: Any = None,
) -> Optional[Dict[str, Any]]:
    """Merge ``AGENT_PROJECT_CHAT_MODEL_MAP`` with ``X-Pulse-Model`` (header wins)."""

    mapped = project_chat_model_from_map(project_id, settings=settings)
    header = chat_model_override_from_request(request, settings=settings)
    if mapped is None and header is None:
        return None
    if mapped is None:
        return dict(header) if header else None
    if header is None:
        return dict(mapped)
    return {**dict(mapped), **dict(header)}


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
        _gate_with_reservation,
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
    reserved_budget = 0
    budget_reconciled = False
    project_id: Optional[str] = None
    try:
        project_id = _project_id_from_payload(payload)
        agent_missing = False
        route_metadata = None
        try:
            route_metadata = runtime.get(meta.catalog_agent_name).metadata
        except AgentNotFoundError:
            if agent_error_fallback is None:
                raise
            agent_missing = True
        reserved_budget = _gate_with_reservation(
            request,
            user_id,
            project_id,
            rate_limiter=rate_limiter,
            budget_tracker=budget_tracker,
            metadata=route_metadata,
            agent_label=agent_label,
        )
        enforce_request_limits(payload, request=request)

        if agent_missing:
            body = agent_error_fallback(payload)
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
            if reserved_budget and project_id:
                budget_tracker.refund(project_id, tokens=reserved_budget)
            idem.store(status_code=status.HTTP_200_OK, body=body)
            record_idempotency(route_path, "miss")
            return body

        inputs: Dict[str, Any] = project_inputs(payload, project_id)
        # Per-request chat-model override (``X-Pulse-Model`` header).  When
        # absent or feature is off, ``override`` is ``None`` and the runtime
        # falls back to the agent default.
        override = merged_v1_chat_context(project_id=project_id, request=request)

        body: Any = None
        final_state: Any = None
        custom_events: List[Any] = []
        if agent_error_fallback is not None:
            try:
                final_state, custom_events = await runtime.arun_with_events(
                    meta.catalog_agent_name,
                    inputs,
                    user_id=user_id,
                    context=override,
                )
            except AgentError:
                body = agent_error_fallback(payload)
        else:
            final_state, custom_events = await runtime.arun_with_events(
                meta.catalog_agent_name,
                inputs,
                user_id=user_id,
                context=override,
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
                project_id,
                budget_tracker,
                final_state,
                custom_events,
                prebooked=reserved_budget,
            )
            budget_reconciled = True
        elif reserved_budget and project_id:
            # Deterministic fallback bypasses provider usage reconciliation;
            # release the gate reservation so behavior matches the old
            # read-only ``can_spend`` gate (no debit on stub fallback).
            budget_tracker.refund(project_id, tokens=reserved_budget)
            budget_reconciled = True

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        if not budget_reconciled and reserved_budget and project_id:
            budget_tracker.refund(project_id, tokens=reserved_budget)
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
