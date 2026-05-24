from __future__ import annotations

from collections.abc import Callable
from dataclasses import Field, dataclass, field
import os
import secrets

from dotenv import load_dotenv


load_dotenv()


def _resolve_jwt_secret() -> str:
    """Return the configured JWT secret, or generate an ephemeral one.

    When UUID is unset the server starts with a random secret so it
    remains functional. Tokens will not survive a restart; a warning is
    emitted by _validate_settings so operators notice.
    """
    raw = (os.getenv("UUID") or "").strip()
    return raw if raw else secrets.token_hex(32)


def _env_value(name: str, default: str) -> str:
    """Read ``name`` from the environment.

    Treats an unset variable and an empty string identically -- operators
    routinely template ``FOO=`` in CI configs and expect the documented
    default to apply rather than crash a typed parser.
    """

    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw


def env_bool(name: str, default: str = "false") -> bool:
    return _env_value(name, default).strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: str) -> int:
    value = _env_value(name, default)
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def env_positive_int(name: str, default: str) -> int:
    value = env_int(name, default)
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def env_float(name: str, default: str) -> float:
    value = _env_value(name, default)
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a float") from exc


def env_csv(name: str, default: str = "") -> tuple[str, ...]:
    raw = _env_value(name, default)
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _env_str_field(name: str, default: str) -> Field[str]:
    return field(default_factory=lambda: _env_value(name, default))


def _env_lower_str_field(name: str, default: str) -> Field[str]:
    return field(default_factory=lambda: _env_value(name, default).strip().lower())


def _env_bool_field(name: str, default: str = "false") -> Field[bool]:
    return field(default_factory=lambda: env_bool(name, default))


def _env_int_field(name: str, default: str) -> Field[int]:
    return field(default_factory=lambda: env_int(name, default))


def _env_positive_int_field(name: str, default: str) -> Field[int]:
    return field(default_factory=lambda: env_positive_int(name, default))


def _env_float_field(name: str, default: str) -> Field[float]:
    return field(default_factory=lambda: env_float(name, default))


def _env_csv_field(name: str, default: str = "") -> Field[tuple[str, ...]]:
    return field(default_factory=lambda: env_csv(name, default))


def _env_dict_field(
    name: str,
    parser: Callable[[str], dict[str, str]],
) -> Field[dict[str, str]]:
    return field(default_factory=lambda: parser(_env_value(name, "")))


def parse_project_chat_model_map(raw: str) -> dict[str, str]:
    """Parse ``AGENT_PROJECT_CHAT_MODEL_MAP`` — comma-separated ``project_id:model_id`` segments."""

    out: dict[str, str] = {}
    for segment in raw.split(","):
        segment = segment.strip()
        if not segment or ":" not in segment:
            continue
        left, right = segment.split(":", 1)
        project_id, model_id = left.strip(), right.strip()
        if project_id and model_id:
            out[project_id] = model_id
    return out


