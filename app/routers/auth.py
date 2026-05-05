from typing import Any, Dict

from fastapi import APIRouter, Body, status

from app.services import auth_service


router = APIRouter()


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(data: Dict[str, Any] = Body(default_factory=dict)) -> str:
    return auth_service.register(data)


@router.post("/login", status_code=status.HTTP_200_OK)
def login(data: Dict[str, Any] = Body(default_factory=dict)) -> Dict[str, Any]:
    return auth_service.login(data)
