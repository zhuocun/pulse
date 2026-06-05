"""Persisted column ``category`` tests (the "done" source of truth).

These exercise the stored ``category`` field end-to-end through the real
HTTP endpoints against the in-memory ``FakeStore`` from ``conftest.py``,
plus a couple of direct unit assertions on the drift-detector helper that
consumes it. ``category`` replaces the locale-fragile column-name
heuristic as the source of truth for done-ness: the seeded defaults carry
``"todo"`` / ``"in_progress"`` / ``"done"``, only those three labels are
accepted on POST/PUT /boards, and the board read echoes a derived
``isDone`` (``isDone == (category == "done")``). Column writes gate at
editor level, mirroring the WIP-limit suite.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import COLUMNS
from app.services.column_seed import DEFAULT_COLUMN_CATEGORIES
from app.tools.be_tools import _is_done_column
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


def board(client: TestClient, token: str, project_id: str) -> list:
    return client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()


def column_by_name(
    client: TestClient, token: str, project_id: str, name: str
) -> Dict[str, Any]:
    return next(
        column
        for column in board(client, token, project_id)
        if column["columnName"] == name
    )


def first_column(client: TestClient, token: str, project_id: str) -> Dict[str, Any]:
    return column_by_name(client, token, project_id, "To Do")


# ---------------------------------------------------------------------------
# Seeding: default columns carry the correct category
# ---------------------------------------------------------------------------


def test_seeded_defaults_carry_category(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    columns = board(client, owner["jwt"], project_id)
    by_name = {column["columnName"]: column for column in columns}

    assert by_name["To Do"]["category"] == "todo"
    assert by_name["In Progress"]["category"] == "in_progress"
    assert by_name["Done"]["category"] == "done"

    # The seeded values match the name->category map exactly.
    for name, category in DEFAULT_COLUMN_CATEGORIES.items():
        assert by_name[name]["category"] == category


def test_board_get_returns_derived_is_done(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    columns = board(client, owner["jwt"], project_id)
    by_name = {column["columnName"]: column for column in columns}

    # ``isDone`` is a derived read alias: true only for the Done bucket.
    assert by_name["To Do"]["isDone"] is False
    assert by_name["In Progress"]["isDone"] is False
    assert by_name["Done"]["isDone"] is True
    # Every column carries the alias, and it always tracks ``category``.
    for column in columns:
        assert column["isDone"] == (column["category"] == "done")


def test_is_done_alias_is_derived_not_stored(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    done = column_by_name(client, owner["jwt"], project_id, "Done")
    # The GET response exposes ``isDone`` but it is computed, never
    # persisted (and not part of ``TABLE_FIELDS[COLUMNS]``).
    stored = store.find_by_id(COLUMNS, done["_id"])
    assert stored is not None
    assert "isDone" not in stored
    assert stored["category"] == "done"


# ---------------------------------------------------------------------------
# Create: category on POST /boards
# ---------------------------------------------------------------------------


def test_create_column_with_category(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={
            "columnName": "Review",
            "projectId": project_id,
            "category": "done",
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 201, created.text
    assert created.json() == "Column created"

    review = column_by_name(client, owner["jwt"], project_id, "Review")
    assert review["category"] == "done"
    assert review["isDone"] is True


def test_create_column_defaults_category_to_todo(
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
    # An omitted category defaults to "todo" (a new column is not done).
    assert review["category"] == "todo"
    assert review["isDone"] is False


def test_create_column_invalid_category_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={
            "columnName": "Review",
            "projectId": project_id,
            "category": "shipped",
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text
    # Nothing was persisted.
    assert all(
        column["columnName"] != "Review"
        for column in board(client, owner["jwt"], project_id)
    )


def test_create_column_non_string_category_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    created = client.post(
        "/api/v1/boards/",
        json={"columnName": "Review", "projectId": project_id, "category": 3},
        headers=auth_headers(owner["jwt"]),
    )
    assert created.status_code == 400, created.text


# ---------------------------------------------------------------------------
# Update: category on PUT /boards
# ---------------------------------------------------------------------------


def test_update_column_category(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "category": "done"},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == "Column updated"

    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["category"] == "done"
    # The rename field is untouched.
    assert stored["columnName"] == "To Do"
    # And the board now reports the column as done.
    assert first_column(client, owner["jwt"], project_id)["isDone"] is True


def test_update_column_invalid_category_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "category": "archived"},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text

    # The rejected value did not mutate the stored category.
    stored = store.find_by_id(COLUMNS, column["_id"])
    assert stored is not None
    assert stored["category"] == "todo"


def test_update_column_non_string_category_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    updated = client.put(
        "/api/v1/boards/",
        json={"_id": column["_id"], "category": True},
        headers=auth_headers(owner["jwt"]),
    )
    assert updated.status_code == 400, updated.text


# ---------------------------------------------------------------------------
# Drift detector: category is preferred over the name heuristic
# ---------------------------------------------------------------------------


def test_is_done_column_prefers_category_over_name() -> None:
    # A "Done"-named column whose stored category says it is not done is
    # treated as not-done: the persisted category wins outright.
    assert _is_done_column({"name": "Done", "category": "todo"}) is False
    # Conversely, a non-Done name with ``category == "done"`` is done.
    assert _is_done_column({"name": "Backlog", "category": "done"}) is True


def test_is_done_column_falls_back_to_name_when_category_absent() -> None:
    # Legacy column docs with no ``category`` keep the locale-aware
    # name heuristic (and the explicit ``isDone`` flag) intact.
    assert _is_done_column({"name": "Done"}) is True
    assert _is_done_column({"name": "Terminé"}) is True  # fr
    assert _is_done_column({"name": "In Progress"}) is False
    assert _is_done_column({"name": "In Progress", "isDone": True}) is True
