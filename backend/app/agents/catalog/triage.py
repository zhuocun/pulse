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
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.pipeline import linear_graph
from app.agents.catalog._schemas import NUDGE_ID_MAX, NUDGE_SUMMARY_MAX
from app.agents.catalog._shared import (
    detect_drift_node,
    fetch_snapshot_node,
    merge_keyed_string_updates,
)
from app.agents.context import ChatContext
from app.agents.polish import PolishStep
from app.agents.state import TriageState
from app.tools.redaction import redact_dict
from app.store import namespaces
from langgraph.runtime import get_runtime

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


def load_profile_hint_node(state: TriageState) -> dict[str, Any]:
    rt = get_runtime(ChatContext)
    store = rt.store
    ctx = rt.context or {}
    pid = ctx.get("project_id")
    if store is None or not isinstance(pid, str) or not pid.strip():
        return {}
    item = store.get(namespaces.project_profile(pid.strip()), "last_board_brief")
    if item is None:
        return {}
    value = getattr(item, "value", None)
    if isinstance(value, dict):
        return {"profile_hint": dict(value)}
    return {}


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


def _build_triage_prompt(state: dict[str, Any]) -> str:
    deterministic_nudges = state["_nudges"]
    board_snapshot = state["_snapshot"]
    nudge_summaries = [
        {
            "nudge_id": f"{n.get('type', 'triage')}:{idx}",
            "summary": n.get("summary", "Triage"),
            "details": n.get("details") or {},
        }
        for idx, n in enumerate(deterministic_nudges)
    ]
    safe_snapshot = redact_dict(_truncate_snapshot(board_snapshot))
    safe_nudges = redact_dict(nudge_summaries)
    hint = state.get("_profile_hint")
    hint_suffix = ""
    if isinstance(hint, dict) and hint:
        hint_suffix = (
            f"\nPrior brief drift profile: "
            f"{json.dumps(redact_dict(hint))}\n"
        )
    return (
        "Rewrite the summary for each board-triage nudge below so it is "
        "specific and actionable, incorporating the signal details (e.g. "
        "column name, current count vs. WIP limit, task id). Keep each "
        "summary <=120 chars and on a single line. Preserve the nudge_id "
        "verbatim; do not invent new nudges. Return JSON matching the schema.\n\n"
        f"Board snapshot: {json.dumps(safe_snapshot)}\n"
        f"Nudges: {json.dumps(safe_nudges)}"
        f"{hint_suffix}"
    )


def _merge_triage(state: dict[str, Any], parsed: Any) -> dict[str, Any]:
    deterministic_nudges = state["_nudges"]
    valid_ids = {
        f"{n.get('type', 'triage')}:{idx}"
        for idx, n in enumerate(deterministic_nudges)
    }

    def _nudge_key(nudge: dict[str, Any], idx: int) -> str:
        return f"{nudge.get('type', 'triage')}:{idx}"

    if isinstance(parsed, TriagePolish):
        result = merge_keyed_string_updates(
            parsed.nudges,
            deterministic_nudges,
            key_from_parsed=lambda item: item.nudge_id
            if item.nudge_id in valid_ids
            else None,
            key_from_deterministic=_nudge_key,
            string_fields={"summary": NUDGE_SUMMARY_MAX},
        )
    else:
        result = parsed  # fallback value (list)
    return {"_result": result}


_triage_step: PolishStep[TriagePolish] = PolishStep(
    prompt_fn=_build_triage_prompt,
    schema=TriagePolish,
    fallback_fn=lambda state: state["_nudges"],
    merge_fn=_merge_triage,
)


async def _polish_triage(
    model: BaseChatModel,
    deterministic_nudges: list[dict[str, Any]],
    board_snapshot: dict[str, Any],
    *,
    profile_hint: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], Optional[AIMessage], int, int]:
    """4-tuple variant: returns ``(nudges, raw_msg, tokens_in, tokens_out)``.

    The raw ``AIMessage`` carries ``usage_metadata`` so ``generate_nudges``
    can include it in state messages for end-of-run budget reconciliation.
    """
    if not deterministic_nudges:
        return deterministic_nudges, None, 0, 0
    _state: dict[str, Any] = {
        "_nudges": deterministic_nudges,
        "_snapshot": board_snapshot,
    }
    if profile_hint:
        _state["_profile_hint"] = profile_hint
    update, tokens_in, tokens_out = await _triage_step.run(_state, model)
    raw_msg: Optional[AIMessage] = (
        AIMessage(
            content="",
            usage_metadata={
                "input_tokens": tokens_in,
                "output_tokens": tokens_out,
                "total_tokens": tokens_in + tokens_out,
            },
        )
        if (tokens_in or tokens_out)
        else None
    )
    return update["_result"], raw_msg, tokens_in, tokens_out


async def polish_triage(
    model: BaseChatModel,
    deterministic_nudges: list[dict[str, Any]],
    board_snapshot: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, int]:
    """3-tuple wrapper: ``(polished_nudges, tokens_in, tokens_out)``.

    Kept for backward compatibility with tests that import it directly.
    Internal callers use :func:`_polish_triage` so the raw ``AIMessage``
    can be appended to state messages for budget reconciliation.
    """

    nudges, _raw_msg, tokens_in, tokens_out = await _polish_triage(
        model, deterministic_nudges, board_snapshot
    )
    return nudges, tokens_in, tokens_out


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
        _default_model = self.chat_model  # captured for fallback

        # Both bodies are shared with board-brief-agent (same state keys,
        # same logic).  See ``app.agents.catalog._shared`` for the
        # implementations.
        fetch_snapshot = fetch_snapshot_node
        detect_drift = detect_drift_node

        async def generate_nudges(state: TriageState) -> dict[str, Any]:
            # Prefer the per-call context model; fall back to the default.
            _rt = get_runtime(ChatContext)
            _ctx = _rt.context or {}
            chat_model: BaseChatModel = _ctx.get("chat_model") or _default_model
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            nudges = _nudges_for(drift)
            board_snapshot = state.get("board_snapshot") or {}
            polished_nudges, raw_msg, _tokens_in, _tokens_out = await _polish_triage(
                chat_model,
                nudges,
                board_snapshot,
                profile_hint=state.get("profile_hint"),
            )
            # F-43: project_id is now in context, not state.
            project_id = _ctx.get("project_id") or ""
            # Demo-state visibility: a no-drift board used to surface zero
            # nudges with no signal, indistinguishable from "agent never ran".
            # Emit a single "healthy" nudge so the panel is never silently
            # empty.
            if not polished_nudges:
                polished_nudges = [
                    {
                        "type": "healthy",
                        "summary": "No drift detected - board looks healthy.",
                        "severity": "info",
                        "details": {},
                        "actions": [],
                    }
                ]
            extra_messages = [raw_msg] if raw_msg is not None else []
            new_events: list[dict] = []
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
                new_events.append({"kind": "suggestion", "surface": "nudge", "payload": fe_nudge})
            return {
                "nudges": polished_nudges,
                "messages": [
                    *extra_messages,
                    AIMessage(content=json.dumps(polished_nudges)),
                ],
                "events": new_events,
            }

        graph: StateGraph = linear_graph(
            TriageState,
            [
                ("fetch_snapshot", fetch_snapshot),
                ("load_profile_hint", load_profile_hint_node),
                ("detect_drift", detect_drift),
                ("generate_nudges", generate_nudges),
            ],
            context_schema=ChatContext,
        )
        return graph.compile(checkpointer=checkpointer, store=store)


