"""Notification read / mark-read + ownership tests.

These drive the notification endpoints end-to-end through the real HTTP
layer against the in-memory ``FakeStore`` from ``conftest.py``.
Notifications have no producer endpoint of their own -- they are a side
effect of an @mention in a task comment -- so the setup posts comments
that mention members and then asserts on ``GET`` / ``PUT
/notifications``. The invariant under test: a notification belongs to its
recipient and only that recipient may read or modify it.
"""

from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from tests.conftest import FakeStore


# See ``test_comments.py``: rebind BOTH services to the shared per-test
# store because neither is in ``conftest.SERVICE_MODULES`` and the
# @mention producer spans both modules.
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


def create_task(
    client: TestClient,
    token: str,
    project_id: str,
    coordinator_id: str,
) -> str:
    column = first_column(client, token, project_id)
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


def mention(
    client: TestClient,
    author_token: str,
    task_id: str,
    mentioned_ids: list,
    body: str = "ping",
) -> None:
    """Produce notifications by posting a comment that @mentions users."""

    response = client.post(
        "/api/v1/comments/",
        json={"taskId": task_id, "body": body, "mentions": mentioned_ids},
        headers=auth_headers(author_token),
    )
    assert response.status_code == 201, response.text


def get_notifications(client: TestClient, token: str) -> Any:
    return client.get("/api/v1/notifications/", headers=auth_headers(token))


# ---------------------------------------------------------------------------
# GET: caller sees only their own notifications
# ---------------------------------------------------------------------------


def test_get_returns_only_callers_notifications(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    alice = register_and_login(client, "alice", "alice@example.com")
    bob = register_and_login(client, "bob", "bob@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, alice["_id"], "editor")
    add_member(client, owner["jwt"], project_id, bob["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id, owner["_id"])

    # Two separate mentions: one for Alice, one for Bob.
    mention(client, owner["jwt"], task_id, [alice["_id"]], body="hi alice")
    mention(client, owner["jwt"], task_id, [bob["_id"]], body="hi bob")

    alice_inbox = get_notifications(client, alice["jwt"])
    assert alice_inbox.status_code == 200
    alice_notes = alice_inbox.json()
    assert len(alice_notes) == 1
    assert alice_notes[0]["userId"] == alice["_id"]

    bob_notes = get_notifications(client, bob["jwt"]).json()
    assert len(bob_notes) == 1
    assert bob_notes[0]["userId"] == bob["_id"]

    # The owner (author) never sees a self-mention notification.
    assert get_notifications(client, owner["jwt"]).json() == []


# ---------------------------------------------------------------------------
# Mark one read
# ---------------------------------------------------------------------------


def test_mark_one_read(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    alice = register_and_login(client, "alice", "alice@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, alice["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id, owner["_id"])

    mention(client, owner["jwt"], task_id, [alice["_id"]])
    note = get_notifications(client, alice["jwt"]).json()[0]
    assert note["isRead"] is False

    marked = client.put(
        "/api/v1/notifications/",
        json={"_id": note["_id"]},
        headers=auth_headers(alice["jwt"]),
    )
    assert marked.status_code == 200
    assert marked.json() == "Notification updated"

    after = get_notifications(client, alice["jwt"]).json()[0]
    assert after["isRead"] is True


def test_mark_missing_notification_is_404(
    client: TestClient, store: FakeStore
) -> None:
    alice = register_and_login(client, "alice", "alice@example.com")

    response = client.put(
        "/api/v1/notifications/",
        json={"_id": "ffffffffffffffffffffffff"},
        headers=auth_headers(alice["jwt"]),
    )
    assert response.status_code == 404


def test_mark_without_id_or_markall_is_400(
    client: TestClient, store: FakeStore
) -> None:
    alice = register_and_login(client, "alice", "alice@example.com")

    response = client.put(
        "/api/v1/notifications/",
        json={},
        headers=auth_headers(alice["jwt"]),
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# markAll marks every unread for the caller
# ---------------------------------------------------------------------------


def test_mark_all_marks_all_unread(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    alice = register_and_login(client, "alice", "alice@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, alice["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id, owner["_id"])

    # Three separate mentions -> three unread notifications for Alice.
    mention(client, owner["jwt"], task_id, [alice["_id"]], body="one")
    mention(client, owner["jwt"], task_id, [alice["_id"]], body="two")
    mention(client, owner["jwt"], task_id, [alice["_id"]], body="three")

    inbox = get_notifications(client, alice["jwt"]).json()
    assert len(inbox) == 3
    assert all(note["isRead"] is False for note in inbox)

    marked = client.put(
        "/api/v1/notifications/",
        json={"markAll": True},
        headers=auth_headers(alice["jwt"]),
    )
    assert marked.status_code == 200
    assert marked.json() == "Notification updated"

    after = get_notifications(client, alice["jwt"]).json()
    assert len(after) == 3
    assert all(note["isRead"] is True for note in after)


# ---------------------------------------------------------------------------
# Cross-user isolation: cannot read or modify another user's notification
# ---------------------------------------------------------------------------


def test_other_user_cannot_mark_your_notification(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    alice = register_and_login(client, "alice", "alice@example.com")
    bob = register_and_login(client, "bob", "bob@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, alice["_id"], "editor")
    add_member(client, owner["jwt"], project_id, bob["_id"], "editor")
    task_id = create_task(client, owner["jwt"], project_id, owner["_id"])

    mention(client, owner["jwt"], task_id, [alice["_id"]])
    alice_note = get_notifications(client, alice["jwt"]).json()[0]

    # Bob tries to mark Alice's notification -> 403 (it exists but is hers).
    forbidden = client.put(
        "/api/v1/notifications/",
        json={"_id": alice_note["_id"]},
        headers=auth_headers(bob["jwt"]),
    )
    assert forbidden.status_code == 403

    # Bob's own inbox does not leak Alice's notification.
    assert get_notifications(client, bob["jwt"]).json() == []

    # And Alice's notification is still unread (Bob's attempt did nothing).
    assert get_notifications(client, alice["jwt"]).json()[0]["isRead"] is False
