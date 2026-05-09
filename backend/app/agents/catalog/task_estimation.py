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
from pydantic import BaseModel, Field

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._schemas import (
    ESTIMATION_RATIONALE_MAX,
    READINESS_FIELD_MAX,
    READINESS_MESSAGE_MAX,
)
from app.agents.catalog._shared import (
    cap_polished_text,
    emit_citation_refs,
    emit_usage,
    fetch_similar_node,
    merge_keyed_string_updates,
    structured_llm_call,
)
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.registry import registry
from app.agents.state import TaskEstimationState
from app.agents.stream import emit_custom
from app.domain.story_points import FIBONACCI_STORY_POINTS
from app.tools import be_tools
from app.tools.redaction import redact_dict, redact_task_fields

logger = logging.getLogger(__name__)


class EstimationRationale(BaseModel):
    """Typed rationale slot the LLM fills via ``with_structured_output``."""

    rationale: str = Field(
        default="",
        max_length=ESTIMATION_RATIONALE_MAX,
        description=(
            "Single-line, <=180-character rationale for the story-point "
            "estimate. Factual tone; do not propose a different point value."
        ),
    )


class ReadinessIssuePolish(BaseModel):
    """One polished readiness issue. ``field`` keys back to the deterministic row."""

    field: str = Field(default="", max_length=READINESS_FIELD_MAX)
    message: str = Field(default="", max_length=READINESS_MESSAGE_MAX)
    suggestion: str = Field(default="", max_length=READINESS_MESSAGE_MAX)


class ReadinessPolish(BaseModel):
    """Typed payload the LLM fills via ``with_structured_output``.

    Only the per-issue ``message`` / ``suggestion`` strings are eligible
    for LLM rewriting. ``field`` is keyed back into the deterministic
    issue list and ``severity`` is left untouched -- the FE validator
    only accepts the known field ids and the three-value severity enum,
    so an LLM rewrite there is wasted tokens at best and a 4xx at worst.
    """

    issues: list[ReadinessIssuePolish] = Field(default_factory=list)


async def _polish_readiness(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    draft: dict[str, Any],
) -> tuple[dict[str, Any], int, int]:
    """Polish readiness issue messages/suggestions; deterministic on stub.

    Polished rows are merged back onto the deterministic ``issues`` by
    ``field`` id, so the FE validator never sees a new field id and a
    blank polished string preserves the deterministic copy.
    """

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

    def _merge(parsed: ReadinessPolish) -> dict[str, Any]:
        merged_issues = merge_keyed_string_updates(
            parsed.issues,
            issues,
            key_from_parsed=lambda item: item.field,
            key_from_deterministic=lambda issue, _idx: issue.get("field"),
            string_fields={
                "message": READINESS_MESSAGE_MAX,
                "suggestion": READINESS_MESSAGE_MAX,
            },
        )
        return {**deterministic, "issues": merged_issues}

    return await structured_llm_call(
        model,
        ReadinessPolish,
        [HumanMessage(content=prompt)],
        fallback=deterministic,
        merge_fn=_merge,
    )


async def _polish_rationale(
    model: BaseChatModel,
    deterministic: str,
    draft: dict[str, Any],
    points: int,
    neighbours: list[dict[str, Any]],
) -> tuple[str, int, int]:
    """LLM-polish the estimation rationale; deterministic fallback on stub."""

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

    def _merge(parsed: EstimationRationale) -> str:
        return cap_polished_text(
            parsed.rationale,
            max_chars=ESTIMATION_RATIONALE_MAX,
            fallback=deterministic,
        )

    return await structured_llm_call(
        model,
        EstimationRationale,
        [HumanMessage(content=prompt)],
        fallback=deterministic,
        merge_fn=_merge,
    )


