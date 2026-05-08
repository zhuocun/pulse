"""Typed errors raised by the agents module.

These extend :class:`app.errors.AppError` so the existing FastAPI exception
handler in :mod:`app.main` already formats them as ``{"error": ...}`` JSON
responses with the correct status code.
"""

from http import HTTPStatus
from typing import Any, Optional

from app.errors import AppError


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
        super().__init__(
            f"Agent '{name}' failed: {message}",
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            details={"name": name, "cause": type(cause).__name__ if cause else None},
        )
        self.name = name
        self.cause = cause
