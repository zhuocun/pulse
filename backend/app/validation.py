import math
import re
from http import HTTPStatus
from typing import Any

from app.errors import AppError

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MISSING = object()
_REDACTED = "[REDACTED]"
# Field names whose value we never echo back -- the server has no
# business reflecting credentials/secrets in error envelopes or logs.
SENSITIVE_FIELDS = frozenset({"password", "currentPassword", "token", "jwt"})


def clean_filter(values: dict[str, Any]) -> dict[str, Any]:
    def _is_nan(value: Any) -> bool:
        return isinstance(value, float) and math.isnan(value)

    return {
        key: value
        for key, value in values.items()
        if value is not None and value != "" and not _is_nan(value)
    }


def make_validation_error(
    message: str,
    param: str | None = None,
    value: Any = _MISSING,
    location: str = "body",
) -> dict[str, Any]:
    error: dict[str, Any] = {"msg": message}
    if param is not None:
        if value is not _MISSING:
            error["value"] = _REDACTED if param in SENSITIVE_FIELDS else value
        error["param"] = param
        error["location"] = location
    return error


def validation_errors(errors: list[dict[str, Any]]) -> None:
    raise AppError(HTTPStatus.BAD_REQUEST, {"error": errors})


def body_error(data: dict[str, Any], field: str, message: str) -> dict[str, Any]:
    value = data[field] if field in data else _MISSING
    return make_validation_error(message, field, value)


def required_body_errors(
    data: dict[str, Any],
    messages: dict[str, str],
) -> list[dict[str, Any]]:
    return [
        body_error(data, field, message)
        for field, message in messages.items()
        if data.get(field) in (None, "")
    ]


def email_error(value: str, field: str = "email") -> dict[str, Any] | None:
    if not EMAIL_RE.match(value):
        return make_validation_error(
            "The input is not an email address",
            field,
            value,
        )
    return None


def api_error(status_code: int, message: Any) -> None:
    raise AppError(status_code, {"error": message})


def unwrap_error_detail(detail: Any) -> dict[str, Any]:
    if isinstance(detail, dict) and "error" in detail:
        return detail
    return {"error": detail}


def sorted_by_index(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: item.get("index", 0))
