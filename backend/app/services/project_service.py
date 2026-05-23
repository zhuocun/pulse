from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.repositories import repository
from app.services.column_seed import ensure_default_columns
from app.validation import clean_filter

# Fields a manager may update via PUT /projects. ``_id`` is keyed
# separately and ``managerId`` is allowed (so ownership transfer keeps
# working) but ``createdAt`` / ``updatedAt`` must never be reassigned
# from a request body.
_PROJECT_UPDATE_FIELDS = frozenset({"projectName", "organization", "managerId"})


def is_project_manager(project_id: Optional[str], user_id: Optional[str]) -> bool:
    project = repository.find_by_id(PROJECTS, project_id or "")
    return project is not None and str(project.get("managerId")) == str(user_id)


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
    """Return projects visible to ``viewer_id`` (the authenticated manager).

    Listing without filters returns only projects where ``managerId``
    matches the caller. Query parameters are further restricted so a
    client cannot pass another user's ``managerId`` or probe by name
    across tenants.
    """

    if project_id is not None:
        doc = repository.find_by_id(PROJECTS, project_id)
        if doc is None:
            return None
        if str(doc.get("managerId")) != str(viewer_id):
            return "Forbidden"
        return repository.serialize_document(doc)

    if manager_id is not None and str(manager_id) != str(viewer_id):
        return "Forbidden"

    query = clean_filter(
        {
            "projectName": project_name,
            "managerId": viewer_id,
        }
    )
    projects = repository.find_many(PROJECTS, query)
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
