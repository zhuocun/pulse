"""Shared helpers used by multiple catalog agents.

Cross-cutting code that lives in this module rather than in any single
agent file:

- :func:`unpack_structured_response`: every ``polish_*`` helper unpacks
  the ``(raw, parsed, parsing_error)`` triple from a
  ``with_structured_output(..., include_raw=True)`` call. The block was
  duplicated five times before this module existed -- one update would
  silently diverge across catalog modules.

The module name is prefixed with ``_`` so the catalog auto-discovery
loop (``app/agents/catalog/__init__.py``) skips it; helpers here are
not standalone agents.
"""

from __future__ import annotations

from typing import Any, Optional


def unpack_structured_response(
    response: Any,
) -> tuple[Any, Any, Optional[Exception]]:
    """Return ``(raw, parsed, parsing_error)`` from a structured-output call.

    LangChain's ``model.with_structured_output(Schema, include_raw=True)``
    yields a dict shaped ``{"raw": AIMessage, "parsed": Schema | None,
    "parsing_error": Exception | None}``. A non-dict response (older
    providers, mocks, malformed return) is treated as a complete miss
    so callers can fall back to the deterministic baseline without
    a special-case branch in every agent.
    """

    if not isinstance(response, dict):
        return None, None, None
    raw = response.get("raw")
    parsed = response.get("parsed")
    error = response.get("parsing_error")
    return raw, parsed, error


__all__ = ["unpack_structured_response"]
