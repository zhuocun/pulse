"""Task comment CRUD + RBAC + @mention -> notification tests.

These drive the comment endpoints end-to-end through the real HTTP layer
(register/login/projects/boards/tasks/comments) against the in-memory
``FakeStore`` from ``conftest.py``. They lock in the access matrix (any
member -- viewer and up -- may comment and read; only the author may
edit; the author OR the project manager may delete) and the
@mention -> notification producer that the Inbox "Mentions" tab consumes.
"""

from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeStore


# ``comment_service`` and ``notification_service`` import ``repository`` at
# module top-level but are NOT (yet) in ``conftest.SERVICE_MODULES`` (which
# we must not edit), so the ``store`` fixture leaves their ``repository``
# pointing at the real Mongo singleton. ``comment_service`` calls
# ``notification_service``, so BOTH must be rebound to the SAME per-test
# ``FakeStore`` or an @mention would write its notification into a
# different store than the one the assertions read back.
@pytest.fixture(autouse=True)
def _wire_repos(store: FakeStore, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.services.comment_service as cs
    import app.services.notification_service as ns

    monkeypatch.setattr(cs, "repository", store)
    monkeypatch.setattr(ns, "repository", store)


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
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


def create_task(client: TestClient, token: str, project_id: str) -> str:
    column = first_column(client, token, project_id)
    coordinator_id = register_login_owner_id(client, token)
    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": project_id,
            "columnId": column["_id"],
            "coordinatorId": coordinator_id,
            "taskName": "A task",
            "type": "Task",
            "storyPoints": 1,
        },
        headers=auth_headers(token),
    )
    assert response.status_code == 201, response.text
    tasks = client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return tasks[0]["_id"]


def register_login_owner_id(client: TestClient, token: str) -> str:
    """Resolve the calling token's user id via the projects roster.

    ``coordinatorId`` must reference a real user; the simplest portable
    way to learn the caller's own id from a token is to read a project
    they own and take its managerId. Tests pass the owner token here.
    """

    projects = client.get("/api/v1/projects/", headers=auth_headers(token)).json()
    return projects[0]["managerId"]


def post_comment(
    client: TestClient,
    token: str,
    task_id: str,
    body: str = "hello",
    mentions: Any = None,
) -> Any:
    payload: Dict[str, Any] = {"taskId": task_id, "body": body}
    if mentions is not None:
        payload["mentions"] = mentions
    return client.post("/api/v1/comments/", json=payload, headers=auth_headers(token))


def list_comments(client: TestClient, token: str, task_id: str) -> Any:
    return client.get(
        f"/api/v1/comments/?taskId={task_id}", headers=auth_headers(token)
    )


def list_notifications(client: TestClient, token: str) -> Any:
    return client.get("/api/v1/notifications/", headers=auth_headers(token)).json()


# ---------------------------------------------------------------------------
# Member CRUD: create / list / edit own / delete own
# ---------------------------------------------------------------------------


