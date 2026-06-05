"""Derived ``blockedBy`` read-signal tests (PRD work-management-depth
§4.2/§4.5 / AC-W4).

``blockedBy`` is a COMPUTED-ON-READ field added to every task in the
``GET /tasks`` response: the subset of the task's stored ``dependsOn`` whose
prerequisites are still UNFINISHED -- the ids that resolve to an in-project
task whose own column has ``category != "done"``. A task is "blocked" iff its
``blockedBy`` is non-empty (this powers the §4.5 blocked badge). It is DERIVED,
not stored (mirroring ``board_service``'s computed ``isDone``): it is NOT part
of ``TABLE_FIELDS[TASKS]`` and never persisted.

Its done-resolution and dangling-skip match the move-to-done gate
(``task_service._dependency_gate_blocks``) so the badge and the gate agree: a
prerequisite in a done column does not block, and a ``dependsOn`` id that no
longer resolves to a project task (dangling) is skipped, never counted.

These mirror the idioms in ``tests/test_task_dependencies.py`` /
``tests/test_dependency_gate.py``: real users / projects / seeded columns come
through the HTTP register-login-project-board helpers; ``dependsOn`` edges are
seeded via the HTTP PUT /tasks (its validation surface); done-ness is exercised
by flipping a column's persisted ``category`` to ``"done"`` straight on the
store; a dangling prerequisite is produced by a hard-purge (DELETE
``?purge=true``). The signal is then read both DIRECTLY off
``task_service.get`` and over the HTTP ``GET /api/v1/tasks/`` against the
in-memory ``FakeStore`` from ``conftest.py``.
"""

from typing import Any, Dict, List

from fastapi.testclient import TestClient

from app.database import COLUMNS, TASKS
from app.services import task_service
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


def create_project(client: TestClient, token: str, name: str = "Pulse") -> str:
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


def column_named(
    client: TestClient, token: str, project_id: str, column_name: str
) -> Dict[str, Any]:
    columns = client.get(
        f"/api/v1/boards/?projectId={project_id}", headers=auth_headers(token)
    ).json()
    return next(column for column in columns if column["columnName"] == column_name)


def set_category(store: FakeStore, column_id: str, category: str) -> None:
    """Flip a column's persisted ``category`` straight on the store.

    Done-ness reads from ``category`` directly (consistent with the gate and
    ``board_service``), so this is all the read-signal needs to treat the
    column as a done bucket; ``board_service.update`` would only add an auth
    round-trip without changing what is persisted.
    """

    store.update_by_id(COLUMNS, column_id, {"category": category})


