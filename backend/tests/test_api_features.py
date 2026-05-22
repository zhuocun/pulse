from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.security import encrypt_password, legacy_password_hash, create_token
from app.services import auth_service, board_service, task_service, user_service
from app.validation import unwrap_error_detail
from tests.conftest import FakeStore


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_and_login(client: TestClient) -> Dict[str, Any]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "alice",
            "email": "alice@example.com",
            "password": "secret",
        },
    )
    assert response.status_code == 201
    assert response.json() == "User created"

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "secret"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert body["likedProjects"] == []
    # The REST JWT now rides an HttpOnly cookie instead of the response
    # body. Tests that explicitly send ``Authorization: Bearer`` pull
    # the cookie value out here so the existing ``auth_headers(...)``
    # call sites keep compiling -- the alternative is letting the
    # ``TestClient`` cookie jar do it automatically, which most of this
    # file does not opt into because it builds requests by hand.
    cookie_token = client.cookies.get("Token")
    assert cookie_token, "POST /auth/login must set the Token cookie"
    body["jwt"] = cookie_token
    return body


def register_and_login_user(
    client: TestClient,
    username: str,
    email: str,
) -> Dict[str, Any]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": email,
            "password": "secret",
        },
    )
    assert response.status_code == 201

    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret"},
    )
    assert response.status_code == 200
    body = response.json()
    cookie_token = client.cookies.get("Token")
    assert cookie_token, "POST /auth/login must set the Token cookie"
    body["jwt"] = cookie_token
    return body


def create_project_board_and_task(
    client: TestClient, token: str, user_id: str
) -> Dict[str, str]:
    headers = auth_headers(token)
    response = client.post(
        "/api/v1/projects/",
        json={
            "projectName": "Pulse",
            "organization": "OpenAI",
            "managerId": user_id,
        },
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json() == "Project created"

    project = client.get("/api/v1/projects/", headers=headers).json()[0]
    project_id = project["_id"]

    response = client.get(
        f"/api/v1/boards/?projectId={project_id}",
        headers=headers,
    )
    assert response.status_code == 200
    columns = response.json()
    assert [column["columnName"] for column in columns] == [
        "To Do",
        "In Progress",
        "Done",
    ]

    response = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json() == "Column created"

    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=headers
    ).json()
    todo = next(column for column in columns if column["columnName"] == "To Do")
    review = next(column for column in columns if column["columnName"] == "Review")

    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": project_id,
            "columnId": todo["_id"],
            "coordinatorId": user_id,
            "epic": "Core API",
            "storyPoints": 3,
            "taskName": "Port routes",
            "type": "Task",
            "note": "Match Express behavior",
        },
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json() == "Task created"

    task = client.get(f"/api/v1/tasks/?projectId={project_id}", headers=headers).json()[
        0
    ]
    return {
        "project_id": project_id,
        "todo_id": todo["_id"],
        "review_id": review["_id"],
        "task_id": task["_id"],
    }


