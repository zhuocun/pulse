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
from langgraph.runtime import Runtime, get_runtime
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
from app.agents.context import ChatContext
from app.agents import catalog as agent_catalog
from app.agents import checkpointing as agent_checkpointing
from app.agents import stores as agent_stores
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
        "recursion_limit": 25,
        "tags": [],
        "context_schema": None,
    }


def test_agent_metadata_as_dict_exposes_catalog_fields() -> None:
    meta = AgentMetadata(
        name="x",
        context_schema=EchoContext,
        tags=("a", "b"),
        recursion_limit=7,
    )
    payload = meta.as_dict()
    assert payload["tags"] == ["a", "b"]
    assert payload["recursion_limit"] == 7
    assert "suffix" in payload["context_schema"]
    assert meta.context_schema is EchoContext

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
    assert payload["recursion_limit"] == 25
    assert payload["tags"] == []
    assert payload["context_schema"] is None


def test_agent_metadata_as_dict_context_schema_handles_hint_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Sch:
        __annotations__ = {"q": int}

    def _boom(*_a: object, **_k: object) -> dict[str, object]:  # noqa: ANN401
        raise TypeError("unusable hints")

    # Patch BEFORE construction so the eager __post_init__ cache uses the stub.
    monkeypatch.setattr("app.agents.base.get_type_hints", _boom)
    meta = AgentMetadata(name="x", context_schema=_Sch)
    assert meta.as_dict()["context_schema"] == {}


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


# ---------------------------------------------------------------------------
# ChainedAgentRegistry
# ---------------------------------------------------------------------------


class _ChainedAgentA(BaseAgent):
    metadata = AgentMetadata(name="chain-a", description="A", version="1.0.0")

    def build(self, *, checkpointer=None, store=None):  # noqa: ARG002
        raise NotImplementedError


class _ChainedAgentB(BaseAgent):
    metadata = AgentMetadata(name="chain-b", description="B", version="1.0.0")

    def build(self, *, checkpointer=None, store=None):  # noqa: ARG002
        raise NotImplementedError


def test_chained_registry_reads_fall_through_to_parent() -> None:
    """A ``ChainedAgentRegistry`` reads from its parent when the local
    layer is empty, so test fixtures that pre-register in the global
    keep working after the runtime switches to per-app isolation."""
    from app.agents.registry import ChainedAgentRegistry

    parent = AgentRegistry()
    parent.register(_ChainedAgentA())
    chained = ChainedAgentRegistry(parent)

    # Reads delegate to the parent.
    assert chained.get("chain-a") is parent.get("chain-a")
    assert "chain-a" in chained
    assert chained.names() == ["chain-a"]
    assert [m.name for m in chained.metadata()] == ["chain-a"]
    assert [a.name for a in chained] == ["chain-a"]
    assert len(chained) == 1


def test_chained_registry_writes_isolated_from_parent() -> None:
    """``register`` mutates only the local layer; the parent stays
    untouched, so two apps in the same process don't see each other's
    test-only agents."""
    from app.agents.registry import ChainedAgentRegistry

    parent = AgentRegistry()
    chained = ChainedAgentRegistry(parent)

    chained.register(_ChainedAgentA())
    assert "chain-a" in chained
    assert "chain-a" not in parent  # Isolation: parent untouched.


def test_chained_registry_local_overrides_parent_on_read() -> None:
    """When both layers carry an agent with the same name, the local
    instance wins on read (last-write-wins via ``register(replace=True)``
    is not needed because the chained read short-circuits)."""
    from app.agents.registry import ChainedAgentRegistry

    parent = AgentRegistry()
    parent_agent = _ChainedAgentA()
    parent.register(parent_agent)

    local_agent = _ChainedAgentA()
    chained = ChainedAgentRegistry(parent)
    chained.register(local_agent)

    assert chained.get("chain-a") is local_agent
    # iteration / metadata / names dedupe by name, local wins.
    iterated = list(chained)
    assert len(iterated) == 1
    assert iterated[0] is local_agent
    metas = chained.metadata()
    assert len(metas) == 1


def test_chained_registry_union_across_layers() -> None:
    """``names`` / ``metadata`` / ``__iter__`` / ``__contains__`` /
    ``__len__`` see the union of both layers."""
    from app.agents.registry import ChainedAgentRegistry

    parent = AgentRegistry()
    parent.register(_ChainedAgentA())
    chained = ChainedAgentRegistry(parent)
    chained.register(_ChainedAgentB())

    assert chained.names() == ["chain-a", "chain-b"]
    assert {m.name for m in chained.metadata()} == {"chain-a", "chain-b"}
    assert "chain-a" in chained and "chain-b" in chained
    assert "missing-agent" not in chained
    assert {a.name for a in chained} == {"chain-a", "chain-b"}
    assert len(chained) == 2


def test_chained_registry_get_missing_raises() -> None:
    """A name absent from both layers still raises ``AgentNotFoundError``."""
    from app.agents.registry import ChainedAgentRegistry

    parent = AgentRegistry()
    chained = ChainedAgentRegistry(parent)
    with pytest.raises(AgentNotFoundError):
        chained.get("nope")


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


def test_compile_double_check_returns_cached_when_other_thread_won_the_race() -> None:
    """The slow path's inner cache check returns the cached graph when a
    second caller wins the lock after the cache was populated.

    Simulates the race by holding ``_build_lock`` from outside, waiting
    inside the helper to populate ``_compiled`` directly, then letting
    ``compile()`` proceed — its inner ``_cache_hit`` check now succeeds.
    """

    agent = EchoAgent()
    sentinel = object()

    real_cache_hit = agent._cache_hit  # noqa: SLF001
    calls = {"n": 0}

    def fake_cache_hit(*args, **kwargs):
        calls["n"] += 1
        # First call (fast path before lock) returns False; second call
        # (after acquiring the lock) returns True so the inner branch fires.
        if calls["n"] == 1:
            return False
        agent._compiled_state = (sentinel, None, None)  # noqa: SLF001
        return True

    agent._cache_hit = fake_cache_hit  # type: ignore[assignment]
    try:
        result = agent.compile()
    finally:
        agent._cache_hit = real_cache_hit  # type: ignore[assignment]
    assert result is sentinel


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


def test_open_checkpointer_postgres_uses_default_settings_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``open_checkpointer("postgres")`` falls back to ``app.config.settings``.

    Mirrors :func:`test_build_checkpointer_postgres_uses_default_settings_when_omitted`
    but exercises the additional ``settings is None`` fallback inside
    ``open_checkpointer`` introduced for ``agent_pg_pool_size`` lookup
    (F-SC1).
    """

    state = _install_fake_postgres_saver_module(monkeypatch)
    from app import config as config_module

    monkeypatch.setattr(
        config_module,
        "settings",
        Settings(agent_postgres_uri="postgres://default-open-fallback"),
    )

    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_checkpointer("postgres", stack=stack)

    saver = asyncio.run(run())
    assert saver is state["saver"]
    assert saver.conn_string == "postgres://default-open-fallback"


def test_open_store_postgres_uses_default_settings_when_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``open_store("postgres")`` falls back to ``app.config.settings``."""

    state = _install_fake_postgres_store_module(monkeypatch)
    from app import config as config_module

    monkeypatch.setattr(
        config_module,
        "settings",
        Settings(agent_postgres_uri="postgres://default-open-fallback"),
    )

    async def run() -> Any:
        async with AsyncExitStack() as stack:
            return await open_store("postgres", stack=stack)

    store = asyncio.run(run())
    assert store is state["store"]
    assert store.conn_string == "postgres://default-open-fallback"


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
            assert saver_state["saver"].pool is store_state["store"].pool
            assert saver_state["saver"].setup_calls == 1
            assert store_state["store"].setup_calls == 1
            assert runtime.recursion_limit == cfg.agent_recursion_limit
            return runtime

    asyncio.run(run())
    # Single pool: exited once; exit-stack hooks from both installers may set
    # both flags on the shared context tear-down.
    shared = saver_state["saver"].pool
    assert shared is not None
    assert shared.close_calls == 1
    assert saver_state["exited"] is True
    assert store_state["exited"] is True


