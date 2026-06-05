"""Org coupling on projects: real ``organizationId`` + tenant-scoped listing.

These pin down ORG-S2a: ``project_service.create`` now accepts an optional
``organizationId`` (org_admin+ gated, dangling refs rejected) and the
project LISTING is tenant-scoped, while a null-org (legacy / personal)
project keeps its old members-only visibility via the back-compat
fallback. Direct-by-id reads are deliberately NOT org-scoped -- we narrow
enumeration, not direct access.

The bootstrap mirrors ``tests/test_rbac.py`` / ``tests/test_organizations.py``:
real users are minted through the HTTP register/login helper (so every
``_id`` is a valid ObjectId string that survives ``find_by_id``), then the
org/project services are driven directly so the new create branches and
both ``_org_visible`` arms are exercised independently of the routers.
"""

from typing import Any, Dict, Optional

from fastapi.testclient import TestClient

from app.database import ORGANIZATIONS, PROJECTS
from app.services import organization_service as org_service
from app.services import project_service
from tests.conftest import FakeStore
from tests.test_rbac import register_and_login


def _seed_org(
    store: FakeStore,
    owner_id: str,
    *,
    slug: str = "acme",
    name: str = "Acme",
) -> str:
    """Create an org owned by ``owner_id`` and return its id.

    ``organization_service.create`` seeds the creator as ``org_owner`` and
    returns only a sentinel, so the id is resolved from the store by slug
    (the handle is globally unique).
    """

    assert org_service.create(name, slug, owner_id) == "Organization created"
    org = store.find_one(ORGANIZATIONS, {"slug": slug})
    assert org is not None
    return str(org["_id"])


def _add_org_member(org_id: str, owner_id: str, target_id: str, role: str) -> None:
    """Add ``target_id`` to the org at ``role`` (acting as the owner)."""

    assert org_service.add_member(org_id, owner_id, target_id, role) == "Member added"


def _create_project(
    user_id: str,
    *,
    organization_id: Optional[str] = None,
    project_name: str = "Pulse",
) -> Optional[str]:
    """Call ``project_service.create`` with the dual-write ``organization`` string.

    ``organizationId`` is threaded through only when supplied so the absent
    (legacy) case sends exactly the historical body shape.
    """

    data: Dict[str, Any] = {"projectName": project_name, "organization": "OpenAI"}
    if organization_id is not None:
        data["organizationId"] = organization_id
    return project_service.create(data, user_id)


def _stored_project(store: FakeStore, manager_id: str) -> Dict[str, Any]:
    """The single project managed by ``manager_id`` (tests create one each)."""

    rows = [
        row for row in store.data[PROJECTS] if str(row.get("managerId")) == str(manager_id)
    ]
    assert len(rows) == 1, rows
    return rows[0]


# ---------------------------------------------------------------------------
# create(): organizationId validation + gating
# ---------------------------------------------------------------------------


