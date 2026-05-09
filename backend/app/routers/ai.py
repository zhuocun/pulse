"""Legacy ``/api/ai/<route>`` shim for the v1 FE surfaces.

The shipped Board Copilot UI in pulse (Phases 0–4 from
``docs/prd/board-copilot-progress.md``) posts JSON to
``/api/ai/{task-draft,task-breakdown,estimate,readiness,board-brief,search,chat}``
and expects synchronous JSON back. The v2.1 streaming agent surface at
``/api/v1/agents/...`` is the recommended path for new clients, but
shipped users still hit ``/api/ai/*``. This router keeps them working
by:

1. Authenticating with the same JWT used elsewhere.
2. Running the redaction / project-access / rate-limit / budget gates
   that the v2.1 router enforces.
3. Calling :meth:`~app.agents.AgentRuntime.arun_with_events` for all
   structured routes so the catalog agents drive both the deterministic
   baseline (via pre-populated state that short-circuits interrupt nodes)
   and the optional LLM polish step in a single graph run. The agents'
   custom ``{"kind": "suggestion"}`` events carry the final payload; the
   routes extract the right surface and return it as plain JSON. The wire
   shape stays byte-identical with the old ``polish_*``-based path.
4. Forwarding ``chat`` to the ``chat-agent`` runtime so the LLM is
   shared. The chat agent binds the FE-executed tool catalogue (see
   :mod:`app.agents.catalog._chat_tools`) when a real model is
   configured, so the shim emits ``{kind: "tool_calls", toolCalls}``
   whenever the model picks a tool and the FE drives the multi-round
   loop until the model returns text.

All agent calls run through :func:`asyncio.wait_for` (chat) or the
agent's own timeout / retry logic (structured routes) so a hung
provider call surfaces as an error rather than blocking the worker
indefinitely.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, Final, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.agents import AgentRuntime
from app.agents.base import AgentMetadata
from app.agents.limits import enforce_request_limits
from app.agents.errors import AgentError
from app.agents.llm import result_token_usage_from_graph_result
from app.config import settings
from app.auth.project_access import is_project_ai_enabled
from app.middleware.budget import BudgetBackend, get_budget_tracker
from app.middleware.rate_limit import (
    DEFAULT_LIMIT,
    RateLimitBackend,
    get_rate_limiter,
)
from app.middleware.idempotency_guard import IdempotencyContext
from app.middleware.idempotency_metrics import check_idempotency_with_metrics
from app.observability.metrics import record_idempotency, record_invocation
from app.security import current_user_id, current_user_payload
from app.services.project_service import is_project_manager
from app.agents.catalog.search import semantic_search as _semantic_search
from app.tools.redaction import redact, redact_task_fields
from app.validation import api_error


logger = logging.getLogger(__name__)

router = APIRouter()


@dataclass(frozen=True, slots=True)
class LegacyAiRouteMeta:
    """Central metadata for legacy POST ``/api/ai/<suffix>`` handlers.

    The same router is mounted under ``/api/v1/ai``; :meth:`_legacy_ai_route_meta`
    resolves entries by URL suffix so both prefixes share one table.

    ``agent_label`` feeds rate-limit / metrics dimensions on the shim.
    ``catalog_agent_name`` is the :class:`~app.agents.AgentRuntime` registry key
    for polish helpers or for full ``chat-agent`` invocations.
    """

    envelope_key: Optional[str]
    agent_label: str
    catalog_agent_name: str

    @property
    def idempotency_operation(self) -> str:
        return f"legacy-ai:{self.agent_label}"


_LEGACY_AI_ROUTE_METADATA: Final[dict[str, LegacyAiRouteMeta]] = {
    "task-draft": LegacyAiRouteMeta(
        envelope_key="draft",
        agent_label="v1-task-draft",
        catalog_agent_name="task-drafting-agent",
    ),
    "task-breakdown": LegacyAiRouteMeta(
        envelope_key="draft",
        agent_label="v1-task-breakdown",
        catalog_agent_name="task-drafting-agent",
    ),
    "estimate": LegacyAiRouteMeta(
        envelope_key="estimate",
        agent_label="v1-estimate",
        catalog_agent_name="task-estimation-agent",
    ),
    "readiness": LegacyAiRouteMeta(
        envelope_key="readiness",
        agent_label="v1-readiness",
        catalog_agent_name="task-estimation-agent",
    ),
    "board-brief": LegacyAiRouteMeta(
        envelope_key="brief",
        agent_label="v1-board-brief",
        catalog_agent_name="board-brief-agent",
    ),
    "search": LegacyAiRouteMeta(
        envelope_key="search",
        agent_label="v1-search",
        catalog_agent_name="search-agent",
    ),
    "chat": LegacyAiRouteMeta(
        envelope_key=None,
        agent_label="chat-agent",
        catalog_agent_name="chat-agent",
    ),
}


def _legacy_ai_route_meta(route_path: str) -> LegacyAiRouteMeta:
    suffix = route_path.rstrip("/").rsplit("/", maxsplit=1)[-1]
    try:
        return _LEGACY_AI_ROUTE_METADATA[suffix]
    except KeyError as exc:
        raise KeyError(
            f"no legacy AI route metadata for path {route_path!r} (suffix {suffix!r})"
        ) from exc


def _idem_fail(idem: IdempotencyContext, exc: BaseException) -> None:
    """Release an idempotency reservation unless the process is exiting.

    Re-raises with ``raise ... from None`` so error reporters see the
    original traceback chain (preserved on ``exc.__traceback__``)
    without grafting on whatever exception happens to be active in
    ``sys.exc_info`` at the call site -- this matters for tests that
    invoke ``_idem_fail`` directly with a constructed exception
    instance instead of from within an ``except`` clause.
    """

    if isinstance(exc, (KeyboardInterrupt, SystemExit)):
        raise exc from None
    idem.release()
    raise exc from None


def _get_runtime(request: Request) -> AgentRuntime:
    return request.app.state.agent_runtime


def _redact(text: str) -> str:
    return redact(text)[0]


def _unwrap_envelope(payload: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Accept the FE's ``{key: {...}}`` envelope shape.

    The shipped React client (pulse ``src/utils/hooks/useAi.ts``)
    posts the entire ``RunPayload`` -- e.g. ``{draft: {prompt, context}}``
    for ``/task-draft`` -- because a single hook handles every v1 route and
    the discriminating key is the route name. The earlier handlers were
    written against a flat ``{prompt, context}`` body and silently treated
    the envelope as an empty payload, so every wrapped FE request fell back
    to a deterministic stub with no prompt or context.

    To bridge both wire shapes without forking the handlers, unwrap the
    named envelope when present and otherwise return ``payload`` unchanged.
    The flat form keeps working for the existing pytest suite and any
    direct cURL caller; the wrapped form starts working for the React app.
    """

    inner = payload.get(key)
    if isinstance(inner, dict):
        return inner
    return payload


