"""Long-term memory store factory.

LangGraph 1.x exposes two orthogonal persistence layers:

- :class:`langgraph.checkpoint.base.BaseCheckpointSaver` -- *short-term*,
  thread-scoped state used to resume a single conversation.
- :class:`langgraph.store.base.BaseStore` -- *long-term*, cross-thread,
  cross-user key/value memory used for facts, preferences and summaries.

This factory mirrors :mod:`app.agents.checkpointing` so the two layers stay
symmetric: agents always receive both via :meth:`BaseAgent.build`, and the
postgres backend uses the same async-setup pattern.

Backends supported today:
    - ``"none"`` -- no long-term memory.
    - ``"memory"`` -- in-process :class:`InMemoryStore`.
    - ``"postgres"`` -- :class:`langgraph.store.postgres.aio.AsyncPostgresStore`
      backed by ``langgraph-checkpoint-postgres``. See
      :func:`open_store` for the async-setup contract.
"""

from __future__ import annotations

from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional, Union

from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

from app.agents.checkpointing import (
    BACKEND_MEMORY,
    BACKEND_NONE,
    BACKEND_POSTGRES,
    enter_agent_postgres_pool,
    resolve_agent_postgres_uri,
)
from app.agents.errors import AgentConfigurationError

if TYPE_CHECKING:  # pragma: no cover - import-time only
    from app.config import Settings


SUPPORTED_BACKENDS: frozenset[str] = frozenset(
    {BACKEND_NONE, BACKEND_MEMORY, BACKEND_POSTGRES}
)


@dataclass(frozen=True)
class PostgresStoreSpec:
    """Deferred postgres store descriptor.

    Mirrors :class:`PostgresCheckpointerSpec` -- the sync factory returns
    this dataclass and the FastAPI lifespan resolves it asynchronously
    via :func:`open_store`.
    """

    conn_string: str


def build_store(
    backend: str,
    *,
    settings: Optional["Settings"] = None,
) -> Union[BaseStore, PostgresStoreSpec, None]:
    """Return a :class:`BaseStore` for ``backend``.

    Returns ``None`` when the long-term store is disabled, an
    :class:`InMemoryStore` for ``"memory"``, or a
    :class:`PostgresStoreSpec` for ``"postgres"`` (async setup deferred
    to :func:`open_store`).
    """

    normalized = (backend or "").strip().lower()
    if normalized in {"", BACKEND_NONE, "off", "disabled"}:
        return None
    if normalized == BACKEND_MEMORY:
        return InMemoryStore()
    if normalized == BACKEND_POSTGRES:
        if settings is None:
            from app.config import settings as default_settings

            settings = default_settings
        conn_string = resolve_agent_postgres_uri(
            settings, backend_env="AGENT_STORE_BACKEND"
        )
        return PostgresStoreSpec(conn_string=conn_string)
    raise AgentConfigurationError(
        f"Unsupported AGENT_STORE_BACKEND: {backend!r}",
        details={"supported": sorted(SUPPORTED_BACKENDS)},
    )


async def open_store(
    backend: str,
    *,
    stack: AsyncExitStack,
    settings: Optional["Settings"] = None,
    pool: Optional[Any] = None,
) -> Optional[BaseStore]:
    """Async counterpart of :func:`build_store`.

    For ``"none"`` and ``"memory"`` this is a thin wrapper around
    :func:`build_store`. For ``"postgres"`` it lazy-imports
    :class:`AsyncPostgresStore` and uses :func:`app.agents.checkpointing.
    enter_agent_postgres_pool` unless ``pool`` is already supplied.

    When ``pool`` is passed, the caller must have registered it on ``stack``.
    :meth:`AgentRuntime.from_settings_async` shares one pool between the
    saver and the store when both use Postgres with the same DSN.
    """

    spec = build_store(backend, settings=settings)
    if not isinstance(spec, PostgresStoreSpec):
        return spec

    if settings is None:
        from app.config import settings as default_settings

        settings = default_settings

    if pool is None:
        pool = await enter_agent_postgres_pool(stack, spec.conn_string, settings)

    try:
        from langgraph.store.postgres.aio import AsyncPostgresStore
    except ImportError as exc:  # pragma: no cover - import guard
        raise RuntimeError(
            "langgraph-checkpoint-postgres is not installed; install with "
            '`pip install ".[postgres-agents]"` or set '
            "AGENT_STORE_BACKEND=memory"
        ) from exc

    store = AsyncPostgresStore(pool)
    await store.setup()
    return store
