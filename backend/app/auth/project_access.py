"""Per-project AI feature gating (PRD v2.1 §6.3 / AC-V10).

The org-level allow-list lives in ``AGENT_DISABLED_PROJECT_IDS`` (CSV) for
now -- the same env knob the dashboard toggle will write to once it
ships. Operators can swap this for a database/Redis-backed lookup by
overriding :func:`is_project_ai_enabled`; the public signature stays
stable.
"""

from __future__ import annotations

from typing import Iterable, Optional, Set

from app.config import Settings, settings as default_settings


def disabled_project_ids(settings: Optional[Settings] = None) -> Set[str]:
    """Return the set of project ids the org has opted out of AI on."""

    cfg = settings if settings is not None else default_settings
    return {pid.strip() for pid in cfg.agent_disabled_project_ids if pid.strip()}


def is_project_ai_enabled(
    project_id: Optional[str],
    *,
    settings: Optional[Settings] = None,
    disabled: Optional[Iterable[str]] = None,
) -> bool:
    """Return whether AI agent runs are permitted on ``project_id``.

    Reads the disabled-project allow-list from settings unless ``disabled``
    is passed (lets tests inject without monkey-patching the module).
    Missing / empty ``project_id`` is allowed -- the caller decides whether
    a project context is required.
    """

    if not project_id:
        return True
    blocked = set(disabled) if disabled is not None else disabled_project_ids(settings)
    return project_id not in blocked
