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
        ("agentPostgresUriConfigured", "agent_postgres_uri_configured"),
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


def test_auto_backend_with_uri_reports_postgres_resolved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``auto`` + ``AGENT_POSTGRES_URI`` surfaces ``postgres`` in the payload.

    The resolved backend is the user-meaningful value -- if it leaked
    ``"auto"`` the operator dashboard would render a sentinel string
    that does not match the docs or the lifespan log.
    """

    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="auto",
        agent_store_backend="auto",
        agent_postgres_uri="postgres://example.invalid/db",
    )

    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["checkpointerBackend"] == "postgres"
    assert body["storeBackend"] == "postgres"
    assert body["checkpointer_backend"] == "postgres"
    assert body["store_backend"] == "postgres"
    assert body["agentPostgresUriConfigured"] is True
    assert body["agent_postgres_uri_configured"] is True


def test_auto_backend_without_uri_reports_memory_resolved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``auto`` + empty URI falls back to ``memory`` in the readiness payload."""

    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="auto",
        agent_store_backend="auto",
        agent_postgres_uri="",
    )

    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["checkpointerBackend"] == "memory"
    assert body["storeBackend"] == "memory"
    assert body["agentPostgresUriConfigured"] is False
    assert body["agent_postgres_uri_configured"] is False


def test_agent_postgres_uri_never_appears_in_response(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Postgres DSN must never leak into the response body.

    Only the boolean ``configured`` flag is safe to expose; the URI
    itself includes credentials and is treated as a secret.
    """

    secret_uri = "postgres://leakcheck-user:leakcheck-pw@db.invalid:5432/leakcheck"
    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="auto",
        agent_store_backend="auto",
        agent_postgres_uri=secret_uri,
    )

    response = client.get("/api/v1/health/ai")
    body_text = response.text

    assert secret_uri not in body_text
    assert "leakcheck-user" not in body_text
    assert "leakcheck-pw" not in body_text
    assert "db.invalid" not in body_text


def test_hosted_memory_checkpointer_emits_uri_warning(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """On a hosted deploy, memory checkpointer triggers an
    ``AGENT_POSTGRES_URI`` warning.

    The warning names the env var the operator should set (the new
    auto-detect path), not the legacy three-var combination.
    """

    monkeypatch.setenv("VERCEL", "1")
    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="auto",
        agent_store_backend="auto",
        agent_postgres_uri="",
    )

    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["hostedPlatform"] is not None
    assert any("AGENT_POSTGRES_URI" in w for w in body["warnings"])


def test_hosted_with_localhost_only_cors_emits_warning(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Hosted deploy + localhost-only CORS origins surfaces as a *warning*.

    The branch in ``_ai_readiness_payload`` calls the router-local
    :func:`_is_localhost_origin` for every entry; if every entry is a
    loopback variant the readiness payload surfaces a CORS warning so
    the operator dashboard pairs it with the boot-log gotcha. Empty
    ``cors_origin_regex`` is required (a non-empty regex means the
    operator opted into multi-origin matching).
    """

    monkeypatch.setenv("VERCEL", "1")
    _patch_settings(
        monkeypatch,
        cors_origins=("http://localhost:3000", "http://127.0.0.1:3000"),
        cors_origin_regex="",
    )

    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert body["hostedPlatform"] is not None
    assert any("localhost-only" in w for w in body["warnings"]), (
        f"expected localhost-only CORS warning, got {body['warnings']!r}"
    )


def test_localhost_cors_warning_silent_for_non_loopback_origins(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real production origin must not trip the localhost CORS warning.

    Exercises the early-return branches of the router-local
    :func:`_is_localhost_origin`: the scheme guard (``file://``) and the
    host-comparison path (``https://app.example.com`` -> not loopback).
    """

    monkeypatch.setenv("VERCEL", "1")
    _patch_settings(
        monkeypatch,
        cors_origins=("https://app.example.com", "file:///tmp/idx.html"),
        cors_origin_regex="",
    )

    response = client.get("/api/v1/health/ai")
    body = response.json()
    assert not any("localhost-only" in w for w in body["warnings"]), (
        f"unexpected localhost-only CORS warning: {body['warnings']!r}"
    )


def test_postgres_backend_without_runtime_checkpointer_surfaces_issue(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``AGENT_CHECKPOINT_BACKEND=postgres`` + no runtime checkpointer is an issue.

    Simulates a boot where ``AsyncPostgresSaver.setup()`` would have
    been swallowed: the resolved backend is still ``postgres`` (because
    the operator set the env var explicitly) but the runtime never
    received a live saver. The readiness payload must surface this as
    an *issue* (not merely a warning) so ``ready`` flips to ``False``
    and the operator dashboard renders the red banner.
    """

    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="postgres",
        agent_postgres_uri="postgres://example.invalid/db",
    )
    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "_checkpointer", None, raising=False)

    response = client.get("/api/v1/health/ai")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["checkpointerBackend"] == "postgres"
    assert body["ready"] is False
    assert any(
        "AGENT_CHECKPOINT_BACKEND=postgres" in issue
        and "runtime checkpointer is None" in issue
        for issue in body["issues"]
    ), f"expected postgres-no-checkpointer issue, got {body['issues']!r}"