def test_full_feature_flow(client: TestClient) -> None:
    response = client.get("/health", follow_redirects=False)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    versioned = client.get("/api/v1/health")
    assert versioned.status_code == 200
    assert versioned.json()["status"] == "ok"
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])

    response = client.get("/api/v1/users/", headers=headers)
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"

    response = client.put(
        "/api/v1/users/",
        json={"username": "alice-updated", "email": "alice2@example.com"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["username"] == "alice-updated"

    response = client.get("/api/v1/users/members", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 1

    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])

    response = client.get(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["projectName"] == "Pulse"

    response = client.get(
        f"/api/v1/projects/?projectName=Pulse&managerId={logged_in['_id']}",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()[0]["organization"] == "OpenAI"

    response = client.put(
        "/api/v1/projects/",
        json={
            "_id": ids["project_id"],
            "projectName": "Pulse API",
            "organization": "OpenAI",
            "managerId": logged_in["_id"],
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Project updated"

    response = client.put(
        "/api/v1/users/likes",
        json={"projectId": ids["project_id"]},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["likedProjects"] == [ids["project_id"]]

    response = client.put(
        "/api/v1/users/likes",
        json={"projectId": ids["project_id"]},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["likedProjects"] == []

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "after",
            "fromId": ids["todo_id"],
            "referenceId": ids["review_id"],
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Column reordered"

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_id"],
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": logged_in["_id"],
            "epic": "Core API",
            "storyPoints": 5,
            "taskName": "Port routes and tests",
            "type": "Task",
            "note": "Updated",
            "index": 0,
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Task updated"

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": ids["task_id"],
            "referenceId": None,
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["review_id"],
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Task reordered"

    response = client.delete(f"/api/v1/tasks/?taskId={ids['task_id']}", headers=headers)
    assert response.status_code == 200
    assert response.json() == "Task deleted"

    response = client.delete(
        f"/api/v1/boards/?columnId={ids['review_id']}", headers=headers
    )
    assert response.status_code == 200
    assert response.json() == "Column deleted"

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Project deleted"


def test_default_task_is_created_when_project_has_columns_but_no_tasks(
    client: TestClient,
) -> None:
    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    client.delete(f"/api/v1/tasks/?taskId={ids['task_id']}", headers=headers)
    response = client.get(
        f"/api/v1/tasks/?projectId={ids['project_id']}", headers=headers
    )

    assert response.status_code == 200
    assert response.json()[0]["taskName"] == "Default Task"


def test_auth_and_validation_errors(client: TestClient) -> None:
    assert client.get("/api/v1/users/").status_code == 401
    assert (
        client.get(
            "/api/v1/users/",
            headers={"Authorization": "Bearer bad-token"},
        ).status_code
        == 401
    )

    response = client.post("/api/v1/auth/register")
    assert response.status_code == 400
    assert response.json() == {
        "error": [
            {
                "msg": "Username cannot be empty",
                "param": "username",
                "location": "body",
            },
            {
                "msg": "Email cannot be empty",
                "param": "email",
                "location": "body",
            },
            {
                "msg": "Password cannot be empty",
                "param": "password",
                "location": "body",
            },
        ]
    }

    response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "email": "not-email", "password": "secret"},
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": [
            {
                "msg": "The input is not an email address",
                "value": "not-email",
                "param": "email",
                "location": "body",
            }
        ]
    }

    cases = [
        ("/api/v1/auth/register", {"email": "a@example.com", "password": "secret"}),
        (
            "/api/v1/auth/register",
            {"username": "ab", "email": "a@example.com", "password": "secret"},
        ),
        ("/api/v1/auth/register", {"username": "alice", "password": "secret"}),
        (
            "/api/v1/auth/register",
            {"username": "alice", "email": "not-email", "password": "secret"},
        ),
        ("/api/v1/auth/register", {"username": "alice", "email": "a@example.com"}),
        (
            "/api/v1/auth/register",
            {"username": "alice", "email": "a@example.com", "password": "1234"},
        ),
        ("/api/v1/auth/login", {"password": "secret"}),
        ("/api/v1/auth/login", {"email": "not-email", "password": "secret"}),
        ("/api/v1/auth/login", {"email": "missing@example.com"}),
    ]
    for url, payload in cases:
        assert client.post(url, json=payload).status_code == 400

    # Unknown email + valid-looking password collapses to the same 401 a
    # wrong-password attempt produces, so timing/error-text cannot be
    # used to enumerate registered emails.
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "missing@example.com", "password": "secret"},
        ).status_code
        == 401
    )

    register_and_login(client)
    assert (
        client.post(
            "/api/v1/auth/register",
            json={
                "username": "alice2",
                "email": "alice@example.com",
                "password": "secret",
            },
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "wrong"},
        ).status_code
        == 401
    )


def test_login_sets_session_cookie_and_omits_rest_jwt_from_body(
    client: TestClient,
) -> None:
    """The REST JWT must ride an HttpOnly cookie, not the JSON body.

    Pins the iOS 26.5 fix: the FE no longer has to hand the JWT
    across a WebKit document teardown via JS-managed storage.
    Body still carries the narrow-scope ``ai_jwt`` because the AI
    proxy stays bearer-authed and lives on a (potentially) different
    origin from the REST API.
    """

    client.post(
        "/api/v1/auth/register",
        json={
            "username": "cookie",
            "email": "cookie@example.com",
            "password": "secret",
        },
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "cookie@example.com", "password": "secret"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "rest_jwt" not in body and "jwt" not in body
    assert body["ai_jwt"]
    cookie_token = client.cookies.get("Token")
    assert cookie_token
    set_cookie = response.headers.get("set-cookie", "").lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie

    # The cookie alone authorises subsequent requests; httpx forwards
    # it automatically and the FE will do the same via the Vercel
    # rewrite + ``credentials: "include"``.
    me = client.get("/api/v1/users/")
    assert me.status_code == 200
    assert me.json()["email"] == "cookie@example.com"


def test_logout_clears_the_session_cookie(client: TestClient) -> None:
    register_and_login(client)
    assert client.cookies.get("Token")

    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 204
    # The browser side: ``Set-Cookie`` with Max-Age=0 removes the
    # cookie. httpx mirrors that and the next ``users.get`` 401s.
    assert not client.cookies.get("Token")
    assert client.get("/api/v1/users/").status_code == 401


def test_login_session_cookie_is_secure_when_forwarded_proto_is_https(
    client: TestClient,
) -> None:
    """Vercel terminates TLS upstream and forwards as plain http to the
    lambda, advertising the original scheme via ``X-Forwarded-Proto``.
    The cookie must still carry ``Secure`` in that case -- otherwise a
    MITM on a coffee-shop wifi could downgrade subsequent requests to
    http and steal the session.
    """

    client.post(
        "/api/v1/auth/register",
        json={
            "username": "forwarded",
            "email": "forwarded@example.com",
            "password": "secret",
        },
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "forwarded@example.com", "password": "secret"},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "").lower()
    assert "secure" in set_cookie
    # And the inverse: when the forwarded scheme is http (or the chain
    # is malformed), the cookie must NOT be Secure -- otherwise dev
    # behind a non-HTTPS proxy would have an unreachable cookie.
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "forwarded@example.com", "password": "secret"},
        headers={"X-Forwarded-Proto": "http, https"},
    )
    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "").lower()
    assert "secure" not in set_cookie


