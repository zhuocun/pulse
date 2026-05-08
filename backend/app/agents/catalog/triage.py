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
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._schemas import NUDGE_ID_MAX, NUDGE_SUMMARY_MAX
from app.agents.catalog._shared import (
    detect_drift_node,
    emit_usage,
    fetch_snapshot_node,
    merge_keyed_string_updates,
    structured_llm_call,
)
from app.agents.registry import registry
from app.agents.state import TriageState
from app.agents.stream import emit_custom
from app.tools.redaction import redact_dict

logger = logging.getLogger(__name__)


# Cap how much board snapshot we forward to the provider. Real boards
# can carry hundreds of tasks; the headline / nudge prompt only needs
# enough context to recognise drift, and a 200kB snapshot wastes the
# context window.
_SNAPSHOT_TRUNCATION = {
    "tasks": 20,
    "columns": 12,
    "members": 25,
}


def _truncate_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``snapshot`` with bulky list fields capped."""

    if not isinstance(snapshot, dict):
        return snapshot
    out = dict(snapshot)
    for key, cap in _SNAPSHOT_TRUNCATION.items():
        items = snapshot.get(key)
        if isinstance(items, list) and len(items) > cap:
            out[key] = items[:cap]
    return out


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


# Per-signal severity. The board-level ``drift["severity"]`` is the
# *aggregate* (e.g. "critical" if any unowned bug exists) and used to be
# applied to every nudge identically -- so a board with one unowned bug
# and one stale task surfaced the stale task as ``"critical"``. Map each
# signal type to its own severity instead. Unknown types fall back to
# the aggregate so a future signal kind keeps a sensible default.
_SIGNAL_SEVERITY = {
    "unowned_bug": "critical",
    "wip_overflow": "warn",
    "stale_task": "warn",
}


def _nudges_for(drift: dict[str, Any]) -> list[dict[str, Any]]:
    aggregate_severity = drift.get("severity", "info")
    nudges: list[dict[str, Any]] = []
    for signal in drift.get("signals", []):
        signal_type = signal.get("type")
        nudges.append(
            {
                "type": signal_type,
                "summary": _NUDGE_TITLES.get(signal_type, "Triage"),
                "severity": _SIGNAL_SEVERITY.get(signal_type, aggregate_severity),
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

    nudge_id: str = Field(default="", max_length=NUDGE_ID_MAX)
    summary: str = Field(
        default="",
        max_length=NUDGE_SUMMARY_MAX,
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


async def polish_triage(
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

    if not deterministic_nudges:
        return deterministic_nudges, 0, 0

    # Build the FE nudge_id -> summary mapping for the prompt so the model has
    # the same context that the generate_nudges node constructs.
    nudge_summaries = [
        {
            "nudge_id": f"{n.get('type', 'triage')}:{idx}",
            "summary": n.get("summary", "Triage"),
            "details": n.get("details") or {},
        }
        for idx, n in enumerate(deterministic_nudges)
    ]
    # Trim and redact the snapshot before forwarding to the provider:
    # raw boards can carry hundreds of tasks (context-window pressure)
    # and column / task names that contain user PII.
    safe_snapshot = redact_dict(_truncate_snapshot(board_snapshot))
    safe_nudges = redact_dict(nudge_summaries)
    prompt = (
        "Rewrite the summary for each board-triage nudge below so it is "
        "specific and actionable, incorporating the signal details (e.g. "
        "column name, current count vs. WIP limit, task id). Keep each "
        "summary <=120 chars and on a single line. Preserve the nudge_id "
        "verbatim; do not invent new nudges. Return JSON matching the schema.\n\n"
        f"Board snapshot: {json.dumps(safe_snapshot)}\n"
        f"Nudges: {json.dumps(safe_nudges)}"
    )

    # Build a lookup keyed by the stable nudge_id format.
    valid_ids = {
        f"{n.get('type', 'triage')}:{idx}" for idx, n in enumerate(deterministic_nudges)
    }

    def _nudge_key(nudge: dict[str, Any], idx: int) -> str:
        return f"{nudge.get('type', 'triage')}:{idx}"

    def _merge(parsed: TriagePolish) -> list[dict[str, Any]]:
        return merge_keyed_string_updates(
            parsed.nudges,
            deterministic_nudges,
            key_from_parsed=lambda item: item.nudge_id
            if item.nudge_id in valid_ids
            else None,
            key_from_deterministic=_nudge_key,
            string_fields={"summary": NUDGE_SUMMARY_MAX},
        )

    return await structured_llm_call(
        model,
        TriagePolish,
        [HumanMessage(content=prompt)],
        fallback=deterministic_nudges,
        merge_fn=_merge,
    )


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
        redactable_dict_fields=("context",),
        rationale={
            "recursion_limit": (
                "Three-node linear graph (fetch → detect → generate); "
                "6 mirrors board-brief's structurally identical pattern."
            ),
            "rate_limit": (
                "Triage is dashboard-refresh-paced like board-brief; "
                "10/min keeps idle pollers cheap."
            ),
            "allowed_autonomy": (
                "Nudges are advisory; suggest-only by policy."
            ),
        },
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        # Both bodies are shared with board-brief-agent (same state keys,
        # same logic).  See ``app.agents.catalog._shared`` for the
        # implementations.
        fetch_snapshot = fetch_snapshot_node
        detect_drift = detect_drift_node

        async def generate_nudges(state: TriageState) -> dict[str, Any]:
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            nudges = _nudges_for(drift)
            board_snapshot = state.get("board_snapshot") or {}
            polished_nudges, tokens_in, tokens_out = await polish_triage(
                chat_model, nudges, board_snapshot
            )
            project_id = state.get("project_id") or ""
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
                # Use the per-nudge severity (set by ``_nudges_for``) so a
                # mixed-signal board surfaces stale tasks as ``"warn"`` even
                # when an unowned bug bumped the aggregate to ``"critical"``.
                fe_severity = _FE_NUDGE_SEVERITY.get(
                    nudge.get("severity", "info"), "info"
                )
                fe_nudge = {
                    "nudge_id": f"{nudge.get('type', 'triage')}:{index}",
                    "kind": nudge.get("type", "stale_task"),
                    "project_id": project_id,
                    "summary": nudge.get("summary", "Triage"),
                    "target_ids": target_ids,
                    "severity": fe_severity,
                }
                emit_custom({"kind": "suggestion", "surface": "nudge", "payload": fe_nudge})
            emit_usage(tokens_in, tokens_out)
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
