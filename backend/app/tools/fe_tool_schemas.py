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
    "fe.listProjects": {
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
    "fe.listMembers": {
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
    "fe.getProject": {
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
    "fe.listBoard": {
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
    "fe.listTasks": {
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
    "fe.getTask": {
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
    "fe.boardSnapshot": {
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
    "fe.similarTasks": {
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
    "fe.viewerContext": {
        "description": "Return the current viewer's identity, role and preferences.",
        "args_schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string"},
                "role": {"type": "string"},
                "preferences": {"type": "object"},
            },
        },
    },
    "fe.recentActivity": {
        "description": "Return recent activity entries for a project.",
        "args_schema": {
            "type": "object",
            "properties": {
                "project_id": _PROJECT_ID,
                "limit": _LIMIT,
            },
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "activity": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
            "required": ["activity"],
        },
    },
    "fe.formDraft": {
        "description": "Return any draft the user has in-flight in a task creation form.",
        "args_schema": {
            "type": "object",
            "properties": {"project_id": _PROJECT_ID},
            "required": ["project_id"],
            "additionalProperties": False,
        },
        "result_schema": {
            "type": "object",
            "properties": {
                "draft": {"type": ["object", "null"]},
            },
        },
    },
    "fe.searchCandidates": {
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