def _maybe_unwrap_legacy_payload(
    payload: Dict[str, Any], meta: LegacyAiRouteMeta
) -> Dict[str, Any]:
    """Apply :func:`_unwrap_envelope` when ``meta`` declares an FE envelope key."""

    key = meta.envelope_key
    if key is None:
        return payload
    return _unwrap_envelope(payload, key)


def _gate(
    request: Request,
    user_id: str,
    project_id: Optional[str],
    *,
    rate_limiter: RateLimitBackend,
    budget_tracker: BudgetBackend,
    metadata: Optional[AgentMetadata] = None,
    agent_label: str = "v1-shim",
) -> None:
    """Run project access + rate-limit + budget gates for a v1 request.

    The rate-limit budget is read from ``metadata.rate_limit`` when
    available so a chat call shares the same allowance as the
    ``chat-agent`` v2 surface. Without metadata (the structured routes
    aren't backed by an agent today) the limiter falls back to the
    default ``(60, 600)``.

    Rate-limit / budget rejections are also surfaced to the
    Prometheus counter using ``agent_label`` as the agent dimension --
    operators can then SLO ``rate_limited`` / ``budget_exhausted`` per
    v1 route the same way they would for a v2 agent.
    """

    if not is_project_ai_enabled(project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "AI is disabled for this project"},
        )
    if project_id and not is_project_manager(project_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "Forbidden"},
        )
    limits = metadata.rate_limit if metadata is not None else DEFAULT_LIMIT
    allowed, retry_after = rate_limiter.check(agent_label, user_id, limits=limits)
    if not allowed:
        record_invocation(agent_label, "rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate limit exceeded"},
            headers={"Retry-After": str(retry_after)},
        )
    if project_id and not budget_tracker.can_spend(project_id, tokens=1):
        record_invocation(agent_label, "budget_exhausted")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"error": "project budget exhausted"},
            headers={"X-Reason": "budget"},
        )
    request.state.redaction_spans = []