# Backward-compatible public aliases kept for tests that import these helpers
# directly.  Internal callers use the private ``_polish_*`` names.
polish_readiness = _polish_readiness
polish_rationale = _polish_rationale


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
        redactable_dict_fields=("task_draft", "context"),
        rationale={
            "recursion_limit": (
                "Linear graph (fetch → embed → estimate → readiness → emit); "
                "8 covers all five nodes with retry headroom."
            ),
            "rate_limit": (
                "Cheap per call (one polish pass each for rationale + readiness); "
                "20/min mirrors chat tier."
            ),
            "allowed_autonomy": (
                "Plan mode supports auto-applied estimates after accept; "
                "auto disallowed since estimates feed budget gates."
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

        # Shared node body from _shared.py (same logic as task-drafting-agent).
        fetch_similar = fetch_similar_node

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
            pre_estimate = state.get("estimate")
            if isinstance(pre_estimate, dict):
                # v1 shim pre-populated ``estimate`` with the v1_engine deterministic
                # result.  Polish the rationale field and return the updated estimate;
                # all other fields (storyPoints, confidence, similar) come from
                # the v1_engine result unchanged so the wire shape stays byte-identical
                # on the stub path and gains only a polished rationale on the real path.
                #
                # The ``_skip_polish`` sentinel is set by the ``/readiness`` shim route
                # so that running the shared estimation graph from that route does NOT
                # charge the estimate's rationale polish against the project budget.
                # Only the readiness node's polish tokens are attributable to that route.
                if pre_estimate.get("_skip_polish"):
                    return {}
                draft = state.get("task_draft") or {}
                neighbours = state.get("embedding_neighbors") or []
                points = pre_estimate.get("storyPoints") or 0
                deterministic_rationale = pre_estimate.get("rationale") or ""
                rationale, tokens_in, tokens_out = await _polish_rationale(
                    chat_model, deterministic_rationale, draft, points, neighbours
                )
                emit_usage(tokens_in, tokens_out)
                return {"estimate": {**pre_estimate, "rationale": rationale}}
            draft = state.get("task_draft") or {}
            neighbours = state.get("embedding_neighbors") or []
            points = _estimate_for(draft, neighbours)
            deterministic = "Derived from prompt length + grounded neighbours."
            rationale, tokens_in, tokens_out = await _polish_rationale(
                chat_model, deterministic, draft, points, neighbours
            )
            emit_usage(tokens_in, tokens_out)
            return {
                "estimate": {
                    "storyPoints": points,
                    "confidence": "moderate" if neighbours else "low",
                    "rationale": rationale,
                }
            }

        async def readiness(state: TaskEstimationState) -> dict[str, Any]:
            pre_readiness = state.get("readiness")
            if isinstance(pre_readiness, dict):
                # v1 shim pre-populated ``readiness`` with the v1_engine deterministic
                # result.  Polish the issue messages/suggestions and return; the
                # v1_engine shape ``{issues: [...]}`` is preserved so the parity test
                # and the FE validator both pass byte-identically on the stub path.
                draft = state.get("task_draft") or {}
                polished, tokens_in, tokens_out = await _polish_readiness(
                    chat_model, pre_readiness, draft
                )
                emit_usage(tokens_in, tokens_out)
                return {"readiness": polished}
            draft = state.get("task_draft") or {}
            deterministic = _readiness(draft)
            polished, tokens_in, tokens_out = await _polish_readiness(
                chat_model, deterministic, draft
            )
            emit_usage(tokens_in, tokens_out)
            return {"readiness": polished}

        def emit_citations(state: TaskEstimationState) -> dict[str, Any]:
            est_payload = state.get("estimate")
            read_payload = state.get("readiness")
            # Combined v2.1 surface: ``{estimate, readiness}`` for the streaming
            # SSE consumer and for any caller that wants both in one event.
            payload = {
                "estimate": est_payload,
                "readiness": read_payload,
            }
            similar = state.get("similar_tasks") or []
            emit_citation_refs(similar, "task")
            emit_custom(
                {
                    "kind": "suggestion",
                    "surface": "estimate",
                    "payload": payload,
                }
            )
            # Additional v1-shim-compatible surfaces so ``/api/ai/estimate`` and
            # ``/api/ai/readiness`` can each extract exactly the payload they need
            # without projecting the combined event.
            if est_payload is not None:
                emit_custom(
                    {
                        "kind": "suggestion",
                        "surface": "estimate_v1",
                        "payload": est_payload,
                    }
                )
            if read_payload is not None:
                emit_custom(
                    {
                        "kind": "suggestion",
                        "surface": "readiness_v1",
                        "payload": read_payload,
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
