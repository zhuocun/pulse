from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Query, status

from app.security import current_user_id, current_user_payload
from app.services import board_service
from app.validation import api_error, required_body_errors, validation_errors


router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK)
def get_boards(
    projectId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> List[Dict[str, Any]]:
    if projectId is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Bad request")

    result = board_service.get(projectId, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Columns not found")
    return result


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_board_column(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(
        data,
        {
            "columnName": "Column name cannot be empty",
            "projectId": "Project ID cannot be empty",
        },
    )
    errors += board_service.create_validation_errors(data)
    if errors:
        validation_errors(errors)

    result = board_service.create(data, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Project not found")
    return result


@router.put("/", status_code=status.HTTP_200_OK)
def update_column(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    errors = required_body_errors(data, {"_id": "Column ID cannot be empty"})
    errors += board_service.update_validation_errors(data)
    if errors:
        validation_errors(errors)

    result = board_service.update(data, current_user_id(payload))
    if result == "Bad request":
        api_error(status.HTTP_400_BAD_REQUEST, result)
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Column not found")
    return result


@router.put("/orders", status_code=status.HTTP_200_OK)
def reorder_columns(
    data: Dict[str, Any] = Body(default_factory=dict),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    result = board_service.reorder(data, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Column not found")
    return result


@router.delete("/", status_code=status.HTTP_200_OK)
def remove_column(
    columnId: Optional[str] = Query(default=None),
    payload: Dict[str, Any] = Depends(current_user_payload),
) -> str:
    if columnId is None:
        api_error(status.HTTP_400_BAD_REQUEST, "Bad request")

    result = board_service.remove(columnId, current_user_id(payload))
    if result == "Forbidden":
        api_error(status.HTTP_403_FORBIDDEN, result)
    if result is None:
        api_error(status.HTTP_404_NOT_FOUND, "Column not found")
    return result
