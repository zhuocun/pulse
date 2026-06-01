"""Tests for the ``/api/v1/health/ai?probe=true`` connectivity probe.

The probe path is the operator-visible "is the configured key actually
working" signal. Tests are scaffolded against a patched
:func:`probe_provider_connectivity` so they never hit the network and
do not depend on a real API key.

The cache contract is exercised explicitly: two readiness pokes inside
the 30s window must collapse onto one upstream call, otherwise the
endpoint could be turned into a DoS amplifier.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Iterable

import pytest
from fastapi.testclient import TestClient

from app.agents import llm as llm_module
from app.agents.llm import (
    PROVIDER_DEEPSEEK,
    PROVIDER_STUB,
    ProviderConnectivityResult,
    probe_provider_connectivity,
    resolve_chat_model_spec,
)
from app.config import settings as app_settings


@pytest.fixture(autouse=True)
def _clear_probe_cache() -> Iterable[None]:
    """Isolate cache state per test."""

    llm_module._reset_probe_cache_for_tests()
    yield
    llm_module._reset_probe_cache_for_tests()


def test_probe_false_does_not_invoke_probe(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The default ``probe=false`` keeps the endpoint cheap (no LLM call)."""

    calls = {"count": 0}

    async def _fake_probe(spec=None, **_kw):
        calls["count"] += 1
        return ProviderConnectivityResult(
            provider="openai", reachable=True, checked_at=1.0
        )

    monkeypatch.setattr(
        "app.routers.health.probe_provider_connectivity", _fake_probe
    )

    response = client.get("/api/v1/health/ai")
    assert response.status_code == HTTPStatus.OK
    body = response.json()

    assert calls["count"] == 0
    assert "providerConnectivity" not in body
    assert "provider_connectivity" not in body


def test_probe_true_invokes_probe_and_attaches_result(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``probe=true`` populates ``providerConnectivity`` and snake_case mirror."""

    async def _fake_probe(spec=None, **_kw):
        return ProviderConnectivityResult(
            provider="openai",
            reachable=True,
            detail="",
            checked_at=42.0,
        )

    monkeypatch.setattr(
        "app.routers.health.probe_provider_connectivity", _fake_probe
    )

    response = client.get("/api/v1/health/ai?probe=true")
    body = response.json()

    assert body["providerConnectivity"]["reachable"] is True
    assert body["providerConnectivity"]["checkedAt"] == 42.0
    assert body["provider_connectivity"]["checked_at"] == 42.0


def test_deepseek_readiness_can_report_live_provider_reachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dataclasses import replace

    monkeypatch.setattr(
        "app.routers.health.settings",
        replace(
            app_settings,
            agent_chat_model_provider=PROVIDER_DEEPSEEK,
            anthropic_api_key="",
            openai_api_key="",
            deepseek_api_key="sk-deepseek",
        ),
    )

    async def _fake_probe(spec=None, **_kw):
        assert spec.provider == PROVIDER_DEEPSEEK
        return ProviderConnectivityResult(
            provider=PROVIDER_DEEPSEEK,
            reachable=True,
            detail="",
            checked_at=43.0,
        )

    monkeypatch.setattr(
        "app.routers.health.probe_provider_connectivity", _fake_probe
    )

    response = client.get("/api/v1/health/ai?probe=true")
    body = response.json()

    assert body["provider"] == PROVIDER_DEEPSEEK
    assert body["stubMode"] is False
    assert body["deepseekKeyPresent"] is True
    assert body["providerConnectivity"]["reachable"] is True


def test_probe_failure_promotes_to_issue(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unreachable provider downgrades ``ready`` to false."""

    async def _fake_probe(spec=None, **_kw):
        return ProviderConnectivityResult(
            provider="openai",
            reachable=False,
            detail="authentication failed",
            checked_at=0.0,
        )

    monkeypatch.setattr(
        "app.routers.health.probe_provider_connectivity", _fake_probe
    )

    response = client.get("/api/v1/health/ai?probe=true")
    body = response.json()

    assert body["ready"] is False
    assert any(
        "authentication failed" in issue for issue in body["issues"]
    )


def test_probe_cache_collapses_back_to_back_calls() -> None:
    """Two probes within the TTL collapse onto one SDK invocation.

    Patches the OpenAI module directly so the real cache code is
    exercised end-to-end (rather than the routerlayer fake).
    """

    import asyncio

    from app.agents.llm import ChatModelSpec, PROVIDER_OPENAI

    spec = ChatModelSpec(provider=PROVIDER_OPENAI, model="x", api_key="sk-fake")

    call_count = {"value": 0}

    class _FakeModels:
        async def list(self):
            call_count["value"] += 1
            return {"data": []}

    class _FakeClient:
        def __init__(self, **_kw):
            self.models = _FakeModels()

    class _FakeOpenAI:
        AsyncOpenAI = _FakeClient

        class AuthenticationError(Exception):
            pass

        class APIConnectionError(Exception):
            pass

        class APITimeoutError(Exception):
            pass

    import sys

    sys.modules["openai"] = _FakeOpenAI  # type: ignore[assignment]
    try:
        first = asyncio.run(probe_provider_connectivity(spec))
        second = asyncio.run(probe_provider_connectivity(spec))
    finally:
        sys.modules.pop("openai", None)

    assert first.reachable is True
    assert second.reachable is True
    assert call_count["value"] == 1, "cache hit must short-circuit the SDK call"


def test_deepseek_probe_uses_openai_compatible_base_url() -> None:
    import asyncio
    import sys

    from app.agents.llm import ChatModelSpec, PROVIDER_DEEPSEEK

    captured: dict[str, object] = {}

    class _FakeModels:
        async def list(self):
            return {"data": []}

    class _FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.models = _FakeModels()

    class _FakeOpenAI:
        AsyncOpenAI = _FakeClient

        class AuthenticationError(Exception):
            pass

        class APIConnectionError(Exception):
            pass

        class APITimeoutError(Exception):
            pass

    sys.modules["openai"] = _FakeOpenAI  # type: ignore[assignment]
    try:
        spec = ChatModelSpec(
            provider=PROVIDER_DEEPSEEK,
            model="deepseek-v4-flash",
            api_key="sk-deepseek",
            base_url="https://api.deepseek.com",
        )
        result = asyncio.run(probe_provider_connectivity(spec))
    finally:
        sys.modules.pop("openai", None)

    assert result.reachable is True
    assert captured["base_url"] == "https://api.deepseek.com"


def test_stub_provider_probe_returns_reachable_without_imports() -> None:
    """The stub branch is hermetic -- exercises the no-network code path."""

    import asyncio
    from app.agents.llm import ChatModelSpec

    spec = ChatModelSpec(provider=PROVIDER_STUB, model="stub", api_key="")
    result = asyncio.run(probe_provider_connectivity(spec))

    assert result.provider == PROVIDER_STUB
    assert result.reachable is True
    assert "stub" in result.detail.lower()


def test_probe_with_default_spec_uses_resolved_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Calling the probe with no spec resolves the default settings."""

    import asyncio

    # The default test settings have no provider keys -> stub.
    resolved = resolve_chat_model_spec()
    assert resolved.provider == PROVIDER_STUB
    result = asyncio.run(probe_provider_connectivity())

    assert result.provider == PROVIDER_STUB
    assert result.reachable is True
