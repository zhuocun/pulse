"""Organization tenancy + org-level RBAC tests.

These exercise the new ``organizations`` collection end-to-end through
the real HTTP endpoints against the in-memory ``FakeStore`` from
``conftest.py``, plus a couple of direct ``can_access_org`` unit checks.
The org layer is parallel to the project layer: roles are
``org_owner > org_admin > member``, ownership is an ordinary
``org_owner`` membership (no ``managerId`` short-circuit), and the org
must always retain at least one ``org_owner``.
"""

from typing import Any, Dict

from fastapi.testclient import TestClient

from app.database import ORGANIZATIONS, PROJECTS
from app.services import organization_service as org_service
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


def create_org(
    client: TestClient,
    token: str,
    name: str = "Acme",
    slug: str = "acme",
) -> str:
    response = client.post(
        "/api/v1/organizations/",
        json={"name": name, "slug": slug},
        headers=auth_headers(token),
    )
    assert response.status_code == 201, response.text
    # Listing returns only orgs the caller is a member of; the creator is
    # an owner-member so exactly this org comes back.
    orgs = client.get(
        "/api/v1/organizations/", headers=auth_headers(token)
    ).json()
    return next(org["_id"] for org in orgs if org["slug"] == slug)


# ---------------------------------------------------------------------------
# can_access_org: rank ordering (unit-level)
# ---------------------------------------------------------------------------


def test_can_access_org_rank_ordering(store: FakeStore) -> None:
    org = {
        "_id": "org1",
        "members": [
            {"userId": "owner", "role": org_service.ORG_ROLE_OWNER},
            {"userId": "admin", "role": org_service.ORG_ROLE_ADMIN},
            {"userId": "member", "role": org_service.ORG_ROLE_MEMBER},
        ],
    }

    # member gate (rank 1): everyone who is a member passes.
    for user in ("owner", "admin", "member"):
        assert org_service.can_access_org(org, user, org_service.ORG_ROLE_MEMBER)

    # admin gate (rank 2): owner + admin pass, plain member does not.
    assert org_service.can_access_org(org, "owner", org_service.ORG_ROLE_ADMIN)
    assert org_service.can_access_org(org, "admin", org_service.ORG_ROLE_ADMIN)
    assert not org_service.can_access_org(org, "member", org_service.ORG_ROLE_ADMIN)

    # owner gate (rank 3): only owner passes.
    assert org_service.can_access_org(org, "owner", org_service.ORG_ROLE_OWNER)
    assert not org_service.can_access_org(org, "admin", org_service.ORG_ROLE_OWNER)
    assert not org_service.can_access_org(org, "member", org_service.ORG_ROLE_OWNER)

    # Non-member and unknown role both fail closed.
    assert not org_service.can_access_org(org, "stranger", org_service.ORG_ROLE_MEMBER)
    bogus = {"_id": "x", "members": [{"userId": "u", "role": "wat"}]}
    assert not org_service.can_access_org(bogus, "u", org_service.ORG_ROLE_MEMBER)


# ---------------------------------------------------------------------------
# Owner bootstrap on create
# ---------------------------------------------------------------------------