def test_login_handles_unserializable_user_info(
    client: TestClient,
    monkeypatch,
) -> None:
    register_and_login(client)
    monkeypatch.setattr(auth_service.repository, "serialize_document", lambda _: None)

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "secret"},
    )

    assert response.status_code == 401


def test_project_board_task_error_paths(client: TestClient) -> None:
    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])

    # ``managerId`` is no longer required in the body -- it comes from
    # the JWT subject -- so the only required fields are name + org.
    for payload in [
        {"organization": "OpenAI"},
        {"projectName": "Missing Org"},
    ]:
        assert (
            client.post("/api/v1/projects/", json=payload, headers=headers).status_code
            == 400
        )
    response = client.get("/api/v1/projects/", headers=headers)
    assert response.status_code == 200
    assert response.json() == []
    assert (
        client.get("/api/v1/projects/?projectId=bad-id", headers=headers).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/projects/", json={"_id": "bad-id"}, headers=headers
        ).status_code
        == 404
    )
    assert client.delete("/api/v1/projects/", headers=headers).status_code == 400
    assert (
        client.delete("/api/v1/projects/?projectId=bad-id", headers=headers).status_code
        == 404
    )

    assert client.get("/api/v1/boards/", headers=headers).status_code == 400
    assert (
        client.get("/api/v1/boards/?projectId=bad-id", headers=headers).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/boards/", json={"projectId": "bad-id"}, headers=headers
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/boards/", json={"columnName": "X"}, headers=headers
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/boards/",
            json={"columnName": "X", "projectId": "bad-id"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/boards/orders",
            json={"type": "before", "fromId": "bad-id", "referenceId": "bad-id"},
            headers=headers,
        ).status_code
        == 404
    )
    assert client.delete("/api/v1/boards/", headers=headers).status_code == 400
    assert (
        client.delete("/api/v1/boards/?columnId=bad-id", headers=headers).status_code
        == 404
    )

    for payload in [
        {},
        {"projectId": "p"},
        {"projectId": "p", "columnId": "c"},
        {"projectId": "p", "columnId": "c", "epic": "e"},
        {"projectId": "p", "columnId": "c", "epic": "e", "storyPoints": 1},
        {
            "projectId": "p",
            "columnId": "c",
            "epic": "e",
            "storyPoints": 1,
            "taskName": "t",
        },
        {
            "projectId": "p",
            "columnId": "c",
            "epic": "e",
            "storyPoints": 1,
            "taskName": "t",
            "type": "Task",
        },
    ]:
        assert (
            client.post("/api/v1/tasks/", json=payload, headers=headers).status_code
            == 400
        )

    assert (
        client.post(
            "/api/v1/tasks/",
            json={
                "projectId": "bad-id",
                "columnId": "bad-id",
                "coordinatorId": "bad-id",
                "epic": "e",
                "storyPoints": 1,
                "taskName": "t",
                "type": "Task",
                "note": "n",
            },
            headers=headers,
        ).status_code
        == 400
    )
    assert client.get("/api/v1/tasks/", headers=headers).status_code == 400
    assert (
        client.get("/api/v1/tasks/?projectId=bad-id", headers=headers).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/tasks/", json={"_id": "bad-id"}, headers=headers
        ).status_code
        == 404
    )
    assert client.delete("/api/v1/tasks/", headers=headers).status_code == 400
    assert (
        client.delete("/api/v1/tasks/?taskId=bad-id", headers=headers).status_code
        == 400
    )
    # The login earlier in this test put a session cookie in the
    # TestClient jar that httpx now sends automatically. Clear it so
    # this assertion exercises the unauthenticated path it was
    # written for.
    client.cookies.clear()
    assert (
        client.put("/api/v1/tasks/orders", json={"fromId": "bad-id"}).status_code == 401
    )


