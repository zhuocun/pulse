"""Coverage for MCP Streamable HTTP stack and Mongo-backed tool runners."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import asyncio
from unittest.mock import AsyncMock

import jwt
import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.mcp_server import (
    McpRestAuthMiddleware,
    build_fastmcp_server,
    build_mcp_asgi_stack,
)
from app.mcp_tools import (
    mcp_fe_board_snapshot,
    mcp_fe_get_project,
    mcp_fe_get_task,
    mcp_fe_list_board,
    mcp_fe_list_members,
    mcp_fe_list_projects,
    mcp_fe_list_tasks,
)
from app.security import create_ai_proxy_token, create_token, jwt_secret


def test_mcp_middleware_non_http_scope_passthrough() -> None:
    async def _run() -> None:
        inner = AsyncMock()
        mw = McpRestAuthMiddleware(inner)
        await mw({"type": "websocket", "headers": []}, None, None)
        inner.assert_awaited_once()

    asyncio.run(_run())


def test_mcp_auth_middleware_rejects_missing_bearer() -> None:
    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    response = client.get("/")
    assert response.status_code == 401


def test_mcp_auth_middleware_rejects_ai_proxy_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")

    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    tok = create_ai_proxy_token("u1")
    response = client.get("/", headers={"Authorization": f"Bearer {tok}"})
    assert response.status_code == 401


def test_mcp_auth_middleware_accepts_rest_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")

    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    tok = create_token("u1")
    response = client.get("/", headers={"Authorization": f"Bearer {tok}"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_mcp_auth_middleware_rejects_malformed_jwt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")

    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    response = client.get("/", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_mcp_list_projects_requires_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")
    with pytest.raises(PermissionError):
        mcp_fe_list_projects(None, 10)


def test_mcp_auth_middleware_rejects_unknown_scope_jwt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")

    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    issued_at = datetime.now(timezone.utc)
    bad = jwt.encode(
        {
            "sub": "u1",
            "iat": issued_at,
            "exp": issued_at + timedelta(hours=1),
            "scp": "nope",
        },
        jwt_secret(),
        algorithm="HS256",
    )
    response = client.get("/", headers={"Authorization": f"Bearer {bad}"})
    assert response.status_code == 401


def test_fastmcp_lists_pulse_tools() -> None:
    async def _list() -> set[str]:
        mcp = build_fastmcp_server()
        tools = await mcp.list_tools()
        return {t.name for t in tools}

    names = asyncio.run(_list())
    assert "fe.listProjects" in names
    assert "fe.boardSnapshot" in names


def test_mcp_call_tool_runs_list_projects_with_stubbed_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.mcp_tools.project_service.get", lambda *_a, **_k: [])

    async def _go() -> None:
        from app.mcp_context import mcp_user_id

        mcp = build_fastmcp_server()
        mcp_user_id.set("u1")
        await mcp.call_tool("fe.listProjects", {"limit": 2})

    asyncio.run(_go())

def test_build_mcp_stack_is_callable() -> None:
    assert callable(build_mcp_asgi_stack())


def test_mcp_tools_propagate_project_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_get(*_a: object, **_k: object) -> str:
        return "Forbidden"

    monkeypatch.setattr("app.mcp_tools.project_service.get", forbidden_get)
    assert mcp_fe_get_project("u", "p1") == {"error": "forbidden"}

    monkeypatch.setattr(
        "app.mcp_tools.board_service.get", lambda *_a, **_k: "Forbidden"
    )
    assert mcp_fe_list_board("u", "p1") == {"error": "forbidden"}

    monkeypatch.setattr(
        "app.mcp_tools.task_service.get", lambda *_a, **_k: "Forbidden"
    )
    assert mcp_fe_list_tasks("u", "p1") == {"error": "forbidden"}


def test_mcp_get_task_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.mcp_tools.repository.find_by_id", lambda *_a, **_k: None)
    assert mcp_fe_get_task("u", "t1") == {"error": "not_found"}


def test_mcp_list_members_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.project_service.is_project_manager",
        lambda *_a, **_k: False,
    )
    assert mcp_fe_list_members("u", "p1") == {"error": "forbidden"}


def test_mcp_board_snapshot_empty_board(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.mcp_tools.board_service.get", lambda *_a, **_k: [])
    monkeypatch.setattr("app.mcp_tools.task_service.get", lambda *_a, **_k: [])
    monkeypatch.setattr("app.mcp_tools.user_service.get_members", lambda: [])
    snap = mcp_fe_board_snapshot("u", "p1")
    assert snap["counts"]["total"] == 0


def test_mcp_invokes_all_registered_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.project_service.is_project_manager",
        lambda *_a, **_k: True,
    )

    def ps_get(
        project_id: object,
        project_name: object,
        manager_id: object,
        *,
        viewer_id: object,
    ) -> object:
        if project_id == "p1":
            return {"_id": "p1", "projectName": "Pn"}
        return []

    monkeypatch.setattr("app.mcp_tools.project_service.get", ps_get)
    monkeypatch.setattr(
        "app.mcp_tools.board_service.get",
        lambda *_a, **_k: [{"_id": "c1", "projectId": "p1", "columnName": "C"}],
    )
    monkeypatch.setattr("app.mcp_tools.task_service.get", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.mcp_tools.user_service.get_members",
        lambda: [{"_id": "u1", "username": "alice"}],
    )
    monkeypatch.setattr(
        "app.mcp_tools.repository.find_by_id",
        lambda *_a, **_k: {
            "_id": "t1",
            "projectId": "p1",
            "taskName": "Task",
            "coordinatorId": "u1",
        },
    )

    async def _go() -> None:
        from app.mcp_context import mcp_user_id

        mcp = build_fastmcp_server()
        mcp_user_id.set("u1")
        await mcp.call_tool("fe.listProjects", {"limit": 2})
        await mcp.call_tool("fe.getProject", {"project_id": "p1"})
        await mcp.call_tool("fe.listBoard", {"project_id": "p1"})
        await mcp.call_tool("fe.listTasks", {"project_id": "p1"})
        await mcp.call_tool("fe.getTask", {"task_id": "t1"})
        await mcp.call_tool("fe.listMembers", {"project_id": "p1"})
        await mcp.call_tool("fe.boardSnapshot", {"project_id": "p1"})

    asyncio.run(_go())


def test_mcp_auth_middleware_rejects_empty_sub(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UUID", "test-secret-change-me-32-bytes-long")

    async def ok(_request):  # noqa: ANN001
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/", ok, methods=["GET"])])
    wrapped = McpRestAuthMiddleware(app)
    client = TestClient(wrapped)
    issued_at = datetime.now(timezone.utc)
    bad = jwt.encode(
        {
            "sub": "",
            "iat": issued_at,
            "exp": issued_at + timedelta(hours=1),
            "scp": "rest",
        },
        jwt_secret(),
        algorithm="HS256",
    )
    response = client.get("/", headers={"Authorization": f"Bearer {bad}"})
    assert response.status_code == 401


def test_mcp_call_tool_list_projects_permissionerror_unauthorized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(*_a: object, **_k: object) -> None:
        raise PermissionError("nope")

    monkeypatch.setattr("app.mcp_server.mcp_fe_list_projects", _boom)

    async def _go() -> None:
        from app.mcp_context import mcp_user_id

        mcp = build_fastmcp_server()
        mcp_user_id.set("u1")
        res = await mcp.call_tool("fe.listProjects", {"limit": 1})
        assert "unauthorized" in str(res).lower()

    asyncio.run(_go())


def test_mcp_fe_list_projects_forbidden_and_non_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.project_service.get",
        lambda *_a, **_k: "Forbidden",
    )
    assert mcp_fe_list_projects("u", 5) == {"error": "forbidden"}

    monkeypatch.setattr(
        "app.mcp_tools.project_service.get",
        lambda *_a, **_k: {"not": "list"},
    )
    assert mcp_fe_list_projects("u", 5) == {"projects": []}


def test_mcp_fe_get_project_not_found_and_bad_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.project_service.get",
        lambda *_a, **_k: None,
    )
    assert mcp_fe_get_project("u", "p1") == {"error": "not_found"}
    monkeypatch.setattr(
        "app.mcp_tools.project_service.get",
        lambda *_a, **_k: "not-a-dict",
    )
    assert mcp_fe_get_project("u", "p1") == {"error": "not_found"}


def test_mcp_fe_list_board_not_found_and_non_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.board_service.get", lambda *_a, **_k: None
    )
    assert mcp_fe_list_board("u", "p1") == {"error": "not_found"}
    monkeypatch.setattr(
        "app.mcp_tools.board_service.get", lambda *_a, **_k: {"x": 1}
    )
    assert mcp_fe_list_board("u", "p1") == {"columns": []}


def test_mcp_fe_list_tasks_error_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.task_service.get",
        lambda *_a, **_k: "Not Found",
    )
    assert mcp_fe_list_tasks("u", "p1") == {"error": "not_found"}


def test_mcp_fe_get_task_forbidden_for_non_manager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.repository.find_by_id",
        lambda *_a, **_k: {"_id": "t1", "projectId": "p1"},
    )
    monkeypatch.setattr(
        "app.mcp_tools.project_service.is_project_manager",
        lambda *_a, **_k: False,
    )
    assert mcp_fe_get_task("u", "t1") == {"error": "forbidden"}


def test_mcp_fe_board_snapshot_task_service_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.mcp_tools.board_service.get", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.mcp_tools.task_service.get",
        lambda *_a, **_k: "Internal Error",
    )
    assert mcp_fe_board_snapshot("u", "p1") == {"error": "internal_error"}


def test_mcp_fe_board_snapshot_unowned_note_and_workload_points(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.mcp_tools.board_service.get", lambda *_a, **_k: [])
    tasks = [
        {
            "_id": "t1",
            "columnId": "c1",
            "taskName": "A",
            "note": "secret",
        },
        {
            "_id": "t2",
            "columnId": "c1",
            "taskName": "B",
            "coordinatorId": "u9",
            "storyPoints": 5.5,
        },
    ]
    monkeypatch.setattr(
        "app.mcp_tools.task_service.get", lambda *_a, **_k: tasks
    )
    monkeypatch.setattr("app.mcp_tools.user_service.get_members", lambda: [])
    snap = mcp_fe_board_snapshot("u", "p1")
    assert len(snap["unowned"]) == 1
    assert "note" in snap["unowned"][0]
    w = {x["coordinatorId"]: x for x in snap["workload"]}
    assert w["u9"]["points"] == 5.5


def test_mcp_fe_board_snapshot_board_forbidden_and_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.mcp_tools.board_service.get", lambda *_a, **_k: "Forbidden"
    )
    assert mcp_fe_board_snapshot("u", "p1") == {"error": "forbidden"}
    monkeypatch.setattr(
        "app.mcp_tools.board_service.get", lambda *_a, **_k: None
    )
    assert mcp_fe_board_snapshot("u", "p1") == {"error": "not_found"}


@pytest.mark.parametrize(
    "target,tool_name,arguments",
    [
        ("app.mcp_server.mcp_fe_get_project", "fe.getProject", {"project_id": "p"}),
        ("app.mcp_server.mcp_fe_list_board", "fe.listBoard", {"project_id": "p"}),
        ("app.mcp_server.mcp_fe_list_tasks", "fe.listTasks", {"project_id": "p"}),
        ("app.mcp_server.mcp_fe_get_task", "fe.getTask", {"task_id": "t"}),
        ("app.mcp_server.mcp_fe_list_members", "fe.listMembers", {"project_id": "p"}),
        (
            "app.mcp_server.mcp_fe_board_snapshot",
            "fe.boardSnapshot",
            {"project_id": "p"},
        ),
    ],
)
def test_mcp_call_tool_permissionerror_on_each_fe_tool(
    monkeypatch: pytest.MonkeyPatch,
    target: str,
    tool_name: str,
    arguments: dict,
) -> None:
    monkeypatch.setattr(
        target,
        lambda *_a, **_k: (_ for _ in ()).throw(PermissionError("nope")),
    )

    async def _call() -> str:
        from app.mcp_context import mcp_user_id

        mcp = build_fastmcp_server()
        mcp_user_id.set("u1")
        res = await mcp.call_tool(tool_name, arguments)
        return str(res).lower()

    assert "unauthorized" in asyncio.run(_call())


def test_mcp_fe_board_snapshot_skips_non_dict_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.mcp_tools.board_service.get", lambda *_a, **_k: [])
    monkeypatch.setattr(
        "app.mcp_tools.task_service.get",
        lambda *_a, **_k: [
            "not-a-dict",
            {
                "_id": "t1",
                "columnId": "c1",
                "coordinatorId": "u7",
            },
        ],
    )
    monkeypatch.setattr("app.mcp_tools.user_service.get_members", lambda: [])
    snap = mcp_fe_board_snapshot("u", "p1")
    assert snap["counts"]["total"] == 2