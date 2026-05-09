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
``StructuredTool`` only carries them as schemas for
``BaseChatModel.bind_tools``. Names match the FE wire identifiers
exactly (camelCase, no ``fe.`` prefix) so no translation is needed at
either end.

The module name starts with ``_`` so
:func:`app.agents.catalog.discover` skips it -- this module declares
schemas, not a runnable agent.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field, create_model

from app.tools.fe_tool_schemas import CHAT_TOOL_SCHEMAS

# ---------------------------------------------------------------------------
# Type-string → Python-type mapping used by the dynamic arg builder
# ---------------------------------------------------------------------------

_TYPE_MAP: dict[str, Any] = {
    "string": str,
    "integer": int,
    "boolean": bool,
    "number": float,
    "object": Dict[str, Any],
    "array": list,
}


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


def _build_filter_submodel(tool_name: str, arg_name: str, arg_spec: dict[str, Any]) -> type[BaseModel]:
    """Build a Pydantic model for a nested filter arg that carries ``filter_fields``.

    Each field in ``filter_fields`` becomes an ``Optional[str]`` field on
    the model; the per-field description is taken from a ``field_descriptions``
    hint if present, otherwise defaults to the field name.
    """
    filter_fields: list[str] = arg_spec.get("filter_fields", [])
    field_descriptions: dict[str, str] = arg_spec.get("field_descriptions", {})

    model_fields: dict[str, Any] = {}
    for fname in filter_fields:
        desc = field_descriptions.get(fname, fname)
        model_fields[fname] = (Optional[str], Field(None, description=desc))

    model_name = f"{tool_name}{arg_name.capitalize()}Filter"
    return create_model(model_name, **model_fields)  # type: ignore[call-overload]


def _build_args_model(tool_name: str, args_spec: dict[str, dict[str, Any]]) -> type[BaseModel]:
    """Build a Pydantic ``BaseModel`` subclass for a tool's argument schema.

    For each entry in ``args_spec``:
    - Required args (no ``"optional": True``) become ``(PythonType, Field(...))``
    - Optional args become ``(Optional[PythonType], Field(None, ...))``
    - An ``"object"`` arg with ``"filter_fields"`` becomes a typed nested model
      instead of a free-form ``Dict[str, Any]``; this lets the LLM discover
      the valid sub-fields rather than guessing.
    """
    model_fields: dict[str, Any] = {}

    for arg_name, arg_spec in args_spec.items():
        type_str = arg_spec.get("type", "string")
        description = arg_spec.get("description", arg_name)
        is_optional = bool(arg_spec.get("optional", False))

        # Determine the Python type for this arg
        if type_str == "object" and "filter_fields" in arg_spec:
            # Build a structured nested model so the LLM sees the sub-fields
            inner_type: Any = _build_filter_submodel(tool_name, arg_name, arg_spec)
        else:
            inner_type = _TYPE_MAP.get(type_str, Any)

        if is_optional:
            model_fields[arg_name] = (
                Optional[inner_type],
                Field(None, description=description),
            )
        else:
            model_fields[arg_name] = (
                inner_type,
                Field(..., description=description),
            )

    model_name = f"{tool_name}Args"
    return create_model(model_name, **model_fields)  # type: ignore[call-overload]


def _make_chat_tool(name: str, spec: dict[str, Any]) -> BaseTool:
    """Build a single FE-executed LangChain tool from a schema entry.

    The resulting :class:`~langchain_core.tools.StructuredTool` carries the
    full arg schema derived from ``spec["args"]`` and a body that raises
    :exc:`RuntimeError` if ever invoked server-side. The tool's
    ``description`` is taken directly from ``spec["description"]``.

    This function is the kernel of :func:`build_chat_tools` -- it is
    extracted so tests can exercise the generator independently of the
    real :data:`~app.tools.fe_tool_schemas.CHAT_TOOL_SCHEMAS` content.
    """

    description = spec["description"]
    args_spec: dict[str, dict[str, Any]] = spec.get("args", {})
    args_model = _build_args_model(name, args_spec)

    def _body(**_kwargs: Any) -> str:  # pragma: no cover — never runs server-side
        return _fe_executed(name)

    _body.__name__ = f"_{name}"
    _body.__doc__ = description

    return StructuredTool.from_function(
        func=_body,
        name=name,
        description=description,
        args_schema=args_model,
    )


def build_chat_tools() -> list[BaseTool]:
    """Build LangChain tool stubs from :data:`~app.tools.fe_tool_schemas.CHAT_TOOL_SCHEMAS`.

    Every entry in the schema dict produces exactly one
    :class:`~langchain_core.tools.StructuredTool` via :func:`_make_chat_tool`.
    The body always delegates to :func:`_fe_executed` so server-side
    invocation raises loudly. Arg signatures -- including nested filter
    sub-models -- are derived dynamically from the schema so adding a new
    tool to ``CHAT_TOOL_SCHEMAS`` automatically produces a usable stub here.
    """
    return [_make_chat_tool(name, spec) for name, spec in CHAT_TOOL_SCHEMAS.items()]


CHAT_TOOLS: list[BaseTool] = build_chat_tools()


__all__ = ["CHAT_TOOLS", "_make_chat_tool"]
