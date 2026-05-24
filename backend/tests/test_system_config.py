"""Unit tests for :mod:`app.system_config`.

The bootstrap helper is the heart of the JWT-secret read-or-create flow
in the FastAPI lifespan. These tests pin the three independent
contracts:

1. An existing persisted secret round-trips unchanged.
2. A missing row triggers a generate-and-store.
3. A concurrent peer that already inserted the row wins the race --
   the second worker re-reads the persisted value instead of
   overwriting it.
"""

from __future__ import annotations

import pytest

from app import system_config
from app.system_config import (
    SYSTEM_CONFIG,
    load_or_create_jwt_secret,
)
from tests.conftest import FakeStore


def test_load_returns_existing_persisted_secret() -> None:
    """An already-stored row is read verbatim with ``source='persisted'``."""

    store = FakeStore()
    store.insert_one(
        SYSTEM_CONFIG,
        {"_id": "jwt_secret", "value": "deadbeefcafebabe" * 4},
    )

    secret, source = load_or_create_jwt_secret(store)

    assert secret == "deadbeefcafebabe" * 4
    assert source == "persisted"


def test_load_creates_secret_on_miss_with_generated_source() -> None:
    """First boot inserts a fresh row and reports ``source='generated'``."""

    store = FakeStore()

    secret, source = load_or_create_jwt_secret(store)

    assert source == "generated"
    assert len(secret) == 64  # 32 bytes * 2 hex chars
    persisted = store.find_one(SYSTEM_CONFIG, {"_id": "jwt_secret"})
    assert persisted is not None
    assert persisted["value"] == secret


def test_load_re_read_returns_same_secret_on_subsequent_calls() -> None:
    """Second call after a create reads the same persisted secret.

    This is the steady-state path operators see after the very first
    cold boot: every subsequent lifespan round trips through the
    persisted value rather than minting a new one.
    """

    store = FakeStore()
    first_secret, first_source = load_or_create_jwt_secret(store)
    second_secret, second_source = load_or_create_jwt_secret(store)

    assert first_secret == second_secret
    assert first_source == "generated"
    assert second_source == "persisted"


def test_load_falls_back_to_generated_value_when_read_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A broken ``find_one`` short-circuits to the generate-and-store path."""

    store = FakeStore()

    original_find_one = store.find_one
    call_count = {"value": 0}

    def _failing_find_one(name, query):
        call_count["value"] += 1
        # First call: raise to force the generate path. Second call
        # (the post-insert re-read) succeeds so the test can observe
        # the new value.
        if call_count["value"] == 1:
            raise RuntimeError("transient mongo error")
        return original_find_one(name, query)

    monkeypatch.setattr(store, "find_one", _failing_find_one)

    secret, source = load_or_create_jwt_secret(store)

    assert source == "generated"
    assert len(secret) == 64


def test_load_or_create_uses_upsert_helper_when_available() -> None:
    """``MongoRepository``-style upsert path is taken when the method exists.

    Asserting on the call confirms the production path uses the
    idempotent ``$setOnInsert`` upsert rather than ``insert_one`` --
    the latter would race two workers to two different secrets.
    """

    captured: dict[str, object] = {}

    class _UpsertingStore(FakeStore):
        def upsert_system_config(self, doc_id, document):  # type: ignore[override]
            captured["doc_id"] = doc_id
            captured["document"] = document
            # Mimic Mongo's $setOnInsert by writing to the underlying dict.
            self.data[SYSTEM_CONFIG].append({**document})

    store = _UpsertingStore()
    secret, _source = load_or_create_jwt_secret(store)

    assert captured["doc_id"] == "jwt_secret"
    assert isinstance(captured["document"], dict)
    assert secret == store.data[SYSTEM_CONFIG][0]["value"]


def test_load_returns_generated_value_when_post_read_also_misses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defensive branch: re-read returns nothing -> surface freshly-minted secret."""

    store = FakeStore()
    monkeypatch.setattr(store, "find_one", lambda _name, _query: None)
    monkeypatch.setattr(store, "insert_one", lambda _name, _data: None)

    secret, source = load_or_create_jwt_secret(store)

    assert source == "generated"
    assert len(secret) == 64
    assert system_config._JWT_SECRET_DOC_ID == "jwt_secret"  # contract pin
