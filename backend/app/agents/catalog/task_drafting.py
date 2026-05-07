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
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.llm import extract_token_usage, is_stub_model
from app.agents.registry import registry
from app.agents.state import TaskDraftingState
from app.agents.stream import emit_custom
from app.tools.fe_tool_schemas import interrupt_payload

logger = logging.getLogger(__name__)


class DraftPolish(BaseModel):
    """Eligible text fields for LLM rewriting in a task draft.

    Only the three string fields the PRD allows the model to touch.
    ``columnId``/``coordinatorId``/``storyPoints``/``type``/``epic`` stay
    on the deterministic path -- the FE validator rejects unknown ids and
    clamps points to Fibonacci, so an LLM rewrite there is wasted tokens.
    """

    taskName: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=500)
    rationale: str = Field(default="", max_length=180)


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


async def polish_draft(
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

    if is_stub_model(model):
        return deterministic, 0, 0
    instruction = (
        "You are drafting a Jira task card. Update only the eligible text "
        "fields and return them in the structured schema. Keep taskName "
        "<=80 chars, note <=500 chars (plain text), rationale <=180 "
        "chars. Do not invent ids; do not change story points.\n\n"
        f"Prompt: {prompt}\n"
        f"Similar tasks: {json.dumps(similar[:3])}\n"
        f"Current draft: {json.dumps(deterministic)}"
    )
    try:
        structured = model.with_structured_output(DraftPolish, include_raw=True)
        response = await structured.ainvoke([HumanMessage(content=instruction)])
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("task-drafting structured output failed; falling back.")
        return deterministic, 0, 0
    raw = response.get("raw") if isinstance(response, dict) else None
    parsed = response.get("parsed") if isinstance(response, dict) else None
    error = response.get("parsing_error") if isinstance(response, dict) else None
    tokens_in, tokens_out = extract_token_usage(raw)
    if error is not None or not isinstance(parsed, DraftPolish):
        return deterministic, tokens_in, tokens_out
    polished = dict(deterministic)
    for field_name in ("taskName", "note", "rationale"):
        value = getattr(parsed, field_name, "")
        if isinstance(value, str) and value.strip():
            polished[field_name] = value.strip()
    return polished, tokens_in, tokens_out


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
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        def fetch_snapshot(state: TaskDraftingState) -> dict[str, Any]:
            snapshot = interrupt(
                interrupt_payload(
                    "fe.boardSnapshot",
                    {"project_id": state.get("project_id")},
                )
            )
            return {"board_snapshot": snapshot}

        def fetch_similar(state: TaskDraftingState) -> dict[str, Any]:
            payload = interrupt(
                interrupt_payload(
                    "fe.similarTasks",
                    {
                        "project_id": state.get("project_id"),
                        "query": state.get("prompt") or "",
                    },
                )
            )
            # FE may return either a raw list (legacy / test fixtures) or
            # the schema-conformant {"similar": [...]} envelope. Normalise
            # so downstream nodes always see a list of ``{id, text}`` items.
            if isinstance(payload, dict) and "similar" in payload:
                similar = payload["similar"]
            else:
                similar = payload
            return {"similar_tasks": similar or []}

        async def generate_draft(state: TaskDraftingState) -> dict[str, Any]:
            prompt = state.get("prompt") or ""
            similar = state.get("similar_tasks") or []
            base = _draft_from_prompt(prompt)
            polished, tokens_in, tokens_out = await polish_draft(
                chat_model, base, prompt, similar
            )
            axis = state.get("breakdown_axis")
            if axis:
                pieces = [
                    {**polished, "taskName": f"{polished['taskName']} ({axis} {i})"}
                    for i in range(1, 4)
                ]
                draft: dict[str, Any] = {"axis": axis, "items": pieces}
                surface = "draft"
            else:
                draft = polished
                surface = "draft"
            emit_custom(
                {"kind": "usage", "tokensIn": tokens_in, "tokensOut": tokens_out}
            )
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
