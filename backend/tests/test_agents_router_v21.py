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
from app.middleware.budget import BudgetTracker
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
    body = response.json()
    assert body["error"]["code"] == "autonomy_forbidden"
    assert "auto" in body["error"]["message"]


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
        await asyncio.Event().wait()
        return {"text": "never"}

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "ainvoke", slow, raising=False)
    monkeypatch.setattr("app.routers.agents.settings", _settings_with_timeout(0.1))

    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.GATEWAY_TIMEOUT


def test_invoke_timeout_refunds_reserved_budget(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Budget pre-books before the run; timeouts must not strand the reservation."""

    async def slow(*args: Any, **kwargs: Any) -> Any:
        await asyncio.Event().wait()
        return {"text": "never"}

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "ainvoke", slow, raising=False)
    monkeypatch.setattr("app.routers.agents.settings", _settings_with_timeout(0.1))

    project_id = "p-budget-track"
    remaining_before = ai_budget_backend.remaining(project_id)
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={
            "inputs": {"text": "x", "project_id": project_id},
            "autonomy": "plan",
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.GATEWAY_TIMEOUT
    assert ai_budget_backend.remaining(project_id) == remaining_before


def _settings_with_timeout(seconds: float) -> Any:
    from app.config import settings as cfg

    return replace(cfg, agent_request_timeout_seconds=seconds)


def test_stream_returns_error_envelope_on_timeout(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def slow_stream(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        await asyncio.Event().wait()
        yield ("updates", {"unreached": True})

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "astream", slow_stream, raising=False)
    monkeypatch.setattr("app.routers.agents.settings", _settings_with_timeout(0.1))

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


def test_stream_runtime_failure_refunds_reserved_budget(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Astream errors before emitting usage must revert the gate reservation."""

    from app.agents.errors import AgentExecutionError

    async def boom(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        raise AgentExecutionError("noise", cause=RuntimeError("nope"))
        yield  # pragma: no cover

    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "astream", boom, raising=False)

    project_id = "p-budget-track"
    remaining_before = ai_budget_backend.remaining(project_id)
    with client.stream(
        "POST",
        "/api/v1/agents/noise/stream",
        json={
            "inputs": {"text": "x", "project_id": project_id},
            "autonomy": "plan",
        },
        headers=auth_headers,
    ) as response:
        b"".join(response.iter_bytes())
    assert ai_budget_backend.remaining(project_id) == remaining_before


def test_stream_refunds_budget_when_setup_fails_after_reserve(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """Reserved tokens must be released if we error before returning StreamingResponse."""

    class _BoomStreamingResponse:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise RuntimeError("streaming response init failed")

    monkeypatch.setattr("app.routers.agents.StreamingResponse", _BoomStreamingResponse)
    project_id = "p-budget-track"
    remaining_before = ai_budget_backend.remaining(project_id)
    lax = TestClient(client.app, raise_server_exceptions=False)
    response = lax.post(
        "/api/v1/agents/noise/stream",
        json={
            "inputs": {"text": "x", "project_id": project_id},
            "autonomy": "plan",
        },
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert ai_budget_backend.remaining(project_id) == remaining_before


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


def test_stream_emits_real_usage_when_chat_model_reports_tokens(
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

        def bind_tools(self, _tools: Any, **_: Any) -> "_ScriptedModel":
            return self

    chat_agent.set_chat_model(_ScriptedModel())
    try:
        with client.stream(
            "POST",
            "/api/v1/agents/chat-agent/stream",
            json={
                "inputs": {
                    "messages": [{"role": "user", "content": "hi"}],
                    "project_id": "p-real",
                }
            },
            headers=auth_headers,
        ) as response:
            assert response.status_code == HTTPStatus.OK
            body = b"".join(response.iter_bytes()).decode("utf-8")
    finally:
        chat_agent.set_chat_model(None)
        chat_agent._chat_model_resolved = False
    usage_frames = [
        frame
        for frame in _frames(body)
        if frame.get("type") == "custom"
        and isinstance(frame.get("data"), dict)
        and frame["data"].get("kind") == "usage"
    ]
    assert usage_frames[-1]["data"] == {
        "kind": "usage",
        "tokensIn": 12,
        "tokensOut": 8,
    }


def test_invoke_records_usage_against_budget(
    client: TestClient,
    auth_headers: dict[str, str],
    ai_budget_backend: BudgetTracker,
) -> None:
    chat_agent = client.app.state.agent_runtime.get("chat-agent")
    starting = ai_budget_backend.remaining("p-budget-track")
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
    after = ai_budget_backend.remaining("p-budget-track")
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


# ---------------------------------------------------------------------------
# tags validation (lines 154, 156 in agents.py)
# ---------------------------------------------------------------------------


def test_invoke_rejects_tags_list_exceeding_20_entries(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
) -> None:
    """_optional_tags raises 400 when more than 20 tags are supplied."""
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "tags": [f"tag{i}" for i in range(21)]},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "exceed 20" in response.text


def test_invoke_rejects_tag_exceeding_128_chars(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
) -> None:
    """_optional_tags raises 400 when any single tag exceeds 128 characters."""
    response = client.post(
        "/api/v1/agents/noise/invoke",
        json={"inputs": {"text": "x"}, "tags": ["a" * 129]},
        headers=auth_headers,
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert "128 characters" in response.text


# ---------------------------------------------------------------------------
# stream_agent rate_limited / budget_exhausted metrics (lines 737-740, 744-747)
# ---------------------------------------------------------------------------


def test_stream_records_rate_limited_invocation_metric(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """stream_agent records 'rate_limited' metric on 429."""
    from app.observability import metrics as metrics_module
    from app.config import settings as app_settings

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        monkeypatch.setattr(
            noise_agent,
            "metadata",
            replace(noise_agent.metadata, rate_limit=(1, 60)),
        )
        # First request succeeds and consumes the one-per-minute slot.
        with client.stream(
            "POST",
            "/api/v1/agents/noise/stream",
            json={"inputs": {"text": "x"}, "autonomy": "plan"},
            headers=auth_headers,
        ) as r1:
            b"".join(r1.iter_bytes())
        assert r1.status_code == HTTPStatus.OK
        # Second request must be rate-limited.
        response = client.post(
            "/api/v1/agents/noise/stream",
            json={"inputs": {"text": "x"}, "autonomy": "plan"},
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.TOO_MANY_REQUESTS
        rate_limited_value = metrics_module.agent_invocations_total.labels(
            agent="noise", outcome="rate_limited"
        )._value.get()
        assert rate_limited_value >= 1.0
    finally:
        metrics_module.reset_for_tests()


def test_stream_records_budget_exhausted_invocation_metric(
    client: TestClient,
    noise_agent: _NoiseAgent,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    ai_budget_backend: BudgetTracker,
) -> None:
    """stream_agent records 'budget_exhausted' metric on 402."""
    from app.observability import metrics as metrics_module
    from app.config import settings as app_settings

    metrics_module.configure_metrics(
        settings=replace(app_settings, prometheus_metrics=True)
    )
    try:
        monkeypatch.setattr(ai_budget_backend, "monthly_cap", 0)
        response = client.post(
            "/api/v1/agents/noise/stream",
            json={
                "inputs": {"text": "x", "project_id": "p-budget-track"},
                "autonomy": "plan",
            },
            headers=auth_headers,
        )
        assert response.status_code == HTTPStatus.PAYMENT_REQUIRED
        budget_exhausted_value = metrics_module.agent_invocations_total.labels(
            agent="noise", outcome="budget_exhausted"
        )._value.get()
        assert budget_exhausted_value >= 1.0
    finally:
        metrics_module.reset_for_tests()


# ---------------------------------------------------------------------------
# _with_disconnect: await anext_task after cancel on timeout (lines 931-933)
# and disconnect (lines 939-940)
# ---------------------------------------------------------------------------


def test_with_disconnect_awaits_cancelled_anext_task_on_timeout() -> None:
    """Timeout path: anext_task is cancelled while pending; await must not hang."""
    from app.routers.agents import _with_disconnect

    class _Req:
        async def is_disconnected(self) -> bool:
            return False

    async def slow_stream() -> AsyncIterator[Any]:
        # Keep ``anext_task`` pending so timeout cancellation path is exercised.
        await asyncio.Event().wait()
        yield ("updates", {"x": 1})  # pragma: no cover

    async def run() -> None:
        async for _ in _with_disconnect(_Req(), slow_stream(), timeout=0.05):
            pass  # pragma: no cover

    import pytest as _pytest
    with _pytest.raises(asyncio.TimeoutError):
        asyncio.run(run())


def test_with_disconnect_awaits_cancelled_anext_task_on_disconnect() -> None:
    """Disconnect path: anext_task is cancelled while pending; await fires CancelledError."""
    from app.routers.agents import _ClientDisconnected, _with_disconnect

    class _Req:
        def __init__(self, evt: asyncio.Event) -> None:
            self._evt = evt

        async def is_disconnected(self) -> bool:
            # Signal disconnect after being called once (gives asyncio.wait
            # time to schedule).
            self._evt.set()
            return True

    async def slow_stream(evt: asyncio.Event) -> AsyncIterator[Any]:
        # Wait until disconnect has been requested, then block indefinitely
        # so the disconnect cancellation path runs while ``anext_task`` is pending.
        await evt.wait()
        await asyncio.Event().wait()
        yield ("updates", {"x": 1})  # pragma: no cover

    async def run() -> None:
        evt = asyncio.Event()
        req = _Req(evt)
        async for _ in _with_disconnect(req, slow_stream(evt), timeout=10):
            pass  # pragma: no cover

    import pytest as _pytest
    with _pytest.raises(_ClientDisconnected):
        asyncio.run(run())


def test_with_disconnect_suppresses_aclose_exception() -> None:
    """aclose() raising on stream cleanup is swallowed (lines 954-955)."""
    from app.routers.agents import _with_disconnect

    class _Req:
        async def is_disconnected(self) -> bool:
            return False

    class _BoomStream:
        """Async generator stand-in whose aclose raises."""

        def __aiter__(self) -> "_BoomStream":
            return self

        async def __anext__(self) -> Any:
            raise StopAsyncIteration

        async def aclose(self) -> None:
            raise RuntimeError("aclose exploded")

    async def run() -> list[Any]:
        out: list[Any] = []
        async for event in _with_disconnect(_Req(), _BoomStream(), timeout=10):
            out.append(event)
        return out

    # Must complete without raising even though aclose() threw.
    result = asyncio.run(run())
    assert result == []
