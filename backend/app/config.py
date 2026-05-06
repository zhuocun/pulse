from dataclasses import dataclass
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


_DEFAULT_JWT_SECRET: str = _resolve_jwt_secret()


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


@dataclass(frozen=True)
class Settings:
    database: str = os.getenv("DATABASE", "mongoDB")
    mongo_uri: str = os.getenv("MONGO_URI", "mongodb://localhost:27017/jira")
    mongo_db: str = os.getenv("MONGO_DB", "jira")
    aws_region: str = os.getenv("AWS_REGION", "us-east-1")
    dynamodb_endpoint_url: str = os.getenv("DYNAMODB_ENDPOINT_URL", "")
    dynamodb_table_prefix: str = os.getenv("DYNAMODB_TABLE_PREFIX", "")
    postgres_uri: str = os.getenv("POSTGRES_URI", "")
    postgres_user: str = os.getenv("POSTGRES_USER", "")
    postgres_host: str = os.getenv("POSTGRES_HOST", "localhost")
    postgres_database: str = os.getenv("POSTGRES_DATABASE", "jira")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "")
    postgres_port: int = env_int("POSTGRES_PORT", "5432")
    postgres_ssl: bool = env_bool("POSTGRES_SSL")
    agent_postgres_uri: str = os.getenv("AGENT_POSTGRES_URI", "")
    jwt_secret: str = _DEFAULT_JWT_SECRET
    jwt_expires_seconds: int = env_int("JWT_EXPIRES_SECONDS", "86400")
    cors_origins: tuple[str, ...] = env_csv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,https://pulse-react-app.vercel.app",
    )
    cors_origin_regex: str = os.getenv(
        "CORS_ORIGIN_REGEX",
        r"^https://pulse-react-app(-[a-z0-9-]+)?\.vercel\.app$",
    )
    port: int = env_int("PORT", "8000")
    agent_checkpoint_backend: str = os.getenv("AGENT_CHECKPOINT_BACKEND", "memory")
    agent_store_backend: str = os.getenv("AGENT_STORE_BACKEND", "memory")
    agent_default_thread_id: str = os.getenv("AGENT_DEFAULT_THREAD_ID", "default")
    agent_recursion_limit: int = env_positive_int("AGENT_RECURSION_LIMIT", "25")
    agent_request_timeout_seconds: int = env_positive_int(
        "AGENT_REQUEST_TIMEOUT_SECONDS", "120"
    )
    agent_default_autonomy: str = os.getenv("AGENT_DEFAULT_AUTONOMY", "plan")
    agent_disabled_project_ids: tuple[str, ...] = env_csv(
        "AGENT_DISABLED_PROJECT_IDS"
    )
    agent_budget_monthly_token_cap: int = env_positive_int(
        "AGENT_BUDGET_MONTHLY_TOKEN_CAP", "1000000"
    )
    # Selects the rate-limit / budget / idempotency backend. ``memory``
    # keeps the process-local dicts the test suite and single-process
    # dev rely on; ``redis`` swaps to the shared-store implementations
    # in ``app/middleware/redis_backends.py`` so multi-worker /
    # serverless deploys enforce a single org-wide cap and dedup state
    # rather than ``workers x``.
    rate_limit_backend: str = os.getenv("RATE_LIMIT_BACKEND", "memory")
    budget_backend: str = os.getenv("BUDGET_BACKEND", "memory")
    idempotency_backend: str = os.getenv("IDEMPOTENCY_BACKEND", "memory")
    idempotency_ttl_seconds: int = env_positive_int(
        "IDEMPOTENCY_TTL_SECONDS", "86400"
    )
    redis_uri: str = os.getenv("REDIS_URI", "")
    agent_chat_model_provider: str = os.getenv("AGENT_CHAT_MODEL_PROVIDER", "auto")
    agent_chat_model_id: str = os.getenv("AGENT_CHAT_MODEL_ID", "")
    agent_chat_model_temperature: float = env_float(
        "AGENT_CHAT_MODEL_TEMPERATURE", "0.2"
    )
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    # Embeddings provider. Selection mirrors AGENT_CHAT_MODEL_PROVIDER.
    # ``auto`` picks OpenAI if OPENAI_API_KEY is set (Anthropic has no
    # embeddings API), and the deterministic SHA-256 stub otherwise.
    # Explicit values (``openai`` / ``stub``) skip the auto-detect.
    embeddings_provider: str = os.getenv("EMBEDDINGS_PROVIDER", "auto")
    embeddings_model_id: str = os.getenv("EMBEDDINGS_MODEL_ID", "")
    # Production should set 512+ for real semantic quality; stub ignores this.
    embeddings_dimensions: int = env_int("EMBEDDINGS_DIMENSIONS", "16")
    langsmith_tracing: bool = env_bool("LANGSMITH_TRACING")
    langsmith_project: str = os.getenv("LANGSMITH_PROJECT", "")
    # Vendor-neutral observability (OpenTelemetry + Prometheus). Both
    # are opt-in so the dev / test paths and slim installs without the
    # ``[observability]`` extra stay free of the dependency cost.
    # ``OTEL_EXPORTER_OTLP_ENDPOINT`` empty falls back to
    # ``ConsoleSpanExporter`` -- useful for local dev without a
    # collector running.
    otel_tracing: bool = env_bool("OTEL_TRACING")
    otel_service_name: str = os.getenv("OTEL_SERVICE_NAME", "pulse-backend")
    otel_exporter_otlp_endpoint: str = os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", ""
    )
    prometheus_metrics: bool = env_bool("PROMETHEUS_METRICS")


settings = Settings()