def test_from_settings_async_postgres_distinct_dsns_use_two_pools(
    monkeypatch: pytest.MonkeyPatch,
    fresh_registry: AgentRegistry,
) -> None:
    """When resolved checkpoint and store DSNs differ, each side opens its own pool."""

    def _split_resolve(_settings: Any, *, backend_env: str) -> str:
        if backend_env == "AGENT_CHECKPOINT_BACKEND":
            return "postgres://checkpoint"
        if backend_env == "AGENT_STORE_BACKEND":
            return "postgres://store"
        raise AssertionError(backend_env)

    monkeypatch.setattr(
        agent_checkpointing,
        "resolve_agent_postgres_uri",
        _split_resolve,
    )
    monkeypatch.setattr(
        agent_stores,
        "resolve_agent_postgres_uri",
        _split_resolve,
    )

    saver_state = _install_fake_postgres_saver_module(monkeypatch)
    store_state = _install_fake_postgres_store_module(monkeypatch)
    cfg = Settings(
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
    )

    async def run() -> None:
        async with AsyncExitStack() as stack:
            runtime = await AgentRuntime.from_settings_async(
                cfg, stack=stack, registry=fresh_registry
            )
            cp_pool = saver_state["saver"].pool
            st_pool = store_state["store"].pool
            assert cp_pool is not None and st_pool is not None
            assert cp_pool is not st_pool
            assert runtime.checkpointer is saver_state["saver"]
            assert runtime.store is store_state["store"]

    asyncio.run(run())
    assert saver_state["saver"].pool.close_calls == 1
    assert store_state["store"].pool.close_calls == 1


