"""Server-side read implementations backing MCP tool names (``fe.*``)."""

from __future__ import annotations

from collections import Counter
from typing import Any

from app.database import TASKS
from app.repositories import repository
from app.services import board_service, project_service, task_service, user_service


def _require_user(user_id: str | None) -> str:
    if not user_id:
        raise PermissionError("missing_bearer")
    return user_id


def mcp_fe_list_projects(user_id: str | None, limit: int = 50) -> dict[str, Any]:
    uid = _require_user(user_id)
    raw = project_service.get(None, None, None, viewer_id=uid)
    if raw == "Forbidden":
        return {"error": "forbidden"}
    if not isinstance(raw, list):
        return {"projects": []}
    return {"projects": raw[: max(1, min(limit, 100))]}


def mcp_fe_get_project(user_id: str | None, project_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    raw = project_service.get(project_id, None, None, viewer_id=uid)
    if raw == "Forbidden":
        return {"error": "forbidden"}
    if raw is None:
        return {"error": "not_found"}
    if not isinstance(raw, dict):
        return {"error": "not_found"}
    return {"project": raw}


def mcp_fe_list_board(user_id: str | None, project_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    cols = board_service.get(project_id, uid)
    if cols == "Forbidden":
        return {"error": "forbidden"}
    if cols is None:
        return {"error": "not_found"}
    if not isinstance(cols, list):
        return {"columns": []}
    return {"columns": cols}


def mcp_fe_list_tasks(user_id: str | None, project_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    raw = task_service.get(project_id, uid)
    if isinstance(raw, str):
        return {"error": raw.lower().replace(" ", "_")}
    return {"tasks": raw}


def mcp_fe_get_task(user_id: str | None, task_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    doc = repository.serialize_document(repository.find_by_id(TASKS, task_id))
    if doc is None:
        return {"error": "not_found"}
    project_id = doc.get("projectId")
    if not project_id or not project_service.is_project_manager(str(project_id), uid):
        return {"error": "forbidden"}
    return {"task": doc}


def mcp_fe_list_members(user_id: str | None, project_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    if not project_service.is_project_manager(project_id, uid):
        return {"error": "forbidden"}
    directory = user_service.get_members()
    return {"members": directory}


def mcp_fe_board_snapshot(user_id: str | None, project_id: str) -> dict[str, Any]:
    uid = _require_user(user_id)
    cols_res = board_service.get(project_id, uid)
    if cols_res == "Forbidden":
        return {"error": "forbidden"}
    if cols_res is None:
        return {"error": "not_found"}
    tasks_res = task_service.get(project_id, uid)
    if isinstance(tasks_res, str):
        return {"error": tasks_res.lower().replace(" ", "_")}
    tasks = tasks_res if isinstance(tasks_res, list) else []
    by_column: Counter[str] = Counter()
    for task in tasks:
        if isinstance(task, dict):
            cid = str(task.get("columnId") or "")
            if cid:
                by_column[cid] += 1
    members_raw = user_service.get_members()
    members_out = [
        {"id": str(m.get("_id")), "name": str(m.get("username") or m.get("email") or "")}
        for m in members_raw
        if isinstance(m, dict) and m.get("_id")
    ]
    unowned: list[dict[str, Any]] = []
    workload: dict[str, dict[str, float]] = {}
    for task in tasks:
        if not isinstance(task, dict):
            continue
        tid = task.get("_id") or task.get("id")
        name = task.get("taskName") or ""
        coord = task.get("coordinatorId")
        note = task.get("note")
        if not coord:
            row: dict[str, Any] = {"taskId": str(tid), "name": str(name)}
            if note:
                row["note"] = str(note)
            unowned.append(row)
        bucket = workload.setdefault(str(coord), {"count": 0, "points": 0.0})
        bucket["count"] += 1
        sp = task.get("storyPoints")
        if isinstance(sp, (int, float)):
            bucket["points"] += float(sp)
    workload_out = [
        {"coordinatorId": k, "count": int(v["count"]), "points": v["points"]}
        for k, v in workload.items()
    ]
    return {
        "counts": {
            "total": len(tasks),
            "byColumn": [
                {"columnId": cid, "count": cnt} for cid, cnt in by_column.items()
            ],
        },
        "members": members_out,
        "unowned": unowned,
        "workload": workload_out,
    }
