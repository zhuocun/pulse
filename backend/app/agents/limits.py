"""Request size enforcement for the v1 and v2.1 AI surfaces.

Limits are intentionally loose defaults that can be tightened per-deployment
via env vars without a code change. All limits apply before any LLM call so
a malicious payload cannot inflate provider costs.
"""

from __future__ import annotations

import json
import os
from typing import Optional

from fastapi import HTTPException, Request, status

# Total serialised JSON body: 64 KiB
_MAX_BODY_BYTES: int = int(os.getenv("AI_MAX_BODY_BYTES", "65536"))
# Single string field (e.g. ``prompt``): 8 KiB
_MAX_PROMPT_BYTES: int = int(os.getenv("AI_MAX_PROMPT_BYTES", "8192"))
# Number of messages in a ``messages`` list
_MAX_MESSAGES: int = int(os.getenv("AI_MAX_MESSAGES", "50"))
# Per-message ``content`` length: 8 KiB
_MAX_MESSAGE_CONTENT_BYTES: int = int(os.getenv("AI_MAX_MESSAGE_CONTENT_BYTES", "8192"))


def enforce_request_limits(
    payload: dict,  # type: ignore[type-arg]
    *,
    request: Optional[Request] = None,
) -> None:
    """Raise HTTP 413 when ``payload`` exceeds any configured size limit.

    When ``request`` is supplied, ``Content-Length`` is consulted as the
    primary cheap fast-path: any client-declared body over the cap is
    rejected without re-serialising the parsed payload.  Per-field byte
    checks (prompt, messages) still need the parsed dict and run after
    the header gate.
    """

    if request is not None:
        header_value = request.headers.get("content-length")
        if header_value is not None:
            try:
                declared = int(header_value)
            except ValueError:
                declared = -1
            if declared > _MAX_BODY_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Request payload too large",
                )

    # ``separators=(",",":")`` produces the most compact JSON, giving us a
    # cheaper upper-bound estimate without whitespace inflation.  Still
    # needed because clients can omit Content-Length (chunked transfer)
    # and to defend against payloads that decompress past the header.
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
