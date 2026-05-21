"""Tests for the production-readiness fixes on top of PRD v2.1.

Covers:
    - ``GET /api/v1/agents/_tools`` mirrors :func:`fe_tool_definitions`.
    - ``_propagate_langsmith_env`` mirrors LANGSMITH_* into LangChain's
      canonical env vars when the flag is on, and is a no-op when off.
    - ``_validate_memory_agent_backends`` logs the production-readiness
      note at DEBUG when either AGENT_*_BACKEND is the in-process memory
      backend (single-worker / local-dev path).
"""

from __future__ import annotations

import logging
import os
from dataclasses import replace
from http import HTTPStatus
from typing import Iterable

import pytest
from fastapi.testclient import TestClient

from app import main, security
from app.config import settings as app_settings
from app.deploy_env import HOSTED_PLATFORM_ENV_MARKERS
from app.security import create_token
from app.tools.fe_tool_schemas import fe_tool_definitions


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("readiness-user")
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# GET /api/v1/agents/_tools
# ---------------------------------------------------------------------------


def test_list_fe_tools_returns_full_catalogue(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/agents/_tools", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    body = response.json()
    assert "tools" in body
    expected = fe_tool_definitions()
    assert body["tools"] == expected
    # Sanity-check a couple of well-known names so a future drift between
    # the BE catalogue and the FE registry surfaces here.
    names = {entry["name"] for entry in body["tools"]}
    assert {"fe.boardSnapshot", "fe.similarTasks", "fe.searchCandidates"} <= names


def test_list_fe_tools_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/agents/_tools")
    assert response.status_code == HTTPStatus.UNAUTHORIZED


def test_list_fe_tools_route_wins_over_get_agent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """``/_tools`` is registered before ``/{name}`` so the literal wins.

    A regression here would route the request through ``get_agent``,
    raising an ``AgentNotFoundError`` for an agent named ``_tools`` --
    which is not even a valid agent name (``AGENT_NAME_RE`` rejects
    leading underscores), so the 404 path would surface as a typed
    error envelope rather than the FE-tool catalogue.
    """

    response = client.get("/api/v1/agents/_tools", headers=auth_headers)
    assert response.status_code == HTTPStatus.OK
    # ``get_agent`` would have 404'd with a different shape.
    assert "tools" in response.json()
    assert "name" not in response.json()


# ---------------------------------------------------------------------------
# _propagate_langsmith_env
# ---------------------------------------------------------------------------


_LANGSMITH_ENV_KEYS = (
    "LANGCHAIN_TRACING_V2",
    "LANGSMITH_TRACING",
    "LANGCHAIN_PROJECT",
    "LANGSMITH_PROJECT",
)


@pytest.fixture(autouse=True)
def _clean_langsmith_env(monkeypatch: pytest.MonkeyPatch) -> Iterable[None]:
    """Strip the canonical LangChain tracing env vars for each test.

    Otherwise a previous test (or the host shell) that pre-set any of
    these would mask the ``setdefault`` semantics this helper relies
    on, and the assertions below would test the wrong thing.
    """

    for key in _LANGSMITH_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    yield


def test_propagate_langsmith_env_no_op_when_flag_off() -> None:
    cfg = replace(app_settings, langsmith_tracing=False)

    main._propagate_langsmith_env(cfg)

    for key in _LANGSMITH_ENV_KEYS:
        assert key not in os.environ


def test_propagate_langsmith_env_sets_canonical_keys() -> None:
    cfg = replace(
        app_settings,
        langsmith_tracing=True,
        langsmith_project="readiness-test",
    )

    main._propagate_langsmith_env(cfg)

    assert os.environ["LANGCHAIN_TRACING_V2"] == "true"
    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGCHAIN_PROJECT"] == "readiness-test"
    assert os.environ["LANGSMITH_PROJECT"] == "readiness-test"


def test_propagate_langsmith_env_skips_blank_project() -> None:
    cfg = replace(
        app_settings,
        langsmith_tracing=True,
        langsmith_project="",
    )

    main._propagate_langsmith_env(cfg)

    assert os.environ["LANGCHAIN_TRACING_V2"] == "true"
    # Project keys stay unset when the operator supplied no project name.
    assert "LANGCHAIN_PROJECT" not in os.environ
    assert "LANGSMITH_PROJECT" not in os.environ


def test_propagate_langsmith_env_does_not_override_explicit_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``setdefault`` semantics: an operator-set value wins over the mirror."""

    monkeypatch.setenv("LANGCHAIN_PROJECT", "explicitly-set-by-operator")
    cfg = replace(
        app_settings,
        langsmith_tracing=True,
        langsmith_project="from-dotenv",
    )

    main._propagate_langsmith_env(cfg)

    assert os.environ["LANGCHAIN_PROJECT"] == "explicitly-set-by-operator"
    # The mirror still populates the key the operator did *not* set.
    assert os.environ["LANGSMITH_PROJECT"] == "from-dotenv"


# ---------------------------------------------------------------------------
# _validate_memory_agent_backends
# (renamed from _warn_about_memory_agent_backends; now raises on multi-worker)
# ---------------------------------------------------------------------------


def test_warn_about_memory_backends_emits_warning_for_default_config(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Ensure no multi-worker signal is present so the single-worker debug
    # path is exercised (not the hard-fail path).
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="memory",
        agent_store_backend="memory",
    )

    with caplog.at_level(logging.DEBUG, logger=main.logger.name):
        main._validate_memory_agent_backends(cfg)

    messages = [record.getMessage() for record in caplog.records]
    assert any(
        "memory backend" in m and "checkpoint=memory" in m and "store=memory" in m
        for m in messages
    )


def test_warn_about_memory_backends_silent_when_postgres_configured(
    caplog: pytest.LogCaptureFixture,
) -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._validate_memory_agent_backends(cfg)

    assert caplog.records == []


def test_warn_about_memory_backends_warns_on_split_backends(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even one of the two backends being ``memory`` is enough to fail resume."""

    # Ensure single-worker path (debug log, not hard-fail).
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="memory",
    )

    with caplog.at_level(logging.DEBUG, logger=main.logger.name):
        main._validate_memory_agent_backends(cfg)

    assert any("memory backend" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------------------
# _validate_agent_postgres_backend
#
# The runtime helper :func:`_resolve_agent_postgres_uri` raises
# :class:`AgentConfigurationError` lazily on first agent invocation when no
# postgres connection string resolves; the readiness fix re-raises that
# failure as :class:`RuntimeError` at lifespan startup so a misconfigured
# production deploy fails in the deploy log instead of silently 500'ing the
# first user-triggered agent run.
# ---------------------------------------------------------------------------


def _no_postgres_fields() -> dict[str, object]:
    """Return ``replace(...)`` kwargs that strip every postgres knob.

    The frozen :class:`Settings` dataclass picks up its defaults from the
    host environment / ``.env``, so ``postgres_host`` / ``postgres_database``
    / ``postgres_port`` are routinely set to ``localhost`` / ``jira`` /
    ``5432`` even on a fresh checkout. Tests that need to exercise the
    "no URI, no discrete fields" failure path have to clear *all* of them
    explicitly -- otherwise the discrete-field branch in
    :func:`_resolve_agent_postgres_uri` builds a keyword string from the
    leftover defaults and the helper happily returns it.
    """

    return {
        "agent_postgres_uri": "",
        "postgres_uri": "",
        "postgres_user": "",
        "postgres_host": "",
        "postgres_database": "",
        "postgres_password": "",
        "postgres_port": 0,
        "postgres_ssl": False,
    }


def test_validate_agent_postgres_passes_when_agent_postgres_uri_set() -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        **{**_no_postgres_fields(), "agent_postgres_uri": "postgresql://a/b"},
    )

    # No exception means validation passed.
    main._validate_agent_postgres_backend(cfg)


