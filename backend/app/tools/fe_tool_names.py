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
FE_SEARCH_CANDIDATES = "fe.searchCandidates"

# Split mutation handshake (PRD §5.4.1): a single multi-stage tool is an
# anti-pattern (the model can be coaxed to skip the approval stage by
# manipulating the stage argument), so the contract is two tools:
# ``fe.requestMutationApproval`` triggers the HITL review card;
# ``fe.applyApprovedMutation`` redeems the approval id the runtime returned.
FE_REQUEST_MUTATION_APPROVAL = "fe.requestMutationApproval"
FE_APPLY_APPROVED_MUTATION = "fe.applyApprovedMutation"

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
        FE_SEARCH_CANDIDATES,
        FE_REQUEST_MUTATION_APPROVAL,
        FE_APPLY_APPROVED_MUTATION,
    )
)

__all__ = [
    "ALL_FE_TOOL_NAMES",
    "FE_APPLY_APPROVED_MUTATION",
    "FE_BOARD_SNAPSHOT",
    "FE_GET_PROJECT",
    "FE_GET_TASK",
    "FE_LIST_BOARD",
    "FE_LIST_MEMBERS",
    "FE_LIST_PROJECTS",
    "FE_LIST_TASKS",
    "FE_REQUEST_MUTATION_APPROVAL",
    "FE_SEARCH_CANDIDATES",
    "FE_SIMILAR_TASKS",
]
