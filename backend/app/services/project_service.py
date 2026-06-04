from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.repositories import repository
from app.services.column_seed import ensure_default_columns
from app.validation import clean_filter

# Fields a manager may update via PUT /projects. ``_id`` is keyed
# separately and ``managerId`` is allowed (so ownership transfer keeps
# working) but ``createdAt`` / ``updatedAt`` must never be reassigned
# from a request body. ``memberIds`` is managed exclusively through the
# dedicated member endpoints, never via a raw PUT body.
_PROJECT_UPDATE_FIELDS = frozenset({"projectName", "organization", "managerId"})

# Role-based access control. Roles are totally ordered (owner > editor >
# viewer); a gate expressed as ``min_role`` passes for any role whose
# rank is >= the gate's rank.
ROLE_OWNER = "owner"
ROLE_EDITOR = "editor"
ROLE_VIEWER = "viewer"
VALID_ROLES = frozenset({ROLE_OWNER, ROLE_EDITOR, ROLE_VIEWER})
ROLE_RANK = {ROLE_VIEWER: 1, ROLE_EDITOR: 2, ROLE_OWNER: 3}


def _resolve_project(
    project_id_or_doc: Union[str, Dict[str, Any], None],
) -> Optional[Dict[str, Any]]:
    """Accept either a project id or an already-fetched doc.

    Passing the doc through avoids a redundant lookup when the caller has
    already loaded the project (e.g. the listing scan calls ``can_access``
    once per row).
    """

    if isinstance(project_id_or_doc, dict):
        return project_id_or_doc
    if project_id_or_doc is None:
        return None
    return repository.find_by_id(PROJECTS, str(project_id_or_doc))


def _member_role(project: Dict[str, Any], user_id: Optional[str]) -> Optional[str]:
    """Role recorded for ``user_id`` in ``memberIds`` (None if not a member).

    ``memberIds`` is optional on read, so legacy manager-only documents
    simply have no entries here.
    """

    for entry in project.get("memberIds") or []:
        if isinstance(entry, dict) and str(entry.get("userId")) == str(user_id):
            role = entry.get("role")
            return role if role in VALID_ROLES else None
    return None


def can_access(
    project_id_or_doc: Union[str, Dict[str, Any], None],
    user_id: Optional[str],
    min_role: str = ROLE_VIEWER,
) -> bool:
    """True if ``user_id`` holds at least ``min_role`` on the project.

    The ``managerId`` is always treated as owner-level (rank 3) even when
    ``memberIds`` is missing/empty, preserving the legacy single-owner
    model. Otherwise the user must have a ``memberIds`` entry whose role
    rank is >= the rank of ``min_role``.
    """

    project = _resolve_project(project_id_or_doc)
    if project is None:
        return False

    threshold = ROLE_RANK.get(min_role, ROLE_RANK[ROLE_OWNER])

    if str(project.get("managerId")) == str(user_id):
        return ROLE_RANK[ROLE_OWNER] >= threshold

    role = _member_role(project, user_id)
    if role is None:
        return False
    return ROLE_RANK[role] >= threshold


def is_project_manager(project_id: Optional[str], user_id: Optional[str]) -> bool:
    # Owner-level gate. Delegates to ``can_access`` but the manager check
    # inside it remains True even when ``memberIds`` is absent, so the
    # historical "managerId == user" behaviour is preserved exactly.
    return can_access(project_id, user_id, ROLE_OWNER)


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    # The body used to allow specifying ``managerId``; it had to equal
    # the caller for the request to succeed, so the field was attack
    # surface with no upside. We now derive the manager from the JWT
    # subject, eliminating an entire class of confused-deputy bugs.
    project_id = repository.insert_one(
        PROJECTS,
        {
            "projectName": data["projectName"],
            "organization": data["organization"],
            "managerId": user_id,
            # Seed the creator as an owner-level member so membership is
            # uniform from day one: ``memberIds`` always includes the
            # manager and authz can reason purely about it (the manager
            # short-circuit in ``can_access`` is belt-and-suspenders).
            "memberIds": [{"userId": user_id, "role": ROLE_OWNER}],
        },
    )
    ensure_default_columns(str(project_id))
    return "Project created"


def get(
    project_id: Optional[str],
    project_name: Optional[str],
    manager_id: Optional[str],
    *,
    viewer_id: str,
) -> Optional[Union[Dict[str, Any], List[Dict[str, Any]], str]]:
    """Return projects visible to ``viewer_id`` (the authenticated caller).

    A project is visible when the caller owns it (``managerId``) or holds
    any membership role on it (owner/editor/viewer). Query parameters are
    still restricted so a client cannot pass another user's ``managerId``
    or probe by name across tenants.
    """

    if project_id is not None:
        doc = repository.find_by_id(PROJECTS, project_id)
        if doc is None:
            return None
        if not can_access(doc, viewer_id, ROLE_VIEWER):
            return "Forbidden"
        return repository.serialize_document(doc)

    if manager_id is not None and str(manager_id) != str(viewer_id):
        return "Forbidden"

    # Membership is stored inline as a list, which ``FakeStore`` (and the
    # ``$elemMatch``-free contract these queries follow) cannot match on.
    # Fetch the candidate set with a flat exact-match filter and apply the
    # role check in Python. An indexed ``memberIds.userId`` query is a
    # future perf optimization; at single-tenant scale a scan is fine.
    query = clean_filter({"projectName": project_name})
    projects = [
        doc
        for doc in repository.find_many(PROJECTS, query)
        if can_access(doc, viewer_id, ROLE_VIEWER)
    ]
    return repository.serialize_documents(projects)


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    project_id = data.get("_id")
    if not project_id:
        return "Bad request"
    project = repository.find_by_id(PROJECTS, project_id)
    if project is None:
        return None
    if str(project.get("managerId")) != str(user_id):
        return "Forbidden"

    manager_id = data.get("managerId")
    if manager_id and repository.find_by_id(USERS, manager_id) is None:
        return "Manager not found"

    payload = {
        key: value for key, value in data.items() if key in _PROJECT_UPDATE_FIELDS
    }
    repository.update_by_id(PROJECTS, project_id, payload)
    return "Project updated"


