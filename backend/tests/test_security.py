import pytest

from app import security
from app.security import (
    create_token,
    decode_token,
    dummy_password_hash,
    encrypt_password,
    legacy_password_hash,
    verify_password,
)


@pytest.fixture(autouse=True)
def jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )


def test_encrypt_password_uses_salted_hash_and_verifies_legacy_hash() -> None:
    first_hash = encrypt_password("secret")
    second_hash = encrypt_password("secret")

    assert first_hash.startswith("pbkdf2_sha256$")
    assert first_hash != second_hash
    assert verify_password("secret", first_hash) is True
    assert verify_password("wrong", first_hash) is False
    assert legacy_password_hash("secret") == "8c723f9bdb59148212c5495a411f8374"
    assert verify_password("secret", legacy_password_hash("secret")) is True
    assert verify_password("secret", "pbkdf2_sha256$bad") is False


def test_token_round_trip_carries_only_subject() -> None:
    token = create_token("abc123")
    payload = decode_token(token)

    assert payload["sub"] == "abc123"
    assert "userInfo" not in payload
    assert {"sub", "iat", "exp"}.issubset(payload)


def test_dummy_password_hash_never_matches_a_real_password() -> None:
    assert verify_password("anything", dummy_password_hash()) is False


def test_jwt_secret_must_be_configured() -> None:
    object.__setattr__(security.settings, "jwt_secret", "short")

    with pytest.raises(RuntimeError, match="JWT secret must be set"):
        create_token("abc123")
