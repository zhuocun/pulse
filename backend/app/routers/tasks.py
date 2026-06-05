from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import task_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_tasks(
    projectId: Optional[str] = Query(default=None),
    includeArchived: bool = Query(default=False),
    includeTrashed: bool = Query(default=False),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> List[Dict[str, Any]]:
    if projectId is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Lack of project information")

    user_id = current_user_id(payload)
    # Archived/trashed tasks are excluded by default (PRD §5.4/§5.5); the
    # opt-in flags widen the read so the archive/trash views can show them.
    result = task_service.get(
        projectId,
        user_id,
        include_archived=includeArchived,
        include_trashed=includeTrashed,
    )
    if isinstance(result, str):
        if result == "Column not found":
            api_error(status.HTTP_404_NOT_FOUND, result)
        if result == "Project not found":
            api_error(status.HTTP_404_NOT_FOUND, result)
        if result == "Forbidden":
            api_error(status.HTTP_403_FORBIDDEN, result)
        api_error(status.HTTP_400_BAD_REQUEST, result)
    return result


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_task(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    # Only the routing/identity fields are mandatory at the wire. ``type``,
    # ``epic``, ``storyPoints`` and ``note`` are filled with sensible
    # defaults by ``task_service.create`` so quick-add from a column can
    # post just ``{taskName, projectId, columnId, coordinatorId}`` without
    # the FE writing canned template strings the user must immediately
    # undo.
    messages = {
        "projectId": "Project ID cannot be empty",
        "columnId": "Column ID cannot be empty",
        "taskName": "Task name cannot be empty",
    }
    errors = required_body_errors(data, messages)
    errors.extend(task_service.create_validation_errors(data))
    if errors:
        validation_errors(errors)

    result = task_service.create(data, current_user_id(payload))
    if result is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Lack of task information")
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    return result


@router.put("/", status_code=status.HTTP_200_OK)
def update_task(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = task_service.update_validation_errors(data)
    if errors:
        validation_errors(errors)

    result = task_service.update(data, current_user_id(payload))
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Task not found")
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result == "Blocked by dependencies":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    return result


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_task(
    taskId: Optional[str] = Query(default=None),
    purge: bool = Query(default=False),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    # Default DELETE soft-deletes (moves the task to trash, PRD §5.5);
    # ``?purge=true`` keeps the legacy hard delete (orphan children +
    # re-pack indexes). Both return "Task deleted" so the contract is
    # unchanged.
    result = task_service.remove(taskId, current_user_id(payload), purge=purge)
    if result == "Task deleted":
        return result
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Task not found")
    api_error(status.HTTP_400_BAD_REQUEST, result)


@router.put("/restore", status_code=status.HTTP_200_OK)
def restore_task(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    # Un-trash / un-archive a task (PRD §5.4/§5.5): clears both markers so a
    # restore from trash brings the task all the way back to the board.
    result = task_service.restore(data.get("_id"), current_user_id(payload))
    if result == "Task restored":
        return result
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, "Task not found")


@router.put("/archive", status_code=status.HTTP_200_OK)
def archive_task(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    # Archive / unarchive a task (PRD §5.4). Existence + access are checked
    # inside the service BEFORE ``archived`` is validated so a non-member
    # cannot probe a task's existence via a malformed body.
    result = task_service.archive(
        data.get("_id"), current_user_id(payload), data.get("archived")
    )
    if result == "Task archived":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, "Task not found")


@router.put("/bulk", status_code=status.HTTP_200_OK)
def bulk_update_tasks(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    # Fan-out metadata edit. ``task_service.bulk_update`` filters the
    # ``changes`` object down to the safe (non-positional) field set, so
    # ``columnId`` / ``projectId`` / ``index`` here are silently dropped
    # rather than honoured -- positional moves go through PUT /tasks/orders.
    result = task_service.bulk_update(data, current_user_id(payload))
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Task not found")
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result != "Tasks updated":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    return result


@router.put("/orders", status_code=status.HTTP_200_OK)
def reorder_tasks(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[str, Dict[str, Any]]:
    result = task_service.reorder(data, current_user_id(payload))
    if result is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Bad request")
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result == "Blocked by dependencies":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    return result
