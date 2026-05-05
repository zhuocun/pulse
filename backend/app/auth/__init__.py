"""Authorization helpers shared across routers."""

from app.auth.project_access import is_project_ai_enabled

__all__ = ["is_project_ai_enabled"]
