"""HTTP surface for the agents module.

The router is registry-driven: there is no per-agent code here. As long as
a concrete agent is registered with :data:`app.agents.registry.registry`
before the FastAPI app boots (typically via auto-discovery in
``app.agents.catalog``), it is automatically listed, invokable and
streamable through these endpoints.

Endpoints:
    - ``GET  /api/v1/agents``                 -- list all registered agents.
    - ``GET  /api/v1/agents/_tools``          -- FE-tool catalogue (PRD §5.4.1).
    - ``GET  /api/v1/agents/{name}``          -- single agent metadata.
    - ``POST /api/v1/agents/{name}/invoke``   -- run to completion (JSON).
    - ``POST /api/v1/agents/{name}/stream``   -- SSE stream of FE-shaped
      ``StreamPart`` events (``updates`` / ``messages`` / ``custom`` /
      ``interrupt`` / ``error``).

Every turn passes through three policy gates -- per-agent rate limiting
(PRD §5A.7 #3), per-project monthly token budget (PRD §5A.7 #4), and the
per-project AI disable flag (PRD §6.3) -- and inbound user text is
redacted server-side (PRD §5A.10) before reaching any agent. The autonomy
field on the request body is also validated against
:attr:`AgentMetadata.allowed_autonomy`.

The SSE wire format matches the FE's ``StreamPart`` discriminator
(``src/interfaces/agent.d.ts`` in pulse); the LangGraph
``(mode, chunk)`` tuples are translated into the FE shape via
:mod:`app.agents.sse`.
"""

import asyncio
from dataclasses import is_dataclass
import logging
from typing import Any, AsyncIterator, Dict, Mapping, Optional, get_type_hints

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from app.agents import AgentConfigurationError, AgentRuntime
from app.agents.base import AgentMetadata
from app.agents.errors import AgentError
from app.agents.limits import enforce_request_limits
from app.agents.llm import estimate_text_tokens, result_token_usage_from_graph_result
from app.agents.sse import (
    DONE_FRAME,
    encode_sse,
    error_envelope,
    translate_event,
    usage_envelope,
)
from app.auth.project_access import is_project_ai_enabled
from app.config import settings
from app.middleware import budget as _budget
from app.middleware import rate_limit as _rate_limit
from app.middleware.idempotency_metrics import check_idempotency_with_metrics
from app.observability.metrics import record_idempotency, record_invocation
from app.security import current_user_id, current_user_payload
from app.services.project_service import is_project_manager
from app.tools.fe_tool_schemas import fe_tool_definitions
from app.tools.redaction import redact, redact_dict
from app.validation import api_error

logger = logging.getLogger(__name__)

router = APIRouter()


def get_runtime(request: Request) -> AgentRuntime:
    """Resolve the per-process :class:`AgentRuntime` from app state."""

    return request.app.state.agent_runtime


_CONFIGURABLE_HOIST_KEYS = ("thread_id", "assistant_id", "tags", "autonomy")
_AUTONOMY_LEVELS = ("suggest", "plan", "auto")