@dataclass(frozen=True)
class Settings:
    database: str = _env_str_field("DATABASE", "mongoDB")
    mongo_uri: str = _env_str_field("MONGO_URI", "mongodb://localhost:27017/jira")
    mongo_db: str = _env_str_field("MONGO_DB", "jira")
    # Postgres settings retained for the *agent* checkpoint/store backends
    # (langgraph), which are independent of the application data store
    # (now Mongo-only).  ``DATABASE`` only accepts ``mongoDB`` after the
    # DDB/PG application repositories were removed; the postgres_* fields
    # below are read by ``app.agents.checkpointing``.
    postgres_uri: str = _env_str_field("POSTGRES_URI", "")
    postgres_user: str = _env_str_field("POSTGRES_USER", "")
    postgres_host: str = _env_str_field("POSTGRES_HOST", "localhost")
    postgres_database: str = _env_str_field("POSTGRES_DATABASE", "jira")
    postgres_password: str = _env_str_field("POSTGRES_PASSWORD", "")
    postgres_port: int = _env_int_field("POSTGRES_PORT", "5432")
    postgres_ssl: bool = _env_bool_field("POSTGRES_SSL")
    agent_postgres_uri: str = _env_str_field("AGENT_POSTGRES_URI", "")
    agent_pg_pool_size: int = _env_positive_int_field("AGENT_PG_POOL_SIZE", "10")
    jwt_secret: str = field(default_factory=_resolve_jwt_secret)
    jwt_expires_seconds: int = _env_int_field("JWT_EXPIRES_SECONDS", "86400")
    jwt_ai_proxy_expires_seconds: int = _env_int_field(
        "JWT_AI_PROXY_EXPIRES_SECONDS", "3600"
    )
    cors_origins: tuple[str, ...] = _env_csv_field(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,"
        "https://pulse-react-app.vercel.app",
    )
    cors_origin_regex: str = _env_str_field(
        "CORS_ORIGIN_REGEX",
        r"^https://pulse-react-app(-[a-z0-9-]+)?\.vercel\.app$",
    )
    port: int = _env_int_field("PORT", "8000")
    # ``auto`` resolves to ``postgres`` when ``AGENT_POSTGRES_URI`` is set
    # and to ``memory`` otherwise, so a 5-person operator only needs the
    # one DSN to flip both LangGraph persistence layers on. Explicit
    # ``memory`` / ``postgres`` / ``none`` values keep working unchanged
    # -- see :func:`app.agents.checkpointing.resolve_agent_backend`.
    agent_checkpoint_backend: str = _env_str_field(
        "AGENT_CHECKPOINT_BACKEND", "auto"
    )
    agent_store_backend: str = _env_str_field("AGENT_STORE_BACKEND", "auto")
    agent_default_thread_id: str = _env_str_field("AGENT_DEFAULT_THREAD_ID", "default")
    agent_recursion_limit: int = _env_positive_int_field(
        "AGENT_RECURSION_LIMIT", "25"
    )
    agent_request_timeout_seconds: int = _env_positive_int_field(
        "AGENT_REQUEST_TIMEOUT_SECONDS", "120"
    )
    agent_default_autonomy: str = _env_str_field("AGENT_DEFAULT_AUTONOMY", "plan")
    agent_disabled_project_ids: tuple[str, ...] = _env_csv_field(
        "AGENT_DISABLED_PROJECT_IDS"
    )
    agent_budget_monthly_token_cap: int = _env_positive_int_field(
        "AGENT_BUDGET_MONTHLY_TOKEN_CAP", "1000000"
    )
    # Selects the rate-limit / budget / idempotency backend. ``memory``
    # keeps the process-local dicts the test suite and single-process
    # dev rely on; ``redis`` swaps to the shared-store implementations
    # in ``app/middleware/redis_backends.py`` so multi-worker /
    # serverless deploys enforce a single org-wide cap and dedup state
    # rather than ``workers x``.
    rate_limit_backend: str = _env_str_field("RATE_LIMIT_BACKEND", "memory")
    budget_backend: str = _env_str_field("BUDGET_BACKEND", "memory")
    idempotency_backend: str = _env_str_field("IDEMPOTENCY_BACKEND", "memory")
    idempotency_ttl_seconds: int = _env_positive_int_field(
        "IDEMPOTENCY_TTL_SECONDS", "86400"
    )
    redis_uri: str = _env_str_field("REDIS_URI", "")
    agent_chat_model_provider: str = _env_str_field(
        "AGENT_CHAT_MODEL_PROVIDER", "auto"
    )
    # none | auto — auto enables a second provider when credentials exist.
    agent_chat_model_failover: str = _env_lower_str_field(
        "AGENT_CHAT_MODEL_FAILOVER", "auto"
    )
    agent_chat_model_id: str = _env_str_field("AGENT_CHAT_MODEL_ID", "")
    agent_chat_model_temperature: float = _env_float_field(
        "AGENT_CHAT_MODEL_TEMPERATURE", "0.2"
    )
    agent_chat_model_max_retries: int = field(
        default_factory=lambda: env_int("AGENT_CHAT_MODEL_MAX_RETRIES", "2")
    )
    agent_chat_model_timeout_seconds: float = field(
        default_factory=lambda: env_float("AGENT_CHAT_MODEL_TIMEOUT_SECONDS", "30.0")
    )
    # Comma-separated list of chat-model ids that callers may request via the
    # ``X-Pulse-Model`` request header.  Empty (the default) disables the
    # header-based override entirely; the request header is then ignored.
    # When non-empty, only ids in this list are accepted; any other value
    # surfaces as a 400 ``unsupported_chat_model`` error.  This is the
    # whitelist that makes per-request model routing safe in production.
    agent_chat_model_allowlist: tuple[str, ...] = _env_csv_field(
        "AGENT_CHAT_MODEL_ALLOWLIST", ""
    )
    anthropic_api_key: str = _env_str_field("ANTHROPIC_API_KEY", "")
    openai_api_key: str = _env_str_field("OPENAI_API_KEY", "")
    # Embeddings provider. Selection mirrors AGENT_CHAT_MODEL_PROVIDER.
    # ``auto`` picks OpenAI if OPENAI_API_KEY is set (Anthropic has no
    # embeddings API), and the deterministic SHA-256 stub otherwise.
    # Explicit values (``openai`` / ``stub``) skip the auto-detect.
    embeddings_provider: str = _env_str_field("EMBEDDINGS_PROVIDER", "auto")
    embeddings_model_id: str = _env_str_field("EMBEDDINGS_MODEL_ID", "")
    # Production should set 512+ for real semantic quality; stub ignores this.
    embeddings_dimensions: int = _env_int_field("EMBEDDINGS_DIMENSIONS", "16")
    langsmith_tracing: bool = _env_bool_field("LANGSMITH_TRACING")
    langsmith_project: str = _env_str_field("LANGSMITH_PROJECT", "")
    # Vendor-neutral observability (OpenTelemetry + Prometheus). Both
    # are opt-in so the dev / test paths and slim installs without the
    # ``[observability]`` extra stay free of the dependency cost.
    # ``OTEL_EXPORTER_OTLP_ENDPOINT`` empty falls back to
    # ``ConsoleSpanExporter`` -- useful for local dev without a
    # collector running.
    otel_tracing: bool = _env_bool_field("OTEL_TRACING")
    otel_service_name: str = _env_str_field("OTEL_SERVICE_NAME", "pulse-server")
    otel_exporter_otlp_endpoint: str = _env_str_field(
        "OTEL_EXPORTER_OTLP_ENDPOINT", ""
    )
    prometheus_metrics: bool = _env_bool_field("PROMETHEUS_METRICS")
    # When true with Postgres + pgvector, neighbours augment estimation/search.
    agent_vector_search_enabled: bool = _env_bool_field("AGENT_VECTOR_SEARCH_ENABLED")
    agent_vector_dimensions: int = _env_int_field("AGENT_VECTOR_DIMENSIONS", "16")
    # ``project_id:model_id`` pairs; model ids must also appear in
    # ``AGENT_CHAT_MODEL_ALLOWLIST`` when that allowlist is non-empty.
    agent_project_chat_model_map: dict[str, str] = _env_dict_field(
        "AGENT_PROJECT_CHAT_MODEL_MAP",
        parse_project_chat_model_map,
    )


settings = Settings()