def create_task(
    client: TestClient,
    token: str,
    project_id: str,
    column_id: str,
    coordinator_id: str,
    **extra: Any,
) -> Any:
    body: Dict[str, Any] = {
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "taskName": "A task",
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return client.post("/api/v1/tasks/", json=body, headers=auth_headers(token))


def http_tasks(client: TestClient, token: str, project_id: str) -> List[Dict[str, Any]]:
    return client.get(
        f"/api/v1/tasks/?projectId={project_id}", headers=auth_headers(token)
    ).json()


def update_task(
    client: TestClient,
    token: str,
    task: Dict[str, Any],
    project_id: str,
    column_id: str,
    coordinator_id: str,
    **extra: Any,
) -> Any:
    """PUT /tasks with the routing/identity fields the update path requires;
    ``extra`` carries the field(s) under test (e.g. ``dependsOn``)."""

    body: Dict[str, Any] = {
        "_id": task["_id"],
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "taskName": task["taskName"],
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return client.put("/api/v1/tasks/", json=body, headers=auth_headers(token))


def service_task(
    project_id: str, user_id: str, name: str
) -> Dict[str, Any]:
    """A single named task read straight off ``task_service.get`` (so the
    assertion sees the derived ``blockedBy``, not the stored doc)."""

    tasks = task_service.get(project_id, user_id)
    assert isinstance(tasks, list), tasks
    return next(task for task in tasks if task["taskName"] == name)


def seed_prereq_and_blocked(
    client: TestClient,
    token: str,
    user_id: str,
    project_id: str,
    todo_column_id: str,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Create ``Prereq`` and ``Blocked`` (depends on ``Prereq``); both start in
    the ``To Do`` column. Returns the freshly-read ``(blocked, prereq)``."""

    assert (
        create_task(
            client, token, project_id, todo_column_id, user_id, taskName="Prereq"
        ).status_code
        == 201
    )
    prereq = service_task(project_id, user_id, "Prereq")

    assert (
        create_task(
            client,
            token,
            project_id,
            todo_column_id,
            user_id,
            taskName="Blocked",
            dependsOn=[prereq["_id"]],
        ).status_code
        == 201
    )
    blocked = service_task(project_id, user_id, "Blocked")
    return blocked, prereq


# ---------------------------------------------------------------------------
# 1. an UNFINISHED prerequisite (in a non-done column) -> blockedBy == [prereq]
# ---------------------------------------------------------------------------


def test_unfinished_prerequisite_is_reported_blocked(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    _, prereq = seed_prereq_and_blocked(
        client, owner["jwt"], owner["_id"], project_id, todo["_id"]
    )

    # ``Prereq`` sits in "To Do" (category != done) -> it is an unfinished
    # prerequisite, so ``Blocked.blockedBy`` lists exactly its id.
    blocked = service_task(project_id, owner["_id"], "Blocked")
    assert blocked["blockedBy"] == [prereq["_id"]]


# ---------------------------------------------------------------------------
# 2. the SAME task once the prerequisite's column is flipped to done ->
#    blockedBy == [] (a finished prerequisite no longer blocks).
# ---------------------------------------------------------------------------


def test_finished_prerequisite_no_longer_blocks(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    _, prereq = seed_prereq_and_blocked(
        client, owner["jwt"], owner["_id"], project_id, todo["_id"]
    )

    # While unfinished it blocks...
    assert service_task(project_id, owner["_id"], "Blocked")["blockedBy"] == [
        prereq["_id"]
    ]

    # ...flip the prerequisite's column to done (it never moved columns, so the
    # whole "To Do" column going done finishes it) and the signal clears.
    set_category(store, todo["_id"], "done")
    assert service_task(project_id, owner["_id"], "Blocked")["blockedBy"] == []


# ---------------------------------------------------------------------------
# 3. a task with NO dependsOn -> blockedBy == []
# ---------------------------------------------------------------------------


def test_task_without_depends_on_has_empty_blocked_by(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    assert (
        create_task(
            client, owner["jwt"], project_id, todo["_id"], owner["_id"], taskName="Free"
        ).status_code
        == 201
    )

    free = service_task(project_id, owner["_id"], "Free")
    # ``dependsOn`` defaults to ``[]`` on create -> nothing can block it.
    assert free["dependsOn"] == []
    assert free["blockedBy"] == []


# ---------------------------------------------------------------------------
# 4. a DANGLING prerequisite (the prereq was hard-purged) -> blockedBy == []
#    (a dangling id is skipped, never counted -- same as the gate).
# ---------------------------------------------------------------------------


def test_dangling_prerequisite_is_skipped(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")

    blocked, prereq = seed_prereq_and_blocked(
        client, owner["jwt"], owner["_id"], project_id, todo["_id"]
    )
    # Precondition: the unfinished prerequisite blocks before it is purged.
    assert service_task(project_id, owner["_id"], "Blocked")["blockedBy"] == [
        prereq["_id"]
    ]

    # Hard-purge the prerequisite so its id dangles in ``Blocked.dependsOn``.
    response = client.delete(
        f"/api/v1/tasks/?taskId={prereq['_id']}&purge=true",
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    assert store.find_by_id(TASKS, str(prereq["_id"])) is None

    refreshed = service_task(project_id, owner["_id"], "Blocked")
    # The stale edge is still stored, but it no longer resolves to a project
    # task, so the read-signal skips it: not blocked.
    assert refreshed["dependsOn"] == [prereq["_id"]]
    assert refreshed["blockedBy"] == []


# ---------------------------------------------------------------------------
# 5. MIXED prerequisites (one in a done column, one not) -> blockedBy contains
#    only the unfinished id.
# ---------------------------------------------------------------------------


def test_mixed_prerequisites_reports_only_unfinished(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    in_progress = column_named(client, owner["jwt"], project_id, "In Progress")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    # ``DonePrereq`` lives in the done column (finished); ``OpenPrereq`` lives
    # in "In Progress" (a non-done column -> unfinished).
    assert (
        create_task(
            client, owner["jwt"], project_id, done["_id"], owner["_id"],
            taskName="DonePrereq",
        ).status_code
        == 201
    )
    assert (
        create_task(
            client, owner["jwt"], project_id, in_progress["_id"], owner["_id"],
            taskName="OpenPrereq",
        ).status_code
        == 201
    )
    done_prereq = service_task(project_id, owner["_id"], "DonePrereq")
    open_prereq = service_task(project_id, owner["_id"], "OpenPrereq")

    assert (
        create_task(
            client, owner["jwt"], project_id, todo["_id"], owner["_id"],
            taskName="Blocked",
        ).status_code
        == 201
    )
    blocked = service_task(project_id, owner["_id"], "Blocked")
    assert (
        update_task(
            client, owner["jwt"], blocked, project_id, todo["_id"], owner["_id"],
            dependsOn=[done_prereq["_id"], open_prereq["_id"]],
        ).status_code
        == 200
    )

    refreshed = service_task(project_id, owner["_id"], "Blocked")
    # Both edges are stored, but only the unfinished one is reported as blocking.
    assert refreshed["dependsOn"] == [done_prereq["_id"], open_prereq["_id"]]
    assert refreshed["blockedBy"] == [open_prereq["_id"]]


# ---------------------------------------------------------------------------
# 6. blockedBy is present on EVERY task in the GET /tasks response (the derived
#    key is additive and uniform) -- asserted over the HTTP router.
# ---------------------------------------------------------------------------


def test_blocked_by_present_on_every_task_over_http(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    # A blocked task (unfinished prereq), a finished prereq, and a free task --
    # so the response mixes blocked and unblocked rows.
    blocked, _ = seed_prereq_and_blocked(
        client, owner["jwt"], owner["_id"], project_id, todo["_id"]
    )
    assert (
        create_task(
            client, owner["jwt"], project_id, todo["_id"], owner["_id"], taskName="Free"
        ).status_code
        == 201
    )

    tasks = http_tasks(client, owner["jwt"], project_id)
    assert len(tasks) == 3
    # Every serialized task carries the derived key...
    for task in tasks:
        assert "blockedBy" in task
        assert isinstance(task["blockedBy"], list)
    # ...and at least one row is genuinely blocked (so the assertion is not
    # vacuous): ``Blocked``'s signal is non-empty, the free task's is empty.
    by_name = {task["taskName"]: task for task in tasks}
    assert by_name["Blocked"]["blockedBy"] != []
    assert by_name["Free"]["blockedBy"] == []
