"""Dependency "move-to-done" gate tests (PRD work-management-depth §4.3 /
AC-W6).

Moving a task INTO a ``category=="done"`` column while it still has >=1
UNFINISHED prerequisite (a ``dependsOn`` task whose own column is not done)
is rejected with ``"Blocked by dependencies"`` (router -> 400) unless the
request carries ``force=True``. The gate is disable-able per project via the
``enforceDependencyGate`` flag (default ON when absent; only an explicit
``False`` disables it). It fires on BOTH ``PUT /tasks/orders`` (reorder) and
``PUT /tasks`` (update with a ``columnId`` change), and ONLY on a transition
INTO done -- a within-done reorder (source already done) is NOT gated.

These mirror the idioms in ``tests/test_task_completed_at.py`` /
``tests/test_task_dependencies.py``: real users / projects / seeded columns
come through the HTTP register-login-project-board helpers; done-ness is
exercised by flipping a column's persisted ``category`` to ``"done"``
directly on the store; ``dependsOn`` edges are seeded via the HTTP PUT
/tasks (its validation surface). The gate itself is then driven both
DIRECTLY against ``task_service.*`` (service sentinel) and over the HTTP
router (status code) against the in-memory ``FakeStore`` from
``conftest.py``.
"""

from typing import Any, Dict

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

    Done-ness reads from ``category`` directly (see ``board_service`` /
    ``be_tools``), so this is all the gate needs to treat the column as a
    done bucket; going through ``board_service.update`` would add an auth
    round-trip without changing what is persisted.
    """

    store.update_by_id(COLUMNS, column_id, {"category": category})


def stored_task(store: FakeStore, task_id: str) -> Dict[str, Any]:
    task = store.find_by_id(TASKS, task_id)
    assert task is not None
    return task


def make_task(
    user_id: str,
    project_id: str,
    column_id: str,
    **extra: Any,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": user_id,
        "taskName": "A task",
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return body


def named_task(
    store: FakeStore, project_id: str, name: str
) -> Dict[str, Any]:
    return next(
        task
        for task in store.find_many(TASKS, {"projectId": project_id})
        if task.get("taskName") == name
    )


def reorder_body(
    from_task: Dict[str, Any],
    from_column: Dict[str, Any],
    to_column: Dict[str, Any],
    **extra: Any,
) -> Dict[str, Any]:
    """A tail-append cross-column drag (no reference task) from one column
    to another -- the same shape ``test_task_completed_at`` uses to move a
    task into the done column."""

    body: Dict[str, Any] = {
        "type": "after",
        "fromId": str(from_task["_id"]),
        "referenceId": None,
        "fromColumnId": str(from_column["_id"]),
        "referenceColumnId": str(to_column["_id"]),
    }
    body.update(extra)
    return body


def update_body(
    task: Dict[str, Any],
    project_id: str,
    column_id: str,
    coordinator_id: str,
    **extra: Any,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "_id": str(task["_id"]),
        "projectId": project_id,
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "taskName": task["taskName"],
        "type": "Task",
        "storyPoints": 1,
    }
    body.update(extra)
    return body


def seed_blocked_with_prereq(
    client: TestClient,
    store: FakeStore,
    owner: Dict[str, Any],
    project_id: str,
    todo: Dict[str, Any],
    *,
    prereq_done: bool,
    done_column: Dict[str, Any],
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Create a ``Prereq`` task and a ``Blocked`` task that depends on it.

    Both start in the ``todo`` column. When ``prereq_done`` is True the
    prerequisite is then parked in ``done_column`` (whose category the
    caller already flipped to ``"done"``) so it counts as FINISHED. Returns
    ``(blocked, prereq)`` as stored docs.
    """

    task_service.create(
        make_task(owner["_id"], project_id, str(todo["_id"]), taskName="Prereq"),
        owner["_id"],
    )
    prereq = named_task(store, project_id, "Prereq")

    task_service.create(
        make_task(
            owner["_id"],
            project_id,
            str(todo["_id"]),
            taskName="Blocked",
            dependsOn=[str(prereq["_id"])],
        ),
        owner["_id"],
    )
    blocked = named_task(store, project_id, "Blocked")

    if prereq_done:
        # Park the prerequisite in the done column so it is FINISHED. Set the
        # columnId straight on the store -- we are exercising the gate, not the
        # prerequisite's own move path.
        store.update_by_id(TASKS, str(prereq["_id"]), {"columnId": str(done_column["_id"])})
        prereq = stored_task(store, str(prereq["_id"]))

    return stored_task(store, str(blocked["_id"])), prereq


