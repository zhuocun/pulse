"""Shared helpers used by multiple catalog agents.

Cross-cutting code that lives in this module rather than in any single
agent file:

- :func:`unpack_structured_response`: every ``polish_*`` helper unpacks
  the ``(raw, parsed, parsing_error)`` triple from a
  ``with_structured_output(..., include_raw=True)`` call.

- :func:`unpack_similar_payload`: normalises the two FE shapes for a
  ``similarTasks`` payload -- the v2.1 ``{"similar": [...]}`` envelope
  and the legacy raw list -- to a flat list.  Used by
  ``task_drafting.py`` and ``task_estimation.py``.

- :func:`build_citation_refs`: builds a validated, redacted list of
  ``{"source", "id", "quote"}`` refs from an arbitrary item list.

- :func:`fetch_snapshot_node`: shared ``fetch_snapshot`` node body for
  board-brief and triage agents.

- :func:`fetch_similar_node`: shared ``fetch_similar`` node body for
  task-drafting and task-estimation agents.

- :func:`detect_drift_node`: shared ``detect_drift`` node body for
  board-brief and triage agents.

- :func:`augment_items_with_vector_neighbours`: pgvector prefetch +
  merge for ``task_estimation`` and ``search`` catalog agents.

- :func:`cap_polished_text` and :func:`merge_keyed_string_updates` are
  re-exported here for backward compatibility; the canonical
  implementations now live in :mod:`app.agents.polish`.

The module name is prefixed with ``_`` so the catalog auto-discovery
loop (``app/agents/catalog/__init__.py``) skips it; helpers here are
not standalone agents.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

# Re-exported for backward compatibility; canonical implementations are in
# app.agents.polish so all polish-related machinery lives in one module.
from app.agents.polish import cap_polished_text, merge_keyed_string_updates

logger = logging.getLogger(__name__)


def filter_to_allowed_ids(
    parsed_ids: Any, allowed_ids: set[Any]
) -> list[str]:
    """Strip non-string and non-allowed entries from a parsed id list.

    Used by ``polish_search`` and ``polish_triage`` so a misbehaving
    model that returns hallucinated ids never reaches the FE.  Order
    is preserved.
    """

    if not isinstance(parsed_ids, list):
        return []
    return [i for i in parsed_ids if isinstance(i, str) and i in allowed_ids]


def unpack_structured_response(
    response: Any,
) -> tuple[Any, Any, Optional[Exception]]:
    """Return ``(raw, parsed, parsing_error)`` from a structured-output call.

    LangChain's ``model.with_structured_output(Schema, include_raw=True)``
    yields a dict shaped ``{"raw": AIMessage, "parsed": Schema | None,
    "parsing_error": Exception | None}``. A non-dict response (older
    providers, mocks, malformed return) is treated as a complete miss
    so callers can fall back to the deterministic baseline without
    a special-case branch in every agent.
    """

    if not isinstance(response, dict):
        return None, None, None
    raw = response.get("raw")
    parsed = response.get("parsed")
    error = response.get("parsing_error")
    return raw, parsed, error


def unpack_similar_payload(payload: Any) -> list[Any]:
    """Normalise FE legacy raw-list and v2.1 envelope shapes to a flat list.

    The FE may return either a raw list (legacy / test fixtures) or the
    schema-conformant ``{"similar": [...]}`` envelope.  Normalise so
    downstream nodes always see a list of ``{id, text}`` items.
    """

    if isinstance(payload, dict) and "similar" in payload:
        return payload["similar"] or []
    return payload or []


def fetch_snapshot_node(state: Any) -> dict[str, Any]:
    """Shared ``fetch_snapshot`` node body for board-brief and triage agents.

    Both agents need to interrupt for ``fe.boardSnapshot`` and store the
    result in ``board_snapshot``.  The bodies were identical, so this
    single function is reused by both graph closures (cf.
    ``board_brief.py`` and ``triage.py``).

    Short-circuits when ``board_snapshot`` is already on state.  v2.1 SSE
    callers don't pre-populate it (they expect the interrupt), so this
    is purely additive for them.  JSON callers that already have the
    snapshot in the request body can pre-populate it on input and skip
    the interrupt entirely -- required for the v1 ``/api/ai`` shim to
    drive the same agent graph end-to-end.
    """

    if state.get("board_snapshot") is not None:
        return {}

    from langgraph.types import interrupt

    from app.tools.fe_tool_schemas import interrupt_payload

    snapshot = interrupt(
        interrupt_payload(
            "fe.boardSnapshot",
            {"project_id": state.get("project_id")},
        )
    )
    return {"board_snapshot": snapshot}


def fetch_similar_node(state: Any) -> dict[str, Any]:
    """Shared ``fetch_similar`` node body for task-drafting and task-estimation.

    Both agents interrupt for ``fe.similarTasks`` keyed by ``project_id``
    and a query derived from ``prompt`` or ``task_draft.taskName``.  The
    result is normalised via :func:`unpack_similar_payload` and stored in
    ``similar_tasks``.

    Short-circuits when ``similar_tasks`` is already on state, mirroring
    :func:`fetch_snapshot_node`.  Lets JSON callers that already have
    similar-task references in the request body skip the interrupt.
    """

    if state.get("similar_tasks") is not None:
        return {}

    from langgraph.types import interrupt

    from app.tools.fe_tool_schemas import interrupt_payload

    query = (
        state.get("prompt")
        or (state.get("task_draft") or {}).get("taskName")
        or ""
    )
    payload = interrupt(
        interrupt_payload(
            "fe.similarTasks",
            {
                "project_id": state.get("project_id"),
                "query": query,
            },
        )
    )
    return {"similar_tasks": unpack_similar_payload(payload)}


def detect_drift_node(state: Any) -> dict[str, Any]:
    """Shared ``detect_drift`` node body for board-brief and triage agents.

    Both agents run the same deterministic drift detector on the same
    ``board_snapshot`` key and write the result to ``drift_result``.  The
    bodies were identical, so this single function is reused by both graph
    closures (cf. ``board_brief.py`` and ``triage.py``).
    """

    from app.tools import be_tools

    snapshot = state.get("board_snapshot") or {}
    return {"drift_result": be_tools.detect_drift(snapshot)}


def build_citation_refs(
    items: list[dict],
    source: str,
    *,
    max_items: int = 3,
    get_id: Optional[Callable[[dict], Any]] = None,
    get_quote: Optional[Callable[[dict], str]] = None,
) -> list[dict]:
    """Build a validated, redacted list of citation refs from ``items``.

    Each ref has shape ``{"source", "id", "quote"}`` as required by the
    FE citation contract. Quotes are redacted via
    :func:`app.tools.redaction.redact` and each ref is validated via
    :func:`app.tools.be_tools.validated_citation_ref` before inclusion.

    ``get_id`` and ``get_quote`` are optional callbacks to extract the id
    and quote from each item dict. Sensible defaults are provided for the
    standard ``{id, text, taskName, name}`` shapes used across the catalog.

    Returns the refs list so callers can reuse it (e.g. in
    ``recommendationDetail.sources``).
    """

    from app.tools.be_tools import validated_citation_ref
    from app.tools.redaction import redact

    if get_id is None:
        # ``id`` is the v2.1 FE-snapshot key; ``_id`` is the Mongo-shaped key
        # the v1 ``/api/ai`` shim sends through ``context``.  Falling back
        # keeps the citation refs valid for both wire shapes without forcing
        # the caller to normalise the snapshot.
        get_id = lambda x: x.get("id") or x.get("_id")  # noqa: E731
    if get_quote is None:
        get_quote = lambda x: x.get("text") or x.get("taskName") or x.get("name") or ""  # noqa: E731

    refs: list[dict] = []
    for item in items[:max_items]:
        raw_quote = get_quote(item)
        quote = redact(raw_quote)[0] if isinstance(raw_quote, str) else raw_quote
        refs.append(
            validated_citation_ref(
                source=source,
                id=get_id(item),
                quote=quote,
            )
        )
    return refs


async def augment_items_with_vector_neighbours(
    items: list[Any],
    *,
    query_text: str,
    project_id: str,
    settings: Any,
    max_total: int = 24,
    failure_log_message: str = "Vector-augmented merge failed; using FE list only.",
) -> list[Any]:
    """Merge FE items with pgvector neighbours when vector search is enabled.

    Best-effort: on embed, store, or merge failure the original ``items``
  list is returned unchanged after logging ``failure_log_message``.
    """

    if not getattr(settings, "agent_vector_search_enabled", False):
        return items

    from app.agents.task_vector_pg import (
        fetch_vector_neighbours_for_project,
        merge_similar_with_vector_hits,
    )
    from app.tools import be_tools

    try:
        qvecs = await be_tools.embed_async([query_text])
        qv = qvecs[0] if qvecs else []
        hits = fetch_vector_neighbours_for_project(
            project_id=str(project_id or ""),
            query_embedding=list(qv),
            settings=settings,
        )
        return merge_similar_with_vector_hits(items, hits, max_total=max_total)
    except Exception:  # noqa: BLE001 -- best-effort augment; callers keep FE list
        logger.warning(failure_log_message, exc_info=True)
        return items


__all__ = [
    "augment_items_with_vector_neighbours",
    "build_citation_refs",
    "cap_polished_text",
    "detect_drift_node",
    "fetch_similar_node",
    "fetch_snapshot_node",
    "filter_to_allowed_ids",
    "merge_keyed_string_updates",
    "unpack_similar_payload",
    "unpack_structured_response",
]
