"""JSON schemas for FE-side read tools (PRD v2.1 §5.4.1).

Agents in :mod:`app.agents.catalog` request data from the FE by raising a
LangGraph ``interrupt`` whose payload is ``{"tool": <name>, "args": <args>}``.
The FE reads tool definitions through the agents API, executes the matching
read against its own state, and resumes the graph with the result.

Keeping the catalog server-side means BE and FE share a single source of
truth for tool names + argument shapes, which the FE can render inline and
the BE can validate.
"""

from __future__ import annotations

from typing import Any

from app.tools.fe_tool_names import (
    FE_APPLY_APPROVED_MUTATION,
    FE_BOARD_SNAPSHOT,
    FE_GET_PROJECT,
    FE_GET_TASK,
    FE_LIST_BOARD,
    FE_LIST_MEMBERS,
    FE_LIST_PROJECTS,
    FE_LIST_TASKS,
    FE_REQUEST_MUTATION_APPROVAL,
    FE_SEARCH_CANDIDATES,
    FE_SIMILAR_TASKS,
)

# Common reusable schemas
_PROJECT_ID = {"type": "string", "description": "Project identifier."}
_TASK_ID = {"type": "string", "description": "Task identifier."}
_LIMIT = {
    "type": "integer",
    "minimum": 1,
    "maximum": 100,
    "description": "Maximum number of items to return.",
}


FE_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    FE_LIST_PROJECTS: {
        "description": "List projects visible to the current viewer.",
        "args_schema": {
            "type": "object",
            "properties": {"limit": _LIMIT},
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "projects": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["projects"],
        },
    },
    FE_LIST_MEMBERS: {
        "description": "List members of a project.",
        "args_schema": {
            "type": "object",
            "properties": {"project_id": _PROJECT_ID},
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "members": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["members"],
        },
    },
    FE_GET_PROJECT: {
        "description": "Fetch a single project by id.",
        "args_schema": {
            "type": "object",
            "properties": {"project_id": _PROJECT_ID},
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {"project": {"type": "object"}},
            "required": ["project"],
        },
    },
    FE_LIST_BOARD: {
        "description": "List columns + ordered task ids for a project board.",
        "args_schema": {
            "type": "object",
            "properties": {"project_id": _PROJECT_ID},
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "columns": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["columns"],
        },
    },
    FE_LIST_TASKS: {
        "description": "List tasks in a project, optionally filtered.",
        "args_schema": {
            "type": "object",
            "properties": {
                "project_id": _PROJECT_ID,
                "limit": _LIMIT,
                "filter": {
                    "type": "object",
                    "description": (
                        "Optional filter object. All fields are optional. "
                        "task_name: substring match (case-insensitive). "
                        "type: one of 'bug', 'feature', 'spike'. "
                        "coordinator_id: member id of the coordinator. "
                        "column_id: board column id."
                    ),
                    "properties": {
                        "task_name": {"type": "string"},
                        "type": {"type": "string"},
                        "coordinator_id": {"type": "string"},
                        "column_id": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["tasks"],
        },
    },
    FE_GET_TASK: {
        "description": "Fetch a single task by id.",
        "args_schema": {
            "type": "object",
            "properties": {"task_id": _TASK_ID},
            "required": ["task_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {"task": {"type": "object"}},
            "required": ["task"],
        },
    },
    FE_BOARD_SNAPSHOT: {
        "description": "Return a normalised board snapshot used by the brief and triage agents.",
        "args_schema": {
            "type": "object",
            "properties": {"project_id": _PROJECT_ID},
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "columns": {"type": "array"},
                "tasks": {"type": "array"},
                "members": {"type": "array"},
            },
        },
    },
    FE_SIMILAR_TASKS: {
        "description": "Return tasks similar to a given prompt or draft for grounding.",
        "args_schema": {
            "type": "object",
            "properties": {
                "project_id": _PROJECT_ID,
                "query": {"type": "string"},
                "limit": _LIMIT,
            },
            "required": ["project_id", "query"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "similar": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["similar"],
        },
    },
    FE_SEARCH_CANDIDATES: {
        "description": (
            "Return candidate tasks or projects for embedding-based reranking. "
            "The BE embeds the query and each candidate's text, then scores by "
            "cosine similarity to produce the final ranking."
        ),
        "args_schema": {
            "type": "object",
            "properties": {
                "project_id": _PROJECT_ID,
                "query": {"type": "string", "description": "Raw search query string."},
                "kind": {
                    "type": "string",
                    "enum": ["tasks", "projects"],
                    "description": "Whether to fetch task or project candidates.",
                },
                "limit": _LIMIT,
            },
            "required": ["project_id", "query", "kind"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "candidates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "text": {"type": "string"},
                        },
                        "required": ["id", "text"],
                    },
                },
            },
            "required": ["candidates"],
        },
    },
    FE_REQUEST_MUTATION_APPROVAL: {
        "description": (
            "Request human approval for a board mutation. Pauses the graph "
            "via interrupt; the FE renders a review card for the viewer and "
            "resumes with ``Command(resume={'accepted': <bool>, "
            "'edited_diff': <diff>?})``. Returns a stable approval_id the "
            "agent must redeem via applyApprovedMutation."
        ),
        "args_schema": {
            "type": "object",
            "properties": {
                "proposal_id": {"type": "string"},
                "project_id": {"type": "string"},
                "mutation": {
                    "type": "object",
                    "description": (
                        "Full mutation payload (diff, description, risk, "
                        "undoable). Mirrors the proposal shape on the "
                        "mutation_proposal event."
                    ),
                },
            },
            "required": ["proposal_id"],
            "additionalProperties": True,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "approval_id": {"type": "string"},
                "status": {
                    "type": "string",
                    "enum": ["pending", "rejected", "approved"],
                },
                "explanation": {"type": "string"},
            },
            "required": ["approval_id", "status"],
        },
    },
    FE_APPLY_APPROVED_MUTATION: {
        "description": (
            "Apply a mutation that has already been approved via "
            "requestMutationApproval. The approval_id is the value returned "
            "by that prior call; the FE re-validates the id against its "
            "pending-approval cache and refuses if the viewer never accepted."
        ),
        "args_schema": {
            "type": "object",
            "properties": {
                "approval_id": {"type": "string"},
                "project_id": {"type": "string"},
                "diff": {
                    "type": "object",
                    "description": (
                        "Optional override of the approved diff; the FE "
                        "rejects this if it does not match the approval's "
                        "edited_diff (if any)."
                    ),
                },
            },
            "required": ["approval_id"],
            "additionalProperties": True,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["applied", "failed"],
                },
                "details": {"type": "object"},
            },
            "required": ["status"],
        },
    },
}