def test_from_settings_async_postgres_concurrent_stacks_keep_pools_independent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Parallel lifespans each get a shared pool internally but never share across stacks."""

    _install_fake_postgres_saver_module(monkeypatch)
    _install_fake_postgres_store_module(monkeypatch)
    cfg = Settings(
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        agent_postgres_uri="postgres://concurrent",
    )

    seen: list[tuple[Any, Any]] = []

    async def worker() -> None:
        reg = AgentRegistry()
        async with AsyncExitStack() as stack:
            runtime = await AgentRuntime.from_settings_async(
                cfg, stack=stack, registry=reg
            )
            cp = runtime.checkpointer
            st = runtime.store
            assert cp is not None and st is not None
            assert cp.pool is st.pool  # type: ignore[attr-defined]
            seen.append((cp.pool, st.pool))  # type: ignore[attr-defined]

    async def run() -> None:
        await asyncio.gather(worker(), worker())

    asyncio.run(run())
    assert len(seen) == 2
    (p1a, p1b), (p2a, p2b) = seen
    assert p1a is p1b
    assert p2a is p2b
    assert p1a is not p2a


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
    assert err.detail == {
        "error": {"code": "agent_configuration", "message": "boom"},
    }


def test_agent_recursion_error_payload() -> None:
    err = AgentRecursionError("x", 7)
    assert err.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert err.detail == {
        "error": {
            "code": "agent_recursion",
            "message": "Agent 'x' exceeded recursion limit of 7",
            "details": {"name": "x", "recursion_limit": 7},
        },
    }
    assert err.recursion_limit == 7


def test_agent_execution_error_records_cause() -> None:
    cause = ValueError("nope")
    err = AgentExecutionError("x", cause=cause)
    assert err.cause is cause
    assert err.detail["error"]["details"]["cause"] == "ValueError"
    assert err.message == "Agent 'x' failed: Execution failed"
    assert "nope" not in err.message

    err_no_cause = AgentExecutionError("x")
    assert err_no_cause.detail["error"]["details"]["cause"] is None


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


def test_agent_runtime_from_settings_auto_populates_catalog_when_no_registry() -> None:
    """``from_settings`` without an explicit registry registers catalog agents into
    ``default_registry`` so the default-registry path (lines 198-200) is covered."""
    # Use the global registry which from_settings will populate via register_all.
    runtime = AgentRuntime.from_settings(settings)
    # Catalog agents must be present (populated by register_all inside from_settings).
    agent_names = set(runtime.registry.names())
    assert "board-brief-agent" in agent_names
    assert "chat-agent" in agent_names


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


# ---------------------------------------------------------------------------
# 6C: Signed thread key tests
# ---------------------------------------------------------------------------


def test_signed_thread_key_rejects_prefix_injection(
    fresh_registry: AgentRegistry,
) -> None:
    """Prefix-injection via a signed token is rejected with a clear error.

    When a token is valid but was issued for a different agent or user scope,
    ``_try_verify_signed_thread_key`` raises ``ValueError`` rather than
    silently re-scoping the thread.
    """
    from app.agents.runtime import sign_thread_key, _try_verify_signed_thread_key

    # Create a valid token for "other-agent" and "other-user".
    token = sign_thread_key("other-agent", "other-user", "my-thread")

    # Trying to verify it as "echo" / "attacker" must raise.
    with pytest.raises(ValueError, match="Signed thread key rejected"):
        _try_verify_signed_thread_key(token, "echo", "attacker")


def test_signed_thread_key_unsigned_fallback_still_works(
    fresh_registry: AgentRegistry,
) -> None:
    """Old unsigned thread_ids continue to work via the iterative-strip fallback."""
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    # Plain (unsigned) thread id -- must route through fallback, not signed path.
    cfg = runtime.build_config(
        runtime.get("echo"),
        thread_id="my-plain-thread",
        user_id="u1",
    )
    assert cfg["configurable"]["thread_id"] == "echo:u1:my-plain-thread"


def test_signed_thread_key_is_deterministic(
    fresh_registry: AgentRegistry,
) -> None:
    """Signing is deterministic: same (agent, user, original) → same token."""
    from app.agents.runtime import sign_thread_key

    t1 = sign_thread_key("echo", "u1", "my-thread")
    t2 = sign_thread_key("echo", "u1", "my-thread")
    assert t1 == t2
    # Different inputs produce different tokens.
    t3 = sign_thread_key("echo", "u2", "my-thread")
    assert t1 != t3


def test_signed_thread_key_round_trips_through_namespaced_thread(
    fresh_registry: AgentRegistry,
) -> None:
    """A signed token round-trips correctly through ``_namespaced_thread``.

    A client that receives a signed token and echoes it back should get
    the same canonical thread ID as if they had passed the original plain id.
    """
    from app.agents.runtime import sign_thread_key

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    agent = runtime.get("echo")

    # Build config with the plain thread id first.
    plain_cfg = runtime.build_config(agent, thread_id="t-1", user_id="u1")
    plain_thread = plain_cfg["configurable"]["thread_id"]

    # Now create a signed token and pass it back.
    token = sign_thread_key("echo", "u1", "t-1")
    signed_cfg = runtime.build_config(agent, thread_id=token, user_id="u1")
    signed_thread = signed_cfg["configurable"]["thread_id"]

    assert signed_thread == plain_thread, (
        f"Signed round-trip mismatch: plain={plain_thread!r}, signed={signed_thread!r}"
    )


def test_try_verify_returns_none_for_non_signed_token() -> None:
    """_try_verify_signed_thread_key returns None for tokens without the prefix."""
    from app.agents.runtime import _try_verify_signed_thread_key

    result = _try_verify_signed_thread_key("plain-thread-id", "echo", "u1")
    assert result is None


def test_try_verify_returns_none_for_malformed_base64() -> None:
    """_try_verify_signed_thread_key returns None for invalid base64 after prefix."""
    from app.agents.runtime import _try_verify_signed_thread_key, _SIGNED_PREFIX

    result = _try_verify_signed_thread_key(f"{_SIGNED_PREFIX}!!!not_base64!!!", "echo", "u1")
    assert result is None


def test_try_verify_returns_none_for_wrong_field_count() -> None:
    """_try_verify_signed_thread_key returns None when payload has wrong NUL field count."""
    import base64
    from app.agents.runtime import _try_verify_signed_thread_key, _SIGNED_PREFIX, _SEP

    # Only 2 NUL-separated fields (need 4)
    payload = f"echo{_SEP}u1"
    encoded = base64.urlsafe_b64encode(payload.encode()).decode()
    result = _try_verify_signed_thread_key(f"{_SIGNED_PREFIX}{encoded}", "echo", "u1")
    assert result is None


def test_try_verify_returns_none_on_invalid_hmac() -> None:
    """_try_verify_signed_thread_key returns None (soft-fail) when HMAC is wrong.

    An HMAC mismatch must NOT raise; the rolling-restart safety contract
    requires the caller to fall through to the unsigned path when the
    digest does not match (e.g. because the signing key was rotated).
    """
    import base64
    from app.agents.runtime import _try_verify_signed_thread_key, _SIGNED_PREFIX, _SEP

    # Build a payload with the right fields but a bogus digest.
    payload = f"echo{_SEP}u1{_SEP}my-thread{_SEP}0000000000000000000000000000000000000000000000000000000000000000"
    encoded = base64.urlsafe_b64encode(payload.encode()).decode()
    result = _try_verify_signed_thread_key(f"{_SIGNED_PREFIX}{encoded}", "echo", "u1")
    assert result is None


def test_namespaced_thread_rejects_malformed_sigv1(
    fresh_registry: AgentRegistry,
) -> None:
    """A ``sigv1.`` token that fails verification raises ``InvalidThreadKeyError``."""
    from app.agents.errors import InvalidThreadKeyError
    from app.agents.runtime import _SIGNED_PREFIX

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    agent = runtime.get("echo")

    malformed_token = f"{_SIGNED_PREFIX}!!!invalid!!!"
    with pytest.raises(InvalidThreadKeyError) as exc_info:
        runtime.build_config(agent, thread_id=malformed_token, user_id="u1")

    err = exc_info.value
    assert err.code == "invalid_thread_key"
    assert err.status_code == 400


def test_tampered_signed_thread_key_rejected(
    fresh_registry: AgentRegistry,
) -> None:
    """A valid-looking ``sigv1.`` token with a bad HMAC is rejected, not unsigned."""
    import base64

    from app.agents.errors import InvalidThreadKeyError
    from app.agents.runtime import sign_thread_key, _SEP, _SIGNED_PREFIX

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    agent = runtime.get("echo")

    token = sign_thread_key("echo", "u1", "my-thread")
    encoded = token[len(_SIGNED_PREFIX) :]
    payload = base64.urlsafe_b64decode(encoded.encode()).decode()
    parts = payload.split(_SEP, 3)
    parts[3] = "0" * 64
    tampered = f"{_SIGNED_PREFIX}{base64.urlsafe_b64encode(_SEP.join(parts).encode()).decode()}"

    with pytest.raises(InvalidThreadKeyError) as exc_info:
        runtime.build_config(agent, thread_id=tampered, user_id="u1")

    err = exc_info.value
    assert err.code == "invalid_thread_key"
    assert err.status_code == 400


# ---------------------------------------------------------------------------
# Defect 2: Cross-user signed thread token returns 5xx instead of 4xx
# ---------------------------------------------------------------------------


def test_invalid_thread_key_error_raised_by_namespaced_thread(
    fresh_registry: AgentRegistry,
) -> None:
    """A cross-user signed token raises ``InvalidThreadKeyError`` (4xx) not
    the generic ``AgentExecutionError`` (5xx) that the runtime's translation
    boundary used to produce.
    """
    from app.agents.errors import InvalidThreadKeyError
    from app.agents.runtime import sign_thread_key

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    agent = runtime.get("echo")

    # Issue a valid token for a different agent and scope.
    stolen_token = sign_thread_key("other-agent", "victim-user", "their-thread")

    # Passing it to the correct agent under a different user must raise
    # InvalidThreadKeyError with a 400 status, not AgentExecutionError (500).
    with pytest.raises(InvalidThreadKeyError) as exc_info:
        runtime.build_config(agent, thread_id=stolen_token, user_id="attacker")

    err = exc_info.value
    assert err.code == "invalid_thread_key"
    assert err.status_code == 400


def test_invalid_thread_key_error_propagates_through_ainvoke(
    fresh_registry: AgentRegistry,
) -> None:
    """A stolen signed token passed to ``ainvoke`` must surface as
    ``InvalidThreadKeyError`` (4xx), not wrapped in ``AgentExecutionError``.

    ``build_config`` is called before the internal try/except boundary,
    so the error must propagate unchanged.
    """
    from app.agents.errors import InvalidThreadKeyError
    from app.agents.runtime import sign_thread_key

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)

    stolen_token = sign_thread_key("other-agent", "victim-user", "their-thread")

    with pytest.raises(InvalidThreadKeyError) as exc_info:
        asyncio.run(
            runtime.ainvoke(
                "echo",
                {"text": "hi"},
                thread_id=stolen_token,
                user_id="attacker",
            )
        )

    err = exc_info.value
    assert err.code == "invalid_thread_key"
    assert err.status_code == 400
    assert err.status_code < 500


# ---------------------------------------------------------------------------
# sigv2 kid-aware signed thread keys
# ---------------------------------------------------------------------------


def _patch_signing_keys(
    monkeypatch: pytest.MonkeyPatch,
    keys: tuple[str, ...],
) -> None:
    """Swap ``app.config.settings`` for a copy with ``agent_thread_signing_keys=keys``.

    Settings is a frozen dataclass so we can't mutate it in place; instead
    rebind the module-level ``settings`` symbol that runtime imports lazily
    on each call.
    """
    from dataclasses import replace
    from app.config import settings as live_settings

    monkeypatch.setattr(
        "app.config.settings",
        replace(live_settings, agent_thread_signing_keys=keys),
    )


def test_sigv2_round_trip_with_keyring(
    monkeypatch: pytest.MonkeyPatch,
    fresh_registry: AgentRegistry,
) -> None:
    """With ``AGENT_THREAD_SIGNING_KEYS`` set, ``sign_thread_key`` emits
    sigv2 and the verifier round-trips it back to the original."""
    from app.agents import runtime as runtime_module
    from app.agents.runtime import (
        sign_thread_key,
        _try_verify_signed_thread_key,
    )

    _patch_signing_keys(monkeypatch, ("v1:secret-one", "v2:secret-two"))

    token = sign_thread_key("echo", "u1", "my-thread")
    assert token.startswith(runtime_module._SIGNED_PREFIX_V2)
    assert _try_verify_signed_thread_key(token, "echo", "u1") == "my-thread"


def test_sigv2_uses_active_kid(monkeypatch: pytest.MonkeyPatch) -> None:
    """The active kid is the *last* entry in the keyring so operators
    can roll forward by appending the new secret."""
    from app.agents.runtime import sign_thread_key, _verify_sigv2
    import base64

    _patch_signing_keys(monkeypatch, ("v1:secret-one", "v2:secret-two"))

    token = sign_thread_key("echo", "u1", "thread-x")
    payload = base64.urlsafe_b64decode(token.split(".", 1)[1].encode()).decode()
    assert payload.startswith("v2\x00"), f"expected active kid 'v2' in payload {payload!r}"
    assert _verify_sigv2(token, "echo", "u1") == "thread-x"


def test_sigv2_unknown_kid_returns_none_not_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A token signed with kid=v1 but verified after v1 was rotated out
    returns None (soft failure, falls through to unsigned path)."""
    from app.agents.runtime import sign_thread_key, _try_verify_signed_thread_key

    _patch_signing_keys(monkeypatch, ("v1:secret-one",))
    token = sign_thread_key("echo", "u1", "thread-x")

    # Now rotate v1 out: only v2 remains.
    _patch_signing_keys(monkeypatch, ("v2:secret-two",))

    assert _try_verify_signed_thread_key(token, "echo", "u1") is None


