import asyncio
import json
import sys
import textwrap
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable, Optional

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.runtime import Runtime
from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore
from pydantic import BaseModel
from typing_extensions import TypedDict

from app import main
from app import security
from app.agents import (
    AgentAlreadyRegisteredError,
    AgentConfigurationError,
    AgentError,
    AgentExecutionError,
    AgentMetadata,
    AgentNotFoundError,
    AgentRecursionError,
    AgentRegistry,
    AgentRuntime,
    AgentState,
    BaseAgent,
    registry as global_registry,
)
from app.agents import catalog as agent_catalog
from app.agents.checkpointing import (
    SUPPORTED_BACKENDS as SUPPORTED_CHECKPOINT_BACKENDS,
    PostgresCheckpointerSpec,
    _resolve_agent_postgres_uri,
    build_checkpointer,
    open_checkpointer,
)
from app.agents.stores import (
    SUPPORTED_BACKENDS as SUPPORTED_STORE_BACKENDS,
    PostgresStoreSpec,
    build_store,
    open_store,
)
from app.config import Settings, env_positive_int, settings
from app.security import create_token


@dataclass
class EchoContext:
    suffix: str = "!"


class EchoState(TypedDict, total=False):
    text: str
    bumps: int


class TypedContext(TypedDict, total=False):
    suffix: str
    ignored: str


class ModelContext(BaseModel):
    suffix: str


