from typing import Any, Dict, List, Optional, Union

from app.database import LABELS, PROJECTS, TASKS
from app.repositories import repository
from app.services.project_service import ROLE_EDITOR, ROLE_VIEWER, can_access

# Fields a writer may set on a label via PUT /labels. Repository-managed
# fields (``_id`` / ``createdAt`` / ``updatedAt``) and the immutable
# ``projectId`` are excluded so a malformed/forged body cannot move a
# label between projects or rewrite history. Keep this aligned with the
# writable subset of ``TABLE_FIELDS[LABELS]``.
_LABEL_UPDATE_FIELDS = frozenset({"name", "color"})

# Default swatch when a label is created without an explicit ``color``.
DEFAULT_COLOR = "#888888"


def _valid_name(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    project_id = data.get("projectId")
    # Write path: the project must exist (None -> 404) and the caller must
    # be editor or owner on it (-> "Forbidden").
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return None
    if not can_access(project_id, user_id, ROLE_EDITOR):
        return "Forbidden"

    name = data.get("name")
    if not _valid_name(name):
        return "Bad request"

    color = data.get("color")
    if color is None:
        color = DEFAULT_COLOR
    elif not isinstance(color, str):
        return "Bad request"

    repository.insert_one(
        LABELS,
        {
            "projectId": project_id,
            "name": name,
            "color": color,
        },
    )
    return "Label created"


def get(project_id: Optional[str], user_id: str) -> Optional[Union[str, List[Any]]]:
    if repository.find_by_id(PROJECTS, project_id or "") is None:
        return "Project not found"
    # Read path: any member (viewer and up) may list the labels.
    if not can_access(project_id, user_id, ROLE_VIEWER):
        return "Forbidden"

    return repository.serialize_documents(
        repository.find_many(LABELS, {"projectId": project_id})
    )


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    label_id = data.get("_id")
    label = repository.find_by_id(LABELS, label_id or "")
    if not label_id or label is None:
        return None
    # Write path: editor or owner on the label's project.
    if not can_access(label.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"

    if "name" in data and not _valid_name(data.get("name")):
        return "Bad request"
    if "color" in data and not isinstance(data.get("color"), str):
        return "Bad request"

    payload = {
        key: value for key, value in data.items() if key in _LABEL_UPDATE_FIELDS
    }
    repository.update_by_id(LABELS, label_id, payload)
    return "Label updated"


def remove(label_id: Optional[str], user_id: str) -> Optional[str]:
    label = repository.find_by_id(LABELS, label_id or "")
    if not label_id or label is None:
        return None
    # Write path: editor or owner on the label's project.
    if not can_access(label.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"

    project_id = label.get("projectId")
    repository.delete_by_id(LABELS, label_id)

    # Cascade: strip the deleted label id from any task in the same
    # project that referenced it, so the board never renders a dangling
    # label chip. FakeStore (and the operator-free query contract these
    # services follow) cannot match on a list element, so fetch the
    # project's tasks with a flat exact-match filter and filter in Python.
    label_id = str(label_id)
    for task in repository.find_many(TASKS, {"projectId": project_id}):
        label_ids = task.get("labelIds")
        if not isinstance(label_ids, list) or label_id not in (
            str(item) for item in label_ids
        ):
            continue
        remaining = [item for item in label_ids if str(item) != label_id]
        repository.update_by_id(TASKS, str(task["_id"]), {"labelIds": remaining})

    return "Label deleted"
