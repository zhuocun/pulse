"""``board-brief-agent`` -- structured board summary with drift-aware headline.

Implements PRD v2.1 §5A.3. The graph fetches a board snapshot from the FE
via ``interrupt``, runs deterministic drift detection, and emits a
structured ``IBoardBrief`` payload. With a real chat model configured the
headline is polished by the LLM (via ``with_structured_output`` against a
typed Pydantic schema, with token usage read from the raw ``AIMessage``);
with the deterministic stub the headline falls back to
:func:`be_tools.summarize`.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.llm import extract_token_usage, is_stub_model
from app.agents.registry import registry
from app.agents.state import BoardBriefState
from app.agents.stream import emit_custom
from app.services import v1_engine
from app.tools import be_tools
from app.tools.be_tools import validated_citation_ref
from app.tools.fe_tool_schemas import interrupt_payload

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Snapshot key normalisation (id → _id)
# ---------------------------------------------------------------------------


def _normalize_snapshot_for_v1_engine(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``snapshot`` where each column/task/member carries ``_id``.

    The FE sends snapshots with ``id`` keys (e.g. ``{"id": "c1"}``), but
    :func:`app.services.v1_engine.board_brief` iterates with ``col.get("_id")``.
    This helper adds ``_id`` from ``id`` so both callers are satisfied without
    modifying the original dict.
    """

    def _add_id(item: Any) -> Any:
        if not isinstance(item, dict):
            return item
        if "id" in item and "_id" not in item:
            return {**item, "_id": item["id"]}
        return item

    result = dict(snapshot)
    for list_key in ("columns", "tasks", "members"):
        items = snapshot.get(list_key)
        if isinstance(items, list):
            result[list_key] = [_add_id(item) for item in items]
    return result


# ---------------------------------------------------------------------------
# recommendationDetail strength bucketing
# ---------------------------------------------------------------------------

# Thresholds for mapping drift signals to a recommendation strength label.
# "strong"   — unowned bug tasks exist (no coordinator + type=bug) OR
#              unowned tasks > 3: these are blocking quality/ownership
#              issues that need immediate action.
# "moderate" — any wip_overflow or stale_task signals: real drift but not
#              immediately blocking; important to surface but less urgent.
# "none"     — no signals at all (severity "info"): board is steady-state.
_RD_STRONG_UNOWNED_THRESHOLD: int = 3  # unowned count > this → "strong"


def _recommendation_strength(
    signals: list[dict[str, Any]],
    unowned_count: int,
) -> str:
    """Derive recommendation strength from drift signals and unowned count.

    Returns one of ``"strong"``, ``"moderate"``, or ``"none"``.
    """
    signal_types = {s.get("type") for s in signals if isinstance(s, dict)}
    if "unowned_bug" in signal_types or unowned_count > _RD_STRONG_UNOWNED_THRESHOLD:
        return "strong"
    if signal_types:
        return "moderate"
    return "none"


def _recommendation_basis(
    signals: list[dict[str, Any]],
    unowned_count: int,
    brief: dict[str, Any],
) -> str:
    """Build a short basis string (<=140 chars) from the signal data.

    Constructed deterministically from the same data used in the
    recommendation text so the FE "Why" disclosure stays consistent.
    """
    parts: list[str] = []
    signal_types = [s.get("type") for s in signals if isinstance(s, dict)]
    unowned_bug_count = signal_types.count("unowned_bug")
    wip_overflow_count = signal_types.count("wip_overflow")
    stale_count = signal_types.count("stale_task")
    if unowned_bug_count:
        parts.append(f"{unowned_bug_count} unowned bug(s)")
    if unowned_count > 0 and unowned_bug_count == 0:
        parts.append(f"{unowned_count} unowned task(s)")
    elif unowned_count > unowned_bug_count:
        parts.append(f"{unowned_count - unowned_bug_count} other unowned task(s)")
    if wip_overflow_count:
        overflow_signal = next(
            (
                s
                for s in signals
                if isinstance(s, dict) and s.get("type") == "wip_overflow"
            ),
            {},
        )
        col = overflow_signal.get("column_name") or "a column"
        count = overflow_signal.get("count", "?")
        limit = overflow_signal.get("limit", "?")
        parts.append(f"{col} WIP {count} > limit {limit}")
    if stale_count:
        parts.append(f"{stale_count} stale task(s)")
    if not parts:
        task_count = len(brief.get("largestUnstarted") or [])
        if task_count:
            parts.append(f"{task_count} large unstarted task(s)")
        else:
            parts.append("no drift detected")
    basis = "; ".join(parts)
    return basis[:140]


