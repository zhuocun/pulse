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


# ---------------------------------------------------------------------------
# Project membership / RBAC
#
# Same collection-root, id-in-body convention as the handlers above. The
# service returns string sentinels which we map to HTTP status codes; the
# mapping mirrors the existing handlers exactly so error envelopes stay
# uniform. ``list_members`` returns the roster (a list) on success.
# ---------------------------------------------------------------------------


@router.get("/members", status_code=status.HTTP_200_OK)
def list_project_members(
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[list, str]:
    result = project_service.list_members(projectId, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result == "Project not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    return result


@router.post("/members", status_code=status.HTTP_201_CREATED)
def add_project_member(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "projectId": "Project id cannot be empty",
            "userId": "User id cannot be empty",
            "role": "Role cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = project_service.add_member(
        data.get("projectId"),
        current_user_id(payload),
        data.get("userId"),
        data.get("role"),
    )
    if result == "Member added":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(
        status.HTTP_404_NOT_FOUND,
        result or "Project not found",
    )


@router.put("/members", status_code=status.HTTP_200_OK)
def update_project_member(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "projectId": "Project id cannot be empty",
            "userId": "User id cannot be empty",
            "role": "Role cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = project_service.update_member_role(
        data.get("projectId"),
        current_user_id(payload),
        data.get("userId"),
        data.get("role"),
    )
    if result == "Member updated":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(
        status.HTTP_404_NOT_FOUND,
        result or "Project not found",
    )


@router.delete("/members", status_code=status.HTTP_200_OK)
def remove_project_member(
    projectId: Optional[str] = Query(default=None),
    userId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = project_service.remove_member(
        projectId,
        current_user_id(payload),
        userId,
    )
    if result == "Member removed":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(
        status.HTTP_404_NOT_FOUND,
        result or "Project not found",
    )
