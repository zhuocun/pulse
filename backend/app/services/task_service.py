import math
from typing import Any, Dict, List, Optional, Union

from app.database import COLUMNS, PROJECTS, TASKS, USERS, now
from app.domain.ordering import task_reorder_updates
from app.repositories import repository
from app.services.column_seed import DEFAULT_COLUMNS
from app.services.project_service import ROLE_EDITOR, ROLE_VIEWER, can_access
from app.validation import body_error, sorted_by_index, validation_errors

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
        "startDate",
        "dueDate",
        "labelIds",
        "assigneeIds",
        "parentTaskId",
        "dependsOn",
        "priority",
    }
)

# Bulk-editable metadata: every PUT-writable field EXCEPT the positional
# routing fields. ``columnId`` / ``projectId`` are deliberately excluded
# so a bulk edit can never move a task between columns/projects (those
# go through ``reorder`` / single ``update`` where index re-packing and
# project re-validation happen). ``index`` is repository-managed and was
# never in ``_TASK_UPDATE_FIELDS`` to begin with. ``dependsOn`` is also
# excluded (AC-W5): fanning one prerequisite set across many tasks is
# almost always wrong and makes the per-task cycle check ambiguous (the
# same edge added to N tasks could close a cycle for some and not others),
# so dependency edges are set one task at a time via single ``update``.
_BULK_CHANGE_FIELDS = _TASK_UPDATE_FIELDS - {"columnId", "projectId", "dependsOn"}


def _same_project(*items: Dict[str, Any]) -> bool:
    project_ids = {
        str(item.get("projectId")) for item in items if item.get("projectId")
    }
    return len(project_ids) == 1


