"""Namespace constants for :class:`langgraph.store.base.BaseStore` (PRD §6.3).

Returning tuples instead of strings matches the LangGraph store API which
takes a ``namespace`` tuple. Keeping the layout in one module ensures every
agent reads/writes from the same path -- a subtle but high-blast-radius
class of bugs to leave to free-form strings.
"""

from __future__ import annotations

from typing import Final

USERS: Final = "users"
PROJECTS: Final = "projects"
FEEDBACK: Final = "feedback"


def user_preferences(user_id: str) -> tuple[str, ...]:
    """Namespace for a user's UI / autonomy preferences."""

    return (USERS, user_id, "preferences")


def project_profile(project_id: str) -> tuple[str, ...]:
    """Namespace for project-level facts (e.g. taxonomy, board rules)."""

    return (PROJECTS, project_id, "profile")


def user_project_facts(user_id: str, project_id: str) -> tuple[str, ...]:
    """Namespace for per-user, per-project memories."""

    return (USERS, user_id, project_id, "facts")


def feedback(project_id: str, thread_id: str) -> tuple[str, ...]:
    """Namespace for thumbs/edit feedback events."""

    return (FEEDBACK, project_id, thread_id)