def remove(project_id: Optional[str], user_id: str) -> Optional[str]:
    if project_id is None:
        return "Bad request"
    project = repository.find_by_id(PROJECTS, project_id)
    if project is None:
        return "Project not found"
    if str(project.get("managerId")) != str(user_id):
        return "Forbidden"
    # Deletion order: leaves first so a partial failure leaves a
    # well-formed (read-only) project rather than orphaned columns or
    # tasks. Multi-backend transactions are out of scope; this ordering
    # at least keeps retries idempotent.
    repository.delete_many(TASKS, {"projectId": project_id})
    repository.delete_many(COLUMNS, {"projectId": project_id})
    repository.delete_by_id(PROJECTS, project_id)
    return "Project deleted"


# ---------------------------------------------------------------------------
# Member management
#
# All mutating operations require the actor to be owner-level. The
# manager's own membership entry is immutable through these endpoints:
# the manager is the project's root of trust, so it cannot be demoted or
# removed here (ownership transfer goes through ``managerId`` on PUT
# /projects instead). Each function returns a string sentinel the router
# maps to an HTTP status; ``list_members`` returns data or a sentinel.
# ---------------------------------------------------------------------------


def _normalized_members(project: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Copy of ``memberIds`` keeping only well-formed ``{userId, role}`` rows."""

    members: List[Dict[str, Any]] = []
    for entry in project.get("memberIds") or []:
        if not isinstance(entry, dict):
            continue
        user_id = entry.get("userId")
        role = entry.get("role")
        if user_id is None or role not in VALID_ROLES:
            continue
        members.append({"userId": str(user_id), "role": role})
    return members


def add_member(
    project_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
    role: Optional[str],
) -> Optional[str]:
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return "Project not found"
    if not can_access(project, actor_id, ROLE_OWNER):
        return "Forbidden"
    if not target_user_id or role not in VALID_ROLES:
        return "Bad request"
    # The manager already is (and must stay) an owner; refuse to rewrite
    # its entry so it can never be silently downgraded via re-add.
    if str(target_user_id) == str(project.get("managerId")):
        return "Bad request"
    if repository.find_by_id(USERS, str(target_user_id)) is None:
        return "Member not found"

    members = _normalized_members(project)
    for entry in members:
        if entry["userId"] == str(target_user_id):
            # Idempotent: re-adding an existing member just updates role.
            entry["role"] = role
            break
    else:
        members.append({"userId": str(target_user_id), "role": role})

    repository.update_by_id(PROJECTS, str(project["_id"]), {"memberIds": members})
    return "Member added"


def update_member_role(
    project_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
    role: Optional[str],
) -> Optional[str]:
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return "Project not found"
    if not can_access(project, actor_id, ROLE_OWNER):
        return "Forbidden"
    if not target_user_id or role not in VALID_ROLES:
        return "Bad request"
    if str(target_user_id) == str(project.get("managerId")):
        # Cannot demote the manager/owner root of trust.
        return "Bad request"

    members = _normalized_members(project)
    for entry in members:
        if entry["userId"] == str(target_user_id):
            entry["role"] = role
            break
    else:
        return "Member not found"

    repository.update_by_id(PROJECTS, str(project["_id"]), {"memberIds": members})
    return "Member updated"


def remove_member(
    project_id: Optional[str],
    actor_id: str,
    target_user_id: Optional[str],
) -> Optional[str]:
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return "Project not found"
    if not can_access(project, actor_id, ROLE_OWNER):
        return "Forbidden"
    if not target_user_id:
        return "Bad request"
    if str(target_user_id) == str(project.get("managerId")):
        # The manager cannot be removed from its own project.
        return "Bad request"

    members = _normalized_members(project)
    remaining = [
        entry for entry in members if entry["userId"] != str(target_user_id)
    ]
    if len(remaining) == len(members):
        return "Member not found"

    repository.update_by_id(PROJECTS, str(project["_id"]), {"memberIds": remaining})
    return "Member removed"


def list_members(
    project_id: Optional[str],
    actor_id: str,
) -> Optional[Union[List[Dict[str, Any]], str]]:
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return "Project not found"
    # Any role (viewer and up) may see the roster.
    if not can_access(project, actor_id, ROLE_VIEWER):
        return "Forbidden"

    members: List[Dict[str, Any]] = []
    for entry in _normalized_members(project):
        user = repository.find_by_id(USERS, entry["userId"])
        # Skip dangling references (a user deleted out from under the
        # project) rather than emitting a half-populated row.
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