# ---------------------------------------------------------------------------
# 1. reorder a task with an UNFINISHED prerequisite INTO a done column is
#    blocked -- service sentinel AND router 400.
# ---------------------------------------------------------------------------


def test_reorder_into_done_with_unfinished_prereq_blocked_service(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    # Dragging ``Blocked`` into the done column while its prerequisite is
    # still unfinished is gated.
    assert (
        task_service.reorder(
            reorder_body(blocked, todo, done), owner["_id"]
        )
        == "Blocked by dependencies"
    )
    # The rejected move left the task in its source column.
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(todo["_id"])


def test_reorder_into_done_with_unfinished_prereq_blocked_router(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    response = client.put(
        "/api/v1/tasks/orders",
        json=reorder_body(blocked, todo, done),
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"] == "Blocked by dependencies"


# ---------------------------------------------------------------------------
# 2. same reorder with ``force=True`` -> allowed.
# ---------------------------------------------------------------------------


def test_reorder_into_done_with_force_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    assert (
        task_service.reorder(
            reorder_body(blocked, todo, done, force=True), owner["_id"]
        )
        == "Task reordered"
    )
    moved = stored_task(store, str(blocked["_id"]))
    assert moved["columnId"] == str(done["_id"])
    # The L1 completedAt reconciliation still runs after a forced (non-gated)
    # move: the task is now in a done column, so it is stamped completed.
    assert moved["completedAt"] is not None


def test_reorder_into_done_with_force_allowed_router(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    response = client.put(
        "/api/v1/tasks/orders",
        json=reorder_body(blocked, todo, done, force=True),
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    assert response.json() == "Task reordered"


# ---------------------------------------------------------------------------
# 3. same reorder when the project disabled the gate -> allowed.
# ---------------------------------------------------------------------------


def test_reorder_into_done_with_gate_disabled_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    # Disable the gate for this project (explicit ``False``); the move is now
    # allowed even with an unfinished prerequisite and no ``force``.
    store.update_by_id(PROJECTS, project_id, {"enforceDependencyGate": False})

    assert (
        task_service.reorder(
            reorder_body(blocked, todo, done), owner["_id"]
        )
        == "Task reordered"
    )
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(done["_id"])


# ---------------------------------------------------------------------------
# 4. move a task whose prerequisites are ALL done -> allowed (not blocked).
# ---------------------------------------------------------------------------


def test_reorder_into_done_with_all_prereqs_done_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, prereq = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=True, done_column=done
    )
    # Sanity: the prerequisite genuinely sits in the done column now.
    assert prereq["columnId"] == str(done["_id"])

    assert (
        task_service.reorder(
            reorder_body(blocked, todo, done), owner["_id"]
        )
        == "Task reordered"
    )
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(done["_id"])


# ---------------------------------------------------------------------------
# 5. move a task with NO prerequisites into done -> allowed.
# ---------------------------------------------------------------------------


def test_reorder_into_done_with_no_prereqs_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    task_service.create(
        make_task(owner["_id"], project_id, str(todo["_id"]), taskName="Free"),
        owner["_id"],
    )
    free = named_task(store, project_id, "Free")
    # ``dependsOn`` defaults to ``[]`` on create -- nothing blocks the move.
    assert free["dependsOn"] == []

    assert (
        task_service.reorder(
            reorder_body(free, todo, done), owner["_id"]
        )
        == "Task reordered"
    )
    assert stored_task(store, str(free["_id"]))["columnId"] == str(done["_id"])


# ---------------------------------------------------------------------------
# 6. update changing columnId into a done column with an unfinished
#    prerequisite is blocked; with ``force=True`` it is allowed.
# ---------------------------------------------------------------------------


def test_update_into_done_with_unfinished_prereq_blocked(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    # PUT /tasks moving the task into done is gated (service sentinel).
    assert (
        task_service.update(
            update_body(blocked, project_id, str(done["_id"]), owner["_id"]),
            owner["_id"],
        )
        == "Blocked by dependencies"
    )
    refreshed = stored_task(store, str(blocked["_id"]))
    # The rejected update neither moved the task nor stamped completedAt.
    assert refreshed["columnId"] == str(todo["_id"])
    assert refreshed.get("completedAt") is None

    # Over the router the same update is a 400.
    response = client.put(
        "/api/v1/tasks/",
        json=update_body(blocked, project_id, str(done["_id"]), owner["_id"]),
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"] == "Blocked by dependencies"


def test_update_into_done_with_force_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    assert (
        task_service.update(
            update_body(
                blocked, project_id, str(done["_id"]), owner["_id"], force=True
            ),
            owner["_id"],
        )
        == "Task updated"
    )
    moved = stored_task(store, str(blocked["_id"]))
    assert moved["columnId"] == str(done["_id"])
    # ``force`` only skips the gate; the L1 completedAt logic still runs.
    assert moved["completedAt"] is not None


def test_update_into_done_honors_simultaneous_depends_on_change(
    client: TestClient, store: FakeStore
) -> None:
    """``effective_depends_on`` honors a ``dependsOn`` change in the SAME PUT.

    A task with no stored prerequisites that ALSO adds an unfinished
    prerequisite in the same move-into-done PUT is gated on the freshly-sent
    edge, not the stale (empty) stored one.
    """

    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    task_service.create(
        make_task(owner["_id"], project_id, str(todo["_id"]), taskName="Prereq"),
        owner["_id"],
    )
    prereq = named_task(store, project_id, "Prereq")
    task_service.create(
        make_task(owner["_id"], project_id, str(todo["_id"]), taskName="Mover"),
        owner["_id"],
    )
    mover = named_task(store, project_id, "Mover")
    assert mover["dependsOn"] == []

    # Same PUT: move into done AND add the unfinished prerequisite. The gate
    # reads the just-sent ``dependsOn`` and blocks.
    assert (
        task_service.update(
            update_body(
                mover,
                project_id,
                str(done["_id"]),
                owner["_id"],
                dependsOn=[str(prereq["_id"])],
            ),
            owner["_id"],
        )
        == "Blocked by dependencies"
    )
    refreshed = stored_task(store, str(mover["_id"]))
    # Rejected before the write: neither the move nor the new edge landed.
    assert refreshed["columnId"] == str(todo["_id"])
    assert refreshed["dependsOn"] == []


# ---------------------------------------------------------------------------
# 7. reorder WITHIN a done column (source already done) is NOT gated even
#    with an unfinished prerequisite.
# ---------------------------------------------------------------------------


def test_reorder_within_done_column_not_gated(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )
    # Seed a second task already in the done column to reorder against, and
    # park ``Blocked`` in the done column too (straight on the store -- we are
    # testing the within-done path, not the move-into-done path).
    task_service.create(
        make_task(owner["_id"], project_id, str(done["_id"]), taskName="Anchor"),
        owner["_id"],
    )
    anchor = named_task(store, project_id, "Anchor")
    store.update_by_id(TASKS, str(blocked["_id"]), {"columnId": str(done["_id"])})
    blocked = stored_task(store, str(blocked["_id"]))

    # A within-done reorder: source IS done, so the transition guard short
    # circuits and the gate does not fire even though the prerequisite is
    # still unfinished.
    assert (
        task_service.reorder(
            reorder_body(blocked, done, done, referenceId=str(anchor["_id"])),
            owner["_id"],
        )
        == "Task reordered"
    )


# ---------------------------------------------------------------------------
# 8. moving into a NON-done column with an unfinished prerequisite is NOT
#    gated.
# ---------------------------------------------------------------------------


def test_reorder_into_non_done_column_not_gated(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    in_progress = column_named(client, owner["jwt"], project_id, "In Progress")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    # Destination is "In Progress" (category != done) -> not a move-to-done,
    # so the gate is inert even with an unfinished prerequisite.
    assert (
        task_service.reorder(
            reorder_body(blocked, todo, in_progress), owner["_id"]
        )
        == "Task reordered"
    )
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(in_progress["_id"])


def test_update_into_non_done_column_not_gated(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    in_progress = column_named(client, owner["jwt"], project_id, "In Progress")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    assert (
        task_service.update(
            update_body(blocked, project_id, str(in_progress["_id"]), owner["_id"]),
            owner["_id"],
        )
        == "Task updated"
    )
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(in_progress["_id"])


# ---------------------------------------------------------------------------
# 9. ``enforceDependencyGate`` is togglable via PUT /projects by the manager
#    (persists; once ``False`` the gate no longer blocks) and is in
#    ``_PROJECT_UPDATE_FIELDS`` / writable.
# ---------------------------------------------------------------------------


def test_enforce_dependency_gate_in_update_fields() -> None:
    # The flag is allowlisted so a manager PUT body can write it.
    assert "enforceDependencyGate" in project_service._PROJECT_UPDATE_FIELDS


def test_manager_toggles_gate_via_put_projects(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    todo = column_named(client, owner["jwt"], project_id, "To Do")
    done = column_named(client, owner["jwt"], project_id, "Done")
    set_category(store, done["_id"], "done")

    blocked, _ = seed_blocked_with_prereq(
        client, store, owner, project_id, todo, prereq_done=False, done_column=done
    )

    # The manager disables the gate through the normal PUT /projects body.
    response = client.put(
        "/api/v1/projects/",
        json={"_id": project_id, "enforceDependencyGate": False},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    # It persisted on the project document.
    assert store.find_by_id(PROJECTS, project_id)["enforceDependencyGate"] is False

    # With the gate disabled the previously-blocked move now succeeds.
    assert (
        task_service.reorder(
            reorder_body(blocked, todo, done), owner["_id"]
        )
        == "Task reordered"
    )
    assert stored_task(store, str(blocked["_id"]))["columnId"] == str(done["_id"])

    # Re-enabling it (explicit ``True``) restores the block on a fresh mover.
    response = client.put(
        "/api/v1/projects/",
        json={"_id": project_id, "enforceDependencyGate": True},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    assert store.find_by_id(PROJECTS, project_id)["enforceDependencyGate"] is True


# ---------------------------------------------------------------------------
# 10. a non-manager member cannot toggle the flag (it is just a normal PUT
#     /projects field, and PUT /projects is manager-only).
# ---------------------------------------------------------------------------


def test_member_cannot_toggle_gate_via_put_projects(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    project_id = create_project(client, owner["jwt"])

    # Add the second user as an editor member of the project.
    response = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": member["_id"], "role": "editor"},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 201, response.text

    # A non-manager member's PUT /projects is forbidden -- the manager-only
    # gate already covers the flag, so no extra authz is needed for it.
    response = client.put(
        "/api/v1/projects/",
        json={"_id": project_id, "enforceDependencyGate": False},
        headers=auth_headers(member["jwt"]),
    )
    assert response.status_code == 403, response.text
    # The flag was not written.
    assert "enforceDependencyGate" not in store.find_by_id(PROJECTS, project_id)