def test_creator_is_seeded_as_org_owner(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    org = store.find_by_id(ORGANIZATIONS, org_id)
    assert org is not None
    assert org.get("members") == [
        {"userId": owner["_id"], "role": "org_owner"}
    ]

    # The owner shows up in the roster with the right role.
    members = client.get(
        f"/api/v1/organizations/members?organizationId={org_id}",
        headers=auth_headers(owner["jwt"]),
    )
    assert members.status_code == 200
    assert members.json() == [
        {
            "_id": owner["_id"],
            "username": "owner",
            "email": "owner@example.com",
            "role": "org_owner",
        }
    ]


# ---------------------------------------------------------------------------
# Slug uniqueness
# ---------------------------------------------------------------------------


def test_duplicate_slug_is_rejected(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    other = register_and_login(client, "other", "other@example.com")
    create_org(client, owner["jwt"], name="Acme", slug="acme")

    # A second org (even by another user) with the same slug is a 400.
    collision = client.post(
        "/api/v1/organizations/",
        json={"name": "Acme Two", "slug": "acme"},
        headers=auth_headers(other["jwt"]),
    )
    assert collision.status_code == 400


def test_update_cannot_touch_members_and_enforces_slug(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    intruder = register_and_login(client, "intruder", "intruder@example.com")
    org_id = create_org(client, owner["jwt"], slug="acme")
    create_org(client, owner["jwt"], name="Globex", slug="globex")

    # A PUT carrying ``members`` (and other non-allowlisted keys) must not
    # rewrite the roster -- only name/slug/settings are honoured.
    update = client.put(
        "/api/v1/organizations/",
        json={
            "_id": org_id,
            "name": "Acme Renamed",
            "settings": {"theme": "dark"},
            "members": [
                {"userId": owner["_id"], "role": "org_owner"},
                {"userId": intruder["_id"], "role": "org_owner"},
            ],
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert update.status_code == 200
    assert update.json() == "Organization updated"

    org = store.find_by_id(ORGANIZATIONS, org_id)
    assert org is not None
    assert org["name"] == "Acme Renamed"
    assert org["settings"] == {"theme": "dark"}
    # The intruder was NOT injected via the raw body.
    assert org.get("members") == [{"userId": owner["_id"], "role": "org_owner"}]

    # Renaming the slug to one already taken by another org is a 400.
    collide = client.put(
        "/api/v1/organizations/",
        json={"_id": org_id, "slug": "globex"},
        headers=auth_headers(owner["jwt"]),
    )
    assert collide.status_code == 400


# ---------------------------------------------------------------------------
# Member administration: admin-gated, existing-user required
# ---------------------------------------------------------------------------


def test_add_member_requires_existing_user(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    response = client.post(
        "/api/v1/organizations/members",
        json={
            "organizationId": org_id,
            "userId": "doesnotexist",
            "role": "member",
        },
        headers=auth_headers(owner["jwt"]),
    )
    assert response.status_code == 404
    assert response.json()["error"] == "Member not found"


def test_only_admin_or_owner_can_manage_members(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    member = register_and_login(client, "member", "member@example.com")
    target = register_and_login(client, "target", "target@example.com")
    org_id = create_org(client, owner["jwt"])

    # Seed a plain member; a member must not be able to manage membership.
    add_member = client.post(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": member["_id"], "role": "member"},
        headers=auth_headers(owner["jwt"]),
    )
    assert add_member.status_code == 201

    member_headers = auth_headers(member["jwt"])
    assert (
        client.post(
            "/api/v1/organizations/members",
            json={
                "organizationId": org_id,
                "userId": target["_id"],
                "role": "member",
            },
            headers=member_headers,
        ).status_code
        == 403
    )

    # Promote the member to admin; now they CAN add others.
    promote = client.put(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": member["_id"], "role": "org_admin"},
        headers=auth_headers(owner["jwt"]),
    )
    assert promote.status_code == 200

    admin_add = client.post(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": target["_id"], "role": "member"},
        headers=member_headers,
    )
    assert admin_add.status_code == 201
    assert admin_add.json() == "Member added"

    # Roster now has owner + admin + member.
    roster = client.get(
        f"/api/v1/organizations/members?organizationId={org_id}",
        headers=auth_headers(owner["jwt"]),
    ).json()
    assert {row["_id"] for row in roster} == {
        owner["_id"],
        member["_id"],
        target["_id"],
    }


# ---------------------------------------------------------------------------
# Role ceiling: an org_admin cannot grant org_owner (self-escalation guard)
# ---------------------------------------------------------------------------


def test_org_admin_cannot_grant_org_owner(
    client: TestClient, store: FakeStore
) -> None:
    """An org_admin must not be able to mint org_owners.

    Member mutations are admin-gated, but granting the top role is
    owner-only: otherwise an admin could promote itself (or anyone) to
    org_owner, route around the owner tier, and defeat the last-owner
    guard by minting a second owner at will.
    """

    owner = register_and_login(client, "owner", "owner@example.com")
    admin = register_and_login(client, "admin", "admin@example.com")
    target = register_and_login(client, "target", "target@example.com")
    org_id = create_org(client, owner["jwt"])

    # Owner installs an admin.
    assert (
        client.post(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": admin["_id"], "role": "org_admin"},
            headers=auth_headers(owner["jwt"]),
        ).status_code
        == 201
    )
    admin_headers = auth_headers(admin["jwt"])

    # The admin may seed an ordinary member ...
    assert (
        client.post(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": target["_id"], "role": "member"},
            headers=admin_headers,
        ).status_code
        == 201
    )
    # ... but may NOT add anyone as org_owner ...
    assert (
        client.post(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": target["_id"], "role": "org_owner"},
            headers=admin_headers,
        ).status_code
        == 403
    )
    # ... may NOT promote an existing member to org_owner ...
    assert (
        client.put(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": target["_id"], "role": "org_owner"},
            headers=admin_headers,
        ).status_code
        == 403
    )
    # ... and may NOT self-escalate to org_owner.
    assert (
        client.put(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": admin["_id"], "role": "org_owner"},
            headers=admin_headers,
        ).status_code
        == 403
    )

    # The org still has exactly one owner.
    org = store.find_by_id(ORGANIZATIONS, org_id)
    assert org is not None
    assert [m["userId"] for m in org["members"] if m["role"] == "org_owner"] == [
        owner["_id"]
    ]

    # The owner, by contrast, CAN grant org_owner (no over-block).
    assert (
        client.put(
            "/api/v1/organizations/members",
            json={"organizationId": org_id, "userId": target["_id"], "role": "org_owner"},
            headers=auth_headers(owner["jwt"]),
        ).status_code
        == 200
    )


# ---------------------------------------------------------------------------
# Last-org_owner guard (demote AND remove)
# ---------------------------------------------------------------------------


def test_last_owner_cannot_be_demoted(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    # Demoting the sole owner via PUT /members is a 400.
    demote = client.put(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": owner["_id"], "role": "org_admin"},
        headers=auth_headers(owner["jwt"]),
    )
    assert demote.status_code == 400

    # Re-adding the sole owner at a lower role (idempotent path) is also
    # refused so it cannot be silently downgraded.
    readd = client.post(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": owner["_id"], "role": "member"},
        headers=auth_headers(owner["jwt"]),
    )
    assert readd.status_code == 400

    org = store.find_by_id(ORGANIZATIONS, org_id)
    assert org is not None
    assert org.get("members") == [{"userId": owner["_id"], "role": "org_owner"}]


def test_last_owner_cannot_be_removed(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    remove = client.delete(
        f"/api/v1/organizations/members?organizationId={org_id}&userId={owner['_id']}",
        headers=auth_headers(owner["jwt"]),
    )
    assert remove.status_code == 400

    org = store.find_by_id(ORGANIZATIONS, org_id)
    assert org is not None
    assert org.get("members") == [{"userId": owner["_id"], "role": "org_owner"}]


def test_owner_can_be_demoted_or_removed_when_another_owner_exists(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    second = register_and_login(client, "second", "second@example.com")
    org_id = create_org(client, owner["jwt"])

    # Promote a second owner so the guard no longer fires.
    client.post(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": second["_id"], "role": "org_owner"},
        headers=auth_headers(owner["jwt"]),
    )

    # Now the first owner can be demoted (two owners -> one).
    demote = client.put(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": owner["_id"], "role": "org_admin"},
        headers=auth_headers(second["jwt"]),
    )
    assert demote.status_code == 200
    assert demote.json() == "Member updated"

    # And the (now sole) remaining owner is again protected from removal.
    blocked = client.delete(
        f"/api/v1/organizations/members?organizationId={org_id}&userId={second['_id']}",
        headers=auth_headers(second["jwt"]),
    )
    assert blocked.status_code == 400


# ---------------------------------------------------------------------------
# Roster skips dangling references
# ---------------------------------------------------------------------------


def test_roster_skips_dangling_member_refs(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    ghost = register_and_login(client, "ghost", "ghost@example.com")
    org_id = create_org(client, owner["jwt"])

    client.post(
        "/api/v1/organizations/members",
        json={"organizationId": org_id, "userId": ghost["_id"], "role": "member"},
        headers=auth_headers(owner["jwt"]),
    )

    # Delete the user out from under the org, leaving a dangling ref.
    user_row = store.find_by_id("users", ghost["_id"])
    assert user_row is not None
    store.data["users"].remove(user_row)

    roster = client.get(
        f"/api/v1/organizations/members?organizationId={org_id}",
        headers=auth_headers(owner["jwt"]),
    )
    assert roster.status_code == 200
    # Only the owner survives; the dangling ghost row is skipped.
    assert {row["_id"] for row in roster.json()} == {owner["_id"]}


# ---------------------------------------------------------------------------
# remove() refused while the org owns a project
# ---------------------------------------------------------------------------


def test_remove_refused_when_org_owns_a_project(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    # Simulate a project that already belongs to this org (the coupling is
    # not wired into project creation yet, so seed it directly).
    store.insert_one(
        PROJECTS,
        {
            "projectName": "Owned",
            "organization": "Acme",
            "organizationId": org_id,
            "managerId": owner["_id"],
        },
    )

    refused = client.delete(
        f"/api/v1/organizations/?organizationId={org_id}",
        headers=auth_headers(owner["jwt"]),
    )
    assert refused.status_code == 400
    # The org is still there.
    assert store.find_by_id(ORGANIZATIONS, org_id) is not None


def test_remove_succeeds_when_org_owns_no_projects(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    org_id = create_org(client, owner["jwt"])

    deleted = client.delete(
        f"/api/v1/organizations/?organizationId={org_id}",
        headers=auth_headers(owner["jwt"]),
    )
    assert deleted.status_code == 200
    assert deleted.json() == "Organization deleted"
    assert store.find_by_id(ORGANIZATIONS, org_id) is None


# ---------------------------------------------------------------------------
# Non-members: locked out / empty listing
# ---------------------------------------------------------------------------


def test_non_member_is_forbidden_and_listing_is_empty(
    client: TestClient, store: FakeStore
) -> None:
    owner = register_and_login(client, "owner", "owner@example.com")
    outsider = register_and_login(client, "outsider", "outsider@example.com")
    org_id = create_org(client, owner["jwt"])

    headers = auth_headers(outsider["jwt"])

    # Direct read by id is forbidden.
    assert (
        client.get(
            f"/api/v1/organizations/?organizationId={org_id}", headers=headers
        ).status_code
        == 403
    )
    # Roster read is forbidden.
    assert (
        client.get(
            f"/api/v1/organizations/members?organizationId={org_id}", headers=headers
        ).status_code
        == 403
    )
    # Admin-only write is forbidden (not a member at all).
    assert (
        client.put(
            "/api/v1/organizations/",
            json={"_id": org_id, "name": "Hijacked"},
            headers=headers,
        ).status_code
        == 403
    )

    # The outsider's own listing does not leak the org.
    listing = client.get("/api/v1/organizations/", headers=headers)
    assert listing.status_code == 200
    assert listing.json() == []
