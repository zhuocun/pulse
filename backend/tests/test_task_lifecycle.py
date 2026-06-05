"""Task archive / trash (soft-delete) + restore lifecycle tests
(PRD work-management-depth §5.4/§5.5; AC-W9/W10/W11).

DELETE /tasks now soft-deletes by default (stamps ``deletedAt``, leaves the
row + its sub-tree links + position intact so a ``restore`` is lossless);
``?purge=true`` keeps the legacy hard delete (orphan children + re-pack
sibling indexes). Archiving stamps ``archivedAt``; both markers hide the
task from the default ``GET /tasks`` read and are cleared by ``restore``.

Most cases drive the ``task_service`` functions DIRECTLY against the
in-memory ``FakeStore`` from ``conftest.py`` (the ``store`` fixture
monkeypatches the repository onto every service module). Real
users/projects/seeded columns come through the HTTP register-login-project
-board helpers reused from the sibling task suites. A handful of router-
level cases exercise the new query params / endpoints through the real
HTTP layer via ``TestClient``. The timestamps themselves are opaque here --
we only assert presence vs ``None`` and visibility in/out of the default
read.
"""

from typing import Any, Dict, List

from fastapi.testclient import TestClient

from app.database import TASKS
from app.services import task_service
from tests.conftest import FakeStore


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
    """Register + login a user; return the login body plus a bearer token."""

    response = client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "secret"},
    )
    assert response.status_code == 201, response.text

    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    token = client.cookies.get("Token")
    assert token, "POST /auth/login must set the Token cookie"
    body["jwt"] = token
    return body


def create_project(client: TestClient, token: str, name: str = "Pulse") -> str:
    response = client.post(
        "/api/v1/projects/",
        json={"projectName": name, "organization": "OpenAI"},
        headers=auth_headers(token),
    )
    assert response.status_code == 201, response.text
    projects = client.get("/api/v1/projects/", headers=auth_headers(token)).json()
    return next(
        project["_id"] for project in projects if project["projectName"] == name
    )


def first_column(client: TestClient, token: str, project_id: str) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == "To Do")


def add_member(
    client: TestClient,
    owner_token: str,
    project_id: str,
    user_id: str,
    role: str,
) -> None:
    response = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": user_id, "role": role},
        headers=auth_headers(owner_token),
    )
    assert response.status_code == 201, response.text


