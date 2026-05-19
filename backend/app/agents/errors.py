"""Typed errors raised by the agents module.

These extend :class:`app.errors.AppError` so the existing FastAPI exception
handler in :mod:`app.main` already formats them as ``{"error": ...}`` JSON
responses with the correct status code.
"""

from http import HTTPStatus
from typing import Any, Optional

from app.errors import AppError


def _safe_cause_kind(exc: BaseException) -> str:
    """Map an internal exception to a safe, public-facing error category.

    Returns one of: ``database_error``, ``network_error``, ``timeout_error``,
    ``unknown_error``.  Raw exception class names (e.g. ``psycopg.OperationalError``)
    are intentionally NOT surfaced to API clients to avoid leaking internal
    implementation details.  The original exception is still available on
    :attr:`AgentExecutionError.cause` for internal logging / Sentry.
    """
    qualname = type(exc).__qualname__.lower()
    module = (type(exc).__module__ or "").lower()

    # Timeout: check before network because some timeout types inherit from
    # connection errors in certain libraries.
    if "timeout" in qualname or "timeout" in module:
        return "timeout_error"

    # Database: psycopg, asyncpg, sqlalchemy, motor, pymongo, redis, etc.
    db_markers = ("psycopg", "asyncpg", "sqlalchemy", "pymongo", "motor", "redis")
    if any(m in module for m in db_markers):
        return "database_error"
    if any(m in qualname for m in ("operational", "database", "db")):
        return "database_error"

    # Network: connection/transport errors from httpx, requests, aiohttp, etc.
    net_markers = ("connection", "network", "http", "socket", "ssl", "tls")
    if any(m in qualname for m in net_markers):
        return "network_error"
    if any(m in module for m in ("httpx", "requests", "aiohttp", "urllib")):
        return "network_error"

    return "unknown_error"


class AgentError(AppError):
    """Base class for agent-related errors.

    ``code`` is a stable machine-readable enum. The SSE stream and
    JSON error envelopes surface it under ``data.code`` / ``error.code``
    so the FE can branch on a canonical value instead of string-
    matching ``message``. Subclasses override the class attribute.
    """

    code: str = "agent_error"

    def __init__(
        self,
        message: str,
        *,
        status_code: int = HTTPStatus.INTERNAL_SERVER_ERROR,
        details: Any = None,
    ) -> None:
        payload: dict[str, Any] = {"error": message}
        if details is not None:
            payload["details"] = details
        super().__init__(status_code, payload)
        self.message = message
        self.details = details


class AgentNotFoundError(AgentError):
    """Raised when an unknown agent name is requested."""

    code = "agent_not_found"

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Agent '{name}' is not registered",
            status_code=HTTPStatus.NOT_FOUND,
            details={"name": name},
        )
        self.name = name


class AgentAlreadyRegisteredError(AgentError):
    """Raised when two agents try to register under the same name."""

    code = "agent_already_registered"

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Agent '{name}' is already registered",
            status_code=HTTPStatus.CONFLICT,
            details={"name": name},
        )
        self.name = name


class AgentConfigurationError(AgentError):
    """Raised when an agent or its runtime is misconfigured."""

    code = "agent_configuration"

    def __init__(self, message: str, *, details: Any = None) -> None:
        super().__init__(
            message,
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            details=details,
        )


class AgentRecursionError(AgentError):
    """Raised when an agent exceeds its configured ``recursion_limit``."""

    code = "agent_recursion"

    def __init__(self, name: str, recursion_limit: int) -> None:
        super().__init__(
            f"Agent '{name}' exceeded recursion limit of {recursion_limit}",
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            details={"name": name, "recursion_limit": recursion_limit},
        )
        self.name = name
        self.recursion_limit = recursion_limit


class AgentExecutionError(AgentError):
    """Raised when an agent's graph fails for an otherwise unmapped reason."""

    code = "agent_execution"

    def __init__(
        self,
        name: str,
        *,
        cause: Optional[BaseException] = None,
        message: str = "Execution failed",
    ) -> None:
        # Map the raw exception to a safe public category so internal class
        # names (e.g. psycopg.OperationalError) are never exposed to clients
        # via cause_kind.  The raw class name is kept as "cause" for backward
        # compatibility with existing callers; cause_kind is the recommended
        # field for new consumers.  The original exception stays on self.cause
        # for internal logging / Sentry.
        cause_kind: Optional[str] = _safe_cause_kind(cause) if cause is not None else None
        cause_message: Optional[str] = None
        if cause is not None:
            raw = str(cause)
            cause_message = raw[:200] if len(raw) > 200 else raw
        super().__init__(
            f"Agent '{name}' failed: {message}",
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            details={
                "name": name,
                "cause": type(cause).__name__ if cause is not None else None,
                "cause_kind": cause_kind,
                "cause_message": cause_message,
            },
        )
        self.name = name
        self.cause = cause


class InvalidThreadKeyError(AgentError):
    """Raised when a signed thread key is rejected (cross-user or tampered token).

    Carries HTTP 400 so callers get a 4xx (client error) rather than the
    5xx that the generic :class:`AgentExecutionError` wraps would produce.
    """

    code = "invalid_thread_key"

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            status_code=HTTPStatus.BAD_REQUEST,
        )
