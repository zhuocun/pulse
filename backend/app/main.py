import logging
import os
import re
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agents import AgentRuntime
from app.agents.checkpointing import resolve_agent_backend, resolve_agent_postgres_uri
from app.agents.errors import AgentConfigurationError, AgentError, agent_app_error_content
from app.agents.embeddings import assert_embeddings_provider_available, make_embeddings
from app.agents.llm import assert_provider_available
from app.config import Settings, settings
from app.deploy_env import (
    HOSTED_PLATFORM_ENV_MARKERS,
    detected_hosted_platform,
    has_hosted_platform_env,
)
from app.errors import AppError
from app.middleware import budget as _budget
from app.middleware import idempotency as _idempotency
from app.middleware import rate_limit as _rate_limit
from app.observability.metrics import configure_metrics, make_metrics_app
from app.observability.otel import configure_otel, instrument_fastapi_app
from app.repositories import repository
from app.routers import (
    agents,
    ai as ai_router,
    auth,
    boards,
    health,
    projects,
    tasks,
    users,
)
from app.security import JWT_SECRET_MIN_LENGTH
from app.system_config import load_or_create_jwt_secret
from app.validation import unwrap_error_detail

logger = logging.getLogger(__name__)


def _validate_cors_origin_regex(pattern: str) -> None:
    """Reject obviously-permissive CORS regexes at boot.

    Pairing ``allow_credentials=True`` with a regex like ``.*`` would
    echo any caller's ``Origin`` and authorise credentialed XHRs from
    arbitrary domains. Operators should always anchor their regex.
    """

    if not pattern:
        return
    if not pattern.startswith("^") or not pattern.endswith("$"):
        raise RuntimeError(
            "CORS_ORIGIN_REGEX must be anchored with ^ and $ when "
            "allow_credentials is enabled"
        )
    try:
        re.compile(pattern)
    except re.error as exc:
        raise RuntimeError(f"CORS_ORIGIN_REGEX is not a valid regex: {exc}") from exc


def _validate_agent_postgres_backend(cfg: Settings) -> None:
    """Fail-fast when ``AGENT_*_BACKEND=postgres`` lacks a connection string.

    The runtime helper :func:`resolve_agent_postgres_uri` already raises
    :class:`AgentConfigurationError` when neither ``AGENT_POSTGRES_URI``
    nor ``POSTGRES_URI`` (nor the discrete ``POSTGRES_HOST`` / ``_USER`` /
    ``_DATABASE`` / ``_PASSWORD`` / ``_PORT`` / ``_SSL`` fields) resolve
    to a usable connection string -- but it only fires lazily at first
    agent invocation, which means a misconfigured production deploy
    keeps booting cleanly and only surfaces the error when a user
    triggers an agent run from the FE (rendering as a generic 500 with
    no operator-facing breadcrumb).

    Re-raising here at lifespan startup pulls the failure forward into
    the deploy log where the misconfiguration is obvious. We translate
    :class:`AgentConfigurationError` into :class:`RuntimeError` (the
    same shape ``_validate_settings`` already uses for boot failures)
    and explicitly name both ``AGENT_POSTGRES_URI`` and ``POSTGRES_URI``
    so an operator scanning the log sees the exact knobs to set without
    having to dig into the code.
    """

    checkpoint_resolved = resolve_agent_backend(
        cfg.agent_checkpoint_backend, agent_postgres_uri=cfg.agent_postgres_uri
    )
    store_resolved = resolve_agent_backend(
        cfg.agent_store_backend, agent_postgres_uri=cfg.agent_postgres_uri
    )
    if checkpoint_resolved != "postgres" and store_resolved != "postgres":
        return

    backends_to_check: list[str] = []
    if checkpoint_resolved == "postgres":
        backends_to_check.append("AGENT_CHECKPOINT_BACKEND")
    if store_resolved == "postgres":
        backends_to_check.append("AGENT_STORE_BACKEND")

    for backend_env in backends_to_check:
        try:
            resolve_agent_postgres_uri(cfg, backend_env=backend_env)
        except AgentConfigurationError as exc:
            raise RuntimeError(
                f"{backend_env}=postgres but no connection string is "
                "configured; set AGENT_POSTGRES_URI or POSTGRES_URI (or "
                "the discrete POSTGRES_HOST / POSTGRES_USER / "
                "POSTGRES_DATABASE / POSTGRES_PASSWORD fields) before "
                "starting the server."
            ) from exc


