from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, status

from app.security import current_user_id, current_user_payload
from app.services import user_service
from app.validation import api_error, validation_errors


router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_user(payload: Dict[str, Any] = Depends(current_user_payload)) -> Dict[str, Any]:
    user_id = current_user_id(payload)
    user = user_service.get(user_id)
    if user is None:
        api_error(status.HTTP_404_NOT_FOUND, "User not found")
    return user


@router.put("/", status_code=status.HTTP_200_OK)
def update_user(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Dict[str, Any]:
    user_id = current_user_id(payload)
    errors = user_service.update_validation_errors(user_id, data)
    if errors:
        validation_errors(errors)

    result = user_service.update(user_id, data)
    if result == "User not found":
        api_error(status.HTTP_404_NOT_FOUND, result)
    # Mirror GET /users/ so the FE can drop the result straight into
    # the shared `users` React Query cache. The previous {"userInfo":
    # result} wrapper diverged from every other read on this resource
    # and silently broke optimistic-update parity for any client that
    # naively re-used the GET deserializer.
    return result


@router.get("/members", status_code=status.HTTP_200_OK)
def get_members(
    _: Dict[str, Any] = Depends(current_user_payload),
) -> List[Dict[str, Any]]:
    members = user_service.get_members()
    return members


@router.put("/likes", status_code=status.HTTP_200_OK)
def switch_like_status(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Dict[str, Any]:
    user_id = current_user_id(payload)
    project_id = data.get("projectId")
    if project_id is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Lack of information")

    result = user_service.switch_like_status(user_id, project_id)
    if result is None or isinstance(result, str):
        api_error(status.HTTP_404_NOT_FOUND, result or "User or project not found")

    # Match the GET /users/ shape exactly. The previous hand-picked
    # subset dropped server-managed fields and would silently swallow
    # any new non-sensitive field added to USERS in the future, while
    # the FE caches this back into the same `users` query.
    return result
