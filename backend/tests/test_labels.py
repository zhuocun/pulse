"""Project label CRUD + RBAC tests.

These drive the label endpoints end-to-end through the real HTTP layer
(register/login/projects/tasks/labels) against the in-memory
``FakeStore`` from ``conftest.py``. They lock in the access matrix
(viewers read, editors/owners write) and the label-delete -> task-strip
cascade that keeps ``task.labelIds`` free of dangling references.
"""

from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from app.database import TASKS
from app.services import label_service
from tests.conftest import FakeStore


# ``label_service`` imports ``repository`` at module top-level, the same
# way the other services do, but it is not in ``conftest.SERVICE_MODULES``
# (which we must not edit). Without this patch its ``repository`` name
# would still point at the real Mongo singleton and every call would try
# to reach a live cluster. Re-bind it to the per-test ``FakeStore`` the
# rest of the app already uses so labels share one consistent store.
@pytest.fixture(autouse=True)
def _patch_label_repository(store: FakeStore, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(label_service, "repository", store)


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
    """Register + log a user in, returning the body plus a bearer token.

    Mirrors ``tests/test_rbac.py``: the JWT rides an HttpOnly cookie that
    every login overwrites on the shared client, so we pull it out and
    pass it explicitly via ``Authorization`` to keep requests
    attributable to a specific user.
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


def create_project(client: TestClient, token: str) -> str:
    response = client.post(
        "/api/v1/projects/",
        json={"projectName": "Pulse", "organization": "OpenAI"},
        headers=auth_headers(token),
    )
    assert response.status_code == 201, response.text
    projects = client.get("/api/v1/projects/", headers=auth_headers(token)).json()
    return projects[0]["_id"]


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


def first_column(client: TestClient, token: str, project_id: str) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == "To Do")


def create_label(
    client: TestClient,
    token: str,
    project_id: str,
    name: str = "bug",
    color: str | None = None,
) -> Any:
    body: Dict[str, Any] = {"projectId": project_id, "name": name}
    if color is not None:
        body["color"] = color
    return client.post("/api/v1/labels/", json=body, headers=auth_headers(token))


# ---------------------------------------------------------------------------
# Owner: full CRUD
# ---------------------------------------------------------------------------


def test_owner_can_create_list_update_delete_label(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    headers = auth_headers(owner["jwt"])

    # Create (default colour applied when omitted).
    created = create_label(client, owner["jwt"], project_id, name="bug")
    assert created.status_code == 201
    assert created.json() == "Label created"

    # List returns exactly the one label with the default swatch.
    listing = client.get(f"/api/v1/labels/?projectId={project_id}", headers=headers)
    assert listing.status_code == 200
    labels = listing.json()
    assert len(labels) == 1
    label = labels[0]
    assert label["name"] == "bug"
    assert label["projectId"] == project_id
    assert label["color"] == label_service.DEFAULT_COLOR

    # Update name + colour through the allowlisted fields.
    updated = client.put(
        "/api/v1/labels/",
        json={"_id": label["_id"], "name": "defect", "color": "#ff0000"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json() == "Label updated"

    relisted = client.get(
        f"/api/v1/labels/?projectId={project_id}", headers=headers
    ).json()
    assert relisted[0]["name"] == "defect"
    assert relisted[0]["color"] == "#ff0000"

    # Delete.
    deleted = client.delete(f"/api/v1/labels/?labelId={label['_id']}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == "Label deleted"

    empty = client.get(
        f"/api/v1/labels/?projectId={project_id}", headers=headers
    ).json()
    assert empty == []


def test_create_label_with_explicit_color(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = create_label(
        client, owner["jwt"], project_id, name="urgent", color="#00ff00"
    )
    assert created.status_code == 201

    labels = client.get(
        f"/api/v1/labels/?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()
    assert labels[0]["color"] == "#00ff00"


# ---------------------------------------------------------------------------
# Editor: read + write
# ---------------------------------------------------------------------------


def test_editor_can_create_update_delete_label(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    editor = register_and_login(client, "editor", "editor@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, editor["_id"], "editor")
    headers = auth_headers(editor["jwt"])

    created = create_label(client, editor["jwt"], project_id, name="chore")
    assert created.status_code == 201
    assert created.json() == "Label created"

    label = client.get(
        f"/api/v1/labels/?projectId={project_id}", headers=headers
    ).json()[0]

    updated = client.put(
        "/api/v1/labels/",
        json={"_id": label["_id"], "name": "task"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json() == "Label updated"

    deleted = client.delete(f"/api/v1/labels/?labelId={label['_id']}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == "Label deleted"


# ---------------------------------------------------------------------------
# Viewer: read-only
# ---------------------------------------------------------------------------


def test_viewer_can_read_but_not_write_labels(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    viewer = register_and_login(client, "viewer", "viewer@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, viewer["_id"], "viewer")

    # Owner seeds a label the viewer will be able to see.
    create_label(client, owner["jwt"], project_id, name="bug")
    label = client.get(
        f"/api/v1/labels/?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()[0]

    headers = auth_headers(viewer["jwt"])

    # Reads succeed.
    listing = client.get(f"/api/v1/labels/?projectId={project_id}", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 1

    # Writes are forbidden (create / update / delete).
    assert create_label(client, viewer["jwt"], project_id).status_code == 403
    assert (
        client.put(
            "/api/v1/labels/",
            json={"_id": label["_id"], "name": "nope"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/labels/?labelId={label['_id']}", headers=headers
        ).status_code
        == 403
    )


# ---------------------------------------------------------------------------
# Non-member: locked out everywhere
# ---------------------------------------------------------------------------


def test_non_member_is_forbidden_on_all_label_ops(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])

    create_label(client, owner["jwt"], project_id, name="bug")
    label = client.get(
        f"/api/v1/labels/?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()[0]

    headers = auth_headers(outsider["jwt"])

    assert (
        client.get(
            f"/api/v1/labels/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert create_label(client, outsider["jwt"], project_id).status_code == 403
    assert (
        client.put(
            "/api/v1/labels/",
            json={"_id": label["_id"], "name": "nope"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/labels/?labelId={label['_id']}", headers=headers
        ).status_code
        == 403
    )


# ---------------------------------------------------------------------------
# Validation / not-found mapping
# ---------------------------------------------------------------------------


def test_create_label_empty_name_is_400(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    response = client.post(
        "/api/v1/labels/",
        json={"projectId": project_id, "name": ""},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400


def test_create_label_missing_project_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")

    response = client.post(
        "/api/v1/labels/",
        json={"projectId": "ffffffffffffffffffffffff", "name": "bug"},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404


def test_get_labels_missing_project_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")

    response = client.get(
        "/api/v1/labels/?projectId=ffffffffffffffffffffffff",
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404


def test_update_missing_label_is_404(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    response = client.put(
        "/api/v1/labels/",
        json={"_id": "ffffffffffffffffffffffff", "name": "bug"},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404


def test_delete_missing_label_is_404(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    response = client.delete(
        "/api/v1/labels/?labelId=ffffffffffffffffffffffff",
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Cascade: deleting a label strips its id from tasks' labelIds
# ---------------------------------------------------------------------------


def test_delete_label_strips_id_from_task_label_ids(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    headers = auth_headers(owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    # Two labels so we can prove only the deleted one is stripped.
    assert create_label(client, owner["jwt"], project_id, name="bug").status_code == 201
    assert (
        create_label(client, owner["jwt"], project_id, name="keep").status_code == 201
    )
    labels = client.get(
        f"/api/v1/labels/?projectId={project_id}", headers=headers
    ).json()
    bug = next(label for label in labels if label["name"] == "bug")
    keep = next(label for label in labels if label["name"] == "keep")

    # Create a task carrying both labels (posted via the real tasks API).
    task_create = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": project_id,
            "columnId": column["_id"],
            "coordinatorId": owner["_id"],
            "taskName": "A task",
            "type": "Task",
            "storyPoints": 1,
            "labelIds": [bug["_id"], keep["_id"]],
        },
        headers=headers,
    )
    assert task_create.status_code == 201, task_create.text

    task = client.get(f"/api/v1/tasks/?projectId={project_id}", headers=headers).json()[
        0
    ]
    assert set(task["labelIds"]) == {bug["_id"], keep["_id"]}

    # Delete the "bug" label.
    deleted = client.delete(f"/api/v1/labels/?labelId={bug['_id']}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == "Label deleted"

    # The task no longer lists the deleted label, but still keeps the other.
    task_after = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=headers
    ).json()[0]
    assert bug["_id"] not in task_after["labelIds"]
    assert task_after["labelIds"] == [keep["_id"]]

    # And the underlying store row matches (defends against a serialize-only
    # illusion where the persisted document still carried the dead id).
    stored = store.find_by_id(TASKS, task["_id"])
    assert stored is not None
    assert stored["labelIds"] == [keep["_id"]]
