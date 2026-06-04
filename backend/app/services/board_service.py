from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS
from app.domain.ordering import column_reorder_updates
from app.repositories import repository
from app.services.column_seed import ensure_default_columns
from app.services.project_service import ROLE_EDITOR, ROLE_VIEWER, can_access
from app.validation import body_error, sorted_by_index

# Fields a column write may set/change. ``_id`` is keyed separately and
# repository-managed fields (``createdAt`` / ``updatedAt``) plus the
# ordering-managed ``index`` and routing ``projectId`` are excluded so a
# malformed PUT body cannot corrupt position, reparent the column, or
# rewrite history. Keep aligned with ``TABLE_FIELDS[COLUMNS]``.
_COLUMN_UPDATE_FIELDS = frozenset({"columnName", "wipLimit"})


def _wip_limit_error(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate ``wipLimit`` when present: a non-negative ``int``.

    Mirrors how ``task_service`` validates ``storyPoints`` -- ``bool`` is a
    subclass of ``int`` so ``True``/``False`` are rejected explicitly, and
    floats/strings (e.g. ``1.5`` / ``"5"``) are rejected as non-ints. A
    ``wipLimit`` of 0 is valid and means "no limit" per the drift-detector
    contract (see ``be_tools.detect_drift``).
    """

    wip_limit = data.get("wipLimit")
    if (
        not isinstance(wip_limit, int)
        or isinstance(wip_limit, bool)
        or wip_limit < 0
    ):
        return body_error(
            data, "wipLimit", "WIP limit must be a non-negative integer"
        )
    return None


def create_validation_errors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Body errors for POST /boards (only ``wipLimit`` is checked here).

    ``columnName`` / ``projectId`` presence is enforced by the router's
    ``required_body_errors``; this guards the optional ``wipLimit``.
    """

    if "wipLimit" not in data:
        return []
    error = _wip_limit_error(data)
    return [error] if error is not None else []


def update_validation_errors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Body errors for PUT /boards (column rename / WIP-limit change)."""

    errors: List[Dict[str, Any]] = []
    if "columnName" in data:
        column_name = data.get("columnName")
        if not isinstance(column_name, str) or column_name == "":
            errors.append(
                body_error(data, "columnName", "Column name cannot be empty")
            )
    if "wipLimit" in data:
        error = _wip_limit_error(data)
        if error is not None:
            errors.append(error)
    return errors


def get(project_id: str, user_id: str) -> Union[None, str, List[Dict[str, Any]]]:
    if repository.find_by_id(PROJECTS, project_id) is None:
        return None
    # Read path: any member (viewer and up) may load the board.
    if not can_access(project_id, user_id, ROLE_VIEWER):
        return "Forbidden"

    columns = ensure_default_columns(project_id)

    return repository.serialize_documents(sorted_by_index(columns))


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    project_id = data.get("projectId")
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return None
    # Write path: editor or owner.
    if not can_access(project, user_id, ROLE_EDITOR):
        return "Forbidden"

    columns = ensure_default_columns(project_id)

    # ``wipLimit`` is optional on the wire; default 0 ("no limit" per the
    # detector contract). Re-validate defensively so a direct service
    # caller cannot persist a malformed value even if the router's
    # ``create_validation_errors`` gate is bypassed.
    if "wipLimit" in data and _wip_limit_error(data) is not None:
        return "Bad request"
    wip_limit = data["wipLimit"] if "wipLimit" in data else 0

    repository.insert_one(
        COLUMNS,
        {
            "columnName": data["columnName"],
            "projectId": project_id,
            "index": len(columns),
            "wipLimit": wip_limit,
        },
    )
    return "Column created"


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    """Update a column's ``columnName`` and/or ``wipLimit``.

    Returns ``None`` (missing column), ``"Forbidden"`` (caller lacks
    editor on the column's project), ``"Bad request"`` (missing ``_id`` or
    a malformed allowlisted value) or ``"Column updated"`` on success. The
    router maps these sentinels to HTTP status codes.
    """

    column_id = data.get("_id")
    if not column_id:
        return "Bad request"
    column = repository.find_by_id(COLUMNS, column_id)
    if column is None:
        return None
    # Write path: editor or owner on the column's project.
    if not can_access(column.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"

    # Re-validate defensively so a direct service caller cannot persist a
    # malformed value even if the router's gate is bypassed.
    if update_validation_errors(data):
        return "Bad request"

    payload = {
        key: value
        for key, value in data.items()
        if key in _COLUMN_UPDATE_FIELDS
    }
    repository.update_by_id(COLUMNS, column_id, payload)
    return "Column updated"


def reorder(data: Dict[str, Any], user_id: str) -> Optional[str]:
    order_type = data.get("type")
    from_id = data.get("fromId")
    reference_id = data.get("referenceId")
    from_column = repository.find_by_id(COLUMNS, from_id or "")
    reference_column = repository.find_by_id(COLUMNS, reference_id or "")
    if from_column is None or reference_column is None:
        return None
    if from_column.get("projectId") != reference_column.get("projectId"):
        return None
    # Write path: editor or owner.
    if not can_access(str(from_column.get("projectId")), user_id, ROLE_EDITOR):
        return "Forbidden"

    columns = repository.find_many(COLUMNS, {"projectId": from_column["projectId"]})
    updates = column_reorder_updates(order_type, from_column, reference_column, columns)
    if updates is None:
        return None

    for update in updates:
        repository.update_by_id(COLUMNS, update.item_id, update.changes)
    return "Column reordered"


def remove(column_id: str, user_id: str) -> Optional[str]:
    column = repository.find_by_id(COLUMNS, column_id)
    if column is None:
        return None
    # Write path: editor or owner.
    if not can_access(str(column.get("projectId")), user_id, ROLE_EDITOR):
        return "Forbidden"
    project_id = column.get("projectId")
    deleted_index = column.get("index")
    if repository.delete_by_id(COLUMNS, column_id) is None:
        return None
    repository.delete_many(TASKS, {"columnId": column_id})
    # Re-pack so remaining columns keep contiguous indexes; otherwise
    # later reorders shift around a hole and produce duplicate indexes.
    if isinstance(deleted_index, int) and project_id:
        for sibling in repository.find_many(COLUMNS, {"projectId": project_id}):
            sibling_index = sibling.get("index")
            if isinstance(sibling_index, int) and sibling_index > deleted_index:
                repository.update_by_id(
                    COLUMNS, str(sibling["_id"]), {"index": sibling_index - 1}
                )
    return "Column deleted"