def test_task_reorder_requires_valid_payload_with_auth(
    client: TestClient, monkeypatch
) -> None:
    logged_in = register_and_login(client)
    monkeypatch.setattr(task_service, "reorder", lambda data, user_id: None)

    response = client.put(
        "/api/v1/tasks/orders",
        json={"fromId": "x"},
        headers=auth_headers(logged_in["jwt"]),
    )
    assert response.status_code == 400


def test_board_create_before_default_columns_matches_express(
    client: TestClient,
) -> None:
    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    response = client.post(
        "/api/v1/projects/",
        json={
            "projectName": "No board yet",
            "organization": "OpenAI",
            "managerId": logged_in["_id"],
        },
        headers=headers,
    )
    assert response.status_code == 201
    project_id = client.get("/api/v1/projects/", headers=headers).json()[0]["_id"]

    response = client.post(
        "/api/v1/boards/",
        json={"columnName": "Custom", "projectId": project_id},
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json() == {"error": "Project not found"}


def test_tasks_router_handles_non_column_service_error(
    client: TestClient, monkeypatch
) -> None:
    logged_in = register_and_login(client)
    monkeypatch.setattr(task_service, "get", lambda project_id, user_id: "Bad request")

    response = client.get(
        "/api/v1/tasks/?projectId=project-id",
        headers=auth_headers(logged_in["jwt"]),
    )

    assert response.status_code == 400


def test_current_user_id_rejects_token_without_subject(client: TestClient) -> None:
    import jwt

    from app import security

    forged = jwt.encode(
        {"iat": 0, "exp": 9_999_999_999},
        security.jwt_secret(),
        algorithm="HS256",
    )

    response = client.get("/api/v1/users/", headers=auth_headers(forged))

    # ``decode_token`` requires ``sub`` so a token without it is rejected
    # at the JWT layer with 401 (auth failure), not 400 (bad request).
    assert response.status_code == 401


def test_user_update_allows_unchanged_email_and_username(
    client: TestClient,
) -> None:
    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])

    response = client.put(
        "/api/v1/users/",
        json={"email": "alice@example.com", "username": "alice"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["email"] == "alice@example.com"


def test_user_error_paths(client: TestClient, store: FakeStore) -> None:
    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])
    store.insert_one(
        USERS,
        {
            "username": "bob",
            "email": "bob@example.com",
            "password": encrypt_password("secret"),
            "likedProjects": [],
        },
    )

    response = client.put(
        "/api/v1/users/",
        json={"email": "bob@example.com"},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": [
            {
                "msg": "Email has been registered",
                "value": "bob@example.com",
                "param": "email",
                "location": "body",
            }
        ]
    }

    response = client.put(
        "/api/v1/users/",
        json={"username": "bob"},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": [
            {
                "msg": "Username has been registered",
                "value": "bob",
                "param": "username",
                "location": "body",
            }
        ]
    }
    assert (
        client.put(
            "/api/v1/users/likes",
            json={},
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.put(
            "/api/v1/users/likes",
            json={"projectId": "bad-id"},
            headers=headers,
        ).status_code
        == 404
    )

    store.data[USERS].clear()
    assert client.get("/api/v1/users/", headers=headers).status_code == 404
    assert (
        client.put(
            "/api/v1/users/", json={"username": "x"}, headers=headers
        ).status_code
        == 404
    )
    assert client.get("/api/v1/users/members", headers=headers).status_code == 200
    assert client.get("/api/v1/users/members", headers=headers).json() == []


def test_user_password_update_and_failed_update(
    client: TestClient, monkeypatch
) -> None:
    logged_in = register_and_login(client)
    headers = auth_headers(logged_in["jwt"])

    response = client.put(
        "/api/v1/users/",
        json={"password": "new-secret"},
        headers=headers,
    )
    assert response.status_code == 200

    # Empty password is now an explicit validation error rather than a
    # silent no-op, so callers cannot accidentally believe they changed
    # their password when nothing was written.
    response = client.put(
        "/api/v1/users/",
        json={"password": ""},
        headers=headers,
    )
    assert response.status_code == 400

    # Sub-minimum lengths share the same rule as registration.
    response = client.put(
        "/api/v1/users/",
        json={"password": "abc"},
        headers=headers,
    )
    assert response.status_code == 400

    monkeypatch.setattr(user_service.repository, "update_by_id", lambda *args: None)
    response = client.put(
        "/api/v1/users/",
        json={"username": "still-alice"},
        headers=headers,
    )
    assert response.status_code == 404


def test_legacy_password_hash_login_migrates_to_pbkdf2(
    client: TestClient,
    store: FakeStore,
) -> None:
    user_id = store.insert_one(
        USERS,
        {
            "username": "legacy",
            "email": "legacy@example.com",
            "password": legacy_password_hash("secret"),
            "likedProjects": [],
        },
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "legacy@example.com", "password": "secret"},
    )

    assert response.status_code == 200
    assert response.json()["_id"] == str(user_id)
    user = store.find_by_id(USERS, str(user_id))
    assert user["password"].startswith("pbkdf2_sha256$")


