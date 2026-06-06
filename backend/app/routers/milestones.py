from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import milestone_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_milestones(
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[list, str]:
    result = milestone_service.get(projectId, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result == "Project not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    return result


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_milestone(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "projectId": "Project ID cannot be empty",
            "name": "Milestone name cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = milestone_service.create(data, current_user_id(payload))
    if result == "Milestone created":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, result or "Project not found")


@router.put("/", status_code=status.HTTP_200_OK)
def update_milestone(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = milestone_service.update(
        data.get("_id"), data, current_user_id(payload)
    )
    if result == "Milestone updated":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, result or "Milestone not found")


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_milestone(
    milestoneId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    if milestoneId is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Lack of milestone information")

    result = milestone_service.remove(milestoneId, current_user_id(payload))
    if result == "Milestone deleted":
        return result
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, result or "Milestone not found")
