"""Streaming-context-tolerant helpers for catalog agents.

LangGraph's :func:`langgraph.config.get_stream_writer` raises
``RuntimeError`` when called from a node that runs outside a streaming
context (``/invoke`` path, deterministic test runs). Catalog agents
write ``custom`` events for usage / citations / suggestions / nudges
regardless of whether the runtime asked for streaming, so we centralise
the try/except here -- no agent has to remember the dance.
"""

from __future__ import annotations

from typing import Any

from langgraph.config import get_stream_writer


def emit_custom(payload: Any) -> None:
    """Forward ``payload`` to the active stream writer, if any.

    Silently no-ops when the node is invoked without a streaming
    context. The writer call is otherwise unchanged so existing tests
    that patch ``get_stream_writer`` keep working.
    """

    try:
        writer = get_stream_writer()
    except RuntimeError as exc:
        # LangGraph raises when there is no active runnable / stream writer
        # (e.g. ``/invoke`` or tests calling ``emit_custom`` bare). Only those
        # cases are intentionally silent; other ``RuntimeError`` values
        # propagate so unrelated bugs are not swallowed.
        msg = str(exc).lower()
        if (
            "runnable context" in msg
            or "stream writer" in msg
            or ("stream" in msg and "writer" in msg)
        ):
            return
        raise
    writer(payload)
