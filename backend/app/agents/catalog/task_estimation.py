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
from app.agents.catalog._schemas import (
    ESTIMATION_RATIONALE_MAX,
    READINESS_FIELD_MAX,
    READINESS_MESSAGE_MAX,
)
from app.agents.catalog._shared import (
    augment_items_with_vector_neighbours,
    build_citation_refs,
    fetch_similar_node,
    merge_keyed_string_updates,
)
from app.agents.context import ChatContext
from app.agents.llm import is_stub_model  # noqa: F401 -- re-exported for test patching
from app.agents.polish import PolishStep
from app.agents.state import TaskEstimationState
from langgraph.runtime import get_runtime
from app.domain.story_points import FIBONACCI_STORY_POINTS
from app.tools import be_tools
from app.tools.fe_tool_names import FE_SIMILAR_TASKS
from app.tools.redaction import redact_dict, redact_task_fields


# ---------------------------------------------------------------------------
# v1-compatible deterministic helpers (ported from v1_engine.py).
# These produce the exact same wire shapes as v1_engine.estimate /
# v1_engine.readiness so the route can skip pre-calling v1_engine and the
# parity tests continue to pass byte-identically.
# ---------------------------------------------------------------------------

import re as _re  # noqa: E402 — placed here to avoid polluting module top

_TOKEN_RE_EST = _re.compile(r"[A-Za-z0-9]+")


def _tokens_est(text: str) -> list[str]:
    return [m.group(0).lower() for m in _TOKEN_RE_EST.finditer(text or "")]


def _token_set_est(text: str) -> set[str]:
    return set(_tokens_est(text))


def _jaccard_est(a: set[str], b: set[str]) -> float:
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _clamp_fibonacci_est(value: int) -> int:
    """Snap ``value`` to the nearest Fibonacci point."""
    closest = FIBONACCI_STORY_POINTS[0]
    best = abs(value - closest)
    for point in FIBONACCI_STORY_POINTS[1:]:
        delta = abs(value - point)
        if delta < best:
            closest = point
            best = delta
    return closest


def estimate_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IEstimateSuggestion`` matching v1_engine.estimate wire shape.

    This is the deterministic baseline the ``estimate`` node uses when the
    route does not pre-populate ``state["estimate"]``.  The output is
    byte-identical to :func:`app.services.v1_engine.estimate`.
    """
    description = (payload.get("note") or "") + (payload.get("taskName") or "")
    context = payload.get("context") or {}
    tasks = context.get("tasks") or []
    query_tokens = _token_set_est(description)
    similars: list[tuple[str, float, str]] = []
    for task in tasks if isinstance(tasks, list) else []:
        if not isinstance(task, dict):
            continue
        task_id = task.get("_id")
        if not isinstance(task_id, str):
            continue
        score = _jaccard_est(
            query_tokens,
            _token_set_est((task.get("taskName") or "") + " " + (task.get("note") or "")),
        )
        if score:
            reason = f"shares {int(score * 100)}% keywords"
            similars.append((task_id, score, reason))
    similars.sort(key=lambda triple: triple[1], reverse=True)
    top = similars[:3]
    avg_neighbour_points = (
        sum(_clamp_fibonacci_est(point) for point in (3, 5, 3)) / 3 if top else 3
    )
    points = _clamp_fibonacci_est(
        int(round((len(description) / 80) + avg_neighbour_points))
    )
    confidence = 0.7 if top else 0.45
    return {
        "storyPoints": points,
        "confidence": confidence,
        "rationale": "Derived from prompt length + nearest-neighbour tasks."
        if top
        else "Derived from prompt length; no similar tasks found.",
        "similar": [{"_id": tid, "reason": reason} for tid, _, reason in top],
    }


def readiness_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return an ``IReadinessReport`` matching v1_engine.readiness wire shape.

    Byte-identical to :func:`app.services.v1_engine.readiness`.
    """
    issues: list[dict[str, Any]] = []
    fields = {
        "taskName": "Task name is required.",
        "note": "Acceptance criteria are missing.",
        "epic": "Epic helps grouping; pick one.",
        "type": "Choose feature / bug / spike.",
        "coordinatorId": "Assign a coordinator.",
    }
    for field, message in fields.items():
        if not payload.get(field):
            issue: dict[str, Any] = {
                "field": field,
                "severity": "error" if field == "taskName" else "warn",
                "message": message,
            }
            issues.append(issue)
    return {"issues": issues}


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


