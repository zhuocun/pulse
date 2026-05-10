"""Tests for the per-agent ``TypedDict`` state schemas (PRD v2.1 §5A.2)."""

from __future__ import annotations

from typing import get_type_hints

from app.agents.context import ChatContext
from app.agents.state import (
    AgentState,
    BaseAgentState,
    BoardBriefState,
    ChatState,
    TaskDraftingState,
    TaskEstimationState,
    TriageState,
)


def test_base_agent_state_keys() -> None:
    # F-43: project_id, user_id, autonomy_level moved to ChatContext
    hints = get_type_hints(BaseAgentState, include_extras=True)
    assert set(hints) == {"messages", "events"}


def test_base_agent_state_removed_fields_in_context() -> None:
    """F-43: the three static run-scoped fields must live on ChatContext."""
    ctx_hints = get_type_hints(ChatContext, include_extras=True)
    for field in ("project_id", "user_id", "autonomy_level"):
        assert field in ctx_hints, (
            f"F-43: {field!r} must be declared on ChatContext, not BaseAgentState"
        )


def test_board_brief_state_keys() -> None:
    hints = get_type_hints(BoardBriefState, include_extras=True)
    assert {
        "messages",
        "board_snapshot",
        "drift_result",
        "brief",
        "last_brief_read_at",
    } <= set(hints)
    # F-43: these fields must NOT appear on board_snapshot state (they live in context)
    for field in ("project_id", "user_id", "autonomy_level"):
        assert field not in hints, (
            f"F-43: {field!r} must not be in BoardBriefState (belongs in ChatContext)"
        )


def test_task_drafting_state_keys() -> None:
    hints = get_type_hints(TaskDraftingState, include_extras=True)
    assert {
        "prompt",
        "breakdown_axis",
        "board_snapshot",
        "similar_tasks",
        "draft",
    } <= set(hints)


def test_task_estimation_state_keys() -> None:
    hints = get_type_hints(TaskEstimationState, include_extras=True)
    assert {
        "task_draft",
        "similar_tasks",
        "embedding_neighbors",
        "estimate",
        "readiness",
    } <= set(hints)


def test_chat_state_inherits_base() -> None:
    hints = get_type_hints(ChatState, include_extras=True)
    base_hints = get_type_hints(BaseAgentState, include_extras=True)
    assert set(base_hints) <= set(hints)


def test_triage_state_keys() -> None:
    hints = get_type_hints(TriageState, include_extras=True)
    assert {"board_snapshot", "drift_result", "nudges"} <= set(hints)


def test_agent_state_back_compat_alias_present() -> None:
    """Existing ``AgentState`` TypedDict remains importable for back-compat."""

    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    assert "metadata" in hints
