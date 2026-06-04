"""Per-column WIP-limit tests (create + update on /boards).

These exercise the ``wipLimit`` field end-to-end through the real HTTP
endpoints against the in-memory ``FakeStore`` from ``conftest.py``. They
lock in the contract the drift detector relies on (see
``be_tools.detect_drift``): ``wipLimit`` is an optional non-negative
integer that defaults to 0 ("no limit"), settable on POST /boards and
changeable via PUT /boards alongside ``columnName``. Column writes gate
at editor level, mirroring the RBAC suite.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import COLUMNS
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


def column_by_name(
    client: TestClient, token: str, project_id: str, name: str
) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == name)


# ---------------------------------------------------------------------------
# Create: wipLimit on POST /boards
# ---------------------------------------------------------------------------


def test_create_column_with_wip_limit(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": 3},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 201, created.text
    assert created.json() == "Column created"

    review = column_by_name(client, owner["jwt"], project_id, "Review")
    assert review["wipLimit"] == 3


def test_create_column_defaults_wip_limit_to_zero(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 201, created.text

    review = column_by_name(client, owner["jwt"], project_id, "Review")
    # 0 means "no limit" per the drift-detector contract.
    assert review["wipLimit"] == 0


def test_create_column_with_zero_wip_limit_is_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": 0},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 201, created.text

    review = column_by_name(client, owner["jwt"], project_id, "Review")
    assert review["wipLimit"] == 0


def test_create_column_negative_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": -1},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text
    # Nothing was persisted.
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(owner["jwt"])
    ).json()
    assert all(column["columnName"] != "Review" for column in columns)


def test_create_column_string_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": "5"},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text


def test_create_column_float_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": 1.5},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text


def test_create_column_bool_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    # ``True`` is an ``int`` subclass; it must be rejected explicitly.
    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "wipLimit": True},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text


# ---------------------------------------------------------------------------
# Update: wipLimit + columnName on PUT /boards
# ---------------------------------------------------------------------------


def test_update_column_wip_limit(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 7},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == "Column updated"

    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["wipLimit"] == 7
    # The rename field is untouched.
    assert stored["columnName"] == "To Do"


def test_update_column_name(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "columnName": "In Review"},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == "Column updated"

    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["columnName"] == "In Review"


def test_update_column_zero_wip_limit_clears_limit(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    # Set a limit, then reset to 0 ("no limit").
    client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 4},
        headers=auth_headers(owner["jwt"]),
    )
    cleared = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 0},
        headers=auth_headers(owner["jwt"]),
    )
    assert cleared.status_code == 200, cleared.text

    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["wipLimit"] == 0


def test_update_column_negative_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": -3},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_column_string_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": "5"},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_column_float_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 1.5},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_column_bool_wip_limit_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": True},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_column_empty_name_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "columnName": ""},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_missing_id_is_400(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    updated = client.put(
        "/api/v1/boards/",
        json={"wipLimit": 3},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


def test_update_missing_column_is_404(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    create_project(client, owner["jwt"])

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": "ffffffffffffffffffffffff", "wipLimit": 3},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 404, updated.text


# ---------------------------------------------------------------------------
# Authorization: editor writes, viewer/non-member forbidden
# ---------------------------------------------------------------------------


def test_editor_can_update_wip_limit(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    editor = register_and_login(client, "editor", "editor@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, editor["_id"], "editor")

    column = first_column(client, editor["jwt"], project_id)
    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 5},
        headers=auth_headers(editor["jwt"]),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == "Column updated"

    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["wipLimit"] == 5


def test_viewer_cannot_update_wip_limit(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    viewer = register_and_login(client, "viewer", "viewer@example.com")
    project_id = create_project(client, owner["jwt"])
    add_member(client, owner["jwt"], project_id, viewer["_id"], "viewer")

    column = first_column(client, viewer["jwt"], project_id)
    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 5},
        headers=auth_headers(viewer["jwt"]),
    )
    assert updated.status_code == 403, updated.text

    # The viewer's attempt did not mutate the column. Seeded default
    # columns predate the field, so it is simply absent (which the
    # detector treats as "no limit") rather than the rejected 5.
    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored.get("wipLimit") != 5


def test_non_member_cannot_update_wip_limit(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    project_id = create_project(client, owner["jwt"])

    # The owner reads the column id; the outsider has no access at all.
    column = first_column(client, owner["jwt"], project_id)
    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "wipLimit": 5},
        headers=auth_headers(outsider["jwt"]),
    )
    assert updated.status_code == 403, updated.text