def _validate_settings(cfg: Settings) -> str:
    """Fail-fast bootstrap checks for security-critical configuration.

    Returns the resolved JWT-secret source -- one of ``"env"``,
    ``"persisted"``, ``"ephemeral"`` -- so the lifespan can stash it on
    ``application.state`` for the readiness endpoint without re-running
    the resolution. Mutates the frozen :class:`Settings` instance in
    place via :func:`object.__setattr__` (the same pattern
    ``conftest.py`` uses for test overrides).
    """

    source = _resolve_and_install_jwt_secret(cfg)
    _validate_cors_origin_regex(cfg.cors_origin_regex)
    assert_provider_available(settings=cfg)
    assert_embeddings_provider_available(settings=cfg)
    _validate_agent_postgres_backend(cfg)
    return source


def _resolve_and_install_jwt_secret(cfg: Settings) -> str:
    """Resolve the JWT secret in priority order and write it onto ``cfg``.

    Order:
        1. ``UUID`` env (explicit operator override).
        2. Persisted ``system_config.jwt_secret`` in Mongo (drops one
           required env var: a Vercel deploy that already needs
           ``MONGO_URI`` for user data now gets a stable JWT secret
           without an extra knob).
        3. Random ephemeral secret (local dev only).

    Raises :class:`RuntimeError` when:
        - ``UUID`` is set but shorter than
          :data:`app.security.JWT_SECRET_MIN_LENGTH` (operator typo).
        - On a hosted deploy where neither ``UUID`` nor a reachable
          Mongo can supply a secret (the deploy already needs Mongo
          for user data, so this is the same root cause).
    """

    uuid_env = (os.getenv("UUID") or "").strip()
    if uuid_env:
        if len(uuid_env) < JWT_SECRET_MIN_LENGTH:
            raise RuntimeError(
                f"UUID must be at least {JWT_SECRET_MIN_LENGTH} characters; "
                "token-issuing endpoints would fail at first request."
            )
        object.__setattr__(cfg, "jwt_secret", uuid_env)
        return "env"

    secret, source = _try_persisted_jwt_secret(cfg)
    if secret is not None:
        object.__setattr__(cfg, "jwt_secret", secret)
        if source == "generated":
            logger.info(
                "JWT secret bootstrapped into system_config.jwt_secret "
                "(first boot). Subsequent restarts will reuse the persisted "
                "value; set UUID env to override."
            )
        else:
            logger.info("JWT secret loaded from persisted system_config.")
        # Both ``persisted`` and ``generated`` are reported as ``persisted``
        # to the readiness endpoint: the operator-visible distinction is
        # only "the secret survives a restart" vs "it does not".
        return "persisted"

    if has_hosted_platform_env():
        platform = detected_hosted_platform() or "this hosted platform"
        raise RuntimeError(
            f"MONGO_URI is unreachable on {platform.capitalize()} and no UUID "
            "env var was set; the persisted JWT-secret bootstrap requires "
            "Mongo. Set MONGO_URI to a reachable cluster (Mongo Atlas "
            "serverless is the canonical option for Vercel) or set UUID to "
            f"a stable secret of at least {JWT_SECRET_MIN_LENGTH} characters."
        )

    # Local dev fallback -- the dataclass already populated jwt_secret
    # with a random hex via ``_resolve_jwt_secret``; keep it and warn
    # so the operator notices the per-restart token invalidation.
    if len(cfg.jwt_secret) < JWT_SECRET_MIN_LENGTH:
        raise RuntimeError(
            f"JWT secret must be at least {JWT_SECRET_MIN_LENGTH} characters; "
            "token-issuing endpoints would fail at first request."
        )
    logger.warning(
        "UUID env var is not set and Mongo is unreachable; using an "
        "ephemeral JWT secret. All tokens will be invalidated on each "
        "server restart. Set UUID to a stable secret of at least %d "
        "characters or point MONGO_URI at a reachable cluster.",
        JWT_SECRET_MIN_LENGTH,
    )
    return "ephemeral"


