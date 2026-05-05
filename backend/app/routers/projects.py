from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import project_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_project(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "projectName": "Project name cannot be empty",
            "organization": "Organization cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    return project_service.create(data, current_user_id(payload))


@router.get("/", status_code=status.HTTP_200_OK)
def get_projects(
    projectName: Optional[str] = Query(default=None),
    managerId: Optional[str] = Query(default=None),
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[Dict[str, Any], list]:
    result = project_service.get(
        projectId,
        projectName,
        managerId,
        viewer_id=current_user_id(payload),
    )
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Project(s) not found")
    return result


@router.put("/", status_code=status.HTTP_200_OK)
def update_project(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = project_service.update(data, current_user_id(payload))
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result in (None, "Manager not found"):
        api_error(status.HTTP_404_NOT_FOUND, result or "Project not found")
    return result


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_project(
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = project_service.remove(projectId, current_user_id(payload))
    if result == "Project deleted":
        return result
    if result == "Project not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_400_BAD_REQUEST, result or "Bad request")
