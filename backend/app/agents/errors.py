"""Typed errors raised by the agents module.

These extend :class:`app.errors.AppError` so the existing FastAPI exception
handler in :mod:`app.main` already formats them as ``{"error": ...}`` JSON
responses with the correct status code.
"""

from http import HTTPStatus
from typing import Any, Optional

from app.errors import AppError


class AgentError(AppError):
    """Base class for agent-related errors."""

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

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Agent '{name}' is not registered",
            status_code=HTTPStatus.NOT_FOUND,
            details={"name": name},
        )
        self.name = name


class AgentAlreadyRegisteredError(AgentError):
    """Raised when two agents try to register under the same name."""

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Agent '{name}' is already registered",
            status_code=HTTPStatus.CONFLICT,
            details={"name": name},
        )
        self.name = name


class AgentConfigurationError(AgentError):
    """Raised when an agent or its runtime is misconfigured."""

    def __init__(self, message: str, *, details: Any = None) -> None:
        super().__init__(
            message,
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            details=details,
        )


class AgentRecursionError(AgentError):
    """Raised when an agent exceeds its configured ``recursion_limit``."""

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
