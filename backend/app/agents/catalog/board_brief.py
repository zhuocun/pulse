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

import asyncio
import json
import logging
from collections import Counter
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from langgraph.runtime import get_runtime

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.pipeline import linear_graph
from app.agents.catalog._schemas import HEADLINE_MAX
from app.agents.catalog._shared import (
    build_citation_refs,
    detect_drift_node,
    fetch_snapshot_node,
    make_usage_message,
    resolve_chat_model,
    truncate_snapshot,
)
from app.agents.context import ChatContext
from app.agents.identity import COPILOT_IDENTITY
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.polish import PolishStep
from app.agents.state import BoardBriefState
from app.tools.be_tools import _is_done_column
from app.tools.fe_tool_names import FE_BOARD_SNAPSHOT
from app.tools.redaction import redact_dict
from app.store import namespaces

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Deterministic board-brief baseline (ported from v1_engine.py).
# ---------------------------------------------------------------------------


def _column_index(columns: Any) -> dict[str, str]:
    column_index: dict[str, str] = {}
    for col in columns if isinstance(columns, list) else []:
        if not isinstance(col, dict):
            continue
        cid = col.get("_id")
        if isinstance(cid, str):
            column_index[cid] = col.get("name") or cid
    return column_index


def _column_task_counts(columns: Any, tasks: Any) -> list[dict[str, Any]]:
    """Per-column task counts for ``IBoardBrief.counts``."""
    task_list = tasks if isinstance(tasks, list) else []
    column_index = _column_index(columns)
    column_task_count: Counter[str] = Counter()
    for task in task_list:
        if not isinstance(task, dict):
            continue
        cid = task.get("columnId")
        if isinstance(cid, str):
            column_task_count[cid] += 1
    counts: list[dict[str, Any]] = []
    for cid, name in column_index.items():
        counts.append(
            {
                "columnId": cid,
                "columnName": name,
                "count": column_task_count.get(cid, 0),
            }
        )
    return counts


