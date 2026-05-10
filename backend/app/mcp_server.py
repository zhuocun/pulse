"""Streamable HTTP MCP surface with Mongo-backed fe.* read tools."""

from __future__ import annotations

import asyncio
from typing import Any

import jwt
from starlette.responses import JSONResponse

from app.mcp_context import mcp_user_id
from app.mcp_tools import (
    mcp_fe_board_snapshot,
    mcp_fe_get_project,
    mcp_fe_get_task,
    mcp_fe_list_board,
    mcp_fe_list_members,
    mcp_fe_list_projects,
    mcp_fe_list_tasks,
)
from app.security import JWT_SCOPE_AI_PROXY, JWT_SCOPE_REST, decode_token, token_scope


class McpRestAuthMiddleware:
    """Require a REST-scoped JWT for every MCP HTTP request."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            await JSONResponse(
                {"error": "missing_bearer_token"}, status_code=401
            )(scope, receive, send)
            return
        token = auth.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token)
        except jwt.PyJWTError:
            await JSONResponse({"error": "invalid_jwt"}, status_code=401)(
                scope, receive, send
            )
            return
        scp = token_scope(payload)
        if scp not in (JWT_SCOPE_REST, JWT_SCOPE_AI_PROXY):
            await JSONResponse({"error": "invalid_jwt_scope"}, status_code=401)(
                scope, receive, send
            )
            return
        if scp == JWT_SCOPE_AI_PROXY:
            await JSONResponse(
                {
                    "error": (
                        "ai_proxy_token_cannot_access_mcp; "
                        "use the primary REST JWT from login"
                    )
                },
                status_code=401,
            )(scope, receive, send)
            return
        uid = payload.get("sub")
        if not isinstance(uid, str) or not uid:
            await JSONResponse({"error": "invalid_jwt"}, status_code=401)(
                scope, receive, send
            )
            return
        reset = mcp_user_id.set(uid)
        try:
            await self.app(scope, receive, send)
        finally:
            mcp_user_id.reset(reset)


def build_fastmcp_server() -> Any:
    """Return a configured :class:`mcp.server.fastmcp.FastMCP` (tests + tooling)."""

    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP(
        name="pulse-board-copilot",
        instructions=(
            "Read-only board tools backed by the Pulse Mongo API. "
            "Authenticate with the same REST JWT as /api/v1/*. "
            "Narrow ai_proxy tokens are rejected."
        ),
        streamable_http_path="/",
        stateless_http=True,
    )

    @mcp.tool(name="fe.listProjects")
    async def fe_list_projects(limit: int = 50) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_list_projects, mcp_user_id.get(), limit
            )
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.getProject")
    async def fe_get_project(project_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_get_project, mcp_user_id.get(), project_id
            )
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.listBoard")
    async def fe_list_board(project_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_list_board, mcp_user_id.get(), project_id
            )
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.listTasks")
    async def fe_list_tasks(project_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_list_tasks, mcp_user_id.get(), project_id
            )
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.getTask")
    async def fe_get_task(task_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(mcp_fe_get_task, mcp_user_id.get(), task_id)
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.listMembers")
    async def fe_list_members(project_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_list_members, mcp_user_id.get(), project_id
            )
        except PermissionError:
            return {"error": "unauthorized"}

    @mcp.tool(name="fe.boardSnapshot")
    async def fe_board_snapshot(project_id: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(
                mcp_fe_board_snapshot, mcp_user_id.get(), project_id
            )
        except PermissionError:
            return {"error": "unauthorized"}

    return mcp


def build_mcp_asgi_stack() -> Any:
    """ASGI app mounted at ``/mcp`` (inner routes use path ``/``)."""

    mcp = build_fastmcp_server()
    inner = mcp.streamable_http_app()
    return McpRestAuthMiddleware(inner)
