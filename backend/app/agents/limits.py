"""Request size enforcement for the v1 and v2.1 AI surfaces.

Limits are intentionally loose defaults that can be tightened per-deployment
via env vars without a code change. All limits apply before any LLM call so
a malicious payload cannot inflate provider costs.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Optional

from fastapi import HTTPException, Request, status

from app import config


def iter_message_content_texts(content: object) -> Iterator[str]:
    if isinstance(content, str):
        yield content
        return
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, dict):
            continue
        text = block.get("text")
        if isinstance(text, str):
            yield text
        nested = block.get("content")
        if isinstance(nested, str):
            yield nested
        elif isinstance(nested, list):
            yield from iter_message_content_texts(nested)


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
            if declared > config.settings.ai_max_body_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Request payload too large",
                )

    # ``separators=(",",":")`` produces the most compact JSON, giving us a
    # cheaper upper-bound estimate without whitespace inflation.  Still
    # needed because clients can omit Content-Length (chunked transfer)
    # and to defend against payloads that decompress past the header.
    # Encode to UTF-8 bytes: multi-byte CJK/emoji chars count as 1 codepoint
    # but 3-4 bytes; measuring codepoints would allow those payloads to bypass
    # the limit.
    body_size = len(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    if body_size > config.settings.ai_max_body_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Request payload too large",
        )

    # Check top-level ``messages`` (v1 chat) and ``inputs.messages`` (v2.1 agents).
    inputs = payload.get("inputs")
    prompt_candidates = [payload.get("prompt")]
    if isinstance(inputs, dict):
        prompt_candidates.append(inputs.get("prompt"))
    for prompt in prompt_candidates:
        if (
            isinstance(prompt, str)
            and len(prompt.encode()) > config.settings.ai_max_prompt_bytes
        ):
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Request payload too large",
            )

    candidates = [payload.get("messages")]
    if isinstance(inputs, dict):
        candidates.append(inputs.get("messages"))
    for messages in candidates:
        if not isinstance(messages, list):
            continue
        if len(messages) > config.settings.ai_max_messages:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Request payload too large",
            )
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            content_size = sum(
                len(text.encode())
                for text in iter_message_content_texts(msg.get("content"))
            )
            if content_size > config.settings.ai_max_message_content_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Request payload too large",
                )
