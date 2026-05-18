"""Unit tests for board-brief deterministic helpers."""

from __future__ import annotations

from app.agents.catalog.board_brief import (
    _column_task_counts,
    _compute_board_brief,
)


def test_column_task_counts_per_column() -> None:
    columns = [
        {"_id": "c-todo", "name": "To Do"},
        {"_id": "c-done", "name": "Done"},
    ]
    tasks = [
        {"_id": "t1", "columnId": "c-todo"},
        {"_id": "t2", "columnId": "c-todo"},
        {"_id": "t3", "columnId": "c-done"},
    ]
    assert _column_task_counts(columns, tasks) == [
        {"columnId": "c-todo", "columnName": "To Do", "count": 2},
        {"columnId": "c-done", "columnName": "Done", "count": 1},
    ]


def test_column_task_counts_skips_invalid_entries() -> None:
    assert _column_task_counts(
        [{"_id": "c1", "name": "Done"}, "junk"],
        [
            "junk",
            {"_id": "t1", "columnId": "c1"},
            {"_id": "t2", "columnId": "c1"},
        ],
    ) == [{"columnId": "c1", "columnName": "Done", "count": 2}]


def test_column_task_counts_non_list_tasks_zero_counts() -> None:
    columns = [{"_id": "c1", "name": "To Do"}]
    for bad_tasks in ({}, "not-a-list", {"_id": "t1"}):
        assert _column_task_counts(columns, bad_tasks) == [
            {"columnId": "c1", "columnName": "To Do", "count": 0},
        ]


def test_column_task_counts_matches_compute_board_brief_counts() -> None:
    context = {
        "columns": [
            {"_id": "c-todo", "name": "To Do"},
            {"_id": "c-doing", "name": "Doing"},
            {"_id": "c-done", "name": "Done"},
        ],
        "tasks": [
            {"_id": "t-1", "taskName": "Fix login bug", "columnId": "c-todo", "storyPoints": 3},
            {
                "_id": "t-2",
                "taskName": "Onboarding tour",
                "columnId": "c-doing",
                "storyPoints": 5,
            },
        ],
        "members": [],
    }
    assert _column_task_counts(context["columns"], context["tasks"]) == _compute_board_brief(
        context
    )["counts"]
