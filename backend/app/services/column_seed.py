from typing import Any, Dict, List

from app.database import COLUMNS
from app.repositories import repository

DEFAULT_COLUMNS: tuple[str, ...] = ("To Do", "In Progress", "Done")

# Stored "done" semantics for the seeded defaults. Keyed by the default
# ``columnName`` so the names/order above stay the single source of truth
# (``task_service`` still indexes ``DEFAULT_COLUMNS[0]``); the persisted
# ``category`` is what done-ness reads from going forward.
DEFAULT_COLUMN_CATEGORIES: Dict[str, str] = {
    "To Do": "todo",
    "In Progress": "in_progress",
    "Done": "done",
}


def ensure_default_columns(project_id: str) -> List[Dict[str, Any]]:
    columns = repository.find_many(COLUMNS, {"projectId": project_id})
    if columns:
        return columns

    # Legacy projects may predate project-create seeding; keep reads self-healing.
    for index, column_name in enumerate(DEFAULT_COLUMNS):
        repository.insert_one(
            COLUMNS,
            {
                "columnName": column_name,
                "projectId": project_id,
                "index": index,
                "category": DEFAULT_COLUMN_CATEGORIES[column_name],
            },
        )
    return repository.find_many(COLUMNS, {"projectId": project_id})
