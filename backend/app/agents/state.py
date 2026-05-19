"""Default agent state schema and PRD v2.1 per-agent state extensions.

LangGraph 1.x lets each graph define its own state. We expose a small,
opinionated default that covers the 90% case (a chat-style ``messages``
list plus a free-form ``metadata`` bag) plus a family of per-agent
``TypedDict`` schemas for the Board Copilot v2.1 agents (PRD §5A).

Shared-field mixins (``WithBoardSnapshot``, ``WithDriftResult``,
``WithSimilarTasks``) let multiple agent states compose the same field
declarations via multiple inheritance rather than repeating them.
"""

import itertools
from typing import Annotated, Any, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from typing_extensions import NotRequired


def add_events(
    left: list[dict] | None,
    right: list[dict] | None,
) -> list[dict]:
    """Reducer for the ``events`` field: append-only accumulation.

    Mirrors :func:`langgraph.graph.message.add_messages` semantics for
    the typed event list. Both ``left`` and ``right`` may be ``None``
    (e.g. on the very first superstep before any node has run), which is
    normalised to an empty list so the final value is always a plain list.

    Fix 7: unpacking avoids an intermediate list allocation vs
    ``list(left or []) + list(right or [])``.
    """

    return [*(left or []), *(right or [])]


def merge_mutation_applied_ids(
    left: list[str] | None,
    right: list[str] | None,
) -> list[str]:
    """Append-only dedup list of proposal ids that finished the apply FE-tool.

    Fix 7: ``itertools.chain`` avoids a temporary concatenated list.
    """

    seen: set[str] = set()
    out: list[str] = []
    for item in itertools.chain(left or (), right or ()):
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


class AgentState(TypedDict, total=False):
    """Default state for chat-style agents.

    - ``messages`` is reduced with :func:`langgraph.graph.message.add_messages`,
      which means each node returns a *partial* update like
      ``{"messages": [new_message]}`` and LangGraph appends/dedupes for us.
    - ``metadata`` is an optional, free-form dictionary for non-message data
      that nodes want to thread through the graph (e.g. trace ids, tool
      results that aren't messages, intermediate plans).
    """

    messages: Annotated[list[Any], add_messages]
    metadata: dict[str, Any]


class BaseAgentState(TypedDict):
    """Common state shared by all Board Copilot v2.1 agents (PRD §5A.2).

    Static run-scoped fields (``project_id``, ``user_id``,
    ``autonomy_level``) have been moved to
    :class:`~app.agents.context.ChatContext` (F-43).  They no longer live
    in state so checkpoints stay lean and time-travel replays are safe.
    """

    messages: Annotated[list[BaseMessage], add_messages]
    events: Annotated[list[dict], add_events]


# ---------------------------------------------------------------------------
# Shared-field mixins (PRD §5A.2 — Phase 5B)
# ---------------------------------------------------------------------------


class WithBoardSnapshot(TypedDict, total=False):
    """Mixin: board snapshot fetched from the FE via interrupt."""

    board_snapshot: dict[str, Any]


class WithDriftResult(TypedDict, total=False):
    """Mixin: drift-detection result produced by the detect_drift node."""

    drift_result: dict[str, Any]


class WithSimilarTasks(TypedDict, total=False):
    """Mixin: similar-task list fetched from the FE via interrupt."""

    similar_tasks: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Per-agent state schemas
# ---------------------------------------------------------------------------


class BoardBriefState(BaseAgentState, WithBoardSnapshot, WithDriftResult):
    """State for ``board-brief-agent`` (PRD §5A.3)."""

    brief: NotRequired[dict[str, Any] | None]
    last_brief_read_at: NotRequired[str | None]
    drift_severity: NotRequired[str | None]
    drift: NotRequired[dict[str, Any] | None]


