from typing import Any, Dict, List, Optional, Union

from app.database import PROJECTS, USERS
from app.domain.password_policy import MIN_PASSWORD_LENGTH
from app.repositories import repository
from app.security import encrypt_password
from app.validation import body_error, email_error, make_validation_error

# DO NOT add privilege fields (roles, isAdmin, etc.) here. ``update``
# below applies this whitelist directly to the storage layer, so any
# entry effectively grants self-service write access.
USER_UPDATE_FIELDS = frozenset({"username", "email", "password"})

# Safe-to-serialize public fields for ``GET /users/members`` so the
# directory cannot accidentally leak liked-project membership graphs or
# anything new added to the schema in the future.
_PUBLIC_MEMBER_FIELDS = ("_id", "username", "email")


def get(user_id: str) -> Optional[Dict[str, Any]]:
    return repository.serialize_document(repository.find_by_id(USERS, user_id))


def update_validation_errors(
    user_id: str, update_data: Dict[str, Any]
) -> List[Dict[str, Any]]:
    errors = []
    invalid_fields = sorted(set(update_data) - USER_UPDATE_FIELDS)
    if invalid_fields:
        errors.append(
            make_validation_error(
                f"Unknown field(s): {', '.join(invalid_fields)}",
            )
        )

    if "email" in update_data:
        email = update_data.get("email")
        if not isinstance(email, str) or email == "":
            errors.append(body_error(update_data, "email", "Email cannot be empty"))
        else:
            error = email_error(email)
            if error is not None:
                errors.append(error)
            else:
                existing = repository.find_one(USERS, {"email": email})
                if existing is not None and str(existing.get("_id")) != str(user_id):
                    errors.append(
                        make_validation_error(
                            "Email has been registered",
                            "email",
                            email,
                        )
                    )

    if "username" in update_data:
        username = update_data.get("username")
        if not isinstance(username, str) or username == "":
            errors.append(
                body_error(update_data, "username", "Username cannot be empty")
            )
        elif len(username) < 3:
            errors.append(
                body_error(
                    update_data,
                    "username",
                    "Length of username cannot be less than 3",
                )
            )
        else:
            existing = repository.find_one(USERS, {"username": username})
            if existing is not None and str(existing.get("_id")) != str(user_id):
                errors.append(
                    make_validation_error(
                        "Username has been registered",
                        "username",
                        username,
                    )
                )

    if "password" in update_data:
        password = update_data["password"]
        if not isinstance(password, str) or password == "":
            errors.append(
                body_error(update_data, "password", "Password cannot be empty")
            )
        elif len(password) < MIN_PASSWORD_LENGTH:
            errors.append(
                body_error(
                    update_data,
                    "password",
                    f"Length of password cannot be less than {MIN_PASSWORD_LENGTH}",
                )
            )

    return errors


def update(user_id: str, update_data: Dict[str, Any]) -> Union[Dict[str, Any], str]:
    user = repository.find_by_id(USERS, user_id)
    if user is None:
        return "User not found"

    payload = {
        key: value for key, value in update_data.items() if key in USER_UPDATE_FIELDS
    }
    if "password" in payload:
        payload["password"] = encrypt_password(payload["password"])

    updated_user = repository.update_by_id(USERS, user_id, payload)
    if updated_user is None:
        return "User not found"
    return repository.serialize_document(updated_user) or {}


def get_members() -> List[Dict[str, Any]]:
    members = repository.serialize_documents(repository.find_many(USERS, {}))
    return [
        {field: member.get(field) for field in _PUBLIC_MEMBER_FIELDS}
        for member in members
    ]


def switch_like_status(
    user_id: str, project_id: str
) -> Optional[Union[Dict[str, Any], str]]:
    user = repository.find_by_id(USERS, user_id)
    project = repository.find_by_id(PROJECTS, project_id)
    if user is None or project is None:
        return "User or project not found"

    # Idempotent set semantics so a double-tap or concurrent toggle
    # never leaves the project listed twice or fails to remove a
    # duplicate. Server-side atomic ops (Mongo $addToSet/$pull) would
    # be stronger, but they are backend-specific; this guarantees the
    # post-update list is well-formed regardless of the read race.
    current = user.get("likedProjects") or []
    if project_id in current:
        liked_projects = [pid for pid in current if pid != project_id]
    else:
        liked_projects = list(dict.fromkeys([*current, project_id]))

    updated_user = repository.update_by_id(
        USERS, user_id, {"likedProjects": liked_projects}
    )
    return repository.serialize_document(updated_user)