def _try_persisted_jwt_secret(cfg: Settings) -> tuple[str | None, str]:
    """Best-effort load of the persisted JWT secret; returns ``(None, "")`` on miss.

    Pings the repository first so the bootstrap path does not get stuck
    on a slow Mongo handshake (the same ping the lifespan does
    explicitly; we pull it forward so the JWT resolution can rely on a
    confirmed connection). All Mongo errors collapse to "missing" so
    the caller can decide whether to fall back or escalate.
    """

    try:
        repository.ping()
    except Exception:  # noqa: BLE001 -- treat unreachable Mongo as missing
        logger.debug(
            "Repository ping failed during JWT-secret bootstrap; "
            "falling back to next resolution path.",
            exc_info=True,
        )
        return None, ""
    try:
        secret, source = load_or_create_jwt_secret(repository)
    except Exception:  # noqa: BLE001 -- read/write failures fall back
        logger.exception(
            "Persisted JWT-secret bootstrap failed; falling back."
        )
        return None, ""
    return secret, source


def _propagate_langsmith_env(cfg: Settings) -> None:
    """Make ``LANGSMITH_TRACING=true`` actually wire LangChain tracing.

    LangChain reads its tracing flags from the process environment on
    first use. Our typed :class:`Settings` reads ``LANGSMITH_TRACING``
    and ``LANGSMITH_PROJECT`` from ``.env``, but unless we re-export
    the canonical LangChain names the flag was previously inert -- the
    boot log printed ``langsmith=on`` while no trace ever shipped.

    We use ``setdefault`` so an operator who already exported the
    canonical names directly (e.g. via a Vercel project secret) wins
    over the ``.env`` mirror; both the legacy ``LANGCHAIN_*`` and the
    modern ``LANGSMITH_*`` prefixes are populated because LangChain
    0.3.x reads either depending on subpackage. ``LANGSMITH_API_KEY`` /
    ``LANGCHAIN_API_KEY`` stay outside this helper -- the API key must
    come from the operator's secret manager, never from a typed config
    file the repo could accidentally commit.
    """

    if not cfg.langsmith_tracing:
        return
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGSMITH_TRACING", "true")
    if cfg.langsmith_project:
        os.environ.setdefault("LANGCHAIN_PROJECT", cfg.langsmith_project)
        os.environ.setdefault("LANGSMITH_PROJECT", cfg.langsmith_project)


_PRODUCTION_SHAPED_ENV_VARS = HOSTED_PLATFORM_ENV_MARKERS


_LOCALHOST_HOSTS: frozenset[str] = frozenset(
    {"localhost", "127.0.0.1", "0.0.0.0", "[::1]"}
)


def _origin_is_localhost(origin: str) -> bool:
    """Return ``True`` when ``origin`` is an http(s) URL pointing at localhost.

    We parse the URL host portion explicitly rather than substring-matching
    on ``"localhost"``: a plausible production origin like
    ``https://localhost.example.com`` shares the substring but is not a
    loopback address, and a naive check would silence the warning in
    exactly the deploy where it matters most.

    The IPv6 loopback ``[::1]`` is matched on the bracketed form because
    that is how it appears in a CORS origin (``http://[::1]:3000``);
    :func:`urllib.parse.urlsplit` strips the brackets via ``hostname``,
    so we re-add them when comparing.
    """

    from urllib.parse import urlsplit

    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.hostname
    if host is None:
        return False
    # ``hostname`` lowercases the host and strips the IPv6 brackets.
    candidate = f"[{host}]" if ":" in host else host
    return candidate in _LOCALHOST_HOSTS


def _warn_about_localhost_only_cors(cfg: Settings) -> None:
    """Loud-log the silent-failure mode for localhost-only CORS in prod.

    The default ``CORS_ORIGINS`` ships with ``http://localhost:3000``
    and ``http://127.0.0.1:3000`` so the local-dev FE talks to the
    local-dev BE without ceremony. When that default ships unchanged
    to a production-shaped deploy (Vercel, Render, Fly, Railway, a K8s
    pod, a generic Render web service), every browser request from the
    real FE origin is rejected at the CORS preflight: the AI features
    appear "broken" with no server-side error, and the symptom is
    indistinguishable from an outage in the BE.

    We detect the production shape by checking a curated set of host
    env vars (``VERCEL``, ``VERCEL_URL``, ``RENDER_EXTERNAL_HOSTNAME``,
    ``RENDER``, ``KUBERNETES_SERVICE_HOST``, ``FLY_APP_NAME``,
    ``RAILWAY_PROJECT_ID``) -- any one set is enough. We only warn when
    the operator has not opted into a regex via ``CORS_ORIGIN_REGEX``
    (a non-empty regex implies they're intentionally matching multiple
    real origins) and every entry in ``CORS_ORIGINS`` is a localhost
    variant. Logging at ``WARNING`` keeps the gotcha visible in the
    deploy log without breaking startup.
    """

    if not has_hosted_platform_env():
        return
    if cfg.cors_origin_regex:
        return
    if not cfg.cors_origins:
        return
    if not all(_origin_is_localhost(origin) for origin in cfg.cors_origins):
        return

    platform = detected_hosted_platform()
    platform_label = platform.capitalize() if platform else "this hosted"
    logger.warning(
        "CORS is configured with localhost-only origins (%s) on a "
        "%s deploy; browser requests from the real FE "
        "origin will be blocked at the CORS preflight, so the AI "
        "features will not load. Set CORS_ORIGINS to the deployed FE "
        "origin (or CORS_ORIGIN_REGEX for multi-origin matches).",
        ", ".join(cfg.cors_origins),
        platform_label,
    )


