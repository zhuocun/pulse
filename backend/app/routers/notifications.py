from typing import Any, Dict, Union

from fastapi import APIRouter, Body, Depends, status

from app.security import current_user_id, current_user_payload
from app.services import notification_service
from app.validation import api_error

router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_notifications(
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> Union[list, str]:
    # Always the caller's own notifications -- no query parameters, so a
    # client cannot ask for anyone else's inbox.
    return notification_service.get(current_user_id(payload))


@router.put("/", status_code=status.HTTP_200_OK)
def mark_notification_read(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = notification_service.mark_read(data, current_user_id(payload))
    if result == "Notification updated":
        return result
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    api_error(status.HTTP_404_NOT_FOUND, result or "Notification not found")
