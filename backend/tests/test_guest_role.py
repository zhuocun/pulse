"""``guest`` role (rank 0) tests — the membership tier below ``viewer``.

The collaboration RBAC model is an *ordered* role enum: a gate expressed
as ``min_role`` admits any role whose rank is >= the gate's rank. Adding
``guest`` at rank 0 (below ``viewer`` at 1) therefore needs no change to
``can_access`` or any endpoint gate — a guest simply falls below every
existing threshold. These tests pin that down: a guest is a *recorded
membership with no read or write right*. It persists in ``memberIds``,
yet it is admitted by no gate — not the viewer-gated reads/roster, the
editor-gated writes, nor the owner-gated member mutations.

End-to-end cases drive the real HTTP endpoints against the in-memory
``FakeStore``; the helpers are shared with ``tests/test_rbac.py`` so the
bootstrap stays identical to the rest of the membership matrix.
"""

from fastapi.testclient import TestClient

from app.database import PROJECTS
from app.services import project_service
from app.services.project_service import (
    ROLE_GUEST,
    ROLE_RANK,
    ROLE_VIEWER,
    can_access,
)
from tests.conftest import FakeStore
from tests.test_rbac import (
    auth_headers,
    create_project,
    create_task,
    first_column,
    register_and_login,
)


# ---------------------------------------------------------------------------
# Rank wiring
# ---------------------------------------------------------------------------


def test_guest_is_the_lowest_rank() -> None:
    # guest sits strictly below viewer, so it fails every gate that starts
    # at viewer or above — the property the rest of this file relies on.
    assert ROLE_RANK[ROLE_GUEST] == 0
    assert ROLE_RANK[ROLE_GUEST] < ROLE_RANK[ROLE_VIEWER]


def test_can_access_denies_guest_at_viewer_gate() -> None:
    # A guest membership entry does not satisfy the viewer (read) gate.
    project = {
        "_id": "p1",
        "managerId": "owner-1",
        "memberIds": [{"userId": "guest-1", "role": ROLE_GUEST}],
    }
    assert can_access(project, "guest-1", ROLE_VIEWER) is False
    # And the owner short-circuit is unaffected by the new rank.
    assert can_access(project, "owner-1", ROLE_VIEWER) is True


# ---------------------------------------------------------------------------
# Persistence: a guest can be added and is stored verbatim
# ---------------------------------------------------------------------------


def test_add_member_persists_a_guest(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    guest = register_and_login(client, "guest", "guest@example.com")
    project_id = create_project(client, owner["jwt"])

    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": guest["_id"], "role": "guest"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201
    assert add.json() == "Member added"

    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    assert {"userId": guest["_id"], "role": "guest"} in (
        project.get("memberIds") or []
    )


def test_add_member_persists_a_guest_via_service(
    client: TestClient, store: FakeStore
) -> None:
    # Exercise the service entry point directly so the persistence path is
    # covered independently of the router serialization.
    owner = register_and_login(client, "owner", "owner@example.com")
    guest = register_and_login(client, "guest", "guest@example.com")
    project_id = create_project(client, owner["jwt"])

    result = project_service.add_member(
        project_id, owner["_id"], guest["_id"], ROLE_GUEST
    )
    assert result == "Member added"

    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    assert {"userId": guest["_id"], "role": "guest"} in (
        project.get("memberIds") or []
    )


# ---------------------------------------------------------------------------
# A guest is admitted by no gate: reads, roster, writes, administration
# ---------------------------------------------------------------------------


def test_guest_cannot_read_roster_or_resources(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    guest = register_and_login(client, "guest", "guest@example.com")
    project_id = create_project(client, owner["jwt"])

    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": guest["_id"], "role": "guest"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201

    headers = auth_headers(guest["jwt"])

    # The viewer-gated roster does NOT admit a guest.
    roster = client.get(
        f"/api/v1/projects/members?projectId={project_id}", headers=headers
    )
    assert roster.status_code == 403

    # The viewer-gated reads (project / board / tasks) are forbidden too.
    assert (
        client.get(
            f"/api/v1/projects/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/boards/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/api/v1/tasks/?projectId={project_id}", headers=headers
        ).status_code
        == 403
    )

    # The guest's own listing does not leak the project either (listing is
    # viewer-gated, so rank-0 membership is invisible there).
    listing = client.get("/api/v1/projects/", headers=headers)
    assert listing.status_code == 200
    assert listing.json() == []

    # The owner, by contrast, sees the guest in the roster.
    owner_roster = client.get(
        f"/api/v1/projects/members?projectId={project_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()
    assert any(row["_id"] == guest["_id"] for row in owner_roster)


def test_guest_is_blocked_from_editor_and_owner_gated_actions(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    guest = register_and_login(client, "guest", "guest@example.com")
    target = register_and_login(client, "target", "target@example.com")
    project_id = create_project(client, owner["jwt"])
    column = first_column(client, owner["jwt"], project_id)

    add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": guest["_id"], "role": "guest"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add.status_code == 201

    headers = auth_headers(guest["jwt"])

    # Editor-gated write: creating a task is forbidden for a guest.
    task_create = create_task(
        client, guest["jwt"], project_id, column["_id"], guest["_id"]
    )
    assert task_create.status_code == 403

    # Owner-gated administration: a guest cannot mutate membership.
    forbidden_add = client.post(
        "/api/v1/projects/members",
        json={"projectId": project_id, "userId": target["_id"], "role": "viewer"},
        headers=headers,
    )
    assert forbidden_add.status_code == 403
