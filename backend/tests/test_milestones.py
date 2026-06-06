"""Project-scoped milestone CRUD tests (GitHub-style milestones).

Backend-only slice: a ``milestones`` collection scoped to a project, gated
by the project RBAC (viewer reads, editor writes) exactly like
``label_service``. This slice deliberately does NOT touch tasks --
task->milestone assignment is a separate follow-up -- so ``remove`` is a
plain hard delete with no cascade.

The harness mirrors ``test_project_lifecycle.py``: most cases drive the
``milestone_service`` functions DIRECTLY against the in-memory
``FakeStore`` from ``conftest.py`` (the ``store`` fixture monkeypatches the
repository onto every service module), while real users come through the
HTTP register/login helper so every ``_id`` is a valid ObjectId string
that survives ``find_by_id``. A handful of cases exercise the router
through the real HTTP layer via ``TestClient`` so the sentinel->status
mapping is covered too.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import MILESTONES, PROJECTS
from app.services import milestone_service, project_service
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


# Module-level handle to the active FakeStore, populated per test by
# ``bootstrap`` so the small helpers below can read the store positionally.
_STORE: FakeStore


def create_project(manager_id: str, name: str = "Pulse") -> str:
    """Create a project through the service and return its id (str)."""

    assert (
        project_service.create(
            {"projectName": name, "organization": "OpenAI"}, manager_id
        )
        == "Project created"
    )
    rows = [
        row
        for row in _STORE.data[PROJECTS]
        if str(row.get("managerId")) == str(manager_id)
        and row.get("projectName") == name
    ]
    assert len(rows) == 1, rows
    return str(rows[0]["_id"])


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


def milestone_rows(project_id: str) -> list:
    return _STORE.find_many(MILESTONES, {"projectId": project_id})


def only_milestone(project_id: str) -> Dict[str, Any]:
    rows = milestone_rows(project_id)
    assert len(rows) == 1, rows
    return rows[0]


def bootstrap(client: TestClient, store: FakeStore) -> Dict[str, Any]:
    """Manager + project; wire the module-level store handle."""

    global _STORE
    _STORE = store
    manager = register_and_login(client, "manager", "manager@example.com")
    project_id = create_project(manager["_id"])
    return {"manager": manager, "project_id": project_id}


# ---------------------------------------------------------------------------
# Happy path: create -> list -> update -> remove round-trip
# ---------------------------------------------------------------------------


def test_create_list_update_remove_round_trip(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # Create with only the required fields: the optional fields take their
    # defaults (description "", start/due None, state "open").
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": "v1.0"}, manager["_id"]
        )
        == "Milestone created"
    )

    row = only_milestone(project_id)
    milestone_id = str(row["_id"])
    assert row["name"] == "v1.0"
    assert row["state"] == "open"            # default
    assert row["description"] == ""          # default
    assert row["startDate"] is None          # default
    assert row["dueDate"] is None            # default
    assert row["projectId"] == project_id
    # ``createdAt``/``updatedAt`` are repository-injected, never stamped by
    # the service -- but they must be present on the stored row.
    assert "createdAt" in row and "updatedAt" in row

    # List returns the serialized milestone (``_id`` stringified).
    listed = milestone_service.get(project_id, manager["_id"])
    assert isinstance(listed, list)
    assert len(listed) == 1
    assert listed[0]["_id"] == milestone_id
    assert listed[0]["name"] == "v1.0"

    # Update mutates the allowlisted fields and ignores the rest.
    assert (
        milestone_service.update(
            milestone_id,
            {
                "_id": milestone_id,
                "name": "v1.1",
                "description": "first release",
                "startDate": "2026-01-01",
                "dueDate": "2026-02-01",
                # Not in the writable allowlist -> dropped, never written.
                "projectId": "should-be-ignored",
            },
            manager["_id"],
        )
        == "Milestone updated"
    )
    updated = only_milestone(project_id)
    assert updated["name"] == "v1.1"
    assert updated["description"] == "first release"
    assert updated["startDate"] == "2026-01-01"
    assert updated["dueDate"] == "2026-02-01"
    # The immutable ``projectId`` was filtered out by the update allowlist.
    assert updated["projectId"] == project_id

    # Remove hard-deletes the row.
    assert milestone_service.remove(milestone_id, manager["_id"]) == "Milestone deleted"
    assert milestone_rows(project_id) == []
    assert store.find_by_id(MILESTONES, milestone_id) is None


def test_create_with_explicit_optional_fields_persists_them(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    assert (
        milestone_service.create(
            {
                "projectId": project_id,
                "name": "Beta",
                "description": "the beta cut",
                "startDate": "2026-03-01",
                "dueDate": "2026-04-01",
                "state": "closed",
            },
            manager["_id"],
        )
        == "Milestone created"
    )
    row = only_milestone(project_id)
    assert row["description"] == "the beta cut"
    assert row["startDate"] == "2026-03-01"
    assert row["dueDate"] == "2026-04-01"
    assert row["state"] == "closed"


# ---------------------------------------------------------------------------
# Router round-trip: the HTTP layer + sentinel->status mapping
# ---------------------------------------------------------------------------


def test_router_create_list_update_remove(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]
    headers = auth_headers(manager["jwt"])

    created = client.post(
        "/api/v1/milestones/",
        json={"projectId": project_id, "name": "Sprint 1"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json() == "Milestone created"

    listing = client.get(
        f"/api/v1/milestones/?projectId={project_id}", headers=headers
    )
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert len(body) == 1
    assert body[0]["name"] == "Sprint 1"
    assert body[0]["state"] == "open"
    milestone_id = body[0]["_id"]

    updated = client.put(
        "/api/v1/milestones/",
        json={"_id": milestone_id, "state": "closed"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == "Milestone updated"
    assert store.find_by_id(MILESTONES, milestone_id)["state"] == "closed"

    removed = client.delete(
        f"/api/v1/milestones/?milestoneId={milestone_id}", headers=headers
    )
    assert removed.status_code == 200, removed.text
    assert removed.json() == "Milestone deleted"
    assert store.find_by_id(MILESTONES, milestone_id) is None


def test_router_delete_without_id_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    headers = auth_headers(ctx["manager"]["jwt"])

    response = client.delete("/api/v1/milestones/", headers=headers)
    assert response.status_code == 400, response.text


# ---------------------------------------------------------------------------
# RBAC: read=viewer, write=editor; non-members are locked out everywhere
# ---------------------------------------------------------------------------


def test_non_member_forbidden_everywhere(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # Seed a milestone (as the manager) so update/remove have a target.
    milestone_service.create(
        {"projectId": project_id, "name": "v1.0"}, manager["_id"]
    )
    milestone_id = str(only_milestone(project_id)["_id"])

    outsider = register_and_login(client, "outsider", "outsider@example.com")

    # Direct service calls: a non-member is Forbidden on read AND every write.
    assert milestone_service.get(project_id, outsider["_id"]) == "Forbidden"
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": "sneaky"}, outsider["_id"]
        )
        == "Forbidden"
    )
    assert (
        milestone_service.update(
            milestone_id, {"name": "sneaky"}, outsider["_id"]
        )
        == "Forbidden"
    )
    assert milestone_service.remove(milestone_id, outsider["_id"]) == "Forbidden"

    # A non-member cannot probe existence via a bad body: existence/access are
    # checked BEFORE body validation, so even an empty name yields Forbidden.
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": ""}, outsider["_id"]
        )
        == "Forbidden"
    )

    # And the same through the HTTP layer -> 403.
    headers = auth_headers(outsider["jwt"])
    assert (
        client.get(
            f"/api/v1/milestones/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/milestones/",
            json={"projectId": project_id, "name": "sneaky"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/v1/milestones/",
            json={"_id": milestone_id, "name": "sneaky"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/milestones/?milestoneId={milestone_id}", headers=headers
        ).status_code
        == 403
    )
    # The row was never touched by any forbidden write.
    assert only_milestone(project_id)["name"] == "v1.0"


def test_viewer_can_read_but_not_write(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    milestone_service.create(
        {"projectId": project_id, "name": "v1.0"}, manager["_id"]
    )
    milestone_id = str(only_milestone(project_id)["_id"])

    viewer = register_and_login(client, "viewer", "viewer@example.com")
    add_member(client, manager["jwt"], project_id, viewer["_id"], "viewer")

    # A viewer-role member may list (read gate is viewer).
    listed = milestone_service.get(project_id, viewer["_id"])
    assert isinstance(listed, list)
    assert len(listed) == 1

    # But every write is gated at editor -> Forbidden.
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": "nope"}, viewer["_id"]
        )
        == "Forbidden"
    )
    assert (
        milestone_service.update(
            milestone_id, {"name": "nope"}, viewer["_id"]
        )
        == "Forbidden"
    )
    assert milestone_service.remove(milestone_id, viewer["_id"]) == "Forbidden"


def test_editor_can_do_everything(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    editor = register_and_login(client, "editor", "editor@example.com")
    add_member(client, manager["jwt"], project_id, editor["_id"], "editor")

    # Create + read + update + remove all succeed for an editor-role member.
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": "v2.0"}, editor["_id"]
        )
        == "Milestone created"
    )
    milestone_id = str(only_milestone(project_id)["_id"])

    assert isinstance(milestone_service.get(project_id, editor["_id"]), list)
    assert (
        milestone_service.update(
            milestone_id, {"state": "closed"}, editor["_id"]
        )
        == "Milestone updated"
    )
    assert only_milestone(project_id)["state"] == "closed"
    assert milestone_service.remove(milestone_id, editor["_id"]) == "Milestone deleted"
    assert milestone_rows(project_id) == []


# ---------------------------------------------------------------------------
# Validation: name + state
# ---------------------------------------------------------------------------


def test_create_missing_or_empty_name_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # Empty string and wrong type both fail; missing key likewise.
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": ""}, manager["_id"]
        )
        == "Bad request"
    )
    assert (
        milestone_service.create(
            {"projectId": project_id, "name": 123}, manager["_id"]
        )
        == "Bad request"
    )
    assert (
        milestone_service.create({"projectId": project_id}, manager["_id"])
        == "Bad request"
    )
    assert milestone_rows(project_id) == []

    # The router pre-validates the required body -> 400 with the list envelope.
    response = client.post(
        "/api/v1/milestones/",
        json={"projectId": project_id, "name": ""},
        headers=auth_headers(manager["jwt"]),
    )
    assert response.status_code == 400, response.text


def test_create_with_bogus_state_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    assert (
        milestone_service.create(
            {"projectId": project_id, "name": "v1.0", "state": "bogus"},
            manager["_id"],
        )
        == "Bad request"
    )
    assert milestone_rows(project_id) == []

    # Same through the HTTP layer -> 400.
    response = client.post(
        "/api/v1/milestones/",
        json={"projectId": project_id, "name": "v1.0", "state": "bogus"},
        headers=auth_headers(manager["jwt"]),
    )
    assert response.status_code == 400, response.text


def test_update_with_bogus_state_is_bad_request_valid_state_persists(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    milestone_service.create(
        {"projectId": project_id, "name": "v1.0"}, manager["_id"]
    )
    milestone_id = str(only_milestone(project_id)["_id"])

    # A bogus state is rejected and the stored state is left untouched.
    assert (
        milestone_service.update(
            milestone_id, {"state": "bogus"}, manager["_id"]
        )
        == "Bad request"
    )
    assert only_milestone(project_id)["state"] == "open"

    # A valid state transition succeeds and persists.
    assert (
        milestone_service.update(
            milestone_id, {"state": "closed"}, manager["_id"]
        )
        == "Milestone updated"
    )
    assert only_milestone(project_id)["state"] == "closed"


def test_update_empty_name_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    milestone_service.create(
        {"projectId": project_id, "name": "v1.0"}, manager["_id"]
    )
    milestone_id = str(only_milestone(project_id)["_id"])

    assert (
        milestone_service.update(
            milestone_id, {"name": ""}, manager["_id"]
        )
        == "Bad request"
    )
    # Unchanged.
    assert only_milestone(project_id)["name"] == "v1.0"


# ---------------------------------------------------------------------------
# Scoping: get(projectId) returns only that project's milestones
# ---------------------------------------------------------------------------


def test_get_is_scoped_to_its_project(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager = ctx["manager"]
    project_a = ctx["project_id"]
    project_b = create_project(manager["_id"], name="Second")

    milestone_service.create(
        {"projectId": project_a, "name": "A-one"}, manager["_id"]
    )
    milestone_service.create(
        {"projectId": project_a, "name": "A-two"}, manager["_id"]
    )
    milestone_service.create(
        {"projectId": project_b, "name": "B-one"}, manager["_id"]
    )

    listed_a = milestone_service.get(project_a, manager["_id"])
    listed_b = milestone_service.get(project_b, manager["_id"])
    assert isinstance(listed_a, list) and isinstance(listed_b, list)
    assert sorted(m["name"] for m in listed_a) == ["A-one", "A-two"]
    assert [m["name"] for m in listed_b] == ["B-one"]
    # Cross-project isolation: every returned row carries the queried id.
    assert all(m["projectId"] == project_a for m in listed_a)
    assert all(m["projectId"] == project_b for m in listed_b)


# ---------------------------------------------------------------------------
# Not-found: unknown project / unknown milestone id
# ---------------------------------------------------------------------------


def test_create_or_get_on_missing_project_is_not_found(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager = ctx["manager"]
    missing = "ffffffffffffffffffffffff"

    assert (
        milestone_service.create(
            {"projectId": missing, "name": "v1.0"}, manager["_id"]
        )
        == "Project not found"
    )
    assert milestone_service.get(missing, manager["_id"]) == "Project not found"


def test_update_or_remove_missing_milestone_is_none(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager = ctx["manager"]
    missing = "ffffffffffffffffffffffff"

    # A wholly-absent id (None) and an unknown id both map to None (router 404).
    assert milestone_service.update(missing, {"name": "x"}, manager["_id"]) is None
    assert milestone_service.update(None, {"name": "x"}, manager["_id"]) is None
    assert milestone_service.remove(missing, manager["_id"]) is None
    assert milestone_service.remove(None, manager["_id"]) is None

    # And through the HTTP layer -> 404 for an unknown id.
    headers = auth_headers(manager["jwt"])
    assert (
        client.put(
            "/api/v1/milestones/",
            json={"_id": missing, "name": "x"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/v1/milestones/?milestoneId={missing}", headers=headers
        ).status_code
        == 404
    )
