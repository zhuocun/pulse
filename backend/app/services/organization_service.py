from typing import Any, Dict, List, Optional, Union

from app.database import ORGANIZATIONS, PROJECTS, USERS
from app.repositories import repository
from app.validation import clean_filter

# Fields an admin may update via PUT /organizations. ``_id`` is keyed
# separately and ``createdAt`` / ``updatedAt`` must never be reassigned
# from a request body. ``members`` is managed exclusively through the
# dedicated member endpoints, never via a raw PUT body, so it is
# deliberately absent here.
_ORG_UPDATE_FIELDS = frozenset({"name", "slug", "settings"})

# Org-level role-based access control. Roles are totally ordered
# (org_owner > org_admin > member); a gate expressed as ``min_org_role``
# passes for any role whose rank is >= the gate's rank. Unlike the
# project model there is no separate "manager" root of trust: org
# ownership is an ordinary ``org_owner`` membership, and the invariant
# "an org always retains at least one ``org_owner``" is enforced by the
# member operations rather than by a short-circuit in ``can_access_org``.
ORG_ROLE_OWNER = "org_owner"
ORG_ROLE_ADMIN = "org_admin"
ORG_ROLE_MEMBER = "member"
VALID_ORG_ROLES = frozenset({ORG_ROLE_OWNER, ORG_ROLE_ADMIN, ORG_ROLE_MEMBER})
ORG_ROLE_RANK = {ORG_ROLE_MEMBER: 1, ORG_ROLE_ADMIN: 2, ORG_ROLE_OWNER: 3}


def _resolve_org(
    org_id_or_doc: Union[str, Dict[str, Any], None],
) -> Optional[Dict[str, Any]]:
    """Accept either an org id or an already-fetched doc.

    Passing the doc through avoids a redundant lookup when the caller has
    already loaded the organization (e.g. the listing scan calls
    ``can_access_org`` once per row).
    """

    if isinstance(org_id_or_doc, dict):
        return org_id_or_doc
    if org_id_or_doc is None:
        return None
    return repository.find_by_id(ORGANIZATIONS, str(org_id_or_doc))


def _member_role(org: Dict[str, Any], user_id: Optional[str]) -> Optional[str]:
    """Role recorded for ``user_id`` in ``members`` (None if not a member)."""

    for entry in org.get("members") or []:
        if isinstance(entry, dict) and str(entry.get("userId")) == str(user_id):
            role = entry.get("role")
            return role if role in VALID_ORG_ROLES else None
    return None


def can_access_org(
    org_id_or_doc: Union[str, Dict[str, Any], None],
    user_id: Optional[str],
    min_org_role: str = ORG_ROLE_MEMBER,
) -> bool:
    """True if ``user_id`` holds at least ``min_org_role`` on the org.

    The user must have a ``members`` entry whose role rank is >= the rank
    of ``min_org_role``. There is no ownership short-circuit: ownership is
    an ordinary ``org_owner`` membership. Fail-closed (deny) when the org
    is missing or the recorded role is unknown.
    """

    org = _resolve_org(org_id_or_doc)
    if org is None:
        return False

    threshold = ORG_ROLE_RANK.get(min_org_role, ORG_ROLE_RANK[ORG_ROLE_OWNER])

    role = _member_role(org, user_id)
    if role is None:
        return False
    return ORG_ROLE_RANK[role] >= threshold


def create(name: str, slug: str, user_id: str) -> Optional[str]:
    # The public ``slug`` is the tenant handle and must be globally
    # unique. Read-before-write mirrors the register flow in
    # ``auth_service``; the DB also carries a unique index as the
    # authoritative backstop against a concurrent insert.
    if repository.find_one(ORGANIZATIONS, {"slug": slug}) is not None:
        return "Bad request"
    repository.insert_one(
        ORGANIZATIONS,
        {
            "name": name,
            "slug": slug,
            # Seed the creator as an owner-level member so membership is
            # uniform from day one and authz can reason purely about
            # ``members``.
            "members": [{"userId": user_id, "role": ORG_ROLE_OWNER}],
            "settings": {},
        },
    )
    return "Organization created"


