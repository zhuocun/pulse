"""Task dependency edge-list tests (``dependsOn``) -- PRD work-management-depth
§4.2 / AC-W4 / AC-W5.

``dependsOn`` is a stored ``list[str]`` of same-project prerequisite task ids
(the tasks a given task is blocked by). It is validated by
``task_service._depends_on_error`` to: be a list of strings, reference tasks
that EXIST in the SAME project, exclude the task ITSELF, and remain ACYCLIC --
it is a DAG of arbitrary depth, distinct from the one-level ``parentTaskId``
tree. It is settable via PUT /tasks but deliberately EXCLUDED from the fan-out
bulk edit (``_BULK_CHANGE_FIELDS``), because the same edge fanned across N
tasks could close a cycle for some and not others.

These mirror the idioms in ``tests/test_task_richness.py`` /
``tests/test_task_completed_at.py``: real users/projects/seeded columns come
through the HTTP register-login-project-board helpers, the create/update
*validation surfacing* is exercised over the HTTP router (where a bad
``dependsOn`` is a 400), and the stored shape, cycle guard and bulk exclusion
are asserted by driving ``task_service.*`` directly against the in-memory
``FakeStore`` from ``conftest.py``.

This slice covers the stored edge-list + validation only: there is no
move-to-done gate and no derived read field yet (those are the next slice).
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import TASKS
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


def get_tasks(client: TestClient, token: str, project_id: str) -> Any:
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
    """PUT /tasks with the routing/identity fields the update path requires.

    ``extra`` carries the field(s) under test (e.g. ``dependsOn``); the
    update path needs a resolvable project/column/coordinator to reach the
    ``_depends_on_error`` check.
    """

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


def named_task(client: TestClient, token: str, project_id: str, name: str) -> Dict[str, Any]:
    return next(
        task
        for task in get_tasks(client, token, project_id)
        if task["taskName"] == name
    )


# ---------------------------------------------------------------------------
# 1. Valid same-project dependsOn is stored; default create -> []
# ---------------------------------------------------------------------------


def test_create_with_valid_dependency_stores_list(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    assert (
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"],
            taskName="Prereq",
        ).status_code
        == 201
    )
    prereq = named_task(client, owner["jwt"], project_id, "Prereq")

    blocked = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        taskName="Blocked",
        dependsOn=[prereq["_id"]],
    )
    assert blocked.status_code == 201, blocked.text

    blocked_doc = named_task(client, owner["jwt"], project_id, "Blocked")
    assert blocked_doc["dependsOn"] == [prereq["_id"]]


def test_create_without_depends_on_defaults_to_empty(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    # A create that omits ``dependsOn`` lands the ``[]`` default so every
    # reader sees a uniform shape (AC-W4).
    assert (
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"]
        ).status_code
        == 201
    )
    task = get_tasks(client, owner["jwt"], project_id)[0]
    assert task["dependsOn"] == []


# ---------------------------------------------------------------------------
# 2. Non-existent dependency rejected (create + update)
# ---------------------------------------------------------------------------


def test_nonexistent_dependency_rejected_on_create(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    response = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        dependsOn=["ffffffffffffffffffffffff"],
    )
    assert response.status_code == 400, response.text


def test_nonexistent_dependency_rejected_on_update(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        dependsOn=["ffffffffffffffffffffffff"],
    )
    assert response.status_code == 400, response.text
    # The rejected update did not write the bad edge.
    assert get_tasks(client, owner["jwt"], project_id)[0]["dependsOn"] == []


# ---------------------------------------------------------------------------
# 3. Cross-project dependency rejected (create + update)
# ---------------------------------------------------------------------------


def test_cross_project_dependency_rejected_on_create(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_a = create_project(client, owner["jwt"], name="A")
    project_b = create_project(client, owner["jwt"], name="B")
    column_a = first_column(client, owner["jwt"], project_a)
    column_b = first_column(client, owner["jwt"], project_b)

    create_task(client, owner["jwt"], project_a, column_a["_id"], owner["_id"])
    task_in_a = get_tasks(client, owner["jwt"], project_a)[0]

    # A task in project B cannot depend on a task in project A.
    response = create_task(
        client,
        owner["jwt"],
        project_b,
        column_b["_id"],
        owner["_id"],
        taskName="Cross",
        dependsOn=[task_in_a["_id"]],
    )
    assert response.status_code == 400, response.text


def test_cross_project_dependency_rejected_on_update(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_a = create_project(client, owner["jwt"], name="A")
    project_b = create_project(client, owner["jwt"], name="B")
    column_a = first_column(client, owner["jwt"], project_a)
    column_b = first_column(client, owner["jwt"], project_b)

    create_task(client, owner["jwt"], project_a, column_a["_id"], owner["_id"])
    task_in_a = get_tasks(client, owner["jwt"], project_a)[0]
    create_task(client, owner["jwt"], project_b, column_b["_id"], owner["_id"])
    task_in_b = get_tasks(client, owner["jwt"], project_b)[0]

    response = update_task(
        client,
        owner["jwt"],
        task_in_b,
        project_b,
        column_b["_id"],
        owner["_id"],
        dependsOn=[task_in_a["_id"]],
    )
    assert response.status_code == 400, response.text


# ---------------------------------------------------------------------------
# 4. Self-dependency rejected on update
# ---------------------------------------------------------------------------


def test_self_dependency_rejected_on_update(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        dependsOn=[task["_id"]],
    )
    assert response.status_code == 400, response.text
    assert get_tasks(client, owner["jwt"], project_id)[0]["dependsOn"] == []


# ---------------------------------------------------------------------------
# 5. Cycle detection: 2-node back-edge and 3-node closing edge
# ---------------------------------------------------------------------------


def test_two_node_cycle_rejected(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="A")
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="B")
    task_a = named_task(client, owner["jwt"], project_id, "A")
    task_b = named_task(client, owner["jwt"], project_id, "B")

    # A depends on B -- a plain forward edge, accepted.
    ok = update_task(
        client, owner["jwt"], task_a, project_id, column["_id"], owner["_id"],
        dependsOn=[task_b["_id"]],
    )
    assert ok.status_code == 200, ok.text

    # B depends on A would close the cycle A -> B -> A: rejected.
    cyclic = update_task(
        client, owner["jwt"], task_b, project_id, column["_id"], owner["_id"],
        dependsOn=[task_a["_id"]],
    )
    assert cyclic.status_code == 400, cyclic.text
    # B's edge was not written.
    assert named_task(client, owner["jwt"], project_id, "B")["dependsOn"] == []
    # A's accepted edge is intact.
    assert named_task(client, owner["jwt"], project_id, "A")["dependsOn"] == [
        task_b["_id"]
    ]


def test_three_node_cycle_rejected(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    for name in ("A", "B", "C"):
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName=name
        )
    task_a = named_task(client, owner["jwt"], project_id, "A")
    task_b = named_task(client, owner["jwt"], project_id, "B")
    task_c = named_task(client, owner["jwt"], project_id, "C")

    # Build the chain A -> B -> C (each forward edge accepted).
    assert (
        update_task(
            client, owner["jwt"], task_a, project_id, column["_id"], owner["_id"],
            dependsOn=[task_b["_id"]],
        ).status_code
        == 200
    )
    assert (
        update_task(
            client, owner["jwt"], task_b, project_id, column["_id"], owner["_id"],
            dependsOn=[task_c["_id"]],
        ).status_code
        == 200
    )

    # C -> A closes the 3-node cycle A -> B -> C -> A: rejected (C already
    # transitively depends on A via the existing chain reached from A).
    cyclic = update_task(
        client, owner["jwt"], task_c, project_id, column["_id"], owner["_id"],
        dependsOn=[task_a["_id"]],
    )
    assert cyclic.status_code == 400, cyclic.text
    assert named_task(client, owner["jwt"], project_id, "C")["dependsOn"] == []


# ---------------------------------------------------------------------------
# 6. A valid non-cyclic chain A -> B -> C is accepted
# ---------------------------------------------------------------------------


def test_valid_non_cyclic_chain_accepted(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    for name in ("A", "B", "C"):
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName=name
        )
    task_a = named_task(client, owner["jwt"], project_id, "A")
    task_b = named_task(client, owner["jwt"], project_id, "B")
    task_c = named_task(client, owner["jwt"], project_id, "C")

    assert (
        update_task(
            client, owner["jwt"], task_a, project_id, column["_id"], owner["_id"],
            dependsOn=[task_b["_id"]],
        ).status_code
        == 200
    )
    assert (
        update_task(
            client, owner["jwt"], task_b, project_id, column["_id"], owner["_id"],
            dependsOn=[task_c["_id"]],
        ).status_code
        == 200
    )

    assert named_task(client, owner["jwt"], project_id, "A")["dependsOn"] == [
        task_b["_id"]
    ]
    assert named_task(client, owner["jwt"], project_id, "B")["dependsOn"] == [
        task_c["_id"]
    ]
    assert named_task(client, owner["jwt"], project_id, "C")["dependsOn"] == []


# ---------------------------------------------------------------------------
# 7. bulk_update drops ``dependsOn`` (excluded from _BULK_CHANGE_FIELDS)
# ---------------------------------------------------------------------------


def test_bulk_update_drops_depends_on(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Prereq")
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Other")
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Target")
    prereq = named_task(client, owner["jwt"], project_id, "Prereq")
    other = named_task(client, owner["jwt"], project_id, "Other")
    target = named_task(client, owner["jwt"], project_id, "Target")

    # Seed a real prerequisite edge on the target via the single-task path so
    # there is a concrete value the bulk edit must NOT overwrite.
    assert (
        update_task(
            client, owner["jwt"], target, project_id, column["_id"], owner["_id"],
            dependsOn=[prereq["_id"]],
        ).status_code
        == 200
    )

    # Bulk-change a benign field PLUS ``dependsOn`` (pointing at a different
    # task). ``dependsOn`` is excluded from ``_BULK_CHANGE_FIELDS`` so it is
    # silently dropped, while the benign field still lands.
    response = client.put(
        "/api/v1/tasks/bulk",
        json={
            "taskIds": [target["_id"]],
            "changes": {
                "dependsOn": [other["_id"]],
                "dueDate": "2026-08-15",
            },
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 200, response.text
    assert response.json() == "Tasks updated"

    refreshed = named_task(client, owner["jwt"], project_id, "Target")
    # The benign field was applied...
    assert refreshed["dueDate"] == "2026-08-15"
    # ...but ``dependsOn`` was NOT fanned in by bulk: it keeps the value set
    # by the single-task update, proving exclusion from _BULK_CHANGE_FIELDS.
    assert refreshed["dependsOn"] == [prereq["_id"]]


def test_bulk_update_with_only_depends_on_is_400(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Prereq")
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Target")
    prereq = named_task(client, owner["jwt"], project_id, "Prereq")
    target = named_task(client, owner["jwt"], project_id, "Target")

    # ``changes`` carrying only ``dependsOn`` filters down to empty (the key
    # is dropped), which the bulk path reports as a 400 -- there is nothing
    # left to apply.
    response = client.put(
        "/api/v1/tasks/bulk",
        json={"taskIds": [target["_id"]], "changes": {"dependsOn": [prereq["_id"]]}},
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 400, response.text
    assert named_task(client, owner["jwt"], project_id, "Target")["dependsOn"] == []


# ---------------------------------------------------------------------------
# 8. Replacing dependsOn with a new list works; [] clears it
# ---------------------------------------------------------------------------


def test_update_replaces_and_clears_depends_on(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    for name in ("P1", "P2", "Blocked"):
        create_task(
            client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName=name
        )
    prereq_1 = named_task(client, owner["jwt"], project_id, "P1")
    prereq_2 = named_task(client, owner["jwt"], project_id, "P2")
    blocked = named_task(client, owner["jwt"], project_id, "Blocked")

    # Set an initial single-prerequisite edge.
    assert (
        update_task(
            client, owner["jwt"], blocked, project_id, column["_id"], owner["_id"],
            dependsOn=[prereq_1["_id"]],
        ).status_code
        == 200
    )
    assert named_task(client, owner["jwt"], project_id, "Blocked")["dependsOn"] == [
        prereq_1["_id"]
    ]

    # Replace it wholesale with a different valid list (PUT replaces, it does
    # not merge).
    assert (
        update_task(
            client, owner["jwt"], blocked, project_id, column["_id"], owner["_id"],
            dependsOn=[prereq_2["_id"]],
        ).status_code
        == 200
    )
    assert named_task(client, owner["jwt"], project_id, "Blocked")["dependsOn"] == [
        prereq_2["_id"]
    ]

    # Replace with [] to clear all prerequisites.
    assert (
        update_task(
            client, owner["jwt"], blocked, project_id, column["_id"], owner["_id"],
            dependsOn=[],
        ).status_code
        == 200
    )
    assert named_task(client, owner["jwt"], project_id, "Blocked")["dependsOn"] == []


# ---------------------------------------------------------------------------
# Shape guard + service-level coverage of the non-list / non-string branch
# ---------------------------------------------------------------------------


def test_non_list_depends_on_rejected(client: TestClient, store: FakeStore) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    # A non-list value is a 400 on create (shape guard, mirrors labelIds).
    not_a_list = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        dependsOn="not-a-list",
    )
    assert not_a_list.status_code == 400, not_a_list.text

    # A list containing a non-string id is also rejected.
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]
    bad_item = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        dependsOn=[123],
    )
    assert bad_item.status_code == 400, bad_item.text


def test_depends_on_error_helper_is_present_only(
    client: TestClient, store: FakeStore
) -> None:
    """Direct unit check on the validator's present-only contract.

    Mirrors the other validators (``_priority_error`` / ``_parent_task_error``):
    when the ``dependsOn`` key is absent the validator is a no-op and returns
    ``None`` regardless of project/task context.
    """

    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    # Key absent -> None (no validation runs).
    assert task_service._depends_on_error({}, project_id, task["_id"]) is None
    # Empty list with a known task id -> valid (no edges to check).
    assert (
        task_service._depends_on_error(
            {"dependsOn": []}, project_id, task["_id"]
        )
        is None
    )
    # A valid self-referencing graph entry for the same id is reported as a
    # self-dependency body error (single dict, not a list).
    error = task_service._depends_on_error(
        {"dependsOn": [str(task["_id"])]}, project_id, str(task["_id"])
    )
    assert error is not None
    assert error["param"] == "dependsOn"


def test_store_layer_persists_depends_on_edge(
    client: TestClient, store: FakeStore
) -> None:
    """Confirm the edge persists at the store layer, not just on serialized read."""

    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Prereq")
    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"], taskName="Blocked")
    prereq = named_task(client, owner["jwt"], project_id, "Prereq")
    blocked = named_task(client, owner["jwt"], project_id, "Blocked")

    assert (
        update_task(
            client, owner["jwt"], blocked, project_id, column["_id"], owner["_id"],
            dependsOn=[prereq["_id"]],
        ).status_code
        == 200
    )

    stored = store.find_by_id(TASKS, blocked["_id"])
    assert stored is not None
    assert stored["dependsOn"] == [prereq["_id"]]