def test_register_ignores_client_supplied_liked_projects(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "mallory",
            "email": "mallory@example.com",
            "password": "secret",
            "likedProjects": ["injected-project"],
        },
    )
    assert response.status_code == 201

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "mallory@example.com", "password": "secret"},
    )

    assert response.status_code == 200
    assert response.json()["likedProjects"] == []


def test_user_update_rejects_mass_assignment(client: TestClient) -> None:
    logged_in = register_and_login(client)

    response = client.put(
        "/api/v1/users/",
        json={"likedProjects": ["project-id"]},
        headers=auth_headers(logged_in["jwt"]),
    )

    assert response.status_code == 400
    assert response.json() == {"error": [{"msg": "Unknown field(s): likedProjects"}]}


def test_project_delete_cascades_columns_and_tasks(
    client: TestClient,
    store: FakeStore,
) -> None:
    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=headers,
    )

    assert response.status_code == 200
    assert store.find_many(COLUMNS, {"projectId": ids["project_id"]}) == []
    assert store.find_many(TASKS, {"projectId": ids["project_id"]}) == []


def test_column_delete_cascades_tasks(client: TestClient, store: FakeStore) -> None:
    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    headers = auth_headers(logged_in["jwt"])

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_id"],
            "projectId": ids["project_id"],
            "columnId": ids["review_id"],
            "coordinatorId": logged_in["_id"],
            "epic": "Core API",
            "storyPoints": 3,
            "taskName": "Moved task",
            "type": "Task",
            "note": "Review",
            "index": 0,
        },
        headers=headers,
    )
    assert response.status_code == 200

    response = client.delete(
        f"/api/v1/boards/?columnId={ids['review_id']}",
        headers=headers,
    )

    assert response.status_code == 200
    assert store.find_many(TASKS, {"columnId": ids["review_id"]}) == []


def test_board_remove_handles_failed_delete(
    client: TestClient,
    store: FakeStore,
    monkeypatch,
) -> None:
    logged_in = register_and_login(client)
    ids = create_project_board_and_task(client, logged_in["jwt"], logged_in["_id"])
    monkeypatch.setattr(board_service.repository, "delete_by_id", lambda *args: None)

    assert board_service.remove(ids["review_id"], logged_in["_id"]) is None


