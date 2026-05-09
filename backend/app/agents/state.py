"""Default agent state schema and PRD v2.1 per-agent state extensions.

LangGraph 1.x lets each graph define its own state. We expose a small,
opinionated default that covers the 90% case (a chat-style ``messages``
list plus a free-form ``metadata`` bag) plus a family of per-agent
``TypedDict`` schemas for the Board Copilot v2.1 agents (PRD §5A).
"""

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
    """

    return list(left or []) + list(right or [])


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
    """Common state shared by all Board Copilot v2.1 agents (PRD §5A.2)."""

    messages: Annotated[list[BaseMessage], add_messages]
    events: Annotated[list[dict], add_events]
    project_id: NotRequired[str]
    user_id: NotRequired[str]
    autonomy_level: NotRequired[str]  # "suggest" | "plan" | "auto"


class BoardBriefState(BaseAgentState):
    """State for ``board-brief-agent`` (PRD §5A.3)."""

    board_snapshot: NotRequired[dict[str, Any] | None]
    drift_result: NotRequired[dict[str, Any] | None]
    brief: NotRequired[dict[str, Any] | None]
    last_brief_read_at: NotRequired[str | None]
    drift_severity: NotRequired[str | None]
    drift: NotRequired[dict[str, Any] | None]


class TaskDraftingState(BaseAgentState):
    """State for ``task-drafting-agent`` (PRD §5A.4)."""

    prompt: NotRequired[str]
    breakdown_axis: NotRequired[str | None]
    board_snapshot: NotRequired[dict[str, Any] | None]
    similar_tasks: NotRequired[list[dict[str, Any]] | None]
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


class TaskEstimationState(BaseAgentState):
    """State for ``task-estimation-agent`` (PRD §5A.5)."""

    task_draft: NotRequired[dict[str, Any]]
    similar_tasks: NotRequired[list[dict[str, Any]] | None]
    embedding_neighbors: NotRequired[list[dict[str, Any]] | None]
    estimate: NotRequired[dict[str, Any] | None]
    readiness: NotRequired[dict[str, Any] | None]
    # Context tasks forwarded from the raw v1 route payload so the agent
    # can compute the v1_engine.estimate baseline without the route pre-calling it.
    context_tasks: NotRequired[list[dict[str, Any]] | None]


class ChatState(BaseAgentState):
    """State for ``chat-agent`` (PRD §5A.6).

    Inherits :class:`BaseAgentState` unchanged; the chat agent operates
    purely on ``messages`` plus the common Board Copilot context fields.
    """


class TriageState(BaseAgentState):
    """State for ``triage-agent`` (PRD §5A.7)."""

    board_snapshot: NotRequired[dict[str, Any] | None]
    drift_result: NotRequired[dict[str, Any] | None]
    nudges: NotRequired[list[dict[str, Any]]]


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