def _build_readiness_prompt(state: dict[str, Any]) -> str:
    draft = state["_draft"]
    issues = state["_issues"]
    safe_draft = redact_task_fields(draft)
    safe_issues = redact_dict(issues)
    return (
        "Rewrite the message and suggestion strings for each readiness "
        "issue below so they are specific and actionable for this Jira-"
        "style task draft. Keep each string <=160 chars and on a single "
        "line. Preserve the field id verbatim; do not invent new fields. "
        "Return JSON matching the schema.\n\n"
        f"Draft: {json.dumps(safe_draft)}\n"
        f"Issues: {json.dumps(safe_issues)}"
    )


def _merge_readiness(state: dict[str, Any], parsed: Any) -> dict[str, Any]:
    deterministic = state["_deterministic"]
    issues = state["_issues"]
    if isinstance(parsed, ReadinessPolish):
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
        return {"_result": {**deterministic, "issues": merged_issues}}
    return {"_result": parsed}  # fallback value (dict)


_readiness_step: PolishStep[ReadinessPolish] = PolishStep(
    prompt_fn=_build_readiness_prompt,
    schema=ReadinessPolish,
    fallback_fn=lambda state: state["_deterministic"],
    merge_fn=_merge_readiness,
)


async def _polish_readiness(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    draft: dict[str, Any],
) -> tuple[dict[str, Any], Any, int, int]:
    """Polish readiness issue messages/suggestions; deterministic on stub.

    Polished rows are merged back onto the deterministic ``issues`` by
    ``field`` id, so the FE validator never sees a new field id and a
    blank polished string preserves the deterministic copy.

    Returns ``(result, raw_message, tokens_in, tokens_out)``.
    """
    issues = deterministic.get("issues") or []
    if not issues:
        return deterministic, None, 0, 0
    _state = {"_deterministic": deterministic, "_draft": draft, "_issues": issues}
    update, tokens_in, tokens_out = await _readiness_step.run(_state, model)
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


def _build_rationale_prompt(state: dict[str, Any]) -> str:
    draft = state["_draft"]
    points = state["_points"]
    neighbours = state["_neighbours"]
    safe_draft = redact_task_fields(draft)
    safe_neighbours = redact_dict(neighbours[:3])
    return (
        "Write a single-line, <=180-character rationale for this story-point "
        "estimate. Keep tone factual; reference the provided neighbours "
        "if helpful. Do not propose a different point value. Return the "
        "structured schema.\n\n"
        f"Draft: {json.dumps(safe_draft)}\nPoints: {points}\n"
        f"Neighbours: {json.dumps(safe_neighbours)}"
    )


_rationale_step: PolishStep[EstimationRationale] = PolishStep(
    prompt_fn=_build_rationale_prompt,
    schema=EstimationRationale,
    fallback_fn=lambda state: state["_deterministic"],
    cap_field=("rationale", ESTIMATION_RATIONALE_MAX),
)


async def _polish_rationale(
    model: BaseChatModel,
    deterministic: str,
    draft: dict[str, Any],
    points: int,
    neighbours: list[dict[str, Any]],
) -> tuple[str, Any, int, int]:
    """LLM-polish the estimation rationale; deterministic fallback on stub.

    Returns ``(result, raw_message, tokens_in, tokens_out)``.
    """
    _state = {
        "_deterministic": deterministic,
        "_draft": draft,
        "_points": points,
        "_neighbours": neighbours,
    }
    update, tokens_in, tokens_out = await _rationale_step.run(_state, model)
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


