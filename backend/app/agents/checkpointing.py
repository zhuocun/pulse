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
      its :class:`contextlib.AsyncExitStack`.

Future backends (not implemented yet, but this is where they plug in):
    - ``"sqlite"`` -- ``langgraph.checkpoint.sqlite.SqliteSaver``.
"""

from __future__ import annotations

from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional, Union

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

from app.agents.errors import AgentConfigurationError

if TYPE_CHECKING:  # pragma: no cover - import-time only
    from app.config import Settings


BACKEND_NONE = "none"
BACKEND_MEMORY = "memory"
BACKEND_POSTGRES = "postgres"

SUPPORTED_BACKENDS: frozenset[str] = frozenset(
    {BACKEND_NONE, BACKEND_MEMORY, BACKEND_POSTGRES}
)


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


async def open_checkpointer(
    backend: str,
    *,
    stack: AsyncExitStack,
    settings: Optional["Settings"] = None,
) -> Optional[BaseCheckpointSaver]:
    """Async counterpart of :func:`build_checkpointer`.

    For the ``"none"`` and ``"memory"`` backends this is a thin wrapper
    around :func:`build_checkpointer`. For ``"postgres"`` it lazy-imports
    :class:`AsyncPostgresSaver`, enters its ``from_conn_string`` async
    context manager on the supplied :class:`contextlib.AsyncExitStack`,
    awaits ``setup()`` exactly once, and returns the live saver. The
    stack guarantees the connection is closed when the lifespan exits.
    """

    spec = build_checkpointer(backend, settings=settings)
    if not isinstance(spec, PostgresCheckpointerSpec):
        return spec

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "langgraph-checkpoint-postgres is not installed; install with "
            '`pip install ".[postgres-agents]"` or set '
            "AGENT_CHECKPOINT_BACKEND=memory"
        ) from exc

    # TODO(perf): swap the single-connection saver for an AsyncConnectionPool
    # once the runtime exposes a process-wide pool config.
    cm = AsyncPostgresSaver.from_conn_string(spec.conn_string)
    saver = await stack.enter_async_context(cm)
    await saver.setup()
    return saver