def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the LangGraph SDK envelope into the flat router shape.

    * ``input`` (singular) is aliased to ``inputs`` when the latter is
      missing -- matches the SDK's ``stream({input, ...})`` convention.
    * ``config.configurable.thread_id`` / ``assistant_id`` / ``tags`` /
      ``autonomy`` are hoisted to top-level keys (only when not already
      supplied), so ``_run_options`` can keep reading them off the root
      payload.
    * ``config.configurable.project_id`` is forwarded into non-resume
      ``inputs``, because budget and project-access checks read it from
      there. Resume requests keep ``inputs`` empty so they remain valid
      LangGraph ``Command(resume=...)`` calls.
    * ``config.configurable.user_id`` is treated exactly like a
      top-level ``user_id``: rejected, since user identity comes from
      authentication.

    Returns a fresh dict so callers do not have to reason about whether
    the request body was mutated in place.
    """

    if not isinstance(payload, dict):
        return payload

    normalized: Dict[str, Any] = dict(payload)

    config = normalized.get("config")
    if not isinstance(config, dict):
        return normalized

    configurable = config.get("configurable")
    if not isinstance(configurable, dict):
        return normalized

    if "user_id" in configurable:
        api_error(status.HTTP_400_BAD_REQUEST, "user_id is derived from authentication")

    if "inputs" not in normalized and "input" in normalized:
        normalized["inputs"] = normalized["input"]

    for key in _CONFIGURABLE_HOIST_KEYS:
        if key in configurable and key not in normalized:
            normalized[key] = configurable[key]

    command = normalized.get("command")
    is_resume = isinstance(command, dict) and "resume" in command

    project_id = configurable.get("project_id")
    if project_id is not None and not is_resume:
        inputs = normalized.get("inputs")
        if inputs is None:
            normalized["inputs"] = {"project_id": project_id}
        elif isinstance(inputs, dict) and "project_id" not in inputs:
            normalized["inputs"] = {**inputs, "project_id": project_id}

    return normalized


def _optional_str(payload: Mapping[str, Any], field: str) -> Optional[str]:
    value = payload.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        api_error(status.HTTP_400_BAD_REQUEST, f"{field} must be a string")
    stripped = value.strip()
    return stripped or None


def _optional_tags(payload: Mapping[str, Any]) -> Optional[list[str]]:
    value = payload.get("tags")
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
        api_error(status.HTTP_400_BAD_REQUEST, "tags must be a list of strings")
    if len(value) > 20:
        api_error(status.HTTP_400_BAD_REQUEST, "tags must not exceed 20 entries")
    if not all(len(t) <= 128 for t in value if isinstance(t, str)):
        api_error(status.HTTP_400_BAD_REQUEST, "each tag must not exceed 128 characters")
    return value


def _resolve_autonomy(
    payload: Mapping[str, Any], metadata: AgentMetadata
) -> Optional[str]:
    """Validate ``autonomy`` against the agent's :attr:`allowed_autonomy`.

    A missing autonomy means "use the agent default"; the global
    ``AGENT_DEFAULT_AUTONOMY`` only applies via the FE. We forward
    whatever the caller picked into the agent context (LangGraph state),
    so the agent can branch on it if it wants.
    """

    raw = payload.get("autonomy")
    if raw is None:
        return None
    if not isinstance(raw, str):
        api_error(status.HTTP_400_BAD_REQUEST, "autonomy must be a string")
    cleaned = raw.strip().lower()
    if cleaned not in _AUTONOMY_LEVELS:
        api_error(
            status.HTTP_400_BAD_REQUEST,
            "autonomy must be one of " + ", ".join(_AUTONOMY_LEVELS),
        )
    if cleaned not in metadata.allowed_autonomy:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"autonomy '{cleaned}' is not allowed for agent '{metadata.name}' "
                f"(allowed: {', '.join(metadata.allowed_autonomy)})"
            ),
        )
    return cleaned


def _run_options(payload: Dict[str, Any], *, user_id: str) -> Dict[str, Any]:
    """Pull common run-control fields from the request body."""

    if "user_id" in payload:
        api_error(status.HTTP_400_BAD_REQUEST, "user_id is derived from authentication")

    return {
        "thread_id": _optional_str(payload, "thread_id"),
        "user_id": user_id,
        "assistant_id": _optional_str(payload, "assistant_id"),
        "tags": _optional_tags(payload),
    }


def _request_inputs(payload: Mapping[str, Any]) -> dict[str, Any]:
    inputs = payload.get("inputs", {})
    if inputs is None:
        return {}
    if not isinstance(inputs, dict):
        api_error(status.HTTP_400_BAD_REQUEST, "inputs must be an object")
    return inputs


_RESUME_SENTINEL = object()


def _request_command(payload: Mapping[str, Any]) -> Any:
    """Read ``payload["command"]["resume"]`` per PRD §5A.5.

    Returns the sentinel ``_RESUME_SENTINEL`` when the caller did not send
    a ``command`` block (so ``None`` remains a valid resume value).
    """

    command = payload.get("command")
    if command is None:
        return _RESUME_SENTINEL
    if not isinstance(command, dict):
        api_error(status.HTTP_400_BAD_REQUEST, "command must be an object")
    if "resume" not in command:
        api_error(
            status.HTTP_400_BAD_REQUEST,
            "command must include a 'resume' field",
        )
    return command["resume"]


def _coerce_context(schema: type[Any], payload: Any) -> Any:
    if payload is None:
        return None
    if not isinstance(payload, dict):
        api_error(status.HTTP_400_BAD_REQUEST, "context must be an object")

    if isinstance(schema, type) and issubclass(schema, BaseModel):
        try:
            return schema.model_validate(payload)
        except ValueError as exc:
            api_error(status.HTTP_400_BAD_REQUEST, str(exc))

    if is_dataclass(schema):
        try:
            return schema(**payload)
        except TypeError as exc:
            api_error(status.HTTP_400_BAD_REQUEST, str(exc))

    if hasattr(schema, "__annotations__"):
        hints = get_type_hints(schema)
        return {key: payload[key] for key in hints if key in payload}

    raise AgentConfigurationError(
        f"Unsupported context schema for agent requests: {schema!r}",
    )


def _request_context(
    name: str, payload: Mapping[str, Any], runtime: AgentRuntime
) -> Any:
    if "context" not in payload:
        return None

    schema = runtime.get(name).metadata.context_schema
    if schema is None:
        api_error(
            status.HTTP_400_BAD_REQUEST, f"Agent '{name}' does not accept context"
        )
    return _coerce_context(schema, payload.get("context"))


def _enforce_rate_limit(name: str, user_id: str, metadata: AgentMetadata) -> None:
    """Raise 429 with ``Retry-After`` when the per-agent quota is exhausted.

    Limits come from :attr:`AgentMetadata.rate_limit` -- one source of
    truth. The middleware no longer keeps a duplicate constant table.
    """

    allowed, retry_after = _rate_limit.rate_limiter.check(
        name, user_id, limits=metadata.rate_limit
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate limit exceeded"},
            headers={"Retry-After": str(retry_after)},
        )


def _enforce_budget(project_id: Optional[str], tokens: int = 1) -> int:
    """Reserve ``tokens`` against the project budget; raise 402 if full.

    Returns the amount actually reserved (``0`` when no project is in
    scope). The caller must pass the returned value to
    :func:`_record_real_usage` so the post-call true-up can refund any
    over-reservation back into the cap.
    """

    if not project_id:
        return 0
    requested = max(1, tokens)
    if not _budget.budget_tracker.reserve(project_id, requested):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"error": "project budget exhausted"},
            headers={"X-Reason": "budget"},
        )
    return requested


def _enforce_project_access(project_id: Optional[str]) -> None:
    """Raise 403 when the project is on the org AI-disable list (PRD §6.3)."""

    if not is_project_ai_enabled(project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "AI is disabled for this project"},
        )


def _require_project_manager(project_id: Optional[str], user_id: str) -> None:
    """Ensure budgeted agent calls cannot target another tenant's project."""

    if not project_id:
        return
    if not is_project_manager(project_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "forbidden", "message": "Forbidden"},
        )


