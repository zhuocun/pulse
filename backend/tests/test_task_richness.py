"""Task richness tests: scheduling/label/assignee metadata, sub-task
parenting (with orphan-on-delete), and the fan-out bulk metadata edit.

These drive the real HTTP endpoints against the in-memory ``FakeStore``
from ``conftest.py`` and reuse the register/login/auth-header pattern
from ``tests/test_rbac.py``. ``FakeStore`` only does exact-match queries,
so the service relies on flat filters (e.g. ``{"parentTaskId": id}``);
the orphan-on-delete test exercises exactly that path.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import TASKS
from tests.conftest import FakeStore


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
    """Register + login a user; return the login body plus a bearer token.

    Each login overwrites the shared ``TestClient`` cookie jar, so we pull
    the ``Token`` cookie out and callers pass it via ``Authorization:
    Bearer`` to keep requests attributable to a specific user.
    """

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


def create_project(
    client: TestClient,
    token: str,
    name: str = "Pulse",
) -> str:
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


def create_task(
    client: TestClient,
    token: str,
    project_id: str,
    column_id: str,
    coordinator_id: str,
    **extra: Any,
) -> Any:
    body = {
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "taskName": "A task",
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return client.post("/api/v1/tasks/", json=body, headers=auth_headers(token))


def get_tasks(client: TestClient, token: str, project_id: str) -> Any:
    return client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=auth_headers(token)
    ).json()


# ---------------------------------------------------------------------------
# Create + update carry the new richness fields
# ---------------------------------------------------------------------------


def test_create_and_update_carry_richness_fields(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    created = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        startDate="2026-06-01",
        dueDate="2026-06-30",
        labelIds=["label-a", "label-b"],
        assigneeIds=[owner["_id"]],
    )
    assert created.status_code == 201, created.text

    task = get_tasks(client, owner["jwt"], project_id)[0]
    assert task["startDate"] == "2026-06-01"
    assert task["dueDate"] == "2026-06-30"
    assert task["labelIds"] == ["label-a", "label-b"]
    assert task["assigneeIds"] == [owner["_id"]]
    # ``parentTaskId`` defaults to a top-level (null) value.
    assert task.get("parentTaskId") in (None, "")

    update = client.put(
        "/api/v1/tasks/",
        json={
            "_id": task["_id"],
            "projectId": project_id,
            "columnId": column["_id"],
            "coordinatorId": owner["_id"],
            "taskName": task["taskName"],
            "type": "Task",
            "storyPoints": 1,
            "startDate": "2026-07-01",
            "dueDate": "2026-07-15",
            "labelIds": ["label-c"],
            "assigneeIds": [],
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert update.status_code == 200, update.text

    refreshed = get_tasks(client, owner["jwt"], project_id)[0]
    assert refreshed["startDate"] == "2026-07-01"
    assert refreshed["dueDate"] == "2026-07-15"
    assert refreshed["labelIds"] == ["label-c"]
    assert refreshed["assigneeIds"] == []


def test_non_string_date_and_non_list_labels_rejected(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    bad_date = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        dueDate=12345,
    )
    assert bad_date.status_code == 400, bad_date.text

    bad_labels = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        labelIds="not-a-list",
    )
    assert bad_labels.status_code == 400, bad_labels.text


# ---------------------------------------------------------------------------
# Sub-task parenting
# ---------------------------------------------------------------------------


def test_valid_same_project_parent_accepted(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    assert (
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"]
        ).status_code
        == 201
    )
    parent = get_tasks(client, owner["jwt"], project_id)[0]

    child = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        taskName="Child",
        parentTaskId=parent["_id"],
    )
    assert child.status_code == 201, child.text

    child_doc = next(
        task
        for task in get_tasks(client, owner["jwt"], project_id)
        if task["taskName"] == "Child"
    )
    assert child_doc["parentTaskId"] == parent["_id"]


def test_self_parent_rejected_on_update(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": task["_id"],
            "projectId": project_id,
            "columnId": column["_id"],
            "coordinatorId": owner["_id"],
            "taskName": task["taskName"],
            "type": "Task",
            "storyPoints": 1,
            "parentTaskId": task["_id"],
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text


def test_nonexistent_parent_rejected(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    response = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        parentTaskId="ffffffffffffffffffffffff",
    )
    assert response.status_code == 400, response.text


def test_cross_project_parent_rejected(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_a = create_project(client, owner["jwt"], name="A")
    project_b = create_project(client, owner["jwt"], name="B")
    column_a = first_column(client, owner["jwt"], project_a)
    column_b = first_column(client, owner["jwt"], project_b)

    create_task(client, owner["jwt"], project_a, column_a["_id"], owner["_id"])
    parent_in_a = get_tasks(client, owner["jwt"], project_a)[0]

    # A task in project B cannot point its parent at a task in project A.
    response = create_task(
        client,
        owner["jwt"],
        project_b,
        column_b["_id"],
        owner["_id"],
        taskName="Cross",
        parentTaskId=parent_in_a["_id"],
    )
    assert response.status_code == 400, response.text


def test_deleting_parent_orphans_children_without_deleting_them(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(
        client, owner["jwt"], project_id, column["_id"], owner["_id"]
    )
    parent = get_tasks(client, owner["jwt"], project_id)[0]

    for name in ("Child 1", "Child 2"):
        created = create_task(
            client,
            owner["jwt"],
            project_id,
            column["_id"],
            owner["_id"],
            taskName=name,
            parentTaskId=parent["_id"],
        )
        assert created.status_code == 201, created.text

    delete = client.delete(
        f"/api/v1/tasks/?taskId={parent['_id']}", headers=auth_headers(owner["jwt"])
    )
    assert delete.status_code == 200, delete.text
    assert delete.json() == "Task deleted"

    remaining = get_tasks(client, owner["jwt"], project_id)
    names = {task["taskName"] for task in remaining}
    # Children survive the parent deletion (no cascade)...
    assert {"Child 1", "Child 2"}.issubset(names)
    assert "A task" not in names
    # ...and are re-parented to top-level (None / "").
    for task in remaining:
        if task["taskName"] in ("Child 1", "Child 2"):
            assert task.get("parentTaskId") in (None, "")

    # Confirm at the store layer too: the children rows still exist and
    # were not cascade-deleted.
    surviving = [
        doc
        for doc in store.find_many(TASKS, {"projectId": project_id})
        if doc["taskName"] in ("Child 1", "Child 2")
    ]
    assert len(surviving) == 2
    for doc in surviving:
        assert doc.get("parentTaskId") in (None, "")


# ---------------------------------------------------------------------------
# Bulk metadata edit
# ---------------------------------------------------------------------------


def test_bulk_update_applies_metadata_across_tasks(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    teammate = register_and_login(client, "teammate", "teammate@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, teammate["_id"], "editor")
    column = first_column(client, owner["jwt"], project_id)

    for name in ("T1", "T2", "T3"):
        create_task(
            client,
            owner["jwt"],
            project_id,
            column["_id"],
            owner["_id"],
            taskName=name,
        )
    tasks = get_tasks(client, owner["jwt"], project_id)
    target_ids = [task["_id"] for task in tasks if task["taskName"] in ("T1", "T2")]
    assert len(target_ids) == 2

    response = client.put(
        "/api/v1/tasks/bulk",
        json={
            "taskIds": target_ids,
            "changes": {
                "coordinatorId": teammate["_id"],
                "dueDate": "2026-08-01",
                "labelIds": ["sprint-7"],
            },
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    assert response.json() == "Tasks updated"

    refreshed = {
        task["_id"]: task
        for task in get_tasks(client, owner["jwt"], project_id)
    }
    for task_id in target_ids:
        assert refreshed[task_id]["coordinatorId"] == teammate["_id"]
        assert refreshed[task_id]["dueDate"] == "2026-08-01"
        assert refreshed[task_id]["labelIds"] == ["sprint-7"]

    # The untouched task (T3) keeps its original coordinator.
    untouched = next(
        task for task in refreshed.values() if task["taskName"] == "T3"
    )
    assert untouched["coordinatorId"] == owner["_id"]


def test_bulk_update_ignores_columnid_and_projectid(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    other_project = create_project(client, owner["jwt"], name="Other")
    project_id = create_project(client, owner["jwt"], name="Main")
    column = first_column(client, owner["jwt"], project_id)
    other_column = first_column(client, owner["jwt"], other_project)

    create_task(
        client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Pin"
    )
    task = next(
        item
        for item in get_tasks(client, owner["jwt"], project_id)
        if item["taskName"] == "Pin"
    )

    response = client.put(
        "/api/v1/tasks/bulk",
        json={
            "taskIds": [task["_id"]],
            "changes": {
                # Positional/routing fields must be filtered out, but a
                # legitimate metadata field in the same patch still lands.
                "columnId": other_column["_id"],
                "projectId": other_project,
                "dueDate": "2026-09-09",
            },
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text

    refreshed = next(
        item
        for item in get_tasks(client, owner["jwt"], project_id)
        if item["_id"] == task["_id"]
    )
    # The column/project were NOT moved by the bulk edit...
    assert refreshed["columnId"] == column["_id"]
    assert refreshed["projectId"] == project_id
    # ...but the allowed metadata field was applied.
    assert refreshed["dueDate"] == "2026-09-09"


def test_bulk_update_with_only_disallowed_changes_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    # ``changes`` with nothing but routing fields filters down to empty.
    response = client.put(
        "/api/v1/tasks/bulk",
        json={"taskIds": [task["_id"]], "changes": {"columnId": column["_id"]}},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text


def test_bulk_update_viewer_is_forbidden(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    viewer = register_and_login(client, "viewer", "viewer@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, viewer["_id"], "viewer")
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = client.put(
        "/api/v1/tasks/bulk",
        json={"taskIds": [task["_id"]], "changes": {"dueDate": "2026-10-10"}},
        headers=auth_headers(viewer["jwt"]),
    )
    assert response.status_code == 403, response.text


def test_bulk_update_non_member_is_forbidden(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = client.put(
        "/api/v1/tasks/bulk",
        json={"taskIds": [task["_id"]], "changes": {"dueDate": "2026-10-10"}},
        headers=auth_headers(outsider["jwt"]),
    )
    assert response.status_code == 403, response.text


def test_bulk_update_unknown_task_id_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    # One real id mixed with a non-existent one fails the whole batch (404)
    # before any write lands.
    response = client.put(
        "/api/v1/tasks/bulk",
        json={
            "taskIds": [task["_id"], "ffffffffffffffffffffffff"],
            "changes": {"dueDate": "2026-11-11"},
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404, response.text

    # The real task was untouched (no partial apply).
    refreshed = get_tasks(client, owner["jwt"], project_id)[0]
    assert refreshed.get("dueDate") in (None, "")


def test_bulk_update_empty_task_ids_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    response = client.put(
        "/api/v1/tasks/bulk",
        json={"taskIds": [], "changes": {"dueDate": "2026-12-12"}},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text
