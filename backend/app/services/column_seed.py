from typing import Any, Dict, List

from app.database import COLUMNS
from app.repositories import repository

DEFAULT_COLUMNS: tuple[str, ...] = ("To Do", "In Progress", "Done")


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
            },
        )
    return repository.find_many(COLUMNS, {"projectId": project_id})