class EchoAgent(BaseAgent):
    metadata = AgentMetadata(
        name="echo",
        description="Appends a suffix and counts bumps.",
        version="1.0.0",
        tags=("test", "echo"),
        recursion_limit=10,
        context_schema=EchoContext,
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def bump(state: EchoState, runtime: Runtime[EchoContext]) -> dict[str, Any]:
            ctx = runtime.context or EchoContext()
            return {
                "text": (state.get("text") or "") + ctx.suffix,
                "bumps": (state.get("bumps") or 0) + 1,
            }

        graph = StateGraph(EchoState, context_schema=EchoContext)
        graph.add_node("bump", bump)
        graph.add_edge(START, "bump")
        graph.add_edge("bump", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class PlainContext:
    __annotations__ = {"suffix": str}


class PlainContextAgent(EchoAgent):
    metadata = AgentMetadata(name="plain-context", context_schema=PlainContext)

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def bump(state: EchoState, runtime: Runtime[dict[str, str]]) -> dict[str, Any]:
            ctx = runtime.context or {"suffix": "!"}
            return {
                "text": (state.get("text") or "") + ctx["suffix"],
                "bumps": (state.get("bumps") or 0) + 1,
            }

        graph = StateGraph(EchoState, context_schema=PlainContext)
        graph.add_node("bump", bump)
        graph.add_edge(START, "bump")
        graph.add_edge("bump", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class ModelContextAgent(PlainContextAgent):
    metadata = AgentMetadata(name="model-context", context_schema=ModelContext)

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def bump(
            state: EchoState,
            runtime: Runtime[ModelContext],
        ) -> dict[str, Any]:
            ctx = runtime.context or ModelContext(suffix="!")
            return {
                "text": (state.get("text") or "") + ctx.suffix,
                "bumps": (state.get("bumps") or 0) + 1,
            }

        graph = StateGraph(EchoState, context_schema=ModelContext)
        graph.add_node("bump", bump)
        graph.add_edge(START, "bump")
        graph.add_edge("bump", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class UncoercibleContextAgent(EchoAgent):
    metadata = AgentMetadata(name="uncoercible-context", context_schema=int)


class StatelessAgent(EchoAgent):
    metadata = AgentMetadata(name="stateless")


class LoopState(TypedDict, total=False):
    count: int


class LoopAgent(BaseAgent):
    """Agent guaranteed to exceed its recursion limit -- used for guardrail tests."""

    metadata = AgentMetadata(name="loop", recursion_limit=3)

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def step(state: LoopState) -> dict[str, Any]:
            return {"count": (state.get("count") or 0) + 1}

        graph = StateGraph(LoopState)
        graph.add_node("step", step)
        graph.add_edge(START, "step")
        graph.add_edge("step", "step")
        return graph.compile(checkpointer=checkpointer, store=store)


class BoomAgent(BaseAgent):
    """Agent whose graph always raises, to exercise execution error mapping."""

    metadata = AgentMetadata(name="boom")

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def explode(state: EchoState) -> dict[str, Any]:
            raise RuntimeError("kaboom")

        graph = StateGraph(EchoState)
        graph.add_node("explode", explode)
        graph.add_edge(START, "explode")
        graph.add_edge("explode", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class MissingMetadataAgent(BaseAgent):
    metadata = None  # type: ignore[assignment]

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        raise NotImplementedError


@pytest.fixture()
def fresh_registry() -> Iterable[AgentRegistry]:
    yield AgentRegistry()


@pytest.fixture()
def echo_in_global_registry() -> Iterable[EchoAgent]:
    agent = EchoAgent()
    global_registry.register(agent)
    try:
        yield agent
    finally:
        global_registry.unregister(agent.name)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("agent-user")
    return {"Authorization": f"Bearer {token}"}


def test_agent_metadata_as_dict_default() -> None:
    meta = AgentMetadata(name="x")
    payload = meta.as_dict()
    assert payload == {
        "name": "x",
        "description": "",
        "version": "0.1.0",
        "status": "active",
        "rate_limit": {"per_minute": 60, "per_hour": 600},
        "allowed_autonomy": ["suggest", "plan"],
        "tools": [],
    }


def test_agent_metadata_as_dict_omits_internal_fields() -> None:
    """``tags`` / ``recursion_limit`` / ``context_schema`` stay on the
    dataclass for the runtime + router but are not emitted on the wire
    -- the FE ignores them."""

    meta = AgentMetadata(
        name="x",
        context_schema=EchoContext,
        tags=("a",),
        recursion_limit=7,
    )
    payload = meta.as_dict()
    assert "context_schema" not in payload
    assert "tags" not in payload
    assert "recursion_limit" not in payload
    # The fields themselves are still present on the dataclass, since the
    # runtime clamps recursion_limit and the router reads context_schema.
    assert meta.context_schema is EchoContext
    assert meta.tags == ("a",)
    assert meta.recursion_limit == 7


def test_agent_metadata_as_dict_exposes_v21_fields() -> None:
    meta = AgentMetadata(
        name="x",
        status="shadow",
        rate_limit=(5, 60),
        allowed_autonomy=("suggest", "auto"),
        tools=("fe.boardSnapshot", "be.summarize"),
    )
    payload = meta.as_dict()
    assert payload["status"] == "shadow"
    assert payload["rate_limit"] == {"per_minute": 5, "per_hour": 60}
    assert payload["allowed_autonomy"] == ["suggest", "auto"]
    assert payload["tools"] == ["fe.boardSnapshot", "be.summarize"]


def test_agent_metadata_rejects_invalid_identity_and_limits() -> None:
    with pytest.raises(ValueError, match="Agent name"):
        AgentMetadata(name="")
    with pytest.raises(ValueError, match="Agent name"):
        AgentMetadata(name="bad/name")
    with pytest.raises(ValueError, match="recursion_limit"):
        AgentMetadata(name="ok", recursion_limit=0)
    with pytest.raises(ValueError, match="status"):
        AgentMetadata(name="ok", status="ghost")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="rate_limit"):
        AgentMetadata(name="ok", rate_limit=(0, 600))
    with pytest.raises(ValueError, match="allowed_autonomy"):
        AgentMetadata(
            name="ok",
            allowed_autonomy=("rogue",),  # type: ignore[arg-type]
        )


def test_base_agent_requires_metadata() -> None:
    with pytest.raises(TypeError):
        MissingMetadataAgent()


def test_agent_state_uses_add_messages_reducer() -> None:
    from typing import get_type_hints

    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    assert "metadata" in hints


def test_base_agent_compile_is_memoized_and_force_rebuilds() -> None:
    agent = EchoAgent()
    first = agent.compile()
    second = agent.compile()
    assert first is second
    third = agent.compile(force=True)
    assert third is not first


def test_base_agent_recompiles_for_different_persistence_backends() -> None:
    agent = EchoAgent()
    first = agent.compile(checkpointer=InMemorySaver())
    second = agent.compile(checkpointer=InMemorySaver())
    assert second is not first


def test_agent_runtime_reuses_compiled_graph_with_its_persistence_backends(
    fresh_registry: AgentRegistry,
) -> None:
    agent = EchoAgent()
    fresh_registry.register(agent)
    runtime = AgentRuntime(checkpointer=InMemorySaver(), registry=fresh_registry)

    runtime.invoke("echo", {"text": "a"})
    first = agent.compile(checkpointer=runtime.checkpointer, store=runtime.store)
    runtime.invoke("echo", {"text": "b"})

    assert (
        agent.compile(checkpointer=runtime.checkpointer, store=runtime.store) is first
    )


def test_base_agent_invoke_passes_context() -> None:
    agent = EchoAgent()
    sync_result = agent.invoke({"text": "hi"}, context=EchoContext(suffix="?"))
    assert sync_result["text"].endswith("?")
    async_result = asyncio.run(
        agent.ainvoke({"text": "yo"}, context=EchoContext(suffix="."))
    )
    assert async_result["text"] == "yo."


def test_base_agent_astream_yields_tuples() -> None:
    agent = EchoAgent()

    async def collect() -> list[Any]:
        events: list[Any] = []
        async for event in agent.astream({"text": "z"}, context=EchoContext()):
            events.append(event)
        return events

    events = asyncio.run(collect())
    assert events
    assert all(isinstance(item, tuple) and len(item) == 2 for item in events)


def test_registry_register_get_names_metadata_iteration_and_clear(
    fresh_registry: AgentRegistry,
) -> None:
    agent = EchoAgent()
    assert len(fresh_registry) == 0
    assert "echo" not in fresh_registry
    assert 123 not in fresh_registry  # type: ignore[operator]

    fresh_registry.register(agent)
    assert "echo" in fresh_registry
    assert fresh_registry.get("echo") is agent
    assert fresh_registry.names() == ["echo"]
    assert [m.name for m in fresh_registry.metadata()] == ["echo"]
    assert list(fresh_registry) == [agent]
    assert len(fresh_registry) == 1

    fresh_registry.clear()
    assert len(fresh_registry) == 0


def test_registry_duplicate_register_raises(fresh_registry: AgentRegistry) -> None:
    fresh_registry.register(EchoAgent())
    with pytest.raises(AgentAlreadyRegisteredError) as exc:
        fresh_registry.register(EchoAgent())
    assert exc.value.name == "echo"
    assert exc.value.status_code == HTTPStatus.CONFLICT


def test_registry_replace_overwrites(fresh_registry: AgentRegistry) -> None:
    first = EchoAgent()
    fresh_registry.register(first)
    second = EchoAgent()
    fresh_registry.register(second, replace=True)
    assert fresh_registry.get("echo") is second


def test_registry_unregister_missing_raises(fresh_registry: AgentRegistry) -> None:
    with pytest.raises(AgentNotFoundError) as exc:
        fresh_registry.unregister("missing")
    assert exc.value.status_code == HTTPStatus.NOT_FOUND


def test_registry_get_missing_raises(fresh_registry: AgentRegistry) -> None:
    with pytest.raises(AgentNotFoundError):
        fresh_registry.get("nope")


class _ShadowEchoAgent(BaseAgent):
    metadata = AgentMetadata(name="shadow-echo", status="shadow")

    def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
        from langgraph.graph import END, START, StateGraph

        from app.agents.state import AgentState

        graph = StateGraph(AgentState)
        graph.add_node("noop", lambda state: {"messages": []})
        graph.add_edge(START, "noop")
        graph.add_edge("noop", END)
        return graph.compile(checkpointer=checkpointer, store=store)


def test_set_chat_model_after_compile_logs_rebuild_warning(
    caplog: Any,
) -> None:
    """A test that injects a model AFTER first compile gets a debug log
    so the misuse is greppable."""

    import logging

    agent = EchoAgent()
    agent.compile()
    with caplog.at_level(logging.DEBUG, logger="app.agents.base"):
        agent.set_chat_model(object())
    assert any(
        "set_chat_model called on 'echo' after compile()" in r.message
        for r in caplog.records
    )


def test_set_chat_model_before_compile_is_silent(caplog: Any) -> None:
    """No warning when called before any compile (the canonical pattern)."""

    import logging

    agent = EchoAgent()
    with caplog.at_level(logging.DEBUG, logger="app.agents.base"):
        agent.set_chat_model(object())
    assert not any(
        "set_chat_model called on 'echo' after compile()" in r.message
        for r in caplog.records
    )


def test_registry_get_shadow_default_404s(fresh_registry: AgentRegistry) -> None:
    """``get(name)`` hides shadow agents so direct registry callers see the
    same surface as the public router (the policy lives in the registry)."""

    fresh_registry.register(_ShadowEchoAgent())
    with pytest.raises(AgentNotFoundError):
        fresh_registry.get("shadow-echo")


def test_registry_get_shadow_opt_in_returns(fresh_registry: AgentRegistry) -> None:
    """``include_shadow=True`` lets internal callers reach shadow agents."""

    agent = _ShadowEchoAgent()
    fresh_registry.register(agent)
    assert fresh_registry.get("shadow-echo", include_shadow=True) is agent


def test_registry_names_metadata_filter_shadow(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    fresh_registry.register(_ShadowEchoAgent())
    assert fresh_registry.names() == ["echo"]
    assert [m.name for m in fresh_registry.metadata()] == ["echo"]
    assert sorted(fresh_registry.names(include_shadow=True)) == [
        "echo",
        "shadow-echo",
    ]
    assert sorted(
        m.name for m in fresh_registry.metadata(include_shadow=True)
    ) == ["echo", "shadow-echo"]


def test_build_checkpointer_modes() -> None:
    assert build_checkpointer("none") is None
    assert build_checkpointer("") is None
    assert build_checkpointer("disabled") is None
    assert isinstance(build_checkpointer("memory"), InMemorySaver)
    with pytest.raises(AgentConfigurationError) as exc:
        build_checkpointer("redis")
    assert "redis" in exc.value.message
    assert exc.value.details == {"supported": sorted(SUPPORTED_CHECKPOINT_BACKENDS)}


def test_build_store_modes() -> None:
    assert build_store("none") is None
    assert build_store("") is None
    assert isinstance(build_store("memory"), InMemoryStore)
    with pytest.raises(AgentConfigurationError) as exc:
        build_store("redis")
    assert "redis" in exc.value.message
    assert exc.value.details == {"supported": sorted(SUPPORTED_STORE_BACKENDS)}


# ---------------------------------------------------------------------------
# Postgres backend (architecture-review F-1 / F-SC1).
# ---------------------------------------------------------------------------


class _FakeAsyncConnectionPool:
    """Minimal stand-in for ``psycopg_pool.AsyncConnectionPool``.

    Tracks whether ``open`` / ``close`` were called and exposes the
    ``conninfo`` so tests can assert the correct URI was threaded through.
    Supports both the explicit ``await pool.open()`` / ``pool.close()``
    lifecycle *and* use as an async context manager (enter_async_context).
    """

    def __init__(self, conninfo: str, **kwargs: Any) -> None:
        self.conninfo = conninfo
        self.kwargs = kwargs
        self.open_calls = 0
        self.close_calls = 0

    async def open(self) -> None:
        self.open_calls += 1

    async def close(self) -> None:
        self.close_calls += 1

    async def __aenter__(self) -> "_FakeAsyncConnectionPool":
        await self.open()
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()


class _FakeAsyncPostgresHandle:
    """Stand-in for ``AsyncPostgresSaver`` / ``AsyncPostgresStore``.

    Accepts either a pool (new pooled constructor path) or a plain
    ``conn_string`` string (legacy ``from_conn_string`` path) so that both
    production code and any backward-compatible tests continue to work.

    Exposes ``conn_string`` derived from the pool's ``conninfo`` so test
    assertions like ``saver.conn_string == "postgres://..."`` still pass.
    """

    def __init__(
        self, pool_or_conn_string: "Any" = None, *, conn_string: str = ""
    ) -> None:
        if isinstance(pool_or_conn_string, str):
            # Legacy from_conn_string path.
            self.conn_string = pool_or_conn_string
            self.pool: Optional[_FakeAsyncConnectionPool] = None
        elif pool_or_conn_string is not None:
            # New pooled constructor path: argument is a _FakeAsyncConnectionPool.
            self.pool = pool_or_conn_string
            self.conn_string = pool_or_conn_string.conninfo
        else:
            self.conn_string = conn_string
            self.pool = None
        self.setup_calls = 0

    async def setup(self) -> None:
        self.setup_calls += 1


def _install_fake_psycopg_pool_module(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch ``psycopg_pool`` and ``psycopg.rows`` into ``sys.modules``.

    Called alongside the postgres saver / store module installers so that
    the lazy ``from psycopg_pool import AsyncConnectionPool`` and
    ``from psycopg.rows import dict_row`` imports inside
    ``open_checkpointer`` / ``open_store`` resolve to test doubles rather
    than raising ``ImportError`` in environments without the real library.
    """

    fake_pool_module = ModuleType("psycopg_pool")
    fake_pool_module.AsyncConnectionPool = _FakeAsyncConnectionPool  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg_pool", fake_pool_module)

    # psycopg.rows.dict_row is imported lazily alongside the pool; stub it out
    # so tests that lack the real psycopg package don't fail on import.
    fake_psycopg_module = sys.modules.get("psycopg") or ModuleType("psycopg")
    fake_psycopg_rows_module = ModuleType("psycopg.rows")
    fake_psycopg_rows_module.dict_row = None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg", fake_psycopg_module)
    monkeypatch.setitem(sys.modules, "psycopg.rows", fake_psycopg_rows_module)


def _install_fake_postgres_saver_module(
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Any]:
    """Wire a fake ``langgraph.checkpoint.postgres.aio`` into ``sys.modules``.

    Also installs the ``psycopg_pool`` / ``psycopg.rows`` fakes so that the
    pooled constructor path inside ``open_checkpointer`` works without the
    real optional dependencies.

    Returns a dict the test can inspect after ``open_checkpointer`` runs:
    ``{"saver": _FakeAsyncPostgresHandle, "exited": bool}`` — ``exited``
    flips True when the pool's async context manager finalises (i.e. when
    the exit stack tears down).
    """

    _install_fake_psycopg_pool_module(monkeypatch)

    state: dict[str, Any] = {"saver": None, "exited": False}

    class _FakeSaverCls(_FakeAsyncPostgresHandle):
        """Callable fake for ``AsyncPostgresSaver(pool)``."""

        def __init__(self, pool_or_conn_string: Any = None) -> None:
            super().__init__(pool_or_conn_string)
            state["saver"] = self

    # Keep from_conn_string for backward-compat (no longer called by
    # production code but preserved so legacy test helpers still compile).
    @asynccontextmanager
    async def from_conn_string(conn_string: str):
        handle = _FakeSaverCls(conn_string)
        try:
            yield handle
        finally:
            state["exited"] = True

    _FakeSaverCls.from_conn_string = staticmethod(from_conn_string)  # type: ignore[attr-defined]

    fake_module = ModuleType("langgraph.checkpoint.postgres.aio")
    fake_module.AsyncPostgresSaver = _FakeSaverCls  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langgraph.checkpoint.postgres.aio", fake_module)

    # The production code uses enter_async_context(pool) which calls
    # pool.__aenter__ / __aexit__.  Flip exited when the pool closes.
    _orig_pool_exit = _FakeAsyncConnectionPool.__aexit__

    async def _patched_pool_exit(self: _FakeAsyncConnectionPool, *args: Any) -> None:
        await _orig_pool_exit(self, *args)
        state["exited"] = True

    monkeypatch.setattr(_FakeAsyncConnectionPool, "__aexit__", _patched_pool_exit)

    return state


def _install_fake_postgres_store_module(
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Any]:
    """Wire a fake ``langgraph.store.postgres.aio`` into ``sys.modules``.

    Also installs the ``psycopg_pool`` / ``psycopg.rows`` fakes (idempotent
    if ``_install_fake_postgres_saver_module`` was already called).
    """

    _install_fake_psycopg_pool_module(monkeypatch)

    state: dict[str, Any] = {"store": None, "exited": False}

    class _FakeStoreCls(_FakeAsyncPostgresHandle):
        """Callable fake for ``AsyncPostgresStore(pool)``."""

        def __init__(self, pool_or_conn_string: Any = None) -> None:
            super().__init__(pool_or_conn_string)
            state["store"] = self

    # Keep from_conn_string for backward-compat.
    @asynccontextmanager
    async def from_conn_string(conn_string: str):
        handle = _FakeStoreCls(conn_string)
        try:
            yield handle
        finally:
            state["exited"] = True

    _FakeStoreCls.from_conn_string = staticmethod(from_conn_string)  # type: ignore[attr-defined]

    fake_module = ModuleType("langgraph.store.postgres.aio")
    fake_module.AsyncPostgresStore = _FakeStoreCls  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langgraph.store.postgres.aio", fake_module)

    # Flip exited when the pool closes (mirrors the saver approach).
    _orig_pool_exit = _FakeAsyncConnectionPool.__aexit__

    async def _patched_pool_exit(self: _FakeAsyncConnectionPool, *args: Any) -> None:
        await _orig_pool_exit(self, *args)
        state["exited"] = True

    monkeypatch.setattr(_FakeAsyncConnectionPool, "__aexit__", _patched_pool_exit)

    return state


def test_build_checkpointer_returns_postgres_spec() -> None:
    cfg = Settings(agent_postgres_uri="postgres://x")
    spec = build_checkpointer("postgres", settings=cfg)
    assert spec == PostgresCheckpointerSpec(conn_string="postgres://x")


def test_build_store_returns_postgres_spec() -> None:
    cfg = Settings(agent_postgres_uri="postgres://x")
    spec = build_store("postgres", settings=cfg)
    assert spec == PostgresStoreSpec(conn_string="postgres://x")


def test_build_checkpointer_postgres_uses_default_settings_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``build_checkpointer("postgres")`` falls back to ``app.config.settings``."""

    from app import config as config_module

    monkeypatch.setattr(
        config_module,
        "settings",
        Settings(agent_postgres_uri="postgres://default-fallback"),
    )
    spec = build_checkpointer("postgres")
    assert isinstance(spec, PostgresCheckpointerSpec)
    assert spec.conn_string == "postgres://default-fallback"


def test_build_store_postgres_uses_default_settings_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import config as config_module

    monkeypatch.setattr(
        config_module,
        "settings",
        Settings(agent_postgres_uri="postgres://default-fallback"),
    )
    spec = build_store("postgres")
    assert isinstance(spec, PostgresStoreSpec)
    assert spec.conn_string == "postgres://default-fallback"


def test_open_checkpointer_postgres_enters_context_and_runs_setup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _install_fake_postgres_saver_module(monkeypatch)
    cfg = Settings(agent_postgres_uri="postgres://run-setup")

    async def run() -> Any:
        async with AsyncExitStack() as stack:
            saver = await open_checkpointer("postgres", stack=stack, settings=cfg)
            assert saver is state["saver"]
            assert saver.conn_string == "postgres://run-setup"
            assert saver.setup_calls == 1
            assert state["exited"] is False
            return saver

        # Stack has unwound; the fake context manager must have closed.

    saver = asyncio.run(run())
    assert state["exited"] is True
    assert saver.setup_calls == 1  # setup() still called exactly once


def test_open_store_postgres_enters_context_and_runs_setup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _install_fake_postgres_store_module(monkeypatch)
    cfg = Settings(agent_postgres_uri="postgres://run-setup")

    async def run() -> Any:
        async with AsyncExitStack() as stack:
            store = await open_store("postgres", stack=stack, settings=cfg)
            assert store is state["store"]
            assert store.conn_string == "postgres://run-setup"
            assert store.setup_calls == 1
            assert state["exited"] is False
            return store

    store = asyncio.run(run())
    assert state["exited"] is True
    assert store.setup_calls == 1


def test_open_checkpointer_passes_through_memory_backend() -> None:
    """``open_checkpointer`` is a thin wrapper for non-postgres backends."""

    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_checkpointer("memory", stack=stack)

    assert isinstance(asyncio.run(run()), InMemorySaver)


def test_open_store_passes_through_memory_backend() -> None:
    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_store("memory", stack=stack)

    assert isinstance(asyncio.run(run()), InMemoryStore)


def test_open_checkpointer_passes_through_none_backend() -> None:
    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_checkpointer("none", stack=stack)

    assert asyncio.run(run()) is None


def test_open_store_passes_through_none_backend() -> None:
    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_store("none", stack=stack)

    assert asyncio.run(run()) is None


def test_agent_postgres_uri_prefers_agent_specific_env() -> None:
    cfg = Settings(agent_postgres_uri="A", postgres_uri="B")
    assert _resolve_agent_postgres_uri(cfg, backend_env="postgres") == "A"


def test_agent_postgres_uri_falls_back_to_postgres_uri() -> None:
    cfg = Settings(agent_postgres_uri="", postgres_uri="B")
    assert _resolve_agent_postgres_uri(cfg, backend_env="postgres") == "B"


def test_agent_postgres_uri_builds_from_keywords() -> None:
    """Keyword string order is fixed: user, host, dbname, password, port, sslmode."""

    cfg = Settings(
        agent_postgres_uri="",
        postgres_uri="",
        postgres_user="jira",
        postgres_host="db.example.com",
        postgres_database="jira",
        postgres_password="secret",
        postgres_port=5433,
        postgres_ssl=True,
    )
    assert _resolve_agent_postgres_uri(cfg, backend_env="postgres") == (
        "user=jira host=db.example.com dbname=jira password=secret "
        "port=5433 sslmode=require"
    )


def test_agent_postgres_uri_omits_blank_keyword_fragments() -> None:
    """Empty discrete fields must be skipped so the kw string isn't malformed."""

    cfg = Settings(
        agent_postgres_uri="",
        postgres_uri="",
        postgres_user="jira",
        postgres_host="db.example.com",
        postgres_database="jira",
        postgres_password="",
        postgres_port=5432,
        postgres_ssl=False,
    )
    assert _resolve_agent_postgres_uri(cfg, backend_env="postgres") == (
        "user=jira host=db.example.com dbname=jira port=5432"
    )


def test_postgres_backend_without_uri_raises() -> None:
    cfg = Settings(
        agent_postgres_uri="",
        postgres_uri="",
        postgres_user="",
        postgres_host="",
        postgres_database="",
        postgres_password="",
        postgres_port=0,
    )
    with pytest.raises(AgentConfigurationError) as exc:
        _resolve_agent_postgres_uri(cfg, backend_env="AGENT_CHECKPOINT_BACKEND")
    assert exc.value.details == {"backend": "postgres"}
    # The named env var must surface in the message so the operator
    # tweaks the right knob.
    assert "AGENT_CHECKPOINT_BACKEND=postgres" in str(exc.value)
    assert "AGENT_POSTGRES_URI" in str(exc.value)
    assert "POSTGRES_URI" in str(exc.value)


def test_build_checkpointer_postgres_without_uri_raises() -> None:
    cfg = Settings(
        agent_postgres_uri="",
        postgres_uri="",
        postgres_user="",
        postgres_host="",
        postgres_database="",
        postgres_password="",
        postgres_port=0,
    )
    with pytest.raises(AgentConfigurationError) as exc:
        build_checkpointer("postgres", settings=cfg)
    assert "AGENT_CHECKPOINT_BACKEND=postgres" in str(exc.value)


def test_build_store_postgres_without_uri_raises() -> None:
    cfg = Settings(
        agent_postgres_uri="",
        postgres_uri="",
        postgres_user="",
        postgres_host="",
        postgres_database="",
        postgres_password="",
        postgres_port=0,
    )
    with pytest.raises(AgentConfigurationError) as exc:
        build_store("postgres", settings=cfg)
    # The store factory must name AGENT_STORE_BACKEND (not the
    # checkpointer env) so operators don't chase the wrong setting.
    assert "AGENT_STORE_BACKEND=postgres" in str(exc.value)
    assert "AGENT_CHECKPOINT_BACKEND" not in str(exc.value)


def test_from_settings_rejects_postgres_with_helpful_error() -> None:
    cfg = Settings(
        agent_checkpoint_backend="postgres",
        agent_store_backend="memory",
        agent_postgres_uri="postgres://x",
    )
    with pytest.raises(AgentConfigurationError, match="from_settings_async"):
        AgentRuntime.from_settings(cfg)


def test_from_settings_rejects_postgres_store_with_helpful_error() -> None:
    cfg = Settings(
        agent_checkpoint_backend="memory",
        agent_store_backend="postgres",
        agent_postgres_uri="postgres://x",
    )
    with pytest.raises(AgentConfigurationError, match="from_settings_async"):
        AgentRuntime.from_settings(cfg)


def test_from_settings_async_postgres_happy_path(
    monkeypatch: pytest.MonkeyPatch,
    fresh_registry: AgentRegistry,
) -> None:
    saver_state = _install_fake_postgres_saver_module(monkeypatch)
    store_state = _install_fake_postgres_store_module(monkeypatch)
    cfg = Settings(
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        agent_postgres_uri="postgres://both",
    )

    async def run() -> AgentRuntime:
        async with AsyncExitStack() as stack:
            runtime = await AgentRuntime.from_settings_async(
                cfg, stack=stack, registry=fresh_registry
            )
            assert runtime.checkpointer is saver_state["saver"]
            assert runtime.store is store_state["store"]
            assert saver_state["saver"].setup_calls == 1
            assert store_state["store"].setup_calls == 1
            assert runtime.recursion_limit == cfg.agent_recursion_limit
            return runtime

    asyncio.run(run())
    # Both async context managers must have been popped off the stack.
    assert saver_state["exited"] is True
    assert store_state["exited"] is True


def test_from_settings_async_memory_path_skips_postgres_imports(
    fresh_registry: AgentRegistry,
) -> None:
    """Memory / none backends never trigger the lazy postgres import."""

    cfg = Settings(
        agent_checkpoint_backend="memory",
        agent_store_backend="none",
    )

    async def run() -> AgentRuntime:
        async with AsyncExitStack() as stack:
            return await AgentRuntime.from_settings_async(
                cfg, stack=stack, registry=fresh_registry
            )

    runtime = asyncio.run(run())
    assert isinstance(runtime.checkpointer, InMemorySaver)
    assert runtime.store is None


def test_env_positive_int_rejects_non_positive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_TEST_INT", "0")
    with pytest.raises(RuntimeError, match="positive integer"):
        env_positive_int("AGENT_TEST_INT", "1")


def test_agent_configuration_error_without_details() -> None:
    err = AgentConfigurationError("boom")
    assert err.details is None
    assert err.detail == {"error": "boom"}


def test_agent_recursion_error_payload() -> None:
    err = AgentRecursionError("x", 7)
    assert err.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert err.detail == {
        "error": "Agent 'x' exceeded recursion limit of 7",
        "details": {"name": "x", "recursion_limit": 7},
    }
    assert err.recursion_limit == 7


def test_agent_execution_error_records_cause() -> None:
    cause = ValueError("nope")
    err = AgentExecutionError("x", cause=cause)
    assert err.cause is cause
    assert err.detail["details"]["cause"] == "ValueError"
    assert err.message == "Agent 'x' failed: Execution failed"
    assert "nope" not in err.message

    err_no_cause = AgentExecutionError("x")
    assert err_no_cause.detail["details"]["cause"] is None


def test_agent_runtime_defaults_use_global_registry() -> None:
    runtime = AgentRuntime()
    assert runtime.registry is global_registry
    assert runtime.checkpointer is None
    assert runtime.store is None
    assert runtime.recursion_limit == 25


def test_agent_runtime_rejects_invalid_defaults() -> None:
    with pytest.raises(ValueError, match="default_thread_id"):
        AgentRuntime(default_thread_id=" ")
    with pytest.raises(ValueError, match="recursion_limit"):
        AgentRuntime(recursion_limit=0)


def test_agent_runtime_from_settings_uses_factories(
    fresh_registry: AgentRegistry,
) -> None:
    runtime = AgentRuntime.from_settings(settings, registry=fresh_registry)
    assert isinstance(runtime.checkpointer, InMemorySaver)
    assert isinstance(runtime.store, InMemoryStore)
    assert runtime.recursion_limit == settings.agent_recursion_limit


def test_agent_runtime_build_config_namespaces_thread_and_caps_recursion(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, recursion_limit=5)
    agent = runtime.get("echo")

    # Without a user_id the namespace falls back to "anon" so memory
    # backends still partition by thread id without crashing.
    cfg = runtime.build_config(agent)
    assert cfg["configurable"]["thread_id"] == "echo:anon:default"
    assert cfg["recursion_limit"] == 5
    assert "tags" not in cfg

    cfg = runtime.build_config(
        agent,
        thread_id="t-1",
        user_id="u-1",
        assistant_id="a-1",
        tags=["alpha"],
    )
    assert cfg["configurable"] == {
        "thread_id": "echo:u-1:t-1",
        "user_id": "u-1",
        "assistant_id": "a-1",
    }
    assert cfg["tags"] == ["alpha"]


def test_agent_runtime_build_config_preserves_already_namespaced_thread(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    agent = runtime.get("echo")
    cfg = runtime.build_config(agent, thread_id="echo:u-1:keep-me", user_id="u-1")
    assert cfg["configurable"]["thread_id"] == "echo:u-1:keep-me"


def test_agent_runtime_build_config_rewrites_legacy_agent_only_namespace(
    fresh_registry: AgentRegistry,
) -> None:
    """Legacy ``agent:thread`` ids are upgraded to ``agent:user:thread``.

    Previously the namespace was only ``{agent}:{thread}`` -- without
    the user component, a caller could resume against another user's
    checkpointed state. New ids include ``user_id`` so cross-tenant
    access is impossible.
    """

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    cfg = runtime.build_config(
        runtime.get("echo"), thread_id="echo:legacy", user_id="u-1"
    )
    assert cfg["configurable"]["thread_id"] == "echo:u-1:legacy"


def test_agent_runtime_replaces_blank_thread_with_default(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    cfg = runtime.build_config(runtime.get("echo"), thread_id="   ")
    assert cfg["configurable"]["thread_id"] == "echo:anon:default"


def test_agent_runtime_rebinds_thread_to_authenticated_user(
    fresh_registry: AgentRegistry,
) -> None:
    """A thread id namespaced for another user is rebound to the caller.

    A client cannot resume against another user's checkpointed state by
    replaying a ``{agent}:{victim}:{tail}`` id -- the runtime strips the
    victim's scope and re-namespaces under the authenticated user, so
    the resulting thread is the caller's own (separate) namespace.
    """

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    cfg = runtime.build_config(
        runtime.get("echo"),
        thread_id="echo:victim:secret",
        user_id="attacker",
    )
    assert cfg["configurable"]["thread_id"] == "echo:attacker:secret"
    assert "victim" not in cfg["configurable"]["thread_id"]


def test_agent_runtime_invoke_and_ainvoke_with_context(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        registry=fresh_registry,
    )

    sync_result = runtime.invoke(
        "echo",
        {"text": "x"},
        thread_id="t-1",
        context=EchoContext(suffix="*"),
    )
    assert sync_result["text"] == "x*"

    async_result = asyncio.run(
        runtime.ainvoke(
            "echo",
            {"text": "y"},
            thread_id="t-2",
            user_id="u-1",
            assistant_id="a-1",
            tags=["t"],
            context=EchoContext(suffix="?"),
        )
    )
    assert async_result["text"] == "y?"


def test_agent_runtime_get_unknown(fresh_registry: AgentRegistry) -> None:
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentNotFoundError):
        runtime.get("ghost")


def test_agent_runtime_translates_recursion_error(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(LoopAgent())
    runtime = AgentRuntime(registry=fresh_registry, recursion_limit=3)
    with pytest.raises(AgentRecursionError) as exc:
        runtime.invoke("loop", {"count": 0})
    assert exc.value.recursion_limit == 3


def test_agent_runtime_translates_async_recursion_error(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(LoopAgent())
    runtime = AgentRuntime(registry=fresh_registry, recursion_limit=3)
    with pytest.raises(AgentRecursionError):
        asyncio.run(runtime.ainvoke("loop", {"count": 0}))


def test_agent_runtime_translates_execution_error(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(BoomAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentExecutionError) as exc:
        runtime.invoke("boom", {"text": "x"})
    assert exc.value.cause is not None
    assert "kaboom" not in exc.value.message


def test_agent_runtime_translates_async_execution_error(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(BoomAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentExecutionError):
        asyncio.run(runtime.ainvoke("boom", {"text": "x"}))


def test_agent_runtime_invoke_passes_through_agent_error(
    fresh_registry: AgentRegistry,
) -> None:
    class RaisingAgent(BaseAgent):
        metadata = AgentMetadata(name="raises")

        def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
            raise AgentError("custom", status_code=418)

    fresh_registry.register(RaisingAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentError) as exc:
        runtime.invoke("raises", {})
    assert exc.value.status_code == 418


def test_agent_runtime_ainvoke_passes_through_agent_error(
    fresh_registry: AgentRegistry,
) -> None:
    class RaisingAgent(BaseAgent):
        metadata = AgentMetadata(name="raises")

        def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
            raise AgentError("custom", status_code=418)

    fresh_registry.register(RaisingAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentError):
        asyncio.run(runtime.ainvoke("raises", {}))


def test_agent_runtime_astream_yields_and_translates(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)

    async def collect() -> list[Any]:
        events: list[Any] = []
        async for event in runtime.astream(
            "echo",
            {"text": "z"},
            context=EchoContext(suffix="!"),
        ):
            events.append(event)
        return events

    events = asyncio.run(collect())
    assert events

    fresh_registry.register(LoopAgent())

    async def loop_collect() -> None:
        async for _ in runtime.astream("loop", {"count": 0}):
            pass

    with pytest.raises(AgentRecursionError):
        asyncio.run(loop_collect())

    fresh_registry.register(BoomAgent())

    async def boom_collect() -> None:
        async for _ in runtime.astream("boom", {"text": "x"}):
            pass

    with pytest.raises(AgentExecutionError):
        asyncio.run(boom_collect())


def test_agent_runtime_astream_passes_through_agent_error(
    fresh_registry: AgentRegistry,
) -> None:
    class RaisingAgent(BaseAgent):
        metadata = AgentMetadata(name="raises")

        def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
            raise AgentError("custom", status_code=418)

    fresh_registry.register(RaisingAgent())
    runtime = AgentRuntime(registry=fresh_registry)

    async def collect() -> None:
        async for _ in runtime.astream("raises", {}):
            pass

    with pytest.raises(AgentError):
        asyncio.run(collect())


def test_agent_runtime_astream_records_token_usage_on_success(
    fresh_registry: AgentRegistry,
) -> None:
    """Defect 3: astream must aggregate tokens from the final state and
    surface them on the run span (was 0 for every streamed run).
    """
    import app.agents.runtime as runtime_mod

    token_calls: list[tuple[int, int]] = []

    class _CapturingSpan:
        def __enter__(self) -> "_CapturingSpan":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            token_calls.append((tokens_in, tokens_out))

    def fake_start_run_span(**kwargs: Any) -> _CapturingSpan:
        return _CapturingSpan()

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    original = runtime_mod.start_run_span
    runtime_mod.start_run_span = fake_start_run_span  # type: ignore[assignment]
    try:
        async def collect() -> None:
            async for _ in runtime.astream(
                "echo", {"text": "x"}, context=EchoContext()
            ):
                pass

        asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original

    # EchoAgent emits messages without usage metadata, so the totals should
    # be (0, 0) — but the call itself MUST happen, proving the post-loop
    # aggregation branch ran.
    assert token_calls == [(0, 0)]


def test_agent_runtime_astream_swallows_aggregation_errors(
    fresh_registry: AgentRegistry,
) -> None:
    """Defect 3 (exception path): if aget_state raises during the post-loop
    token aggregation, the stream must complete cleanly (best-effort).
    """
    import app.agents.runtime as runtime_mod

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    captured: list[Any] = []

    class _Span:
        def __enter__(self) -> "_Span":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            captured.append((tokens_in, tokens_out))

    def fake_start_run_span(**kwargs: Any) -> _Span:
        return _Span()

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = fake_start_run_span  # type: ignore[assignment]

    # Force the EchoAgent.compile() to return a graph whose aget_state raises.
    agent = fresh_registry.get("echo")

    class _BoomGraph:
        def __init__(self, real: Any) -> None:
            self._real = real

        def __getattr__(self, name: str) -> Any:
            return getattr(self._real, name)

        async def aget_state(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("aget_state boom")

        async def astream(self, *args: Any, **kwargs: Any) -> Any:
            async for ev in self._real.astream(*args, **kwargs):
                yield ev

    real_compile = agent.compile
    real_acompile = agent.acompile

    def boom_compile(**kwargs: Any) -> Any:
        return _BoomGraph(real_compile(**kwargs))

    async def boom_acompile(**kwargs: Any) -> Any:
        return _BoomGraph(await real_acompile(**kwargs))

    agent.compile = boom_compile  # type: ignore[assignment]
    agent.acompile = boom_acompile  # type: ignore[assignment]

    try:
        async def collect() -> None:
            async for _ in runtime.astream(
                "echo", {"text": "x"}, context=EchoContext()
            ):
                pass

        asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start
        agent.compile = real_compile  # type: ignore[assignment]
        agent.acompile = real_acompile  # type: ignore[assignment]

    # set_token_usage must NOT have been called because aggregation raised
    # and we suppressed the exception rather than failing the stream.
    assert captured == []


def test_agent_runtime_astream_records_token_usage_on_translated_failure(
    fresh_registry: AgentRegistry,
) -> None:
    """Token aggregation must run on the translated-exception branches too,
    so cancelled / errored streams do not silently zero the budget tracker."""

    import app.agents.runtime as runtime_mod

    captured: list[tuple[int, int]] = []

    class _CapturingSpan:
        def __enter__(self) -> "_CapturingSpan":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            captured.append((tokens_in, tokens_out))

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: _CapturingSpan()  # type: ignore[assignment]

    try:
        fresh_registry.register(BoomAgent())
        runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

        async def collect() -> None:
            async for _ in runtime.astream("boom", {"text": "x"}):
                pass

        with pytest.raises(AgentExecutionError):
            asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]

    # Aggregation ran (set_token_usage was called) even though the run
    # raised an exception.  Counts are 0 because BoomAgent never wrote
    # any AIMessage with usage metadata, but the call itself proves the
    # failure-path aggregation branch executed.
    assert captured == [(0, 0)]


def test_agent_runtime_astream_failure_aggregation_does_not_mask_original(
    fresh_registry: AgentRegistry,
) -> None:
    """If the failure-path aggregation itself raises, the original
    translated exception must still propagate (best-effort cleanup)."""

    import app.agents.runtime as runtime_mod

    class _Span:
        def __enter__(self) -> "_Span":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            pass

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: _Span()  # type: ignore[assignment]

    fresh_registry.register(BoomAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    agent = fresh_registry.get("boom")
    real_acompile = agent.acompile

    class _BoomGraph:
        def __init__(self, real: Any) -> None:
            self._real = real

        def __getattr__(self, name: str) -> Any:
            return getattr(self._real, name)

        async def aget_state(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("aggregation failed too")

        async def astream(self, *args: Any, **kwargs: Any) -> Any:
            async for ev in self._real.astream(*args, **kwargs):
                yield ev

    async def patched_acompile(**kwargs: Any) -> Any:
        return _BoomGraph(await real_acompile(**kwargs))

    agent.acompile = patched_acompile  # type: ignore[assignment]

    async def collect() -> None:
        async for _ in runtime.astream("boom", {"text": "x"}):
            pass

    try:
        with pytest.raises(AgentExecutionError):
            asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]
        agent.acompile = real_acompile  # type: ignore[assignment]


def test_agent_runtime_astream_propagates_agent_errors_during_aggregation(
    fresh_registry: AgentRegistry,
) -> None:
    """An AgentError raised by aget_state must propagate, not be swallowed
    alongside generic best-effort failures (compile/lookup glitches)."""
    import app.agents.runtime as runtime_mod
    from app.agents.errors import AgentExecutionError

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    class _Span:
        def __enter__(self) -> "_Span":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_result(self, result: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            pass

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: _Span()  # type: ignore[assignment]

    agent = fresh_registry.get("echo")

    class _AgentErrGraph:
        def __init__(self, real: Any) -> None:
            self._real = real

        def __getattr__(self, name: str) -> Any:
            return getattr(self._real, name)

        async def aget_state(self, *args: Any, **kwargs: Any) -> Any:
            raise AgentExecutionError("echo", message="forced")

        async def astream(self, *args: Any, **kwargs: Any) -> Any:
            async for ev in self._real.astream(*args, **kwargs):
                yield ev

    real_acompile = agent.acompile

    async def patched_acompile(**kwargs: Any) -> Any:
        return _AgentErrGraph(await real_acompile(**kwargs))

    agent.acompile = patched_acompile  # type: ignore[assignment]

    async def collect() -> None:
        async for _ in runtime.astream(
            "echo", {"text": "x"}, context=EchoContext()
        ):
            pass

    try:
        with pytest.raises(AgentExecutionError):
            asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]
        agent.acompile = real_acompile  # type: ignore[assignment]


def test_lifespan_attaches_runtime(client: TestClient) -> None:
    runtime = main.app.state.agent_runtime
    assert isinstance(runtime, AgentRuntime)
    assert runtime.registry is global_registry


def test_router_lists_agents(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/agents", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    names = [agent["name"] for agent in body["agents"]]
    assert "echo" in names


def test_router_gets_agent_metadata(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/agents/echo", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["name"] == "echo"
    assert body["version"] == "1.0.0"
    # recursion_limit / tags / context_schema are intentionally omitted
    # from the wire shape (audit follow-up, item 9).
    assert "recursion_limit" not in body


def test_router_gets_unknown_agent_returns_404(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/agents/does-not-exist", headers=auth_headers)
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_router_invoke_runs_agent(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={
            "inputs": {"text": "ping"},
            "thread_id": "abc",
            "tags": ["x"],
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["result"]["text"] == "ping!"


def test_router_invoke_passes_context(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "ping"}, "context": {"suffix": "?"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert response.json()["result"]["text"] == "ping?"


def test_router_rejects_invalid_agent_request_options(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": [], "tags": ["ok"]},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json() == {"error": "inputs must be an object"}

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {}, "tags": ["ok", 1]},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json() == {"error": "tags must be a list of strings"}

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {}, "thread_id": 123},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json() == {"error": "thread_id must be a string"}

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {}, "user_id": "spoofed"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json() == {"error": "user_id is derived from authentication"}

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": None, "assistant_id": "assistant-1"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_router_context_coercion_branches(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    plain = PlainContextAgent()
    model = ModelContextAgent()
    unsupported = UncoercibleContextAgent()
    echo = EchoAgent()
    global_registry.register(echo)
    global_registry.register(plain)
    global_registry.register(model)
    global_registry.register(unsupported)
    global_registry.register(BoomAgent())
    try:
        response = client.post(
            "/api/v1/agents/model-context/invoke",
            json={"inputs": {"text": "m"}, "context": {"suffix": 123}},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert "suffix" in response.json()["error"]

        response = client.post(
            "/api/v1/agents/echo/invoke",
            json={"inputs": {"text": "n"}, "context": None},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json()["result"]["text"] == "n!"

        response = client.post(
            "/api/v1/agents/plain-context/invoke",
            json={"inputs": {"text": "x"}, "context": {"suffix": "?", "extra": 1}},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert response.json()["result"]["text"] == "x?"

        response = client.post(
            "/api/v1/agents/echo/invoke",
            json={"inputs": {}, "context": []},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert response.json() == {"error": "context must be an object"}

        response = client.post(
            "/api/v1/agents/echo/invoke",
            json={"inputs": {}, "context": {"unknown": "x"}},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert "__init__" in response.json()["error"]

        response = client.post(
            "/api/v1/agents/boom/invoke",
            json={"inputs": {}, "context": {}},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert response.json() == {"error": "Agent 'boom' does not accept context"}

        response = client.post(
            "/api/v1/agents/uncoercible-context/invoke",
            json={"inputs": {}, "context": {}},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
        assert "Unsupported context schema" in response.json()["error"]
    finally:
        global_registry.unregister(echo.name)
        global_registry.unregister(plain.name)
        global_registry.unregister(model.name)
        global_registry.unregister(unsupported.name)
        global_registry.unregister("boom")


def test_router_invoke_with_empty_payload_uses_defaults(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert response.json()["result"]["text"] == "!"


def test_router_stream_emits_sse(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    with client.stream(
        "POST",
        "/api/v1/agents/echo/stream",
        json={"inputs": {"text": "hi"}},
        headers=auth_headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        assert response.headers["content-type"].startswith("text/event-stream")
        body = b"".join(response.iter_bytes()).decode("utf-8")

    frames = [line for line in body.split("\n\n") if line]
    assert frames[-1] == "data: [DONE]"
    decoded = [json.loads(frame.removeprefix("data: ")) for frame in frames[:-1]]
    # FE-shaped envelope: {type, ns, data}, never the LangGraph mode tuple.
    assert all(
        payload.get("type") in {"updates", "messages", "custom", "interrupt", "error"}
        and isinstance(payload.get("ns"), list)
        and "data" in payload
        for payload in decoded
    )


def test_to_jsonable_falls_back_to_placeholder() -> None:
    from app.agents.sse import _to_jsonable

    class Unserializable:
        def __repr__(self) -> str:
            return "<custom>"

    assert _to_jsonable(Unserializable()) == {"__unserializable__": "Unserializable"}
    assert _to_jsonable({"a": 1}) == {"a": 1}


def test_catalog_discover_skips_private_modules(
    tmp_path: Path,
) -> None:
    pkg_root = Path(agent_catalog.__file__).parent
    public = pkg_root / "_test_public_agent.py"
    private = pkg_root / "__test_private_agent.py"
    public.write_text(
        textwrap.dedent(
            """
            from app.agents import AgentMetadata, BaseAgent

            class _Probe(BaseAgent):
                metadata = AgentMetadata(name="catalog-probe")

                def build(self, *, checkpointer, store):
                    raise NotImplementedError

            LOADED = True
            """
        ).strip()
    )
    private.write_text("LOADED = True\n")

    rename_target = pkg_root / "test_public_agent.py"
    public.rename(rename_target)
    try:
        for cached in [
            "app.agents.catalog.test_public_agent",
            "app.agents.catalog.__test_private_agent",
        ]:
            sys.modules.pop(cached, None)

        loaded = agent_catalog.discover()
        names = {mod.__name__ for mod in loaded}
        assert "app.agents.catalog.test_public_agent" in names
        assert "app.agents.catalog.__test_private_agent" not in names
    finally:
        if rename_target.exists():
            rename_target.unlink()
        if private.exists():
            private.unlink()
        sys.modules.pop("app.agents.catalog.test_public_agent", None)
        sys.modules.pop("app.agents.catalog.__test_private_agent", None)


class _ResumeState(TypedDict, total=False):
    received: str
    started: bool


class _InterruptingAgent(BaseAgent):
    """Pauses on first call, resumes with the value the caller injects."""

    metadata = AgentMetadata(name="interrupting", recursion_limit=4)

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        from langgraph.types import interrupt

        def gate(state: _ResumeState) -> dict[str, Any]:
            payload = interrupt({"tool": "fe.boardSnapshot"})
            return {"received": payload, "started": True}

        graph = StateGraph(_ResumeState)
        graph.add_node("gate", gate)
        graph.add_edge(START, "gate")
        graph.add_edge("gate", END)
        return graph.compile(checkpointer=checkpointer, store=store)


def test_agent_runtime_resume_completes_interrupted_run(
    fresh_registry: AgentRegistry,
) -> None:
    """ainvoke + Command(resume=...) round-trip drives an interrupt to done."""

    fresh_registry.register(_InterruptingAgent())
    runtime = AgentRuntime(
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        registry=fresh_registry,
    )

    async def run() -> dict[str, Any]:
        first = await runtime.ainvoke(
            "interrupting",
            {"started": False},
            thread_id="resume-1",
        )
        assert "__interrupt__" in first
        second = await runtime.ainvoke(
            "interrupting",
            {},
            thread_id="resume-1",
            resume="payload-from-fe",
        )
        return second

    final = asyncio.run(run())
    assert final["received"] == "payload-from-fe"
    assert final["started"] is True


def test_agent_runtime_astream_resume_yields_events(
    fresh_registry: AgentRegistry,
) -> None:
    """astream + Command(resume=...) re-enters the paused graph and finishes."""

    fresh_registry.register(_InterruptingAgent())
    runtime = AgentRuntime(
        checkpointer=InMemorySaver(),
        store=InMemoryStore(),
        registry=fresh_registry,
    )

    async def collect() -> list[Any]:
        async for _ in runtime.astream(
            "interrupting",
            {"started": False},
            thread_id="resume-stream",
        ):
            pass
        events: list[Any] = []
        async for event in runtime.astream(
            "interrupting",
            {},
            thread_id="resume-stream",
            resume="resumed-value",
        ):
            events.append(event)
        return events

    events = asyncio.run(collect())
    assert events
    # The resumed run finishes, so at least one update must include the
    # resumed payload reaching the gate node.
    assert any(
        isinstance(payload, dict)
        and payload.get("gate", {}).get("received") == "resumed-value"
        for mode, payload in events
        if mode == "updates"
    )


def test_agent_runtime_resume_requires_thread_id(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(_InterruptingAgent())
    runtime = AgentRuntime(checkpointer=InMemorySaver(), registry=fresh_registry)
    with pytest.raises(AgentConfigurationError, match="thread_id"):
        asyncio.run(runtime.ainvoke("interrupting", {}, resume="x"))


def test_agent_runtime_resume_rejects_inputs_with_resume(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(_InterruptingAgent())
    runtime = AgentRuntime(checkpointer=InMemorySaver(), registry=fresh_registry)
    with pytest.raises(AgentConfigurationError, match="Cannot supply both"):
        asyncio.run(
            runtime.ainvoke(
                "interrupting",
                {"started": False},
                thread_id="t-1",
                resume="x",
            )
        )


def test_agent_runtime_resume_rejects_blank_thread_id(
    fresh_registry: AgentRegistry,
) -> None:
    fresh_registry.register(_InterruptingAgent())
    runtime = AgentRuntime(checkpointer=InMemorySaver(), registry=fresh_registry)
    with pytest.raises(AgentConfigurationError, match="thread_id"):
        asyncio.run(runtime.ainvoke("interrupting", {}, thread_id="   ", resume="x"))


def test_base_agent_normalize_input_returns_command_unchanged() -> None:
    from langgraph.types import Command

    sentinel = Command(resume="abc")
    assert EchoAgent._normalize_input(sentinel) is sentinel


def test_graph_recursion_error_is_translated_when_caught_directly(
    fresh_registry: AgentRegistry,
) -> None:
    """Sanity check: GraphRecursionError mapping is reachable from invoke too."""

    class BoomRecursion(BaseAgent):
        metadata = AgentMetadata(name="boom-rec")

        def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
            def _raise(state):  # type: ignore[no-untyped-def]
                raise GraphRecursionError("nope")

            graph = StateGraph(EchoState)
            graph.add_node("x", _raise)
            graph.add_edge(START, "x")
            graph.add_edge("x", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    fresh_registry.register(BoomRecursion())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentRecursionError):
        runtime.invoke("boom-rec", {"text": "x"})


def test_router_invoke_rejects_command_without_resume_field(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"command": {}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "resume" in response.json()["error"]


def test_router_invoke_rejects_non_object_command(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"command": "wat"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_router_invoke_rejects_inputs_with_command_resume(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x"}, "command": {"resume": "v"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_router_invoke_resume_completes_interrupted_run(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Full HTTP round-trip of the FE resume contract (PRD §5A.5 / AC-V2)."""

    agent = _InterruptingAgent()
    global_registry.register(agent)
    try:
        first = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={"inputs": {"started": False}, "thread_id": "http-resume-1"},
            headers=auth_headers,
        )
        assert first.status_code == HTTPStatus.OK
        # The first response surfaces the LangGraph interrupt sentinel.
        assert "__interrupt__" in first.json()["result"]

        second = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={
                "command": {"resume": "value-from-fe"},
                "thread_id": "http-resume-1",
            },
            headers=auth_headers,
        )
        assert second.status_code == HTTPStatus.OK
        result = second.json()["result"]
        assert result["received"] == "value-from-fe"
        assert result["started"] is True
    finally:
        global_registry.unregister(agent.name)


def test_router_stream_resume_completes_interrupted_run(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    agent = _InterruptingAgent()
    global_registry.register(agent)
    try:
        with client.stream(
            "POST",
            "/api/v1/agents/interrupting/stream",
            json={"inputs": {"started": False}, "thread_id": "http-resume-2"},
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            b"".join(response.iter_bytes())

        with client.stream(
            "POST",
            "/api/v1/agents/interrupting/stream",
            json={
                "command": {"resume": "stream-resume"},
                "thread_id": "http-resume-2",
            },
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            body = b"".join(response.iter_bytes()).decode("utf-8")
        frames = [line for line in body.split("\n\n") if line]
        assert frames[-1] == "data: [DONE]"
        decoded = [json.loads(frame.removeprefix("data: ")) for frame in frames[:-1]]
        # An updates event must reflect the resumed payload reaching the gate.
        assert any(
            payload.get("type") == "updates"
            and isinstance(payload.get("data"), dict)
            and payload["data"].get("gate", {}).get("received") == "stream-resume"
            for payload in decoded
        )
    finally:
        global_registry.unregister(agent.name)


def test_router_stream_resume_allows_config_project_id(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Matches the FE useAgent resume envelope with project_id in configurable."""

    agent = _InterruptingAgent()
    global_registry.register(agent)
    try:
        config = {
            "configurable": {
                "thread_id": "http-resume-config-project",
                "project_id": "p-budget-agent",
            }
        }
        with client.stream(
            "POST",
            "/api/v1/agents/interrupting/stream",
            json={"input": {"started": False}, "config": config},
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            b"".join(response.iter_bytes())

        with client.stream(
            "POST",
            "/api/v1/agents/interrupting/stream",
            json={
                "input": None,
                "command": {"resume": "stream-resume"},
                "config": config,
            },
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            body = b"".join(response.iter_bytes()).decode("utf-8")

        decoded = [
            json.loads(frame.removeprefix("data: "))
            for frame in body.split("\n\n")
            if frame and frame != "data: [DONE]"
        ]
        assert any(
            payload.get("type") == "updates"
            and isinstance(payload.get("data"), dict)
            and payload["data"].get("gate", {}).get("received") == "stream-resume"
            for payload in decoded
        )
    finally:
        global_registry.unregister(agent.name)


def test_router_invoke_returns_429_with_retry_after_when_rate_limited(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dataclasses import replace

    from app.middleware import rate_limit as rate_limit_module

    rate_limit_module.rate_limiter.reset()
    # Lower the per-agent limit on the registered metadata directly --
    # the limiter reads from registry metadata as the single source of
    # truth, so the test patches that one place.
    tight_metadata = replace(echo_in_global_registry.metadata, rate_limit=(1, 60))
    monkeypatch.setattr(echo_in_global_registry, "metadata", tight_metadata)

    first = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    )
    assert first.status_code == HTTPStatus.OK

    second = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "y"}},
        headers=auth_headers,
    )
    assert second.status_code == HTTPStatus.TOO_MANY_REQUESTS
    assert "Retry-After" in second.headers
    assert int(second.headers["Retry-After"]) >= 1
    rate_limit_module.rate_limiter.reset()


def test_router_invoke_returns_402_when_budget_exhausted(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.middleware import budget as budget_module

    budget_module.budget_tracker.reset()
    monkeypatch.setattr(budget_module.budget_tracker, "monthly_cap", 0)

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x", "project_id": "p-budget-agent"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.PAYMENT_REQUIRED
    assert response.headers.get("X-Reason") == "budget"
    monkeypatch.setattr(
        budget_module.budget_tracker,
        "monthly_cap",
        budget_module.DEFAULT_MONTHLY_TOKEN_CAP,
    )
    budget_module.budget_tracker.reset()


def test_router_records_usage_on_successful_invoke(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    from app.middleware import budget as budget_module

    budget_module.budget_tracker.reset()
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x", "project_id": "p-record"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert (
        budget_module.budget_tracker.remaining("p-record")
        < budget_module.DEFAULT_MONTHLY_TOKEN_CAP
    )
    budget_module.budget_tracker.reset()


def test_router_records_usage_after_stream_completes(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
) -> None:
    from app.middleware import budget as budget_module

    budget_module.budget_tracker.reset()
    with client.stream(
        "POST",
        "/api/v1/agents/echo/stream",
        json={"inputs": {"text": "z", "project_id": "p-stream-record"}},
        headers=auth_headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        body = b"".join(response.iter_bytes()).decode("utf-8")
    assert "[DONE]" in body
    assert (
        budget_module.budget_tracker.remaining("p-stream-record")
        < budget_module.DEFAULT_MONTHLY_TOKEN_CAP
    )
    budget_module.budget_tracker.reset()


def test_router_returns_403_when_project_ai_is_disabled(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import agents as agents_router

    monkeypatch.setattr(
        agents_router, "is_project_ai_enabled", lambda project_id: False
    )

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x", "project_id": "blocked-project"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN
    body = response.json()
    assert body["error"]["code"] == "forbidden"
    assert body["error"]["message"] == "AI is disabled for this project"


def test_router_stream_returns_403_when_project_ai_is_disabled(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import agents as agents_router

    monkeypatch.setattr(
        agents_router, "is_project_ai_enabled", lambda project_id: False
    )

    response = client.post(
        "/api/v1/agents/echo/stream",
        json={"inputs": {"text": "x", "project_id": "blocked-project"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


class _CapturingState(TypedDict, total=False):
    text: str
    prompt: Any
    messages: Any


class _CapturingAgent(BaseAgent):
    """Records the inputs the graph receives so tests can assert on redaction."""

    metadata = AgentMetadata(name="capturing")
    captured: dict[str, Any] = {}

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def record(state: _CapturingState) -> dict:
            type(self).captured = dict(state)
            return {"text": "ok"}

        graph = StateGraph(_CapturingState)
        graph.add_node("record", record)
        graph.add_edge(START, "record")
        graph.add_edge("record", END)
        return graph.compile(checkpointer=checkpointer, store=store)


def test_router_redacts_user_message_content_before_agent(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """User text containing PII reaches the agent already redacted (PRD §5A.10)."""

    agent = _CapturingAgent()
    global_registry.register(agent)
    _CapturingAgent.captured = {}
    try:
        response = client.post(
            "/api/v1/agents/capturing/invoke",
            json={
                "inputs": {
                    "messages": [
                        {"role": "user", "content": "ping me at alice@example.com"},
                        {"role": "system", "content": "leave me alone"},
                        "raw-string-leftover",
                    ],
                    "prompt": "secret 4111111111111111",
                }
            },
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.OK
        captured_messages = _CapturingAgent.captured["messages"]
        assert captured_messages[0]["content"] == "ping me at [EMAIL]"
        # System message is left untouched.
        assert captured_messages[1]["content"] == "leave me alone"
        # Non-dict messages pass through unchanged.
        assert captured_messages[2] == "raw-string-leftover"
        assert _CapturingAgent.captured["prompt"] == "secret [CARD]"
    finally:
        global_registry.unregister(agent.name)


def test_router_redacts_resume_payload(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    agent = _InterruptingAgent()
    global_registry.register(agent)
    try:
        first = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={
                "inputs": {"started": False},
                "thread_id": "http-redact-resume",
            },
            headers=auth_headers,
        )
        assert first.status_code == HTTPStatus.OK
        second = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={
                "command": {"resume": "alice@example.com"},
                "thread_id": "http-redact-resume",
            },
            headers=auth_headers,
        )
        assert second.status_code == HTTPStatus.OK
        assert second.json()["result"]["received"] == "[EMAIL]"
    finally:
        global_registry.unregister(agent.name)


def test_router_invoke_skips_redaction_for_non_dict_messages(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """When ``messages`` is not a list the redactor leaves it alone."""

    agent = _CapturingAgent()
    global_registry.register(agent)
    _CapturingAgent.captured = {}
    try:
        response = client.post(
            "/api/v1/agents/capturing/invoke",
            json={
                "inputs": {
                    "messages": "not-a-list",
                    "prompt": 42,
                }
            },
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.OK
        # Non-list messages and non-string prompts pass through unchanged.
        assert _CapturingAgent.captured["messages"] == "not-a-list"
        assert _CapturingAgent.captured["prompt"] == 42
    finally:
        global_registry.unregister(agent.name)


def test_v21_catalog_agents_emit_citation_custom_events(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """board-brief-agent surfaces a kind=citation event with a quote (AC-V7)."""

    runtime = main.app.state.agent_runtime
    snapshot = {
        "project_id": "p-cite",
        "columns": [
            {"id": "c1", "name": "Todo"},
            {"id": "c2", "name": "Done"},
        ],
        "tasks": [
            {"id": "t1", "columnId": "c1", "taskName": "Ship login"},
            {"id": "t2", "columnId": "c2", "taskName": "Done card"},
        ],
    }

    async def collect_custom() -> list[Any]:
        events: list[Any] = []
        async for _ in runtime.astream(
            "board-brief-agent",
            {"project_id": "p-cite"},
            thread_id="cite-1",
        ):
            pass
        async for mode, payload in runtime.astream(
            "board-brief-agent",
            {},
            thread_id="cite-1",
            resume=snapshot,
        ):
            events.append((mode, payload))
        return events

    events = asyncio.run(collect_custom())
    custom = [payload for mode, payload in events if mode == "custom"]
    assert custom, "expected at least one custom event"
    citations = [
        c for c in custom if isinstance(c, dict) and c.get("kind") == "citation"
    ]
    assert citations
    # Every ref must carry a non-empty quote field per PRD §5.2.
    for citation in citations:
        for ref in citation["refs"]:
            assert ref["quote"]


def test_chat_agent_does_not_emit_invalid_user_citation() -> None:
    """User messages are not citable; no ``source: "user"`` ref must escape.

    The FE wire contract (``src/interfaces/agent.d.ts``) constrains
    citation sources to ``task | column | member | project``. The chat
    agent used to emit a placeholder citation pointing at the user's own
    input, which the FE silently dropped. Now it emits no citation at
    all -- a usage event still fires so the budget UI stays accurate.
    """

    from langchain_core.messages import HumanMessage

    runtime = main.app.state.agent_runtime

    async def collect() -> list[Any]:
        events: list[Any] = []
        async for mode, payload in runtime.astream(
            "chat-agent",
            {
                "project_id": "p-chat-cite",
                "messages": [HumanMessage(content="hello")],
            },
            thread_id="chat-cite-1",
        ):
            events.append((mode, payload))
        return events

    events = asyncio.run(collect())
    custom = [payload for mode, payload in events if mode == "custom"]
    citations = [
        c for c in custom if isinstance(c, dict) and c.get("kind") == "citation"
    ]
    assert citations == [], "chat-agent must not emit citations for user text"
    # Usage event still fires so the FE budget display stays accurate.
    assert any(
        isinstance(c, dict) and c.get("kind") == "usage" for c in custom
    )


def test_task_estimation_agent_emits_citation_custom_event() -> None:
    runtime = main.app.state.agent_runtime
    similar = [{"id": "n1", "text": "implement login form"}]

    async def collect() -> list[Any]:
        async for _ in runtime.astream(
            "task-estimation-agent",
            {
                "project_id": "p-est-cite",
                "task_draft": {"taskName": "implement signup", "note": "tests"},
            },
            thread_id="est-cite-1",
        ):
            pass
        events: list[Any] = []
        async for mode, payload in runtime.astream(
            "task-estimation-agent",
            {},
            thread_id="est-cite-1",
            resume=similar,
        ):
            events.append((mode, payload))
        return events

    events = asyncio.run(collect())
    custom = [
        c
        for mode, c in events
        if mode == "custom" and isinstance(c, dict) and c.get("kind") == "citation"
    ]
    assert custom
    assert custom[0]["refs"][0]["quote"]