def _enforce_status(metadata: AgentMetadata, response_headers: dict[str, str]) -> None:
    """Stamp ``Sunset`` / ``Deprecation`` headers on ``deprecated`` agents.

    Shadow-status enforcement lives in :class:`AgentRegistry` so internal
    callers and HTTP callers see the same hidden surface.  This helper
    only needs to handle the deprecation header today.
    """

    if metadata.status == "deprecated":
        response_headers["Deprecation"] = "true"


def _redact_inputs(inputs: dict[str, Any], request: Request) -> dict[str, Any]:
    """Apply redaction to user-supplied text in ``inputs`` (PRD §5A.10).

    Spans are stashed on ``request.state.redaction_spans`` so a future
    ``GET /api/v1/agents/{name}/spans`` (the "What is shared?" panel) can
    surface what was hidden without round-tripping the original text.
    """

    spans: list[Any] = []
    redacted = dict(inputs)

    prompt = redacted.get("prompt")
    if isinstance(prompt, str):
        replaced, prompt_spans = redact(prompt)
        redacted["prompt"] = replaced
        spans.extend(prompt_spans)

    messages = redacted.get("messages")
    if isinstance(messages, list):
        new_messages: list[Any] = []
        for message in messages:
            if (
                isinstance(message, dict)
                and message.get("role") == "user"
                and isinstance(message.get("content"), str)
            ):
                replaced, msg_spans = redact(message["content"])
                spans.extend(msg_spans)
                new_messages.append({**message, "content": replaced})
            else:
                new_messages.append(message)
        redacted["messages"] = new_messages

    request.state.redaction_spans = spans
    return redacted


