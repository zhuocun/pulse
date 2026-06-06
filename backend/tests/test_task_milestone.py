"""Task -> milestone assignment tests (``task.milestoneId``).

``milestoneId`` is an OPTIONAL scalar FK on a task onto the project-scoped
``milestones`` collection. It is validated by ``task_service._milestone_error``
(mirroring ``_parent_task_error``): present-only, clearing (``None`` / ``""``)
is always allowed, and a non-empty value must reference a milestone that EXISTS
in the SAME project as the task. It is settable via POST/PUT /tasks but
deliberately EXCLUDED from the fan-out bulk edit (``_BULK_CHANGE_FIELDS``) --
bulk milestone assignment is a follow-up. Deleting a milestone NULLs the FK on
every task that referenced it (``milestone_service.remove`` cascade) so no task
is left pointing at a deleted row.

The harness mirrors the two neighbouring suites: real
users/projects/seeded-columns + the create/update *validation surfacing* come
through the HTTP register-login-project-board helpers from
``test_task_dependencies.py`` (a cross-project / non-existent ``milestoneId`` is
a 400), while milestones themselves and the delete-cascade are driven through
``milestone_service.*`` directly against the in-memory ``FakeStore`` from
``conftest.py`` (the ``store`` fixture monkeypatches the repository onto every
service module), the way ``test_milestones.py`` does.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import MILESTONES, TASKS
from app.services import milestone_service, task_service
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

    ``extra`` carries the field(s) under test (e.g. ``milestoneId``); the
    update path needs a resolvable project/column/coordinator to reach the
    ``_milestone_error`` check.
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


def named_task(
    client: TestClient, token: str, project_id: str, name: str
) -> Dict[str, Any]:
    return next(
        task
        for task in get_tasks(client, token, project_id)
        if task["taskName"] == name
    )


def create_milestone(
    store: FakeStore, project_id: str, owner_id: str, name: str = "v1.0"
) -> str:
    """Create a milestone via the service and return its id (str).

    Driven through ``milestone_service`` directly against the FakeStore (the
    milestone CRUD itself is covered by ``test_milestones.py``); we only need
    a real, in-project milestone ``_id`` to point a task at.
    """

    assert (
        milestone_service.create(
            {"projectId": project_id, "name": name}, owner_id
        )
        == "Milestone created"
    )
    rows = [
        row
        for row in store.find_many(MILESTONES, {"projectId": project_id})
        if row.get("name") == name
    ]
    assert len(rows) == 1, rows
    return str(rows[0]["_id"])


# ---------------------------------------------------------------------------
# 1. Assign on create: a same-project milestone is accepted + persisted
# ---------------------------------------------------------------------------


def test_assign_milestone_on_create_persists(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_id = create_milestone(store, project_id, owner["_id"])

    response = create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        taskName="Assigned",
        milestoneId=milestone_id,
    )
    assert response.status_code == 201, response.text

    task = named_task(client, owner["jwt"], project_id, "Assigned")
    assert task["milestoneId"] == milestone_id
    # And it persists at the store layer, not just on serialized read.
    stored = store.find_by_id(TASKS, task["_id"])
    assert stored is not None and stored["milestoneId"] == milestone_id


# ---------------------------------------------------------------------------
# 2. Assign on update: a task created without a milestone gets one via PUT
# ---------------------------------------------------------------------------


def test_assign_milestone_on_update_persists(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_id = create_milestone(store, project_id, owner["_id"])

    create_task(client, owner["jwt"], project_id, column["_id"], owner["_id"])
    task = get_tasks(client, owner["jwt"], project_id)[0]

    response = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        milestoneId=milestone_id,
    )
    assert response.status_code == 200, response.text
    assert get_tasks(client, owner["jwt"], project_id)[0]["milestoneId"] == (
        milestone_id
    )


# ---------------------------------------------------------------------------
# 3. Same-project enforcement: cross-project + non-existent are rejected
# ---------------------------------------------------------------------------


def test_cross_project_milestone_rejected_on_create(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_a = create_project(client, owner["jwt"], name="A")
    project_b = create_project(client, owner["jwt"], name="B")
    column_b = first_column(client, owner["jwt"], project_b)
    # The milestone lives in project A.
    milestone_in_a = create_milestone(store, project_a, owner["_id"])

    # A task in project B cannot be assigned a milestone from project A.
    response = create_task(
        client,
        owner["jwt"],
        project_b,
        column_b["_id"],
        owner["_id"],
        taskName="Cross",
        milestoneId=milestone_in_a,
    )
    assert response.status_code == 400, response.text
    # The error envelope surfaces the same-project message on ``milestoneId``.
    error = response.json()["error"]
    assert any(
        item.get("param") == "milestoneId"
        and item.get("msg") == "Milestone must exist in the same project"
        for item in error
    ), error
    # Nothing was created: no task in project B carries the rejected
    # cross-project FK. (Asserted at the store layer rather than via GET, which
    # would auto-seed a default task into the otherwise-empty project.)
    assert store.find_many(TASKS, {"milestoneId": milestone_in_a}) == []
    assert store.find_many(TASKS, {"projectId": project_b}) == []


def test_cross_project_milestone_rejected_on_update(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_a = create_project(client, owner["jwt"], name="A")
    project_b = create_project(client, owner["jwt"], name="B")
    column_b = first_column(client, owner["jwt"], project_b)
    milestone_in_a = create_milestone(store, project_a, owner["_id"])

    create_task(client, owner["jwt"], project_b, column_b["_id"], owner["_id"])
    task_in_b = get_tasks(client, owner["jwt"], project_b)[0]

    response = update_task(
        client,
        owner["jwt"],
        task_in_b,
        project_b,
        column_b["_id"],
        owner["_id"],
        milestoneId=milestone_in_a,
    )
    assert response.status_code == 400, response.text
    # The rejected update did not write the cross-project FK.
    assert get_tasks(client, owner["jwt"], project_b)[0].get("milestoneId") in (
        None,
        "",
    )


def test_nonexistent_milestone_rejected_on_create(
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
        milestoneId="ffffffffffffffffffffffff",
    )
    assert response.status_code == 400, response.text


def test_nonexistent_milestone_rejected_on_update(
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
        milestoneId="ffffffffffffffffffffffff",
    )
    assert response.status_code == 400, response.text
    assert get_tasks(client, owner["jwt"], project_id)[0].get("milestoneId") in (
        None,
        "",
    )


# ---------------------------------------------------------------------------
# 4. Clearing is always allowed: None and "" pass with no validation error
# ---------------------------------------------------------------------------


def test_clearing_milestone_is_allowed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_id = create_milestone(store, project_id, owner["_id"])

    # Assign first so there is a concrete value to clear.
    create_task(
        client,
        owner["jwt"],
        project_id,
        column["_id"],
        owner["_id"],
        milestoneId=milestone_id,
    )
    task = get_tasks(client, owner["jwt"], project_id)[0]
    assert task["milestoneId"] == milestone_id

    # Clear with ``None`` -- always allowed, no validation error, FK nulled.
    cleared_null = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        milestoneId=None,
    )
    assert cleared_null.status_code == 200, cleared_null.text
    assert get_tasks(client, owner["jwt"], project_id)[0]["milestoneId"] is None

    # Re-assign, then clear with the empty string -- also always allowed.
    update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        milestoneId=milestone_id,
    )
    cleared_empty = update_task(
        client,
        owner["jwt"],
        task,
        project_id,
        column["_id"],
        owner["_id"],
        milestoneId="",
    )
    assert cleared_empty.status_code == 200, cleared_empty.text
    # The empty string is accepted (no validation error) and stored verbatim by
    # the update allowlist filter -- either falsy form leaves the task cleared.
    assert get_tasks(client, owner["jwt"], project_id)[0]["milestoneId"] in (None, "")


def test_milestone_error_helper_is_present_only(
    client: TestClient, store: FakeStore
) -> None:
    """Direct unit check on the validator's present-only / clear contract.

    Mirrors ``test_depends_on_error_helper_is_present_only``: when the
    ``milestoneId`` key is absent the validator is a no-op, and clearing
    (``None`` / ``""``) is always allowed -- both return ``None`` regardless
    of project context. A non-existent id surfaces a single ``body_error``
    dict carrying ``param == "milestoneId"``.
    """

    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])

    # Key absent -> None (no validation runs).
    assert task_service._milestone_error({}, project_id) is None
    # Clearing sentinels -> None (always allowed).
    assert task_service._milestone_error({"milestoneId": None}, project_id) is None
    assert task_service._milestone_error({"milestoneId": ""}, project_id) is None
    # An unknown id -> a single body-error dict on ``milestoneId``.
    error = task_service._milestone_error(
        {"milestoneId": "ffffffffffffffffffffffff"}, project_id
    )
    assert error is not None
    assert error["param"] == "milestoneId"
    assert error["msg"] == "Milestone must exist in the same project"


# ---------------------------------------------------------------------------
# 5. Delete-cascade: remove() NULLs milestoneId on every referencing task
# ---------------------------------------------------------------------------


def test_remove_milestone_nulls_referencing_tasks(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_id = create_milestone(store, project_id, owner["_id"])

    # Two tasks both assigned to the same milestone.
    for name in ("First", "Second"):
        assert (
            create_task(
                client,
                owner["jwt"],
                project_id,
                column["_id"],
                owner["_id"],
                taskName=name,
                milestoneId=milestone_id,
            ).status_code
            == 201
        )
    first = named_task(client, owner["jwt"], project_id, "First")
    second = named_task(client, owner["jwt"], project_id, "Second")
    assert first["milestoneId"] == milestone_id
    assert second["milestoneId"] == milestone_id

    # Delete the milestone: the FK-null cascade fires.
    assert (
        milestone_service.remove(milestone_id, owner["_id"]) == "Milestone deleted"
    )

    # The milestone row is gone...
    assert store.find_by_id(MILESTONES, milestone_id) is None
    assert store.find_many(MILESTONES, {"projectId": project_id}) == []
    # ...and BOTH tasks now point at no milestone (FK nulled, not deleted).
    assert store.find_by_id(TASKS, first["_id"])["milestoneId"] is None
    assert store.find_by_id(TASKS, second["_id"])["milestoneId"] is None
    # The tasks themselves survive the cascade.
    refreshed = {
        task["taskName"]: task
        for task in get_tasks(client, owner["jwt"], project_id)
    }
    assert set(refreshed) == {"First", "Second"}
    assert refreshed["First"]["milestoneId"] is None
    assert refreshed["Second"]["milestoneId"] is None


def test_remove_milestone_leaves_other_milestone_assignments_intact(
    client: TestClient, store: FakeStore
) -> None:
    """The cascade is exact-match scoped: deleting milestone X must not touch a
    task assigned to a DIFFERENT milestone Y (guards against an over-broad
    ``find_many`` that would null unrelated FKs)."""

    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_x = create_milestone(store, project_id, owner["_id"], name="X")
    milestone_y = create_milestone(store, project_id, owner["_id"], name="Y")

    create_task(
        client, owner["jwt"], project_id, column["_id"], owner["_id"],
        taskName="OnX", milestoneId=milestone_x,
    )
    create_task(
        client, owner["jwt"], project_id, column["_id"], owner["_id"],
        taskName="OnY", milestoneId=milestone_y,
    )
    on_x = named_task(client, owner["jwt"], project_id, "OnX")
    on_y = named_task(client, owner["jwt"], project_id, "OnY")

    # Delete X only.
    assert milestone_service.remove(milestone_x, owner["_id"]) == "Milestone deleted"

    # The X-assigned task is nulled; the Y-assigned task is untouched.
    assert store.find_by_id(TASKS, on_x["_id"])["milestoneId"] is None
    assert store.find_by_id(TASKS, on_y["_id"])["milestoneId"] == milestone_y
    # Y itself still exists.
    assert store.find_by_id(MILESTONES, milestone_y) is not None


# ---------------------------------------------------------------------------
# 6. bulk_update drops ``milestoneId`` (excluded from _BULK_CHANGE_FIELDS)
# ---------------------------------------------------------------------------


def test_bulk_update_drops_milestone_id(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)
    milestone_id = create_milestone(store, project_id, owner["_id"])

    create_task(
        client, owner["jwt"], project_id, column["_id"], owner["_id"],
        taskName="Target",
    )
    target = named_task(client, owner["jwt"], project_id, "Target")

    # Bulk-change a benign field PLUS ``milestoneId``. ``milestoneId`` is
    # excluded from ``_BULK_CHANGE_FIELDS`` so it is silently dropped, while
    # the benign field still lands.
    response = client.put(
        "/api/v1/tasks/bulk",
        json={
            "taskIds": [target["_id"]],
            "changes": {
                "milestoneId": milestone_id,
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
    # ...but ``milestoneId`` was NOT fanned in by bulk: it keeps its create
    # default (unassigned), proving exclusion from _BULK_CHANGE_FIELDS.
    assert refreshed.get("milestoneId") in (None, "")
    # The store agrees -- the FK was never written by the bulk path.
    assert store.find_by_id(TASKS, target["_id"]).get("milestoneId") in (None, "")
