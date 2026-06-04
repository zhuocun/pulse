"""Project membership + role-based access control (RBAC) tests.

These exercise the membership model end-to-end through the real HTTP
endpoints (register/login/projects/boards/tasks/members) against the
in-memory ``FakeStore`` from ``conftest.py``. They lock in the access
matrix: viewers read, editors write, owners administer membership, and
the manager (project root of trust) can never be demoted or removed.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import PROJECTS
from tests.conftest import FakeStore


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
    """Register a user and return the login body plus a bearer token.

    The REST JWT rides an HttpOnly ``Token`` cookie; because every login
    on the shared ``TestClient`` overwrites that cookie jar, each helper
    pulls the cookie value out and callers pass it explicitly via
    ``Authorization: Bearer`` so requests stay attributable to a
    specific user regardless of who logged in last.
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
    # Listing returns only projects the caller can see; the creator is an
    # owner-member so exactly this project comes back.
    projects = client.get("/api/v1/projects/", headers=auth_headers(token)).json()
    return projects[0]["_id"]


def first_column(client: TestClient, token: str, project_id: str) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == "To Do")


def create_task(
    client: TestClient,
    token: str,
    project_id: str,
    column_id: str,
    coordinator_id: str,
) -> Any:
    return client.post(
        "/api/v1/tasks/",
        json={
            "projectId": project_id,
            "columnId": column_id,
            "coordinatorId": coordinator_id,
            "taskName": "A task",
            "type": "Task",
            "storyPoints": 1,
        },
        headers=auth_headers(token),
    )


# ---------------------------------------------------------------------------
# Owner bootstrap
# ---------------------------------------------------------------------------


def test_owner_is_auto_added_as_member_on_create(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    assert project.get("memberIds") == [{"userId": owner["_id"], "role": "owner"}]

    # The owner shows up in the roster with the right role.
    members = client.get(
        f"/api/v1/projects/members?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    )
    assert members.status_code == 200
    roster = members.json()
    assert roster == [
        {
            "_id": owner["_id"],
            "username": "owner",
            "email": "owner@example.com",
            "role": "owner",
        }
    ]


# ---------------------------------------------------------------------------
# Viewer: read-only
# ---------------------------------------------------------------------------


def test_viewer_can_read_but_not_write(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    viewer = register_and_login(client, "viewer", "viewer@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": viewer["_id"], "role": "viewer"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201
    assert add.json() == "Member added"

    headers = auth_headers(viewer["jwt"])

    # Reads succeed for a viewer.
    assert (
        client.get(
            f"/api/v1/projects/?projectId={project_id}", headers=headers
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"/api/v1/boards/?projectId={project_id}", headers=headers
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"/api/v1/tasks/?projectId={project_id}", headers=headers
        ).status_code
        == 200
    )

    # Writes are forbidden for a viewer (tasks + columns).
    task_create = create_task(
        client, viewer["jwt"], project_id, column["_id"], viewer["_id"]
    )
    assert task_create.status_code == 403

    column_create = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id},
        headers=headers,
    )
    assert column_create.status_code == 403

    # And a viewer cannot administer membership.
    bob = register_and_login(client, "bob", "bob@example.com")
    forbidden_add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": bob["_id"], "role": "viewer"},
        headers=headers,
    )
    assert forbidden_add.status_code == 403


# ---------------------------------------------------------------------------
# Editor: read + write, but no administration
# ---------------------------------------------------------------------------


def test_editor_can_create_update_delete_tasks_and_columns(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    editor = register_and_login(client, "editor", "editor@example.com")
    project_id = create_project(client, owner["jwt"])

    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": editor["_id"], "role": "editor"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201

    headers = auth_headers(editor["jwt"])
    column = first_column(client, editor["jwt"], project_id)

    # Editor creates a column.
    column_create = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id},
        headers=headers,
    )
    assert column_create.status_code == 201
    assert column_create.json() == "Column created"

    # Editor creates a task.
    task_create = create_task(
        client, editor["jwt"], project_id, column["_id"], editor["_id"]
    )
    assert task_create.status_code == 201
    assert task_create.json() == "Task created"

    task = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=headers
    ).json()[0]

    # Editor updates the task.
    task_update = client.put(
        "/api/v1/tasks/",
        json={
            "_id": task["_id"],
            "projectId": project_id,
            "columnId": column["_id"],
            "coordinatorId": editor["_id"],
            "taskName": "Renamed",
            "type": "Task",
            "storyPoints": 2,
        },
        headers=headers,
    )
    assert task_update.status_code == 200
    assert task_update.json() == "Task updated"

    # Editor deletes the task.
    task_delete = client.delete(
        f"/api/v1/tasks/?taskId={task['_id']}", headers=headers
    )
    assert task_delete.status_code == 200
    assert task_delete.json() == "Task deleted"

    # Editor deletes the column they created.
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=headers
    ).json()
    review = next(column for column in columns if column["columnName"] == "Review")
    column_delete = client.delete(
        f"/api/v1/boards/?columnId={review['_id']}", headers=headers
    )
    assert column_delete.status_code == 200
    assert column_delete.json() == "Column deleted"

    # But an editor still cannot administer membership.
    bob = register_and_login(client, "bob", "bob@example.com")
    forbidden_add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": bob["_id"], "role": "viewer"},
        headers=headers,
    )
    assert forbidden_add.status_code == 403


# ---------------------------------------------------------------------------
# Non-member: locked out everywhere
# ---------------------------------------------------------------------------