def _redact_resume(resume: Any) -> Any:
    """Redact strings inside a resume payload before LangGraph sees them."""

    return redact_dict(resume)


def _record_real_usage(
    project_id: Optional[str],
    tokens_in: int,
    tokens_out: int,
    *,
    prebooked: int = 0,
    failure: bool = False,
) -> int:
    """True up ``prebooked`` reservation against actual provider usage.

    The pre-call enforcement already debited ``prebooked`` from the
    cap. This function reconciles by:

    * topping up when the provider used more than was reserved
      (``actual > prebooked``);
    * refunding the unused reservation when the provider used less
      (``actual < prebooked`` and ``actual > 0``).

    When ``failure`` is false (successful completion), a provider that
    does not report usage (``actual == 0``) keeps the full pre-booked
    charge -- otherwise a misbehaving model could bypass the cap by
    dropping the metadata.

    When ``failure`` is true (timeout, disconnect, or other error paths
    with no usable result), unused reservation is refunded, including the
    full prebook when ``actual == 0``.
    """

    actual = max(0, int(tokens_in)) + max(0, int(tokens_out))
    if not project_id:
        return actual
    if actual > prebooked:
        _budget.budget_tracker.record(project_id, tokens=actual - prebooked)
    elif actual and actual < prebooked:
        _budget.budget_tracker.refund(project_id, tokens=prebooked - actual)
    elif failure and actual == 0 and prebooked:
        _budget.budget_tracker.refund(project_id, tokens=prebooked)
    # Success with actual == prebooked, or success with actual == 0 -- no further change.
    return actual


def _resolve_resume_and_inputs(
    payload: Mapping[str, Any], request: Request
) -> tuple[dict[str, Any], Any, bool]:
    """Build ``(inputs, resume, resuming)`` from a request body.

    Returns the redacted ``inputs`` (always a dict, possibly empty) plus
    the ``resume`` payload to forward (or ``None``). ``resuming`` is
    ``True`` when the request opted into the resume branch -- callers use
    that flag to decide whether to skip input parsing.
    """

    raw_resume = _request_command(payload)
    resuming = raw_resume is not _RESUME_SENTINEL
    inputs = _request_inputs(payload)

    if resuming and inputs:
        api_error(
            status.HTTP_400_BAD_REQUEST,
            "Cannot supply both 'inputs' and 'command.resume'",
        )

    if resuming:
        request.state.redaction_spans = []
        return {}, _redact_resume(raw_resume), True

    return _redact_inputs(inputs, request), None, False


def _input_token_estimate(inputs: Mapping[str, Any]) -> int:
    """Approximate the prompt cost so budget can be enforced before the call."""

    if not isinstance(inputs, Mapping):
        return 1
    total = 0
    prompt = inputs.get("prompt")
    if isinstance(prompt, str):
        total += estimate_text_tokens(prompt)
    messages = inputs.get("messages")
    if isinstance(messages, list):
        for message in messages:
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    total += estimate_text_tokens(content)
    return max(1, total)


@router.get("", status_code=status.HTTP_200_OK)
def list_agents(
    runtime: AgentRuntime = Depends(get_runtime),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
) -> Dict[str, Any]:
    """List active and deprecated agents; ``shadow`` agents are hidden."""

    current_user_id(auth_payload)
    return {"agents": [meta.as_dict() for meta in runtime.list_metadata()]}


@router.get("/_tools", status_code=status.HTTP_200_OK)
def list_fe_tools(
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
) -> Dict[str, Any]:
    """Expose the FE-tool catalogue (PRD §5.4.1).

    Agents fetch FE-side data by raising ``langgraph.types.interrupt`` with
    a payload of ``{"tool", "args"}`` whose ``tool`` matches one of the
    names in this catalogue. Surfacing the BE-owned schema at runtime
    prevents the FE registry (``src/utils/ai/feTools/index.ts``) from
    drifting silently against the source of truth in
    :mod:`app.tools.fe_tool_schemas` -- a client can fetch the catalogue
    on session start and verify it implements every name an agent might
    interrupt for.

    Declared *before* ``GET /{name}`` because Starlette resolves routes
    in declaration order. The leading ``_`` also keeps this URL out of
    the agent namespace: :data:`app.agents.base.AGENT_NAME_RE` rejects
    names that begin with an underscore, so no future agent registration
    can shadow this route.
    """

    current_user_id(auth_payload)
    return {"tools": fe_tool_definitions()}