def _gate_with_reservation(
    request: Request,
    user_id: str,
    project_id: Optional[str],
    *,
    rate_limiter: RateLimitBackend,
    budget_tracker: BudgetBackend,
    metadata: Optional[AgentMetadata] = None,
    agent_label: str = "v1-shim",
) -> int:
    """Like ``_gate`` but atomically reserves 1 token instead of read-only ``can_spend``.

    Used only by the chat handler, which calls the live LLM and reconciles
    actual usage afterwards; the other v1 routes use deterministic stubs so
    the TOCTOU window in ``_gate`` is not exploitable there.

    Returns the     reservation amount (1 when project_id is set, 0 otherwise)
    so the caller can pass it to ``budget_tracker.refund`` on failure
    or top-up via ``record`` on success.
    """

    if not is_project_ai_enabled(project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "AI is disabled for this project"},
        )
    if project_id and not is_project_manager(project_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "Forbidden"},
        )
    limits = metadata.rate_limit if metadata is not None else DEFAULT_LIMIT
    allowed, retry_after = rate_limiter.check(agent_label, user_id, limits=limits)
    if not allowed:
        record_invocation(agent_label, "rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate limit exceeded"},
            headers={"Retry-After": str(retry_after)},
        )
    if project_id:
        if not budget_tracker.reserve(project_id, tokens=1):
            record_invocation(agent_label, "budget_exhausted")
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "project budget exhausted"},
                headers={"X-Reason": "budget"},
            )
        request.state.redaction_spans = []
        return 1
    request.state.redaction_spans = []
    return 0


def _project_id_from_payload(payload: Dict[str, Any]) -> Optional[str]:
    """Pull a project_id from any of the FE wire envelopes.

    Most routes nest the project under ``context.project._id``. The
    search-tasks route uses ``projectContext`` (the FE's
    ``IAiSearchTaskPayload`` shape) so we check that too -- without it,
    every ``/api/ai/search`` call would skip budget enforcement and
    rate-limit project-scoping on the search-agent's polish path.
    """

    for key in ("context", "projectContext"):
        envelope = payload.get(key)
        if isinstance(envelope, dict):
            project = envelope.get("project")
            if isinstance(project, dict):
                pid = project.get("_id")
                if isinstance(pid, str) and pid:
                    return pid
    return None


def _token_usage_from_events(custom_events: List[Any]) -> Tuple[int, int]:
    """Sum ``(tokens_in, tokens_out)`` from ``{"kind": "usage"}`` custom events.

    Phase 2: catalog agents now include raw ``AIMessage`` objects (with
    ``usage_metadata``) in state messages so
    :func:`~app.agents.llm.result_token_usage_from_graph_result` can aggregate
    them directly.  This function is retained as a fallback for any custom
    agent that still emits ``{"kind": "usage"}`` side-channel events or for
    forward-compatibility with persisted event lists that contain usage entries.
    """

    tokens_in = 0
    tokens_out = 0
    for event in custom_events:
        if isinstance(event, dict) and event.get("kind") == "usage":
            tokens_in += int(event.get("tokensIn") or 0)
            tokens_out += int(event.get("tokensOut") or 0)
    return tokens_in, tokens_out


