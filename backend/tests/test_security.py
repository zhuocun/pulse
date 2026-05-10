import pytest
from fastapi.testclient import TestClient

from app import security
from app.security import (
    create_ai_proxy_token,
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
    assert {"sub", "iat", "exp", "scp"}.issubset(payload)
    assert payload["scp"] == security.JWT_SCOPE_REST


def test_ai_proxy_token_scope() -> None:
    token = create_ai_proxy_token("user-xyz")
    payload = decode_token(token)
    assert payload["sub"] == "user-xyz"
    assert payload["scp"] == security.JWT_SCOPE_AI_PROXY


def test_ai_proxy_token_lists_agents_but_not_projects(client: TestClient) -> None:
    narrow = create_ai_proxy_token("user-1")
    headers = {"Authorization": f"Bearer {narrow}"}
    assert client.get("/api/v1/agents", headers=headers).status_code == 200
    deny = client.get("/api/v1/projects", headers=headers)
    assert deny.status_code == 401
    payload = deny.json()
    detail = payload.get("detail", payload)
    err = detail.get("error") if isinstance(detail, dict) else detail
    assert err == "ai_proxy token cannot access this route"


def test_token_scope_non_string_defaults_to_rest() -> None:
    assert security.token_scope({"scp": 99}) == security.JWT_SCOPE_REST


def test_ai_route_rejects_unknown_jwt_scope(client: TestClient) -> None:
    import jwt
    from datetime import datetime, timedelta, timezone

    issued = datetime.now(timezone.utc)
    payload = {
        "sub": "user-x",
        "iat": issued,
        "exp": issued + timedelta(hours=1),
        "scp": "admin",
    }
    tok = jwt.encode(payload, security.jwt_secret(), algorithm="HS256")
    deny = client.get("/api/v1/agents", headers={"Authorization": f"Bearer {tok}"})
    assert deny.status_code == 401


def test_ai_route_rejects_malformed_jwt(client: TestClient) -> None:
    deny = client.get(
        "/api/v1/agents",
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert deny.status_code == 401


def test_rest_token_still_lists_projects(client: TestClient) -> None:
    wide = create_token("user-2")
    headers = {"Authorization": f"Bearer {wide}"}
    assert client.get("/api/v1/projects", headers=headers).status_code == 200


def test_dummy_password_hash_never_matches_a_real_password() -> None:
    assert verify_password("anything", dummy_password_hash()) is False


def test_jwt_secret_must_be_configured() -> None:
    object.__setattr__(security.settings, "jwt_secret", "short")

    with pytest.raises(RuntimeError, match="JWT secret must be set"):
        create_token("abc123")
