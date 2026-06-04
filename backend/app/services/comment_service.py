from typing import Any, Dict, List, Optional, Union

from app.database import COMMENTS, TASKS, USERS
from app.repositories import repository
from app.services import notification_service
from app.services.project_service import (
    ROLE_VIEWER,
    can_access,
    is_project_manager,
)


def _valid_body(value: Any) -> bool:
    """A comment body must be a non-empty string."""

    return isinstance(value, str) and value != ""


def _mention_list(value: Any) -> List[str]:
    """Normalize ``mentions`` to a list of userId strings.

    Missing / non-list inputs collapse to an empty list so the field is
    optional and a malformed value never blows up the write path. Each
    entry is stringified for uniform comparison against ``USERS._id`` and
    the author id.
    """

    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _notify_mentions(
    mentions: List[str],
    *,
    author_id: str,
    task_id: str,
    project_id: str,
) -> None:
    """Fan out a ``mention`` notification to each eligible mentioned user.

    A mention produces a notification only when the target (a) exists in
    ``USERS``, (b) can access the project at viewer level (i.e. is a
    member), and (c) is not the author. Ids failing any check are skipped
    silently -- a typo'd, non-member, or self mention is a no-op rather
    than an error, so the comment write itself never fails on a bad
    mention. Duplicates are de-duplicated so the same user is notified at
    most once per comment.
    """

    seen: set[str] = set()
    for mentioned_id in mentions:
        if mentioned_id in seen:
            continue
        seen.add(mentioned_id)
        if mentioned_id == str(author_id):
            continue
        if repository.find_by_id(USERS, mentioned_id) is None:
            continue
        if not can_access(project_id, mentioned_id, ROLE_VIEWER):
            continue
        notification_service.create(
            mentioned_id,
            "mention",
            task_id,
            f"{author_id} mentioned you",
            project_id,
        )


def create(data: Dict[str, Any], user_id: str) -> Optional[str]:
    """Create a comment on a task and notify any mentioned members.

    ``None`` -> router 404 ("Task not found"); ``"Forbidden"`` -> 403;
    ``"Bad request"`` -> 400. ``projectId`` is derived from the task (not
    the body) so a client cannot file a comment under a project the task
    does not belong to. Any project member (viewer and up) may comment.
    """

    task_id = data.get("taskId")
    task = repository.find_by_id(TASKS, task_id or "")
    if task is None:
        return None

    project_id = task.get("projectId")
    # Read-level access is enough to comment: viewers are participants too.
    if not can_access(project_id, user_id, ROLE_VIEWER):
        return "Forbidden"

    body = data.get("body")
    if not _valid_body(body):
        return "Bad request"

    mentions = _mention_list(data.get("mentions"))

    repository.insert_one(
        COMMENTS,
        {
            "taskId": str(task_id),
            "projectId": project_id,
            "authorId": user_id,
            "body": body,
            "mentions": mentions,
        },
    )

    _notify_mentions(
        mentions,
        author_id=user_id,
        task_id=str(task_id),
        project_id=project_id,
    )
    return "Comment created"


def get(task_id: str, user_id: str) -> Union[str, List[Dict[str, Any]]]:
    """List a task's comments, oldest-first, for any project member.

    ``"Task not found"`` -> 404; ``"Forbidden"`` -> 403. Comments are
    ordered by ``createdAt`` ascending so a thread reads top-to-bottom.
    """

    task = repository.find_by_id(TASKS, task_id or "")
    if task is None:
        return "Task not found"
    if not can_access(task.get("projectId"), user_id, ROLE_VIEWER):
        return "Forbidden"

    comments = repository.find_many(COMMENTS, {"taskId": str(task_id)})
    ordered = sorted(comments, key=lambda item: item.get("createdAt") or "")
    return repository.serialize_documents(ordered)


def update(data: Dict[str, Any], user_id: str) -> Optional[str]:
    """Edit a comment's body. Author-only; mentions are not re-processed.

    ``None`` -> 404; ``"Forbidden"`` -> 403; ``"Bad request"`` -> 400.
    Only ``body`` is writable here -- re-running mention notifications on
    every edit would spam recipients, so an edit deliberately leaves the
    original ``mentions`` (and their notifications) untouched.
    """

    comment_id = data.get("_id")
    comment = repository.find_by_id(COMMENTS, comment_id or "")
    if not comment_id or comment is None:
        return None
    # Only the author may edit their own comment.
    if str(comment.get("authorId")) != str(user_id):
        return "Forbidden"

    body = data.get("body")
    if not _valid_body(body):
        return "Bad request"

    repository.update_by_id(COMMENTS, str(comment_id), {"body": body})
    return "Comment updated"


def remove(comment_id: Optional[str], user_id: str) -> Optional[str]:
    """Delete a comment. Allowed for the author OR the project manager.

    ``None`` -> 404; ``"Forbidden"`` -> 403. The author can always remove
    their own comment; a project manager (owner) can moderate any comment
    in their project. Everyone else -- including ordinary members -- is
    forbidden.
    """

    comment = repository.find_by_id(COMMENTS, comment_id or "")
    if not comment_id or comment is None:
        return None
    is_author = str(comment.get("authorId")) == str(user_id)
    if not (is_author or is_project_manager(comment.get("projectId"), user_id)):
        return "Forbidden"

    repository.delete_by_id(COMMENTS, str(comment_id))
    return "Comment deleted"
