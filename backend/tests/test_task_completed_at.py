"""Server-managed ``completedAt`` auto-stamp tests (PRD §5.3 / AC-W8).

``completedAt`` is set when a task ENTERS a ``category=="done"`` column and
cleared when it LEAVES one. It is server-managed: never client-written, and
reconciled on create, update, and reorder.

These drive the ``task_service`` functions DIRECTLY against the in-memory
``FakeStore`` from ``conftest.py`` (the ``store`` fixture monkeypatches the
repository onto every service module). Real users / projects / seeded
columns come through the HTTP register-login-project-board helpers reused
from ``tests/test_task_richness.py``; done-ness is exercised by flipping a
column's persisted ``category`` to ``"done"`` directly on the store. The
stamp itself is opaque here -- we only assert presence vs ``None`` and that
an existing stamp survives an unrelated edit (we record WHEN a task was
completed, not when it was last touched).
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import COLUMNS, TASKS
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


def column_named(
    client: TestClient, token: str, project_id: str, column_name: str
) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == column_name)


def set_category(store: FakeStore, column_id: str, category: str) -> None:
    """Flip a column's persisted ``category`` straight on the store.

    Done-ness reads from ``category`` directly (see ``board_service`` /
    ``be_tools``), so this is all the service needs to treat the column as a
    done bucket; going through ``board_service.update`` would add an auth
    round-trip without changing what is persisted.
    """

    store.update_by_id(COLUMNS, column_id, {"category": category})


def stored_task(store: FakeStore, task_id: str) -> Dict[str, Any]:
    task = store.find_by_id(TASKS, task_id)
    assert task is not None
    return task


def only_task(store: FakeStore, project_id: str) -> Dict[str, Any]:
    tasks = store.find_many(TASKS, {"projectId": project_id})
    assert len(tasks) == 1, tasks
    return tasks[0]


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


# ---------------------------------------------------------------------------
# create: born completed iff the destination column is a done bucket
# ---------------------------------------------------------------------------


def test_create_into_done_column_stamps_completed_at(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    assert (
        task_service.create(
            make_task(owner["_id"], project_id, done["_id"]), owner["_id"]
        )
        == "Task created"
    )

    task = only_task(store, project_id)
    # A task created straight into a done column is born completed.
    assert task["completedAt"] is not None


def test_create_into_non_done_column_leaves_completed_at_none(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    assert (
        task_service.create(
            make_task(owner["_id"], project_id, todo["_id"]), owner["_id"]
        )
        == "Task created"
    )

    task = only_task(store, project_id)
    # "To Do" seeds ``category == "todo"`` -- not a done bucket.
    assert task["completedAt"] is None


# ---------------------------------------------------------------------------
# update: stamp on entering done, clear on leaving, hold while staying done
# ---------------------------------------------------------------------------


def test_update_into_done_column_stamps_completed_at(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    task_service.create(make_task(owner["_id"], project_id, todo["_id"]), owner["_id"])
    task = only_task(store, project_id)
    assert task["completedAt"] is None

    # Move the task into the done column via a single-task update.
    assert (
        task_service.update(
            {
                "_id": str(task["_id"]),
                "projectId": project_id,
                "columnId": done["_id"],
                "coordinatorId": owner["_id"],
                "taskName": task["taskName"],
                "type": "Task",
                "storyPoints": 1,
            },
            owner["_id"],
        )
        == "Task updated"
    )

    assert stored_task(store, str(task["_id"]))["completedAt"] is not None


def test_update_out_of_done_column_clears_completed_at(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    # Born completed in the done column...
    task_service.create(make_task(owner["_id"], project_id, done["_id"]), owner["_id"])
    task = only_task(store, project_id)
    assert task["completedAt"] is not None

    # ...then dragged back to "To Do" (non-done) -> stamp cleared.
    assert (
        task_service.update(
            {
                "_id": str(task["_id"]),
                "projectId": project_id,
                "columnId": todo["_id"],
                "coordinatorId": owner["_id"],
                "taskName": task["taskName"],
                "type": "Task",
                "storyPoints": 1,
            },
            owner["_id"],
        )
        == "Task updated"
    )

    assert stored_task(store, str(task["_id"]))["completedAt"] is None


def test_update_within_done_column_preserves_existing_stamp(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    task_service.create(make_task(owner["_id"], project_id, done["_id"]), owner["_id"])
    task = only_task(store, project_id)
    original_stamp = task["completedAt"]
    assert original_stamp is not None

    # Edit a non-column field (rename) while the task stays in the done
    # column: the stamp records WHEN it completed, so it must NOT be
    # re-stamped just because the row was touched.
    assert (
        task_service.update(
            {
                "_id": str(task["_id"]),
                "projectId": project_id,
                "columnId": done["_id"],
                "coordinatorId": owner["_id"],
                "taskName": "Renamed but still done",
                "type": "Task",
                "storyPoints": 1,
            },
            owner["_id"],
        )
        == "Task updated"
    )

    refreshed = stored_task(store, str(task["_id"]))
    assert refreshed["taskName"] == "Renamed but still done"
    assert refreshed["completedAt"] == original_stamp


def test_update_client_supplied_completed_at_is_ignored(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    task_service.create(make_task(owner["_id"], project_id, todo["_id"]), owner["_id"])
    task = only_task(store, project_id)
    assert task["completedAt"] is None

    # ``completedAt`` is not in ``_TASK_UPDATE_FIELDS`` and the server sets it
    # AFTER the allowlist filter, so a client-sent value while in a non-done
    # column is dropped: the field stays ``None``.
    assert (
        task_service.update(
            {
                "_id": str(task["_id"]),
                "projectId": project_id,
                "columnId": todo["_id"],
                "coordinatorId": owner["_id"],
                "taskName": task["taskName"],
                "type": "Task",
                "storyPoints": 1,
                "completedAt": "2026-01-01T00:00:00+00:00",
            },
            owner["_id"],
        )
        == "Task updated"
    )

    assert stored_task(store, str(task["_id"]))["completedAt"] is None


# ---------------------------------------------------------------------------
# reorder: reconcile the moved task against its DESTINATION column
# ---------------------------------------------------------------------------


def test_reorder_into_done_column_stamps_completed_at(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    task_service.create(make_task(owner["_id"], project_id, todo["_id"]), owner["_id"])
    task = only_task(store, project_id)
    assert task["completedAt"] is None

    # Drag the task across columns into the (empty) done column. With no
    # reference task it lands at the tail of the done column and its
    # ``columnId`` is rewritten -> the destination resolves to done.
    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": str(task["_id"]),
                "referenceId": None,
                "fromColumnId": todo["_id"],
                "referenceColumnId": done["_id"],
            },
            owner["_id"],
        )
        == "Task reordered"
    )

    moved = stored_task(store, str(task["_id"]))
    assert moved["columnId"] == done["_id"]
    assert moved["completedAt"] is not None


def test_reorder_out_of_done_column_clears_completed_at(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    # Born completed in the done column...
    task_service.create(make_task(owner["_id"], project_id, done["_id"]), owner["_id"])
    task = only_task(store, project_id)
    assert task["completedAt"] is not None

    # ...then dragged out into "To Do" via reorder -> stamp cleared once the
    # destination (resolved from the moved task's rewritten columnId) is
    # non-done.
    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": str(task["_id"]),
                "referenceId": None,
                "fromColumnId": done["_id"],
                "referenceColumnId": todo["_id"],
            },
            owner["_id"],
        )
        == "Task reordered"
    )

    moved = stored_task(store, str(task["_id"]))
    assert moved["columnId"] == todo["_id"]
    assert moved["completedAt"] is None