def _compute_board_brief(context: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IBoardBrief`` for the given board context.

    Byte-identical to :func:`app.services.v1_engine.board_brief`.
    This function is intentionally kept at module level so it can be
    tested directly.
    """
    columns = context.get("columns") or []
    tasks = context.get("tasks") or []
    task_list = tasks if isinstance(tasks, list) else []
    members = context.get("members") or []
    counts = _column_task_counts(columns, tasks)
    column_index = _column_index(columns)
    largest = sorted(
        [t for t in task_list if isinstance(t, dict) and isinstance(t.get("_id"), str)],
        key=lambda t: int(t.get("storyPoints") or 0),
        reverse=True,
    )[:3]
    largest_unstarted = [
        {
            "taskId": t["_id"],
            "taskName": t.get("taskName") or "",
            "storyPoints": int(t.get("storyPoints") or 0),
        }
        for t in largest
        if (
            t.get("columnId")
            and column_index.get(t.get("columnId"), "").lower().strip() != "done"
        )
    ]
    unowned = [
        {"taskId": t["_id"], "taskName": t.get("taskName") or ""}
        for t in task_list
        if isinstance(t, dict)
        and isinstance(t.get("_id"), str)
        and not t.get("coordinatorId")
    ][:5]
    member_index = {m.get("_id"): m for m in members if isinstance(m, dict)}
    member_load: dict[str, dict[str, Any]] = {}
    for task in task_list:
        if not isinstance(task, dict):
            continue
        coordinator = task.get("coordinatorId")
        if not isinstance(coordinator, str):
            continue
        entry = member_load.setdefault(
            coordinator,
            {
                "memberId": coordinator,
                "username": (member_index.get(coordinator) or {}).get(
                    "username", coordinator
                ),
                "openTasks": 0,
                "openPoints": 0,
            },
        )
        entry["openTasks"] += 1
        entry["openPoints"] += int(task.get("storyPoints") or 0)
    workload = sorted(
        member_load.values(), key=lambda m: m["openPoints"], reverse=True
    )[:5]
    if not task_list and not (columns if isinstance(columns, list) else []):
        # Demo-state visibility: an empty board used to surface as
        # "0 tasks across 0 columns; 0 unowned, 0 large unstarted." which is
        # indistinguishable from a successful brief on a tiny project.
        # Produce something a viewer recognises as a deliberate empty state.
        headline = "Board is empty - add tasks to see a brief."
        recommendation = "Create the first column and a starter task."
    else:
        headline = (
            f"{len(task_list)} tasks across {len(columns)} columns; "
            f"{len(unowned)} unowned, {len(largest_unstarted)} large unstarted."
        )
        recommendation = (
            "Reassign unowned bugs first; chunk large unstarted cards."
        )
    return {
        "headline": headline[:HEADLINE_MAX],
        "counts": counts,
        "largestUnstarted": largest_unstarted,
        "unowned": unowned,
        "workload": workload,
        "recommendation": recommendation,
    }


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
        max_length=HEADLINE_MAX,
        description=(
            "Single-line, <=120-character standup headline for the board, "
            "grounded only in the provided facts."
        ),
    )


def _build_headline_prompt(state: dict[str, Any]) -> str:
    safe_facts = redact_dict(state["_facts"])
    return (
        COPILOT_IDENTITY
        + "\n\n"
        + "Write a single-line, <=120-character standup headline for this "
        "board snapshot. Do not invent counts; only use the "
        "facts provided. Return JSON matching the schema. Facts (JSON):\n"
        + json.dumps(safe_facts)
    )


_headline_step: PolishStep[BriefHeadline] = PolishStep(
    prompt_fn=_build_headline_prompt,
    schema=BriefHeadline,
    fallback_fn=lambda state: state["_deterministic"],
    cap_field=("headline", HEADLINE_MAX),
)


async def _polish_headline(
    model: BaseChatModel,
    deterministic: str,
    facts: dict[str, Any],
) -> tuple[str, Any, int, int]:
    """Internal 4-tuple variant of :func:`polish_headline`.

    Returns ``(headline, raw_message, tokens_in, tokens_out)``. The
    ``raw_message`` is the underlying ``AIMessage`` with ``usage_metadata``
    populated. The ``generate_brief`` node captures this to include in state
    messages for budget tracking.  It is ``None`` on the stub path or when the
    call fails.
    """
    _state = {"_deterministic": deterministic, "_facts": facts}
    update, tokens_in, tokens_out = await _headline_step.run(_state, model)
    raw_msg = make_usage_message(tokens_in, tokens_out)
    return update["_result"], raw_msg, tokens_in, tokens_out


async def polish_headline(
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

    For internal use (where budget tracking needs the raw ``AIMessage``),
    call :func:`_polish_headline` instead.
    """
    headline, _raw_msg, tokens_in, tokens_out = await _polish_headline(
        model, deterministic, facts
    )
    return headline, tokens_in, tokens_out


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
        tools=(FE_BOARD_SNAPSHOT, "be.detect_drift", "be.summarize"),
        redactable_dict_fields=("context",),
        rationale={
            "recursion_limit": (
                "Single-pass graph (fetch → detect → generate → emit); "
                "6 is comfortably above the 4 supersteps needed."
            ),
            "rate_limit": (
                "Briefs are dashboard refreshes, not interactive; 10/min "
                "matches a one-per-six-second polling ceiling."
            ),
            "allowed_autonomy": (
                "Read-only summary surface; suggest-only by policy."
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

        # Both bodies are shared with triage-agent (same state keys, same
        # logic).  See ``app.agents.catalog._shared`` for the implementations.
        fetch_snapshot = fetch_snapshot_node
        detect_drift = detect_drift_node

        async def generate_brief(state: BoardBriefState) -> dict[str, Any]:
            # Prefer the per-call context model; fall back to the default
            # captured at build time for callers that don't inject a context.
            chat_model: BaseChatModel = resolve_chat_model(_default_model)
            snapshot = state.get("board_snapshot") or {}
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            # Truncate snapshot before forwarding to provider context window
            # (same cap as triage: tasks<=20, columns<=12, members<=25).
            snapshot_for_prompt = truncate_snapshot(snapshot)
            tasks = snapshot_for_prompt.get("tasks") or []
            columns = snapshot_for_prompt.get("columns") or []
            # Build the set of done column ids using the same logic as the
            # drift detector (_is_done_column checks isDone flag + synonym set)
            # so boards with columns named "Completed", "Finished", etc. are
            # counted correctly rather than only matching a literal "done".
            done_col_ids = {
                col.get("id")
                for col in columns
                if isinstance(col, dict) and _is_done_column(col)
            }
            done_count = sum(
                1
                for t in tasks
                if isinstance(t, dict)
                and (
                    t.get("columnId") in done_col_ids
                    or t.get("column") in done_col_ids
                )
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
            brief = _compute_board_brief(_normalize_snapshot_for_v1_engine(snapshot))
            deterministic = brief["headline"]
            headline, raw_msg, _tokens_in, _tokens_out = await _polish_headline(
                chat_model, deterministic, facts
            )
            brief = {**brief, "headline": headline}
            # Include the raw AIMessage (with usage_metadata) in state messages
            # so budget tracking can aggregate token counts from state.
            extra_messages = [raw_msg] if raw_msg is not None else []
            # Store drift severity and drift result separately so downstream
            # nodes (e.g. triage) can still read them without touching ``brief``.
            return {
                "brief": brief,
                "drift_severity": severity,
                "drift": drift,
                **({"messages": extra_messages} if extra_messages else {}),
            }

        async def emit_citations(state: BoardBriefState) -> dict[str, Any]:
            brief = state.get("brief") or {}
            drift = state.get("drift_result") or {"signals": [], "severity": "info"}
            severity = drift.get("severity", "info")
            rt = get_runtime(ChatContext)
            store = rt.store
            ctx = rt.context or {}
            project_id = ctx.get("project_id")
            if (
                store is not None
                and isinstance(project_id, str)
                and project_id.strip()
            ):
                ns = namespaces.project_profile(project_id.strip())
                put_value = {
                    "drift_severity": severity,
                    "signal_types": [
                        s.get("type")
                        for s in drift.get("signals", [])
                        if isinstance(s, dict)
                    ],
                }
                # Use aput when available to avoid blocking the event loop on
                # Postgres writes; fall back to to_thread for sync-only stores.
                if hasattr(store, "aput"):
                    await store.aput(ns, "last_board_brief", put_value)
                else:
                    await asyncio.to_thread(
                        store.put, ns, "last_board_brief", put_value
                    )
            snapshot = state.get("board_snapshot") or {}
            tasks = snapshot.get("tasks") or []
            columns = snapshot.get("columns") or []
            # Build refs: we need to attach them to recommendationDetail
            # before the suggestion event goes out.
            task_refs = build_citation_refs(
                tasks,
                "task",
                get_quote=lambda t: t.get("taskName") or t.get("id") or "",
            )
            col_refs = build_citation_refs(
                columns,
                "column",
                max_items=2,
                get_quote=lambda c: c.get("name") or c.get("id") or "",
            )
            refs = task_refs + col_refs
            new_events: list[dict] = []
            if refs:
                new_events.append({"kind": "citation", "refs": refs})
            # Attach recommendationDetail so the FE can render the strength
            # badge and "Why" disclosure inline; reuses the same refs so
            # provenance is consistent with the citation event above.
            recommendation_detail = build_recommendation_detail(brief, drift, refs)
            payload = {**brief, "recommendationDetail": recommendation_detail}
            new_events.append(
                {
                    "kind": "suggestion",
                    "surface": "brief",
                    "payload": payload,
                }
            )
            return {
                "messages": [AIMessage(content=json.dumps(payload))],
                "events": new_events,
            }

        graph: StateGraph = linear_graph(
            BoardBriefState,
            [
                ("fetch_snapshot", fetch_snapshot),
                ("detect_drift", detect_drift),
                ("generate_brief", generate_brief),
                ("emit_citations", emit_citations),
            ],
            context_schema=ChatContext,
        )
        return graph.compile(checkpointer=checkpointer, store=store)


