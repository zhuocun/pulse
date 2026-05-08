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
from dataclasses import dataclass
from types import ModuleType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CatalogDiscoveryFailure:
    """One module that failed to import during catalog discovery."""

    module_name: str
    error_type: str
    error_message: str


# Module-level record of discovery failures from the most recent
# :func:`discover` call. Health endpoints / startup checks read this to
# fail loudly when a catalog module silently dropped out of the registry
# -- previously a SyntaxError or missing dependency in any agent file
# would degrade the catalog at startup with only a logger.exception
# entry that nobody noticed.
_last_discovery_failures: list[CatalogDiscoveryFailure] = []


def last_discovery_failures() -> list[CatalogDiscoveryFailure]:
    """Return the failures recorded on the most recent ``discover()`` call.

    Empty list means every module imported cleanly. The list is replaced
    (not extended) on each ``discover`` call so a successful retry
    clears stale entries.
    """

    return list(_last_discovery_failures)


def discover() -> list[ModuleType]:
    """Import every public submodule under ``app.agents.catalog``.

    Returns the list of imported modules. Re-imports are no-ops --
    ``importlib.import_module`` returns the cached module from
    ``sys.modules``, and individual catalog modules register themselves
    with ``replace=True`` so a hot-reload does not raise
    :class:`AgentAlreadyRegisteredError`. A failure in a single module
    is logged, recorded in :func:`last_discovery_failures`, and skipped
    so one broken agent cannot take down the rest of the catalog.
    """

    global _last_discovery_failures
    imported: list[ModuleType] = []
    failures: list[CatalogDiscoveryFailure] = []
    for module_info in pkgutil.iter_modules(__path__, prefix=f"{__name__}."):
        if module_info.name.rsplit(".", 1)[-1].startswith("_"):
            continue
        try:
            imported.append(importlib.import_module(module_info.name))
        except Exception as exc:  # noqa: BLE001 -- isolate per-module failures
            logger.exception(
                "Failed to import agent catalog module %s; skipping.",
                module_info.name,
            )
            failures.append(
                CatalogDiscoveryFailure(
                    module_name=module_info.name,
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                )
            )
    _last_discovery_failures = failures
    return imported


__all__ = [
    "CatalogDiscoveryFailure",
    "discover",
    "last_discovery_failures",
]