def test_project_resource_mutations_require_project_manager(
    client: TestClient,
    store: FakeStore,
) -> None:
    ids = seed_ordering_data(store)
    intruder = register_and_login_user(
        client,
        "intruder",
        "intruder@example.com",
    )
    intruder_headers = auth_headers(intruder["jwt"])

    # Intruder POSTs an unrelated project of their own; the manager
    # always tracks the JWT subject so impersonation isn't possible.
    response = client.post(
        "/api/v1/projects/",
        json={"projectName": "Mine", "organization": "OpenAI"},
        headers=intruder_headers,
    )
    assert response.status_code == 201

    response = client.put(
        "/api/v1/projects/",
        json={
            "_id": ids["project_id"],
            "projectName": "Blocked",
            "organization": "OpenAI",
            "managerId": ids["user_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.post(
        "/api/v1/boards/",
        json={"columnName": "Blocked", "projectId": ids["project_id"]},
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "after",
            "fromId": ids["todo_id"],
            "referenceId": ids["done_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/boards/?columnId={ids['done_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": ids["user_id"],
            "epic": "e",
            "storyPoints": 1,
            "taskName": "Blocked task",
            "type": "Task",
            "note": "n",
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_a"],
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": ids["user_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/tasks/?taskId={ids['task_a']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": ids["task_b"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["todo_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.get(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.get(
        f"/api/v1/boards/?projectId={ids['project_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.get(
        f"/api/v1/tasks/?projectId={ids['project_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403


def test_task_update_cannot_reassign_to_foreign_project(
    client: TestClient,
    store: FakeStore,
) -> None:
    """Moving a task to another project's column must require manager rights."""

    logged_in = register_and_login(client)
    ids = seed_ordering_data(store)
    other_project_id = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Other",
                "organization": "O",
                "managerId": ids["user_id"],
            },
        )
    )
    other_column_id = str(
        store.insert_one(
            COLUMNS,
            {"columnName": "Other Col", "projectId": other_project_id, "index": 0},
        )
    )
    headers = auth_headers(logged_in["jwt"])
    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_a"],
            "projectId": other_project_id,
            "columnId": other_column_id,
            "coordinatorId": ids["user_id"],
        },
        headers=headers,
    )
    assert response.status_code == 403


def test_cross_project_board_and_task_relationships_are_rejected(
    client: TestClient,
    store: FakeStore,
) -> None:
    logged_in = register_and_login(client)
    ids = seed_ordering_data(store)
    other_project_id = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Other Project",
                "organization": "OpenAI",
                "managerId": logged_in["_id"],
            },
        )
    )
    other_column_id = str(
        store.insert_one(
            COLUMNS,
            {
                "columnName": "Other To Do",
                "projectId": other_project_id,
                "index": 0,
            },
        )
    )
    other_task_id = str(
        store.insert_one(
            TASKS,
            {
                "columnId": other_column_id,
                "coordinatorId": logged_in["_id"],
                "epic": "e",
                "taskName": "Other task",
                "type": "Task",
                "note": "n",
                "projectId": other_project_id,
                "storyPoints": 1,
                "index": 0,
            },
        )
    )
    headers = auth_headers(logged_in["jwt"])

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "after",
            "fromId": ids["todo_id"],
            "referenceId": other_column_id,
        },
        headers=headers,
    )
    assert response.status_code == 404

    response = client.put(
        "/api/v1/projects/",
        json={
            "_id": other_project_id,
            "projectName": "Other Project",
            "organization": "OpenAI",
            "managerId": "missing-manager",
        },
        headers=headers,
    )
    assert response.status_code == 404

    intruder = register_and_login_user(
        client,
        "intruder",
        "intruder@example.com",
    )
    intruder_headers = auth_headers(intruder["jwt"])

    response = client.put(
        "/api/v1/projects/",
        json={
            "_id": ids["project_id"],
            "projectName": "Blocked",
            "organization": "OpenAI",
            "managerId": ids["user_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/projects/?projectId={ids['project_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    # POST cannot impersonate another manager: the manager is now
    # always the JWT subject. An intruder posting valid creation data
    # gets a project owned by themselves, not by the victim.
    response = client.post(
        "/api/v1/projects/",
        json={"projectName": "Mine", "organization": "OpenAI"},
        headers=intruder_headers,
    )
    assert response.status_code == 201

    response = client.post(
        "/api/v1/boards/",
        json={"columnName": "Blocked", "projectId": ids["project_id"]},
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "after",
            "fromId": ids["todo_id"],
            "referenceId": ids["doing_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/boards/?columnId={ids['doing_id']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": ids["user_id"],
            "epic": "e",
            "storyPoints": 1,
            "taskName": "Blocked task",
            "type": "Task",
            "note": "n",
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_a"],
            "projectId": ids["project_id"],
            "columnId": ids["todo_id"],
            "coordinatorId": ids["user_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.delete(
        f"/api/v1/tasks/?taskId={ids['task_a']}",
        headers=intruder_headers,
    )
    assert response.status_code == 403

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": ids["task_b"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["todo_id"],
        },
        headers=intruder_headers,
    )
    assert response.status_code == 403

    manager_headers = auth_headers(create_token(ids["user_id"]))

    response = client.post(
        "/api/v1/tasks/",
        json={
            "projectId": other_project_id,
            "columnId": ids["todo_id"],
            "coordinatorId": logged_in["_id"],
            "epic": "e",
            "storyPoints": 1,
            "taskName": "Wrong project",
            "type": "Task",
            "note": "n",
        },
        headers=headers,
    )
    assert response.status_code == 400

    response = client.put(
        "/api/v1/tasks/",
        json={
            "_id": ids["task_a"],
            "projectId": other_project_id,
            "columnId": ids["todo_id"],
            "coordinatorId": ids["user_id"],
        },
        headers=manager_headers,
    )
    assert response.status_code == 404

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": other_task_id,
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": other_column_id,
        },
        headers=manager_headers,
    )
    assert response.status_code == 400

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": "missing-task",
            "referenceId": other_task_id,
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": other_column_id,
        },
        headers=manager_headers,
    )
    assert response.status_code == 400

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "after",
            "fromId": ids["task_a"],
            "referenceId": other_task_id,
            "fromColumnId": ids["doing_id"],
            "referenceColumnId": other_column_id,
        },
        headers=manager_headers,
    )
    assert response.status_code == 400

    response = client.put(
        "/api/v1/tasks/orders",
        json={
            "type": "sideways",
            "fromId": ids["task_a"],
            "referenceId": ids["task_b"],
            "fromColumnId": ids["todo_id"],
            "referenceColumnId": ids["todo_id"],
        },
        headers=manager_headers,
    )
    assert response.status_code == 400


