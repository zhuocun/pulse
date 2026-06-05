"""Project archive / trash (soft-delete) + restore lifecycle tests
(PRD work-management-depth §5.4/§5.5; AC-W9/W10/W11).

This is the project-level MIRROR of ``test_task_lifecycle.py``, but every
project lifecycle op is MANAGER-ONLY (gated on ``managerId``, not the
project RBAC ``can_access`` an editor would pass). DELETE /projects now
soft-deletes by default (stamps ``deletedAt`` and leaves the project's
columns + tasks intact so a ``restore`` is lossless); ``?purge=true`` keeps
the legacy hard cascade (delete the project + its columns + tasks).
Archiving stamps ``archivedAt``; both markers hide the project from the
default ``GET /projects`` LISTING and are cleared by ``restore``. A
direct-by-id read is never filtered, so the restore/archive flows can still
load a trashed/archived row.

Most cases drive the ``project_service`` functions DIRECTLY against the
in-memory ``FakeStore`` from ``conftest.py`` (the ``store`` fixture
monkeypatches the repository onto every service module). Real users come
through the HTTP register-login helper so every ``_id`` is a valid
ObjectId string that survives ``find_by_id``; projects are created through
the service (which seeds the default columns). A handful of router-level
cases exercise the new query params / endpoints through the real HTTP layer
via ``TestClient``. The timestamps themselves are opaque here -- we only
assert presence vs ``None`` and visibility in/out of the default listing.
"""

from typing import Any, Dict, List

from fastapi.testclient import TestClient

from app.database import COLUMNS, PROJECTS, TASKS
from app.services import project_service, task_service
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
# ``bootstrap`` so the small id helpers below can read the store positionally.
_STORE: FakeStore


def create_project(manager_id: str, name: str = "Pulse") -> str:
    """Create a project through the service (seeds default columns) and
    return its id (str). The manager is ``manager_id``."""

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


def first_column_id(project_id: str) -> str:
    """The seeded "To Do" column's id for ``project_id``."""

    columns = _STORE.find_many(COLUMNS, {"projectId": project_id})
    todo = next(column for column in columns if column["columnName"] == "To Do")
    return str(todo["_id"])


def create_task(manager_id: str, project_id: str, column_id: str) -> str:
    """Create one task through the service and return its id (str)."""

    assert (
        task_service.create(
            {
                "projectId": project_id,
                "columnId": column_id,
                "coordinatorId": manager_id,
                "taskName": "A task",
                "type": "Task",
                "storyPoints": 1,
            },
            manager_id,
        )
        == "Task created"
    )
    tasks = _STORE.find_many(TASKS, {"projectId": project_id})
    assert len(tasks) == 1, tasks
    return str(tasks[0]["_id"])


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


def stored_project(project_id: str) -> Dict[str, Any]:
    project = _STORE.find_by_id(PROJECTS, project_id)
    assert project is not None
    return project


def listed_ids(manager_id: str, **flags: bool) -> List[str]:
    """The ids ``project_service.get`` enumerates for ``manager_id`` (default
    listing unless ``include_trashed`` / ``include_archived`` flags widen it)."""

    result = project_service.get(None, None, None, viewer_id=manager_id, **flags)
    assert isinstance(result, list), result
    return [project["_id"] for project in result]


def bootstrap(client: TestClient, store: FakeStore) -> Dict[str, Any]:
    """Manager + project + seeded "To Do" column; wire the module store handle."""

    global _STORE
    _STORE = store
    manager = register_and_login(client, "manager", "manager@example.com")
    project_id = create_project(manager["_id"])
    column_id = first_column_id(project_id)
    return {"manager": manager, "project_id": project_id, "column_id": column_id}


# ---------------------------------------------------------------------------
# remove: soft delete by default, hard purge on demand
# ---------------------------------------------------------------------------


