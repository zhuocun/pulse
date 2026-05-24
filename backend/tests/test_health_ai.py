"""Tests for the ``/api/v1/health/ai`` readiness endpoint.

The endpoint is the operator-facing single source of truth for
"why is the AI not working?". The cases below pin the contract:

- default shape under the stub provider (the local-dev path)
- ``ready`` flips to false when issues exist
- camelCase / snake_case parity is mechanical
- no API key value ever appears in the response body
- ``agents_loaded`` matches the live runtime registry
"""

from __future__ import annotations

from dataclasses import replace
from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import settings as app_settings
from app.routers import health as health_router


def _patch_settings(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> None:
    monkeypatch.setattr(health_router, "settings", replace(app_settings, **overrides))


def test_default_shape_with_stub_provider(client: TestClient) -> None:
    """Stub provider returns ready=true with a warning, never an issue."""

    response = client.get("/api/v1/health/ai")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["provider"] == "stub"
    assert body["providerResolved"] == "stub"
    assert body["stubMode"] is True
    assert body["ready"] is True
    assert "Running in stub mode" in " ".join(body["warnings"])
    # The default test setup ships without a real provider key.
    assert body["anthropicKeyPresent"] is False
    assert body["openaiKeyPresent"] is False


def test_ready_false_when_openai_provider_set_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Explicit ``openai`` provider with no key surfaces as an issue."""

    _patch_settings(
        monkeypatch,
        agent_chat_model_provider="openai",
        openai_api_key="",
        anthropic_api_key="",
    )
    response = client.get("/api/v1/health/ai")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["ready"] is False
    assert any("OPENAI_API_KEY" in issue for issue in body["issues"])


def test_ready_false_when_anthropic_provider_set_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_settings(
        monkeypatch,
        agent_chat_model_provider="anthropic",
        openai_api_key="",
        anthropic_api_key="",
    )
    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["ready"] is False
    assert any("ANTHROPIC_API_KEY" in issue for issue in body["issues"])


def test_camelcase_and_snake_case_mirrors_match(client: TestClient) -> None:
    """Every camelCase field has a snake_case mirror with the same value.

    Asserting on the live response (rather than a hand-maintained list)
    catches a drift where one casing variant changes value without the
    other -- the FE/operator dashboards read either form.
    """

    response = client.get("/api/v1/health/ai")
    body = response.json()

    pairs = [
        ("providerResolved", "provider_resolved"),
        ("providerConfigured", "provider_configured"),
        ("stubMode", "stub_mode"),
        ("anthropicKeyPresent", "anthropic_key_present"),
        ("openaiKeyPresent", "openai_key_present"),
        ("failoverConfigured", "failover_configured"),
        ("embeddingsProvider", "embeddings_provider"),
        ("embeddingsStubMode", "embeddings_stub_mode"),
        ("checkpointerBackend", "checkpointer_backend"),
        ("storeBackend", "store_backend"),
        ("rateLimitBackend", "rate_limit_backend"),
        ("budgetBackend", "budget_backend"),
        ("idempotencyBackend", "idempotency_backend"),
        ("redisConfigured", "redis_configured"),
        ("vectorSearchEnabled", "vector_search_enabled"),
        ("hostedPlatform", "hosted_platform"),
        ("multiInstance", "multi_instance"),
        ("multiInstanceSafe", "multi_instance_safe"),
        ("jwtSecretSource", "jwt_secret_source"),
        ("corsOrigins", "cors_origins"),
        ("corsOriginRegex", "cors_origin_regex"),
        ("agentsLoaded", "agents_loaded"),
    ]
    for camel, snake in pairs:
        assert camel in body, f"missing camelCase key {camel!r}"
        assert snake in body, f"missing snake_case key {snake!r}"
        assert body[camel] == body[snake], (
            f"value mismatch between {camel!r} and {snake!r}"
        )


def test_no_api_key_value_appears_in_response_body(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The response must never include the key value, prefix, or length."""

    # Deliberately distinctive keys so any leak would be obvious.
    fake_openai = "sk-leakcheck-OPENAI-DO-NOT-RETURN-ME-1234567890"
    fake_anthropic = "sk-ant-leakcheck-ANTHROPIC-DO-NOT-RETURN-ME-1234"
    _patch_settings(
        monkeypatch,
        agent_chat_model_provider="openai",
        openai_api_key=fake_openai,
        anthropic_api_key=fake_anthropic,
    )

    response = client.get("/api/v1/health/ai")
    body_text = response.text

    assert fake_openai not in body_text
    assert fake_anthropic not in body_text
    # And the conventional key prefixes are not echoed either.
    assert "sk-leakcheck" not in body_text
    assert "sk-ant-leakcheck" not in body_text

    # But the boolean presence flags are correctly populated.
    body = response.json()
    assert body["openaiKeyPresent"] is True
    assert body["anthropicKeyPresent"] is True


def test_agents_loaded_matches_runtime_registry(client: TestClient) -> None:
    """The numeric ``agents_loaded`` field reads off the live runtime."""

    runtime = client.app.state.agent_runtime
    expected = len(runtime.registry)
    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["agentsLoaded"] == expected
    assert body["agents_loaded"] == expected