def seed_ordering_data(store: FakeStore) -> Dict[str, str]:
    user_id = str(
        store.insert_one(
            USERS,
            {
                "username": "manager",
                "email": "manager@example.com",
                "password": encrypt_password("secret"),
                "likedProjects": [],
            },
        )
    )
    project_id = str(
        store.insert_one(
            PROJECTS,
            {
                "projectName": "Ordering",
                "organization": "OpenAI",
                "managerId": user_id,
            },
        )
    )
    todo_id = str(
        store.insert_one(
            COLUMNS, {"columnName": "To Do", "projectId": project_id, "index": 0}
        )
    )
    doing_id = str(
        store.insert_one(
            COLUMNS, {"columnName": "Doing", "projectId": project_id, "index": 1}
        )
    )
    done_id = str(
        store.insert_one(
            COLUMNS, {"columnName": "Done", "projectId": project_id, "index": 2}
        )
    )
    task_a = str(
        store.insert_one(
            TASKS,
            {
                "columnId": todo_id,
                "coordinatorId": user_id,
                "epic": "e",
                "taskName": "A",
                "type": "Task",
                "note": "n",
                "projectId": project_id,
                "storyPoints": 1,
                "index": 0,
            },
        )
    )
    task_b = str(
        store.insert_one(
            TASKS,
            {
                "columnId": todo_id,
                "coordinatorId": user_id,
                "epic": "e",
                "taskName": "B",
                "type": "Task",
                "note": "n",
                "projectId": project_id,
                "storyPoints": 1,
                "index": 1,
            },
        )
    )
    task_c = str(
        store.insert_one(
            TASKS,
            {
                "columnId": todo_id,
                "coordinatorId": user_id,
                "epic": "e",
                "taskName": "C",
                "type": "Task",
                "note": "n",
                "projectId": project_id,
                "storyPoints": 1,
                "index": 2,
            },
        )
    )
    task_d = str(
        store.insert_one(
            TASKS,
            {
                "columnId": doing_id,
                "coordinatorId": user_id,
                "epic": "e",
                "taskName": "D",
                "type": "Task",
                "note": "n",
                "projectId": project_id,
                "storyPoints": 1,
                "index": 0,
            },
        )
    )
    return {
        "user_id": user_id,
        "project_id": project_id,
        "todo_id": todo_id,
        "doing_id": doing_id,
        "done_id": done_id,
        "task_a": task_a,
        "task_b": task_b,
        "task_c": task_c,
        "task_d": task_d,
    }