def test_validate_agent_postgres_passes_when_postgres_uri_set() -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        **{**_no_postgres_fields(), "postgres_uri": "postgresql://a/b"},
    )

    main._validate_agent_postgres_backend(cfg)


def test_validate_agent_postgres_passes_with_discrete_fields() -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        **{
            **_no_postgres_fields(),
            "postgres_host": "db.internal",
            "postgres_user": "jira",
            "postgres_database": "jira",
            "postgres_password": "shh",
            "postgres_port": 5432,
        },
    )

    main._validate_agent_postgres_backend(cfg)


def test_validate_agent_postgres_raises_when_no_uri_anywhere() -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="postgres",
        **_no_postgres_fields(),
    )

    with pytest.raises(RuntimeError) as excinfo:
        main._validate_agent_postgres_backend(cfg)

    message = str(excinfo.value)
    assert "AGENT_POSTGRES_URI" in message
    assert "POSTGRES_URI" in message


def test_validate_agent_postgres_no_op_when_both_backends_memory() -> None:
    """Validation must not touch the resolver when no backend is postgres.

    The ``memory`` backends are the project default and the field values
    here would otherwise raise -- the no-op guard keeps local dev / the
    test suite from accidentally triggering the production validator.
    """

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="memory",
        agent_store_backend="memory",
        **_no_postgres_fields(),
    )

    main._validate_agent_postgres_backend(cfg)


