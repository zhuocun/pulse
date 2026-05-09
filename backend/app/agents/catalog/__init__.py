"""Concrete agent implementations.

The explicit :data:`AGENT_FACTORIES` manifest lists every catalog agent.
App startup iterates this list and registers each agent; any import or
instantiation error is **fatal** so a broken module fails the deploy
immediately rather than degrading the catalog silently.

:func:`discover` is retained as a pkgutil-based fallback that is useful
for dynamic test probes (writing a .py file to the catalog package dir
and verifying it is importable); callers that need all-or-nothing startup
registration should iterate :data:`AGENT_FACTORIES` directly.

Modules whose name starts with ``_`` are skipped by :func:`discover`,
matching the usual private-module convention.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from types import ModuleType
from typing import Callable

from app.agents.base import BaseAgent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Explicit manifest
# ---------------------------------------------------------------------------

def _make_board_brief_agent() -> BaseAgent:
    from app.agents.catalog.board_brief import BoardBriefAgent
    return BoardBriefAgent()


def _make_chat_agent() -> BaseAgent:
    from app.agents.catalog.chat import ChatAgent
    return ChatAgent()


def _make_search_agent() -> BaseAgent:
    from app.agents.catalog.search import SearchAgent
    return SearchAgent()


def _make_task_drafting_agent() -> BaseAgent:
    from app.agents.catalog.task_drafting import TaskDraftingAgent
    return TaskDraftingAgent()


def _make_task_estimation_agent() -> BaseAgent:
    from app.agents.catalog.task_estimation import TaskEstimationAgent
    return TaskEstimationAgent()


def _make_triage_agent() -> BaseAgent:
    from app.agents.catalog.triage import TriageAgent
    return TriageAgent()


AGENT_FACTORIES: list[tuple[str, Callable[[], BaseAgent]]] = [
    ("board-brief-agent", _make_board_brief_agent),
    ("chat-agent", _make_chat_agent),
    ("search-agent", _make_search_agent),
    ("task-drafting-agent", _make_task_drafting_agent),
    ("task-estimation-agent", _make_task_estimation_agent),
    ("triage-agent", _make_triage_agent),
]


def register_all(registry: object) -> None:
    """Register every agent from :data:`AGENT_FACTORIES` into *registry*.

    Any import error or instantiation failure is **fatal**: the
    exception propagates to the caller (app lifespan) so the deploy
    fails loudly rather than silently degrading the catalog.

    *registry* must expose a ``.register(agent)`` method.
    """
    for agent_name, factory in AGENT_FACTORIES:
        try:
            agent = factory()
        except Exception as exc:
            raise RuntimeError(
                f"Fatal: catalog agent {agent_name!r} failed to load: {exc}"
            ) from exc
        registry.register(agent, replace=True)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# pkgutil-based discovery (retained for dynamic test probes)
# ---------------------------------------------------------------------------


def discover() -> list[ModuleType]:
    """Import every public submodule under ``app.agents.catalog``.

    Returns the list of imported modules. Re-imports are no-ops --
    ``importlib.import_module`` returns the cached module from
    ``sys.modules``, and individual catalog modules register themselves
    with ``replace=True`` so a hot-reload does not raise
    :class:`AgentAlreadyRegisteredError`. A failure in a single module
    is **not** suppressed here -- this function is a pkgutil-based
    utility used by dynamic test probes and the
    :mod:`app.tools.fe_tool_schemas` contract test; production startup
    uses :func:`register_all` instead.

    .. note::
        Unlike the old implementation, this function does not write to
        ``_last_discovery_failures``.  Import errors propagate to the
        caller.
    """

    imported: list[ModuleType] = []
    for module_info in pkgutil.iter_modules(__path__, prefix=f"{__name__}."):
        if module_info.name.rsplit(".", 1)[-1].startswith("_"):
            continue
        imported.append(importlib.import_module(module_info.name))
    return imported


__all__ = [
    "AGENT_FACTORIES",
    "discover",
    "register_all",
]