_SUPPORTED_MIDDLEWARE_BACKENDS = ("memory", "redis")
_SUPPORTED_RATE_LIMIT_BACKENDS = _SUPPORTED_MIDDLEWARE_BACKENDS
_SUPPORTED_BUDGET_BACKENDS = _SUPPORTED_MIDDLEWARE_BACKENDS
_SUPPORTED_IDEMPOTENCY_BACKENDS = _SUPPORTED_MIDDLEWARE_BACKENDS


@dataclass(frozen=True)
class MiddlewareBackends:
    """Per-app middleware backends owned by the FastAPI lifespan."""

    rate_limiter: _rate_limit.RateLimitBackend
    budget_tracker: _budget.BudgetBackend


def _configure_middleware_backends(cfg: Settings) -> MiddlewareBackends:
    """Build the app-owned rate-limit / budget backends and configure idempotency.

    The default ``memory`` backends keep working without any config so
    local dev / tests do not need a Redis. When any of
    ``RATE_LIMIT_BACKEND``, ``BUDGET_BACKEND``, or ``IDEMPOTENCY_BACKEND``
    resolves to ``redis`` we lazy-import
    :mod:`app.middleware.redis_backends` (the ``redis`` package only
    needs to be installed for that path), construct a single shared
    :class:`redis.Redis` client from ``REDIS_URI``, and return concrete
    limiter / budget backends for the lifespan to place on ``app.state``.
    Only idempotency still uses the module-level configured singleton,
    because its Starlette middleware helper is not DI-wired yet.

    Misconfiguration (an unknown backend name, a missing
    ``REDIS_URI`` when one of the backends is ``redis``) raises
    :class:`RuntimeError` here so the deploy log carries the exact
    knob to fix instead of failing at first request.

    The in-memory idempotency cache is always reconstructed from
    ``IDEMPOTENCY_TTL_SECONDS`` because the module-level singleton
    initialises to the default constant; without this swap an
    operator-customised TTL would be silently ignored on the
    all-memory path.
    """

    rate_backend = cfg.rate_limit_backend.strip().lower() or "memory"
    budget_backend = cfg.budget_backend.strip().lower() or "memory"
    idempotency_backend = cfg.idempotency_backend.strip().lower() or "memory"
    if rate_backend not in _SUPPORTED_RATE_LIMIT_BACKENDS:
        raise RuntimeError(
            f"Unsupported RATE_LIMIT_BACKEND={rate_backend!r}; "
            f"expected one of {', '.join(_SUPPORTED_RATE_LIMIT_BACKENDS)}."
        )
    if budget_backend not in _SUPPORTED_BUDGET_BACKENDS:
        raise RuntimeError(
            f"Unsupported BUDGET_BACKEND={budget_backend!r}; "
            f"expected one of {', '.join(_SUPPORTED_BUDGET_BACKENDS)}."
        )
    if idempotency_backend not in _SUPPORTED_IDEMPOTENCY_BACKENDS:
        raise RuntimeError(
            f"Unsupported IDEMPOTENCY_BACKEND={idempotency_backend!r}; "
            f"expected one of {', '.join(_SUPPORTED_IDEMPOTENCY_BACKENDS)}."
        )

    worker_count = _declared_uvicorn_worker_count()
    if worker_count > 1 and (
        rate_backend != "redis"
        or budget_backend != "redis"
        or idempotency_backend != "redis"
        or not (cfg.redis_uri or "").strip()
    ):
        raise RuntimeError(
            "UVICORN_WORKERS / WEB_CONCURRENCY > 1 requires "
            "RATE_LIMIT_BACKEND=redis, BUDGET_BACKEND=redis, "
            "IDEMPOTENCY_BACKEND=redis, and a non-empty REDIS_URI so "
            "quota and dedupe stay coherent across workers."
        )

    rate_limiter: _rate_limit.RateLimitBackend = _rate_limit.InMemoryRateLimitBackend()
    budget_tracker: _budget.BudgetBackend = _budget.InMemoryBudgetBackend(
        monthly_cap=cfg.agent_budget_monthly_token_cap
    )

    # Warn when any memory-backed middleware runs in a multi-worker /
    # multi-instance environment: each worker maintains an independent
    # in-process counter, so rate limits and budget caps are multiplied by
    # the worker count and idempotency keys are invisible across processes.
    _memory_middleware: list[str] = []
    if rate_backend == "memory":
        _memory_middleware.append("RATE_LIMIT_BACKEND=memory")
    if budget_backend == "memory":
        _memory_middleware.append("BUDGET_BACKEND=memory")
    if idempotency_backend == "memory":
        _memory_middleware.append("IDEMPOTENCY_BACKEND=memory")

    if _memory_middleware:
        _is_multi, _reason = _is_multi_worker_or_multi_instance()
        if _is_multi:
            logger.warning(
                "Unsafe memory middleware backend(s) detected in a "
                "multi-worker / multi-instance environment (%s): %s. "
                "Rate limits and budget caps are per-process; idempotency "
                "keys are invisible across instances. "
                "Set IDEMPOTENCY_BACKEND=redis, RATE_LIMIT_BACKEND=redis, "
                "BUDGET_BACKEND=redis, and REDIS_URI=<dsn> for production.",
                _reason,
                ", ".join(_memory_middleware),
            )

    if (
        rate_backend == "memory"
        and budget_backend == "memory"
        and idempotency_backend == "memory"
    ):
        # No Redis client needed; build fresh in-memory backends for this app
        # instance and refresh the idempotency cache so the configured TTL
        # takes effect.
        _idempotency.configure_idempotency_backend(
            _idempotency.InMemoryIdempotencyBackend(
                ttl_seconds=cfg.idempotency_ttl_seconds
            )
        )
        return MiddlewareBackends(
            rate_limiter=rate_limiter,
            budget_tracker=budget_tracker,
        )

    if not cfg.redis_uri:
        raise RuntimeError(
            "RATE_LIMIT_BACKEND, BUDGET_BACKEND, or IDEMPOTENCY_BACKEND "
            "is set to 'redis' but REDIS_URI is empty; provide a "
            "reachable Redis connection string "
            "(e.g. redis://default:pass@host:6379/0) or set them all "
            "back to 'memory'."
        )

    # Local-imported so the ``redis`` package stays an opt-in dependency
    # for installs that never select the redis backend.
    from app.middleware import redis_backends

    client = redis_backends.build_redis_client(cfg.redis_uri)
    try:
        client.ping()
    except Exception as exc:  # noqa: BLE001 -- normalize redis client errors
        raise RuntimeError(
            "Redis middleware backend selected but REDIS_URI is not reachable."
        ) from exc
    if rate_backend == "redis":
        rate_limiter = redis_backends.RedisRateLimitBackend(client)
    if budget_backend == "redis":
        budget_tracker = redis_backends.RedisBudgetBackend(
            client, monthly_cap=cfg.agent_budget_monthly_token_cap
        )
    if idempotency_backend == "redis":
        _idempotency.configure_idempotency_backend(
            redis_backends.RedisIdempotencyBackend(
                client, ttl_seconds=cfg.idempotency_ttl_seconds
            )
        )
    else:
        # When at least one *other* backend is redis but idempotency is
        # memory, still rebuild the in-memory cache so the configured
        # TTL applies; the module default stays at 86400 otherwise.
        _idempotency.configure_idempotency_backend(
            _idempotency.InMemoryIdempotencyBackend(
                ttl_seconds=cfg.idempotency_ttl_seconds
            )
        )
    logger.info(
        "Middleware backends configured (rate_limit=%s, budget=%s, idempotency=%s).",
        rate_backend,
        budget_backend,
        idempotency_backend,
    )
    return MiddlewareBackends(
        rate_limiter=rate_limiter,
        budget_tracker=budget_tracker,
    )


