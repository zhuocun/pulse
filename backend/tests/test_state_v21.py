"""Tests for the per-agent ``TypedDict`` state schemas (PRD v2.1 §5A.2)."""

from __future__ import annotations

from typing import get_type_hints

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
    hints = get_type_hints(BaseAgentState, include_extras=True)
    assert set(hints) == {"messages", "events", "project_id", "user_id", "autonomy_level"}


def test_board_brief_state_keys() -> None:
    hints = get_type_hints(BoardBriefState, include_extras=True)
    assert {
        "messages",
        "project_id",
        "user_id",
        "autonomy_level",
        "board_snapshot",
        "drift_result",
        "brief",
        "last_brief_read_at",
    } <= set(hints)


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
