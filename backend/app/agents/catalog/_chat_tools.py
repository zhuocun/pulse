"""Tool schemas exposed to ``chat-agent`` for FE-side execution.

PRD v2.1 §5A.6 / Phase 3 of the Board Copilot rollout: when the chat
agent has a real chat model it picks tools from this catalogue and the
FE dispatcher in ``src/utils/ai/chatTools.ts`` executes
them client-side. The FE owns the auth context + React Query cache the
calls need, so executing them server-side would require duplicating
that machinery.

**Single source of truth**: tool names, descriptions, and arg shapes are
defined in :data:`app.tools.fe_tool_schemas.CHAT_TOOL_SCHEMAS`. This
module generates the LangChain :class:`~langchain_core.tools.BaseTool`
stubs from that schema via :func:`build_chat_tools` so the contract
lives in one place. The function bodies never run -- the LangChain
``@tool`` decorator only carries them as schemas for
``BaseChatModel.bind_tools``. Names match the FE wire identifiers
exactly (camelCase, no ``fe.`` prefix) so no translation is needed at
either end.

The module name starts with ``_`` so
:func:`app.agents.catalog.discover` skips it -- this module declares
schemas, not a runnable agent.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from app.tools.fe_tool_schemas import CHAT_TOOL_SCHEMAS


class _ListTasksFilter(BaseModel):
    """Filter fields for the ``listTasks`` tool.

    Mirrors the FE dispatcher in
    ``src/utils/ai/chatTools.ts`` (the ``case "listTasks"``
    block): only these four fields are forwarded to the tasks API; any
    other keys the model emits are silently dropped client-side. Naming
    them in the schema steers the model to the right field names so a
    valid emit ends up actionable rather than no-op-filtered.
    """

    taskName: Optional[str] = Field(
        None,
        description=(
            "Substring filter on task name. Case-insensitive on the FE."
        ),
    )
    type: Optional[str] = Field(
        None,
        description="Task type filter -- one of 'bug', 'feature', 'spike'.",
    )
    coordinatorId: Optional[str] = Field(
        None,
        description=(
            "Member id of the coordinator. Validated against the FE's "
            "known-members set; unknown ids are dropped before the call."
        ),
    )
    columnId: Optional[str] = Field(
        None,
        description=(
            "Board column id. Validated against the FE's known-columns "
            "set; unknown ids are dropped before the call."
        ),
    )


def _fe_executed(name: str) -> str:
    """Body for declare-only chat tools.

    Should never run -- the FE executes the tool and POSTs the result
    back to ``/api/ai/chat`` as a ``role: "tool"`` message. If this
    function is ever invoked server-side something has wired the chat
    agent into a server-side tool executor by mistake; raise loudly so
    the misuse surfaces in tests rather than silently swallowing the
    call.
    """

    raise RuntimeError(f"FE-executed chat tool {name!r} was invoked server-side.")


def build_chat_tools() -> list[BaseTool]:
    """Build LangChain tool stubs from :data:`~app.tools.fe_tool_schemas.CHAT_TOOL_SCHEMAS`.

    Each entry in the schema dict produces one ``@tool``-decorated
    function. The body always delegates to :func:`_fe_executed` so
    server-side invocation raises loudly. Arg signatures are built
    from the schema's ``args`` dict; the ``listTasks`` tool uses the
    typed :class:`_ListTasksFilter` Pydantic model for its filter arg
    so the model emits the four FE-known filter fields with the right
    names.
    """
    tools: list[BaseTool] = []

    for tool_name, _spec in CHAT_TOOL_SCHEMAS.items():
        if tool_name == "listProjects":

            @tool("listProjects")
            def _list_projects(
                filter: Optional[Dict[str, Any]] = None,  # noqa: A002
            ) -> str:
                """List projects visible to the current viewer.

                The optional ``filter`` is a free-form dict of conditions passed
                verbatim to the FE projects API (e.g. ``{"organization": "Acme"}``).
                """
                return _fe_executed("listProjects")

            tools.append(_list_projects)

        elif tool_name == "listMembers":

            @tool("listMembers")
            def _list_members() -> str:
                """List members of the current viewer's organisation."""
                return _fe_executed("listMembers")

            tools.append(_list_members)

        elif tool_name == "getProject":

            @tool("getProject")
            def _get_project(projectId: str) -> str:  # noqa: N803
                """Fetch a single project by id."""
                return _fe_executed("getProject")

            tools.append(_get_project)

        elif tool_name == "listBoard":

            @tool("listBoard")
            def _list_board(projectId: str) -> str:  # noqa: N803
                """List columns and ordered task ids for a project board."""
                return _fe_executed("listBoard")

            tools.append(_list_board)

        elif tool_name == "listTasks":

            @tool("listTasks")
            def _list_tasks(
                projectId: str,  # noqa: N803
                filter: Optional[_ListTasksFilter] = None,  # noqa: A002
            ) -> str:
                """List tasks in a project, optionally filtered.

                The ``filter`` object accepts ``taskName`` (substring),
                ``type`` (bug / feature / spike), ``coordinatorId``, and
                ``columnId``. Pass ``None`` (or omit) to list all tasks for the
                project.
                """
                return _fe_executed("listTasks")

            tools.append(_list_tasks)

        elif tool_name == "getTask":

            @tool("getTask")
            def _get_task(taskId: str) -> str:  # noqa: N803
                """Fetch a single task by id."""
                return _fe_executed("getTask")

            tools.append(_get_task)


    return tools


CHAT_TOOLS: list[BaseTool] = build_chat_tools()


__all__ = ["CHAT_TOOLS"]