def test_sigv2_cross_user_still_raises_4xx(
    monkeypatch: pytest.MonkeyPatch,
    fresh_registry: AgentRegistry,
) -> None:
    """A sigv2 token issued for one user cannot be replayed under another."""
    from app.agents.errors import InvalidThreadKeyError
    from app.agents.runtime import sign_thread_key

    _patch_signing_keys(monkeypatch, ("v1:secret-one",))
    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    stolen = sign_thread_key("echo", "victim", "their-thread")

    with pytest.raises(InvalidThreadKeyError):
        runtime.build_config(
            runtime.get("echo"),
            thread_id=stolen,
            user_id="attacker",
        )


def test_sigv1_still_accepted_when_keyring_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A legacy sigv1 token issued before rotation still verifies after
    ``AGENT_THREAD_SIGNING_KEYS`` is configured (rolling-restart safety)."""
    from app.agents.runtime import sign_thread_key, _try_verify_signed_thread_key

    # Issue a sigv1 token (env empty).
    _patch_signing_keys(monkeypatch, ())
    legacy = sign_thread_key("echo", "u1", "thread-x")
    assert legacy.startswith("sigv1.")

    # Now flip the env to enable sigv2.  The legacy sigv1 token still
    # verifies because the verifier accepts both prefixes.
    _patch_signing_keys(monkeypatch, ("v1:other-secret",))
    # sigv1 uses jwt_secret regardless of keyring, so verification still works.
    assert _try_verify_signed_thread_key(legacy, "echo", "u1") == "thread-x"


def test_keyring_default_when_env_empty() -> None:
    """An empty ``AGENT_THREAD_SIGNING_KEYS`` resolves to the implicit v1 kid
    backed by ``jwt_secret`` so sigv2 verification is always functional."""
    from app.agents.runtime import _thread_signing_keyring, _LEGACY_KID

    keyring = _thread_signing_keyring()
    assert _LEGACY_KID in keyring
    # Whatever JWT secret the test env has, the keyring's v1 entry equals it.
    from app.config import settings

    assert keyring[_LEGACY_KID] == settings.jwt_secret.encode()


def test_keyring_skips_malformed_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Malformed env entries (missing ':', empty kid) are skipped, not fatal."""
    from app.agents.runtime import _thread_signing_keyring

    _patch_signing_keys(
        monkeypatch, ("no-colon", ":empty-kid", "v1:good")
    )
    keyring = _thread_signing_keyring()
    assert keyring == {"v1": b"good"}


def test_sigv2_malformed_base64_returns_none() -> None:
    """``_verify_sigv2`` returns ``None`` when the body isn't valid base64
    (malformed token from a stale client / random injection)."""
    from app.agents.runtime import _verify_sigv2

    assert _verify_sigv2("sigv2.!!!not-base64!!!", "echo", "u1") is None


def test_sigv2_wrong_field_count_returns_none() -> None:
    """``_verify_sigv2`` returns ``None`` when the decoded payload doesn't
    have the expected five NUL-separated fields (truncated or hand-rolled
    token)."""
    import base64
    from app.agents.runtime import _verify_sigv2

    # Only three fields where five are expected.
    bad = base64.urlsafe_b64encode(b"only\x00three\x00fields").decode()
    assert _verify_sigv2(f"sigv2.{bad}", "echo", "u1") is None


