"""Tests for the extended ``/api/v1/health`` payload.

The endpoint now reports the agent persistence backend name and a
boolean indicating whether the backend is operational. The signal is a
static check on the runtime (``runtime.checkpointer is not None``)
rather than a live probe, because the FastAPI lifespan already enters
``AsyncPostgresSaver`` and awaits ``setup()`` at boot -- a failure
there throws and the app never starts, so a non-None checkpointer at
request time already proves the connection succeeded.

Covered cases:

- The default ``memory`` backend reports ``ok``.
- The ``none`` backend reports ``ok`` (intentionally disabled).
- The ``postgres`` backend with ``runtime._checkpointer = None``
  downgrades the response to ``degraded``.
- The ``postgres`` backend with a non-None checkpointer reports ``ok``.
- snake_case and camelCase keys appear together with matching values.
- The new fields do not displace the existing ones.
- A combined failure (DB ping fails AND persistence not ok) still
  returns 200 with ``status == "degraded"``.

The file also incidentally exercises the early-return branches of
``app.main._origin_is_localhost`` for non-http schemes and missing
hosts. The existing localhost-CORS suite covers the happy path; these
cases plug the remaining defensive branches so the project keeps its
100% coverage floor.
"""

from __future__ import annotations

from dataclasses import replace
from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import settings as app_settings
from app.routers import health as health_router


def _patch_settings(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> None:
    """Swap ``health_router.settings`` with a ``replace``-d copy.

    The router reads ``settings`` once at module import, so editing the
    shared singleton is not enough: we point the module attribute at a
    fresh frozen dataclass so each test runs against an isolated config.
    """

    monkeypatch.setattr(health_router, "settings", replace(app_settings, **overrides))


def test_default_memory_backend_reports_ok(client: TestClient) -> None:
    """The shipped default (``memory``) backend reports a healthy probe."""

    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["agentPersistence"] == "memory"
    assert body["agentPersistenceOk"] is True
    assert body["status"] == "ok"
    assert body["ok"] is True


def test_none_backend_reports_ok(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``AGENT_CHECKPOINT_BACKEND=none`` is an intentional disable; report ok."""

    _patch_settings(monkeypatch, agent_checkpoint_backend="none")
    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["agentPersistence"] == "none"
    assert body["agentPersistenceOk"] is True
    assert body["status"] == "ok"
    assert body["ok"] is True


def test_postgres_backend_with_no_checkpointer_is_degraded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A postgres-configured runtime without a live checkpointer is degraded.

    Setting ``_checkpointer`` (the private attr the property reads) to
    ``None`` simulates a boot where ``AsyncPostgresSaver.setup()`` would
    have been swallowed -- which is the failure mode the new field is
    designed to surface.
    """

    _patch_settings(monkeypatch, agent_checkpoint_backend="postgres")
    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "_checkpointer", None, raising=False)

    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["agentPersistence"] == "postgres"
    assert body["agentPersistenceOk"] is False
    assert body["status"] == "degraded"
    assert body["ok"] is False


def test_postgres_backend_with_live_checkpointer_is_ok(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A postgres-configured runtime with a non-None checkpointer reports ok.

    The default test runtime ships an :class:`InMemorySaver`; the type
    is irrelevant for the static signal -- only ``is not None`` matters.
    """

    _patch_settings(monkeypatch, agent_checkpoint_backend="postgres")
    runtime = client.app.state.agent_runtime
    assert runtime.checkpointer is not None  # sanity: fixture invariant

    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["agentPersistence"] == "postgres"
    assert body["agentPersistenceOk"] is True
    assert body["status"] == "ok"
    assert body["ok"] is True


def test_snake_and_camel_case_keys_match(client: TestClient) -> None:
    """Both casing variants must appear and carry the same value."""

    response = client.get("/api/v1/health")
    body = response.json()
    assert body["agent_persistence"] == body["agentPersistence"]
    assert body["agent_persistence_ok"] == body["agentPersistenceOk"]
    assert body["latency_ms"] == body["latencyMs"]


def test_latency_ms_is_a_non_negative_number(client: TestClient) -> None:
    """``latencyMs`` is the FE-visible round-trip indicator.

    The React client (``useAgentHealth``) reads ``latencyMs`` to render the
    operator dashboard's response-time chip. It must be a JSON number (not a
    string) and never negative -- a negative value implies a clock skew bug
    in the timing path.
    """

    response = client.get("/api/v1/health")
    body = response.json()
    assert isinstance(body["latencyMs"], (int, float))
    assert body["latencyMs"] >= 0.0


def test_existing_fields_are_preserved(client: TestClient) -> None:
    """The new fields layer on top of the existing payload, never replace it.

    A regression here would silently drop a key the FE banner already
    consumes, so the test pins every existing key explicitly rather than
    asserting "shape is reasonable".
    """

    response = client.get("/api/v1/health")
    body = response.json()
    for key in (
        "status",
        "ok",
        "database",
        "agents_loaded",
        "agentsLoaded",
        "latency_ms",
        "latencyMs",
        "checkpointer",
        "store",
        "agent_persistence",
        "agentPersistence",
        "agent_persistence_ok",
        "agentPersistenceOk",
    ):
        assert key in body, f"missing key {key!r}"


def test_combined_db_and_persistence_failure_returns_200_degraded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even when both signals fail, the endpoint stays 200 / degraded.

    Returning a 5xx would wedge upstream load balancers (AWS ALB / GCP
    HTTP probes treat any non-2xx as unhealthy and remove the instance
    from rotation). The endpoint must surface the degradation in the
    body without taking the pod out of service.
    """

    class _BadRepo:
        def ping(self) -> None:
            raise RuntimeError("nope")

    monkeypatch.setattr(health_router, "repository", _BadRepo())
    _patch_settings(monkeypatch, agent_checkpoint_backend="postgres")
    runtime = client.app.state.agent_runtime
    monkeypatch.setattr(runtime, "_checkpointer", None, raising=False)

    response = client.get("/api/v1/health")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["status"] == "degraded"
    assert body["ok"] is False
    assert body["database"] == "degraded"
    assert body["agentPersistenceOk"] is False


# ---------------------------------------------------------------------------
# Defensive branches in ``app.main._origin_is_localhost``
#
# The localhost-CORS suite in test_readiness_changes.py covers the happy
# path (real loopback origins, real production origins). The two short
# guard clauses below -- non-http scheme and missing host -- cannot fire
# from the lifespan path without an obviously invalid ``CORS_ORIGINS``
# entry, so they only get exercised by direct unit calls. Co-locating
# them here keeps the helper at 100% without a separate test file just
# for two one-line returns.
# ---------------------------------------------------------------------------


def test_origin_is_localhost_rejects_non_http_scheme() -> None:
    """``ftp://`` (or any non-http scheme) is not a CORS origin we recognise."""

    assert main._origin_is_localhost("ftp://localhost:21") is False


def test_origin_is_localhost_rejects_missing_host() -> None:
    """A scheme-only URL has no host to compare against the loopback set."""

    assert main._origin_is_localhost("http://") is False