def _reconcile_token_budget(
    project_id: Optional[str],
    budget_tracker: BudgetBackend,
    final_state: Any,
    custom_events: List[Any],
) -> None:
    """True-up the project token budget after an agent run.

    Tries :func:`~app.agents.llm.result_token_usage_from_graph_result` first
    (populated by chat-agent and board-brief-agent which store AIMessages with
    usage_metadata); falls back to the ``{"kind": "usage"}`` custom events
    emitted by catalog agents that short-circuit onto pre-populated state
    (task-draft, estimate, readiness, search).

    The gate already debited 1 token at entry, so we top-up by
    ``max(0, total - 1)``.
    """

    if not project_id:
        return
    tokens_in, tokens_out = result_token_usage_from_graph_result(final_state)
    if tokens_in == 0 and tokens_out == 0:
        tokens_in, tokens_out = _token_usage_from_events(custom_events)
    actual = max(0, int(tokens_in)) + max(0, int(tokens_out))
    delta = max(0, actual - 1)
    if delta > 0:
        budget_tracker.record(project_id, tokens=delta)


def _redact_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if isinstance(content, str) and role == "user":
            out.append({**message, "content": _redact(content)})
        else:
            out.append(message)
    return out




def _idempotent_replay(
    idem: IdempotencyContext,
    *,
    route: str,
    agent_label: str,
) -> Optional[JSONResponse]:
    """Return the replay response when ``idem`` carries a cached hit.

    Centralises the ``Idempotent-Replay: true`` stamping so each handler
    only branches on the truthiness of the return value, and emits the
    Tier 9 cache-hit / replay metrics so the SLO dashboard can track
    cache effectiveness without per-handler boilerplate.
    """

    cached = idem.cached_response
    if cached is None:
        return None
    record_idempotency(route, "hit")
    record_invocation(agent_label, "replay")
    return JSONResponse(
        content=cached.body,
        status_code=cached.status_code,
        headers={**cached.headers, "Idempotent-Replay": "true"},
    )


_ESTIMATE_DRAFT_FIELDS = ("taskName", "note")
_READINESS_DRAFT_FIELDS = ("taskName", "note", "epic", "type", "coordinatorId")


def _draft_from_payload(
    payload: Dict[str, Any], fields: tuple[str, ...]
) -> Dict[str, str]:
    """Project ``payload`` down to ``fields`` for the LLM prompt.

    Forwarding the FE's full payload would JSON-encode ``context.tasks``
    / ``context.project`` into the prompt -- wasted tokens plus an
    unintended leak of unrelated cards into the model context.
    """

    return {field: payload.get(field) or "" for field in fields}


def _similar_from_context(context: Any, *, limit: int = 3) -> List[Dict[str, Any]]:
    """Extract up to ``limit`` neighbour-task references for polish_draft.

    The catalog ``polish_draft`` helper grounds its rewrite on a list of
    ``{id, text}`` dicts (the FE-resolved ``fe.similarTasks`` shape).
    Forwarding the FE's full ``context.tasks`` would inflate the prompt
    cost and leak unrelated cards into the LLM context; this helper
    keeps the top-N most relevant-by-position with only the fields the
    helper actually JSON-encodes.
    """

    if not isinstance(context, dict):
        return []
    tasks = context.get("tasks")
    if not isinstance(tasks, list):
        return []
    similar: List[Dict[str, Any]] = []
    for task in tasks[:limit]:
        if not isinstance(task, dict):
            continue
        text = ((task.get("taskName") or "") + " " + (task.get("note") or "")).strip()
        similar.append({"id": task.get("_id"), "text": text})
    return similar


_SEARCH_TASK_FIELDS = ("taskName", "note", "type", "epic")
# Keep aligned with :func:`app.services.v1_engine.semantic_search` project
# branch so polish reranking sees the same text the deterministic ranker used.
_SEARCH_PROJECT_FIELDS = (
    "projectName",
    "organization",
    "organisation",
    "managerId",
    "manager",
)