def test_member_can_create_list_edit_delete_own_comment(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    editor = register_and_login(client, "editor", "editor@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, editor["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    created = post_comment(client, editor["jwt"], task_id, body="first")
    assert created.status_code == 201
    assert created.json() == "Comment created"

    listing = list_comments(client, editor["jwt"], task_id)
    assert listing.status_code == 200
    comments = listing.json()
    assert len(comments) == 1
    comment = comments[0]
    assert comment["body"] == "first"
    assert comment["authorId"] == editor["_id"]
    assert comment["taskId"] == task_id
    assert comment["projectId"] == project_id

    updated = client.put(
        "/api/v1/comments/",
        json={"_id": comment["_id"], "body": "edited"},
        headers=auth_headers(editor["jwt"]),
    )
    assert updated.status_code == 200
    assert updated.json() == "Comment updated"

    relisted = list_comments(client, editor["jwt"], task_id).json()
    assert relisted[0]["body"] == "edited"

    deleted = client.delete(
        f"/api/v1/comments/?commentId={comment['_id']}",
        headers=auth_headers(editor["jwt"]),
    )
    assert deleted.status_code == 200
    assert deleted.json() == "Comment deleted"

    assert list_comments(client, editor["jwt"], task_id).json() == []


def test_viewer_member_can_comment_and_read(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    viewer = register_and_login(client, "viewer", "viewer@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, viewer["_id"], "viewer")
    task_id = create_task(client, owner["jwt"], project_id)

    # A viewer is a participant: they CAN comment and read.
    created = post_comment(client, viewer["jwt"], task_id, body="viewer here")
    assert created.status_code == 201

    listing = list_comments(client, viewer["jwt"], task_id)
    assert listing.status_code == 200
    assert len(listing.json()) == 1


# ---------------------------------------------------------------------------
# Non-member: locked out of create + list
# ---------------------------------------------------------------------------


def test_non_member_forbidden_on_create_and_list(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])
    task_id = create_task(client, owner["jwt"], project_id)

    assert post_comment(client, outsider["jwt"], task_id).status_code == 403
    assert list_comments(client, outsider["jwt"], task_id).status_code == 403


# ---------------------------------------------------------------------------
# Validation / not-found mapping
# ---------------------------------------------------------------------------


def test_create_comment_empty_body_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    task_id = create_task(client, owner["jwt"], project_id)

    response = post_comment(client, owner["jwt"], task_id, body="")
    assert response.status_code == 400


def test_create_comment_missing_task_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    response = post_comment(
        client, owner["jwt"], "ffffffffffffffffffffffff", body="orphan"
    )
    assert response.status_code == 404


def test_list_comments_missing_task_is_404(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    response = list_comments(client, owner["jwt"], "ffffffffffffffffffffffff")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Author-only edit
# ---------------------------------------------------------------------------


def test_only_author_can_edit_comment(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    other = register_and_login(client, "other", "other@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, other["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    # Owner authors the comment.
    assert post_comment(client, owner["jwt"], task_id, body="mine").status_code == 201
    comment = list_comments(client, owner["jwt"], task_id).json()[0]

    # Another member -- even an editor -- cannot edit someone else's comment.
    forbidden = client.put(
        "/api/v1/comments/",
        json={"_id": comment["_id"], "body": "hijacked"},
        headers=auth_headers(other["jwt"]),
    )
    assert forbidden.status_code == 403

    # The body is unchanged.
    assert list_comments(client, owner["jwt"], task_id).json()[0]["body"] == "mine"


# ---------------------------------------------------------------------------
# Delete: author OR project manager; ordinary member forbidden
# ---------------------------------------------------------------------------


def test_delete_allowed_for_author(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, member["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    assert post_comment(client, member["jwt"], task_id, body="mine").status_code == 201
    comment = list_comments(client, member["jwt"], task_id).json()[0]

    deleted = client.delete(
        f"/api/v1/comments/?commentId={comment['_id']}",
        headers=auth_headers(member["jwt"]),
    )
    assert deleted.status_code == 200
    assert deleted.json() == "Comment deleted"


def test_delete_allowed_for_project_manager(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, member["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    # Member authors; the project manager (owner) moderates/deletes it.
    authored = post_comment(client, member["jwt"], task_id, body="mod me")
    assert authored.status_code == 201
    comment = list_comments(client, owner["jwt"], task_id).json()[0]

    deleted = client.delete(
        f"/api/v1/comments/?commentId={comment['_id']}",
        headers=auth_headers(owner["jwt"]),
    )
    assert deleted.status_code == 200
    assert deleted.json() == "Comment deleted"


def test_delete_forbidden_for_random_member(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    author = register_and_login(client, "author", "author@example.com")
    bystander = register_and_login(client, "bystander", "bystander@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, author["_id"], "editor")
    add_member(client, owner["jwt"], project_id, bystander["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    assert post_comment(client, author["jwt"], task_id, body="mine").status_code == 201
    comment = list_comments(client, author["jwt"], task_id).json()[0]

    # A non-author, non-manager member cannot delete the comment.
    forbidden = client.delete(
        f"/api/v1/comments/?commentId={comment['_id']}",
        headers=auth_headers(bystander["jwt"]),
    )
    assert forbidden.status_code == 403

    # The comment survives.
    assert len(list_comments(client, author["jwt"], task_id).json()) == 1


# ---------------------------------------------------------------------------
# @mention -> notification producer
# ---------------------------------------------------------------------------


def test_mention_notifies_member_but_not_others(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, member["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id)

    # The author (owner) mentions: a member, a non-member, the author
    # themselves, and a nonexistent user id. Only the member should be
    # notified; the other three are skipped silently.
    created = post_comment(
        client,
        owner["jwt"],
        task_id,
        body="hey @member",
        mentions=[
            member["_id"],
            outsider["_id"],
            owner["_id"],
            "ffffffffffffffffffffffff",
        ],
    )
    assert created.status_code == 201

    # The mentioned MEMBER got exactly one mention notification.
    member_inbox = list_notifications(client, member["jwt"])
    assert len(member_inbox) == 1
    note = member_inbox[0]
    assert note["kind"] == "mention"
    assert note["refId"] == task_id
    assert note["projectId"] == project_id
    assert note["isRead"] is False
    assert note["userId"] == member["_id"]

    # The non-member, the author, and the nonexistent user are NOT notified.
    assert list_notifications(client, outsider["jwt"]) == []
    assert list_notifications(client, owner["jwt"]) == []
