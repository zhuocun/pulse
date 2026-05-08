"""``task-estimation-agent`` -- estimate effort and surface a readiness report.

Implements PRD v2.1 §5A.5. The graph fetches similar tasks (FE) and
embedding neighbours (BE), produces a deterministic story-point estimate,
and emits an :class:`IReadinessReport` describing missing inputs. With a
real chat model configured, the rationale is polished via
``model.with_structured_output(EstimationRationale, include_raw=True)`` so
a malformed provider response cleanly degrades to the deterministic
fallback without breaking the FE contract.
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
from app.agents.catalog._shared import unpack_structured_response
from app.agents.llm import extract_token_usage, is_stub_model
from app.agents.registry import registry
from app.agents.state import TaskEstimationState
from app.agents.stream import emit_custom
from app.domain.story_points import FIBONACCI_STORY_POINTS
from app.tools import be_tools
from app.tools.fe_tool_schemas import interrupt_payload
from app.tools.redaction import redact, redact_dict, redact_task_fields

logger = logging.getLogger(__name__)


class EstimationRationale(BaseModel):
    """Typed rationale slot the LLM fills via ``with_structured_output``."""

    rationale: str = Field(
        default="",
        max_length=180,
        description=(
            "Single-line, <=180-character rationale for the story-point "
            "estimate. Factual tone; do not propose a different point value."
        ),
    )


class ReadinessIssuePolish(BaseModel):
    """One polished readiness issue. ``field`` keys back to the deterministic row."""

    field: str = Field(default="", max_length=40)
    message: str = Field(default="", max_length=160)
    suggestion: str = Field(default="", max_length=160)


class ReadinessPolish(BaseModel):
    """Typed payload the LLM fills via ``with_structured_output``.

    Only the per-issue ``message`` / ``suggestion`` strings are eligible
    for LLM rewriting. ``field`` is keyed back into the deterministic
    issue list and ``severity`` is left untouched -- the FE validator
    only accepts the known field ids and the three-value severity enum,
    so an LLM rewrite there is wasted tokens at best and a 4xx at worst.
    """

    issues: list[ReadinessIssuePolish] = Field(default_factory=list)


async def polish_readiness(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    draft: dict[str, Any],
) -> tuple[dict[str, Any], int, int]:
    """Polish readiness issue messages/suggestions; deterministic on stub.

    Polished rows are merged back onto the deterministic ``issues`` by
    ``field`` id, so the FE validator never sees a new field id and a
    blank polished string preserves the deterministic copy.
    """

    if is_stub_model(model):
        return deterministic, 0, 0
    issues = deterministic.get("issues") or []
    if not issues:
        return deterministic, 0, 0
    safe_draft = redact_task_fields(draft)
    safe_issues = redact_dict(issues)
    prompt = (
        "Rewrite the message and suggestion strings for each readiness "
        "issue below so they are specific and actionable for this Jira-"
        "style task draft. Keep each string <=160 chars and on a single "
        "line. Preserve the field id verbatim; do not invent new fields. "
        "Return JSON matching the schema.\n\n"
        f"Draft: {json.dumps(safe_draft)}\n"
        f"Issues: {json.dumps(safe_issues)}"
    )
    try:
        structured = model.with_structured_output(
            ReadinessPolish, include_raw=True
        )
        response = await structured.ainvoke([HumanMessage(content=prompt)])
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("readiness structured output failed; falling back.")
        return deterministic, 0, 0
    raw, parsed, error = unpack_structured_response(response)
    tokens_in, tokens_out = extract_token_usage(raw)
    if error is not None or not isinstance(parsed, ReadinessPolish):
        return deterministic, tokens_in, tokens_out

    polished_by_field: dict[str, ReadinessIssuePolish] = {
        item.field: item for item in parsed.issues if item.field
    }
    merged_issues: list[dict[str, Any]] = []
    for issue in issues:
        merged = dict(issue)
        update = polished_by_field.get(issue.get("field"))
        if update is not None:
            for key in ("message", "suggestion"):
                polished = (getattr(update, key).splitlines() or [""])[0].strip()
                # Blank polish keeps the deterministic copy: a model
                # that returns ``""`` cannot wipe out a useful suggestion.
                if polished:
                    merged[key] = polished[:160]
        merged_issues.append(merged)
    return {**deterministic, "issues": merged_issues}, tokens_in, tokens_out


async def polish_rationale(
    model: BaseChatModel,
    deterministic: str,
    draft: dict[str, Any],
    points: int,
    neighbours: list[dict[str, Any]],
) -> tuple[str, int, int]:
    """LLM-polish the estimation rationale; deterministic fallback on stub."""

    if is_stub_model(model):
        return deterministic, 0, 0
    safe_draft = redact_task_fields(draft)
    safe_neighbours = redact_dict(neighbours[:3])
    prompt = (
        "Write a single-line, <=180-character rationale for this story-point "
        "estimate. Keep tone factual; reference the provided neighbours "
        "if helpful. Do not propose a different point value. Return the "
        "structured schema.\n\n"
        f"Draft: {json.dumps(safe_draft)}\nPoints: {points}\n"
        f"Neighbours: {json.dumps(safe_neighbours)}"
    )
    try:
        structured = model.with_structured_output(
            EstimationRationale, include_raw=True
        )
        response = await structured.ainvoke([HumanMessage(content=prompt)])
    except Exception:  # noqa: BLE001 -- defensive boundary around provider call
        logger.exception("task-estimation structured output failed; falling back.")
        return deterministic, 0, 0
    raw, parsed, error = unpack_structured_response(response)
    tokens_in, tokens_out = extract_token_usage(raw)
    if error is not None or not isinstance(parsed, EstimationRationale):
        return deterministic, tokens_in, tokens_out
    text = (parsed.rationale or "").strip()
    if not text:
        return deterministic, tokens_in, tokens_out
    cleaned = text.splitlines()[0]
    return cleaned[:180], tokens_in, tokens_out


def _estimate_for(task_draft: dict[str, Any], neighbours: list[dict[str, Any]]) -> int:
    """Map the description length + neighbour count onto a Fibonacci point."""

    description = (task_draft.get("note") or "") + (task_draft.get("taskName") or "")
    length_bucket = min(len(description) // 40, len(FIBONACCI_STORY_POINTS) - 1)
    neighbour_bonus = 1 if neighbours else 0
    idx = min(length_bucket + neighbour_bonus, len(FIBONACCI_STORY_POINTS) - 1)
    return FIBONACCI_STORY_POINTS[idx]


def _readiness(task_draft: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    if not task_draft.get("taskName"):
        issues.append(
            {
                "field": "taskName",
                "severity": "error",
                "message": "Task name is required.",
                "suggestion": "Provide a short, descriptive title for the task.",
            }
        )
    if not task_draft.get("note"):
        issues.append(
            {
                "field": "note",
                "severity": "warning",
                "message": "Acceptance criteria are missing.",
                "suggestion": "Describe what done looks like so the team can verify completion.",
            }
        )
    if task_draft.get("coordinatorId") is None:
        issues.append(
            {
                "field": "coordinatorId",
                "severity": "error",
                "message": "A coordinator must be assigned.",
                "suggestion": "Pick a team member to own this task.",
            }
        )
    missing_fields = [issue["field"] for issue in issues]
    return {
        "ready": not issues,
        "issues": issues,
        "rationale": "Required draft fields are present."
        if not issues
        else f"Missing required fields: {', '.join(missing_fields)}",
    }


class TaskEstimationAgent(BaseAgent):
    """Estimate effort + readiness for a task draft."""

    metadata = AgentMetadata(
        name="task-estimation-agent",
        description="Estimate story points and surface a readiness report for a task draft.",
        version="1.0.0",
        tags=("board-copilot", "estimation"),
        recursion_limit=8,
        status="active",
        rate_limit=(20, 200),
        allowed_autonomy=("suggest", "plan"),
        tools=("fe.similarTasks", "be.embed", "be.embedding_neighbors"),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        def fetch_similar(state: TaskEstimationState) -> dict[str, Any]:
            draft = state.get("task_draft") or {}
            payload = interrupt(
                interrupt_payload(
                    "fe.similarTasks",
                    {
                        "project_id": state.get("project_id"),
                        "query": draft.get("taskName") or "",
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

        async def fetch_embeddings(state: TaskEstimationState) -> dict[str, Any]:
            similar = state.get("similar_tasks") or []
            draft = state.get("task_draft") or {}
            corpus_texts = [item.get("text", "") for item in similar]
            corpus_ids = [item.get("id", str(idx)) for idx, item in enumerate(similar)]
            query_text = draft.get("taskName", "")
            # Embed query and corpus in a single batched call so a load-
            # balanced provider can't drift between two HTTP round-trips
            # and produce vectors in slightly different embedding spaces
            # (which would silently corrupt cosine scores).
            vectors = await be_tools.embed_async([query_text] + corpus_texts)
            query_vec = vectors[0]
            corpus_vectors = vectors[1:]
            corpus = list(zip(corpus_ids, corpus_vectors))
            neighbours = (
                be_tools.embedding_neighbors(query_vec, corpus, k=3) if corpus else []
            )
            return {
                "embedding_neighbors": [
                    {"id": item_id, "score": score} for item_id, score in neighbours
                ]
            }

        async def estimate(state: TaskEstimationState) -> dict[str, Any]:
            draft = state.get("task_draft") or {}
            neighbours = state.get("embedding_neighbors") or []
            points = _estimate_for(draft, neighbours)
            deterministic = "Derived from prompt length + grounded neighbours."
            rationale, tokens_in, tokens_out = await polish_rationale(
                chat_model, deterministic, draft, points, neighbours
            )
            emit_custom(
                {"kind": "usage", "tokensIn": tokens_in, "tokensOut": tokens_out}
            )
            return {
                "estimate": {
                    "storyPoints": points,
                    "confidence": "moderate" if neighbours else "low",
                    "rationale": rationale,
                }
            }

        def readiness(state: TaskEstimationState) -> dict[str, Any]:
            draft = state.get("task_draft") or {}
            return {"readiness": _readiness(draft)}

        def emit_citations(state: TaskEstimationState) -> dict[str, Any]:
            payload = {
                "estimate": state.get("estimate"),
                "readiness": state.get("readiness"),
            }
            similar = state.get("similar_tasks") or []
            refs: list[dict[str, Any]] = []
            for item in similar[:3]:
                quote = item.get("text") or item.get("id") or ""
                refs.append(
                    be_tools.validated_citation_ref(
                        source="task",
                        id=item.get("id"),
                        quote=redact(quote)[0] if isinstance(quote, str) else quote,
                    )
                )
            if refs:
                emit_custom({"kind": "citation", "refs": refs})
            emit_custom(
                {
                    "kind": "suggestion",
                    "surface": "estimate",
                    "payload": payload,
                }
            )
            return {"messages": [AIMessage(content=json.dumps(payload))]}

        graph: StateGraph = StateGraph(TaskEstimationState)
        graph.add_node("fetch_similar", fetch_similar)
        graph.add_node("fetch_embeddings", fetch_embeddings)
        graph.add_node("estimate", estimate)
        graph.add_node("readiness", readiness)
        graph.add_node("emit_citations", emit_citations)
        graph.add_edge(START, "fetch_similar")
        graph.add_edge("fetch_similar", "fetch_embeddings")
        graph.add_edge("fetch_embeddings", "estimate")
        graph.add_edge("estimate", "readiness")
        graph.add_edge("readiness", "emit_citations")
        graph.add_edge("emit_citations", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(TaskEstimationAgent(), replace=True)
