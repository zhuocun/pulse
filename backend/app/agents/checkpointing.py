"""Checkpointer factory.

The agents runtime asks this module for a single checkpointer at startup. We
keep the supported backends explicit so adding e.g. ``sqlite`` is a one-line
change here -- agents themselves never have to know which backend is in use.

Backends supported today:
    - ``"none"`` -- no persistence; agents run statelessly.
    - ``"memory"`` -- in-process :class:`InMemorySaver`; survives within a
      single process, perfect for local dev and tests.
    - ``"postgres"`` -- :class:`langgraph.checkpoint.postgres.aio.AsyncPostgresSaver`
      backed by ``langgraph-checkpoint-postgres``. Requires async setup, so
      :func:`build_checkpointer` returns a :class:`PostgresCheckpointerSpec`
      that the FastAPI lifespan resolves via :func:`open_checkpointer` on
      its :class:`contextlib.AsyncExitStack`. When the store uses Postgres
      with the same resolved DSN, :meth:`AgentRuntime.from_settings_async`
      registers a single shared :class:`~psycopg_pool.AsyncConnectionPool`
      via :func:`enter_agent_postgres_pool` for both layers.

Future backends (not implemented yet, but this is where they plug in):
    - ``"sqlite"`` -- ``langgraph.checkpoint.sqlite.SqliteSaver``.
"""

from __future__ import annotations

from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional, Union

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from app.agents.errors import AgentConfigurationError

if TYPE_CHECKING:  # pragma: no cover - import-time only
    from app.config import Settings


BACKEND_NONE = "none"
BACKEND_MEMORY = "memory"
BACKEND_POSTGRES = "postgres"
BACKEND_AUTO = "auto"

SUPPORTED_BACKENDS: frozenset[str] = frozenset(
    {BACKEND_NONE, BACKEND_MEMORY, BACKEND_POSTGRES}
)


def resolve_agent_backend(raw: str, *, agent_postgres_uri: str) -> str:
    """Resolve the ``auto`` agent-backend sentinel to a concrete value.

    The 5-person quickstart path lets an operator drop both
    ``AGENT_CHECKPOINT_BACKEND`` and ``AGENT_STORE_BACKEND`` -- the
    dataclass default is now ``"auto"`` -- and only set
    ``AGENT_POSTGRES_URI`` to get persistent agent state. This helper
    centralises the auto-detect rule so every call site (the lifespan
    guards, the factories, the readiness payload) sees the same answer.

    Rules:
        * ``"auto"`` (case-insensitive, leading / trailing whitespace
          tolerated) + non-empty stripped ``agent_postgres_uri`` →
          ``"postgres"``.
        * ``"auto"`` + empty / whitespace-only ``agent_postgres_uri`` →
          ``"memory"``.
        * Any other value is returned unchanged (with its original
          spelling preserved) so explicit ``"memory"`` / ``"postgres"``
          / ``"none"`` (and any future backend name) keep their
          semantics for downstream consumers that match them verbatim.

    Only the ``auto`` sentinel is normalized here; the factories
    (:func:`build_checkpointer` / :func:`build_store`) still apply
    ``.strip().lower()`` before dispatching on the concrete backend
    name, so case / whitespace tolerance for explicit values stays in
    one place. This split keeps the resolver's contract narrow: it
    only translates the sentinel, never silently rewrites values that
    callers may want to compare against verbatim.

    Only ``AGENT_POSTGRES_URI`` participates in the auto-detect.
    ``POSTGRES_URI`` is intentionally excluded -- it may exist for an
    unrelated application Postgres that should not be claimed by
    LangGraph behind the operator's back.
    """

    normalized = (raw or "").strip().lower()
    if normalized != BACKEND_AUTO:
        # Preserve the caller's exact spelling for explicit values so
        # downstream code that matches against the raw string (e.g.
        # ``runtime.checkpointer is None`` only when ``"postgres"``)
        # still sees what the operator configured.
        return raw
    if agent_postgres_uri and agent_postgres_uri.strip():
        return BACKEND_POSTGRES
    return BACKEND_MEMORY


@dataclass(frozen=True)
class PostgresCheckpointerSpec:
    """Deferred postgres checkpointer descriptor.

    The sync :func:`build_checkpointer` factory cannot construct an
    ``AsyncPostgresSaver`` (it requires an async context + ``await
    setup()``), so it returns this spec instead. The FastAPI lifespan
    later passes it to :func:`open_checkpointer`, which enters the saver
    on a shared :class:`contextlib.AsyncExitStack`.
    """

    conn_string: str


