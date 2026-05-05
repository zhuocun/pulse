"""Service health endpoint (PRD v2.1 §8.1 / §5A.5).

The FE polls ``GET /api/v1/health`` and shows the offline banner when it
returns non-2xx. We expose enough metadata for the operator dashboard
without leaking anything secret.

Response shape: both snake_case and camelCase keys are emitted so the
existing test suite keeps reading ``status``/``agents_loaded`` while the
React client (``src/utils/ai/agentClient.ts`` `getAgentHealth`) can read
``ok``/``agentsLoaded`` without any client-side mapping.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict

from fastapi import APIRouter, Request, status

from app.agents import AgentRuntime
from app.config import settings
from app.repositories import repository

logger = logging.getLogger(__name__)


router = APIRouter()


def _agent_persistence_ok(runtime: AgentRuntime) -> bool:
    """Report whether the agent persistence backend is operational.

    The signal is intentionally a static check rather than a live probe.
    For the ``"none"`` and ``"memory"`` backends there is nothing to
    probe -- ``"none"`` is intentionally disabled and the in-process
    ``InMemorySaver`` is reachable as long as the process is alive
    (which it must be, otherwise we would not be answering this
    request). For the ``"postgres"`` backend the FastAPI lifespan
    enters ``AsyncPostgresSaver`` on its ``AsyncExitStack`` and awaits
    ``setup()`` exactly once at boot; if that connection / migration
    failed the lifespan throws and the app never starts. So at
    request-time, ``runtime.checkpointer is not None`` already proves
    the boot-time connection succeeded -- a per-request ``SELECT 1``
    would only catch transient drops, at the cost of an extra round
    trip on every health poll (the FE polls this on a 30s timer). If
    a future maintainer wants to detect mid-life connection death,
    add it as a separate timed probe rather than folding it into the
    request path.
    """

    backend = settings.agent_checkpoint_backend
    if backend == "postgres":
        return runtime.checkpointer is not None
    # ``none`` / ``memory`` / unknown future backends: trust that boot
    # succeeded. Unknown backends would have failed startup via
    # :func:`build_checkpointer` if they were genuinely unsupported.
    return True


def health(runtime: AgentRuntime) -> Dict[str, Any]:
    """Build the health payload, exercising the DB once per probe.

    A health endpoint that never touches the DB happily reports ``ok``
    while every real request 5xxs -- the FE banner stays green and the
    operator on-call wastes minutes finding out. We swallow the probe
    exception (so the response itself does not 500) but downgrade
    ``status`` to ``degraded`` and ``ok`` to ``False`` so callers can
    branch on it.

    The agent persistence signal (``agentPersistence`` /
    ``agentPersistenceOk``) is a static check on the runtime rather
    than a live probe -- see :func:`_agent_persistence_ok` for why.
    """

    db_ok = True
    started = time.perf_counter()
    try:
        repository.ping()
    except Exception:  # noqa: BLE001 -- intentional broad catch on probe boundary
        logger.warning("Repository ping failed during health probe.", exc_info=True)
        db_ok = False
    # Measured around the DB ping only -- it is the one IO-bound branch in
    # this handler, and the FE (``useAgentHealth``) renders the value as the
    # operator-visible round-trip indicator. Reported in both snake_case and
    # camelCase to stay consistent with the rest of this payload.
    latency_ms = round((time.perf_counter() - started) * 1000.0, 2)

    persistence_ok = _agent_persistence_ok(runtime)
    persistence_backend = settings.agent_checkpoint_backend
    agents_loaded = len(runtime.registry)
    overall_ok = db_ok and persistence_ok
    return {
        "status": "ok" if overall_ok else "degraded",
        "ok": overall_ok,
        "database": "ok" if db_ok else "degraded",
        "agents_loaded": agents_loaded,
        "agentsLoaded": agents_loaded,
        "latency_ms": latency_ms,
        "latencyMs": latency_ms,
        "checkpointer": settings.agent_checkpoint_backend,
        "store": settings.agent_store_backend,
        "agent_persistence": persistence_backend,
        "agentPersistence": persistence_backend,
        "agent_persistence_ok": persistence_ok,
        "agentPersistenceOk": persistence_ok,
    }


@router.get("", status_code=status.HTTP_200_OK)
def health_endpoint(request: Request) -> Dict[str, Any]:
    return health(request.app.state.agent_runtime)
