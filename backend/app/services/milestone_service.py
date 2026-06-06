from typing import Any, Dict, List, Optional, Union

from app.database import MILESTONES, PROJECTS
from app.repositories import repository
from app.services.project_service import ROLE_EDITOR, ROLE_VIEWER, can_access

# Fields a writer may set on a milestone via PUT /milestones. Repository-
# managed fields (``_id`` / ``createdAt`` / ``updatedAt``) and the immutable
# ``projectId`` are excluded so a malformed/forged body cannot move a
# milestone between projects or rewrite history. Keep this aligned with the
# writable subset of ``TABLE_FIELDS[MILESTONES]``.
_MILESTONE_UPDATE_FIELDS = frozenset(
    {"name", "description", "startDate", "dueDate", "state"}
)

# The only accepted lifecycle states. ``open`` is the default applied on
# create when ``state`` is absent.
_MILESTONE_STATES = frozenset({"open", "closed"})


def _valid_name(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    project_id = data.get("projectId")
    # Write path order: existence -> access -> body validation, so a
    # non-member cannot probe a project's existence by sending a bad body.
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return "Project not found"
    if not can_access(project_id, user_id, ROLE_EDITOR):
        return "Forbidden"

    name = data.get("name")
    if not _valid_name(name):
        return "Bad request"

    state = data.get("state")
    if state is not None and state not in _MILESTONE_STATES:
        return "Bad request"

    repository.insert_one(
        MILESTONES,
        {
            "projectId": project_id,
            "name": name,
            "description": data.get("description") or "",
            "startDate": data.get("startDate"),
            "dueDate": data.get("dueDate"),
            "state": state or "open",
        },
    )
    return "Milestone created"


def get(
    project_id: Optional[str], user_id: str
) -> Optional[Union[str, List[Any]]]:
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return "Project not found"
    # Read path: any member (viewer and up) may list the milestones.
    if not can_access(project_id, user_id, ROLE_VIEWER):
        return "Forbidden"

    return repository.serialize_documents(
        repository.find_many(MILESTONES, {"projectId": project_id})
    )


def update(
    milestone_id: Optional[str], data: Dict[str, Any], user_id: str
) -> Optional[str]:
    milestone = repository.find_by_id(MILESTONES, milestone_id or "")
    if not milestone_id or milestone is None:
        return None
    # Resolve the owning project; a dangling reference is a 404.
    project_id = milestone.get("projectId")
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return "Project not found"
    # Write path: editor or owner on the milestone's project.
    if not can_access(project_id, user_id, ROLE_EDITOR):
        return "Forbidden"

    if "name" in data and not _valid_name(data.get("name")):
        return "Bad request"
    if "state" in data and data.get("state") not in _MILESTONE_STATES:
        return "Bad request"

    payload = {
        key: value
        for key, value in data.items()
        if key in _MILESTONE_UPDATE_FIELDS
    }
    repository.update_by_id(MILESTONES, milestone_id, payload)
    return "Milestone updated"


def remove(milestone_id: Optional[str], user_id: str) -> Optional[str]:
    milestone = repository.find_by_id(MILESTONES, milestone_id or "")
    if not milestone_id or milestone is None:
        return None
    project_id = milestone.get("projectId")
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return "Project not found"
    # Write path: editor or owner on the milestone's project.
    if not can_access(project_id, user_id, ROLE_EDITOR):
        return "Forbidden"

    # Plain hard delete -- task->milestone assignment (and any cascade) is a
    # separate follow-up slice, so nothing else references this row yet.
    repository.delete_by_id(MILESTONES, milestone_id)
    return "Milestone deleted"