def _is_multi_worker_or_multi_instance() -> tuple[bool, str]:
    """Return ``(True, reason)`` when the process appears to be running in a
    multi-worker or multi-instance environment.

    Three independent signals are checked:

    1. Any var in :data:`_PRODUCTION_SHAPED_ENV_VARS` is set — these are
       injected by hosted platforms (Vercel, Render, Fly, Railway,
       Kubernetes) that run multiple instances by design.
    2. ``WEB_CONCURRENCY`` env var is set to an integer > 1 — the
       canonical Uvicorn / Gunicorn multi-worker knob.
    3. ``UVICORN_WORKERS`` env var is set to an integer > 1 — the
       ``--workers`` flag exposed as an env var by some Uvicorn helpers.

    Non-integer values for the worker-count vars are silently ignored
    (treated as single-worker) so a mis-typed value does not prevent
    startup in local dev.

    Returns ``(False, "")`` when none of the signals are present.
    """

    for var in _PRODUCTION_SHAPED_ENV_VARS:
        if os.getenv(var):
            return True, f"production-shaped env var {var} is set"

    for var in ("WEB_CONCURRENCY", "UVICORN_WORKERS"):
        raw = os.getenv(var, "")
        try:
            count = int(raw)
        except (ValueError, TypeError):
            continue
        if count > 1:
            return True, f"{var}={count} indicates multiple workers"

    return False, ""