class TaskDraftingState(BaseAgentState, WithBoardSnapshot, WithSimilarTasks):
    """State for ``task-drafting-agent`` (PRD §5A.4)."""

    prompt: NotRequired[str]
    breakdown_axis: NotRequired[str | None]
    draft: NotRequired[dict[str, Any] | None]
    # Optional fields forwarded from the raw v1 route payload so the agent
    # can compute the deterministic baseline without the route pre-calling
    # v1_engine.draft_task.  All three are absent for native v2.1 callers.
    column_id: NotRequired[str | None]
    coordinator_id: NotRequired[str | None]
    breakdown_count: NotRequired[int | None]
    # Sentinel set by v1 shim routes: when True the generate_draft node
    # computes the v1-compatible baseline from board_snapshot.
    _use_v1_baseline: NotRequired[bool]


class TaskEstimationState(BaseAgentState, WithSimilarTasks):
    """State for ``task-estimation-agent`` (PRD §5A.5)."""

    task_draft: NotRequired[dict[str, Any]]
    embedding_neighbors: NotRequired[list[dict[str, Any]] | None]
    estimate: NotRequired[dict[str, Any] | None]
    readiness: NotRequired[dict[str, Any] | None]
    # Context tasks forwarded from the raw v1 route payload so the agent
    # can compute the v1_engine.estimate baseline without the route pre-calling it.
    context_tasks: NotRequired[list[dict[str, Any]] | None]


def merge_pending_approvals(
    left: dict[str, dict[str, Any]] | None,
    right: dict[str, dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    """Reducer: right-bias merge of the ``pending_approvals`` map.

    Right values overwrite left for the same ``approval_id``.  Both
    sides may be ``None`` on the first superstep.
    """

    out: dict[str, dict[str, Any]] = dict(left or {})
    out.update(right or {})
    return out


class ChatState(BaseAgentState):
    """State for ``chat-agent`` (PRD §5A.6).

    Extends :class:`BaseAgentState` with a durable mutation-proposal HITL
    lane (GA §1): ``mutation_pending`` is populated by the model/stub,
    ``mutation_decision`` stores the ``Command(resume=…)`` payload after
    the approval interrupt, and ``mutation_applied_ids`` records proposals
    whose apply interrupt has completed once (idempotent replay guard).

    ``tool_rounds_used`` is the server-side counterpart of the FE-side
    defensive cap (``useAgentToolResolver.ts`` -> 8 rounds).  Each
    ``respond`` superstep that emits ``tool_calls`` increments the
    counter; the chat graph routes to END with an error frame once it
    crosses :data:`~app.agents.catalog.chat.MAX_SERVER_TOOL_ROUNDS`.

    ``pending_approvals`` tracks the two-step mutation handshake: keyed
    by ``approval_id`` -> the original proposal dict the model passed to
    ``requestMutationApproval``.  ``applyApprovedMutation`` validates
    the id is in this map before applying.
    """

    mutation_pending: NotRequired[dict[str, Any] | None]
    mutation_decision: NotRequired[dict[str, Any] | None]
    mutation_applied_ids: NotRequired[Annotated[list[str], merge_mutation_applied_ids]]
    tool_rounds_used: NotRequired[int]
    pending_approvals: NotRequired[
        Annotated[dict[str, dict[str, Any]], merge_pending_approvals]
    ]


class TriageState(BaseAgentState, WithBoardSnapshot, WithDriftResult):
    """State for ``triage-agent`` (PRD §5A.7)."""

    nudges: NotRequired[list[dict[str, Any]]]
    profile_hint: NotRequired[dict[str, Any] | None]


class SearchState(BaseAgentState):
    """State for ``search-agent`` v2.1 graph (PRD §5A — streaming search).

    ``query`` is the raw user search string.  ``kind`` restricts whether the
    FE fetches task candidates or project candidates.  ``candidates`` is the
    ``{id, text}`` list the FE returns after the interrupt; the graph embeds
    both the query and each candidate text and ranks by cosine similarity.
    ``ranking`` holds the final ``{ids, rationale}`` payload that is emitted
    to the FE and written as the last :class:`~langchain_core.messages.AIMessage`.
    """

    query: NotRequired[str]
    kind: NotRequired[str]  # "tasks" | "projects"
    candidates: NotRequired[list[dict] | None]
    ranking: NotRequired[dict | None]