@router.get("/{name}", status_code=status.HTTP_200_OK)
def get_agent(
    name: str,
    runtime: AgentRuntime = Depends(get_runtime),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
) -> Dict[str, Any]:
    current_user_id(auth_payload)
    return runtime.get(name).metadata.as_dict()


def _autonomy_into_inputs(inputs: dict[str, Any], autonomy: Optional[str]) -> None:
    """Forward the validated autonomy into the LangGraph state.

    Catalog agents read it off ``state["autonomy_level"]`` (PRD §5A.2);
    putting it on inputs is sufficient because :class:`BaseAgentState`
    declares the field.

    Security: strip any client-supplied ``autonomy_level`` first so a
    caller cannot bypass ``_resolve_autonomy``'s validation by smuggling
    a value through ``inputs``.
    """

    inputs.pop("autonomy_level", None)
    if autonomy is not None:
        inputs["autonomy_level"] = autonomy


@router.post("/{name}/invoke", status_code=status.HTTP_200_OK)
async def invoke_agent(
    name: str,
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    runtime: AgentRuntime = Depends(get_runtime),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
) -> Any:
    user_id = current_user_id(auth_payload)
    payload = _normalize_payload(payload)
    route_path = request.url.path
    idem = await check_idempotency_with_metrics(
        request, payload, auth_subject=user_id, route=route_path
    )
    if idem.cached_response is not None:
        cached = idem.cached_response
        record_idempotency(route_path, "hit")
        record_invocation(name, "replay")
        return JSONResponse(
            content=cached.body,
            status_code=cached.status_code,
            headers={**cached.headers, "Idempotent-Replay": "true"},
        )

    try:
        reserved_budget = 0
        budget_reconciled = False
        project_id: Optional[str] = None
        metadata = runtime.get(name).metadata
        response_headers: dict[str, str] = {}
        _enforce_status(metadata, response_headers)
        autonomy = _resolve_autonomy(payload, metadata)

        inputs, resume, resuming = _resolve_resume_and_inputs(payload, request)
        project_id = inputs.get("project_id") if isinstance(inputs, dict) else None
        if resuming and project_id is None:
            project_id = (
                payload.get("config", {}).get("configurable", {}).get("project_id")
            )
        if not resuming:
            _autonomy_into_inputs(inputs, autonomy)

        enforce_request_limits(payload)
        _enforce_project_access(project_id)
        _require_project_manager(project_id, user_id)
        try:
            _enforce_rate_limit(name, user_id, metadata)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                record_invocation(name, "rate_limited")
            raise
        prebooked = max(1, _input_token_estimate(inputs))
        try:
            reserved_budget = _enforce_budget(project_id, tokens=prebooked)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_402_PAYMENT_REQUIRED:
                record_invocation(name, "budget_exhausted")
            raise

        context = _request_context(name, payload, runtime)
        timeout = settings.agent_request_timeout_seconds
        try:
            result = await asyncio.wait_for(
                runtime.ainvoke(
                    name,
                    inputs,
                    context=context,
                    resume=resume,
                    **_run_options(payload, user_id=user_id),
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={"error": f"Agent run exceeded {timeout}s timeout"},
            ) from exc

        tokens_in, tokens_out = result_token_usage_from_graph_result(result)
        _record_real_usage(
            project_id,
            tokens_in,
            tokens_out,
            prebooked=reserved_budget,
            failure=False,
        )
        budget_reconciled = True
        body: Dict[str, Any] = {
            "result": result,
            "usage": {"tokensIn": tokens_in, "tokensOut": tokens_out},
        }
        idem.store(status_code=status.HTTP_200_OK, body=body, headers=response_headers)
        record_idempotency(route_path, "miss")
        if response_headers:
            return JSONResponse(content=body, headers=response_headers)
        return body
    except BaseException:
        # Release unused budget reservation when the run did not reconcile
        # against recorded usage (timeout, crashes, cancellations, etc.).
        if not budget_reconciled and reserved_budget:
            _record_real_usage(
                project_id,
                0,
                0,
                prebooked=reserved_budget,
                failure=True,
            )
        # Release the in-flight reservation on any failure (gate
        # rejection, agent crash, asyncio cancellation) so a real
        # retry can proceed without waiting out the 24h TTL.
        idem.release()
        raise


@router.post("/{name}/stream")
async def stream_agent(
    name: str,
    request: Request,
    payload: Dict[str, Any] = Body(default_factory=dict),
    runtime: AgentRuntime = Depends(get_runtime),
    auth_payload: Dict[str, Any] = Depends(current_user_payload),
) -> Any:
    user_id = current_user_id(auth_payload)
    payload = _normalize_payload(payload)
    metadata = runtime.get(name).metadata
    response_headers: dict[str, str] = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    _enforce_status(metadata, response_headers)
    autonomy = _resolve_autonomy(payload, metadata)

    inputs, resume, resuming = _resolve_resume_and_inputs(payload, request)
    project_id = inputs.get("project_id") if isinstance(inputs, dict) else None
    if resuming and project_id is None:
        project_id = (
            payload.get("config", {}).get("configurable", {}).get("project_id")
        )
    if not resuming:
        _autonomy_into_inputs(inputs, autonomy)

    enforce_request_limits(payload)

    # Idempotency on the initial POST only: the resume path is already
    # idempotent via thread-state checkpointing, so we never want a
    # client-supplied key to gate a resume. This mirrors the
    # /invoke handler, with two differences: the cached body for an
    # SSE replay is just a completion marker (the wire stream itself
    # is not stored), and we release the slot if the stream errors so
    # a real retry with the same key can proceed.
    route_path = request.url.path
    idem = None
    if not resuming:
        idem = await check_idempotency_with_metrics(
            request, payload, auth_subject=user_id, route=route_path
        )
        if idem.cached_response is not None:
            cached = idem.cached_response
            record_idempotency(route_path, "hit")
            record_invocation(name, "replay")
            return JSONResponse(
                content=cached.body,
                status_code=cached.status_code,
                headers={**cached.headers, "Idempotent-Replay": "true"},
            )

    reserved_budget = 0
    stream_response_returned = False
    try:
        _enforce_project_access(project_id)
        _require_project_manager(project_id, user_id)
        try:
            _enforce_rate_limit(name, user_id, metadata)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
                record_invocation(name, "rate_limited")
            raise
        prebooked = max(1, _input_token_estimate(inputs))
        try:
            reserved_budget = _enforce_budget(project_id, tokens=prebooked)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_402_PAYMENT_REQUIRED:
                record_invocation(name, "budget_exhausted")
            raise

        options = _run_options(payload, user_id=user_id)
        context = _request_context(name, payload, runtime)
        timeout = settings.agent_request_timeout_seconds

        async def event_generator() -> AsyncIterator[bytes]:
            tokens_in_total = 0
            tokens_out_total = 0
            completed_ok = False
            failure_budget_settled = False

            def settle_failure_budget() -> None:
                nonlocal failure_budget_settled
                if failure_budget_settled or not reserved_budget:
                    return
                _record_real_usage(
                    project_id,
                    tokens_in_total,
                    tokens_out_total,
                    prebooked=reserved_budget,
                    failure=True,
                )
                failure_budget_settled = True

            try:
                stream = runtime.astream(
                    name,
                    inputs,
                    context=context,
                    resume=resume,
                    **options,
                )
                async for mode, chunk in _with_disconnect(request, stream, timeout):
                    for envelope in translate_event(mode, chunk):
                        yield encode_sse(envelope)
                        if envelope.get("type") == "custom":
                            usage = _maybe_capture_usage(envelope)
                            if usage is not None:
                                tokens_in_total += usage[0]
                                tokens_out_total += usage[1]
            except AgentError as exc:
                yield encode_sse(
                    error_envelope(
                        str(exc),
                        recoverable=False,
                        code=getattr(exc, "code", "agent_error"),
                    )
                )
            except asyncio.TimeoutError:
                yield encode_sse(
                    error_envelope(
                        f"Agent run exceeded {timeout}s timeout",
                        recoverable=False,
                        code="timeout",
                    )
                )
            except _ClientDisconnected:
                settle_failure_budget()
                if idem is not None:
                    idem.release()
                return
            except Exception:  # noqa: BLE001 -- intentional translation boundary
                logger.exception("Agent %r failed mid-stream.", name)
                yield encode_sse(
                    error_envelope(
                        "Agent run failed; see server logs for details.",
                        recoverable=False,
                        code="agent_error",
                    )
                )
            else:
                if tokens_in_total or tokens_out_total:
                    yield encode_sse(usage_envelope(tokens_in_total, tokens_out_total))
                _record_real_usage(
                    project_id,
                    tokens_in_total,
                    tokens_out_total,
                    prebooked=reserved_budget,
                    failure=False,
                )
                completed_ok = True
            if not completed_ok:
                settle_failure_budget()
            # On a clean stream completion we leave a sentinel in the cache
            # so an immediate retry with the same key replays as a 200 JSON
            # marker rather than restarting the run; on any error path we
            # release the slot so a real retry can proceed.
            if idem is not None:
                if completed_ok:
                    idem.store(
                        status_code=status.HTTP_200_OK,
                        body={"status": "stream_completed"},
                    )
                    record_idempotency(route_path, "miss")
                else:
                    idem.release()
            yield DONE_FRAME

        response = StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers=response_headers,
        )
        stream_response_returned = True
        return response
    except BaseException:
        if reserved_budget and not stream_response_returned:
            _record_real_usage(
                project_id,
                0,
                0,
                prebooked=reserved_budget,
                failure=True,
            )
        if idem is not None:
            idem.release()
        raise


