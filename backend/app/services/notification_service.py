from typing import Any, Dict, List, Optional, Union

from app.database import NOTIFICATIONS
from app.repositories import repository

# Notifications are *user-scoped*: a row belongs to exactly one recipient
# (``userId``) and there is no project-level authorization here -- being
# the addressee is the whole permission model. ``create`` is an internal
# producer (called by ``comment_service`` when an @mention lands); the
# read / mark-read paths are the only ones an endpoint exposes.


def create(
    user_id: str,
    kind: str,
    ref_id: str,
    summary: str,
    project_id: Optional[str] = None,
) -> str:
    """Insert one notification for ``user_id`` and return its new id.

    Internal helper -- there is no POST endpoint. ``isRead`` starts
    ``False`` so a freshly produced notification surfaces as unread in
    the Inbox. ``projectId`` is optional so non-project notifications
    (future kinds) can reuse this producer.
    """

    new_id = repository.insert_one(
        NOTIFICATIONS,
        {
            "userId": user_id,
            "kind": kind,
            "refId": ref_id,
            "projectId": project_id,
            "summary": summary,
            "isRead": False,
        },
    )
    return str(new_id)


def get(user_id: str) -> List[Dict[str, Any]]:
    """Return the caller's own notifications, newest first.

    Strictly scoped to ``userId == user_id`` -- a caller never sees
    another user's notifications. Sorted by ``createdAt`` descending so
    the Inbox renders the most recent at the top; ``serialize_documents``
    turns ``_id`` / timestamps into JSON-friendly strings.
    """

    notifications = repository.find_many(NOTIFICATIONS, {"userId": user_id})
    # FakeStore cannot sort, and Mongo's ``find_many`` here is unordered,
    # so sort in Python. ``createdAt`` is a datetime (real store) or
    # absent on a malformed row; key on it defensively.
    ordered = sorted(
        notifications,
        key=lambda item: item.get("createdAt") or "",
        reverse=True,
    )
    return repository.serialize_documents(ordered)


def mark_read(data: Dict[str, Any], user_id: str) -> Union[str, None]:
    """Mark one notification (``{_id}``) or all unread (``{markAll: true}``).

    Single-id path: the row must exist (else ``None`` -> 404) and belong
    to ``user_id`` (else ``"Forbidden"`` -> 403) before it is flipped to
    read -- this is the only cross-user guard, and it is strict so a
    caller can never touch someone else's notification. The ``markAll``
    path only ever scans the caller's own rows. Anything else is a
    ``"Bad request"`` (-> 400).
    """

    if data.get("markAll") is True:
        for notification in repository.find_many(NOTIFICATIONS, {"userId": user_id}):
            if not notification.get("isRead"):
                repository.update_by_id(
                    NOTIFICATIONS, str(notification["_id"]), {"isRead": True}
                )
        return "Notification updated"

    notification_id = data.get("_id")
    if not notification_id:
        return "Bad request"

    notification = repository.find_by_id(NOTIFICATIONS, str(notification_id))
    if notification is None:
        return None
    # Ownership is the entire authz model: a notification belongs to its
    # recipient, so a different caller is forbidden rather than 404 (the
    # row does exist; the caller just may not touch it).
    if str(notification.get("userId")) != str(user_id):
        return "Forbidden"

    repository.update_by_id(NOTIFICATIONS, str(notification_id), {"isRead": True})
    return "Notification updated"
