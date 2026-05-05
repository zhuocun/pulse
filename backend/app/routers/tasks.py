from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import task_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_tasks(
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> List[Dict[str, Any]]:
    if projectId is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Lack of project information")

    user_id = current_user_id(payload)
    result = task_service.get(projectId, user_id)
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
    messages = {
        "projectId": "Project ID cannot be empty",
        "columnId": "Column ID cannot be empty",
        "epic": "Epic cannot be empty",
        "storyPoints": "Story points cannot be empty",
        "taskName": "Task name cannot be empty",
        "type": "Task type cannot be empty",
        "note": "Task note cannot be empty",
    }
    errors = required_body_errors(data, messages)
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
    result = task_service.update(data, current_user_id(payload))
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Task not found")
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    return result


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_task(
    taskId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = task_service.remove(taskId, current_user_id(payload))
    if result == "Task deleted":
        return result
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_400_BAD_REQUEST, result)


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
    return result
