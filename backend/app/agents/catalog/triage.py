"""``triage-agent`` -- proactive nudges generated from board drift.

Implements PRD v2.1 §5A.7. The graph fetches a snapshot via ``interrupt``,
runs the same drift detector as :mod:`board-brief-agent`, and produces a
list of :class:`TriageNudge` objects -- one per signal -- ready for the
FE to render as cards.

The rules engine is the authoritative source for *which* signals fire and
their severity. :func:`polish_triage` adds an optional LLM pass that
rewrites the ``summary`` string on each nudge to include signal-specific
context (e.g. "WIP overflow in 'In Progress' (8/5)" instead of the
generic "WIP overflow"). The deterministic text is preserved when the
model is the stub, raises an exception, or returns a blank string.
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
from app.agents.state import TriageState
from app.agents.stream import emit_custom
from app.tools import be_tools
from app.tools.fe_tool_schemas import interrupt_payload

logger = logging.getLogger(__name__)


_FE_NUDGE_SEVERITY = {
    "info": "info",
    "warn": "warn",
    "warning": "warn",
    "critical": "critical",
}


_NUDGE_TITLES = {
    "wip_overflow": "WIP overflow",
    "stale_task": "Stale task",
    "unowned_bug": "Unowned bug",
}


def _nudges_for(drift: dict[str, Any]) -> list[dict[str, Any]]:
    nudges: list[dict[str, Any]] = []
    for signal in drift.get("signals", []):
        signal_type = signal.get("type")
        nudges.append(
            {
                "type": signal_type,
                "title": _NUDGE_TITLES.get(signal_type, "Triage"),
                "severity": drift.get("severity", "info"),
                "details": signal,
                "actions": [
                    {"label": "Acknowledge"},
                    {"label": "Snooze"},
                ],
            }
        )
    return nudges


# ---------------------------------------------------------------------------
# LLM polish schemas
# ---------------------------------------------------------------------------


class NudgePolish(BaseModel):
    """One polished nudge row. ``nudge_id`` keys back to the deterministic nudge."""

    nudge_id: str = Field(default="", max_length=80)
    summary: str = Field(
        default="",
        max_length=120,
        description=(
            "Single-line, <=120-character refined summary for this nudge. "
            "Include signal-specific details (e.g. column name, count vs. limit). "
            "Do not invent new information not present in the signal."
        ),
    )


class TriagePolish(BaseModel):
    """Typed payload the LLM fills via ``with_structured_output``.

    Only the per-nudge ``summary`` string is eligible for LLM rewriting.
    ``nudge_id`` keys back to the deterministic nudge list; an unknown id
    from the model is silently dropped so the FE never sees injected nudges.
    """

    nudges: list[NudgePolish] = Field(default_factory=list)


def polish_triage(
    model: BaseChatModel,
    deterministic_nudges: list[dict[str, Any]],
    board_snapshot: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, int]:
    """Polish nudge summaries with LLM context; deterministic fallback on stub.

    Polished ``summary`` strings are merged back onto the deterministic nudge
    list keyed by ``nudge_id``. An unknown ``nudge_id`` from the model is
    ignored (no new nudges injected). A blank polished ``summary`` preserves
    the deterministic copy.

    Returns ``(polished_nudges, tokens_in, tokens_out)``.
    """

    if is_stub_model(model):
        return deterministic_nudges, 0, 0
    if not deterministic_nudges:
        return deterministic_nudges, 0, 0

    # Build the FE nudge_id -> title mapping for the prompt so the model has
    # the same context that the generate_nudges node constructs.
    nudge_summaries = [
        {
            "nudge_id": f"{n.get('type', 'triage')}:{idx}",
            "summary": n.get("title", "Triage"),
            "details": n.get("details") or {},
        }
        for idx, n in enumerate(deterministic_nudges)
    ]
    prompt = (
        "Rewrite the summary for each board-triage nudge below so it is "
        "specific and actionable, incorporating the signal details (e.g. "
        "column name, current count vs. WIP limit, task id). Keep each "
        "summary <=120 chars and on a single line. Preserve the nudge_id "
        "verbatim; do not invent new nudges. Return JSON matching the schema.\n\n"
        f"Board snapshot: {json.dumps(board_snapshot)}\n"
        f"Nudges: {json.dumps(nudge_summaries)}"
    )
    try:
        structured = model.with_structured_output(TriagePolish, include_raw=True)
        response = structured.invoke([HumanMessage(content=prompt)])
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("triage structured output failed; falling back.")
        return deterministic_nudges, 0, 0

    raw = response.get("raw") if isinstance(response, dict) else None
    parsed = response.get("parsed") if isinstance(response, dict) else None
    error = response.get("parsing_error") if isinstance(response, dict) else None
    tokens_in, tokens_out = extract_token_usage(raw)
    if error is not None or not isinstance(parsed, TriagePolish):
        return deterministic_nudges, tokens_in, tokens_out

    # Build a lookup keyed by the stable nudge_id format.
    valid_ids = {
        f"{n.get('type', 'triage')}:{idx}" for idx, n in enumerate(deterministic_nudges)
    }
    polished_by_id: dict[str, NudgePolish] = {
        item.nudge_id: item
        for item in parsed.nudges
        if item.nudge_id and item.nudge_id in valid_ids
    }

    merged: list[dict[str, Any]] = []
    for idx, nudge in enumerate(deterministic_nudges):
        nudge_id = f"{nudge.get('type', 'triage')}:{idx}"
        update = polished_by_id.get(nudge_id)
        merged_nudge = dict(nudge)
        if update is not None:
            polished_summary = (update.summary.splitlines() or [""])[0].strip()
            if polished_summary:
                merged_nudge["title"] = polished_summary[:120]
        merged.append(merged_nudge)
    return merged, tokens_in, tokens_out


class TriageAgent(BaseAgent):
    """Generate proactive nudges from board drift signals."""

    metadata = AgentMetadata(
        name="triage-agent",
        description="Generate proactive nudges from board drift signals.",
        version="1.0.0",
        tags=("board-copilot", "triage"),
        recursion_limit=6,
        status="active",
        rate_limit=(10, 60),
        allowed_autonomy=("suggest",),
        tools=("fe.boardSnapshot", "be.detect_drift"),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        def fetch_snapshot(state: TriageState) -> dict[str, Any]:
            snapshot = interrupt(
                interrupt_payload(
                    "fe.boardSnapshot",
                    {"project_id": state.get("project_id")},
                )
            )
            return {"board_snapshot": snapshot}

        def detect_drift(state: TriageState) -> dict[str, Any]:
            snapshot = state.get("board_snapshot") or {}
            return {"drift_result": be_tools.detect_drift(snapshot)}

        def generate_nudges(state: TriageState) -> dict[str, Any]:
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            nudges = _nudges_for(drift)
            board_snapshot = state.get("board_snapshot") or {}
            polished_nudges, tokens_in, tokens_out = polish_triage(
                chat_model, nudges, board_snapshot
            )
            project_id = state.get("project_id") or ""
            severity = _FE_NUDGE_SEVERITY.get(drift.get("severity", "info"), "info")
            for index, nudge in enumerate(polished_nudges):
                details = nudge.get("details") or {}
                target_ids = [
                    target_id
                    for target_id in (
                        details.get("task_id"),
                        details.get("column_id"),
                    )
                    if isinstance(target_id, str) and target_id
                ]
                fe_nudge = {
                    "nudge_id": f"{nudge.get('type', 'triage')}:{index}",
                    "kind": nudge.get("type", "stale_task"),
                    "project_id": project_id,
                    "summary": nudge.get("title", "Triage"),
                    "target_ids": target_ids,
                    "severity": severity,
                }
                emit_custom({"kind": "nudge", "nudge": fe_nudge})
            emit_custom({"kind": "usage", "tokensIn": tokens_in, "tokensOut": tokens_out})
            return {
                "nudges": polished_nudges,
                "messages": [AIMessage(content=json.dumps(polished_nudges))],
            }

        graph: StateGraph = StateGraph(TriageState)
        graph.add_node("fetch_snapshot", fetch_snapshot)
        graph.add_node("detect_drift", detect_drift)
        graph.add_node("generate_nudges", generate_nudges)
        graph.add_edge(START, "fetch_snapshot")
        graph.add_edge("fetch_snapshot", "detect_drift")
        graph.add_edge("detect_drift", "generate_nudges")
        graph.add_edge("generate_nudges", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(TriageAgent(), replace=True)