# ---------------------------------------------------------------------------
# Chat-tool schemas (single source of truth for _chat_tools.py generation)
# ---------------------------------------------------------------------------
# These define the LangChain tool stubs that chat-agent declares so the LLM
# can request FE-side execution. Names and arg shapes here must match the FE
# dispatcher in ``src/utils/ai/chatTools.ts`` exactly. The generator in
# ``app/agents/catalog/_chat_tools.py`` derives the ``@tool``-decorated
# functions from this dict so the schema lives in one place.

CHAT_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "listProjects": {
        "description": "List projects visible to the current viewer.",
        "args": {
            "filter": {
                "type": "object",
                "description": (
                    "Free-form dict of conditions passed verbatim to the FE "
                    "projects API (e.g. {\"organization\": \"Acme\"})."
                ),
                "optional": True,
            },
        },
    },
    "listMembers": {
        "description": "List members of the current viewer's organisation.",
        "args": {},
    },
    "getProject": {
        "description": "Fetch a single project by id.",
        "args": {
            "projectId": {
                "type": "string",
                "description": "Project identifier.",
            },
        },
    },
    "listBoard": {
        "description": "List columns and ordered task ids for a project board.",
        "args": {
            "projectId": {
                "type": "string",
                "description": "Project identifier.",
            },
        },
    },
    "listTasks": {
        "description": (
            "List tasks in a project, optionally filtered. "
            "The ``filter`` object accepts ``taskName`` (substring), "
            "``type`` (bug / feature / spike), ``coordinatorId``, and "
            "``columnId``. Pass ``None`` (or omit) to list all tasks for the "
            "project."
        ),
        "args": {
            "projectId": {
                "type": "string",
                "description": "Project identifier.",
            },
            "filter": {
                "type": "object",
                "description": (
                    "Optional filter. Fields: taskName (substring, case-insensitive), "
                    "type (bug/feature/spike), coordinatorId, columnId."
                ),
                "optional": True,
                "filter_fields": ["taskName", "type", "coordinatorId", "columnId"],
            },
        },
    },
    "getTask": {
        "description": "Fetch a single task by id.",
        "args": {
            "taskId": {
                "type": "string",
                "description": "Task identifier.",
            },
        },
    },
}


def fe_tool_definitions() -> list[dict[str, Any]]:
    """Return the FE tool catalogue as a list (for FE discoverability)."""

    return [{"name": name, **schema} for name, schema in FE_TOOL_SCHEMAS.items()]


def interrupt_payload(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Build the payload an agent passes to ``langgraph.types.interrupt``.

    Raises :class:`KeyError` if the tool name is unknown so a typo at agent
    authoring time fails loudly.
    """

    if name not in FE_TOOL_SCHEMAS:
        raise KeyError(f"Unknown FE tool: {name!r}")
    return {"tool": name, "args": dict(args)}
