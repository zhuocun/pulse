"""Trust boundary for FE tool results re-entering the model.

LangGraph agents that loop the model through FE tool calls (chat-agent
most prominently) used to splice raw tool JSON straight back into the
conversation as a ``ToolMessage`` body.  Anything inside that body --
"ignore previous instructions", a fake ``</system>`` tag, a cross-tenant
mutation request -- is read by the model as if it had the same trust
level as the viewer's own messages.

:func:`wrap_tool_result` fences every tool result so the model treats it
as untrusted data:

* serialises any Python object to a stable JSON / string form
* runs PII redaction (:mod:`app.tools.redaction`) to strip emails, JWTs,
  card numbers, etc. before the bytes hit the provider
* scans for known prompt-injection shapes and, when any fire, tags the
  envelope so the model sees ``flags="instruction_injection_attempt"``
  on the outer tag and the observability hook records the event
* wraps the final payload in ``<untrusted_tool_result tool="...">...
  </untrusted_tool_result>`` -- the marker the shared
  :mod:`~app.agents.identity` prompt teaches the model to treat as data,
  not instructions
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.tools.redaction import flag_injection_attempts, redact

logger = logging.getLogger(__name__)


_INJECTION_FLAG = "instruction_injection_attempt"


def _serialise(content: Any) -> str:
    """Render *content* as a deterministic string.

    Dicts and lists go through :func:`json.dumps` with sorted keys so the
    fenced payload is stable across runs (useful when this output ends
    up in a checkpoint).  Already-string content is returned untouched;
    everything else falls back to ``str()``.
    """

    if isinstance(content, str):
        return content
    if isinstance(content, (dict, list, tuple)):
        try:
            return json.dumps(content, sort_keys=True, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return str(content)
    return str(content)


def wrap_tool_result(
    tool_name: str,
    content: Any,
    *,
    redact_content: bool = True,
) -> str:
    """Return the fenced, optionally-redacted string for a tool result.

    The returned value is intended to replace the raw ``ToolMessage`` /
    interrupt-resume body before it re-enters the model:

    * ``tool_name`` becomes the ``tool="..."`` attribute on the outer tag
      so the model can disambiguate multi-tool turns when reading the
      transcript.
    * ``content`` is serialised, then PII-redacted unless
      ``redact_content=False`` (the only legitimate callers that opt out
      are internal tests that want byte-identical comparisons against
      raw fixtures).
    * Injection patterns are detected on the *redacted* string -- the
      redactor never strips role tags or "ignore previous instructions"
      style text, only PII -- so the flag list is real either way.
    """

    serialised = _serialise(content)
    if redact_content:
        serialised = redact(serialised)[0]
    flags = flag_injection_attempts(serialised)
    if flags:
        # Single canonical flag attribute keeps the envelope shape stable
        # for the model and downstream parsers; concrete pattern names go
        # to logs / observability rather than to the prompt.
        logger.warning(
            "tool_envelope: injection patterns flagged tool=%r patterns=%r",
            tool_name,
            flags,
        )
        try:
            # Deferred import to keep the envelope cheap when observability
            # is off (the metrics module is itself lazy).
            from app.observability.metrics import record_agent_mutation_event

            record_agent_mutation_event("tool_envelope_injection_flagged")
        except Exception:  # noqa: BLE001 -- observability must never fail the agent
            logger.debug("tool_envelope: observability hook failed", exc_info=True)
        return (
            f'<untrusted_tool_result tool="{tool_name}" '
            f'flags="{_INJECTION_FLAG}">{serialised}'
            f"</untrusted_tool_result>"
        )
    return (
        f'<untrusted_tool_result tool="{tool_name}">{serialised}'
        f"</untrusted_tool_result>"
    )


__all__ = ["wrap_tool_result"]
