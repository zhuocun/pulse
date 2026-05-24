"""Integration tests for the JWT-secret bootstrap inside the FastAPI lifespan.

The bootstrap path drops one operator-required env var (``UUID``) when
Mongo is reachable. These tests pin the resolution order:

    UUID env > persisted system_config row > random ephemeral secret

via :func:`app.main._validate_settings`, which is the public surface
that the lifespan invokes at boot.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app import main
from app.config import settings as app_settings
from app.system_config import SYSTEM_CONFIG
from tests.conftest import FakeStore


def _bypass_provider_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise unrelated boot checks so the JWT path is the only variable."""

    monkeypatch.setattr(main, "assert_provider_available", lambda settings: None)
    monkeypatch.setattr(
        main, "assert_embeddings_provider_available", lambda settings: None
    )
    monkeypatch.setattr(main, "_validate_agent_postgres_backend", lambda cfg: None)


def test_uuid_env_wins_over_persisted_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit UUID override is used verbatim even when a row exists."""

    _bypass_provider_checks(monkeypatch)
    monkeypatch.setenv("UUID", "operator-override-32-chars-minimum-long")

    store = FakeStore()
    store.insert_one(
        SYSTEM_CONFIG,
        {"_id": "jwt_secret", "value": "persisted-but-should-be-ignored"},
    )
    monkeypatch.setattr(main, "repository", store)
    cfg = replace(app_settings)

    source = main._validate_settings(cfg)

    assert source == "env"
    assert cfg.jwt_secret == "operator-override-32-chars-minimum-long"


def test_persisted_secret_is_used_when_uuid_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no UUID, an existing persisted row supplies the secret."""

    _bypass_provider_checks(monkeypatch)
    monkeypatch.delenv("UUID", raising=False)

    store = FakeStore()
    store.insert_one(
        SYSTEM_CONFIG,
        {"_id": "jwt_secret", "value": "p" * 64},
    )
    monkeypatch.setattr(main, "repository", store)
    cfg = replace(app_settings)

    source = main._validate_settings(cfg)

    assert source == "persisted"
    assert cfg.jwt_secret == "p" * 64


def test_first_boot_generates_and_persists_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No UUID, no existing row -> the bootstrap mints and persists one."""

    _bypass_provider_checks(monkeypatch)
    monkeypatch.delenv("UUID", raising=False)

    store = FakeStore()
    monkeypatch.setattr(main, "repository", store)
    cfg = replace(app_settings)

    source = main._validate_settings(cfg)

    assert source == "persisted"
    assert len(cfg.jwt_secret) == 64
    persisted = store.find_one(SYSTEM_CONFIG, {"_id": "jwt_secret"})
    assert persisted is not None
    assert persisted["value"] == cfg.jwt_secret


def test_uuid_shorter_than_minimum_still_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A too-short UUID is an operator typo and must surface at boot.

    Preserving this guard is important: a Mongo-persisted fallback
    would have been an unwanted silent override of the operator's
    declared value.
    """

    _bypass_provider_checks(monkeypatch)
    monkeypatch.setenv("UUID", "short")
    cfg = replace(app_settings)

    with pytest.raises(RuntimeError, match="UUID must be at least"):
        main._validate_settings(cfg)


def test_hosted_deploy_with_unreachable_mongo_raises_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hosted env + no UUID + Mongo down -> name the root cause explicitly."""

    _bypass_provider_checks(monkeypatch)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("UUID", raising=False)

    class _UnreachableRepo:
        def ping(self) -> None:
            raise RuntimeError("network unreachable")

    monkeypatch.setattr(main, "repository", _UnreachableRepo())
    cfg = replace(app_settings)

    with pytest.raises(RuntimeError, match="MONGO_URI is unreachable on Vercel"):
        main._validate_settings(cfg)


def test_local_dev_unreachable_mongo_falls_back_to_ephemeral(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local dev keeps degrading gracefully when Mongo is down."""

    _bypass_provider_checks(monkeypatch)
    for marker in (
        "VERCEL",
        "VERCEL_URL",
        "RENDER_EXTERNAL_HOSTNAME",
        "RENDER",
        "KUBERNETES_SERVICE_HOST",
        "FLY_APP_NAME",
        "RAILWAY_PROJECT_ID",
    ):
        monkeypatch.delenv(marker, raising=False)
    monkeypatch.delenv("UUID", raising=False)

    class _UnreachableRepo:
        def ping(self) -> None:
            raise RuntimeError("nope")

    monkeypatch.setattr(main, "repository", _UnreachableRepo())
    cfg = replace(app_settings, jwt_secret="ephemeral-but-long-enough-for-local-dev-32")

    source = main._validate_settings(cfg)

    assert source == "ephemeral"