def test_remaining_ordering_branches(client: TestClient, store: FakeStore) -> None:
    ids = seed_ordering_data(store)
    headers = auth_headers(create_token(ids["user_id"]))

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "before",
            "fromId": ids["done_id"],
            "referenceId": ids["todo_id"],
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == "Column reordered"

    response = client.put(
        "/api/v1/boards/orders",
        json={
            "type": "sideways",
            "fromId": ids["done_id"],
            "referenceId": ids["todo_id"],
        },
        headers=headers,
    )
    assert response.status_code == 404

    assert (
        task_service.reorder(
            {
                "type": "before",
                "fromId": ids["task_c"],
                "referenceId": ids["task_a"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            ids["user_id"],
        )
        == "Task reordered"
    )
    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": ids["task_a"],
                "referenceId": ids["task_c"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            ids["user_id"],
        )
        == "Task reordered"
    )

    extra_a = str(
        store.insert_one(
            TASKS,
            {
                "columnId": ids["done_id"],
                "coordinatorId": "x",
                "epic": "e",
                "taskName": "Extra A",
                "type": "Task",
                "note": "n",
                "projectId": store.find_by_id(COLUMNS, ids["done_id"])["projectId"],
                "storyPoints": 1,
                "index": 0,
            },
        )
    )
    store.insert_one(
        TASKS,
        {
            "columnId": ids["done_id"],
            "coordinatorId": "x",
            "epic": "e",
            "taskName": "Extra B",
            "type": "Task",
            "note": "n",
            "projectId": store.find_by_id(COLUMNS, ids["done_id"])["projectId"],
            "storyPoints": 1,
            "index": 1,
        },
    )
    extra_c = str(
        store.insert_one(
            TASKS,
            {
                "columnId": ids["done_id"],
                "coordinatorId": "x",
                "epic": "e",
                "taskName": "Extra C",
                "type": "Task",
                "note": "n",
                "projectId": store.find_by_id(COLUMNS, ids["done_id"])["projectId"],
                "storyPoints": 1,
                "index": 2,
            },
        )
    )
    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": extra_a,
                "referenceId": extra_c,
                "fromColumnId": ids["done_id"],
                "referenceColumnId": ids["done_id"],
            },
            ids["user_id"],
        )
        == "Task reordered"
    )

    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": ids["task_c"],
                "referenceId": ids["task_d"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["doing_id"],
            },
            ids["user_id"],
        )
        == "Task reordered"
    )
    assert (
        task_service.reorder(
            {
                "type": "after",
                "fromId": ids["task_b"],
                "referenceId": None,
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            ids["user_id"],
        )
        is None
    )
    assert (
        task_service.reorder(
            {
                "type": "before",
                "fromId": ids["task_a"],
                "referenceId": "",
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["done_id"],
            },
            ids["user_id"],
        )
        == "Task reordered"
    )
    missing_ref = "000000000000000000000001"
    assert (
        task_service.reorder(
            {
                "type": "before",
                "fromId": ids["task_c"],
                "referenceId": missing_ref,
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            ids["user_id"],
        )
        is None
    )
    assert (
        task_service.reorder(
            {
                "type": "sideways",
                "fromId": ids["task_b"],
                "referenceId": ids["task_c"],
                "fromColumnId": ids["todo_id"],
                "referenceColumnId": ids["todo_id"],
            },
            ids["user_id"],
        )
        is None
    )


def test_unwrap_error_detail_for_plain_detail() -> None:
    assert unwrap_error_detail("plain") == {"error": "plain"}


def test_login_returns_503_when_jwt_secret_is_unconfigured(
    client: TestClient,
) -> None:
    register_and_login(client)
    object.__setattr__(auth_service.settings, "jwt_secret", "too-short")
    try:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "alice@example.com", "password": "secret"},
        )
    finally:
        object.__setattr__(
            auth_service.settings,
            "jwt_secret",
            "test-secret-change-me-32-bytes-long",
        )

    assert response.status_code == 503
    assert response.json() == {"error": "Server JWT secret is not configured"}


def test_unhandled_exception_is_returned_as_json_500(
    store: FakeStore,
    monkeypatch,
) -> None:
    from app import main as main_module
    from app.routers import auth as auth_router

    def boom(_: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(auth_router.auth_service, "login", boom)

    with TestClient(main_module.app, raise_server_exceptions=False) as test_client:
        response = test_client.post(
            "/api/v1/auth/login",
            json={"email": "x@example.com", "password": "secret"},
        )

    assert response.status_code == 500
    # Generic body so internal exception class names / messages do not
    # leak to clients; the original error stays in server logs.
    assert response.json() == {"error": "internal_server_error"}


def test_health_endpoint_returns_runtime_metadata(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert isinstance(body["agents_loaded"], int)
    assert "checkpointer" in body
    assert "store" in body


def test_legacy_health_serves_directly_without_redirect(client: TestClient) -> None:
    response = client.get("/health", follow_redirects=False)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_lifespan_fails_fast_when_jwt_secret_is_short(monkeypatch) -> None:
    from app import main as main_module
    from app import security

    object.__setattr__(security.settings, "jwt_secret", "too-short")

    fake = FakeStore()
    monkeypatch.setattr(main_module, "repository", fake)

    try:
        with pytest.raises(RuntimeError, match="JWT secret must be at least"):
            with TestClient(main_module.app):
                pass
    finally:
        object.__setattr__(
            security.settings,
            "jwt_secret",
            "test-secret-change-me-32-bytes-long",
        )


def test_validate_cors_origin_regex_rejects_unanchored() -> None:
    from app import main as main_module

    with pytest.raises(RuntimeError, match="anchored"):
        main_module._validate_cors_origin_regex(".*")
    main_module._validate_cors_origin_regex("")
    main_module._validate_cors_origin_regex(r"^https://.*\.example\.com$")
    with pytest.raises(RuntimeError, match="not a valid regex"):
        main_module._validate_cors_origin_regex("^[unbalanced$")
