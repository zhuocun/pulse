"""v2.1 router tests for FE-shaped SSE envelope, autonomy, status, timeout."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from http import HTTPStatus
from typing import Any, AsyncIterator, Iterable, Optional

import pytest
from fastapi.testclient import TestClient
from pytest import FixtureRequest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import interrupt
from typing_extensions import TypedDict

from app import main
from app import security
from app.agents import AgentMetadata, BaseAgent
from app.agents.registry import registry as global_registry
from app.middleware import budget as budget_module
from app.middleware import rate_limit as rate_limit_module
from app.security import create_token
from tests.conftest import FakeStore, seed_agent_test_projects_if_absent


class _Probe(TypedDict, total=False):
    text: str


class _NoiseAgent(BaseAgent):
    """Agent that emits one of every envelope type for wire-format tests."""

    metadata = AgentMetadata(
        name="noise",
        description="Test agent: emits all envelope variants.",
        version="1.0.0",
        recursion_limit=4,
        allowed_autonomy=("suggest", "plan"),
        rate_limit=(60, 600),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def speak(state: _Probe) -> dict[str, Any]:
            writer = get_stream_writer()
            writer(
                {
                    "kind": "citation",
                    "refs": [{"source": "user", "id": "x", "quote": "y"}],
                }
            )
            writer({"kind": "usage", "tokensIn": 3, "tokensOut": 7})
            return {"text": "hi"}

        graph: StateGraph = StateGraph(_Probe)
        graph.add_node("speak", speak)
        graph.add_edge(START, "speak")
        graph.add_edge("speak", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class _InterruptingAgent(BaseAgent):
    metadata = AgentMetadata(
        name="halt",
        description="Test agent that always interrupts.",
        version="1.0.0",
        recursion_limit=4,
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def gate(state: _Probe) -> dict[str, Any]:
            value = interrupt({"tool": "fe.boardSnapshot", "args": {"project_id": "p"}})
            return {"text": str(value)}

        graph: StateGraph = StateGraph(_Probe)
        graph.add_node("gate", gate)
        graph.add_edge(START, "gate")
        graph.add_edge("gate", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class _ShadowAgent(BaseAgent):
    metadata = AgentMetadata(name="shadow", description="hidden", status="shadow")

    def build(
        self, *, checkpointer: Any, store: Any
    ) -> Pregel:  # pragma: no cover - never invoked
        graph: StateGraph = StateGraph(_Probe)
        graph.add_node("noop", lambda state: {"text": "x"})
        graph.add_edge(START, "noop")
        graph.add_edge("noop", END)
        return graph.compile(checkpointer=checkpointer, store=store)


class _DeprecatedAgent(BaseAgent):
    metadata = AgentMetadata(
        name="legacy",
        description="kept for backwards compat",
        status="deprecated",
        rate_limit=(60, 600),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def noop(state: _Probe) -> dict[str, Any]:
            return {"text": "old"}

        graph: StateGraph = StateGraph(_Probe)
        graph.add_node("noop", noop)
        graph.add_edge(START, "noop")
        graph.add_edge("noop", END)
        return graph.compile(checkpointer=checkpointer, store=store)


@pytest.fixture()
def client(request: FixtureRequest) -> Iterable[TestClient]:
    store: FakeStore = request.getfixturevalue("store")
    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("router-user")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def reset_state() -> Iterable[None]:
    rate_limit_module.rate_limiter.reset()
    budget_module.budget_tracker.reset()
    yield
    rate_limit_module.rate_limiter.reset()
    budget_module.budget_tracker.reset()


@pytest.fixture()
def noise_agent() -> Iterable[_NoiseAgent]:
    agent = _NoiseAgent()
    global_registry.register(agent)
    try:
        yield agent
    finally:
        global_registry.unregister(agent.name)


@pytest.fixture()
def shadow_agent() -> Iterable[_ShadowAgent]:
    agent = _ShadowAgent()
    global_registry.register(agent)
    try:
        yield agent
    finally:
        global_registry.unregister(agent.name)


@pytest.fixture()
def deprecated_agent() -> Iterable[_DeprecatedAgent]:
    agent = _DeprecatedAgent()
    global_registry.register(agent)
    try:
        yield agent
    finally:
        global_registry.unregister(agent.name)


def _frames(body: str) -> list[Any]:
    parsed = []
    for chunk in body.split("\n\n"):
        if not chunk:
            continue
        if chunk == "data: [DONE]":
            continue
        parsed.append(json.loads(chunk.removeprefix("data: ")))
    return parsed


def test_stream_emits_fe_shaped_envelopes(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    with client.stream(
        "POST",
        "/api/v1/agents/noise/stream",
        json={"inputs": {"text": "hi"}},
        headers=auth_headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        body = b"".join(response.iter_bytes()).decode("utf-8")
    frames = _frames(body)
    assert any(
        frame["type"] == "custom" and frame["data"]["kind"] == "citation"
        for frame in frames
    )
    assert any(
        frame["type"] == "custom" and frame["data"]["kind"] == "usage"
        for frame in frames
    )


def test_stream_lifts_interrupts_to_typed_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    agent = _InterruptingAgent()
    global_registry.register(agent)
    try:
        with client.stream(
            "POST",
            "/api/v1/agents/halt/stream",
            json={"inputs": {"text": "x"}, "thread_id": "halt-thread"},
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            body = b"".join(response.iter_bytes()).decode("utf-8")
        frames = _frames(body)
        assert any(
            frame["type"] == "interrupt"
            and frame["data"].get("tool") == "fe.boardSnapshot"
            for frame in frames
        )
    finally:
        global_registry.unregister(agent.name)


def test_invoke_forbidden_when_project_id_not_managed(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={
            "inputs": {"text": "x", "project_id": "p-budget-agent"},
            "autonomy": "plan",
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN


def test_invoke_validates_autonomy_against_allowed(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "autonomy": "auto"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert "auto" in response.json().get("error", "")


def test_invoke_accepts_allowed_autonomy(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "autonomy": "plan"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_invoke_rejects_unknown_autonomy_string(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "autonomy": "ascend"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_invoke_rejects_non_string_autonomy(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "autonomy": 7},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_normalize_payload_hoists_configurable_fields(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={
            "input": {"text": "y"},
            "config": {
                "configurable": {
                    "thread_id": "from-config",
                    "autonomy": "plan",
                    "project_id": "p-cfg",
                }
            },
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_normalize_payload_rejects_user_id_in_configurable(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={
            "input": {"text": "y"},
            "config": {"configurable": {"user_id": "spoof"}},
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST


def test_normalize_payload_passes_through_when_no_config(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "y"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_normalize_payload_handles_non_dict_config(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "y"}, "config": "nope"},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_normalize_payload_handles_non_dict_configurable(
    client: TestClient, noise_agent: _NoiseAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "y"}, "config": {"configurable": "nope"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK


def test_list_agents_hides_shadow(
    client: TestClient,
    noise_agent: _NoiseAgent,
    shadow_agent: _ShadowAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.get("/api/v1/agents", headers=auth_headers)
    body = response.json()
    names = {meta["name"] for meta in body["agents"]}
    assert "noise" in names
    assert "shadow" not in names


def test_get_shadow_agent_404s(
    client: TestClient, shadow_agent: _ShadowAgent, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/agents/shadow", headers=auth_headers)
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_invoke_shadow_agent_404s(
    client: TestClient, shadow_agent: _ShadowAgent, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/agents/shadow/invoke",
        json={"inputs": {}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_invoke_deprecated_agent_emits_deprecation_header(
    client: TestClient,
    deprecated_agent: _DeprecatedAgent,
    auth_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/agents/legacy/invoke",
        json={"inputs": {}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    assert response.headers.get("Deprecation") == "true"


def test_stream_deprecated_agent_emits_deprecation_header(
    client: TestClient,
    deprecated_agent: _DeprecatedAgent,
    auth_headers: dict[str, str],
) -> None:
    with client.stream(
        "POST",
        "/api/v1/agents/legacy/stream",
        json={"inputs": {}},
        headers=auth_headers,
    ) as response:
        assert response.status_code == HTTPStatus.OK
        assert response.headers.get("Deprecation") == "true"
        b"".join(response.iter_bytes())


def test_invoke_returns_504_on_timeout(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(2)
        return {"text": "never"}

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "ainvoke", slow, raising=False)
    monkeypatch.setattr("app.routers.agents.settings", _settings_with_timeout(1))

    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.GATEWAY_TIMEOUT


def _settings_with_timeout(seconds: int) -> Any:
    from app.config import settings as cfg

    return replace(cfg, agent_request_timeout_seconds=seconds)


def test_stream_returns_error_envelope_on_timeout(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow_stream(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        await asyncio.sleep(2)
        yield ("updates", {"unreached": True})

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "astream", slow_stream, raising=False)
    monkeypatch.setattr("app.routers.agents.settings", _settings_with_timeout(1))

    with client.stream(
        "POST",
        "/api/v1/agents/noise/stream",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    ) as response:
        body = b"".join(response.iter_bytes()).decode("utf-8")
    frames = _frames(body)
    assert any(frame.get("type") == "error" for frame in frames)


def test_stream_emits_error_envelope_on_runtime_failure(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.errors import AgentExecutionError

    async def boom(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        raise AgentExecutionError("noise", cause=RuntimeError("nope"))
        yield  # pragma: no cover

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "astream", boom, raising=False)

    with client.stream(
        "POST",
        "/api/v1/agents/noise/stream",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    ) as response:
        body = b"".join(response.iter_bytes()).decode("utf-8")
    frames = _frames(body)
    assert any(frame.get("type") == "error" for frame in frames)


def test_stream_emits_error_envelope_on_unexpected_exception(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def boom(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        raise RuntimeError("boom")
        yield  # pragma: no cover

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "astream", boom, raising=False)

    with client.stream(
        "POST",
        "/api/v1/agents/noise/stream",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    ) as response:
        body = b"".join(response.iter_bytes()).decode("utf-8")
    frames = _frames(body)
    assert any(frame.get("type") == "error" for frame in frames)


def test_invoke_returns_real_usage_when_chat_model_reports_tokens(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    chat_agent = client.app.state.agent_runtime.get("chat-agent")

    class _ScriptedModel:
        async def ainvoke(self, _messages: Any, **_: Any) -> AIMessage:
            return AIMessage(
                content="ok",
                usage_metadata={
                    "input_tokens": 12,
                    "output_tokens": 8,
                    "total_tokens": 20,
                },
            )

        def invoke(self, _messages: Any, **_: Any) -> AIMessage:
            return AIMessage(
                content="ok",
                usage_metadata={
                    "input_tokens": 12,
                    "output_tokens": 8,
                    "total_tokens": 20,
                },
            )

        # Real providers expose ``bind_tools`` to attach an OpenAI/Anthropic
        # tool catalogue; the chat-agent calls it now that PRD §5A.6 §4
        # binds the FE-executed read tools. The fake just returns ``self``
        # so the bound runnable still exposes ``ainvoke`` / ``invoke``.
        def bind_tools(self, _tools: Any, **_: Any) -> "_ScriptedModel":
            return self

    chat_agent.set_chat_model(_ScriptedModel())
    try:
        response = client.post(
            "/api/v1/agents/chat-agent/invoke",
            json={
                "inputs": {
                    "messages": [{"role": "user", "content": "hi"}],
                    "project_id": "p-real",
                }
            },
            headers=auth_headers,
        )
    finally:
        chat_agent.set_chat_model(None)
        chat_agent._chat_model_resolved = False
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["usage"]["tokensIn"] == 12
    assert body["usage"]["tokensOut"] == 8


def test_invoke_records_usage_against_budget(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    chat_agent = client.app.state.agent_runtime.get("chat-agent")
    starting = budget_module.budget_tracker.remaining("p-budget-track")
    response = client.post(
        "/api/v1/agents/chat-agent/invoke",
        json={
            "inputs": {
                "messages": [{"role": "user", "content": "hello"}],
                "project_id": "p-budget-track",
            }
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.OK
    after = budget_module.budget_tracker.remaining("p-budget-track")
    assert after < starting
    assert chat_agent  # used


def test_to_jsonable_falls_back_to_placeholder() -> None:
    from app.agents.sse import _to_jsonable

    class _Bad:
        def __repr__(self) -> str:
            return "<bad>"

    assert _to_jsonable(_Bad()) == {"__unserializable__": "_Bad"}
    assert _to_jsonable({"a": 1}) == {"a": 1}


def test_invoke_records_idempotency_miss_metric(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
) -> None:
    """Tier 9: a fresh successful run records ``idempotency_cache_total`` miss.

    Spins up the prometheus_client Counter for the duration of the
    test (mirroring :mod:`tests.test_observability` reset pattern) so
    a real ``_value.get()`` introspection works without polluting any
    other case.
    """

    from app.config import settings as app_settings
    from app.observability import metrics as metrics_module

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        headers = {**auth_headers, "Idempotency-Key": "metric-miss"}
        response = client.post(
            "/api/v1/agents/noise/invoke",
            json={"inputs": {"text": "ping"}, "autonomy": "plan"},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        miss_value = metrics_module.idempotency_cache_total.labels(
            route="/api/v1/agents/noise/invoke", outcome="miss"
        )._value.get()
        assert miss_value == 1.0

        # A second request with the same key reuses the cached body
        # and records a hit + a replay invocation.
        response = client.post(
            "/api/v1/agents/noise/invoke",
            json={"inputs": {"text": "ping"}, "autonomy": "plan"},
            headers=headers,
        )
        assert response.status_code == HTTPStatus.OK
        assert response.headers.get("Idempotent-Replay") == "true"
        hit_value = metrics_module.idempotency_cache_total.labels(
            route="/api/v1/agents/noise/invoke", outcome="hit"
        )._value.get()
        replay_value = metrics_module.agent_invocations_total.labels(
            agent="noise", outcome="replay"
        )._value.get()
        assert hit_value == 1.0
        assert replay_value == 1.0
    finally:
        metrics_module.reset_for_tests()


def test_runtime_emits_span_and_invocation_metric(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
) -> None:
    """Tier 9: ``runtime.ainvoke`` round-trips through the OTel span +
    Prometheus counter when the operator opts in.

    Combined into one case because the OTel + Prometheus reset paths
    are coupled (the autouse cleanup in
    :mod:`tests.test_observability` is the canonical pattern; here
    the local try/finally keeps the rest of the file unaffected).
    """

    from app.config import settings as app_settings
    from app.observability import metrics as metrics_module
    from app.observability import otel as otel_module
    from app.observability.otel import get_tracer

    otel_module.configure_otel(settings=replace(app_settings, otel_tracing=True))
    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        # The configured provider is the SDK ``TracerProvider``, not
        # the no-op proxy the rest of the test suite sees.
        with get_tracer().start_as_current_span("smoke") as span:
            assert span.is_recording() is True

        response = client.post(
            "/api/v1/agents/noise/invoke",
            json={"inputs": {"text": "hi"}, "autonomy": "plan"},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.OK
        success_value = metrics_module.agent_invocations_total.labels(
            agent="noise", outcome="success"
        )._value.get()
        assert success_value >= 1.0
    finally:
        metrics_module.reset_for_tests()
        otel_module.reset_for_tests()