def _declared_uvicorn_worker_count() -> int:
    """Return process uvicorn/gunicorn worker count from env, or ``1``."""

    highest = 1
    for var in ("UVICORN_WORKERS", "WEB_CONCURRENCY"):
        raw = (os.getenv(var) or "").strip()
        try:
            count = int(raw)
        except ValueError:
            continue
        if count > highest:
            highest = count
    return highest


def _validate_memory_agent_backends(cfg: Settings) -> None:
    """Validate ``AGENT_*_BACKEND=memory`` is safe for the current environment.

    Four of the five catalog agents (``board-brief``, ``task-drafting``,
    ``task-estimation``, ``triage``) call ``langgraph.types.interrupt``
    to fetch FE-side data and resume on a follow-up request. With the
    ``memory`` backends the paused thread state lives in a single
    process's heap; on Vercel cold starts, autoscaling, or any
    multi-worker uvicorn deployment the resume request lands on a
    process that has no record of the thread and the run dead-ends
    with an error envelope the FE renders as "Board Copilot took too
    long".

    The default is still ``memory`` so local dev and the test suite
    (which run on a single long-lived process) keep working without
    spinning up Postgres. When the deploy looks production-shaped or
    multi-worker, a warning is logged so operators can catch the
    misconfiguration before interrupt-using agent runs dead-end.
    """

    checkpoint_resolved = resolve_agent_backend(
        cfg.agent_checkpoint_backend, agent_postgres_uri=cfg.agent_postgres_uri
    )
    store_resolved = resolve_agent_backend(
        cfg.agent_store_backend, agent_postgres_uri=cfg.agent_postgres_uri
    )
    checkpoint_is_memory = checkpoint_resolved == "memory"
    store_is_memory = store_resolved == "memory"

    if not (checkpoint_is_memory or store_is_memory):
        return

    is_multi, reason = _is_multi_worker_or_multi_instance()

    if is_multi:
        offenders: list[str] = []
        if checkpoint_is_memory:
            offenders.append("AGENT_CHECKPOINT_BACKEND=memory")
        if store_is_memory:
            offenders.append("AGENT_STORE_BACKEND=memory")
        logger.warning(
            "Unsafe memory backend(s) detected in a multi-worker / "
            "multi-instance environment (%s): %s. "
            "Interrupt-using agents cannot resume across processes. "
            "Set AGENT_CHECKPOINT_BACKEND=postgres, "
            "AGENT_STORE_BACKEND=postgres, and AGENT_POSTGRES_URI=<dsn> "
            "for production.",
            reason,
            ", ".join(offenders),
        )

    # Single-worker local dev / test -- log at debug to avoid noisy boots;
    # multi-instance misuse logs the warning above.
    logger.debug(
        "Agent persistence is using the in-process memory backend "
        "(checkpoint=%s, store=%s). Interrupt-using agents (board-brief, "
        "task-drafting, task-estimation, triage) cannot resume across "
        "processes; production deployments should set "
        "AGENT_POSTGRES_URI (the default `auto` then switches both "
        "backends to postgres) or set the backends explicitly.",
        checkpoint_resolved,
        store_resolved,
    )


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    jwt_source = _validate_settings(settings)
    # Stash the JWT-secret source for the readiness endpoint; using
    # ``app.state`` keeps the value scoped to this app instance rather
    # than a process-global (two TestClient sessions in the same
    # process cannot leak each other's resolved source).
    application.state.jwt_secret_source = jwt_source
    _propagate_langsmith_env(settings)
    configure_otel(settings=settings)
    configure_metrics(settings=settings)
    instrument_fastapi_app(application)
    metrics_app = make_metrics_app()
    if metrics_app is not None:
        application.mount("/metrics", metrics_app)
    middleware_backends = _configure_middleware_backends(settings)
    _warn_about_localhost_only_cors(settings)
    _validate_memory_agent_backends(settings)
    # ``_validate_settings`` already pings the repository as part of
    # the JWT-secret bootstrap; we do not re-ping here. If the bootstrap
    # path returned ``"ephemeral"`` the ping failed but we still call
    # ``ensure_schema`` for completeness -- it will surface the same
    # connection error and the lifespan will fail with a clear message.
    repository.ensure_schema()
    logger.info("Connected to %s successfully.", settings.database)
    async with AsyncExitStack() as stack:
        application.state.rate_limiter = middleware_backends.rate_limiter
        application.state.budget_tracker = middleware_backends.budget_tracker
        application.state.embeddings = make_embeddings(settings=settings)
        application.state.agent_runtime = await AgentRuntime.from_settings_async(
            settings, stack=stack
        )
        logger.info(
            "Agent runtime ready (checkpoint=%s, store=%s, agents=%d, "
            "recursion_limit=%d, langsmith=%s).",
            settings.agent_checkpoint_backend,
            settings.agent_store_backend,
            len(application.state.agent_runtime.registry),
            settings.agent_recursion_limit,
            "on" if settings.langsmith_tracing else "off",
        )
        yield