def test_org_admin_can_create_org_scoped_project(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    admin = register_and_login(client, "admin", "admin@example.com")
    org_id = _seed_org(store, owner["_id"])
    _add_org_member(org_id, owner["_id"], admin["_id"], org_service.ORG_ROLE_ADMIN)

    # An org_admin may stand up a project inside the tenant.
    assert _create_project(admin["_id"], organization_id=org_id) == "Project created"
    project = _stored_project(store, admin["_id"])
    assert project.get("organizationId") == org_id


def test_org_owner_can_create_org_scoped_project(
    client: TestClient, store: FakeStore
) -> None:
    # The owner sits above the org_admin gate, so it too may create.
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = _seed_org(store, owner["_id"])

    assert _create_project(owner["_id"], organization_id=org_id) == "Project created"
    project = _stored_project(store, owner["_id"])
    assert project.get("organizationId") == org_id


def test_plain_org_member_cannot_create_org_scoped_project(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    org_id = _seed_org(store, owner["_id"])
    _add_org_member(org_id, owner["_id"], member["_id"], org_service.ORG_ROLE_MEMBER)

    # A plain member is below the org_admin gate -> Forbidden, no project.
    assert _create_project(member["_id"], organization_id=org_id) == "Forbidden"
    assert [
        row for row in store.data[PROJECTS] if str(row.get("managerId")) == member["_id"]
    ] == []


def test_create_with_unknown_org_is_bad_request(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")

    # A dangling org reference is a client error and creates nothing.
    assert (
        _create_project(owner["_id"], organization_id="ffffffffffffffffffffffff")
        == "Bad request"
    )
    assert [
        row for row in store.data[PROJECTS] if str(row.get("managerId")) == owner["_id"]
    ] == []


def test_create_without_org_is_back_compat(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")

    # The legacy path inserts exactly as before: no ``organizationId`` key.
    assert _create_project(owner["_id"]) == "Project created"
    project = _stored_project(store, owner["_id"])
    assert "organizationId" not in project


# ---------------------------------------------------------------------------
# Listing: null-org back-compat fallback (_org_visible -> True)
# ---------------------------------------------------------------------------


def test_listing_shows_legacy_project_with_zero_orgs(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    assert _create_project(owner["_id"]) == "Project created"
    project_id = str(_stored_project(store, owner["_id"])["_id"])

    # The caller belongs to no orgs at all; a null-org project still lists
    # (the back-compat fallback must not hide pre-existing projects).
    listing = project_service.get(None, None, None, viewer_id=owner["_id"])
    assert isinstance(listing, list)
    assert {row["_id"] for row in listing} == {project_id}


def test_listing_shows_legacy_project_when_caller_belongs_to_other_org(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    # The caller belongs to SOME org, but their project carries no
    # organizationId -- the null-org fallback keeps it visible regardless.
    _seed_org(store, owner["_id"], slug="other", name="Other")
    assert _create_project(owner["_id"]) == "Project created"
    project_id = str(_stored_project(store, owner["_id"])["_id"])

    listing = project_service.get(None, None, None, viewer_id=owner["_id"])
    assert isinstance(listing, list)
    assert {row["_id"] for row in listing} == {project_id}


# ---------------------------------------------------------------------------
# Listing: org-scoped project (_org_visible -> membership check)
# ---------------------------------------------------------------------------


def test_listing_shows_org_project_for_org_member(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = _seed_org(store, owner["_id"])
    # Owner is both the project manager (member) AND an org member.
    assert _create_project(owner["_id"], organization_id=org_id) == "Project created"
    project_id = str(_stored_project(store, owner["_id"])["_id"])

    listing = project_service.get(None, None, None, viewer_id=owner["_id"])
    assert isinstance(listing, list)
    assert {row["_id"] for row in listing} == {project_id}


def test_listing_hides_org_project_from_non_org_project_member(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    org_id = _seed_org(store, owner["_id"])
    assert _create_project(owner["_id"], organization_id=org_id) == "Project created"
    project = _stored_project(store, owner["_id"])
    project_id = str(project["_id"])

    # ``outsider`` is a project MEMBER (so passes ``can_access``) but is NOT
    # a member of the owning org -> tenant isolation hides it from listing.
    store.update_by_id(
        PROJECTS,
        project_id,
        {
            "memberIds": [
                {"userId": owner["_id"], "role": project_service.ROLE_OWNER},
                {"userId": outsider["_id"], "role": project_service.ROLE_VIEWER},
            ]
        },
    )

    listing = project_service.get(None, None, None, viewer_id=outsider["_id"])
    assert listing == []

    # The org member still sees it (the project itself is fine; only the
    # outsider's enumeration is scoped out).
    owner_listing = project_service.get(None, None, None, viewer_id=owner["_id"])
    assert isinstance(owner_listing, list)
    assert {row["_id"] for row in owner_listing} == {project_id}


# ---------------------------------------------------------------------------
# Single-get by id is NOT org-scoped (only enumeration is)
# ---------------------------------------------------------------------------


def test_single_get_by_id_ignores_org_membership(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    org_id = _seed_org(store, owner["_id"])
    assert _create_project(owner["_id"], organization_id=org_id) == "Project created"
    project = _stored_project(store, owner["_id"])
    project_id = str(project["_id"])

    # Same setup as the isolation test: a project member who is NOT an org
    # member. Direct-by-id access stays on ``can_access`` alone.
    store.update_by_id(
        PROJECTS,
        project_id,
        {
            "memberIds": [
                {"userId": owner["_id"], "role": project_service.ROLE_OWNER},
                {"userId": outsider["_id"], "role": project_service.ROLE_VIEWER},
            ]
        },
    )

    fetched = project_service.get(project_id, None, None, viewer_id=outsider["_id"])
    assert isinstance(fetched, dict)
    assert fetched["_id"] == project_id


# ---------------------------------------------------------------------------
# update(): organizationId is not writable
# ---------------------------------------------------------------------------


def test_update_cannot_change_organization_id(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = _seed_org(store, owner["_id"])
    other_org_id = _seed_org(store, owner["_id"], slug="other", name="Other")
    assert _create_project(owner["_id"], organization_id=org_id) == "Project created"
    project_id = str(_stored_project(store, owner["_id"])["_id"])

    # A PUT body carrying organizationId (and a renamed projectName) must
    # update the name but leave the owning org untouched -- the field is
    # excluded from ``_PROJECT_UPDATE_FIELDS`` per PRD 3.3.
    result = project_service.update(
        {
            "_id": project_id,
            "projectName": "Renamed",
            "organizationId": other_org_id,
        },
        owner["_id"],
    )
    assert result == "Project updated"

    project = store.find_by_id(PROJECTS, project_id)
    assert project is not None
    assert project["projectName"] == "Renamed"
    assert project.get("organizationId") == org_id