def test_remove_default_soft_deletes_and_keeps_children(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id, column_id = (
        ctx["manager"],
        ctx["project_id"],
        ctx["column_id"],
    )
    task_id = create_task(manager["_id"], project_id, column_id)

    assert project_service.remove(project_id, manager["_id"]) == "Project deleted"

    # The project row survives a soft delete; only ``deletedAt`` flips.
    project = stored_project(project_id)
    assert project.get("deletedAt") is not None
    assert project.get("archivedAt") is None
    # The cascade is deferred to ``purge`` -- the columns + tasks are intact
    # so a later ``restore`` brings the whole project back losslessly.
    assert store.find_many(TASKS, {"projectId": project_id}) != []
    assert store.find_by_id(TASKS, task_id) is not None
    assert store.find_many(COLUMNS, {"projectId": project_id}) != []


def test_remove_purge_hard_deletes_project_columns_and_tasks(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id, column_id = (
        ctx["manager"],
        ctx["project_id"],
        ctx["column_id"],
    )
    task_id = create_task(manager["_id"], project_id, column_id)

    assert (
        project_service.remove(project_id, manager["_id"], purge=True)
        == "Project deleted"
    )

    # The legacy hard cascade wipes the project plus all of its child rows.
    assert store.find_by_id(PROJECTS, project_id) is None
    assert store.find_by_id(TASKS, task_id) is None
    assert store.find_many(TASKS, {"projectId": project_id}) == []
    assert store.find_many(COLUMNS, {"projectId": project_id}) == []


# ---------------------------------------------------------------------------
# get listing: default-exclude trashed/archived, opt back in via flags
# ---------------------------------------------------------------------------


def test_soft_deleted_excluded_from_default_listing_included_with_flag(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    project_service.remove(project_id, manager["_id"])

    assert project_id not in listed_ids(manager["_id"])
    assert project_id in listed_ids(manager["_id"], include_trashed=True)
    # A direct-by-id read is never filtered, so the restore flow can load it.
    fetched = project_service.get(project_id, None, None, viewer_id=manager["_id"])
    assert isinstance(fetched, dict)
    assert fetched["_id"] == project_id


def test_archive_excluded_from_default_listing_included_with_flag(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    assert project_service.archive(project_id, manager["_id"], True) == "Project archived"
    assert stored_project(project_id).get("archivedAt") is not None

    assert project_id not in listed_ids(manager["_id"])
    assert project_id in listed_ids(manager["_id"], include_archived=True)


def test_archive_false_clears_archived_at(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    project_service.archive(project_id, manager["_id"], True)
    assert stored_project(project_id).get("archivedAt") is not None

    assert project_service.archive(project_id, manager["_id"], False) == "Project archived"
    assert stored_project(project_id).get("archivedAt") is None
    # Unarchiving puts it back in the default listing.
    assert project_id in listed_ids(manager["_id"])


def test_archive_non_bool_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # A non-bool ``archived`` is rejected -- but only AFTER existence/access
    # pass, and the stored marker is left untouched.
    assert project_service.archive(project_id, manager["_id"], "yes") == "Bad request"
    assert stored_project(project_id).get("archivedAt") is None


# ---------------------------------------------------------------------------
# restore: clears BOTH markers, project reappears in the listing
# ---------------------------------------------------------------------------


def test_restore_clears_trash_and_archive_and_reappears(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # Stamp BOTH markers so restore has to clear each one.
    project_service.archive(project_id, manager["_id"], True)
    project_service.remove(project_id, manager["_id"])
    assert stored_project(project_id).get("archivedAt") is not None
    assert stored_project(project_id).get("deletedAt") is not None
    assert project_id not in listed_ids(manager["_id"])

    assert project_service.restore(project_id, manager["_id"]) == "Project restored"
    refreshed = stored_project(project_id)
    assert refreshed.get("deletedAt") is None
    assert refreshed.get("archivedAt") is None
    # All the way back into the active listing in one step.
    assert project_id in listed_ids(manager["_id"])


# ---------------------------------------------------------------------------
# Missing id -> "Project not found" (router 404); remove(None) -> "Bad request"
# ---------------------------------------------------------------------------


def test_lifecycle_ops_on_missing_id_return_not_found(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager = ctx["manager"]
    missing = "ffffffffffffffffffffffff"

    assert project_service.remove(missing, manager["_id"]) == "Project not found"
    assert project_service.restore(missing, manager["_id"]) == "Project not found"
    assert (
        project_service.archive(missing, manager["_id"], True) == "Project not found"
    )
    # A wholly absent id (None) is likewise not-found on restore/archive; the
    # remove path maps None -> the dedicated "Bad request" (400) instead.
    assert project_service.remove(None, manager["_id"]) == "Bad request"
    assert project_service.restore(None, manager["_id"]) == "Project not found"
    assert project_service.archive(None, manager["_id"], True) == "Project not found"


# ---------------------------------------------------------------------------
# Access: a NON-manager member (even an editor) is forbidden (manager-only)
# ---------------------------------------------------------------------------


def test_non_manager_member_forbidden_on_remove_restore_archive(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # An editor passes the project RBAC ``can_access`` gate, but project
    # lifecycle ops are MANAGER-ONLY -- so the editor is still Forbidden.
    editor = register_and_login(client, "editor", "editor@example.com")
    add_member(client, manager["jwt"], project_id, editor["_id"], "editor")

    assert project_service.remove(project_id, editor["_id"]) == "Forbidden"
    assert project_service.restore(project_id, editor["_id"]) == "Forbidden"
    assert project_service.archive(project_id, editor["_id"], True) == "Forbidden"
    # A non-manager's forbidden archive must not even reach body validation --
    # a non-bool flag still yields Forbidden, not Bad request (no probing).
    assert project_service.archive(project_id, editor["_id"], "yes") == "Forbidden"

    # Strictly stronger: an OWNER-role member also passes ``can_access(OWNER)``
    # yet is NOT the project manager, so a managerId gate (rather than a
    # ``can_access(OWNER)`` check) must still Forbid them on every lifecycle
    # op -- this is what distinguishes manager-only from owner-level RBAC.
    coowner = register_and_login(client, "coowner", "coowner@example.com")
    add_member(client, manager["jwt"], project_id, coowner["_id"], "owner")
    assert project_service.remove(project_id, coowner["_id"]) == "Forbidden"
    assert project_service.restore(project_id, coowner["_id"]) == "Forbidden"
    assert project_service.archive(project_id, coowner["_id"], True) == "Forbidden"

    # None of these touched the project.
    assert stored_project(project_id).get("deletedAt") is None
    assert stored_project(project_id).get("archivedAt") is None


# ---------------------------------------------------------------------------
# Router: query params + new endpoints through the real HTTP layer
# ---------------------------------------------------------------------------


def test_router_delete_soft_then_restore_archive_then_purge(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id, column_id = (
        ctx["manager"],
        ctx["project_id"],
        ctx["column_id"],
    )
    headers = auth_headers(manager["jwt"])
    create_task(manager["_id"], project_id, column_id)

    # Default DELETE soft-deletes: 200 "Project deleted", row still present,
    # hidden from the default listing but visible with includeTrashed=true.
    deleted = client.delete(
        f"/api/v1/projects/?projectId={project_id}", headers=headers
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == "Project deleted"
    assert store.find_by_id(PROJECTS, project_id) is not None

    default_listing = client.get("/api/v1/projects/", headers=headers).json()
    assert project_id not in {project["_id"] for project in default_listing}

    trashed_listing = client.get(
        "/api/v1/projects/?includeTrashed=true", headers=headers
    ).json()
    assert project_id in {project["_id"] for project in trashed_listing}

    # PUT /restore brings it back into the default listing.
    restored = client.put(
        "/api/v1/projects/restore", json={"projectId": project_id}, headers=headers
    )
    assert restored.status_code == 200, restored.text
    assert restored.json() == "Project restored"
    back = client.get("/api/v1/projects/", headers=headers).json()
    assert project_id in {project["_id"] for project in back}

    # PUT /archive hides it from the default listing; includeArchived re-shows.
    archived = client.put(
        "/api/v1/projects/archive",
        json={"projectId": project_id, "archived": True},
        headers=headers,
    )
    assert archived.status_code == 200, archived.text
    assert archived.json() == "Project archived"
    default_after_archive = client.get("/api/v1/projects/", headers=headers).json()
    assert project_id not in {project["_id"] for project in default_after_archive}
    archived_listing = client.get(
        "/api/v1/projects/?includeArchived=true", headers=headers
    ).json()
    assert project_id in {project["_id"] for project in archived_listing}

    # ``?purge=true`` hard-deletes: the row (and its children) finally go.
    purged = client.delete(
        f"/api/v1/projects/?projectId={project_id}&purge=true", headers=headers
    )
    assert purged.status_code == 200, purged.text
    assert purged.json() == "Project deleted"
    assert store.find_by_id(PROJECTS, project_id) is None
    assert store.find_many(COLUMNS, {"projectId": project_id}) == []
    assert store.find_many(TASKS, {"projectId": project_id}) == []


def test_router_restore_and_archive_missing_and_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]
    headers = auth_headers(manager["jwt"])
    missing = "ffffffffffffffffffffffff"

    # Missing ids 404 on both new endpoints.
    assert (
        client.put(
            "/api/v1/projects/restore", json={"projectId": missing}, headers=headers
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/api/v1/projects/archive",
            json={"projectId": missing, "archived": True},
            headers=headers,
        ).status_code
        == 404
    )

    # A non-bool ``archived`` on an existing project is a 400 Bad request.
    bad = client.put(
        "/api/v1/projects/archive",
        json={"projectId": project_id, "archived": "yes"},
        headers=headers,
    )
    assert bad.status_code == 400, bad.text
    assert bad.json() == {"error": "Bad request"}


def test_router_non_manager_forbidden_on_restore_and_archive(
    client: TestClient, store: FakeStore
) -> None:
    ctx = bootstrap(client, store)
    manager, project_id = ctx["manager"], ctx["project_id"]

    # An editor member is below the manager-only gate on the new endpoints.
    editor = register_and_login(client, "editor", "editor@example.com")
    add_member(client, manager["jwt"], project_id, editor["_id"], "editor")
    editor_headers = auth_headers(editor["jwt"])

    assert (
        client.put(
            "/api/v1/projects/restore",
            json={"projectId": project_id},
            headers=editor_headers,
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/v1/projects/archive",
            json={"projectId": project_id, "archived": True},
            headers=editor_headers,
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/projects/?projectId={project_id}", headers=editor_headers
        ).status_code
        == 403
    )
