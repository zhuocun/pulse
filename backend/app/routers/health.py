"""Service health endpoint (PRD v2.1 §8.1 / §5A.5).

The FE polls ``GET /api/v1/health`` and shows the offline banner when it
returns non-2xx. We expose enough metadata for the operator dashboard
without leaking anything secret.

Response shape: both snake_case and camelCase keys are emitted so the
existing test suite keeps reading ``status``/``agents_loaded`` while the
React client (``src/utils/ai/agentClient.ts`` `getAgentHealth`) can read
``ok``/``agentsLoaded`` without any client-side mapping.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List

from fastapi import APIRouter, Request, status

from app.agents import AgentRuntime
from app.agents.checkpointing import resolve_agent_backend
from app.agents.embeddings import resolve_embeddings_spec
from app.agents.llm import (
    PROVIDER_ANTHROPIC,
    PROVIDER_DEEPSEEK,
    PROVIDER_OPENAI,
    PROVIDER_STUB,
    _failover_secondary_spec,
    probe_provider_connectivity,
    resolve_chat_model_spec,
)
from app.config import settings
from app.deploy_env import detected_hosted_platform
from app.repositories import repository

logger = logging.getLogger(__name__)


router = APIRouter()


def _agent_persistence_ok(runtime: AgentRuntime) -> bool:
    """Report whether the agent persistence backend is operational.

    The signal is intentionally a static check rather than a live probe.
    For the ``"none"`` and ``"memory"`` backends there is nothing to
    probe -- ``"none"`` is intentionally disabled and the in-process
    ``InMemorySaver`` is reachable as long as the process is alive
    (which it must be, otherwise we would not be answering this
    request). For the ``"postgres"`` backend the FastAPI lifespan
    enters ``AsyncPostgresSaver`` on its ``AsyncExitStack`` and awaits
    ``setup()`` exactly once at boot; if that connection / migration
    failed the lifespan throws and the app never starts. So at
    request-time, ``runtime.checkpointer is not None`` already proves
    the boot-time connection succeeded -- a per-request ``SELECT 1``
    would only catch transient drops, at the cost of an extra round
    trip on every health poll (the FE polls this on a 30s timer). If
    a future maintainer wants to detect mid-life connection death,
    add it as a separate timed probe rather than folding it into the
    request path.
    """

    backend = resolve_agent_backend(
        settings.agent_checkpoint_backend,
        agent_postgres_uri=settings.agent_postgres_uri,
    )
    if backend == "postgres":
        return runtime.checkpointer is not None
    # ``none`` / ``memory`` / unknown future backends: trust that boot
    # succeeded. Unknown backends would have failed startup via
    # :func:`build_checkpointer` if they were genuinely unsupported.
    return True


def health(runtime: AgentRuntime) -> Dict[str, Any]:
    """Build the health payload, exercising the DB once per probe.

    A health endpoint that never touches the DB happily reports ``ok``
    while every real request 5xxs -- the FE banner stays green and the
    operator on-call wastes minutes finding out. We swallow the probe
    exception (so the response itself does not 500) but downgrade
    ``status`` to ``degraded`` and ``ok`` to ``False`` so callers can
    branch on it.

    The agent persistence signal (``agentPersistence`` /
    ``agentPersistenceOk``) is a static check on the runtime rather
    than a live probe -- see :func:`_agent_persistence_ok` for why.
    """

    db_ok = True
    started = time.perf_counter()
    try:
        repository.ping()
    except Exception:  # noqa: BLE001 -- intentional broad catch on probe boundary
        logger.warning("Repository ping failed during health probe.", exc_info=True)
        db_ok = False
    # Measured around the DB ping only -- it is the one IO-bound branch in
    # this handler, and the FE (``useAgentHealth``) renders the value as the
    # operator-visible round-trip indicator. Reported in both snake_case and
    # camelCase to stay consistent with the rest of this payload.
    latency_ms = round((time.perf_counter() - started) * 1000.0, 2)

    persistence_ok = _agent_persistence_ok(runtime)
    # Surface the resolved value (post-``auto``) so the operator dashboard
    # and the FE banner see ``"postgres"`` / ``"memory"`` rather than the
    # ``"auto"`` sentinel. The raw config value is never user-meaningful.
    checkpointer_resolved = resolve_agent_backend(
        settings.agent_checkpoint_backend,
        agent_postgres_uri=settings.agent_postgres_uri,
    )
    store_resolved = resolve_agent_backend(
        settings.agent_store_backend,
        agent_postgres_uri=settings.agent_postgres_uri,
    )
    persistence_backend = checkpointer_resolved
    agents_loaded = len(runtime.registry)
    overall_ok = db_ok and persistence_ok
    return {
        "status": "ok" if overall_ok else "degraded",
        "ok": overall_ok,
        "database": "ok" if db_ok else "degraded",
        "agents_loaded": agents_loaded,
        "agentsLoaded": agents_loaded,
        "latency_ms": latency_ms,
        "latencyMs": latency_ms,
        "checkpointer": checkpointer_resolved,
        "store": store_resolved,
        "agent_persistence": persistence_backend,
        "agentPersistence": persistence_backend,
        "agent_persistence_ok": persistence_ok,
        "agentPersistenceOk": persistence_ok,
    }


@router.get("", status_code=status.HTTP_200_OK)
def health_endpoint(request: Request) -> Dict[str, Any]:
    return health(request.app.state.agent_runtime)


# ---------------------------------------------------------------------------
# /api/v1/health/ai -- dedicated AI readiness probe
#
# Operators use this endpoint to debug "the chat returns 500" without any
# auth (every legitimate user-facing failure is opaque by design, so the
# operator-only readiness path stays open) and without spending tokens
# (the LLM is only touched when ``?probe=true``).
# ---------------------------------------------------------------------------


def _is_multi_instance() -> tuple[bool, str]:
    """Return ``(is_multi, reason)`` -- thin wrapper around the lifespan helper.

    Imported lazily so this router module can be loaded without
    triggering ``app.main`` import (which would pull in the entire
    FastAPI app, the router list, and most of the agents catalog at
    import time, slowing test collection considerably).
    """

    from app.main import _is_multi_worker_or_multi_instance

    return _is_multi_worker_or_multi_instance()


def _ai_readiness_payload(
    request: Request,
    *,
    probe_result: Any = None,
) -> Dict[str, Any]:
    """Build the structured AI-readiness payload.

    Issues / warnings are collected inline so the operator sees every
    failure surface in one shot rather than chasing one root-cause at
    a time. No exception is raised from this path -- the endpoint
    always returns 200 with ``ready=false`` when something is wrong.
    """

    runtime = request.app.state.agent_runtime
    jwt_source = getattr(request.app.state, "jwt_secret_source", "ephemeral")

    chat_spec = resolve_chat_model_spec(settings)
    embeddings_spec = resolve_embeddings_spec(settings=settings)
    failover_spec = _failover_secondary_spec(chat_spec, settings)
    multi_instance, _multi_reason = _is_multi_instance()
    hosted_platform = detected_hosted_platform()

    # Auto-detect: ``AGENT_CHECKPOINT_BACKEND`` / ``AGENT_STORE_BACKEND``
    # default to ``"auto"`` and resolve to ``"postgres"`` when
    # ``AGENT_POSTGRES_URI`` is set. Both the readiness payload and the
    # downstream guard logic must read the resolved value so the
    # operator sees the same backend name everywhere.
    checkpointer_resolved = resolve_agent_backend(
        settings.agent_checkpoint_backend,
        agent_postgres_uri=settings.agent_postgres_uri,
    )
    store_resolved = resolve_agent_backend(
        settings.agent_store_backend,
        agent_postgres_uri=settings.agent_postgres_uri,
    )
    agent_postgres_uri_configured = bool(
        (settings.agent_postgres_uri or "").strip()
    )

    issues: List[str] = []
    warnings: List[str] = []

    # Provider / key sanity. We name the missing env var without ever
    # echoing the key value (booleans only flow into the payload).
    missing_key_messages = {
        PROVIDER_OPENAI: "OPENAI_API_KEY missing -- provider explicitly set to 'openai'",
        PROVIDER_ANTHROPIC: (
            "ANTHROPIC_API_KEY missing -- provider explicitly set to 'anthropic'"
        ),
        PROVIDER_DEEPSEEK: (
            "DEEPSEEK_API_KEY missing -- provider explicitly set to 'deepseek'"
        ),
    }
    if chat_spec.provider in missing_key_messages and not chat_spec.api_key:
        issues.append(missing_key_messages[chat_spec.provider])

    if chat_spec.provider == PROVIDER_STUB:
        warnings.append(
            "Running in stub mode -- no real LLM provider configured"
        )

    # Backend-shape issues. Read the resolved values so an operator who
    # only set ``AGENT_POSTGRES_URI`` (and left the backends on ``auto``)
    # still gets the right diagnostic.
    if checkpointer_resolved == "postgres" and runtime.checkpointer is None:
        issues.append(
            "AGENT_CHECKPOINT_BACKEND=postgres but the runtime checkpointer "
            "is None"
        )

    memory_backends = []
    if checkpointer_resolved == "memory":
        memory_backends.append("AGENT_CHECKPOINT_BACKEND=memory")
    if store_resolved == "memory":
        memory_backends.append("AGENT_STORE_BACKEND=memory")
    if settings.rate_limit_backend.strip().lower() == "memory":
        memory_backends.append("RATE_LIMIT_BACKEND=memory")
    if settings.budget_backend.strip().lower() == "memory":
        memory_backends.append("BUDGET_BACKEND=memory")
    if settings.idempotency_backend.strip().lower() == "memory":
        memory_backends.append("IDEMPOTENCY_BACKEND=memory")

    multi_instance_safe = not (multi_instance and memory_backends)
    if multi_instance and memory_backends:
        warnings.append(
            "Memory backend(s) on a multi-instance deploy: "
            + ", ".join(memory_backends)
        )

    # Surfacing the auto-detect path: a hosted deploy with the memory
    # checkpointer (because no ``AGENT_POSTGRES_URI`` was provided)
    # cannot resume interrupt-using agents across cold starts. Point
    # the operator at the one env var that fixes it.
    if (
        hosted_platform is not None
        and checkpointer_resolved == "memory"
    ):
        warnings.append(
            "Agent checkpointer is in-memory on a hosted deploy "
            f"({hosted_platform}); set AGENT_POSTGRES_URI to a managed "
            "Postgres so the interrupt-using agents survive cold starts."
        )

    if hosted_platform is not None and not settings.cors_origin_regex:
        if settings.cors_origins and all(
            _is_localhost_origin(o) for o in settings.cors_origins
        ):
            warnings.append("CORS_ORIGINS is localhost-only on a hosted deploy")

    if probe_result is not None and not probe_result.reachable:
        issues.append(
            f"Provider connectivity probe failed: {probe_result.detail}"
        )

    redis_configured = bool((settings.redis_uri or "").strip())
    cors_origins = list(settings.cors_origins)

    payload: Dict[str, Any] = {
        "ready": not issues,
        "provider": chat_spec.provider,
        "providerResolved": chat_spec.provider,
        "providerConfigured": settings.agent_chat_model_provider,
        "model": chat_spec.model,
        "stubMode": chat_spec.provider == PROVIDER_STUB,
        "anthropicKeyPresent": bool(settings.anthropic_api_key),
        "openaiKeyPresent": bool(settings.openai_api_key),
        "deepseekKeyPresent": bool(settings.deepseek_api_key),
        "providerConnectivityProbeSupported": chat_spec.provider
        in {PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_DEEPSEEK, PROVIDER_STUB},
        "failoverConfigured": failover_spec is not None,
        "embeddingsProvider": embeddings_spec.provider,
        "embeddingsStubMode": embeddings_spec.is_stub,
        "checkpointerBackend": checkpointer_resolved,
        "storeBackend": store_resolved,
        "agentPostgresUriConfigured": agent_postgres_uri_configured,
        "rateLimitBackend": settings.rate_limit_backend,
        "budgetBackend": settings.budget_backend,
        "idempotencyBackend": settings.idempotency_backend,
        "redisConfigured": redis_configured,
        "vectorSearchEnabled": settings.agent_vector_search_enabled,
        "hostedPlatform": hosted_platform,
        "multiInstance": multi_instance,
        "multiInstanceSafe": multi_instance_safe,
        "jwtSecretSource": jwt_source,
        "corsOrigins": cors_origins,
        "corsOriginRegex": settings.cors_origin_regex,
        "agentsLoaded": len(runtime.registry),
        "issues": issues,
        "warnings": warnings,
    }

    if probe_result is not None:
        probe_payload = {
            "reachable": probe_result.reachable,
            "detail": probe_result.detail,
            "checkedAt": probe_result.checked_at,
        }
        payload["providerConnectivity"] = probe_payload
        payload["provider_connectivity"] = {
            "reachable": probe_result.reachable,
            "detail": probe_result.detail,
            "checked_at": probe_result.checked_at,
        }

    # snake_case mirror for every camelCase field. Built mechanically
    # so a new field cannot drift out of casing parity over time.
    snake_mirror = {
        "provider_resolved": payload["providerResolved"],
        "provider_configured": payload["providerConfigured"],
        "stub_mode": payload["stubMode"],
        "anthropic_key_present": payload["anthropicKeyPresent"],
        "openai_key_present": payload["openaiKeyPresent"],
        "deepseek_key_present": payload["deepseekKeyPresent"],
        "provider_connectivity_probe_supported": payload[
            "providerConnectivityProbeSupported"
        ],
        "failover_configured": payload["failoverConfigured"],
        "embeddings_provider": payload["embeddingsProvider"],
        "embeddings_stub_mode": payload["embeddingsStubMode"],
        "checkpointer_backend": payload["checkpointerBackend"],
        "store_backend": payload["storeBackend"],
        "agent_postgres_uri_configured": payload["agentPostgresUriConfigured"],
        "rate_limit_backend": payload["rateLimitBackend"],
        "budget_backend": payload["budgetBackend"],
        "idempotency_backend": payload["idempotencyBackend"],
        "redis_configured": payload["redisConfigured"],
        "vector_search_enabled": payload["vectorSearchEnabled"],
        "hosted_platform": payload["hostedPlatform"],
        "multi_instance": payload["multiInstance"],
        "multi_instance_safe": payload["multiInstanceSafe"],
        "jwt_secret_source": payload["jwtSecretSource"],
        "cors_origins": payload["corsOrigins"],
        "cors_origin_regex": payload["corsOriginRegex"],
        "agents_loaded": payload["agentsLoaded"],
    }
    payload.update(snake_mirror)
    return payload


def _is_localhost_origin(origin: str) -> bool:
    """Detect a localhost CORS origin without importing ``app.main``.

    Duplicated from :func:`app.main._origin_is_localhost` to keep the
    router free of an import cycle (``main`` already imports this
    module).
    """

    from urllib.parse import urlsplit

    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.hostname
    if host is None:
        return False
    candidate = f"[{host}]" if ":" in host else host
    return candidate in {"localhost", "127.0.0.1", "0.0.0.0", "[::1]"}


@router.get("/ai", status_code=status.HTTP_200_OK)
async def ai_health(request: Request, probe: bool = False) -> Dict[str, Any]:
    """Structured readiness payload for the AI features.

    ``?probe=true`` triggers a connectivity probe against the
    configured provider (cached 30s); the default ``probe=false`` keeps
    the endpoint cheap so it is safe to poll on a tight cadence.
    """

    probe_result = None
    if probe:
        spec = resolve_chat_model_spec(settings)
        probe_result = await probe_provider_connectivity(spec)
    return _ai_readiness_payload(request, probe_result=probe_result)
