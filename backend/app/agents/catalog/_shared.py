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

- :func:`structured_llm_call`: generic scaffold for
  ``with_structured_output`` polish calls. Adopted by all four
  ``polish_*`` functions across the catalog.

- :func:`build_citation_refs`: builds a validated, redacted list of
  ``{"source", "id", "quote"}`` refs from an arbitrary item list.

- :func:`fetch_snapshot_node`: shared ``fetch_snapshot`` node body for
  board-brief and triage agents.

- :func:`fetch_similar_node`: shared ``fetch_similar`` node body for
  task-drafting and task-estimation agents.

- :func:`detect_drift_node`: shared ``detect_drift`` node body for
  board-brief and triage agents.

The module name is prefixed with ``_`` so the catalog auto-discovery
loop (``app/agents/catalog/__init__.py``) skips it; helpers here are
not standalone agents.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Mapping, Optional

logger = logging.getLogger(__name__)


def cap_polished_text(text: Any, *, max_chars: int, fallback: str) -> str:
    """First-line, stripped, length-capped polish output with fallback.

    Five of the six catalog agents collapse a polished string into a
    single line and cap it at ``max_chars`` so the wire shape stays
    predictable.  A blank or non-string result preserves
    ``fallback``: the deterministic baseline is more useful than ``""``.
    """

    if not isinstance(text, str):
        return fallback
    text = text.strip()
    if not text:
        return fallback
    return text.splitlines()[0][:max_chars]


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


def merge_keyed_string_updates(
    parsed_items: Any,
    deterministic_items: Any,
    *,
    key_from_parsed: Callable[[Any], Any],
    key_from_deterministic: Callable[[dict[str, Any], int], Any],
    string_fields: Mapping[str, int],
) -> list[dict[str, Any]]:
    """Merge polished string fields onto a deterministic baseline list.

    Polished values are taken first-line, stripped and length-capped per
    ``string_fields``; blank polished values keep the deterministic copy.
    Used by ``polish_readiness`` (key = field id) and ``polish_triage``
    (key = ``"{type}:{idx}"``) — both want "validate, normalise, merge by
    key" without inventing new rows.
    """

    polished_by_key: dict[Any, Any] = {}
    if isinstance(parsed_items, list):
        for item in parsed_items:
            k = key_from_parsed(item)
            if k:
                polished_by_key[k] = item
    out: list[dict[str, Any]] = []
    if not isinstance(deterministic_items, list):
        return out
    for idx, item in enumerate(deterministic_items):
        if not isinstance(item, dict):
            out.append(item)
            continue
        merged = dict(item)
        update = polished_by_key.get(key_from_deterministic(item, idx))
        if update is not None:
            for field_name, max_chars in string_fields.items():
                polished = cap_polished_text(
                    getattr(update, field_name, ""),
                    max_chars=max_chars,
                    fallback="",
                )
                if polished:
                    merged[field_name] = polished
        out.append(merged)
    return out


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
    the interrupt entirely — required for the v1 ``/api/ai`` shim to
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


async def structured_llm_call(
    model: Any,
    schema_type: type,
    messages: list,
    *,
    fallback: Any,
    merge_fn: Optional[Callable[[Any], Any]] = None,
) -> tuple[Any, Any, int, int]:
    """Generic scaffold for structured-output polish calls.

    Handles the stub-model short-circuit, the ``with_structured_output``
    invocation, exception catching, response unpacking, token extraction,
    and typed-result validation.  Returns
    ``(result, raw_message, tokens_in, tokens_out)``.

    ``raw_message`` is the underlying ``AIMessage`` returned by the provider
    (with ``usage_metadata`` populated). Callers should include it in the
    node's ``messages`` return value so that
    :func:`~app.agents.llm.result_token_usage_from_graph_result` can
    aggregate token counts from state at run-end (Phase 2). On the stub
    path or when the call fails, ``raw_message`` is ``None``.

    ``merge_fn``, when provided, is called with the parsed Pydantic object
    to convert it into the domain type expected by the caller (e.g. merging
    polished fields back onto a deterministic baseline dict).
    """

    # Import here to avoid circular imports at module level; these two
    # helpers live in separate packages and are always available.
    from app.agents.llm import extract_token_usage, is_stub_model

    if is_stub_model(model):
        return fallback, None, 0, 0
    try:
        response = await model.with_structured_output(
            schema_type, include_raw=True
        ).ainvoke(messages)
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("structured_llm_call failed for %s", schema_type.__name__)
        return fallback, None, 0, 0
    raw, parsed, _error = unpack_structured_response(response)
    tokens_in, tokens_out = extract_token_usage(raw)
    if _error is not None or not isinstance(parsed, schema_type):
        return fallback, raw, tokens_in, tokens_out
    result = merge_fn(parsed) if merge_fn else parsed
    return result, raw, tokens_in, tokens_out


__all__ = [
    "build_citation_refs",
    "cap_polished_text",
    "detect_drift_node",
    "fetch_similar_node",
    "fetch_snapshot_node",
    "filter_to_allowed_ids",
    "merge_keyed_string_updates",
    "structured_llm_call",
    "unpack_similar_payload",
    "unpack_structured_response",
]
