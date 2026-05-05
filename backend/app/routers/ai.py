"""Legacy ``/api/ai/<route>`` shim for the v1 FE surfaces.

The shipped Board Copilot UI in jira-react-app (Phases 0--4 from
``docs/prd/board-copilot-progress.md``) posts JSON to
``/api/ai/{task-draft,task-breakdown,estimate,readiness,board-brief,search,chat}``
and expects synchronous JSON back. The v2.1 streaming agent surface at
``/api/v1/agents/...`` is the recommended path for new clients, but
shipped users still hit ``/api/ai/*``. This router keeps them working
by:

1. Authenticating with the same JWT used elsewhere.
2. Running the redaction / project-access / rate-limit / budget gates
   that the v2.1 router enforces.
3. Delegating to deterministic implementations in
   :mod:`app.services.v1_engine` for the structured routes, then
   handing the result through the catalog agents' ``polish_*``
   helpers so a configured ``ANTHROPIC_API_KEY`` /
   ``OPENAI_API_KEY`` actually flips the FE-visible output. The
   helpers internally short-circuit on the deterministic stub or on
   any provider exception, so the wire shape stays byte-identical
   when no key is set.
4. Forwarding ``chat`` to the ``chat-agent`` runtime so the LLM is
   shared. The chat agent binds the FE-executed tool catalogue (see
   :mod:`app.agents.catalog._chat_tools`) when a real model is
   configured, so the shim emits ``{kind: "tool_calls", toolCalls}``
   whenever the model picks a tool and the FE drives the multi-round
   loop until the model returns text.

Polish helpers are LangChain-style ``with_structured_output(...).invoke(...)``
calls -- synchronous network I/O against Anthropic / OpenAI. The route
handlers are ``async def``, so we hop the polish call onto a worker
thread via :func:`asyncio.to_thread` to keep the event loop free for
concurrent requests while a real provider is configured. With the
deterministic stub the helpers short-circuit before any I/O, so the
thread hop is effectively free; with a real key set, throughput on a
single uvicorn worker no longer collapses to one request at a time.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.agents import AgentRuntime
from app.agents.base import AgentMetadata
from app.agents.limits import enforce_request_limits
from app.agents.catalog.board_brief import build_recommendation_detail, polish_headline
from app.agents.catalog.search import polish_search
from app.agents.catalog.task_drafting import polish_draft
from app.agents.catalog.task_estimation import polish_rationale, polish_readiness
from app.agents.errors import AgentError
from app.agents.llm import is_stub_model, make_stub_chat_model
from app.auth.project_access import is_project_ai_enabled
from app.middleware import budget as _budget
from app.middleware import rate_limit as _rate_limit
from app.middleware.rate_limit import DEFAULT_LIMIT
from app.middleware.idempotency_guard import IdempotencyContext
from app.middleware.idempotency_metrics import check_idempotency_with_metrics
from app.observability.metrics import record_idempotency, record_invocation
from app.security import current_user_id, current_user_payload
from app.services.project_service import is_project_manager
from app.services import v1_engine
from app.tools import be_tools
from app.tools.be_tools import validated_citation_ref
from app.tools.redaction import redact, redact_task_fields
from app.validation import api_error


logger = logging.getLogger(__name__)

router = APIRouter()


def _idem_fail(idem: IdempotencyContext, exc: BaseException) -> None:
    """Release an idempotency reservation unless the process is exiting."""

    if isinstance(exc, (KeyboardInterrupt, SystemExit)):
        raise exc
    idem.release()
    raise exc


def _get_runtime(request: Request) -> AgentRuntime:
    return request.app.state.agent_runtime


def _redact(text: str) -> str:
    return redact(text)[0]


def _unwrap_envelope(payload: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Accept the FE's ``{key: {...}}`` envelope shape.

    The shipped React client (jira-react-app ``src/utils/hooks/useAi.ts``)
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


def _gate(
    request: Request,
    user_id: str,
    project_id: Optional[str],
    *,
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
    allowed, retry_after = _rate_limit.rate_limiter.check(
        agent_label, user_id, limits=limits
    )
    if not allowed:
        record_invocation(agent_label, "rate_limited")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate limit exceeded"},
            headers={"Retry-After": str(retry_after)},
        )
    if project_id and not _budget.budget_tracker.can_spend(project_id, tokens=1):
        record_invocation(agent_label, "budget_exhausted")
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"error": "project budget exhausted"},
            headers={"X-Reason": "budget"},
        )
    request.state.redaction_spans = []


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


def _resolve_polish_model(runtime: AgentRuntime, agent_name: str) -> BaseChatModel:
    """Return ``agent_name``'s configured chat model, or a stub on lookup miss.

    The shim's _gate already enforces project access / rate limit /
    budget regardless of which provider is wired up, so a missing
    catalog agent should not 5xx the route -- it should just fall back
    to the deterministic Python path. ``polish_*`` helpers detect the
    stub via :func:`is_stub_model` and skip the LLM call entirely.
    """

    try:
        return runtime.get(agent_name).chat_model
    except AgentError:
        return make_stub_chat_model()


async def _polish_and_record(
    project_id: Optional[str],
    polish: Callable[..., Any],
    *args: Any,
    **kwargs: Any,
) -> Any:
    """Invoke ``polish`` off the event loop and true-up the project budget.

    The polish helpers are synchronous (LangChain ``with_structured_output``
    + ``.invoke``) and make a blocking HTTPS call to the LLM provider when
    a real key is configured. Calling them directly from an ``async def``
    handler would freeze the uvicorn worker's event loop for the full
    provider latency; :func:`asyncio.to_thread` hops the call onto the
    default executor so concurrent requests progress.

    The :func:`_gate` step already debited 1 token at entry to the route
    (so a runaway provider can't burst past the cap before we see usage).
    Real usage is reported by the polish helper as
    ``(value, tokens_in, tokens_out)``; we top-up by the delta
    ``max(0, total - 1)`` so the budget tracker reflects what the
    provider charged. A stubbed call reports ``(0, 0)`` and produces no
    top-up.
    """

    polished, tokens_in, tokens_out = await asyncio.to_thread(polish, *args, **kwargs)
    if project_id:
        actual = max(0, int(tokens_in)) + max(0, int(tokens_out))
        delta = max(0, actual - 1)
        if delta > 0:
            _budget.budget_tracker.record(project_id, tokens=delta)
    return polished


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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-task-draft"
    payload = _unwrap_envelope(payload, "draft")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
        payload = dict(payload)
        if isinstance(payload.get("prompt"), str):
            payload["prompt"] = _redact(payload["prompt"])
        deterministic = v1_engine.draft_task(payload)
        model = _resolve_polish_model(runtime, "task-drafting-agent")
        if is_stub_model(model):
            body = deterministic
        else:
            body = await _polish_and_record(
                project_id,
                polish_draft,
                model,
                deterministic,
                payload.get("prompt") or "",
                _similar_from_context(payload.get("context")),
            )
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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-task-breakdown"
    payload = _unwrap_envelope(payload, "draft")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
        payload = dict(payload)
        if isinstance(payload.get("prompt"), str):
            payload["prompt"] = _redact(payload["prompt"])
        count = payload.get("count")
        deterministic = v1_engine.breakdown_task(
            payload, count=int(count) if isinstance(count, int) else 3
        )
        model = _resolve_polish_model(runtime, "task-drafting-agent")
        if is_stub_model(model):
            body = deterministic
        else:
            items = list(deterministic.get("items") or [])
            # Polish the shared base draft once (without the per-item ``(part i)``
            # suffix), then re-apply each item's deterministic suffix on top of
            # the polished prefix. Mirrors what ``task_drafting.py`` does at
            # lines 166-171 and keeps cost flat with the task-draft route.
            base_draft = v1_engine.draft_task(payload)
            polished_base = await _polish_and_record(
                project_id,
                polish_draft,
                model,
                dict(base_draft),
                payload.get("prompt") or "",
                _similar_from_context(payload.get("context")),
            )
            polished_taskName = polished_base.get("taskName") or ""
            polished_note = polished_base.get("note") or ""
            polished_rationale = polished_base.get("rationale")
            base_taskName = base_draft.get("taskName") or ""
            polished_items: List[Dict[str, Any]] = []
            for item in items:
                merged = dict(item)
                # ``v1_engine.breakdown_task`` always builds each item's
                # taskName as ``f"{base_taskName} (part {i})"`` -- strip the
                # shared base to recover the suffix and apply it on top of the
                # polished prefix. Trusting the upstream invariant keeps this
                # code path simple and 100% coverable.
                item_taskName = item.get("taskName") or ""
                suffix = item_taskName[len(base_taskName) :]
                merged["taskName"] = polished_taskName + suffix
                merged["note"] = polished_note
                # Each piece keeps its v1_engine ``Slice i of...`` deterministic
                # rationale unless polish produced a non-blank shared rationale.
                if isinstance(polished_rationale, str) and polished_rationale.strip():
                    merged["rationale"] = polished_rationale
                polished_items.append(merged)
            body = {**deterministic, "items": polished_items}
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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-estimate"
    payload = _unwrap_envelope(payload, "estimate")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
        deterministic = v1_engine.estimate(payload)
        model = _resolve_polish_model(runtime, "task-estimation-agent")
        if is_stub_model(model):
            body = deterministic
        else:
            rationale = await _polish_and_record(
                project_id,
                polish_rationale,
                model,
                deterministic.get("rationale") or "",
                redact_task_fields(_draft_from_payload(payload, _ESTIMATE_DRAFT_FIELDS)),
                int(deterministic.get("storyPoints") or 0),
                deterministic.get("similar") or [],
            )
            body = {**deterministic, "rationale": rationale}
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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-readiness"
    payload = _unwrap_envelope(payload, "readiness")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
        deterministic = v1_engine.readiness(payload)
        if not deterministic.get("issues"):
            body: Any = deterministic
        else:
            model = _resolve_polish_model(runtime, "task-estimation-agent")
            if is_stub_model(model):
                body = deterministic
            else:
                body = await _polish_and_record(
                    project_id,
                    polish_readiness,
                    model,
                    deterministic,
                    redact_task_fields(_draft_from_payload(payload, _READINESS_DRAFT_FIELDS)),
                )
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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-board-brief"
    payload = _unwrap_envelope(payload, "brief")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
        context = payload.get("context") or {}
        if not isinstance(context, dict):
            api_error(status.HTTP_400_BAD_REQUEST, "context must be an object")
        deterministic = v1_engine.board_brief(context)
        drift = be_tools.detect_drift(context)
        # Build citation refs for the recommendationDetail sources; mirrors
        # what the v2.1 graph does in its emit_citations node.
        v1_tasks = context.get("tasks") or []
        v1_columns = context.get("columns") or []
        v1_refs: List[Dict[str, Any]] = []
        for task in v1_tasks[:3]:
            if isinstance(task, dict):
                v1_refs.append(
                    validated_citation_ref(
                        source="task",
                        id=task.get("_id") or task.get("id"),
                        quote=task.get("taskName") or task.get("_id") or "",
                    )
                )
        for col in v1_columns[:2]:
            if isinstance(col, dict):
                v1_refs.append(
                    validated_citation_ref(
                        source="column",
                        id=col.get("_id") or col.get("id"),
                        quote=col.get("name") or col.get("_id") or "",
                    )
                )
        model = _resolve_polish_model(runtime, "board-brief-agent")
        if is_stub_model(model):
            base_brief: Any = deterministic
        else:
            # When polish is in effect we let the schema's 120-char cap stand;
            # the deterministic ``v1_engine.board_brief`` truncates at 140, but
            # ``BriefHeadline.headline`` (Pydantic) enforces ``max_length=120``
            # so the polished output is already within bounds.
            facts = {
                "tasks": len(context.get("tasks") or []),
                "columns": len(context.get("columns") or []),
                "members": len(context.get("members") or []),
            }
            headline = await _polish_and_record(
                project_id,
                polish_headline,
                model,
                deterministic.get("headline") or "",
                facts,
            )
            base_brief = {**deterministic, "headline": headline}
        recommendation_detail = build_recommendation_detail(base_brief, drift, v1_refs)
        body = {**base_brief, "recommendationDetail": recommendation_detail}
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
) -> Any:
    user_id = current_user_id(auth_payload)
    route_path = request.url.path
    agent_label = "v1-search"
    payload = _unwrap_envelope(payload, "search")
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        project_id = _project_id_from_payload(payload)
        _gate(request, user_id, project_id, agent_label=agent_label)
        enforce_request_limits(payload)
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
        deterministic = v1_engine.semantic_search(kind, redacted_query, context)
        model = _resolve_polish_model(runtime, "search-agent")
        if is_stub_model(model):
            body: Any = deterministic
        else:
            body = await _polish_and_record(
                project_id,
                polish_search,
                model,
                deterministic,
                redacted_query,
                _candidates_from_context(kind, context),
            )
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
    agent_label = "chat-agent"
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    replay = _idempotent_replay(idem, route=route_path, agent_label=agent_label)
    if replay is not None:
        return replay
    try:
        chat_metadata = runtime.get("chat-agent").metadata
        project_id = _project_id_from_payload(payload)
        _gate(
            request,
            user_id,
            project_id,
            metadata=chat_metadata,
            agent_label=agent_label,
        )
        enforce_request_limits(payload)

        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list):
            api_error(status.HTTP_400_BAD_REQUEST, "messages must be a list")
        redacted_messages = _redact_messages(raw_messages)
        request.state.redaction_spans = []

        chat_messages = _build_chat_messages(redacted_messages)
        inputs: Dict[str, Any] = {"messages": chat_messages}
        if project_id:
            inputs["project_id"] = project_id

        try:
            result = await runtime.ainvoke(
                "chat-agent",
                inputs,
                user_id=user_id,
            )
        except AgentError as exc:
            logger.warning("chat-agent failed via v1 shim", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": "agent_unavailable"},
            ) from exc

        text, tool_calls = _extract_chat_response(result)
        if project_id:
            _budget.budget_tracker.record(project_id, tokens=1)
        if tool_calls:
            body: Dict[str, Any] = {"kind": "tool_calls", "toolCalls": tool_calls}
        else:
            body = {"kind": "text", "text": text or "Board Copilot is unavailable."}
        idem.store(status_code=status.HTTP_200_OK, body=body)
        record_idempotency(route_path, "miss")
        return body
    except BaseException as exc:
        _idem_fail(idem, exc)