def test_sigv2_hmac_mismatch_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sigv2 token with a tampered HMAC returns None (soft-fail) rather
    than raising, consistent with the rolling-restart safety contract."""
    import base64
    from app.agents.runtime import _verify_sigv2

    _patch_signing_keys(monkeypatch, ("v1:secret-one",))
    payload = "v1\x00echo\x00u1\x00thread-x\x00deadbeef-not-the-real-hmac"
    forged = "sigv2." + base64.urlsafe_b64encode(payload.encode()).decode()
    result = _verify_sigv2(forged, "echo", "u1")
    assert result is None


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


def test_agent_runtime_arun_with_events_translates_recursion_error(
    fresh_registry: AgentRegistry,
) -> None:
    """``arun_with_events`` must translate LangGraph recursion overflow.

    Mirrors :func:`test_agent_runtime_translates_async_recursion_error`
    so the new entry point and ``ainvoke`` agree on error mapping.
    """

    fresh_registry.register(LoopAgent())
    runtime = AgentRuntime(registry=fresh_registry, recursion_limit=3)
    with pytest.raises(AgentRecursionError) as exc:
        asyncio.run(runtime.arun_with_events("loop", {"count": 0}))
    assert exc.value.recursion_limit == 3


def test_agent_runtime_arun_with_events_translates_execution_error(
    fresh_registry: AgentRegistry,
) -> None:
    """A generic exception inside the graph becomes :class:`AgentExecutionError`."""

    fresh_registry.register(BoomAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentExecutionError) as exc:
        asyncio.run(runtime.arun_with_events("boom", {"text": "x"}))
    assert exc.value.cause is not None


def test_agent_runtime_arun_with_events_passes_through_agent_error(
    fresh_registry: AgentRegistry,
) -> None:
    """An ``AgentError`` raised at compile time propagates unchanged."""

    class RaisingAgent(BaseAgent):
        metadata = AgentMetadata(name="raises-arun")

        def build(self, *, checkpointer, store):  # type: ignore[no-untyped-def]
            raise AgentError("custom", status_code=418)

    fresh_registry.register(RaisingAgent())
    runtime = AgentRuntime(registry=fresh_registry)
    with pytest.raises(AgentError) as exc:
        asyncio.run(runtime.arun_with_events("raises-arun", {}))
    assert exc.value.status_code == 418


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

    # With the new _aggregate_tokens_from_payload path the success path does
    # NOT call aget_state; it reads from the final values payload instead.
    # So set_token_usage IS called (with 0, 0 because EchoAgent has no usage
    # metadata), and the aget_state boom is never triggered.
    assert captured == [(0, 0)]


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
    """An AgentError raised during post-loop token aggregation must propagate,
    not be swallowed alongside generic best-effort failures.

    The new success path calls ``_aggregate_tokens_from_payload`` (sync) rather
    than ``aget_state``, so we patch that method directly.
    """
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

    original_agg = runtime._aggregate_tokens_from_payload  # noqa: SLF001

    def boom_agg(payload: Any, run_span: Any) -> None:
        raise AgentExecutionError("echo", message="forced")

    runtime._aggregate_tokens_from_payload = boom_agg  # type: ignore[assignment]  # noqa: SLF001

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
        runtime._aggregate_tokens_from_payload = original_agg  # type: ignore[assignment]  # noqa: SLF001


def test_arun_with_events_captures_custom_stream_events(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 1: custom-mode payloads must be captured and merged into events_out.

    Agents that emit via ``langgraph.types.StreamWriter`` produce ``custom``
    chunks.  Before the fix those were silently discarded; after the fix they
    are appended to the returned events list de-duplicated against the
    state-sourced events list.
    """
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import StreamWriter

    class _CustomEventState(TypedDict, total=False):
        done: bool

    class _CustomEmitterAgent(BaseAgent):
        metadata = AgentMetadata(name="custom-emitter")

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            def emit_node(
                state: _CustomEventState,
                writer: StreamWriter,
            ) -> dict[str, Any]:
                writer({"kind": "custom-ping", "data": "hello"})
                return {"done": True}

            graph = StateGraph(_CustomEventState)
            graph.add_node("emit", emit_node)
            graph.add_edge(START, "emit")
            graph.add_edge("emit", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    agent = _CustomEmitterAgent()
    fresh_registry.register(agent)
    runtime = AgentRuntime(registry=fresh_registry)

    async def run() -> tuple[Any, list[Any]]:
        return await runtime.arun_with_events("custom-emitter", {})

    final_state, events = asyncio.run(run())
    # The custom payload must appear in events_out.
    custom_pings = [e for e in events if isinstance(e, dict) and e.get("kind") == "custom-ping"]
    assert custom_pings, f"expected custom-ping in events, got {events}"
    assert custom_pings[0]["data"] == "hello"


def test_build_context_injects_autonomy_level(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 11: _build_context must inject autonomy_level into ChatContext."""
    from langgraph.runtime import get_runtime

    class _AutonomyState(TypedDict, total=False):
        autonomy: str | None

    class _AutonomyAgent(BaseAgent):
        metadata = AgentMetadata(
            name="autonomy-recorder",
            context_schema=ChatContext,
        )

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            def record(state: _AutonomyState) -> dict[str, Any]:
                rt = get_runtime(ChatContext)
                ctx = rt.context or {}
                return {"autonomy": ctx.get("autonomy_level")}

            graph = StateGraph(_AutonomyState, context_schema=ChatContext)
            graph.add_node("record", record)
            graph.add_edge(START, "record")
            graph.add_edge("record", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    agent = _AutonomyAgent()
    fresh_registry.register(agent)
    runtime = AgentRuntime(registry=fresh_registry)

    async def run() -> Any:
        return await runtime.ainvoke(
            "autonomy-recorder",
            {"autonomy_level": "auto"},
        )

    final = asyncio.run(run())
    assert final.get("autonomy") == "auto"


def test_astream_success_path_swallows_non_agent_error_in_aggregation(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 2: on the success path, if _aggregate_tokens_from_payload raises a
    non-AgentError (e.g. ValueError), it must be swallowed and the stream must
    complete cleanly (lines 991-992 coverage).
    """
    import app.agents.runtime as runtime_mod

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    original_start = runtime_mod.start_run_span
    original_agg = runtime._aggregate_tokens_from_payload  # noqa: SLF001

    def boom_aggregate(payload: Any, run_span: Any) -> None:
        raise ValueError("simulated bad payload")

    runtime._aggregate_tokens_from_payload = boom_aggregate  # type: ignore[method-assign]
    runtime_mod.start_run_span = lambda **_: type(  # type: ignore[assignment]
        "_S",
        (),
        {
            "__enter__": lambda s: s,
            "__exit__": lambda s, *a: None,
            "set_result": lambda s, r: None,
            "set_token_usage": lambda s, i, o: None,
        },
    )()

    try:
        async def collect() -> None:
            async for _ in runtime.astream(
                "echo", {"text": "x"}, context=EchoContext()
            ):
                pass

        # Must complete without error even though aggregation raises ValueError.
        asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]
        runtime._aggregate_tokens_from_payload = original_agg  # type: ignore[method-assign]


def test_astream_failure_path_uses_aget_state_when_no_values_emitted(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 2: on the failure path, when no ``values`` chunk was emitted before
    the error, ``_aggregate_astream_tokens_no_propagate`` falls back to
    ``_aggregate_astream_tokens`` (aget_state path, lines 1055-1067, 1093-1095).

    We force this by patching ``agent.astream`` to raise immediately (before
    yielding any ``values`` tuple), keeping ``_last_values_payload = None``.
    """
    import app.agents.runtime as runtime_mod

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    aget_state_calls: list[int] = []

    class _TrackingSpan:
        def __enter__(self) -> "_TrackingSpan":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            aget_state_calls.append(1)

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: _TrackingSpan()  # type: ignore[assignment]

    agent = fresh_registry.get("echo")
    real_astream = agent.astream

    async def boom_astream(*args: Any, **kwargs: Any) -> Any:
        # Raise before yielding a single event so _last_values_payload stays None.
        raise RuntimeError("no values before boom")
        yield  # make it an async generator

    agent.astream = boom_astream  # type: ignore[method-assign]

    try:
        async def collect() -> None:
            async for _ in runtime.astream("echo", {"text": "x"}):
                pass

        with pytest.raises(AgentExecutionError):
            asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]
        agent.astream = real_astream  # type: ignore[method-assign]

    # set_token_usage must have been called via the aget_state fallback.
    assert aget_state_calls == [1]


def test_async_build_lock_lazy_creation() -> None:
    """Fix 3: ``_async_build_lock`` must be None at construction and created
    lazily on first ``acompile()`` call (Python 3.12+ loop-binding safety).
    """
    agent = EchoAgent()
    # At construction: lock is None.
    assert agent._async_build_lock is None  # noqa: SLF001

    async def compile_once() -> None:
        await agent.acompile()

    asyncio.run(compile_once())
    # After first acompile(): lock is an asyncio.Lock.
    import asyncio as _asyncio

    assert isinstance(agent._async_build_lock, _asyncio.Lock)  # noqa: SLF001


def test_compiled_state_atomic_tuple() -> None:
    """Fix 4: ``_compiled_state`` must store the (compiled, checkpointer, store)
    triple as a single atomic tuple; reading it as one load prevents
    stale-checkpointer pairs under concurrent compile/recompile.
    """
    agent = EchoAgent()
    # Before compile: None.
    assert agent._compiled_state is None  # noqa: SLF001

    saver = InMemorySaver()
    agent.compile(checkpointer=saver)

    state = agent._compiled_state  # noqa: SLF001
    assert state is not None
    compiled, cp, st = state
    assert cp is saver
    assert st is None  # no store passed

    # set_chat_model must clear the whole tuple.
    agent.set_chat_model(object())
    assert agent._compiled_state is None  # noqa: SLF001


def test_arun_with_events_custom_suggestion_validation(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 1: custom events with kind='suggestion' must go through
    validate_suggestion_payload (the same path as state-sourced events).
    """
    from langgraph.types import StreamWriter

    class _SuggestionCustomEmitter(BaseAgent):
        metadata = AgentMetadata(name="suggestion-custom-emitter")

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            def emit_node(
                state: EchoState,
                writer: StreamWriter,
            ) -> dict[str, Any]:
                # Emit a suggestion via the custom channel.
                writer({"kind": "suggestion", "id": "s1", "text": "hello"})
                return {}

            graph = StateGraph(EchoState)
            graph.add_node("emit", emit_node)
            graph.add_edge(START, "emit")
            graph.add_edge("emit", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    agent = _SuggestionCustomEmitter()
    fresh_registry.register(agent)
    runtime = AgentRuntime(registry=fresh_registry)

    async def run() -> list[Any]:
        _fs, events = await runtime.arun_with_events("suggestion-custom-emitter", {})
        return events

    events = asyncio.run(run())
    suggestions = [e for e in events if isinstance(e, dict) and e.get("kind") == "suggestion"]
    assert suggestions, f"expected suggestion event, got {events}"


def test_arun_with_events_custom_mutation_proposal_validation(
    fresh_registry: AgentRegistry,
) -> None:
    """Fix 1: custom events with kind='mutation_proposal' must go through
    validate_mutation_proposal_event (same path as state-sourced events).
    """
    from langgraph.types import StreamWriter

    class _MutationCustomEmitter(BaseAgent):
        metadata = AgentMetadata(name="mutation-custom-emitter")

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            def emit_node(
                state: EchoState,
                writer: StreamWriter,
            ) -> dict[str, Any]:
                writer({"kind": "mutation_proposal", "id": "m1", "op": "add"})
                return {}

            graph = StateGraph(EchoState)
            graph.add_node("emit", emit_node)
            graph.add_edge(START, "emit")
            graph.add_edge("emit", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    agent = _MutationCustomEmitter()
    fresh_registry.register(agent)
    runtime = AgentRuntime(registry=fresh_registry)

    async def run() -> list[Any]:
        _fs, events = await runtime.arun_with_events("mutation-custom-emitter", {})
        return events

    events = asyncio.run(run())
    proposals = [e for e in events if isinstance(e, dict) and e.get("kind") == "mutation_proposal"]
    assert proposals, f"expected mutation_proposal event, got {events}"


def test_lifespan_attaches_runtime(client: TestClient) -> None:
    """The runtime owns a per-app registry chained off the module-level
    default, not the default registry directly.

    Mutations to the runtime's local layer (writes via
    ``runtime.registry.register(...)``) do not bleed into the module
    global, but reads still fall through to the global so test fixtures
    that pre-register there continue to be visible.
    """
    from app.agents.registry import ChainedAgentRegistry

    runtime = main.app.state.agent_runtime
    assert isinstance(runtime, AgentRuntime)
    assert isinstance(runtime.registry, ChainedAgentRegistry)
    # The chained registry's parent is the module-level global, so the
    # production runtime shares read visibility with global_registry.
    assert runtime.registry._parent is global_registry  # noqa: SLF001


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
    assert "recursion_limit" in body
    assert isinstance(body.get("monthly_token_budget_cap"), int)


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
        err_body = response.json()["error"]
        assert err_body["code"] == "agent_configuration"
        assert "Unsupported context schema" in err_body["message"]
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
    ai_rate_limit_backend,
) -> None:
    from dataclasses import replace

    ai_rate_limit_backend.reset()
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
    rate_body = second.json()
    assert rate_body["error"]["code"] == "rate_limit_exceeded"
    assert rate_body["error"]["message"] == "rate limit exceeded"
    ai_rate_limit_backend.reset()


def test_async_resolve_project_id_reads_sync_checkpoint_tuple() -> None:
    """Checkpointers with only ``get_tuple`` still supply resume ``project_id``."""

    from app.routers.agents import _async_resolve_project_id_for_turn

    class _CheckpointTuple:
        metadata = {"project_id": "p-from-sync-checkpoint"}

    class _SyncOnlyCheckpointer:
        def get_tuple(self, _config: dict[str, Any]) -> _CheckpointTuple:
            return _CheckpointTuple()

    class _StubRuntime:
        checkpointer = _SyncOnlyCheckpointer()

        def get(self, _name: str) -> object:
            return object()

        def build_config(
            self, _agent: object, *, thread_id: str, user_id: str
        ) -> dict[str, Any]:
            return {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def _run() -> Optional[str]:
        return await _async_resolve_project_id_for_turn(
            _StubRuntime(),  # type: ignore[arg-type]
            "echo",
            "user-1",
            {"thread_id": "resume-thread"},
            {},
            resuming=True,
        )

    assert asyncio.run(_run()) == "p-from-sync-checkpoint"


def test_async_resolve_project_id_sync_checkpoint_without_get_tuple() -> None:
    from app.routers.agents import _async_resolve_project_id_for_turn

    class _NoTupleCheckpointer:
        pass

    class _StubRuntime:
        checkpointer = _NoTupleCheckpointer()

        def get(self, _name: str) -> object:
            return object()

        def build_config(
            self, _agent: object, *, thread_id: str, user_id: str
        ) -> dict[str, Any]:
            return {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def _run() -> Optional[str]:
        return await _async_resolve_project_id_for_turn(
            _StubRuntime(),  # type: ignore[arg-type]
            "echo",
            "user-1",
            {"thread_id": "resume-thread"},
            {},
            resuming=True,
        )

    assert asyncio.run(_run()) is None


def test_async_resolve_project_id_sync_checkpoint_lookup_failure() -> None:
    from app.routers.agents import _async_resolve_project_id_for_turn

    class _BrokenCheckpointer:
        def get_tuple(self, _config: dict[str, Any]) -> Any:
            raise RuntimeError("checkpoint read failed")

    class _StubRuntime:
        checkpointer = _BrokenCheckpointer()

        def get(self, _name: str) -> object:
            return object()

        def build_config(
            self, _agent: object, *, thread_id: str, user_id: str
        ) -> dict[str, Any]:
            return {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def _run() -> Optional[str]:
        return await _async_resolve_project_id_for_turn(
            _StubRuntime(),  # type: ignore[arg-type]
            "echo",
            "user-1",
            {"thread_id": "resume-thread"},
            {},
            resuming=True,
        )

    assert asyncio.run(_run()) is None


def test_async_resolve_project_id_sync_checkpoint_returns_none_tuple() -> None:
    from app.routers.agents import _async_resolve_project_id_for_turn

    class _SyncOnlyCheckpointer:
        def get_tuple(self, _config: dict[str, Any]) -> None:
            return None

    class _StubRuntime:
        checkpointer = _SyncOnlyCheckpointer()

        def get(self, _name: str) -> object:
            return object()

        def build_config(
            self, _agent: object, *, thread_id: str, user_id: str
        ) -> dict[str, Any]:
            return {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def _run() -> Optional[str]:
        return await _async_resolve_project_id_for_turn(
            _StubRuntime(),  # type: ignore[arg-type]
            "echo",
            "user-1",
            {"thread_id": "resume-thread"},
            {},
            resuming=True,
        )

    assert asyncio.run(_run()) is None


def test_async_resolve_project_id_ignores_empty_checkpoint_metadata() -> None:
    from app.routers.agents import _async_resolve_project_id_for_turn

    class _CheckpointTuple:
        metadata = "not-a-dict"

    class _SyncOnlyCheckpointer:
        def get_tuple(self, _config: dict[str, Any]) -> _CheckpointTuple:
            return _CheckpointTuple()

    class _StubRuntime:
        checkpointer = _SyncOnlyCheckpointer()

        def get(self, _name: str) -> object:
            return object()

        def build_config(
            self, _agent: object, *, thread_id: str, user_id: str
        ) -> dict[str, Any]:
            return {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def _run() -> Optional[str]:
        return await _async_resolve_project_id_for_turn(
            _StubRuntime(),  # type: ignore[arg-type]
            "echo",
            "user-1",
            {"thread_id": "resume-thread"},
            {},
            resuming=True,
        )

    assert asyncio.run(_run()) is None


def test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend,
) -> None:
    """Resume must enforce budget using project_id from the initial checkpoint."""

    from app.middleware.budget import DEFAULT_MONTHLY_TOKEN_CAP

    agent = _InterruptingAgent()
    global_registry.register(agent)
    thread_id = "http-resume-budget-no-project-id"
    try:
        ai_budget_backend.reset()
        first = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={
                "inputs": {"started": False, "project_id": "p-budget-agent"},
                "thread_id": thread_id,
            },
            headers=auth_headers,
        )
        assert first.status_code == HTTPStatus.OK
        assert "__interrupt__" in first.json()["result"]

        ai_budget_backend.reset()
        monkeypatch.setattr(ai_budget_backend, "monthly_cap", 0)

        second = client.post(
            "/api/v1/agents/interrupting/invoke",
            json={
                "command": {"resume": "value-from-fe"},
                "thread_id": thread_id,
            },
            headers=auth_headers,
        )
        assert second.status_code == HTTPStatus.PAYMENT_REQUIRED
        assert second.headers.get("X-Reason") == "budget"
    finally:
        global_registry.unregister(agent.name)
        monkeypatch.setattr(
            ai_budget_backend,
            "monthly_cap",
            DEFAULT_MONTHLY_TOKEN_CAP,
        )
        ai_budget_backend.reset()


def test_router_invoke_returns_402_when_budget_exhausted(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend,
) -> None:
    from app.middleware.budget import DEFAULT_MONTHLY_TOKEN_CAP

    ai_budget_backend.reset()
    monkeypatch.setattr(ai_budget_backend, "monthly_cap", 0)

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x", "project_id": "p-budget-agent"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.PAYMENT_REQUIRED
    assert response.headers.get("X-Reason") == "budget"
    budget_body = response.json()
    assert budget_body["error"]["code"] == "budget_exhausted"
    assert budget_body["error"]["message"] == "project budget exhausted"
    monkeypatch.setattr(
        ai_budget_backend,
        "monthly_cap",
        DEFAULT_MONTHLY_TOKEN_CAP,
    )
    ai_budget_backend.reset()


def test_router_records_usage_on_successful_invoke(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    ai_budget_backend,
) -> None:
    from app.middleware.budget import DEFAULT_MONTHLY_TOKEN_CAP

    ai_budget_backend.reset()
    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x", "project_id": "p-record"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert (
        ai_budget_backend.remaining("p-record") < DEFAULT_MONTHLY_TOKEN_CAP
    )
    ai_budget_backend.reset()


def test_router_records_usage_after_stream_completes(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    ai_budget_backend,
) -> None:
    from app.middleware.budget import DEFAULT_MONTHLY_TOKEN_CAP

    ai_budget_backend.reset()
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
        ai_budget_backend.remaining("p-stream-record")
        < DEFAULT_MONTHLY_TOKEN_CAP
    )
    ai_budget_backend.reset()


def test_router_invoke_agent_error_returns_nested_code(
    client: TestClient,
    echo_in_global_registry: EchoAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.errors import AgentConfigurationError

    runtime = client.app.state.agent_runtime

    async def boom(*args: object, **kwargs: object) -> dict[str, object]:
        raise AgentConfigurationError("misconfigured")

    monkeypatch.setattr(runtime, "ainvoke", boom, raising=False)

    response = client.post(
        "/api/v1/agents/echo/invoke",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    body = response.json()
    assert body["error"]["code"] == "agent_configuration"
    assert body["error"]["message"] == "misconfigured"


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
    # Phase 2: chat-agent no longer emits mid-stream kind=usage events;
    # token accounting flows through AIMessage.usage_metadata at run-end.


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


def test_arun_with_events_deduplicates_custom_event_already_in_state(
    fresh_registry: AgentRegistry,
) -> None:
    """Line 885: the ``continue`` in the custom-events dedup loop must be hit
    when a custom-stream event's object identity matches one already in
    state_event_ids.

    We simulate this by patching ``_build_context`` so the agent never runs
    (we call ``arun_with_events`` with a no-op agent) and directly manipulate
    the state to ensure the same Python object appears in both sets.
    """
    from langgraph.types import StreamWriter

    class _DedupeState(TypedDict, total=False):
        events: list[dict]

    # Build a shared event object that is BOTH returned in state AND emitted
    # as a custom chunk via the same object reference.
    shared_evt: dict = {"kind": "test-dedup", "payload": 42}

    class _DedupeAgent(BaseAgent):
        metadata = AgentMetadata(name="dedup-agent")

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            def emit_node(
                state: _DedupeState,
                writer: StreamWriter,
            ) -> dict[str, Any]:
                # Return the shared object in state AND write via custom channel.
                writer(shared_evt)
                return {"events": [shared_evt]}

            graph = StateGraph(_DedupeState)
            graph.add_node("emit", emit_node)
            graph.add_edge(START, "emit")
            graph.add_edge("emit", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    agent = _DedupeAgent()
    fresh_registry.register(agent)
    runtime = AgentRuntime(registry=fresh_registry)

    async def run() -> tuple[Any, list[Any]]:
        return await runtime.arun_with_events("dedup-agent", {})

    _final, events = asyncio.run(run())
    # The shared_evt should appear exactly once (de-duplicated).
    matching = [e for e in events if isinstance(e, dict) and e.get("kind") == "test-dedup"]
    assert len(matching) == 1, f"expected 1 deduped event, got {matching}"


def test_aggregate_astream_tokens_covers_messages_loop(
    fresh_registry: AgentRegistry,
) -> None:
    """Lines 1064-1066: the for-loop body of ``_aggregate_astream_tokens`` must
    run when ``aget_state`` returns messages.

    We set up an agent that writes a dummy message to state, then patch
    ``agent.astream`` to raise AFTER the agent has actually run once
    (storing state in the checkpointer).  The failure path then calls
    ``_aggregate_astream_tokens`` which reads back non-empty messages.
    """
    import app.agents.runtime as runtime_mod

    class _MsgState(TypedDict, total=False):
        messages: list[Any]

    class _MessageWriterAgent(BaseAgent):
        metadata = AgentMetadata(name="msg-writer")

        def build(
            self,
            *,
            checkpointer: Optional[BaseCheckpointSaver],
            store: Optional[BaseStore],
        ) -> Pregel:
            from langchain_core.messages import AIMessage

            def write_node(state: _MsgState) -> dict[str, Any]:
                return {"messages": [AIMessage(content="hello")]}

            graph = StateGraph(_MsgState)
            graph.add_node("write", write_node)
            graph.add_edge(START, "write")
            graph.add_edge("write", END)
            return graph.compile(checkpointer=checkpointer, store=store)

    fresh_registry.register(_MessageWriterAgent())
    saver = InMemorySaver()
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=saver)

    token_calls: list[tuple[int, int]] = []

    class _TrackingSpan:
        def __enter__(self) -> "_TrackingSpan":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def set_token_usage(self, tokens_in: int, tokens_out: int) -> None:
            token_calls.append((tokens_in, tokens_out))

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: _TrackingSpan()  # type: ignore[assignment]

    # First, run the agent normally so the checkpointer has state.
    agent = fresh_registry.get("msg-writer")
    real_astream = agent.astream
    thread_id = "msg-writer-test-1"

    async def run_then_boom() -> None:
        # Run once successfully to store state.
        async for _ in runtime.astream(
            "msg-writer", {"messages": []}, thread_id=thread_id
        ):
            pass
        # Now patch astream to raise immediately (no values emitted).
        boom_called = False

        async def boom_astream(*args: Any, **kwargs: Any) -> Any:
            nonlocal boom_called
            boom_called = True
            raise RuntimeError("boom after state stored")
            yield  # noqa: unreachable -- makes it an async generator

        agent.astream = boom_astream  # type: ignore[method-assign]
        try:
            async for _ in runtime.astream(
                "msg-writer", {}, thread_id=thread_id
            ):
                pass
        except AgentExecutionError:
            pass
        finally:
            agent.astream = real_astream  # type: ignore[method-assign]

    try:
        asyncio.run(run_then_boom())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]

    # The second run's failure path should have called set_token_usage with
    # tokens read from the stored state.
    assert len(token_calls) >= 2, f"expected >=2 calls, got {token_calls}"


def test_aggregate_astream_tokens_no_propagate_swallows_aggregate_error(
    fresh_registry: AgentRegistry,
) -> None:
    """Lines 1094-1095: the ``except`` clause in
    ``_aggregate_astream_tokens_no_propagate`` must be hit when
    ``_aggregate_astream_tokens`` raises on the no-payload failure path.
    """
    import app.agents.runtime as runtime_mod

    fresh_registry.register(EchoAgent())
    runtime = AgentRuntime(registry=fresh_registry, checkpointer=InMemorySaver())

    original_start = runtime_mod.start_run_span
    runtime_mod.start_run_span = lambda **_: type(  # type: ignore[assignment]
        "_S",
        (),
        {
            "__enter__": lambda s: s,
            "__exit__": lambda s, *a: None,
            "set_result": lambda s, r: None,
            "set_token_usage": lambda s, i, o: None,
        },
    )()

    agent = fresh_registry.get("echo")
    real_astream = agent.astream
    original_agg = runtime._aggregate_astream_tokens  # noqa: SLF001

    async def boom_agg(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("agg boom in no_propagate")

    runtime._aggregate_astream_tokens = boom_agg  # type: ignore[method-assign]  # noqa: SLF001

    async def boom_astream(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("no values before boom")
        yield  # noqa: unreachable -- makes it an async generator

    agent.astream = boom_astream  # type: ignore[method-assign]

    try:
        async def collect() -> None:
            async for _ in runtime.astream("echo", {"text": "x"}):
                pass

        # Must propagate AgentExecutionError (not the RuntimeError from agg).
        with pytest.raises(AgentExecutionError):
            asyncio.run(collect())
    finally:
        runtime_mod.start_run_span = original_start  # type: ignore[assignment]
        runtime._aggregate_astream_tokens = original_agg  # type: ignore[method-assign]  # noqa: SLF001
        agent.astream = real_astream  # type: ignore[method-assign]


class _ApiIoFailure(Exception):
    """Module-level: qualname = '_ApiIoFailure', no network markers in name."""


_ApiIoFailure.__module__ = "requests.exceptions"


def test_agent_execution_error_classifies_module_based_error() -> None:
    """errors.py line 43: the module-based network-error branch must be
    reachable when the exception's class-qualname does not contain a network
    marker but its ``__module__`` does (e.g. a plain Exception from the
    ``requests`` package).

    The class is defined at module level so its qualname is just
    ``_ApiIoFailure`` (no function name prefix that could contain "network").
    """
    from app.agents.errors import AgentExecutionError

    exc = AgentExecutionError("echo", cause=_ApiIoFailure("api failed"))
    assert exc.detail["error"]["details"]["cause_kind"] == "network_error"


# ---------------------------------------------------------------------------
# Coverage for llm.py:555-562 — extract_cache_token_usage
# ---------------------------------------------------------------------------


def test_extract_cache_token_usage_none_message() -> None:
    """llm.py line 555-556: None input returns (0, 0) immediately."""
    from app.agents.llm import extract_cache_token_usage

    assert extract_cache_token_usage(None) == (0, 0)


def test_extract_cache_token_usage_with_dict_metadata() -> None:
    """llm.py lines 558-561: dict usage_metadata returns (read, creation)."""
    from langchain_core.messages import AIMessage

    from app.agents.llm import extract_cache_token_usage

    msg = AIMessage(
        content="hi",
        usage_metadata={
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15,
            "cache_read_input_tokens": 7,
            "cache_creation_input_tokens": 3,
        },
    )
    assert extract_cache_token_usage(msg) == (7, 3)


def test_extract_cache_token_usage_no_cache_fields() -> None:
    """llm.py line 562: dict usage_metadata without cache keys returns (0, 0)."""
    from langchain_core.messages import AIMessage

    from app.agents.llm import extract_cache_token_usage

    msg = AIMessage(content="hi", usage_metadata={"input_tokens": 5, "output_tokens": 2, "total_tokens": 7})
    assert extract_cache_token_usage(msg) == (0, 0)


def test_extract_cache_token_usage_non_dict_metadata() -> None:
    """llm.py line 562: non-dict usage_metadata (e.g. None attr) returns (0, 0)."""
    from app.agents.llm import extract_cache_token_usage

    class _FakeMsg:
        usage_metadata = None

    assert extract_cache_token_usage(_FakeMsg()) == (0, 0)


# ---------------------------------------------------------------------------
# Coverage for task_vector_pg.py:107 — fetch_vector_neighbours_for_project_async
# ---------------------------------------------------------------------------


def test_fetch_vector_neighbours_for_project_async_delegates_to_sync() -> None:
    """task_vector_pg.py line 107: async wrapper calls sync function via to_thread."""
    from unittest.mock import patch

    from app.agents import task_vector_pg
    from app.config import Settings

    cfg = Settings(agent_vector_search_enabled=False)
    captured: list[dict] = []

    def fake_sync(**kwargs: object) -> list:
        captured.append(dict(kwargs))
        return []

    async def _run() -> None:
        with patch.object(
            task_vector_pg,
            "fetch_vector_neighbours_for_project",
            fake_sync,
        ):
            result = await task_vector_pg.fetch_vector_neighbours_for_project_async(
                project_id="proj",
                query_embedding=[0.1, 0.2],
                settings=cfg,
            )
        assert result == []
        assert captured[0]["project_id"] == "proj"

    asyncio.run(_run())