async def polish_readiness(
    model: BaseChatModel,
    deterministic: dict[str, Any],
    draft: dict[str, Any],
) -> tuple[dict[str, Any], int, int]:
    """Backward-compatible 3-tuple wrapper around :func:`_polish_readiness`.

    External callers (v1 shim, tests) rely on the 3-tuple
    ``(result, tokens_in, tokens_out)`` signature.  Internal node code
    calls :func:`_polish_readiness` directly.
    """
    result, _raw_msg, tokens_in, tokens_out = await _polish_readiness(
        model, deterministic, draft
    )
    return result, tokens_in, tokens_out


async def polish_rationale(
    model: BaseChatModel,
    deterministic: str,
    draft: dict[str, Any],
    points: int,
    neighbours: list[dict[str, Any]],
) -> tuple[str, int, int]:
    """Backward-compatible 3-tuple wrapper around :func:`_polish_rationale`.

    External callers (v1 shim, tests) rely on the 3-tuple
    ``(result, tokens_in, tokens_out)`` signature.  Internal node code
    calls :func:`_polish_rationale` directly.
    """
    result, _raw_msg, tokens_in, tokens_out = await _polish_rationale(
        model, deterministic, draft, points, neighbours
    )
    return result, tokens_in, tokens_out


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
        tools=(FE_SIMILAR_TASKS, "be.embed", "be.embedding_neighbors"),
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
        _default_model = self.chat_model  # captured for fallback

        # Shared node body from _shared.py (same logic as task-drafting-agent).
        fetch_similar = fetch_similar_node

        async def fetch_embeddings(state: TaskEstimationState) -> dict[str, Any]:
            similar = state.get("similar_tasks") or []
            draft = state.get("task_draft") or {}
            query_text = draft.get("taskName", "")
            from app.config import settings as app_settings

            similar = await augment_items_with_vector_neighbours(
                similar,
                query_text=query_text,
                project_id=str(state.get("project_id") or ""),
                settings=app_settings,
                failure_log_message=(
                    "Vector-augmented similar merge failed; using FE list only."
                ),
            )
            corpus_texts = [item.get("text", "") for item in similar]
            corpus_ids = [item.get("id", str(idx)) for idx, item in enumerate(similar)]
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
            # Prefer the per-call context model; fall back to the default.
            _rt = get_runtime(ChatContext)
            chat_model: BaseChatModel = (
                (_rt.context or {}).get("chat_model") or _default_model
            )
            pre_estimate = state.get("estimate")
            # ------------------------------------------------------------------
            # v1-shim path: route passes raw ``context_tasks`` (and the task
            # draft in ``task_draft``); compute the v1_engine-compatible
            # deterministic baseline here instead of having the route pre-call
            # v1_engine.estimate.  ``context_tasks`` is set only when this path
            # is active; otherwise fall through to the normal estimate logic.
            # ------------------------------------------------------------------
            if pre_estimate is None and state.get("context_tasks") is not None:
                task_draft = state.get("task_draft") or {}
                v1_payload: dict[str, Any] = {
                    "note": task_draft.get("note") or "",
                    "taskName": task_draft.get("taskName") or "",
                    "context": {"tasks": state.get("context_tasks") or []},
                }
                pre_estimate = estimate_from_payload(v1_payload)
            if isinstance(pre_estimate, dict):
                # Pre-populated estimate (from v1 path or older callers).
                # Polish the rationale field and return the updated estimate;
                # all other fields (storyPoints, confidence, similar) come from
                # the baseline unchanged so the wire shape stays byte-identical
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
                rationale, raw_msg_rat, _tokens_in, _tokens_out = await _polish_rationale(
                    chat_model, deterministic_rationale, draft, points, neighbours
                )
                extra_msgs_rat = [raw_msg_rat] if raw_msg_rat is not None else []
                return {
                    "estimate": {**pre_estimate, "rationale": rationale},
                    **({"messages": extra_msgs_rat} if extra_msgs_rat else {}),
                }
            draft = state.get("task_draft") or {}
            neighbours = state.get("embedding_neighbors") or []
            points = _estimate_for(draft, neighbours)
            deterministic = "Derived from prompt length + grounded neighbours."
            rationale, raw_msg_rat2, _tokens_in, _tokens_out = await _polish_rationale(
                chat_model, deterministic, draft, points, neighbours
            )
            extra_msgs_rat2 = [raw_msg_rat2] if raw_msg_rat2 is not None else []
            return {
                "estimate": {
                    "storyPoints": points,
                    "confidence": "moderate" if neighbours else "low",
                    "rationale": rationale,
                },
                **({"messages": extra_msgs_rat2} if extra_msgs_rat2 else {}),
            }

        async def readiness(state: TaskEstimationState) -> dict[str, Any]:
            # Prefer the per-call context model; fall back to the default.
            _rt = get_runtime(ChatContext)
            chat_model: BaseChatModel = (
                (_rt.context or {}).get("chat_model") or _default_model
            )
            pre_readiness = state.get("readiness")
            # ------------------------------------------------------------------
            # v1-shim path: route passes raw ``context_tasks`` and the task
            # draft; compute the v1_engine-compatible readiness baseline here.
            # When ``context_tasks`` is set the route is in "raw payload" mode
            # and we derive readiness from the task_draft fields directly.
            # ------------------------------------------------------------------
            if pre_readiness is None and state.get("context_tasks") is not None:
                task_draft = state.get("task_draft") or {}
                # Reconstruct the v1 payload fields the readiness function inspects.
                v1_payload_rd: dict[str, Any] = {
                    "taskName": task_draft.get("taskName") or "",
                    "note": task_draft.get("note") or "",
                    "epic": task_draft.get("epic") or "",
                    "type": task_draft.get("type") or "",
                    "coordinatorId": task_draft.get("coordinatorId") or None,
                }
                pre_readiness = readiness_from_payload(v1_payload_rd)
            if isinstance(pre_readiness, dict):
                # Pre-populated readiness: polish the issue messages/suggestions.
                # The v1_engine shape ``{issues: [...]}`` is preserved so the
                # parity test and the FE validator both pass byte-identically on
                # the stub path.
                draft = state.get("task_draft") or {}
                polished, raw_msg_rd, _tokens_in, _tokens_out = await _polish_readiness(
                    chat_model, pre_readiness, draft
                )
                extra_msgs_rd = [raw_msg_rd] if raw_msg_rd is not None else []
                return {
                    "readiness": polished,
                    **({"messages": extra_msgs_rd} if extra_msgs_rd else {}),
                }
            draft = state.get("task_draft") or {}
            deterministic = _readiness(draft)
            polished, raw_msg_rd2, _tokens_in, _tokens_out = await _polish_readiness(
                chat_model, deterministic, draft
            )
            extra_msgs_rd2 = [raw_msg_rd2] if raw_msg_rd2 is not None else []
            return {
                "readiness": polished,
                **({"messages": extra_msgs_rd2} if extra_msgs_rd2 else {}),
            }

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
            refs = build_citation_refs(similar, "task")
            new_events: list[dict] = []
            if refs:
                new_events.append({"kind": "citation", "refs": refs})
            new_events.append(
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
                new_events.append(
                    {
                        "kind": "suggestion",
                        "surface": "estimate_v1",
                        "payload": est_payload,
                    }
                )
            if read_payload is not None:
                new_events.append(
                    {
                        "kind": "suggestion",
                        "surface": "readiness_v1",
                        "payload": read_payload,
                    }
                )
            return {
                "messages": [AIMessage(content=json.dumps(payload))],
                "events": new_events,
            }

        graph: StateGraph = linear_graph(
            TaskEstimationState,
            [
                ("fetch_similar", fetch_similar),
                ("fetch_embeddings", fetch_embeddings),
                ("estimate", estimate),
                ("readiness", readiness),
                ("emit_citations", emit_citations),
            ],
            context_schema=ChatContext,
        )
        return graph.compile(checkpointer=checkpointer, store=store)


