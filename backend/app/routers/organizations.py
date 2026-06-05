from typing import Any, Dict, Optional, Union

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import organization_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_organization(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "name": "Name cannot be empty",
            "slug": "Slug cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = organization_service.create(
        data.get("name"),
        data.get("slug"),
        current_user_id(payload),
    )
    if result == "Organization created":
        return result
    api_error(status.HTTP_400_BAD_REQUEST, result or "Bad request")


@router.get("/", status_code=status.HTTP_200_OK)
def get_organizations(
    organizationId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[Dict[str, Any], list]:
    result = organization_service.get(
        current_user_id(payload),
        organizationId,
    )
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Organization(s) not found")
    return result


@router.put("/", status_code=status.HTTP_200_OK)
def update_organization(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = organization_service.update(
        data.get("_id"),
        current_user_id(payload),
        data,
    )
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Organization not found")
    return result


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_organization(
    organizationId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = organization_service.remove(organizationId, current_user_id(payload))
    if result == "Organization deleted":
        return result
    if result == "Organization not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_400_BAD_REQUEST, result or "Bad request")


# ---------------------------------------------------------------------------
# Organization membership / RBAC
#
# Same collection-root, id-in-body convention as the handlers above. The
# service returns string sentinels which we map to HTTP status codes; the
# mapping mirrors the project membership handlers exactly so error
# envelopes stay uniform. ``list_members`` returns the roster (a list) on
# success.
# ---------------------------------------------------------------------------


@router.get("/members", status_code=status.HTTP_200_OK)
def list_organization_members(
    organizationId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[list, str]:
    result = organization_service.list_members(
        organizationId, current_user_id(payload)
    )
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result == "Organization not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    return result


@router.post("/members", status_code=status.HTTP_201_CREATED)
def add_organization_member(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "organizationId": "Organization id cannot be empty",
            "userId": "User id cannot be empty",
            "role": "Role cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = organization_service.add_member(
        data.get("organizationId"),
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
        result or "Organization not found",
    )


@router.put("/members", status_code=status.HTTP_200_OK)
def update_organization_member(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "organizationId": "Organization id cannot be empty",
            "userId": "User id cannot be empty",
            "role": "Role cannot be empty",
        },
    )
    if errors:
        validation_errors(errors)

    result = organization_service.update_member_role(
        data.get("organizationId"),
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
        result or "Organization not found",
    )


@router.delete("/members", status_code=status.HTTP_200_OK)
def remove_organization_member(
    organizationId: Optional[str] = Query(default=None),
    userId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = organization_service.remove_member(
        organizationId,
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
        result or "Organization not found",
    )
