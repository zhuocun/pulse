from typing import Any, Dict

from fastapi import APIRouter, Body, Request, Response, status

from app.config import settings
from app.security import SESSION_COOKIE_NAME
from app.services import auth_service


router = APIRouter()


def _session_cookie_secure(request: Request) -> bool:
    """Return whether the session cookie should carry the ``Secure`` flag.

    Browsers reject ``Secure`` cookies on plain ``http://`` connections
    other than localhost, so dev (Vite proxy -> uvicorn on ``http://``)
    must not set it; production (Vercel -> https) must. The ``X-Forwarded-
    Proto`` header is preferred when present because Vercel terminates
    TLS upstream of the lambda and forwards the request as http.
    """

    forwarded = request.headers.get("x-forwarded-proto", "").lower()
    if forwarded:
        return "https" in forwarded.split(",")[0].strip()
    return request.url.scheme == "https"


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.jwt_expires_seconds,
        path="/",
        httponly=True,
        secure=_session_cookie_secure(request),
        samesite="lax",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(data: Dict[str, Any] = Body(default_factory=dict)) -> str:
    return auth_service.register(data)


@router.post("/login", status_code=status.HTTP_200_OK)
def login(
    request: Request,
    response: Response,
    data: Dict[str, Any] = Body(default_factory=dict),
) -> Dict[str, Any]:
    result = auth_service.login(data)
    # Pop the REST JWT off the service result and move it into an
    # HttpOnly cookie. The FE never sees this token in JS -- it rides
    # back to the backend automatically on every same-origin request
    # via the FE's ``api/index.ts`` Vercel proxy function (and the
    # Vite dev-server proxy in development). See
    # ``auth_service.login`` for the rationale.
    rest_jwt = result.pop("rest_jwt", "")
    if rest_jwt:
        _set_session_cookie(response, request, rest_jwt)
    return result


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    # Clearing must match the cookie's Path so the browser actually
    # removes it. ``Secure`` / ``SameSite`` are irrelevant on a delete
    # but ``HttpOnly`` keeps any in-flight handler-side cookie reads
    # consistent with the set side.
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