def _candidates_from_context(
    kind: str, context: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Project ``context`` items down to ``[{id, text}]`` for polish_search.

    The deterministic ranker in ``v1_engine.semantic_search`` already
    consumes the same fields from ``context.tasks`` / ``context.projects``;
    this helper produces the parallel ``{id, text}`` view the LLM
    re-ranker needs without re-tokenising. Capped at 30 entries (the
    polish helper truncates again at JSON-encode time, but capping here
    keeps the helper's input bounded so token-estimation in the budget
    tracker stays accurate).
    """

    items = context.get("tasks" if kind == "tasks" else "projects") or []
    if not isinstance(items, list):
        return []
    fields = _SEARCH_TASK_FIELDS if kind == "tasks" else _SEARCH_PROJECT_FIELDS
    out: List[Dict[str, Any]] = []
    for item in items[:30]:
        if not isinstance(item, dict):
            continue
        item_id = item.get("_id")
        if not isinstance(item_id, str):
            continue
        text = " ".join(str(item.get(field) or "") for field in fields).strip()
        out.append({"id": item_id, "text": text})
    return out


@router.post("/task-draft", status_code=status.HTTP_200_OK)
async def task_draft(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        payload = dict(payload)
        if isinstance(payload.get("prompt"), str):
            payload["prompt"] = _redact(payload["prompt"])
        context = payload.get("context") or {}
        inputs: Dict[str, Any] = {
            "prompt": payload.get("prompt") or "",
            "similar_tasks": _similar_from_context(context),
            # Pre-populate board_snapshot to short-circuit the fetch_snapshot
            # interrupt node (same pattern as board-brief route).
            "board_snapshot": context if isinstance(context, dict) else {},
            # Signal the agent to compute the v1-compatible baseline from
            # board_snapshot rather than waiting for a real LLM draft.
            "_use_v1_baseline": True,
        }
        # Forward optional fields so the agent can compute the v1-compatible
        # deterministic baseline without calling v1_engine.draft_task.
        if payload.get("columnId") is not None:
            inputs["column_id"] = payload["columnId"]
        if payload.get("coordinatorId") is not None:
            inputs["coordinator_id"] = payload["coordinatorId"]
        if project_id:
            inputs["project_id"] = project_id

        try:
            final_state, custom_events = await runtime.arun_with_events(
                meta.catalog_agent_name,
                inputs,
                user_id=user_id,
            )
            suggestion = next(
                (
                    e for e in custom_events
                    if isinstance(e, dict)
                    and e.get("kind") == "suggestion"
                    and e.get("surface") == "draft"
                ),
                None,
            )
            if suggestion is None:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit a draft."}},
                )
            body = suggestion["payload"]
            _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)
        except AgentError:
            # Agent not registered or agent execution failed; fall back to a
            # deterministic result so a misconfigured catalog doesn't 5xx the route.
            from app.agents.catalog.task_drafting import draft_task as _draft_task
            body = _draft_task(payload)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


@router.post("/task-breakdown", status_code=status.HTTP_200_OK)
async def task_breakdown(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        payload = dict(payload)
        if isinstance(payload.get("prompt"), str):
            payload["prompt"] = _redact(payload["prompt"])
        count = payload.get("count")
        context_bd = payload.get("context") or {}
        inputs: Dict[str, Any] = {
            "prompt": payload.get("prompt") or "",
            "similar_tasks": _similar_from_context(context_bd),
            "board_snapshot": context_bd if isinstance(context_bd, dict) else {},
            # Pass breakdown_count so generate_draft computes the v1-compatible
            # baseline internally without the route calling v1_engine.breakdown_task.
            "breakdown_count": int(count) if isinstance(count, int) else 3,
            # Signal the agent to compute the v1-compatible baseline.
            "_use_v1_baseline": True,
        }
        if payload.get("columnId") is not None:
            inputs["column_id"] = payload["columnId"]
        if payload.get("coordinatorId") is not None:
            inputs["coordinator_id"] = payload["coordinatorId"]
        if project_id:
            inputs["project_id"] = project_id

        final_state, custom_events = await runtime.arun_with_events(
            meta.catalog_agent_name,
            inputs,
            user_id=user_id,
        )

        suggestion = next(
            (
                e for e in custom_events
                if isinstance(e, dict)
                and e.get("kind") == "suggestion"
                and e.get("surface") == "breakdown"
            ),
            None,
        )
        if suggestion is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit a breakdown."}},
            )
        body = suggestion["payload"]
        _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


@router.post("/estimate", status_code=status.HTTP_200_OK)
async def estimate(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        task_draft = redact_task_fields(_draft_from_payload(payload, _ESTIMATE_DRAFT_FIELDS))
        context = payload.get("context") or {}
        context_tasks = context.get("tasks") if isinstance(context, dict) else None
        inputs: Dict[str, Any] = {
            "task_draft": task_draft,
            "similar_tasks": [],
            # Forward context_tasks so the estimate node can compute the
            # v1-compatible deterministic baseline without the route calling
            # v1_engine.estimate.
            "context_tasks": context_tasks if isinstance(context_tasks, list) else [],
        }
        if project_id:
            inputs["project_id"] = project_id

        final_state, custom_events = await runtime.arun_with_events(
            meta.catalog_agent_name,
            inputs,
            user_id=user_id,
        )

        suggestion = next(
            (
                e for e in custom_events
                if isinstance(e, dict)
                and e.get("kind") == "suggestion"
                and e.get("surface") == "estimate_v1"
            ),
            None,
        )
        if suggestion is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit an estimate."}},
            )
        body = suggestion["payload"]
        _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


@router.post("/readiness", status_code=status.HTTP_200_OK)
async def readiness(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        task_draft = redact_task_fields(_draft_from_payload(payload, _READINESS_DRAFT_FIELDS))
        context = payload.get("context") or {}
        context_tasks_rd = context.get("tasks") if isinstance(context, dict) else None
        inputs: Dict[str, Any] = {
            "task_draft": task_draft,
            "similar_tasks": [],
            # Forward context_tasks so the readiness node can compute the
            # v1-compatible deterministic baseline without the route calling
            # v1_engine.readiness.
            "context_tasks": context_tasks_rd if isinstance(context_tasks_rd, list) else [],
            # Pass a sentinel estimate so the estimate node short-circuits without an
            # LLM call.  Only the readiness polish tokens are attributable to this route.
            "estimate": {"_skip_polish": True},
        }
        if project_id:
            inputs["project_id"] = project_id

        final_state, custom_events = await runtime.arun_with_events(
            meta.catalog_agent_name,
            inputs,
            user_id=user_id,
        )

        suggestion = next(
            (
                e for e in custom_events
                if isinstance(e, dict)
                and e.get("kind") == "suggestion"
                and e.get("surface") == "readiness_v1"
            ),
            None,
        )
        if suggestion is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit a readiness report."}},
            )
        body: Any = suggestion["payload"]
        _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


@router.post("/board-brief", status_code=status.HTTP_200_OK)
async def board_brief(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        context = payload.get("context") or {}
        if not isinstance(context, dict):
            api_error(status.HTTP_400_BAD_REQUEST, "context must be an object")
        inputs: Dict[str, Any] = {"board_snapshot": context}
        if project_id:
            inputs["project_id"] = project_id

        final_state, custom_events = await runtime.arun_with_events(
            meta.catalog_agent_name,  # "board-brief-agent"
            inputs,
            user_id=user_id,
        )

        # The agent's emit_citations node writes the full IBoardBrief +
        # recommendationDetail payload onto a custom event with
        # kind="suggestion", surface="brief".  That's the legacy v1 wire shape.
        suggestion = next(
            (
                e for e in custom_events
                if isinstance(e, dict)
                and e.get("kind") == "suggestion"
                and e.get("surface") == "brief"
            ),
            None,
        )
        if suggestion is None:
            # Defensive: should never happen — the graph always reaches emit_citations.
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit a brief."}},
            )
        body = suggestion["payload"]
        # Reconcile budget against actual provider usage.
        _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


@router.post("/search", status_code=status.HTTP_200_OK)
async def search(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        kind = payload.get("kind")
        if kind not in {"tasks", "projects"}:
            api_error(status.HTTP_400_BAD_REQUEST, "kind must be 'tasks' or 'projects'")
        query = payload.get("query")
        if not isinstance(query, str):
            api_error(status.HTTP_400_BAD_REQUEST, "query must be a string")
        redacted_query = _redact(query)
        if kind == "tasks":
            context = payload.get("projectContext") or {}
        else:
            context = payload.get("projectsContext") or {}
        if not isinstance(context, dict):
            api_error(status.HTTP_400_BAD_REQUEST, "context must be an object")
        deterministic = _semantic_search(kind, redacted_query, context)
        candidates = _candidates_from_context(kind, context)
        inputs: Dict[str, Any] = {
            "query": redacted_query,
            "kind": kind,
            "candidates": candidates,
            "ranking": deterministic,
        }
        if project_id:
            inputs["project_id"] = project_id

        final_state, custom_events = await runtime.arun_with_events(
            meta.catalog_agent_name,
            inputs,
            user_id=user_id,
        )

        suggestion = next(
            (
                e for e in custom_events
                if isinstance(e, dict)
                and e.get("kind") == "suggestion"
                and e.get("surface") == "search"
            ),
            None,
        )
        if suggestion is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": {"code": "agent_unavailable", "message": "Agent did not emit a search result."}},
            )
        body: Any = suggestion["payload"]
        _reconcile_token_budget(project_id, budget_tracker, final_state, custom_events)

        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)


def _normalize_tool_calls(value: Any) -> List[Dict[str, Any]]:
    """Coerce the FE ``toolCalls`` array into LangChain ``tool_calls`` dicts.

    The FE wire shape is ``[{id, name, arguments}]``; LangChain (and
    Anthropic / OpenAI through it) expects ``[{id, name, args, type}]``.
    Entries missing ``id`` / ``name`` are dropped so a malformed FE
    transcript can't 4xx the provider on the user's next turn -- the
    orphan-drop guard in :func:`_build_chat_messages` then ensures the
    paired tool result is dropped too.
    """

    if not isinstance(value, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        call_id = item.get("id")
        name = item.get("name")
        if not isinstance(call_id, str) or not isinstance(name, str):
            continue
        args = item.get("arguments")
        out.append(
            {
                "id": call_id,
                "name": name,
                "args": args if isinstance(args, dict) else {},
                "type": "tool_call",
            }
        )
    return out


def _build_chat_messages(redacted_messages: List[Dict[str, Any]]) -> List[Any]:
    """Convert FE messages into LangChain message objects.

    Wire shape per turn:

    - ``{role: "user", content}`` -> :class:`HumanMessage`.
    - ``{role: "assistant", content, toolCalls?}`` -> :class:`AIMessage`.
      Hydrating ``tool_calls`` is necessary for multi-round chat:
      Anthropic 400s if a ``tool_result`` block references an id that
      isn't present on the immediately preceding ``tool_use`` block, and
      OpenAI silently drops context without it. A turn with neither
      content nor toolCalls is skipped entirely (FE bug recovery).
    - ``{role: "tool", content, toolCallId}`` -> :class:`ToolMessage`.
      Dropped when ``toolCallId`` does not appear on a prior assistant's
      ``tool_calls`` -- a stale FE thread (older app version, manual
      replay) must not poison the next provider call.
    """

    chat_messages: List[Any] = []
    known_tool_call_ids: set[str] = set()
    for message in redacted_messages:
        role = message.get("role")
        content = message.get("content")
        if role == "user":
            if isinstance(content, str):
                chat_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            tool_calls = _normalize_tool_calls(message.get("toolCalls"))
            text = content if isinstance(content, str) else ""
            if not text and not tool_calls:
                continue
            chat_messages.append(AIMessage(content=text, tool_calls=tool_calls))
            for call in tool_calls:
                known_tool_call_ids.add(call["id"])
        elif role == "tool":
            tool_call_id = message.get("toolCallId")
            if (
                isinstance(content, str)
                and isinstance(tool_call_id, str)
                and tool_call_id in known_tool_call_ids
            ):
                chat_messages.append(
                    ToolMessage(content=content, tool_call_id=tool_call_id)
                )
    return chat_messages


def _extract_chat_response(
    result: Any,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Read ``(text, toolCalls)`` from the chat-agent's final state.

    The FE wire shape is mutually exclusive (``kind: "text"`` xor
    ``"tool_calls"``); when the model returns both we prefer
    ``tool_calls`` because the model has decided to look something up
    and the partial reasoning text isn't actionable on its own. The FE
    surfaces the answer once a subsequent turn returns plain text.
    """

    if not isinstance(result, dict):
        return "", []
    messages = result.get("messages") or []
    if not isinstance(messages, list) or not messages:
        return "", []
    tail = messages[-1]
    if not isinstance(tail, AIMessage):
        return "", []
    raw_calls = getattr(tail, "tool_calls", None) or []
    tool_calls: List[Dict[str, Any]] = []
    for call in raw_calls:
        if not isinstance(call, dict):
            continue
        call_id = call.get("id")
        name = call.get("name")
        if not isinstance(call_id, str) or not isinstance(name, str):
            continue
        args = call.get("args")
        tool_calls.append(
            {
                "id": call_id,
                "name": name,
                "arguments": args if isinstance(args, dict) else {},
            }
        )
    text = tail.content if isinstance(tail.content, str) else ""
    return text, tool_calls


@router.post("/chat", status_code=status.HTTP_200_OK)
async def chat(
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
    runtime: AgentRuntime = Depends(_get_runtime),
    rate_limiter: RateLimitBackend = Depends(get_rate_limiter),
    budget_tracker: BudgetBackend = Depends(get_budget_tracker),
) -> Dict[str, Any]:
    """Forward chat to the ``chat-agent`` runtime so the LLM is shared.

    Wire shape:

    - Inbound messages may carry ``role`` ``user``, ``assistant`` (with
      optional ``toolCalls: [{id, name, arguments}]``), or ``tool`` (with
      ``toolCallId``). The full multi-round history is forwarded so the
      LLM sees its own prior tool selections; orphan tool results (no
      preceding assistant tool_call with the same id) are dropped to
      keep the provider call valid.
    - Outbound payload is ``{kind: "text", text}`` for a final answer or
      ``{kind: "tool_calls", toolCalls: [{id, name, arguments}]}`` when
      the model picked a tool. The FE dispatches each tool, posts the
      results back, and the loop continues until the model returns text
      (FE caps the loop at 5 rounds).
    """

    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    meta = _legacy_ai_route_meta(route_path)
    agent_label = meta.agent_label
    payload = _maybe_unwrap_legacy_payload(payload, meta)
    idem = await check_idempotency_with_metrics(
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
        chat_metadata = runtime.get(meta.catalog_agent_name).metadata
        project_id = _project_id_from_payload(payload)
        # Use reserve-based gate (not read-only can_spend) to prevent TOCTOU
        # budget overrun under concurrent requests; other v1 routes use stubs
        # so _gate's can_spend is acceptable there.
        reserved_budget = _gate_with_reservation(
            request,
            user_id,
            project_id,
            rate_limiter=rate_limiter,
            budget_tracker=budget_tracker,
            metadata=chat_metadata,
            agent_label=agent_label,
        )
        enforce_request_limits(payload, request=request)

        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list):
            api_error(status.HTTP_400_BAD_REQUEST, "messages must be a list")
        redacted_messages = _redact_messages(raw_messages)
        request.state.redaction_spans = []

        chat_messages = _build_chat_messages(redacted_messages)
        inputs: Dict[str, Any] = {"messages": chat_messages}
        if project_id:
            inputs["project_id"] = project_id

        timeout = settings.agent_request_timeout_seconds
        try:
            result, _chat_events = await asyncio.wait_for(
                runtime.arun_with_events(
                    meta.catalog_agent_name,
                    inputs,
                    user_id=user_id,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError as exc:
            logger.warning("chat-agent v1 shim exceeded %ss timeout", timeout)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error": {
                        "code": "timeout",
                        "message": f"Agent run exceeded {timeout}s timeout",
                    }
                },
            ) from exc
        except AgentError as exc:
            logger.warning("chat-agent failed via v1 shim", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "error": {
                        "code": "agent_unavailable",
                        "message": "Agent failed to respond.",
                    }
                },
            ) from exc

        text, tool_calls = _extract_chat_response(result)
        # Reconcile reservation against actual provider usage. The 1-token
        # reservation from _gate_with_reservation is topped up or refunded here.
        if project_id:
            tokens_in, tokens_out = result_token_usage_from_graph_result(result)
            actual = max(0, int(tokens_in)) + max(0, int(tokens_out))
            delta = max(0, max(1, actual) - reserved_budget)
            if delta > 0:
                budget_tracker.record(project_id, tokens=delta)
        budget_reconciled = True
        if tool_calls:
            body: Dict[str, Any] = {"kind": "tool_calls", "toolCalls": tool_calls}
        else:
            body = {"kind": "text", "text": text or "Board Copilot is unavailable."}
        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        if not budget_reconciled and reserved_budget and project_id:
            budget_tracker.refund(project_id, tokens=reserved_budget)
        _idem_fail(idem, exc)