def resolve_agent_postgres_uri(settings: "Settings", *, backend_env: str) -> str:
    """Resolve the postgres connection string for an agent backend.

    ``backend_env`` is the env-var name the caller is configuring
    (``"AGENT_CHECKPOINT_BACKEND"`` or ``"AGENT_STORE_BACKEND"``); it is
    interpolated into the failure message so operators see the correct
    knob to set, not the wrong one.

    Priority order (matches the architecture-review F-1 design):

    1. ``settings.agent_postgres_uri`` -- the agent-specific override.
    2. ``settings.postgres_uri`` -- the shared application Postgres URI.
    3. A deterministic keyword string built from the discrete
       ``postgres_user`` / ``postgres_host`` / ``postgres_database`` /
       ``postgres_password`` / ``postgres_port`` / ``postgres_ssl``
       settings. Empty values are skipped so the string isn't malformed.

    The keyword string field order is fixed: ``user host dbname password
    port`` plus ``sslmode=require`` when ``postgres_ssl`` is set. This
    ordering is asserted by the test suite so changing it is a breaking
    change for downstream callers.

    Raises :class:`AgentConfigurationError` when nothing resolves.
    """

    if settings.agent_postgres_uri:
        return settings.agent_postgres_uri
    if settings.postgres_uri:
        return settings.postgres_uri

    # Deterministic field order: user, host, dbname, password, port, sslmode.
    parts: list[str] = []
    if settings.postgres_user:
        parts.append(f"user={settings.postgres_user}")
    if settings.postgres_host:
        parts.append(f"host={settings.postgres_host}")
    if settings.postgres_database:
        parts.append(f"dbname={settings.postgres_database}")
    if settings.postgres_password:
        parts.append(f"password={settings.postgres_password}")
    if settings.postgres_port:
        parts.append(f"port={settings.postgres_port}")
    if settings.postgres_ssl:
        parts.append("sslmode=require")
    if parts:
        return " ".join(parts)

    raise AgentConfigurationError(
        f"{backend_env}=postgres requires AGENT_POSTGRES_URI or "
        "POSTGRES_URI to be set",
        details={"backend": "postgres"},
    )


# Backward-compatible alias (tests and older docs reference the private name).
_resolve_agent_postgres_uri = resolve_agent_postgres_uri


def build_checkpointer(
    backend: str,
    *,
    settings: Optional["Settings"] = None,
) -> Union[BaseCheckpointSaver, PostgresCheckpointerSpec, None]:
    """Return a checkpointer for ``backend``.

    Returns ``None`` when persistence is disabled, an
    :class:`InMemorySaver` for the ``"memory"`` backend, or a
    :class:`PostgresCheckpointerSpec` for ``"postgres"`` (async setup is
    deferred to :func:`open_checkpointer`).

    Raises :class:`AgentConfigurationError` for unknown backends so a typo
    in ``AGENT_CHECKPOINT_BACKEND`` fails loudly at startup rather than
    silently falling back to no persistence.
    """

    normalized = (backend or "").strip().lower()
    if normalized == BACKEND_AUTO:
        if settings is None:
            from app.config import settings as default_settings

            settings = default_settings
        normalized = resolve_agent_backend(
            normalized, agent_postgres_uri=settings.agent_postgres_uri
        )
    if normalized in {"", BACKEND_NONE, "off", "disabled"}:
        return None
    if normalized == BACKEND_MEMORY:
        return InMemorySaver()
    if normalized == BACKEND_POSTGRES:
        if settings is None:
            from app.config import settings as default_settings

            settings = default_settings
        conn_string = resolve_agent_postgres_uri(
            settings, backend_env="AGENT_CHECKPOINT_BACKEND"
        )
        return PostgresCheckpointerSpec(conn_string=conn_string)
    raise AgentConfigurationError(
        f"Unsupported AGENT_CHECKPOINT_BACKEND: {backend!r}",
        details={"supported": sorted(SUPPORTED_BACKENDS)},
    )


async def enter_agent_postgres_pool(
    stack: AsyncExitStack,
    conn_string: str,
    settings: "Settings",
) -> Any:
    """Open an :class:`~psycopg_pool.AsyncConnectionPool` and register it on
    ``stack``.

    Shared by :func:`open_checkpointer`, :func:`app.agents.stores.open_store`,
    and :meth:`AgentRuntime.from_settings_async` when both persistence layers
    use Postgres with the same resolved connection string — then the pool is
    entered exactly once for the process/lifespan stack.
    """

    try:
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "langgraph-checkpoint-postgres is not installed; install with "
            '`pip install ".[postgres-agents]"` or set agent persistence '
            "backends to memory/none."
        ) from exc

    pool = AsyncConnectionPool(
        conninfo=conn_string,
        min_size=1,
        max_size=settings.agent_pg_pool_size,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        # Hosted Postgres providers can close idle SSL sockets between turns.
        check=AsyncConnectionPool.check_connection,
        open=False,
    )
    await stack.enter_async_context(pool)
    return pool


async def open_checkpointer(
    backend: str,
    *,
    stack: AsyncExitStack,
    settings: Optional["Settings"] = None,
    pool: Optional[Any] = None,
) -> Optional[BaseCheckpointSaver]:
    """Async counterpart of :func:`build_checkpointer`.

    For the ``"none"`` and ``"memory"`` backends this is a thin wrapper
    around :func:`build_checkpointer`. For ``"postgres"`` it lazy-imports
    :class:`AsyncPostgresSaver` and (unless ``pool`` is already provided)
    :func:`enter_agent_postgres_pool`, then returns the live saver.

    When ``pool`` is passed, the caller must have already registered it on
    ``stack`` (or otherwise owns its lifetime). :meth:`AgentRuntime.
    from_settings_async` passes a shared pool when both backends are Postgres
    and resolve to the same DSN.
    """

    spec = build_checkpointer(backend, settings=settings)
    if not isinstance(spec, PostgresCheckpointerSpec):
        return spec

    if settings is None:
        from app.config import settings as default_settings

        settings = default_settings

    if pool is None:
        pool = await enter_agent_postgres_pool(stack, spec.conn_string, settings)

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "langgraph-checkpoint-postgres is not installed; install with "
            '`pip install ".[postgres-agents]"` or set '
            "AGENT_CHECKPOINT_BACKEND=memory"
        ) from exc

    saver = AsyncPostgresSaver(pool)
    await saver.setup()
    return saver
