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
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
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
    emit_usage,
    fetch_similar_node,
    fetch_snapshot_node,
    structured_llm_call,
)
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.registry import registry
from app.agents.state import TaskDraftingState
from app.agents.stream import emit_custom
from app.tools.redaction import redact, redact_dict, redact_task_fields

logger = logging.getLogger(__name__)


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


async def _polish_draft(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    prompt: str,
    similar: list[dict[str, Any]],
) -> tuple[dict[str, Any], int, int]:
    """Ask the model to refine the draft text fields; deterministic on stub.

    Only ``taskName``, ``note``, and ``rationale`` are eligible for LLM
    rewriting -- ``columnId`` / ``coordinatorId`` / ``storyPoints`` stay
    on the deterministic path because the FE validator rejects unknown
    ids and the FE clamps points to the Fibonacci set anyway. The model
    is asked for a typed :class:`DraftPolish` payload via
    ``with_structured_output`` so a malformed response cleanly degrades
    to the deterministic baseline.
    """

    # Redact PII from every field that crosses the provider boundary.
    # ``deterministic`` is the freshly-built draft we own; ``prompt`` and
    # ``similar`` come from the FE and may contain emails / secrets / SSNs.
    safe_prompt = redact(prompt)[0]
    safe_similar = redact_dict(similar[:3])
    safe_draft = redact_task_fields(deterministic)
    instruction = (
        "You are drafting a Jira task card. Update only the eligible text "
        "fields and return them in the structured schema. Keep taskName "
        "<=80 chars, note <=500 chars (plain text), rationale <=180 "
        "chars. Do not invent ids; do not change story points.\n\n"
        f"Prompt: {safe_prompt}\n"
        f"Similar tasks: {json.dumps(safe_similar)}\n"
        f"Current draft: {json.dumps(safe_draft)}"
    )

    def _merge(parsed: DraftPolish) -> dict[str, Any]:
        polished = dict(deterministic)
        for field_name in ("taskName", "note", "rationale"):
            value = getattr(parsed, field_name, "")
            if isinstance(value, str) and value.strip():
                polished[field_name] = value.strip()
        return polished

    return await structured_llm_call(
        model,
        DraftPolish,
        [HumanMessage(content=instruction)],
        fallback=deterministic,
        merge_fn=_merge,
    )


# Backward-compatible public alias kept for tests that import ``polish_draft``
# directly.  Internal callers use the private ``_polish_draft`` name.
polish_draft = _polish_draft


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
        chat_model: BaseChatModel = self.chat_model

        # Shared node bodies from _shared.py (same logic as board_brief / triage).
        fetch_snapshot = fetch_snapshot_node
        fetch_similar = fetch_similar_node

        async def generate_draft(state: TaskDraftingState) -> dict[str, Any]:
            prompt = state.get("prompt") or ""
            similar = state.get("similar_tasks") or []
            pre_draft = state.get("draft")
            # Short-circuit path: the v1 shim pre-populates ``draft`` with the
            # v1_engine deterministic result so the agent skips recomputation and
            # applies only the polish step on top.  A breakdown result is
            # identified by the presence of an ``"items"`` key; it is emitted on
            # the ``"breakdown"`` surface and is never polished (polish_draft
            # operates on single-card fields, not on a list wrapper).
            if isinstance(pre_draft, dict) and "items" in pre_draft:
                # Breakdown pre-populated by v1 shim.  In stub mode emit directly.
                # In real-model mode: polish the base draft once, then rebuild each
                # item's taskName by re-applying the per-item ``(part N)`` suffix on
                # top of the polished prefix.  This mirrors the original shim logic
                # (routers/ai.py before migration) and keeps cost flat: one polish
                # call regardless of item count.
                base_draft_meta = pre_draft.get("_breakdown_base")
                bd_prompt = pre_draft.get("_prompt") or prompt
                bd_similar = pre_draft.get("_similar") or similar
                # Strip internal metadata keys before emitting to the FE.
                items_raw = list(pre_draft.get("items") or [])
                clean_payload: dict[str, Any] = {"items": items_raw}
                if not isinstance(base_draft_meta, dict) or is_stub_model(chat_model):
                    # Stub path or no base metadata: emit deterministic result.
                    emit_custom(
                        {"kind": "suggestion", "surface": "breakdown", "payload": clean_payload}
                    )
                    return {
                        "draft": clean_payload,
                        "messages": [AIMessage(content=json.dumps(clean_payload))],
                    }
                # Real-model path: polish base draft, reconstruct per-item names.
                polished_base, tokens_in, tokens_out = await _polish_draft(
                    chat_model, dict(base_draft_meta), bd_prompt, bd_similar
                )
                emit_usage(tokens_in, tokens_out)
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
                emit_custom(
                    {"kind": "suggestion", "surface": "breakdown", "payload": result_payload}
                )
                return {
                    "draft": result_payload,
                    "messages": [AIMessage(content=json.dumps(result_payload))],
                }
            if isinstance(pre_draft, dict):
                # Single-draft pre-populated by v1 shim: polish the text fields
                # and emit on the ``"draft"`` surface.
                polished, tokens_in, tokens_out = await _polish_draft(
                    chat_model, pre_draft, prompt, similar
                )
                emit_usage(tokens_in, tokens_out)
                emit_custom(
                    {"kind": "suggestion", "surface": "draft", "payload": polished}
                )
                return {
                    "draft": polished,
                    "messages": [AIMessage(content=json.dumps(polished))],
                }
            base = _draft_from_prompt(prompt)
            polished, tokens_in, tokens_out = await _polish_draft(
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
            surface = "draft"
            emit_usage(tokens_in, tokens_out)
            emit_custom(
                {"kind": "suggestion", "surface": surface, "payload": draft}
            )
            return {
                "draft": draft,
                "messages": [AIMessage(content=json.dumps(draft))],
            }

        graph: StateGraph = StateGraph(TaskDraftingState)
        graph.add_node("fetch_snapshot", fetch_snapshot)
        graph.add_node("fetch_similar", fetch_similar)
        graph.add_node("generate_draft", generate_draft)
        graph.add_edge(START, "fetch_snapshot")
        graph.add_edge("fetch_snapshot", "fetch_similar")
        graph.add_edge("fetch_similar", "generate_draft")
        graph.add_edge("generate_draft", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(TaskDraftingAgent(), replace=True)