def build_recommendation_detail(
    brief: dict[str, Any],
    drift: dict[str, Any],
    refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return the ``recommendationDetail`` object for a board brief.

    ``brief`` must be a full ``IBoardBrief`` dict (as returned by
    :func:`app.services.v1_engine.board_brief`).  ``drift`` is the result
    of :func:`app.tools.be_tools.detect_drift`.  ``refs`` are the citation
    refs to attach as ``sources``.

    This function is intentionally kept at module level (not nested in the
    graph closure) so the v1 shim in :mod:`app.routers.ai` can call it
    without instantiating the full graph.
    """
    signals = drift.get("signals") or []
    unowned_count = len(brief.get("unowned") or [])
    strength = _recommendation_strength(signals, unowned_count)
    basis = _recommendation_basis(signals, unowned_count, brief)
    text = brief.get("recommendation") or ""
    return {
        "text": text,
        "strength": strength,
        "basis": basis,
        "sources": refs,
    }


class BriefHeadline(BaseModel):
    """Typed schema the LLM fills via ``with_structured_output``.

    Keeping the headline length cap on the schema (rather than only in
    prose) lets a JSON-mode-capable provider self-correct without a
    second round-trip. Public so tests / future callers can reuse it.
    """

    headline: str = Field(
        default="",
        max_length=120,
        description=(
            "Single-line, <=120-character standup headline for the board, "
            "grounded only in the provided facts."
        ),
    )


def polish_headline(
    model: BaseChatModel,
    deterministic: str,
    facts: dict[str, Any],
) -> tuple[str, int, int]:
    """Ask the model to write a one-line headline; deterministic fallback on stub.

    Returns ``(headline, tokens_in, tokens_out)``. The model is asked for a
    typed :class:`BriefHeadline` payload via ``with_structured_output``; we
    keep ``include_raw=True`` so token usage stays observable on the
    underlying ``AIMessage``. Any structured-output error (parsing failure,
    blank field, unsupported provider) lands on the deterministic
    fallback so the FE layout never breaks.
    """

    if is_stub_model(model):
        return deterministic, 0, 0
    prompt = (
        "Write a single-line, <=120-character standup headline for this "
        "Jira-style board snapshot. Do not invent counts; only use the "
        "facts provided. Return JSON matching the schema. Facts (JSON):\n"
        + json.dumps(facts)
    )
    try:
        structured = model.with_structured_output(BriefHeadline, include_raw=True)
        response = structured.invoke([HumanMessage(content=prompt)])
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("board-brief structured output failed; falling back.")
        return deterministic, 0, 0
    raw = response.get("raw") if isinstance(response, dict) else None
    parsed = response.get("parsed") if isinstance(response, dict) else None
    error = response.get("parsing_error") if isinstance(response, dict) else None
    tokens_in, tokens_out = extract_token_usage(raw)
    if error is not None or not isinstance(parsed, BriefHeadline):
        return deterministic, tokens_in, tokens_out
    text = (parsed.headline or "").strip()
    if not text:
        return deterministic, tokens_in, tokens_out
    cleaned = text.splitlines()[0]
    return cleaned[:120], tokens_in, tokens_out


class BoardBriefAgent(BaseAgent):
    """Generate a structured brief about a project board."""

    metadata = AgentMetadata(
        name="board-brief-agent",
        description="Structured board summary with drift-aware headline.",
        version="1.0.0",
        tags=("board-copilot", "brief"),
        recursion_limit=6,
        status="active",
        rate_limit=(10, 60),
        allowed_autonomy=("suggest",),
        tools=("fe.boardSnapshot", "be.detect_drift", "be.summarize"),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        def fetch_snapshot(state: BoardBriefState) -> dict[str, Any]:
            snapshot = interrupt(
                interrupt_payload(
                    "fe.boardSnapshot",
                    {"project_id": state.get("project_id")},
                )
            )
            return {"board_snapshot": snapshot}

        def detect_drift(state: BoardBriefState) -> dict[str, Any]:
            snapshot = state.get("board_snapshot") or {}
            return {"drift_result": be_tools.detect_drift(snapshot)}

        def generate_brief(state: BoardBriefState) -> dict[str, Any]:
            snapshot = state.get("board_snapshot") or {}
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            tasks = snapshot.get("tasks") or []
            columns = snapshot.get("columns") or []
            done_count = sum(
                1 for t in tasks if (t.get("column") or "").lower() == "done"
            )
            severity = drift.get("severity", "info")
            facts = {
                "tasks": len(tasks),
                "columns": len(columns),
                "done": done_count,
                "drift_severity": severity,
                "signals": drift.get("signals", [])[:5],
            }
            # Build IBoardBrief-shaped payload via v1_engine; only the
            # headline is polished by the LLM (deterministic fallback on stub).
            # Normalize id→_id so v1_engine (which uses _id keys) works
            # correctly with the FE-supplied snapshot (which uses id keys).
            brief = v1_engine.board_brief(_normalize_snapshot_for_v1_engine(snapshot))
            deterministic = brief["headline"]
            headline, tokens_in, tokens_out = polish_headline(
                chat_model, deterministic, facts
            )
            brief = {**brief, "headline": headline}
            emit_custom(
                {"kind": "usage", "tokensIn": tokens_in, "tokensOut": tokens_out}
            )
            # Store drift severity and drift result separately so downstream
            # nodes (e.g. triage) can still read them without touching ``brief``.
            return {"brief": brief, "drift_severity": severity, "drift": drift}

        def emit_citations(state: BoardBriefState) -> dict[str, Any]:
            brief = state.get("brief") or {}
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            snapshot = state.get("board_snapshot") or {}
            tasks = snapshot.get("tasks") or []
            columns = snapshot.get("columns") or []
            refs: list[dict[str, Any]] = []
            for task in tasks[:3]:
                refs.append(
                    validated_citation_ref(
                        source="task",
                        id=task.get("id"),
                        quote=task.get("taskName") or task.get("id") or "",
                    )
                )
            for column in columns[:2]:
                refs.append(
                    validated_citation_ref(
                        source="column",
                        id=column.get("id"),
                        quote=column.get("name") or column.get("id") or "",
                    )
                )
            if refs:
                emit_custom({"kind": "citation", "refs": refs})
            # Attach recommendationDetail so the FE can render the strength
            # badge and "Why" disclosure inline; reuses the same refs so
            # provenance is consistent with the citation event above.
            recommendation_detail = build_recommendation_detail(brief, drift, refs)
            payload = {**brief, "recommendationDetail": recommendation_detail}
            emit_custom(
                {
                    "kind": "suggestion",
                    "surface": "brief",
                    "payload": payload,
                }
            )
            return {"messages": [AIMessage(content=json.dumps(payload))]}

        graph: StateGraph = StateGraph(BoardBriefState)
        graph.add_node("fetch_snapshot", fetch_snapshot)
        graph.add_node("detect_drift", detect_drift)
        graph.add_node("generate_brief", generate_brief)
        graph.add_node("emit_citations", emit_citations)
        graph.add_edge(START, "fetch_snapshot")
        graph.add_edge("fetch_snapshot", "detect_drift")
        graph.add_edge("detect_drift", "generate_brief")
        graph.add_edge("generate_brief", "emit_citations")
        graph.add_edge("emit_citations", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(BoardBriefAgent(), replace=True)
