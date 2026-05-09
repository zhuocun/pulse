"""``task-drafting-agent`` -- generate one or more task drafts from a prompt.

Implements PRD v2.1 §5A.4. The graph fetches grounding context from the FE
(board snapshot + similar tasks) via ``interrupt`` and returns a structured
``ITaskDraft`` payload. When ``breakdown_axis`` is set, the agent runs a
single deterministic breakdown step and returns multiple drafts. With a
real chat model configured, the eligible text fields (``taskName``,
``note``, ``rationale``) are polished via
``model.with_structured_output(DraftPolish, include_raw=True)`` so the FE
contract is enforced even when the provider hallucinates extra keys.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
import re
from typing import Any, Iterable, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._schemas import (
    DRAFT_RATIONALE_MAX,
    NOTE_MAX,
    TASKNAME_MAX,
)
from app.agents.catalog._shared import (
    fetch_similar_node,
    fetch_snapshot_node,
)
from app.agents.context import ChatContext
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.polish import PolishStep
from app.agents.registry import registry
from app.agents.state import TaskDraftingState
from langgraph.runtime import get_runtime
from app.domain.story_points import FIBONACCI_STORY_POINTS
from app.tools.redaction import redact, redact_dict, redact_task_fields

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Deterministic baseline helpers (ported from v1_engine.py so the agent can
# compute the v1 wire shape internally without the route pre-calling v1_engine).
# ---------------------------------------------------------------------------

_BUG_HINTS = (
    "bug",
    "fix",
    "broken",
    "crash",
    "error",
    "regression",
    "flaky",
    "leak",
    "issue",
    "incident",
    "outage",
    "failing",
)

_EPIC_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Bug Fix", _BUG_HINTS),
    (
        "Performance",
        ("slow", "perf", "latency", "throughput", "memory", "cache"),
    ),
    ("Auth", ("login", "auth", "token", "session", "password", "signup")),
    (
        "UI Polish",
        ("styling", "spacing", "color", "ui", "design", "layout", "modal"),
    ),
    ("Refactor", ("refactor", "cleanup", "rewrite", "migrate", "deprecate")),
    ("Documentation", ("docs", "documentation", "readme", "guide", "tutorial")),
    ("Testing", ("test", "tests", "coverage", "spec", "qa", "e2e")),
)

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokens(text: str) -> list[str]:
    return [m.group(0).lower() for m in _TOKEN_RE.finditer(text or "")]


def _token_set(text: str) -> set[str]:
    return set(_tokens(text))


def _jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    """Jaccard similarity between two token collections."""
    a_set = set(a)
    b_set = set(b)
    union = a_set | b_set
    if not union:
        return 0.0
    return len(a_set & b_set) / len(union)


def _clamp_fibonacci(value: int) -> int:
    """Snap ``value`` to the nearest Fibonacci point (PRD §5.2)."""
    closest = FIBONACCI_STORY_POINTS[0]
    best = abs(value - closest)
    for point in FIBONACCI_STORY_POINTS[1:]:
        delta = abs(value - point)
        if delta < best:
            closest = point
            best = delta
    return closest


def _epic_for(prompt: str) -> str:
    tokens = _token_set(prompt)
    for epic, hints in _EPIC_HINTS:
        if tokens & set(hints):
            return epic
    return "General"


def _type_for(prompt: str) -> str:
    tokens = _token_set(prompt)
    if tokens & set(_BUG_HINTS):
        return "bug"
    if tokens & {"spike", "investigate", "research"}:
        return "spike"
    return "feature"


def _safe_id(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _default_column(context: dict[str, Any]) -> Optional[str]:
    columns = context.get("columns") or []
    if not isinstance(columns, list):
        return None
    for col in columns:
        if isinstance(col, dict) and (col.get("name") or "").strip().lower() in {
            "to do",
            "todo",
            "backlog",
        }:
            return _safe_id(col.get("_id"))
    if columns and isinstance(columns[0], dict):
        return _safe_id(columns[0].get("_id"))
    return None


def _least_loaded_member(context: dict[str, Any]) -> Optional[str]:
    members = context.get("members") or []
    tasks = context.get("tasks") or []
    if not isinstance(members, list) or not members:
        return None
    counts: Counter[str] = Counter()
    for task in tasks if isinstance(tasks, list) else []:
        if isinstance(task, dict):
            coordinator = task.get("coordinatorId")
            if isinstance(coordinator, str):
                counts[coordinator] += 1
    sorted_members = sorted(
        (m for m in members if isinstance(m, dict) and isinstance(m.get("_id"), str)),
        key=lambda m: counts.get(m["_id"], 0),
    )
    if sorted_members:
        return sorted_members[0]["_id"]
    return None


def draft_task(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IDraftTaskSuggestion`` for the FE's task-draft route.

    This is the v1-compatible deterministic baseline used both by the
    agent's ``generate_draft`` node and by the coverage tests that exercise
    edge-case branches.
    """
    context = payload.get("context") or {}
    prompt = (payload.get("prompt") or "").strip()
    epic = _epic_for(prompt)
    type_ = _type_for(prompt)
    points = _clamp_fibonacci(max(1, len(prompt) // 60))
    column_id = _safe_id(payload.get("columnId")) or _default_column(context) or ""
    coordinator_id = (
        _safe_id(payload.get("coordinatorId")) or _least_loaded_member(context) or ""
    )
    return {
        "taskName": prompt[:80] or "New task",
        "type": type_,
        "epic": epic,
        "storyPoints": points,
        "note": prompt or "Acceptance criteria pending.",
        "columnId": column_id,
        "coordinatorId": coordinator_id,
        "confidence": 0.55,
        "rationale": "Heuristic draft from prompt keywords.",
    }


def breakdown_task(payload: dict[str, Any], count: int = 3) -> dict[str, Any]:
    """Return an ``ITaskBreakdownSuggestion`` (3 sub-drafts by default)."""
    base = draft_task(payload)
    pieces = []
    for index in range(1, max(1, min(count, 5)) + 1):
        pieces.append(
            {
                **base,
                "taskName": f"{base['taskName']} (part {index})",
                "rationale": f"Slice {index} of the parent task.",
            }
        )
    return {"items": pieces}


class DraftPolish(BaseModel):
    """Eligible text fields for LLM rewriting in a task draft.

    Only the three string fields the PRD allows the model to touch.
    ``columnId``/``coordinatorId``/``storyPoints``/``type``/``epic`` stay
    on the deterministic path -- the FE validator rejects unknown ids and
    clamps points to Fibonacci, so an LLM rewrite there is wasted tokens.
    """

    taskName: str = Field(default="", max_length=TASKNAME_MAX)
    note: str = Field(default="", max_length=NOTE_MAX)
    rationale: str = Field(default="", max_length=DRAFT_RATIONALE_MAX)


def _draft_from_prompt(prompt: str) -> dict[str, Any]:
    return {
        "taskName": prompt[:60],
        "type": "feature",
        "epic": "general",
        "storyPoints": 3,
        "note": prompt,
        "columnId": None,
        "coordinatorId": None,
        "confidence": "moderate",
        "rationale": "Deterministic Phase A draft derived from prompt + similar tasks.",
    }


def _build_draft_prompt(state: dict[str, Any]) -> str:
    deterministic = state["_deterministic"]
    prompt = state["_prompt"]
    similar = state["_similar"]
    safe_prompt = redact(prompt)[0]
    safe_similar = redact_dict(similar[:3])
    safe_draft = redact_task_fields(deterministic)
    return (
        "You are drafting a Jira task card. Update only the eligible text "
        "fields and return them in the structured schema. Keep taskName "
        "<=80 chars, note <=500 chars (plain text), rationale <=180 "
        "chars. Do not invent ids; do not change story points.\n\n"
        f"Prompt: {safe_prompt}\n"
        f"Similar tasks: {json.dumps(safe_similar)}\n"
        f"Current draft: {json.dumps(safe_draft)}"
    )


def _merge_draft(state: dict[str, Any], parsed: Any) -> dict[str, Any]:
    deterministic = state["_deterministic"]
    if isinstance(parsed, DraftPolish):
        polished = dict(deterministic)
        for field_name in ("taskName", "note", "rationale"):
            value = getattr(parsed, field_name, "")
            if isinstance(value, str) and value.strip():
                polished[field_name] = value.strip()
        return {"_result": polished}
    return {"_result": parsed}  # fallback value (dict)


_draft_step: PolishStep[DraftPolish] = PolishStep(
    prompt_fn=_build_draft_prompt,
    schema=DraftPolish,
    fallback_fn=lambda state: state["_deterministic"],
    merge_fn=_merge_draft,
)


async def _polish_draft(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    prompt: str,
    similar: list[dict[str, Any]],
) -> tuple[dict[str, Any], Any, int, int]:
    """Ask the model to refine the draft text fields; deterministic on stub.

    Only ``taskName``, ``note``, and ``rationale`` are eligible for LLM
    rewriting -- ``columnId`` / ``coordinatorId`` / ``storyPoints`` stay
    on the deterministic path because the FE validator rejects unknown
    ids and the FE clamps points to the Fibonacci set anyway. The model
    is asked for a typed :class:`DraftPolish` payload via
    ``with_structured_output`` so a malformed response cleanly degrades
    to the deterministic baseline.

    Returns ``(result, raw_message, tokens_in, tokens_out)``.  ``raw_message``
    is the underlying ``AIMessage`` with ``usage_metadata`` populated; callers
    should include it in the node's ``messages`` return value so budget
    tracking can find the token counts.  It is ``None`` on the stub path or
    when the call fails.
    """
    _state = {"_deterministic": deterministic, "_prompt": prompt, "_similar": similar}
    update, tokens_in, tokens_out = await _draft_step.run(_state, model)
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


async def polish_draft(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    prompt: str,
    similar: list[dict[str, Any]],
) -> tuple[dict[str, Any], int, int]:
    """Backward-compatible 3-tuple wrapper around :func:`_polish_draft`.

    External callers (v1 shim, tests) rely on the 3-tuple
    ``(result, tokens_in, tokens_out)`` signature.  Internal node code
    calls :func:`_polish_draft` directly to also capture the raw
    ``AIMessage`` for budget tracking.
    """
    result, _raw_msg, tokens_in, tokens_out = await _polish_draft(
        model, deterministic, prompt, similar
    )
    return result, tokens_in, tokens_out


class TaskDraftingAgent(BaseAgent):
    """Draft one or more task cards grounded in board context."""

    metadata = AgentMetadata(
        name="task-drafting-agent",
        description="Draft task cards (single or breakdown) grounded in board context.",
        version="1.0.0",
        tags=("board-copilot", "drafting"),
        recursion_limit=12,
        status="active",
        rate_limit=(10, 100),
        allowed_autonomy=("suggest", "plan"),
        tools=("fe.boardSnapshot", "fe.similarTasks"),
        redactable_text_fields=("prompt",),
        redactable_dict_fields=("context", "task_draft"),
        rationale={
            "recursion_limit": (
                "fetch_snapshot → fetch_similar → polish covers ~4 supersteps; "
                "12 leaves headroom for breakdown variants."
            ),
            "rate_limit": (
                "Drafts are slow user actions; 10/min matches the typical "
                "board edit rhythm."
            ),
            "allowed_autonomy": (
                "Plan mode supports drafts that auto-apply once accepted; "
                "auto is reserved for read-only loops."
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

        # Shared node bodies from _shared.py (same logic as board_brief / triage).
        fetch_snapshot = fetch_snapshot_node
        fetch_similar = fetch_similar_node

        async def generate_draft(state: TaskDraftingState) -> dict[str, Any]:
            # Prefer the per-call context model; fall back to the default.
            _rt = get_runtime(ChatContext)
            chat_model: BaseChatModel = (
                (_rt.context or {}).get("chat_model") or _default_model
            )
            prompt = state.get("prompt") or ""
            similar = state.get("similar_tasks") or []
            pre_draft = state.get("draft")
            # ------------------------------------------------------------------
            # v1-shim path A: breakdown payload forwarded via ``board_snapshot``
            # and ``breakdown_count`` (route passes raw context; this node
            # computes the deterministic baseline itself).
            # ``_use_v1_baseline`` + ``breakdown_count`` identify this path.
            # ------------------------------------------------------------------
            if pre_draft is None and state.get("_use_v1_baseline") and state.get("breakdown_count") is not None:
                snapshot = state.get("board_snapshot") or {}
                count = state.get("breakdown_count") or 3
                v1_payload: dict[str, Any] = {
                    "prompt": prompt,
                    "context": snapshot,
                }
                if state.get("column_id") is not None:
                    v1_payload["columnId"] = state["column_id"]
                if state.get("coordinator_id") is not None:
                    v1_payload["coordinatorId"] = state["coordinator_id"]
                base_draft_raw = draft_task(v1_payload)
                deterministic_bd = breakdown_task(v1_payload, count=count)
                pre_draft = {
                    **deterministic_bd,
                    "_breakdown_base": base_draft_raw,
                    "_prompt": prompt,
                    "_similar": similar,
                }
            # ------------------------------------------------------------------
            # v1-shim path B: raw context forwarded; compute single-card baseline.
            # ``_use_v1_baseline`` is set by the v1 route to distinguish from
            # native v2.1 callers that also have ``board_snapshot`` from interrupt.
            # ------------------------------------------------------------------
            if pre_draft is None and state.get("_use_v1_baseline"):
                snapshot = state.get("board_snapshot") or {}
                v1_payload_single: dict[str, Any] = {
                    "prompt": prompt,
                    "context": snapshot,
                }
                if state.get("column_id") is not None:
                    v1_payload_single["columnId"] = state["column_id"]
                if state.get("coordinator_id") is not None:
                    v1_payload_single["coordinatorId"] = state["coordinator_id"]
                pre_draft = draft_task(v1_payload_single)
            # Short-circuit path: ``draft`` carries a pre-computed baseline
            # (either forwarded from the route above or pre-populated by an
            # older caller).  A breakdown result is identified by the presence
            # of an ``"items"`` key; it is emitted on the ``"breakdown"``
            # surface and is never polished (polish_draft operates on single-
            # card fields, not on a list wrapper).
            if isinstance(pre_draft, dict) and "items" in pre_draft:
                # Breakdown baseline available.  In stub mode emit directly.
                # In real-model mode: polish the base draft once, then rebuild
                # each item's taskName by re-applying the per-item
                # ``(part N)`` suffix on top of the polished prefix.
                base_draft_meta = pre_draft.get("_breakdown_base")
                bd_prompt = pre_draft.get("_prompt") or prompt
                bd_similar = pre_draft.get("_similar") or similar
                # Strip internal metadata keys before emitting to the FE.
                items_raw = list(pre_draft.get("items") or [])
                clean_payload: dict[str, Any] = {"items": items_raw}
                if not isinstance(base_draft_meta, dict) or is_stub_model(chat_model):
                    # Stub path or no base metadata: emit deterministic result.
                    return {
                        "draft": clean_payload,
                        "messages": [AIMessage(content=json.dumps(clean_payload))],
                        "events": [{"kind": "suggestion", "surface": "breakdown", "payload": clean_payload}],
                    }
                # Real-model path: polish base draft, reconstruct per-item names.
                polished_base, raw_msg_bd, _tokens_in, _tokens_out = await _polish_draft(
                    chat_model, dict(base_draft_meta), bd_prompt, bd_similar
                )
                polished_taskName = polished_base.get("taskName") or ""
                polished_note = polished_base.get("note") or ""
                polished_rationale = polished_base.get("rationale")
                base_taskName = base_draft_meta.get("taskName") or ""
                polished_items: list[dict[str, Any]] = []
                for item in items_raw:
                    merged = dict(item)
                    item_taskName = item.get("taskName") or ""
                    # Recover the per-item suffix (e.g. " (part 1)") and graft
                    # it onto the polished base task name.
                    suffix = item_taskName[len(base_taskName):]
                    merged["taskName"] = polished_taskName + suffix
                    merged["note"] = polished_note
                    if isinstance(polished_rationale, str) and polished_rationale.strip():
                        merged["rationale"] = polished_rationale
                    polished_items.append(merged)
                result_payload: dict[str, Any] = {"items": polished_items}
                extra_msgs_bd = [raw_msg_bd] if raw_msg_bd is not None else []
                return {
                    "draft": result_payload,
                    "messages": extra_msgs_bd + [AIMessage(content=json.dumps(result_payload))],
                    "events": [{"kind": "suggestion", "surface": "breakdown", "payload": result_payload}],
                }
            if isinstance(pre_draft, dict):
                # Single-draft baseline: polish the text fields
                # and emit on the ``"draft"`` surface.
                polished, raw_msg_sd, _tokens_in, _tokens_out = await _polish_draft(
                    chat_model, pre_draft, prompt, similar
                )
                extra_msgs_sd = [raw_msg_sd] if raw_msg_sd is not None else []
                return {
                    "draft": polished,
                    "messages": extra_msgs_sd + [AIMessage(content=json.dumps(polished))],
                    "events": [{"kind": "suggestion", "surface": "draft", "payload": polished}],
                }
            base = _draft_from_prompt(prompt)
            polished, raw_msg_base, _tokens_in, _tokens_out = await _polish_draft(
                chat_model, base, prompt, similar
            )
            axis = state.get("breakdown_axis")
            if axis:
                pieces = [
                    {**polished, "taskName": f"{polished['taskName']} ({axis} {i})"}
                    for i in range(1, 4)
                ]
                # Breakdown still rides the ``"draft"`` surface; the FE
                # discriminates by ``payload.axis`` (see
                # ``src/components/aiTaskDraftModal/index.tsx``).
                draft: dict[str, Any] = {"axis": axis, "items": pieces}
            else:
                draft = polished
            extra_msgs_base = [raw_msg_base] if raw_msg_base is not None else []
            return {
                "draft": draft,
                "messages": extra_msgs_base + [AIMessage(content=json.dumps(draft))],
                "events": [{"kind": "suggestion", "surface": "draft", "payload": draft}],
            }

        graph: StateGraph = StateGraph(TaskDraftingState, context_schema=ChatContext)
        graph.add_node("fetch_snapshot", fetch_snapshot)
        graph.add_node("fetch_similar", fetch_similar)
        graph.add_node("generate_draft", generate_draft)
        graph.add_edge(START, "fetch_snapshot")
        graph.add_edge("fetch_snapshot", "fetch_similar")
        graph.add_edge("fetch_similar", "generate_draft")
        graph.add_edge("generate_draft", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(TaskDraftingAgent(), replace=True)