def test_non_member_is_forbidden_everywhere(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    headers = auth_headers(outsider["jwt"])

    # Reads are forbidden.
    assert (
        client.get(
            f"/api/v1/projects/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/boards/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/tasks/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/projects/members?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )

    # Writes are forbidden.
    assert (
        create_task(
            client, outsider["jwt"], project_id, column["_id"], outsider["_id"]
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/boards/",
            json={"columnName": "Review", "projectId": project_id},
            headers=headers,
        ).status_code
        == 403
    )

    # The outsider's own (empty) listing does not leak the project.
    listing = client.get("/api/v1/projects/", headers=headers)
    assert listing.status_code == 200
    assert listing.json() == []


# ---------------------------------------------------------------------------
# Listing includes member projects, not just managed ones
# ---------------------------------------------------------------------------


def test_listing_includes_projects_user_is_member_of(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")

    owned_by_member = create_project(client, member["jwt"])
    shared = create_project(client, owner["jwt"])

    client.post(
        "/api/v1/projects/members",
        json={"projectId": shared, "userId": member["_id"], "role": "viewer"},
        headers=auth_headers(owner["jwt"]),
    )

    listing = client.get("/api/v1/projects/", headers=auth_headers(member["jwt"]))
    assert listing.status_code == 200
    listed_ids = {project["_id"] for project in listing.json()}
    # Both the project the member manages AND the one they were added to.
    assert listed_ids == {owned_by_member, shared}


# ---------------------------------------------------------------------------
# Administration: owner-only, manager protected
# ---------------------------------------------------------------------------


def test_only_owner_can_manage_members(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    editor = register_and_login(client, "editor", "editor@example.com")
    target = register_and_login(client, "target", "target@example.com")
    project_id = create_project(client, owner["jwt"])

    # Seed an editor; an editor must not be able to manage members.
    client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": editor["_id"], "role": "editor"},
        headers=auth_headers(owner["jwt"]),
    )

    editor_headers = auth_headers(editor["jwt"])
    assert (
        client.post(
            "/api/v1/projects/members",
            json={
                "projectId": project_id,
                "userId": target["_id"],
                "role": "viewer",
            },
            headers=editor_headers,
        ).status_code
        == 403
    )

    # Owner adds the target.
    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "viewer"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201

    # Editor cannot change a role.
    assert (
        client.put(
            "/api/v1/projects/members",
            json={
                "projectId": project_id,
                "userId": target["_id"],
                "role": "editor",
            },
            headers=editor_headers,
        ).status_code
        == 403
    )
    # Editor cannot remove a member.
    assert (
        client.delete(
            f"/api/v1/projects/members?projectId={project_id}&userId={target['_id']}",
            headers=editor_headers,
        ).status_code
        == 403
    )

    # Owner can change role and remove.
    promote = client.put(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "editor"},
        headers=auth_headers(owner["jwt"]),
    )
    assert promote.status_code == 200
    assert promote.json() == "Member updated"

    remove = client.delete(
        f"/api/v1/projects/members?projectId={project_id}&userId={target['_id']}",
        headers=auth_headers(owner["jwt"]),
    )
    assert remove.status_code == 200
    assert remove.json() == "Member removed"

    # Target is gone from the roster (only owner + editor remain).
    roster = client.get(
        f"/api/v1/projects/members?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()
    assert {row["_id"] for row in roster} == {owner["_id"], editor["_id"]}


def test_manager_cannot_be_removed_or_demoted(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    headers = auth_headers(owner["jwt"])

    # Demoting the manager is a bad request (it is the root of trust).
    demote = client.put(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": owner["_id"], "role": "viewer"},
        headers=headers,
    )
    assert demote.status_code == 400

    # Removing the manager is a bad request too.
    remove = client.delete(
        f"/api/v1/projects/members?projectId={project_id}&userId={owner['_id']}",
        headers=headers,
    )
    assert remove.status_code == 400

    # Re-adding the manager (idempotent path) is refused so it cannot be
    # silently downgraded.
    readd = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": owner["_id"], "role": "editor"},
        headers=headers,
    )
    assert readd.status_code == 400

    # The manager is still an owner.
    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    assert project.get("memberIds") == [{"userId": owner["_id"], "role": "owner"}]


def test_add_member_unknown_user_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    response = client.post(
        "/api/v1/projects/members",
        json={
            "projectId": project_id,
            "userId": "doesnotexist",
            "role": "viewer",
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404
    assert response.json()["error"] == "Member not found"


def test_add_member_invalid_role_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    target = register_and_login(client, "target", "target@example.com")
    project_id = create_project(client, owner["jwt"])

    response = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "admin"},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400


def test_add_member_is_idempotent_and_updates_role(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    target = register_and_login(client, "target", "target@example.com")
    project_id = create_project(client, owner["jwt"])
    headers = auth_headers(owner["jwt"])

    first = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "viewer"},
        headers=headers,
    )
    assert first.status_code == 201

    # Re-adding the same user just updates the role rather than
    # duplicating the entry.
    second = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "editor"},
        headers=headers,
    )
    assert second.status_code == 201
    assert second.json() == "Member added"

    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    target_entries = [
        entry
        for entry in project.get("memberIds") or []
        if entry["userId"] == target["_id"]
    ]
    assert target_entries == [{"userId": target["_id"], "role": "editor"}]

    # The promotion takes effect: the target can now write.
    column = first_column(client, owner["jwt"], project_id)
    task_create = create_task(
        client, target["jwt"], project_id, column["_id"], target["_id"]
    )
    assert task_create.status_code == 201


def test_members_on_missing_project_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    headers = auth_headers(owner["jwt"])

    listing = client.get(
        "/api/v1/projects/members?projectId=ffffffffffffffffffffffff",
        headers=headers,
    )
    assert listing.status_code == 404

    add = client.post(
        "/api/v1/projects/members",
        json={
            "projectId": "ffffffffffffffffffffffff",
            "userId": owner["_id"],
            "role": "viewer",
        },
        headers=headers,
    )
    assert add.status_code == 404