app = FastAPI(title="pulse", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    # Enumerate to drop the wildcard footgun (review F-31): browsers
    # reject ``Access-Control-Allow-Origin: *`` when credentials are
    # in play, but ``allow_methods=["*"]`` was still over-permissive.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Request-Id",
        "Idempotency-Key",
        "Accept",
    ],
    expose_headers=[
        "X-Request-Id",
        "Deprecation",
        "Sunset",
        "Retry-After",
        "Idempotent-Replay",
    ],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=unwrap_error_detail(exc.detail),
        headers=exc.headers,
    )


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    if isinstance(exc, AgentError):
        content = agent_app_error_content(exc)
    else:
        content = unwrap_error_detail(exc.detail)
    return JSONResponse(status_code=exc.status_code, content=content)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    # Log the full exception for operators; the response body stays
    # static so error class names and messages (which routinely contain
    # connection strings, auth failures, or stack-derived details) do
    # not leak to public callers.
    logger.exception("Unhandled error in request handler")
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error"},
    )


@app.get("/health", include_in_schema=False)
def legacy_health(request: Request) -> Dict[str, Any]:
    """Liveness probe at the legacy path.

    Returning 200 directly avoids the 308 trap that breaks naive load
    balancers (AWS ALB / GCP HTTP probes treat only 2xx as healthy).
    """

    return health.health(request.app.state.agent_runtime)


app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(projects.router, prefix="/api/v1/projects", tags=["projects"])
app.include_router(boards.router, prefix="/api/v1/boards", tags=["boards"])
app.include_router(tasks.router, prefix="/api/v1/tasks", tags=["tasks"])
app.include_router(agents.router, prefix="/api/v1/agents", tags=["agents"])
app.include_router(ai_router.router, prefix="/api/v1/ai", tags=["ai-v1"])
# Backwards-compatible alias for the legacy /api/ai prefix the shipped
# Board Copilot UI still posts to. Mirrors the same router so both
# prefixes serve identical routes; once the FE migrates we can drop it.
app.include_router(ai_router.router, prefix="/api/ai", include_in_schema=False)
app.include_router(health.router, prefix="/api/v1/health", tags=["health"])
