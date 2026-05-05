from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ReorderUpdate:
    item_id: str
    changes: Dict[str, Any]


def column_reorder_updates(
    order_type: Optional[str],
    from_column: Dict[str, Any],
    reference_column: Dict[str, Any],
    columns: List[Dict[str, Any]],
) -> Optional[List[ReorderUpdate]]:
    # Moving a column relative to itself is a no-op. Without this guard
    # the algorithm produces contradictory index updates (e.g. set the
    # same row to ``idx`` and ``idx+1``) and corrupts the column order.
    if str(from_column["_id"]) == str(reference_column["_id"]):
        return []

    if order_type == "before":
        updates = [
            ReorderUpdate(str(column["_id"]), {"index": column["index"] + 1})
            for column in columns
            if reference_column["index"] < column["index"] < from_column["index"]
        ]
        updates.append(
            ReorderUpdate(str(from_column["_id"]), {"index": reference_column["index"]})
        )
        updates.append(
            ReorderUpdate(
                str(reference_column["_id"]),
                {"index": reference_column["index"] + 1},
            )
        )
        return updates

    if order_type == "after":
        updates = [
            ReorderUpdate(str(column["_id"]), {"index": column["index"] - 1})
            for column in columns
            if from_column["index"] < column["index"] < reference_column["index"]
        ]
        updates.append(
            ReorderUpdate(
                str(reference_column["_id"]),
                {"index": reference_column["index"] - 1},
            )
        )
        updates.append(
            ReorderUpdate(str(from_column["_id"]), {"index": reference_column["index"]})
        )
        return updates

    return None


def task_reorder_updates(
    order_type: Optional[str],
    from_column_id: Optional[str],
    reference_column_id: Optional[str],
    from_task: Dict[str, Any],
    reference_task: Optional[Dict[str, Any]],
    from_column_tasks: List[Dict[str, Any]],
    reference_column_tasks: List[Dict[str, Any]],
) -> Optional[List[ReorderUpdate]]:
    if from_column_id != reference_column_id:
        updates = [
            ReorderUpdate(str(task["_id"]), {"index": task["index"] - 1})
            for task in from_column_tasks
            if task["index"] > from_task["index"]
        ]

        if reference_task is not None:
            # Honour ``before`` vs ``after`` semantics so a cross-column
            # drop on the trailing edge of the reference card lands one
            # slot below it instead of silently coalescing to ``before``.
            insert_index = reference_task["index"]
            shift_threshold = reference_task["index"]
            if order_type == "after":
                insert_index = reference_task["index"] + 1
                shift_threshold = reference_task["index"] + 1
            updates.extend(
                ReorderUpdate(str(task["_id"]), {"index": task["index"] + 1})
                for task in reference_column_tasks
                if task["index"] >= shift_threshold
            )
            updates.append(
                ReorderUpdate(
                    str(from_task["_id"]),
                    {
                        "columnId": reference_column_id,
                        "index": insert_index,
                    },
                )
            )
        else:
            updates.append(
                ReorderUpdate(
                    str(from_task["_id"]),
                    {
                        "columnId": reference_column_id,
                        "index": len(reference_column_tasks),
                    },
                )
            )
        return updates

    # Same-column reorder: a self-move is a no-op. Same reasoning as the
    # column case -- without this guard the algorithm shifts an item
    # against itself and produces a duplicate-index state.
    if reference_task is not None and str(from_task["_id"]) == str(
        reference_task["_id"]
    ):
        return []

    if reference_task is None:
        return None

    if order_type == "before":
        updates = [
            ReorderUpdate(str(task["_id"]), {"index": task["index"] + 1})
            for task in reference_column_tasks
            if reference_task["index"] < task["index"] < from_task["index"]
        ]
        updates.append(
            ReorderUpdate(str(from_task["_id"]), {"index": reference_task["index"]})
        )
        updates.append(
            ReorderUpdate(
                str(reference_task["_id"]),
                {"index": reference_task["index"] + 1},
            )
        )
        return updates

    if order_type == "after":
        updates = [
            ReorderUpdate(str(task["_id"]), {"index": task["index"] - 1})
            for task in reference_column_tasks
            if from_task["index"] < task["index"] < reference_task["index"]
        ]
        updates.append(
            ReorderUpdate(
                str(reference_task["_id"]),
                {"index": reference_task["index"] - 1},
            )
        )
        updates.append(
            ReorderUpdate(str(from_task["_id"]), {"index": reference_task["index"]})
        )
        return updates

    return None