def get(
    user_id: str,
    organization_id: Optional[str] = None,
) -> Optional[Union[Dict[str, Any], List[Dict[str, Any]], str]]:
    """Return organizations visible to ``user_id`` (the authenticated caller).

    By id: the caller must be a member (any role). Without an id: list
    every org the caller is a member of. Membership is stored inline as a
    list, which the ``$elemMatch``-free contract these queries follow
    cannot match on, so the candidate set is fetched flat and the role
    check is applied in Python (an indexed ``members.userId`` query is a
    future perf optimization; at single-tenant scale a scan is fine).
    """

    if organization_id is not None:
        doc = repository.find_by_id(ORGANIZATIONS, organization_id)
        if doc is None:
            return None
        if not can_access_org(doc, user_id, ORG_ROLE_MEMBER):
            return "Forbidden"
        return repository.serialize_document(doc)

    organizations = [
        doc
        for doc in repository.find_many(ORGANIZATIONS, clean_filter({}))
        if can_access_org(doc, user_id, ORG_ROLE_MEMBER)
    ]
    return repository.serialize_documents(organizations)


def update(
    organization_id: Optional[str],
    user_id: str,
    data: Dict[str, Any],
) -> Optional[str]:
    if not organization_id:
        return "Bad request"
    org = repository.find_by_id(ORGANIZATIONS, organization_id)
    if org is None:
        return None
    if not can_access_org(org, user_id, ORG_ROLE_ADMIN):
        return "Forbidden"

    payload = {key: value for key, value in data.items() if key in _ORG_UPDATE_FIELDS}
    # A slug change must keep the handle globally unique; a no-op change
    # (same slug) is allowed so callers can PUT the full doc back.
    new_slug = payload.get("slug")
    if new_slug is not None and new_slug != org.get("slug"):
        if repository.find_one(ORGANIZATIONS, {"slug": new_slug}) is not None:
            return "Bad request"

    repository.update_by_id(ORGANIZATIONS, organization_id, payload)
    return "Organization updated"


def remove(organization_id: Optional[str], user_id: str) -> Optional[str]:
    if organization_id is None:
        return "Bad request"
    org = repository.find_by_id(ORGANIZATIONS, organization_id)
    if org is None:
        return "Organization not found"
    if not can_access_org(org, user_id, ORG_ROLE_OWNER):
        return "Forbidden"
    # Forward-compat guard: refuse to delete a tenant that still owns
    # projects so they can never be orphaned. Today no project carries an
    # ``organizationId`` so this is vacuously empty, but the check ships
    # now so the invariant holds the moment the coupling lands.
    if repository.find_many(PROJECTS, {"organizationId": organization_id}):
        return "Bad request"
    repository.delete_by_id(ORGANIZATIONS, organization_id)
    return "Organization deleted"


# ---------------------------------------------------------------------------
# Member management
#
# All mutating operations require the actor to be admin-level
# (``org_admin`` or ``org_owner``). The org's last ``org_owner`` is its
# root of trust: every demote/remove path refuses (``"Bad request"``) to
# drop the final ``org_owner`` so a tenant can never become ownerless.
# Each function returns a string sentinel the router maps to an HTTP
# status; ``list_members`` returns data or a sentinel.
# ---------------------------------------------------------------------------


