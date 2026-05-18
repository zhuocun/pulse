"""Canonical FE-side tool name strings (PRD v2.1 §5.4.1).

Catalog agents reference these constants instead of scattering ``"fe.*"``
literals across interrupt payloads and ``AgentMetadata.tools`` tuples.
Schema shapes live in :mod:`app.tools.fe_tool_schemas`.
"""

from __future__ import annotations

FE_LIST_PROJECTS = "fe.listProjects"
FE_LIST_MEMBERS = "fe.listMembers"
FE_GET_PROJECT = "fe.getProject"
FE_LIST_BOARD = "fe.listBoard"
FE_LIST_TASKS = "fe.listTasks"
FE_GET_TASK = "fe.getTask"
FE_BOARD_SNAPSHOT = "fe.boardSnapshot"
FE_SIMILAR_TASKS = "fe.similarTasks"
FE_VIEWER_CONTEXT = "fe.viewerContext"
FE_RECENT_ACTIVITY = "fe.recentActivity"
FE_FORM_DRAFT = "fe.formDraft"
FE_SEARCH_CANDIDATES = "fe.searchCandidates"
FE_APPLY_MUTATION = "fe.applyMutation"

ALL_FE_TOOL_NAMES: frozenset[str] = frozenset(
    (
        FE_LIST_PROJECTS,
        FE_LIST_MEMBERS,
        FE_GET_PROJECT,
        FE_LIST_BOARD,
        FE_LIST_TASKS,
        FE_GET_TASK,
        FE_BOARD_SNAPSHOT,
        FE_SIMILAR_TASKS,
        FE_VIEWER_CONTEXT,
        FE_RECENT_ACTIVITY,
        FE_FORM_DRAFT,
        FE_SEARCH_CANDIDATES,
        FE_APPLY_MUTATION,
    )
)

__all__ = [
    "ALL_FE_TOOL_NAMES",
    "FE_APPLY_MUTATION",
    "FE_BOARD_SNAPSHOT",
    "FE_FORM_DRAFT",
    "FE_GET_PROJECT",
    "FE_GET_TASK",
    "FE_LIST_BOARD",
    "FE_LIST_MEMBERS",
    "FE_LIST_PROJECTS",
    "FE_LIST_TASKS",
    "FE_RECENT_ACTIVITY",
    "FE_SEARCH_CANDIDATES",
    "FE_SIMILAR_TASKS",
    "FE_VIEWER_CONTEXT",
]
