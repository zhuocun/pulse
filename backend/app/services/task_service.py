from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS, USERS
from app.domain.ordering import task_reorder_updates
from app.repositories import repository
from app.services.board_service import DEFAULT_COLUMNS
from app.services.project_service import is_project_manager
from app.validation import sorted_by_index

# Fields a manager may write via PUT /tasks. Repository-managed fields
# (``_id`` / ``createdAt`` / ``updatedAt``) and ordering-managed fields
# (``index``) are excluded so a malformed body cannot corrupt position
# or rewrite history. Keep this aligned with ``TABLE_FIELDS[TASKS]``.
_TASK_UPDATE_FIELDS = frozenset(
    {
        "taskName",
        "note",
        "type",
        "epic",
        "storyPoints",
        "coordinatorId",
        "columnId",
        "projectId",
    }
)


def _same_project(*items: Dict[str, Any]) -> bool:
    project_ids = {
        str(item.get("projectId")) for item in items if item.get("projectId")
    }
    return len(project_ids) == 1


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    column_id = data.get("columnId")
    coordinator_id = data.get("coordinatorId")
    project_id = data.get("projectId")

    column = repository.find_by_id(COLUMNS, column_id or "")
    project = repository.find_by_id(PROJECTS, project_id or "")
    if (
        column is None
        or repository.find_by_id(USERS, coordinator_id or "") is None
        or project is None
        or str(column.get("projectId")) != str(project_id)
    ):
        return None
    if not is_project_manager(project_id, user_id):
        return "Forbidden"

    tasks = repository.find_many(TASKS, {"columnId": column_id})
    repository.insert_one(
        TASKS,
        {
            "columnId": column_id,
            "coordinatorId": coordinator_id,
            "epic": data["epic"],
            "taskName": data["taskName"],
            "type": data["type"],
            "note": data["note"],
            "projectId": project_id,
            "storyPoints": data["storyPoints"],
            "index": len(tasks),
        },
    )
    return "Task created"


def get(project_id: str, user_id: str) -> Union[List[Dict[str, Any]], str]:
    if repository.find_by_id(PROJECTS, project_id) is None:
        return "Project not found"
    if not is_project_manager(project_id, user_id):
        return "Forbidden"

    columns = repository.find_many(COLUMNS, {"projectId": project_id})
    if not columns:
        return "Column not found"

    tasks = repository.find_many(TASKS, {"projectId": project_id})
    if not tasks:
        # Sort columns by ``index`` before falling back to ``columns[0]``
        # so the seed lands in the lowest-index column on backends that
        # do not preserve insertion order (Postgres in particular).
        sorted_columns = sorted_by_index(columns)
        todo_column = next(
            (
                column
                for column in sorted_columns
                if column.get("columnName") == DEFAULT_COLUMNS[0]
            ),
            sorted_columns[0],
        )
        repository.insert_one(
            TASKS,
            {
                "columnId": str(todo_column["_id"]),
                "projectId": project_id,
                "taskName": "Default Task",
                "coordinatorId": user_id,
                "epic": "Default epic",
                "type": "Task",
                "note": "No note yet",
                "storyPoints": 1,
                "index": 0,
            },
        )
        tasks = repository.find_many(TASKS, {"projectId": project_id})

    return repository.serialize_documents(sorted_by_index(tasks))


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    task_id = data.get("_id")
    task = repository.find_by_id(TASKS, task_id or "")
    if not task_id or task is None:
        return None
    if not is_project_manager(task.get("projectId"), user_id):
        return "Forbidden"

    project_id = data.get("projectId", task.get("projectId"))
    column_id = data.get("columnId", task.get("columnId"))
    coordinator_id = data.get("coordinatorId", task.get("coordinatorId"))
    column = repository.find_by_id(COLUMNS, column_id or "")
    if (
        repository.find_by_id(PROJECTS, project_id or "") is None
        or column is None
        or repository.find_by_id(USERS, coordinator_id or "") is None
        or str(column.get("projectId")) != str(project_id)
    ):
        return None
    if not is_project_manager(project_id, user_id):
        return "Forbidden"

    payload = {key: value for key, value in data.items() if key in _TASK_UPDATE_FIELDS}
    repository.update_by_id(TASKS, task_id, payload)
    return "Task updated"


def remove(task_id: Optional[str], user_id: str) -> Optional[str]:
    if task_id is None:
        return "Lack of task information"
    task = repository.find_by_id(TASKS, task_id)
    if task is None:
        return None
    if not is_project_manager(task.get("projectId"), user_id):
        return "Forbidden"
    column_id = task.get("columnId")
    deleted_index = task.get("index")
    repository.delete_by_id(TASKS, task_id)
    # Re-pack so the remaining tasks keep contiguous indexes; otherwise
    # subsequent reorders shift around a hole and create duplicate or
    # off-by-one indexes (the ``task_reorder_updates`` algorithm assumes
    # contiguous numbering).
    if isinstance(deleted_index, int) and column_id:
        for sibling in repository.find_many(TASKS, {"columnId": column_id}):
            sibling_index = sibling.get("index")
            if isinstance(sibling_index, int) and sibling_index > deleted_index:
                repository.update_by_id(
                    TASKS, str(sibling["_id"]), {"index": sibling_index - 1}
                )
    return "Task deleted"


def reorder(data: Dict[str, Any], user_id: str) -> Optional[str]:
    order_type = data.get("type")
    from_id = data.get("fromId")
    reference_id = data.get("referenceId")
    from_column_id = data.get("fromColumnId")
    reference_column_id = data.get("referenceColumnId")

    from_column = repository.find_by_id(COLUMNS, from_column_id or "")
    reference_column = repository.find_by_id(COLUMNS, reference_column_id or "")
    from_task = repository.find_by_id(TASKS, from_id or "")
    reference_task = (
        repository.find_by_id(TASKS, reference_id or "") if reference_id else None
    )

    if (
        from_column is None
        or reference_column is None
        or from_task is None
        or (reference_id is not None and reference_task is None)
    ):
        return None

    related = [from_column, reference_column, from_task]
    if reference_task is not None:
        related.append(reference_task)
    if not _same_project(*related):
        return None
    if not is_project_manager(from_task.get("projectId"), user_id):
        return "Forbidden"
    if str(from_task.get("columnId")) != str(from_column_id) or (
        reference_task is not None
        and str(reference_task.get("columnId")) != str(reference_column_id)
    ):
        return None

    from_column_tasks = repository.find_many(TASKS, {"columnId": from_column_id})
    reference_column_tasks = repository.find_many(
        TASKS, {"columnId": reference_column_id}
    )

    updates = task_reorder_updates(
        order_type,
        from_column_id,
        reference_column_id,
        from_task,
        reference_task,
        from_column_tasks,
        reference_column_tasks,
    )
    if updates is None:
        return None

    for update in updates:
        repository.update_by_id(TASKS, update.item_id, update.changes)
    return "Task reordered"