class _ClientDisconnected(Exception):
    """Raised internally when the SSE client closes the connection."""


def _maybe_capture_usage(envelope: dict[str, Any]) -> Optional[tuple[int, int]]:
    """Return ``(tokens_in, tokens_out)`` if envelope is a usage event."""

    data = envelope.get("data")
    if not isinstance(data, dict):
        return None
    if data.get("kind") != "usage":
        return None
    return (
        int(data.get("tokensIn", 0) or 0),
        int(data.get("tokensOut", 0) or 0),
    )


async def _with_disconnect(
    request: Request,
    stream: AsyncIterator[Any],
    timeout: int,
) -> AsyncIterator[Any]:
    """Wrap ``stream`` with cancel-on-disconnect + per-call timeout.

    Both the stream-consumer task and the disconnect-watcher task race
    against ``asyncio.wait``. Whichever completes first decides the
    next step; on disconnect we ``aclose`` the underlying stream so the
    LangGraph run actually stops billing tokens (the previous
    poll-on-each-iteration design kept running until the next chunk
    arrived, which can be many seconds).
    """

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    iterator = stream.__aiter__()

    async def _watch_disconnect() -> None:
        # Poll every 100 ms (down from 1 s) so a disconnected client
        # stops incurring token spend within at most one polling interval
        # rather than up to a full second. ``request.is_disconnected()``
        # is cheap (peeks at the receive queue) so the tighter cadence
        # has negligible CPU cost.
        while True:
            if await request.is_disconnected():
                return
            await asyncio.sleep(0.1)

    disconnect_task: Optional[asyncio.Task[None]] = None
    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            if disconnect_task is None or disconnect_task.done():
                disconnect_task = asyncio.create_task(_watch_disconnect())
            anext_task = asyncio.create_task(iterator.__anext__())
            done, _ = await asyncio.wait(
                {anext_task, disconnect_task},
                timeout=remaining,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                anext_task.cancel()
                try:
                    await anext_task
                except (asyncio.CancelledError, StopAsyncIteration):
                    pass
                raise asyncio.TimeoutError()
            if disconnect_task in done:
                anext_task.cancel()
                try:
                    await anext_task
                except (asyncio.CancelledError, StopAsyncIteration):
                    pass
                raise _ClientDisconnected()
            try:
                event = anext_task.result()
            except StopAsyncIteration:
                return
            yield event
    finally:
        if disconnect_task is not None and not disconnect_task.done():
            disconnect_task.cancel()
        aclose = getattr(stream, "aclose", None)
        if callable(aclose):
            try:
                await aclose()
            except Exception:  # noqa: BLE001 -- best-effort cleanup
                logger.debug("Stream aclose raised during cleanup", exc_info=True)
