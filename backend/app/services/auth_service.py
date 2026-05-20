from http import HTTPStatus
from typing import Any, Dict

from app.database import USERS
from app.repositories import repository
from app.security import (
    JWT_SECRET_MIN_LENGTH,
    PASSWORD_HASH_ITERATIONS,
    PASSWORD_HASH_PREFIX,
    create_ai_proxy_token,
    create_token,
    dummy_password_hash,
    encrypt_password,
    verify_password,
)
from app.config import settings
from app.validation import (
    api_error,
    body_error,
    email_error,
    make_validation_error,
    validation_errors,
)


def register(data: Dict[str, Any]) -> str:
    errors = []

    username = data.get("username")
    if not isinstance(username, str) or username == "":
        errors.append(body_error(data, "username", "Username cannot be empty"))
    elif len(username) < 3:
        errors.append(
            body_error(
                data,
                "username",
                "Length of username cannot be less than 3",
            )
        )

    email = data.get("email")
    if not isinstance(email, str) or email == "":
        errors.append(body_error(data, "email", "Email cannot be empty"))
    else:
        error = email_error(email)
        if error is not None:
            errors.append(error)
        elif repository.find_one(USERS, {"email": email}) is not None:
            errors.append(
                make_validation_error(
                    "Email has already been registered",
                    "email",
                    email,
                )
            )

    password = data.get("password")
    if not isinstance(password, str) or password == "":
        errors.append(body_error(data, "password", "Password cannot be empty"))
    elif len(password) < 5:
        errors.append(
            body_error(
                data,
                "password",
                "Length of password cannot be less than 5",
            )
        )

    if errors:
        validation_errors(errors)

    payload = {
        "username": data["username"],
        "email": data["email"],
        "password": encrypt_password(data["password"]),
        "likedProjects": [],
    }
    repository.insert_one(USERS, payload)
    return "User created"


def login(data: Dict[str, Any]) -> Dict[str, Any]:
    if len(settings.jwt_secret) < JWT_SECRET_MIN_LENGTH:
        api_error(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "Server JWT secret is not configured",
        )

    errors = []

    email = data.get("email")
    if not isinstance(email, str) or email == "":
        errors.append(body_error(data, "email", "Email cannot be empty"))
    else:
        error = email_error(email)
        if error is not None:
            errors.append(error)

    password = data.get("password")
    if not isinstance(password, str) or password == "":
        errors.append(body_error(data, "password", "Password cannot be empty"))

    if errors:
        validation_errors(errors)

    # Always run a password verification, even when the email is unknown,
    # so unknown-email and wrong-password are indistinguishable from the
    # client. This closes the user-enumeration vector that the older
    # "Email hasn't been registered" branch left open.
    user = repository.find_one(USERS, {"email": data["email"]})
    stored_hash = user.get("password", "") if user is not None else dummy_password_hash()
    if not verify_password(data["password"], stored_hash) or user is None:
        api_error(HTTPStatus.UNAUTHORIZED, "Invalid credentials")

    if not user["password"].startswith(
        f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}$"
    ):
        repository.update_by_id(
            USERS,
            str(user["_id"]),
            {"password": encrypt_password(data["password"])},
        )

    user_info = repository.serialize_document(user)
    if user_info is None:
        api_error(HTTPStatus.UNAUTHORIZED, "Invalid credentials")

    # The REST JWT is intentionally NOT in the response body. The router
    # writes it into an HttpOnly cookie so JS never gets to see it --
    # this is the change that ends the iOS Safari 26.5 stuck-on-login
    # loop, where the FE's previous client-managed handoff across a full
    # document reload was unreliable on WebKit. The narrow-scope
    # ``ai_jwt`` keeps riding the body because the AI proxy is bearer-
    # auth'd (often a different origin from the REST API).
    return {
        "_id": user_info["_id"],
        "username": user_info.get("username"),
        "likedProjects": user_info.get("likedProjects") or [],
        "email": user_info.get("email"),
        "rest_jwt": create_token(user_info["_id"]),
        "ai_jwt": create_ai_proxy_token(user_info["_id"]),
    }