def test_validate_agent_postgres_runs_for_checkpoint_only() -> None:
    """Either backend on its own being ``postgres`` is enough to validate."""

    cfg = replace(
        app_settings,
        agent_checkpoint_backend="postgres",
        agent_store_backend="memory",
        **_no_postgres_fields(),
    )

    with pytest.raises(RuntimeError) as excinfo:
        main._validate_agent_postgres_backend(cfg)

    # The failure names the specific backend env var that triggered it,
    # so an operator looking at the deploy log can correlate it back to
    # the AGENT_CHECKPOINT_BACKEND knob (vs AGENT_STORE_BACKEND).
    assert "AGENT_CHECKPOINT_BACKEND" in str(excinfo.value)


def test_validate_agent_postgres_runs_for_store_only() -> None:
    cfg = replace(
        app_settings,
        agent_checkpoint_backend="memory",
        agent_store_backend="postgres",
        **_no_postgres_fields(),
    )

    with pytest.raises(RuntimeError) as excinfo:
        main._validate_agent_postgres_backend(cfg)

    assert "AGENT_STORE_BACKEND" in str(excinfo.value)


# ---------------------------------------------------------------------------
# _warn_about_localhost_only_cors
#
# The default ``CORS_ORIGINS`` is fine for local dev but silently breaks
# every browser request in a production-shaped deploy (Vercel, Render, Fly,
# Railway, K8s). The warning fires only when *all three* conditions hold:
# a production-shaped env var is set, ``CORS_ORIGIN_REGEX`` is empty, and
# every entry in ``CORS_ORIGINS`` is a localhost variant. The matching
# parses the URL host portion explicitly so a real origin that happens to
# share the substring (``https://localhost.example.com``) does not silence
# the warning.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_production_shaped_env(monkeypatch: pytest.MonkeyPatch) -> Iterable[None]:
    """Clear the production-shaped host detector env vars per-test.

    A test runner started under Vercel / Render CI would otherwise have
    one of these set, and the localhost-CORS warning tests would leak
    state between cases. Stripping them keeps the assertions
    deterministic regardless of where the suite runs.
    """

    for key in HOSTED_PLATFORM_ENV_MARKERS:
        monkeypatch.delenv(key, raising=False)
    yield


