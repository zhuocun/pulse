"""Request-scoped user id for MCP tool handlers (Streamable HTTP ASGI stack)."""

from __future__ import annotations

from contextvars import ContextVar

mcp_user_id: ContextVar[str | None] = ContextVar("mcp_user_id", default=None)