def make_task(
    user_id: str,
    project_id: str,
    column_id: str,
    **extra: Any,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": user_id,
        "taskName": "A task",
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return body


def create_task(
    user_id: str,
    project_id: str,
    column_id: str,
    **extra: Any,
) -> str:
    """Create one task through the service and return its id (str)."""

    assert (
        task_service.create(make_task(user_id, project_id, column_id, **extra), user_id)
        == "Task created"
    )
    # The just-inserted task is the highest-index one in its column.
    column_tasks = [
        task
        for task in store_tasks(project_id, column_id)
        if task["columnId"] == column_id
    ]
    newest = max(column_tasks, key=lambda task: task["index"])
    return str(newest["_id"])


# Module-level handle to the active FakeStore, populated per test by the
# helpers that need raw store reads. Keeping it explicit (rather than a
# fixture closure) lets the small id helpers above stay positional.
_STORE: FakeStore


def store_tasks(project_id: str, _column_id: str = "") -> List[Dict[str, Any]]:
    return _STORE.find_many(TASKS, {"projectId": project_id})


def stored_task(task_id: str) -> Dict[str, Any]:
    task = _STORE.find_by_id(TASKS, task_id)
    assert task is not None
    return task


def visible_ids(project_id: str, user_id: str, **flags: bool) -> List[str]:
    """The ids ``task_service.get`` returns for ``project_id`` (default read
    unless ``include_trashed`` / ``include_archived`` flags widen it)."""

    result = task_service.get(project_id, user_id, **flags)
    assert isinstance(result, list), result
    return [task["_id"] for task in result]


def bootstrap(client: TestClient, store: FakeStore) -> Dict[str, Any]:
    """Owner + project + "To Do" column; wire the module store handle."""

    global _STORE
    _STORE = store
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    return {"owner": owner, "project_id": project_id, "column": column}


# ---------------------------------------------------------------------------
# remove: soft delete by default, hard purge on demand
# ---------------------------------------------------------------------------


def test_remove_default_soft_deletes(client: TestClient, store: FakeStore) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    assert task_service.remove(task_id, owner["_id"]) == "Task deleted"

    # The row survives a soft delete; only ``deletedAt`` flips.
    task = stored_task(task_id)
    assert task.get("deletedAt") is not None
    assert task.get("archivedAt") is None


def test_remove_purge_hard_deletes_and_orphans_and_repacks(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]

    # Three siblings (index 0/1/2) plus a child parented to the index-0 task.
    parent_id = create_task(owner["_id"], project_id, column["_id"])
    middle_id = create_task(owner["_id"], project_id, column["_id"])
    last_id = create_task(owner["_id"], project_id, column["_id"])
    child_id = create_task(
        owner["_id"], project_id, column["_id"], parentTaskId=parent_id
    )
    assert stored_task(parent_id)["index"] == 0
    assert stored_task(middle_id)["index"] == 1
    assert stored_task(last_id)["index"] == 2
    assert stored_task(child_id)["index"] == 3

    assert task_service.remove(parent_id, owner["_id"], purge=True) == "Task deleted"

    # The parent row is gone (hard delete)...
    assert store.find_by_id(TASKS, parent_id) is None
    # ...its child is orphaned to top-level rather than cascade-deleted...
    assert stored_task(child_id).get("parentTaskId") in (None, "")
    # ...and the surviving siblings re-pack down to fill the index-0 hole.
    assert stored_task(middle_id)["index"] == 0
    assert stored_task(last_id)["index"] == 1
    assert stored_task(child_id)["index"] == 2


# ---------------------------------------------------------------------------
# get: default-exclude trashed/archived, opt back in via flags
# ---------------------------------------------------------------------------


def test_soft_deleted_excluded_from_default_get_included_with_flag(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    task_service.remove(task_id, owner["_id"])

    assert task_id not in visible_ids(project_id, owner["_id"])
    assert task_id in visible_ids(project_id, owner["_id"], include_trashed=True)


def test_archive_excluded_from_default_get_included_with_flag(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    assert task_service.archive(task_id, owner["_id"], True) == "Task archived"
    assert stored_task(task_id).get("archivedAt") is not None

    assert task_id not in visible_ids(project_id, owner["_id"])
    assert task_id in visible_ids(project_id, owner["_id"], include_archived=True)


def test_archive_false_clears_archived_at(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    task_service.archive(task_id, owner["_id"], True)
    assert stored_task(task_id).get("archivedAt") is not None

    assert task_service.archive(task_id, owner["_id"], False) == "Task archived"
    assert stored_task(task_id).get("archivedAt") is None
    # Unarchiving puts it back in the default read.
    assert task_id in visible_ids(project_id, owner["_id"])


def test_archive_non_bool_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    # A non-bool ``archived`` is rejected -- but only AFTER existence/access
    # pass, and the stored marker is left untouched.
    assert task_service.archive(task_id, owner["_id"], "yes") == "Bad request"
    assert stored_task(task_id).get("archivedAt") is None


# ---------------------------------------------------------------------------
# restore: clears BOTH markers, task reappears
# ---------------------------------------------------------------------------


def test_restore_clears_trash_and_archive_and_reappears(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    # Stamp BOTH markers so restore has to clear each one.
    task_service.archive(task_id, owner["_id"], True)
    task_service.remove(task_id, owner["_id"])
    assert stored_task(task_id).get("archivedAt") is not None
    assert stored_task(task_id).get("deletedAt") is not None
    assert task_id not in visible_ids(project_id, owner["_id"])

    assert task_service.restore(task_id, owner["_id"]) == "Task restored"
    refreshed = stored_task(task_id)
    assert refreshed.get("deletedAt") is None
    assert refreshed.get("archivedAt") is None
    # All the way back onto the active board in one step.
    assert task_id in visible_ids(project_id, owner["_id"])


# ---------------------------------------------------------------------------
# Missing id -> None (router 404)
# ---------------------------------------------------------------------------


def test_lifecycle_ops_on_missing_id_return_none(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner = ctx["owner"]
    missing = "ffffffffffffffffffffffff"

    assert task_service.remove(missing, owner["_id"]) is None
    assert task_service.restore(missing, owner["_id"]) is None
    assert task_service.archive(missing, owner["_id"], True) is None
    # A wholly absent id (None) is likewise not-found on the restore/archive
    # paths (remove maps None -> the dedicated "Lack of task information").
    assert task_service.restore(None, owner["_id"]) is None
    assert task_service.archive(None, owner["_id"], True) is None


# ---------------------------------------------------------------------------
# Access: a viewer (non-editor) is forbidden from mutating
# ---------------------------------------------------------------------------


def test_viewer_forbidden_on_remove_restore_archive(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    task_id = create_task(owner["_id"], project_id, column["_id"])

    viewer = register_and_login(client, "viewer", "viewer@example.com")
    add_member(client, owner["jwt"], project_id, viewer["_id"], "viewer")

    assert task_service.remove(task_id, viewer["_id"]) == "Forbidden"
    assert task_service.restore(task_id, viewer["_id"]) == "Forbidden"
    assert task_service.archive(task_id, viewer["_id"], True) == "Forbidden"
    # A viewer's forbidden archive must not even reach body validation -- a
    # non-bool flag still yields Forbidden, not Bad request (no probing).
    assert task_service.archive(task_id, viewer["_id"], "yes") == "Forbidden"
    # None of these touched the task.
    assert stored_task(task_id).get("deletedAt") is None
    assert stored_task(task_id).get("archivedAt") is None


# ---------------------------------------------------------------------------
# Router: query params + new endpoints through the real HTTP layer
# ---------------------------------------------------------------------------


def test_router_delete_soft_then_purge_and_restore_and_archive(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    headers = auth_headers(owner["jwt"])
    task_id = create_task(owner["_id"], project_id, column["_id"])

    # Default DELETE soft-deletes: 200 "Task deleted", row still present,
    # hidden from the default GET but visible with includeTrashed=true.
    deleted = client.delete(f"/api/v1/tasks/?taskId={task_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == "Task deleted"
    assert store.find_by_id(TASKS, task_id) is not None

    default_get = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=headers
    ).json()
    assert task_id not in {task["_id"] for task in default_get}

    trashed_get = client.get(
        f"/api/v1/tasks/?projectId={project_id}&includeTrashed=true", headers=headers
    ).json()
    assert task_id in {task["_id"] for task in trashed_get}

    # PUT /restore brings it back onto the default board.
    restored = client.put(
        "/api/v1/tasks/restore", json={"_id": task_id}, headers=headers
    )
    assert restored.status_code == 200, restored.text
    assert restored.json() == "Task restored"
    back = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=headers
    ).json()
    assert task_id in {task["_id"] for task in back}

    # PUT /archive hides it from the default read; includeArchived re-shows.
    archived = client.put(
        "/api/v1/tasks/archive",
        json={"_id": task_id, "archived": True},
        headers=headers,
    )
    assert archived.status_code == 200, archived.text
    assert archived.json() == "Task archived"
    default_after_archive = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=headers
    ).json()
    assert task_id not in {task["_id"] for task in default_after_archive}
    archived_get = client.get(
        f"/api/v1/tasks/?projectId={project_id}&includeArchived=true", headers=headers
    ).json()
    assert task_id in {task["_id"] for task in archived_get}

    # ``?purge=true`` hard-deletes: the row is finally gone from the store.
    purged = client.delete(
        f"/api/v1/tasks/?taskId={task_id}&purge=true", headers=headers
    )
    assert purged.status_code == 200, purged.text
    assert purged.json() == "Task deleted"
    assert store.find_by_id(TASKS, task_id) is None


def test_router_restore_and_archive_missing_and_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    owner, project_id, column = ctx["owner"], ctx["project_id"], ctx["column"]
    headers = auth_headers(owner["jwt"])
    task_id = create_task(owner["_id"], project_id, column["_id"])
    missing = "ffffffffffffffffffffffff"

    # Missing ids 404 on both new endpoints.
    assert (
        client.put(
            "/api/v1/tasks/restore", json={"_id": missing}, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/tasks/archive",
            json={"_id": missing, "archived": True},
            headers=headers,
        ).status_code
        == 404
    )

    # A non-bool ``archived`` on an existing task is a 400 Bad request.
    bad = client.put(
        "/api/v1/tasks/archive",
        json={"_id": task_id, "archived": "yes"},
        headers=headers,
    )
    assert bad.status_code == 400, bad.text
    assert bad.json() == {"error": "Bad request"}
