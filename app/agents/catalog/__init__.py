"""Concrete agent implementations.

Drop a new module in this package, register your agent with
``app.agents.registry.registry`` at module top-level, and it will be picked
up automatically -- no edits to this file or to ``app.main`` needed.

We discover modules with :func:`pkgutil.iter_modules` rather than relying
on hand-maintained imports so adding a new agent stays a single-file
change. Modules whose name starts with ``_`` are skipped, matching the
usual private-module convention.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from types import ModuleType

logger = logging.getLogger(__name__)


def discover() -> list[ModuleType]:
    """Import every public submodule under ``app.agents.catalog``.

    Returns the list of imported modules (mostly useful for tests/logs).
    Re-imports are no-ops -- ``importlib.import_module`` returns the
    cached module from ``sys.modules``, and individual catalog modules
    register themselves with ``replace=True`` so a hot-reload does not
    raise :class:`AgentAlreadyRegisteredError`. A failure in a single
    module is logged and skipped so one broken agent cannot take down
    the rest of the catalog.
    """

    imported: list[ModuleType] = []
    for module_info in pkgutil.iter_modules(__path__, prefix=f"{__name__}."):
        if module_info.name.rsplit(".", 1)[-1].startswith("_"):
            continue
        try:
            imported.append(importlib.import_module(module_info.name))
        except Exception:  # noqa: BLE001 -- isolate per-module failures
            logger.exception(
                "Failed to import agent catalog module %s; skipping.",
                module_info.name,
            )
    return imported


__all__ = ["discover"]
