"""Request size enforcement for the v1 and v2.1 AI surfaces.

Limits are intentionally loose defaults that can be tightened per-deployment
via env vars without a code change. All limits apply before any LLM call so
a malicious payload cannot inflate provider costs.
"""

from __future__ import annotations

import json
import os

from fastapi import HTTPException, status

# Total serialised JSON body: 64 KiB
_MAX_BODY_BYTES: int = int(os.getenv("AI_MAX_BODY_BYTES", "65536"))
# Single string field (e.g. ``prompt``): 8 KiB
_MAX_PROMPT_BYTES: int = int(os.getenv("AI_MAX_PROMPT_BYTES", "8192"))
# Number of messages in a ``messages`` list
_MAX_MESSAGES: int = int(os.getenv("AI_MAX_MESSAGES", "50"))
# Per-message ``content`` length: 8 KiB
_MAX_MESSAGE_CONTENT_BYTES: int = int(os.getenv("AI_MAX_MESSAGE_CONTENT_BYTES", "8192"))


def enforce_request_limits(payload: dict) -> None:  # type: ignore[type-arg]
    """Raise HTTP 413 when ``payload`` exceeds any configured size limit."""

    # TODO: accept an optional ``request: Request`` arg and use
    # ``request.headers.get("content-length")`` as the primary byte count so
    # we read the client's wire size rather than re-serialising.  That change
    # requires updating the callers in routers/agents.py and routers/ai.py,
    # which are owned by a parallel agent; deferred to a follow-up.
    #
    # ``separators=(",",":")`` produces the most compact JSON, giving us a
    # cheaper upper-bound estimate without whitespace inflation.
    body_size = len(json.dumps(payload, separators=(",", ":")))
    if body_size > _MAX_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Request payload too large",
        )

    prompt = payload.get("prompt")
    if isinstance(prompt, str) and len(prompt.encode()) > _MAX_PROMPT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Request payload too large",
        )

    # Check top-level ``messages`` (v1 chat) and ``inputs.messages`` (v2.1 agents).
    inputs = payload.get("inputs")
    candidates = [payload.get("messages")]
    if isinstance(inputs, dict):
        candidates.append(inputs.get("messages"))
    for messages in candidates:
        if not isinstance(messages, list):
            continue
        if len(messages) > _MAX_MESSAGES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Request payload too large",
            )
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if isinstance(content, str) and len(content.encode()) > _MAX_MESSAGE_CONTENT_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Request payload too large",
                )
