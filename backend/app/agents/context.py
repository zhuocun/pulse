"""Shared context schema for catalog agents.

LangGraph 1.x exposes a ``context=`` keyword on every invocation entry-point
(:meth:`~langgraph.pregel.Pregel.ainvoke`, :meth:`~langgraph.pregel.Pregel.astream`
etc.).  Nodes read the injected value via :func:`langgraph.runtime.get_runtime`.

``ChatContext`` is the shared schema for all six catalog agents.  The
``chat_model`` field is the primary knob: the runtime resolves the agent's
default model and injects it here so nodes read from context rather than
closing over ``self.chat_model`` at build time.  Callers can pass an
alternative model via ``context=ChatContext(chat_model=other_model, ...)``
for per-request overrides (e.g. ``X-Pulse-Model`` header, tenant config) —
the wiring point is clear but the routing logic is deferred (Phase 5+).

``user_id`` and ``project_id`` are carried as optional informational fields;
they are already present in the LangGraph ``configurable`` dict but also live
here so nodes that need them do not have to reach into the config.
"""

from __future__ import annotations

from typing import Any

from typing_extensions import TypedDict


class ChatContext(TypedDict, total=False):
    """Per-call context injected by the runtime into every catalog agent node.

    All fields are optional (``total=False``) so callers can supply any
    subset without constructing a complete object.

    Attributes:
        chat_model: The resolved :class:`~langchain_core.language_models.BaseChatModel`
            (or stub) for this call.  Nodes must fall back to the agent's
            default ``self.chat_model`` when this is ``None`` so the behaviour
            for callers that do not pass a context remains unchanged.
        user_id: Authenticated user id, mirrored from ``configurable`` for
            nodes that need it without accessing the raw config.
        project_id: Active project id for the request, used by budget/audit
            nodes without passing it through state.
    """

    chat_model: Any  # BaseChatModel | StubChatModel — Any avoids Pydantic friction
    user_id: str | None
    project_id: str | None
