"""Shared helpers used by multiple catalog agents.

Cross-cutting code that lives in this module rather than in any single
agent file:

- :func:`unpack_structured_response`: every ``polish_*`` helper unpacks
  the ``(raw, parsed, parsing_error)`` triple from a
  ``with_structured_output(..., include_raw=True)`` call. The block was
  duplicated five times before this module existed -- one update would
  silently diverge across catalog modules.

- :func:`unpack_similar_payload`: normalises the two FE shapes for a
  ``similarTasks`` payload -- the v2.1 ``{"similar": [...]}`` envelope
  and the legacy raw list -- to a flat list.  Used by
  ``task_drafting.py`` and ``task_estimation.py``.

- :func:`structured_llm_call`: generic scaffold for
  ``with_structured_output`` polish calls. Currently adopted by
  ``polish_rationale`` and ``polish_readiness`` in
  ``task_estimation.py`` as a proof of concept.  The four functions
  still to migrate are:
    - ``polish_draft``      (task_drafting.py)
    - ``polish_headline``   (board_brief.py)
    - ``polish_triage``     (triage.py)
    - ``polish_search``     (search.py)

The module name is prefixed with ``_`` so the catalog auto-discovery
loop (``app/agents/catalog/__init__.py``) skips it; helpers here are
not standalone agents.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


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
    """

    from langgraph.types import interrupt

    from app.tools.fe_tool_schemas import interrupt_payload

    snapshot = interrupt(
        interrupt_payload(
            "fe.boardSnapshot",
            {"project_id": state.get("project_id")},
        )
    )
    return {"board_snapshot": snapshot}


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


async def structured_llm_call(
    model: Any,
    schema_type: type,
    messages: list,
    *,
    fallback: Any,
    merge_fn: Optional[Callable[[Any], Any]] = None,
) -> tuple[Any, int, int]:
    """Generic scaffold for structured-output polish calls.

    Handles the stub-model short-circuit, the ``with_structured_output``
    invocation, exception catching, response unpacking, token extraction,
    and typed-result validation.  Returns ``(result, tokens_in, tokens_out)``.

    ``merge_fn``, when provided, is called with the parsed Pydantic object
    to convert it into the domain type expected by the caller (e.g. merging
    polished fields back onto a deterministic baseline dict).
    """

    # Import here to avoid circular imports at module level; these two
    # helpers live in separate packages and are always available.
    from app.agents.llm import extract_token_usage, is_stub_model

    if is_stub_model(model):
        return fallback, 0, 0
    try:
        response = await model.with_structured_output(
            schema_type, include_raw=True
        ).ainvoke(messages)
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("structured_llm_call failed for %s", schema_type.__name__)
        return fallback, 0, 0
    raw, parsed, _error = unpack_structured_response(response)
    tokens_in, tokens_out = extract_token_usage(raw)
    if _error is not None or not isinstance(parsed, schema_type):
        return fallback, tokens_in, tokens_out
    result = merge_fn(parsed) if merge_fn else parsed
    return result, tokens_in, tokens_out


__all__ = [
    "detect_drift_node",
    "fetch_snapshot_node",
    "structured_llm_call",
    "unpack_similar_payload",
    "unpack_structured_response",
]
