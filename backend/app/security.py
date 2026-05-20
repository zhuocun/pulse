from datetime import datetime, timedelta, timezone
from hashlib import md5, pbkdf2_hmac
import hmac
import secrets
from typing import Any, Dict, Optional

import jwt
from fastapi import Cookie, Header, HTTPException, status

from app.config import settings


# Name of the HttpOnly REST session cookie issued by ``/auth/login``.
# Same value the FE used for its prior JS-set cookie, so any historical
# probes / docs that reference ``Token`` still point at the right thing.
SESSION_COOKIE_NAME = "Token"

PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
# OWASP 2023+ guidance for PBKDF2-HMAC-SHA256.
PASSWORD_HASH_ITERATIONS = 600_000
JWT_SECRET_MIN_LENGTH = 32

# Narrow scopes keep XSS from stealing a single vault that authorises REST.
JWT_SCOPE_REST = "rest"
JWT_SCOPE_AI_PROXY = "ai_proxy"

# Stable hash a constant-time login compares against when the email
# does not exist. Computed once at import so every code path performs
# the same amount of work regardless of whether the user is real.
_DUMMY_PASSWORD_HASH = (
    f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}$"
    + "0" * 32
    + "$"
    + "0" * 64
)


def encrypt_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}${salt}${digest}"


def legacy_password_hash(password: str) -> str:
    return md5(("zhuocun" + password).encode("utf-8")).hexdigest()


def verify_password(password: str, stored_hash: str) -> bool:
    if stored_hash.startswith(f"{PASSWORD_HASH_PREFIX}$"):
        try:
            _, iterations, salt, digest = stored_hash.split("$", 3)
            candidate = pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                bytes.fromhex(salt),
                int(iterations),
            ).hex()
        except (TypeError, ValueError):
            return False
        return hmac.compare_digest(candidate, digest)

    return hmac.compare_digest(legacy_password_hash(password), stored_hash)


def dummy_password_hash() -> str:
    """Return a constant-time-comparable PBKDF2 hash that no password matches.

    Used during login when the email is unknown so the response time
    stays close to the path that runs a real password verification —
    an attacker cannot enumerate valid emails by timing requests.
    """

    return _DUMMY_PASSWORD_HASH


def jwt_secret() -> str:
    if len(settings.jwt_secret) < JWT_SECRET_MIN_LENGTH:
        raise RuntimeError(
            f"JWT secret must be set to at least {JWT_SECRET_MIN_LENGTH} characters"
        )
    return settings.jwt_secret


def create_token(user_id: str) -> str:
    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": issued_at,
        "exp": issued_at + timedelta(seconds=settings.jwt_expires_seconds),
        "scp": JWT_SCOPE_REST,
    }
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def create_ai_proxy_token(user_id: str) -> str:
    """Short-lived JWT accepted only by AI/agent routes."""

    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": issued_at,
        "exp": issued_at + timedelta(seconds=settings.jwt_ai_proxy_expires_seconds),
        "scp": JWT_SCOPE_AI_PROXY,
    }
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(
        token,
        jwt_secret(),
        algorithms=["HS256"],
        options={"require": ["exp", "iat", "sub"]},
    )


def token_scope(payload: Dict[str, Any]) -> str:
    """Return scope; missing ``scp`` means a pre-scope token (full REST access)."""

    raw = payload.get("scp")
    if not isinstance(raw, str) or not raw.strip():
        return JWT_SCOPE_REST
    return raw.strip()


def _extract_bearer(authorization: str, cookie_token: Optional[str]) -> str:
    """Pick the request's JWT off the ``Authorization`` header or session cookie.

    Two transports are supported because the FE moved to an HttpOnly
    cookie issued by ``/auth/login`` (the browser cannot read or send a
    JS-set ``Authorization`` reliably across a WebKit document teardown
    on iOS Safari 26.5), while non-browser callers (tests, curl, future
    native apps) keep using ``Authorization: Bearer``. Header wins when
    both are present so a caller overriding auth for one request --
    e.g. impersonation in a script -- is not silently shadowed by a
    stale cookie left over from a prior session.
    """

    prefix = "Bearer "
    if authorization.startswith(prefix):
        token = authorization[len(prefix):]
        if token:
            return token
    if cookie_token:
        return cookie_token
    return ""


def current_user_payload(
    authorization: str = Header(default=""),
    session_cookie: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Dict[str, Any]:
    token = _extract_bearer(authorization, session_cookie)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "empty JWT"},
        )
    try:
        payload = decode_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid JWT"},
        ) from exc
    if token_scope(payload) == JWT_SCOPE_AI_PROXY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "ai_proxy token cannot access this route"},
        )
    return payload


def current_user_payload_for_ai(
    authorization: str = Header(default=""),
    session_cookie: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Dict[str, Any]:
    """Accept primary REST tokens and narrow ``ai_proxy`` tokens."""

    token = _extract_bearer(authorization, session_cookie)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "empty JWT"},
        )
    try:
        payload = decode_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid JWT"},
        ) from exc
    scope = token_scope(payload)
    if scope not in (JWT_SCOPE_REST, JWT_SCOPE_AI_PROXY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid JWT scope"},
        )
    return payload


def current_user_id(payload: Dict[str, Any]) -> str:
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid JWT"},
        )
    return user_id