def _story_points_error(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    story_points = data.get("storyPoints")
    if (
        not isinstance(story_points, (int, float))
        or isinstance(story_points, bool)
        or not math.isfinite(story_points)
        or story_points <= 0
    ):
        return body_error(
            data, "storyPoints", "Story points must be a positive number"
        )
    return None


# Allowed ``priority`` enum values, lowest → highest urgency. The derived
# rank (urgent=4 … none=0) used for sorting is the index into this tuple; it
# is computed server-side only and never stored (PRD §3.2).
_PRIORITY_VALUES = ("none", "low", "medium", "high", "urgent")


def _priority_error(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """``priority`` must be one of the five-member enum when sent.

    Mirrors ``_story_points_error``: only checked when the key is present,
    rejects any value outside the enum with the standard ``"Bad request"``
    400 body error (PRD AC-W1)."""

    if "priority" not in data:
        return None
    if data.get("priority") not in _PRIORITY_VALUES:
        return body_error(data, "priority", "Bad request")
    return None


def _date_error(data: Dict[str, Any], field: str) -> Optional[Dict[str, Any]]:
    """Light ISO-date validation: when present and non-empty it must be a
    string. We do not parse the calendar value here -- the column card and
    brief render whatever string the client supplies, and a stricter
    format check belongs at the edge, not in the write path."""

    value = data.get(field)
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        return body_error(data, field, f"{field} must be an ISO date string")
    return None


def _id_list_error(data: Dict[str, Any], field: str) -> Optional[Dict[str, Any]]:
    """``labelIds`` / ``assigneeIds`` must be a list of strings when sent."""

    if field not in data:
        return None
    value = data.get(field)
    if not isinstance(value, list) or any(
        not isinstance(item, str) for item in value
    ):
        return body_error(data, field, f"{field} must be a list of ids")
    return None


def _metadata_errors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Shape checks shared by create + update for the new richness fields.

    ``parentTaskId`` is intentionally excluded here: it needs the task's
    own id and project context, so it is validated separately by the
    create/update paths via ``_parent_task_error``."""

    errors: List[Dict[str, Any]] = []
    for field in ("startDate", "dueDate"):
        error = _date_error(data, field)
        if error is not None:
            errors.append(error)
    for field in ("labelIds", "assigneeIds"):
        error = _id_list_error(data, field)
        if error is not None:
            errors.append(error)
    return errors


def _parent_task_error(
    data: Dict[str, Any],
    project_id: Optional[str],
    task_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Validate ``parentTaskId`` against the task's project + own id.

    The parent must exist, live in the same ``project_id`` as the child,
    and not be the child itself (no self-parent). Clearing the parent
    (``None`` / ``""``) is always allowed. One level of nesting is enough
    for the board, so we stop at the self-reference guard rather than
    walking an ancestor chain."""

    if "parentTaskId" not in data:
        return None
    parent_id = data.get("parentTaskId")
    if parent_id in (None, ""):
        return None
    if task_id is not None and str(parent_id) == str(task_id):
        return body_error(data, "parentTaskId", "A task cannot be its own parent")
    parent = repository.find_by_id(TASKS, str(parent_id))
    if parent is None or str(parent.get("projectId")) != str(project_id):
        return body_error(
            data, "parentTaskId", "Parent task must exist in the same project"
        )
    return None


def _depends_on_error(
    data: Dict[str, Any],
    project_id: Optional[str],
    task_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Validate ``dependsOn`` (the prerequisite edge-list) for one task.

    Present-only, like ``_priority_error`` / ``_parent_task_error``: skipped
    unless the key is sent. The value must be a ``list`` of ``str`` task ids;
    each id must reference a task that EXISTS in the SAME ``project_id`` and
    must not be the task ITSELF (no self-dependency, checked only when
    ``task_id`` is known). ``dependsOn`` is a DAG (arbitrary depth, distinct
    from the one-level ``parentTaskId`` tree), so adding ``task_id -> d`` for
    each ``d`` must keep the graph ACYCLIC (AC-W4): the cycle guard only runs
    when ``task_id`` is not None because a brand-new task on create has no
    inbound edges yet, so no cycle is reachable. Returns the FIRST error found
    (single ``body_error``, matching the other validators' shape) or ``None``
    when every id passes."""

    if "dependsOn" not in data:
        return None
    depends_on = data.get("dependsOn")
    if not isinstance(depends_on, list) or any(
        not isinstance(item, str) for item in depends_on
    ):
        return body_error(data, "dependsOn", "dependsOn must be a list of task ids")

    # Shape + existence/same-project + self checks per id (cheap, no scan).
    for dependency_id in depends_on:
        if task_id is not None and str(dependency_id) == str(task_id):
            return body_error(
                data, "dependsOn", "A task cannot depend on itself"
            )
        dependency = repository.find_by_id(TASKS, str(dependency_id))
        if dependency is None or str(dependency.get("projectId")) != str(project_id):
            return body_error(
                data, "dependsOn", "Dependency must exist in the same project"
            )

    # Cycle guard: only meaningful once the task exists and can be reached.
    # Build the project's ``dependsOn`` graph once via a single exact-equality
    # scan (FakeStore/Mongo accept ``{"projectId": ...}``; no operator dicts).
    # Adding ``task_id -> d`` closes a cycle iff ``d`` already (transitively)
    # depends on ``task_id``, so DFS from each ``d`` along ``dependsOn`` and
    # reject if ``task_id`` is reachable. A visited set bounds the walk.
    if task_id is not None:
        graph = {
            str(task["_id"]): [str(edge) for edge in (task.get("dependsOn") or [])]
            for task in repository.find_many(TASKS, {"projectId": project_id})
        }
        for dependency_id in depends_on:
            stack = [str(dependency_id)]
            visited: set[str] = set()
            while stack:
                current = stack.pop()
                if current == str(task_id):
                    return body_error(
                        data, "dependsOn", "Dependency cycle detected"
                    )
                if current in visited:
                    continue
                visited.add(current)
                stack.extend(graph.get(current, []))
    return None


def _dependency_gate_blocks(
    depends_on: Optional[List[Any]],
    project_id: Optional[str],
    source_column: Optional[Dict[str, Any]],
    target_column: Optional[Dict[str, Any]],
    force: bool,
) -> bool:
    """True if a move should be gated: entering a done column (source not
    done, target done) while >=1 prerequisite in ``depends_on`` is unfinished
    (its own column is not done), the project's gate is not disabled, and the
    caller did not pass ``force``. PRD work-management-depth §4.3 / AC-W6."""
    if force:
        return False
    if (target_column or {}).get("category") != "done":
        return False                       # not moving into a done column
    if (source_column or {}).get("category") == "done":
        return False                       # already done -> not a transition
    project = repository.find_by_id(PROJECTS, str(project_id or ""))
    if project is not None and project.get("enforceDependencyGate") is False:
        return False                       # gate explicitly disabled for project
    for dependency_id in depends_on or []:
        dependency = repository.find_by_id(TASKS, str(dependency_id))
        if dependency is None:
            continue                       # dangling prerequisite -> ignore
        dependency_column = repository.find_by_id(
            COLUMNS, str(dependency.get("columnId") or "")
        )
        if (dependency_column or {}).get("category") != "done":
            return True                    # an unfinished prerequisite blocks the move
    return False


def create_validation_errors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    errors = _metadata_errors(data)
    if "storyPoints" in data:
        error = _story_points_error(data)
        if error is not None:
            errors.append(error)
    priority_error = _priority_error(data)
    if priority_error is not None:
        errors.append(priority_error)
    error = _parent_task_error(data, data.get("projectId"))
    if error is not None:
        errors.append(error)
    # ``task_id`` is None: a not-yet-created task has no inbound edges, so this
    # only enforces existence/same-project/shape -- no cycle is possible yet.
    depends_on_error = _depends_on_error(data, data.get("projectId"))
    if depends_on_error is not None:
        errors.append(depends_on_error)
    return errors


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
    # Write path: editor or owner.
    if not can_access(project, user_id, ROLE_EDITOR):
        return "Forbidden"

    tasks = repository.find_many(TASKS, {"columnId": column_id})
    # ``epic`` / ``type`` / ``note`` / ``storyPoints`` are optional at the
    # wire: quick-add from a column only ships routing + name fields, and
    # the task modal can fill the rest later. Defaults below match the
    # legacy FE template (Task / 1 story point / empty epic + note) so
    # existing readers (column card, brief) don't have to handle missing
    # values.
    repository.insert_one(
        TASKS,
        {
            "columnId": column_id,
            "coordinatorId": coordinator_id,
            "epic": data.get("epic") or "",
            "taskName": data["taskName"],
            "type": data.get("type") or "Task",
            "note": data.get("note") or "",
            "projectId": project_id,
            "storyPoints": (
                data["storyPoints"]
                if isinstance(data.get("storyPoints"), (int, float))
                else 1
            ),
            "index": len(tasks),
            # Richness fields are optional at the wire: scheduling defaults
            # to empty strings and the id lists to empty so every reader
            # sees a uniform shape without handling missing keys.
            "startDate": data.get("startDate") or "",
            "dueDate": data.get("dueDate") or "",
            "labelIds": data.get("labelIds") or [],
            "assigneeIds": data.get("assigneeIds") or [],
            "parentTaskId": data.get("parentTaskId") or None,
            # Prerequisite edge-list defaults to empty so every reader sees a
            # uniform shape; a validated non-empty list (AC-W4) overrides it.
            "dependsOn": data.get("dependsOn") or [],
            # Urgency defaults to ``"none"`` so every reader sees a uniform
            # shape; a validated non-default value (PRD §3.2) overrides it.
            "priority": data.get("priority") or "none",
            # completedAt is server-managed (PRD 5.3 / AC-W8): set when the task
            # sits in a done-category column, else null. Never client-written.
            # Reusing be_tools._is_done_column's legacy name-fallback is a later
            # refinement.
            "completedAt": now() if column.get("category") == "done" else None,
        },
    )
    return "Task created"


def get(
    project_id: str,
    user_id: str,
    *,
    include_archived: bool = False,
    include_trashed: bool = False,
) -> Union[List[Dict[str, Any]], str]:
    """Load a project's tasks, excluding archived/trashed ones by default.

    Trashed (``deletedAt`` set) and archived (``archivedAt`` set) tasks are
    filtered OUT in Python unless ``include_trashed`` / ``include_archived``
    opt them back in (PRD §5.4/§5.5, AC-W9/W10/W11). The zero-tasks
    default-seed decision is made against the RAW task set, so a project
    whose only tasks are trashed/archived is NOT re-seeded (the row still
    exists, it is merely hidden). Filtering is done in Python because the
    repository/FakeStore only support exact-equality queries (no operator
    dicts).
    """

    if repository.find_by_id(PROJECTS, project_id) is None:
        return "Project not found"
    # Read path: any member (viewer and up) may load the task list.
    if not can_access(project_id, user_id, ROLE_VIEWER):
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

    # Default-exclude trashed/archived in Python (exact-equality store can't
    # express ``{"deletedAt": {"$ne": null}}``); the opt-in flags widen it.
    visible = [
        task
        for task in tasks
        if (include_trashed or task.get("deletedAt") is None)
        and (include_archived or task.get("archivedAt") is None)
    ]
    return repository.serialize_documents(sorted_by_index(visible))


def update_validation_errors(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    errors = _metadata_errors(data)
    if "taskName" in data:
        task_name = data.get("taskName")
        if not isinstance(task_name, str) or task_name == "":
            errors.append(body_error(data, "taskName", "Task name cannot be empty"))
    if "storyPoints" in data:
        error = _story_points_error(data)
        if error is not None:
            errors.append(error)
    priority_error = _priority_error(data)
    if priority_error is not None:
        errors.append(priority_error)
    return errors


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    task_id = data.get("_id")
    task = repository.find_by_id(TASKS, task_id or "")
    if not task_id or task is None:
        return None
    # Write path: editor or owner (checked against the task's current
    # project, then re-checked below against the target project).
    if not can_access(task.get("projectId"), user_id, ROLE_EDITOR):
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
    # Write path: editor or owner on the (possibly reassigned) project.
    if not can_access(project_id, user_id, ROLE_EDITOR):
        return "Forbidden"

    # ``parentTaskId`` needs the resolved project and the task's own id, so
    # it cannot be checked in the stateless ``update_validation_errors``
    # pass. Validate it here against the (possibly reassigned) project and
    # raise a 400 body error on a self-parent or cross-project parent.
    parent_error = _parent_task_error(data, project_id, task_id)
    if parent_error is not None:
        validation_errors([parent_error])

    # ``dependsOn`` likewise needs the resolved project + the task's own id
    # (for the self-edge and cycle guards), so it is validated here -- not in
    # the stateless ``update_validation_errors`` -- and raises a 400 before the
    # write on a self/cross-project/non-existent/cyclic dependency.
    dep_error = _depends_on_error(data, project_id, task_id)
    if dep_error is not None:
        validation_errors([dep_error])

    # Dependency move-to-done gate (PRD §4.3 / AC-W6): reject a move INTO a
    # done column while an unfinished prerequisite remains, unless ``force``
    # is sent or the project disabled the gate. ``column`` is the already
    # resolved TARGET column; ``effective_depends_on`` honors a simultaneous
    # ``dependsOn`` change in the same PUT (the validated value just checked
    # above) rather than the stale stored edges.
    source_column = repository.find_by_id(COLUMNS, str(task.get("columnId") or ""))
    effective_depends_on = data.get("dependsOn", task.get("dependsOn"))
    if _dependency_gate_blocks(
        effective_depends_on, project_id, source_column, column, bool(data.get("force"))
    ):
        return "Blocked by dependencies"

    payload = {key: value for key, value in data.items() if key in _TASK_UPDATE_FIELDS}
    # completedAt is server-managed (PRD 5.3 / AC-W8) and never client-written:
    # set it AFTER the allowlist filter (so a client-sent ``completedAt`` in the
    # body is dropped) against the destination ``column`` already resolved above.
    # Stamp on entering done, clear on leaving; leave an existing stamp untouched
    # while the task stays done (we record WHEN it was completed, not last-touched).
    # Reading ``column.get("category") == "done"`` directly mirrors
    # be_tools._is_done_column; reusing its legacy name-fallback is a later refinement.
    target_done = column.get("category") == "done"
    already_completed = task.get("completedAt") is not None
    if target_done and not already_completed:
        payload["completedAt"] = now()
    elif not target_done and already_completed:
        payload["completedAt"] = None
    repository.update_by_id(TASKS, task_id, payload)
    return "Task updated"


def remove(
    task_id: Optional[str], user_id: str, purge: bool = False
) -> Optional[str]:
    if task_id is None:
        return "Lack of task information"
    task = repository.find_by_id(TASKS, task_id)
    if task is None:
        return None
    # Write path: editor or owner.
    if not can_access(task.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"

    if not purge:
        # Default: soft delete (move to trash, PRD §5.5). Stamp ``deletedAt``
        # and leave everything else intact -- children are NOT orphaned and
        # sibling indexes are NOT re-packed, so a later ``restore`` brings the
        # task (and its sub-tree links / position) back losslessly. The
        # cascade + re-pack are deferred to the hard ``purge`` below.
        repository.update_by_id(TASKS, task_id, {"deletedAt": now()})
        return "Task deleted"

    # ``purge=True``: legacy hard delete. Orphan, do NOT cascade: deleting a
    # parent leaves its sub-tasks as top-level tasks rather than wiping a
    # whole branch out from under the user. Exact-match query on
    # ``parentTaskId`` (FakeStore-compatible).
    for child in repository.find_many(TASKS, {"parentTaskId": task_id}):
        repository.update_by_id(TASKS, str(child["_id"]), {"parentTaskId": None})
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


def restore(task_id: Optional[str], user_id: str) -> Optional[str]:
    """Un-trash / un-archive a task (PRD §5.4/§5.5).

    Clears BOTH ``deletedAt`` and ``archivedAt`` so a restore from trash
    brings the task all the way back to the active board in one step.
    Returns ``None`` (router -> 404) when the id is missing/unknown,
    ``"Forbidden"`` when the caller lacks editor rights, else
    ``"Task restored"``.
    """

    if task_id is None:
        return None
    task = repository.find_by_id(TASKS, task_id)
    if task is None:
        return None
    # Write path: editor or owner.
    if not can_access(task.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"
    repository.update_by_id(TASKS, task_id, {"deletedAt": None, "archivedAt": None})
    return "Task restored"


def archive(task_id: Optional[str], user_id: str, archived: Any) -> Optional[str]:
    """Archive / unarchive a task (PRD §5.4).

    Stamps ``archivedAt`` (archive) or clears it (unarchive) based on the
    boolean ``archived`` flag. Existence + access are checked BEFORE the
    body is validated so a non-member cannot probe a task's existence via a
    malformed payload. Returns ``None`` (router -> 404) when the id is
    missing/unknown, ``"Forbidden"`` when the caller lacks editor rights,
    ``"Bad request"`` when ``archived`` is not a bool, else
    ``"Task archived"``.
    """

    if task_id is None:
        return None
    task = repository.find_by_id(TASKS, task_id)
    if task is None:
        return None
    # Write path: editor or owner -- checked before body validation so a
    # non-member can't probe existence with a malformed ``archived``.
    if not can_access(task.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"
    if not isinstance(archived, bool):
        return "Bad request"
    repository.update_by_id(
        TASKS, task_id, {"archivedAt": now() if archived else None}
    )
    return "Task archived"


def reorder(data: Dict[str, Any], user_id: str) -> Optional[str]:
    order_type = data.get("type")
    from_id = data.get("fromId")
    reference_id = data.get("referenceId") or None
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
    # Write path: editor or owner.
    if not can_access(from_task.get("projectId"), user_id, ROLE_EDITOR):
        return "Forbidden"
    if str(from_task.get("columnId")) != str(from_column_id) or (
        reference_task is not None
        and str(reference_task.get("columnId")) != str(reference_column_id)
    ):
        return None

    # Dependency move-to-done gate (PRD §4.3 / AC-W6): reject a drag INTO a
    # done column while an unfinished prerequisite remains, unless ``force``
    # is sent or the project disabled the gate. ``from_column`` is the source
    # and ``reference_column`` the destination (matching the L1 destination
    # resolution); a within-done reorder is NOT gated (source already done).
    if _dependency_gate_blocks(
        from_task.get("dependsOn"),
        from_task.get("projectId"),
        from_column,
        reference_column,
        bool(data.get("force")),
    ):
        return "Blocked by dependencies"

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

    # completedAt is server-managed (PRD 5.3 / AC-W8): reconcile the moved task
    # against its DESTINATION column. ``task_reorder_updates`` rewrites the moved
    # task's ``columnId`` to the reference column only on a cross-column move (a
    # same-column reorder touches ``index`` alone), so resolve the destination
    # AUTHORITATIVELY from the moved task's own ``columnId`` after the updates are
    # applied rather than assuming ``reference_column``. Reusing
    # be_tools._is_done_column's legacy name-fallback is a later refinement.
    moved = repository.find_by_id(TASKS, str(from_task["_id"]))
    if moved is not None:
        dest_column = repository.find_by_id(COLUMNS, str(moved.get("columnId") or ""))
        dest_done = dest_column is not None and dest_column.get("category") == "done"
        already_completed = moved.get("completedAt") is not None
        if dest_done and not already_completed:
            repository.update_by_id(TASKS, str(moved["_id"]), {"completedAt": now()})
        elif not dest_done and already_completed:
            repository.update_by_id(TASKS, str(moved["_id"]), {"completedAt": None})
    return "Task reordered"


def bulk_update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    """Apply one set of metadata ``changes`` to many tasks at once.

    Only the non-positional subset of ``_TASK_UPDATE_FIELDS`` is editable
    here (``_BULK_CHANGE_FIELDS`` excludes ``columnId`` / ``projectId``):
    moving a task between columns or projects re-packs ``index`` and
    re-validates routing, which a fan-out edit deliberately must not do.
    Unknown / disallowed keys in ``changes`` are dropped rather than
    rejected so a client can send a wider patch object and trust the
    server to keep only the safe fields.

    Returns ``None`` (router -> 404) if any id is missing, ``"Forbidden"``
    if the caller lacks editor rights on any task's project, and only
    applies anything once every task has passed both checks (all-or-nothing
    on validation; the writes themselves are best-effort sequential).
    """

    task_ids = data.get("taskIds")
    changes = data.get("changes")
    if not isinstance(task_ids, list) or not task_ids:
        return "Bad request"
    if not isinstance(changes, dict):
        return "Bad request"

    filtered = {
        key: value for key, value in changes.items() if key in _BULK_CHANGE_FIELDS
    }
    if not filtered:
        return "Bad request"

    # Load every target up front: a single unknown id fails the whole
    # batch (404) before any write lands, so a typo can't partially apply.
    tasks: List[Dict[str, Any]] = []
    for task_id in task_ids:
        task = repository.find_by_id(TASKS, str(task_id))
        if task is None:
            return None
        tasks.append(task)

    # Write path: editor or owner on EVERY task's project. Checked across
    # the full set before mutating so a forbidden member can't slip an edit
    # onto the tasks they do happen to control.
    for task in tasks:
        if not can_access(task.get("projectId"), user_id, ROLE_EDITOR):
            return "Forbidden"

    # Bulk must enforce the same field invariants as the single-task path
    # -- it is not a back door around date/label shape, story points,
    # coordinator existence, or parent-task validation.
    shape_errors = _metadata_errors(filtered)
    if "storyPoints" in filtered:
        story_error = _story_points_error(filtered)
        if story_error is not None:
            shape_errors.append(story_error)
    priority_error = _priority_error(filtered)
    if priority_error is not None:
        shape_errors.append(priority_error)
    if shape_errors:
        return "Bad request"
    if "coordinatorId" in filtered and (
        not filtered["coordinatorId"]
        or repository.find_by_id(USERS, str(filtered["coordinatorId"])) is None
    ):
        return "Bad request"
    if "parentTaskId" in filtered:
        # The parent must be same-project as each target and not the
        # target itself -- enforced per task, not just for the first.
        for task in tasks:
            if (
                _parent_task_error(filtered, task.get("projectId"), str(task["_id"]))
                is not None
            ):
                return "Bad request"

    for task in tasks:
        repository.update_by_id(TASKS, str(task["_id"]), filtered)
    return "Tasks updated"
