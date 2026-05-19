"""SSE wire envelope translator (PRD v2.1 §5.3).

The FE consumes events shaped like
``{"type": "updates"|"messages"|"custom"|"interrupt"|"error", "ns": [...], "data": ...}``
(see ``src/interfaces/agent.d.ts`` ``StreamPart`` in pulse ``src/``).
LangGraph's ``astream(stream_mode=("updates","messages","custom"))`` yields
``(mode, chunk)`` tuples in a different shape, so the router needs a
translation layer.

This module is the single place that owns the wire format. The router
calls :func:`translate_event` once per LangGraph chunk and emits zero,
one, or many envelope dicts ready to be JSON-encoded into the SSE
``data:`` line. Two non-trivial mappings live here:

* ``__interrupt__`` payloads inside an ``updates`` chunk are lifted into
  a typed ``{"type": "interrupt", ...}`` event so the FE can drive its
  auto-resume loop without sniffing for a magic key.
* ``messages`` chunks (LangChain ``AIMessage`` / chunk + metadata
  tuples) are flattened into the ``[LLMTokenChunk, MessageMetadata]``
  pair the FE expects.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Optional

import orjson
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

# LangGraph 1.x exposes paused interrupts under this internal key in the
# "updates" stream payload. Keep the constant centralized here so a future
# LangGraph rename only touches one file.
_INTERRUPT_KEY = "__interrupt__"


_PRIMITIVE_TYPES = (str, int, float, bool, type(None))
_FAST_PATH_TYPES = (str, int, float, bool, type(None))


def _is_scalar(v: Any) -> bool:
    """Return True if ``v`` is a JSON-primitive (no encoding needed)."""
    return isinstance(v, _PRIMITIVE_TYPES)


def _to_jsonable(value: Any) -> Any:
    """Best-effort coercion to a JSON-serializable value.

    Uses FastAPI's :func:`jsonable_encoder`, which understands Pydantic
    models, dataclasses, dates, enums, and nested LangChain message
    objects. A truly unserialisable value falls back to a structured
    envelope (so the FE keeps seeing dicts under ``data``) instead of
    a bare ``repr`` string the discriminator cannot parse.

    Fast-path: top-level scalars and plain dicts whose values are all
    scalars are returned immediately without invoking ``jsonable_encoder``.
    """

    # Fast-path: top-level scalar
    if isinstance(value, _FAST_PATH_TYPES):
        return value

    # Fast-path: plain dict with all scalar values
    if type(value) is dict and all(_is_scalar(v) for v in value.values()):
        return value

    try:
        encoded = jsonable_encoder(value)
    except (TypeError, ValueError):
        logger.warning(
            "SSE chunk could not be JSON-encoded; emitting placeholder.",
            exc_info=True,
        )
        return {"__unserializable__": type(value).__name__}

    # ``jsonable_encoder`` can return ``{}`` for arbitrary instances that do
    # not expose encodable attributes (no exception). Treat that as failure
    # so we emit the same placeholder as the encode fallback path.
    if encoded == {} and not isinstance(
        value, (dict, list, tuple, str, int, float, bool, type(None))
    ):
        return {"__unserializable__": type(value).__name__}

    return encoded


def _coerce_namespace(value: Any) -> list[str]:
    """Normalise LangGraph's namespace tuple into the FE's ``string[]`` shape."""

    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def _interrupt_data(payload: Any) -> Optional[dict[str, Any]]:
    """Extract ``{"tool", "args"}`` from a LangGraph interrupt payload.

    LangGraph wraps each ``interrupt(value)`` in an ``Interrupt`` object
    (with a ``value`` attribute), a list / tuple of those, or a dict
    serialized with a ``value`` key. We accept all three (plus a bare
    dict that already has the FE shape) and normalise to ``{tool, args}``.
    """

    if hasattr(payload, "value"):
        payload = payload.value
    if isinstance(payload, (list, tuple)):
        if not payload:
            return None
        return _interrupt_data(payload[0])
    if isinstance(payload, dict) and "value" in payload and "tool" not in payload:
        return _interrupt_data(payload["value"])
    if not isinstance(payload, dict):
        return None
    tool = payload.get("tool")
    if not isinstance(tool, str):
        return None
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        args = {"value": args}
    return {"tool": tool, "args": args}


def _flatten_messages_chunk(chunk: Any) -> list[Any]:
    """Return a ``[LLMTokenChunk, MessageMetadata]`` pair the FE understands.

    LangGraph emits ``messages`` as ``(message, metadata)`` tuples; the FE
    types it as ``[{content, type?}, MessageMetadata]``. We unwrap
    LangChain message objects into a minimal ``{content, type}`` dict so
    the FE never sees provider-specific noise.
    """

    if isinstance(chunk, (list, tuple)) and len(chunk) >= 1:
        message = chunk[0]
        metadata = chunk[1] if len(chunk) > 1 else {}
    else:
        message = chunk
        metadata = {}

    content = getattr(message, "content", message)
    msg_type = getattr(message, "type", None) or getattr(message, "role", None)
    if isinstance(content, list):
        # Tool-call streaming: content is list[dict] (LangChain content blocks).
        # Stringifying it produces a useless repr, so emit the blocks as-is
        # under a dedicated key so the FE can inspect tool-call details.
        token: dict[str, Any] = {"content": "", "blocks": _to_jsonable(content)}
    else:
        token = {"content": content if isinstance(content, str) else str(content)}
    if isinstance(msg_type, str):
        token["type"] = msg_type
    metadata_dict = metadata if isinstance(metadata, dict) else {}
    return [token, _to_jsonable(metadata_dict)]


def translate_event(
    mode: str,
    chunk: Any,
    *,
    namespace: Optional[Any] = None,
) -> Iterable[dict[str, Any]]:
    """Yield zero or more FE-shaped envelopes for one LangGraph chunk.

    ``mode`` is the LangGraph stream mode (``updates`` / ``messages`` /
    ``custom``); ``chunk`` is the corresponding payload. ``namespace``
    is forwarded as ``ns`` -- LangGraph leaves it on the runtime object
    rather than the chunk, so callers populate it explicitly.
    """

    ns = _coerce_namespace(namespace)

    if mode == "updates":
        if isinstance(chunk, dict) and _INTERRUPT_KEY in chunk:
            interrupt = _interrupt_data(chunk[_INTERRUPT_KEY])
            if interrupt is not None:
                yield {"type": "interrupt", "ns": ns, "data": interrupt}
            # If there are non-interrupt updates in the same payload,
            # surface them so the FE can still see node progress.
            remainder = {k: v for k, v in chunk.items() if k != _INTERRUPT_KEY}
            if remainder:
                yield {
                    "type": "updates",
                    "ns": ns,
                    "data": _to_jsonable(remainder),
                }
            return
        yield {"type": "updates", "ns": ns, "data": _to_jsonable(chunk)}
        return

    if mode == "messages":
        yield {"type": "messages", "ns": ns, "data": _flatten_messages_chunk(chunk)}
        return

    if mode == "custom":
        yield {"type": "custom", "ns": ns, "data": _to_jsonable(chunk)}
        return

    # Unknown mode -- forward as a custom event so the FE error path is
    # not tripped by future LangGraph additions.
    yield {"type": "custom", "ns": ns, "data": {"mode": mode, "chunk": _to_jsonable(chunk)}}


def error_envelope(
    message: str, *, recoverable: bool = False, code: str = "stream_error"
) -> dict[str, Any]:
    """Build a typed mid-stream ``error`` envelope.

    ``code`` is a stable machine-readable enum (``"timeout"``,
    ``"agent_recursion"``, ``"agent_unavailable"`` ...) so the FE can
    branch on a canonical value instead of string-matching ``message``.
    Keeping the existing ``data: {message, recoverable}`` shape preserves
    the SSE wire contract; ``code`` is added alongside without renaming
    the wrapper. Defaults to ``"stream_error"`` for backwards-compat
    when the caller has no more specific classification.
    """

    return {
        "type": "error",
        "ns": [],
        "data": {"code": code, "message": message, "recoverable": recoverable},
    }


def usage_envelope(tokens_in: int, tokens_out: int) -> dict[str, Any]:
    """Build a ``custom`` envelope carrying a ``usage`` event."""

    return {
        "type": "custom",
        "ns": [],
        "data": {
            "kind": "usage",
            "tokensIn": int(max(0, tokens_in)),
            "tokensOut": int(max(0, tokens_out)),
        },
    }


def encode_sse(envelope: dict[str, Any]) -> bytes:
    """Encode an envelope as a complete SSE frame.

    Falls back to a placeholder error frame if ``envelope`` itself
    contains a value that survived ``_to_jsonable`` but tripped the
    final ``json.dumps`` (e.g. a NaN inside a numeric field). Without
    this guard a single bad chunk would 500 the entire stream.
    """

    try:
        body = orjson.dumps(envelope).decode()
    except (TypeError, ValueError):
        logger.warning(
            "SSE envelope failed final JSON encode; substituting error frame.",
            exc_info=True,
        )
        body = orjson.dumps(
            error_envelope("invalid stream chunk", code="encode_error")
        ).decode()
    return f"data: {body}\n\n".encode("utf-8")


DONE_FRAME = b"data: [DONE]\n\n"