def test_warn_about_localhost_cors_fires_on_vercel_with_localhost_origins(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("VERCEL", "1")
    cfg = replace(
        app_settings,
        cors_origins=("http://localhost:3000", "http://127.0.0.1:3000"),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    messages = [record.getMessage() for record in caplog.records]
    assert any("CORS" in m and "localhost" in m for m in messages)


def test_warn_about_localhost_cors_silent_off_production(
    caplog: pytest.LogCaptureFixture,
) -> None:
    cfg = replace(
        app_settings,
        cors_origins=("http://localhost:3000",),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    assert caplog.records == []


def test_warn_about_localhost_cors_silent_with_real_origin(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A single non-localhost origin is enough to silence the warning."""

    monkeypatch.setenv("VERCEL", "1")
    cfg = replace(
        app_settings,
        cors_origins=("http://localhost:3000", "https://app.example.com"),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    assert caplog.records == []


def test_warn_about_localhost_cors_silent_when_regex_set(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A non-empty ``CORS_ORIGIN_REGEX`` means the operator opted in."""

    monkeypatch.setenv("VERCEL", "1")
    cfg = replace(
        app_settings,
        cors_origins=("http://localhost:3000",),
        cors_origin_regex=r"^https://[^.]+\.example\.com$",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    assert caplog.records == []


def test_warn_about_localhost_cors_does_not_match_localhost_substring(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """``https://localhost.example.com`` is a real origin, not loopback.

    The host parser must compare the URL host portion exactly, not
    substring-match on ``"localhost"`` -- otherwise a real production
    origin that happens to share the substring would silence the
    warning in exactly the deploy where it matters most.
    """

    monkeypatch.setenv("VERCEL", "1")
    cfg = replace(
        app_settings,
        cors_origins=("https://localhost.example.com",),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    # The single origin is *not* localhost, so the warning must stay silent.
    assert caplog.records == []


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:3000",
        "https://localhost",
        "http://127.0.0.1:8000",
        "http://[::1]:3000",
        "http://0.0.0.0:3000",
    ],
)
def test_warn_about_localhost_cors_recognises_loopback_variants(
    origin: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """All four loopback hosts (localhost, 127.0.0.1, [::1], 0.0.0.0)."""

    monkeypatch.setenv("RENDER", "1")
    cfg = replace(
        app_settings,
        cors_origins=(origin,),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    assert any(
        "CORS" in record.getMessage() and "localhost" in record.getMessage()
        for record in caplog.records
    ), f"expected localhost CORS warning for {origin!r}"


def test_warn_about_localhost_cors_silent_when_origins_empty(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An empty ``CORS_ORIGINS`` is its own configuration error to flag elsewhere.

    The localhost warning is specifically about the default-shipped
    localhost origins leaking to production; ``cors_origins=()`` is a
    different misconfiguration and should not trigger this warning (it
    would also trip the ``all([])`` truth-value, which we explicitly
    guard against).
    """

    monkeypatch.setenv("VERCEL", "1")
    cfg = replace(
        app_settings,
        cors_origins=(),
        cors_origin_regex="",
    )

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        main._warn_about_localhost_only_cors(cfg)

    assert caplog.records == []


@pytest.mark.parametrize(
    "origin",
    [
        # Non-http(s) scheme: a ``file://`` or ``chrome-extension://`` origin
        # is not CORS-meaningful for our localhost match, so the helper bails
        # before the host comparison and returns ``False``.
        "file:///tmp/index.html",
        "chrome-extension://abcdef",
        # Missing host: ``http://`` parses cleanly but ``hostname`` is None;
        # the second guard branch in :func:`_origin_is_localhost` covers it.
        "http://",
    ],
)
def test_origin_is_localhost_rejects_unparseable_origins(origin: str) -> None:
    """The host-portion parser bails on origins it cannot meaningfully match.

    These are not real CORS-config inputs an operator would ship, but
    the defensive guards in :func:`_origin_is_localhost` keep a typo or
    a future caller's odd input from crashing the lifespan -- the helper
    is called from a startup warning path, so we want a hard ``False``
    rather than an exception bubble.
    """

    assert main._origin_is_localhost(origin) is False