def _normalized_members(org: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Copy of ``members`` keeping only well-formed ``{userId, role}`` rows."""

    members: List[Dict[str, Any]] = []
    for entry in org.get("members") or []:
        if not isinstance(entry, dict):
            continue
        user_id = entry.get("userId")
        role = entry.get("role")
        if user_id is None or role not in VALID_ORG_ROLES:
            continue
        members.append({"userId": str(user_id), "role": role})
    return members


def _is_last_owner(members: List[Dict[str, Any]], target_user_id: str) -> bool:
    """True if ``target_user_id`` is the org's only remaining ``org_owner``."""

    owners = [entry for entry in members if entry["role"] == ORG_ROLE_OWNER]
    return len(owners) == 1 and owners[0]["userId"] == str(target_user_id)


def add_member(
    organization_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
    role: Optional[str],
) -> Optional[str]:
    org = repository.find_by_id(ORGANIZATIONS, organization_id or "")
    if org is None:
        return "Organization not found"
    if not can_access_org(org, actor_id, ORG_ROLE_ADMIN):
        return "Forbidden"
    if not target_user_id or role not in VALID_ORG_ROLES:
        return "Bad request"
    # Only an org_owner may grant org_owner; an org_admin must not be able
    # to mint owners (which would let it self-escalate past its own tier).
    if role == ORG_ROLE_OWNER and not can_access_org(org, actor_id, ORG_ROLE_OWNER):
        return "Forbidden"
    if repository.find_by_id(USERS, str(target_user_id)) is None:
        return "Member not found"

    members = _normalized_members(org)
    # Demoting the final ``org_owner`` away (via an idempotent re-add at a
    # lower role) would leave the tenant ownerless; refuse it.
    if role != ORG_ROLE_OWNER and _is_last_owner(members, str(target_user_id)):
        return "Bad request"

    for entry in members:
        if entry["userId"] == str(target_user_id):
            # Idempotent: re-adding an existing member just updates role.
            entry["role"] = role
            break
    else:
        members.append({"userId": str(target_user_id), "role": role})

    repository.update_by_id(ORGANIZATIONS, str(org["_id"]), {"members": members})
    return "Member added"


def update_member_role(
    organization_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
    role: Optional[str],
) -> Optional[str]:
    org = repository.find_by_id(ORGANIZATIONS, organization_id or "")
    if org is None:
        return "Organization not found"
    if not can_access_org(org, actor_id, ORG_ROLE_ADMIN):
        return "Forbidden"
    if not target_user_id or role not in VALID_ORG_ROLES:
        return "Bad request"
    # Only an org_owner may grant org_owner (see add_member): admin-gated
    # member management must not let an admin promote anyone -- including
    # itself -- to the owner tier.
    if role == ORG_ROLE_OWNER and not can_access_org(org, actor_id, ORG_ROLE_OWNER):
        return "Forbidden"

    members = _normalized_members(org)
    # Demoting the last ``org_owner`` would leave the tenant ownerless.
    if role != ORG_ROLE_OWNER and _is_last_owner(members, str(target_user_id)):
        return "Bad request"

    for entry in members:
        if entry["userId"] == str(target_user_id):
            entry["role"] = role
            break
    else:
        return "Member not found"

    repository.update_by_id(ORGANIZATIONS, str(org["_id"]), {"members": members})
    return "Member updated"


def remove_member(
    organization_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
) -> Optional[str]:
    org = repository.find_by_id(ORGANIZATIONS, organization_id or "")
    if org is None:
        return "Organization not found"
    if not can_access_org(org, actor_id, ORG_ROLE_ADMIN):
        return "Forbidden"
    if not target_user_id:
        return "Bad request"

    members = _normalized_members(org)
    # Removing the last ``org_owner`` would leave the tenant ownerless.
    if _is_last_owner(members, str(target_user_id)):
        return "Bad request"

    remaining = [
        entry for entry in members if entry["userId"] != str(target_user_id)
    ]
    if len(remaining) == len(members):
        return "Member not found"

    repository.update_by_id(ORGANIZATIONS, str(org["_id"]), {"members": remaining})
    return "Member removed"


def list_members(
    organization_id: Optional[str],
    actor_id: str,
) -> Optional[Union[List[Dict[str, Any]], str]]:
    org = repository.find_by_id(ORGANIZATIONS, organization_id or "")
    if org is None:
        return "Organization not found"
    # Any role (member and up) may see the roster.
    if not can_access_org(org, actor_id, ORG_ROLE_MEMBER):
        return "Forbidden"

    members: List[Dict[str, Any]] = []
    for entry in _normalized_members(org):
        user = repository.find_by_id(USERS, entry["userId"])
        # Skip dangling references (a user deleted out from under the org)
        # rather than emitting a half-populated row.
        if user is None:
            continue
        members.append(
            {
                "_id": str(user["_id"]),
                "username": user.get("username"),
                "email": user.get("email"),
                "role": entry["role"],
            }
        )
    return members
