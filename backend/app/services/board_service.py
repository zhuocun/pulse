from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS
from app.domain.ordering import column_reorder_updates
from app.repositories import repository
from app.services.project_service import is_project_manager
from app.validation import sorted_by_index


DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"]


def get(project_id: str, user_id: str) -> Union[None, str, List[Dict[str, Any]]]:
    if repository.find_by_id(PROJECTS, project_id) is None:
        return None
    if not is_project_manager(project_id, user_id):
        return "Forbidden"

    columns = repository.find_many(COLUMNS, {"projectId": project_id})
    if not columns:
        # Lazy seeding from a GET is not ideal (it makes the endpoint
        # non-idempotent and racy under concurrent first reads), but we
        # keep it for backwards compatibility with the FE that depends on
        # always seeing three columns. The race is bounded because there
        # is no unique constraint to violate -- duplicate columns would
        # be rare and visible.
        for index, column_name in enumerate(DEFAULT_COLUMNS):
            repository.insert_one(
                COLUMNS,
                {
                    "columnName": column_name,
                    "projectId": project_id,
                    "index": index,
                },
            )
        columns = repository.find_many(COLUMNS, {"projectId": project_id})

    return repository.serialize_documents(sorted_by_index(columns))


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    project_id = data.get("projectId")
    project = repository.find_by_id(PROJECTS, project_id or "")
    if project is None:
        return None
    if not is_project_manager(project_id, user_id):
        return "Forbidden"

    columns = repository.find_many(COLUMNS, {"projectId": project_id})
    if not columns:
        return None

    repository.insert_one(
        COLUMNS,
        {
            "columnName": data["columnName"],
            "projectId": project_id,
            "index": len(columns),
        },
    )
    return "Column created"


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
    if not is_project_manager(str(from_column.get("projectId")), user_id):
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
    if not is_project_manager(str(column.get("projectId")), user_id):
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
