"""Tests for :func:`app.agents.checkpointing.resolve_agent_backend`.

The helper centralises the ``"auto"`` sentinel handling so every call
site -- the lifespan guards, the factories, and the readiness payload
-- sees the same answer. The 5-person quickstart relies on the rule
"``AGENT_POSTGRES_URI`` set -> both backends become postgres"; the
cases below pin that contract and also pin the passthrough behaviour
for explicit values so the resolver never silently rewrites them.

Companion check at the end exercises the end-to-end flow: with the
default ``"auto"`` backends and ``AGENT_POSTGRES_URI`` set the
``/api/v1/health/ai`` endpoint must report ``checkpointerBackend`` and
``storeBackend`` as ``"postgres"`` (the resolved value, never the raw
sentinel).
"""

from __future__ import annotations

from dataclasses import replace
from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agents.checkpointing import resolve_agent_backend
from app.config import settings as app_settings
from app.routers import health as health_router


def _patch_settings(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> None:
    monkeypatch.setattr(health_router, "settings", replace(app_settings, **overrides))


# ---------------------------------------------------------------------------
# resolve_agent_backend -- pure helper, no IO.
# ---------------------------------------------------------------------------


def test_auto_with_uri_resolves_to_postgres() -> None:
    """``auto`` + a non-empty URI flips both backends to postgres."""

    assert (
        resolve_agent_backend(
            "auto", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "postgres"
    )


def test_auto_with_uri_resolves_to_postgres_for_store_field() -> None:
    """The helper is field-agnostic -- the same rule applies to the store backend."""

    # The helper does not branch on which env var it is being called for;
    # the test exists to pin the documented behaviour for both the
    # checkpointer field and the store field.
    resolved = resolve_agent_backend(
        "auto", agent_postgres_uri="postgresql://user:pw@host/db"
    )
    assert resolved == "postgres"


def test_auto_with_empty_uri_resolves_to_memory() -> None:
    """``auto`` + empty URI falls back to the in-process backend."""

    assert resolve_agent_backend("auto", agent_postgres_uri="") == "memory"


def test_auto_with_whitespace_uri_resolves_to_memory() -> None:
    """Whitespace-only URIs are treated as unset -- they would fail at boot anyway."""

    assert resolve_agent_backend("auto", agent_postgres_uri="   ") == "memory"
    assert resolve_agent_backend("auto", agent_postgres_uri="\t\n") == "memory"


def test_explicit_memory_passes_through_regardless_of_uri() -> None:
    """An operator who explicitly chose memory keeps memory, URI or not."""

    assert resolve_agent_backend("memory", agent_postgres_uri="") == "memory"
    assert (
        resolve_agent_backend(
            "memory", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "memory"
    )


def test_explicit_postgres_passes_through_even_without_uri() -> None:
    """``postgres`` stays ``postgres`` -- the lifespan guard catches a missing URI later."""

    assert resolve_agent_backend("postgres", agent_postgres_uri="") == "postgres"
    assert (
        resolve_agent_backend(
            "postgres", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "postgres"
    )


def test_explicit_none_passes_through() -> None:
    """``none`` is the intentional-disable sentinel; auto must not override it."""

    assert resolve_agent_backend("none", agent_postgres_uri="") == "none"
    assert (
        resolve_agent_backend(
            "none", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "none"
    )


def test_auto_uppercase_with_uri_resolves_to_postgres() -> None:
    """``AGENT_CHECKPOINT_BACKEND=AUTO`` should resolve the same as the lowercase form.

    The reviewer flagged that call sites which bypass the factory's
    ``.strip().lower()`` normalization (the lifespan guards and the
    readiness payload pass ``settings.agent_checkpoint_backend``
    verbatim) would otherwise treat ``"AUTO"`` as an unknown explicit
    backend and silently return it, masking the postgres-resolved
    state in the health payload.
    """

    assert (
        resolve_agent_backend(
            "AUTO", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "postgres"
    )


def test_auto_with_whitespace_padding_with_uri_resolves_to_postgres() -> None:
    """``"  auto  "`` is the second case the brief explicitly enumerates."""

    assert (
        resolve_agent_backend(
            "  auto  ", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "postgres"
    )


def test_auto_uppercase_without_uri_resolves_to_memory() -> None:
    """The case-insensitive auto path falls back to memory the same way the canonical form does."""

    assert resolve_agent_backend("AUTO", agent_postgres_uri="") == "memory"


def test_mixed_case_explicit_value_preserves_caller_spelling() -> None:
    """Explicit non-``auto`` values are returned with their original spelling.

    Downstream code already does its own ``.strip().lower()``
    normalization before dispatching on the value (see
    :func:`build_checkpointer`). Rewriting the spelling here would
    break call sites that compare against the raw configured string
    to surface what the operator actually typed in error messages.
    """

    assert resolve_agent_backend("Memory", agent_postgres_uri="") == "Memory"
    assert (
        resolve_agent_backend(
            "Postgres", agent_postgres_uri="postgres://example.invalid/db"
        )
        == "Postgres"
    )


def test_unknown_future_string_is_returned_unchanged() -> None:
    """Future-supported backend names pass through so the resolver does not block them.

    The factories validate the name; this helper is only responsible
    for the ``auto`` -> concrete translation.
    """

    assert (
        resolve_agent_backend("future-backend-x", agent_postgres_uri="")
        == "future-backend-x"
    )
    assert (
        resolve_agent_backend(
            "future-backend-x",
            agent_postgres_uri="postgres://example.invalid/db",
        )
        == "future-backend-x"
    )


# ---------------------------------------------------------------------------
# End-to-end: default ``auto`` + URI surfaces postgres in the readiness payload.
# ---------------------------------------------------------------------------


def test_default_backends_with_uri_set_report_postgres_in_health_ai(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The integrated path proves the rule the quickstart relies on.

    Operator drops ``AGENT_POSTGRES_URI`` into the deploy env, leaves
    ``AGENT_CHECKPOINT_BACKEND`` / ``AGENT_STORE_BACKEND`` at the
    ``"auto"`` default, and gets postgres-resolved on both layers
    without setting a third or fourth env var.
    """

    _patch_settings(
        monkeypatch,
        agent_checkpoint_backend="auto",
        agent_store_backend="auto",
        agent_postgres_uri="postgres://example.invalid/db",
    )

    response = client.get("/api/v1/health/ai")
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert body["checkpointerBackend"] == "postgres"
    assert body["storeBackend"] == "postgres"
    assert body["agentPostgresUriConfigured"] is True
