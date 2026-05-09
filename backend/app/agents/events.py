"""Typed event models for the agent event stream (Phase 2).

Every payload a catalog agent produces is modelled here as a Pydantic
:class:`~pydantic.BaseModel` with ``extra = "forbid"`` so unrecognised
keys are rejected at construction time. Nodes return ``{"events": [...]}``;
the SSE / invoke layers translate the list into wire envelopes.

Usage pattern inside a node::

    from app.agents.events import as_event_dict

    def emit_node(state: SomeState) -> dict[str, Any]:
        suggestion = as_event_dict(Suggestion(surface="brief", payload={...}))
        citation   = as_event_dict(Citation(refs=[...]))
        return {
            "messages": [...],
            "events": [citation, suggestion],
        }

The :data:`AgentEvent` union and :func:`coerce_event` are convenience
helpers for downstream code that validates incoming dicts.
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel


class Suggestion(BaseModel):
    """A structured suggestion surfaced on the FE as a card or inline block.

    ``surface`` identifies which UI component renders the payload
    (``"brief"`` → board brief drawer, ``"draft"`` → task draft modal, etc.).
    ``payload`` is an opaque dict that the surface-specific renderer unpacks;
    its schema is owned by the corresponding catalog module.
    """

    model_config = {"extra": "forbid"}

    kind: Literal["suggestion"] = "suggestion"
    surface: str
    payload: dict[str, Any]


class Citation(BaseModel):
    """A list of evidence refs that ground the preceding suggestion.

    Each ref has shape ``{source, id, quote}`` as required by the FE
    citation contract (``src/interfaces/agent.d.ts``).
    """

    model_config = {"extra": "forbid"}

    kind: Literal["citation"] = "citation"
    refs: list[dict[str, Any]]


class Usage(BaseModel):
    """Token-usage accounting event.

    Kept for downstream consumers that may still read the ``kind="usage"``
    event from a persisted event list. Catalog agents no longer emit these
    directly; the runtime aggregates token usage from ``AIMessage`` objects
    at end-of-run instead.
    """

    model_config = {"extra": "forbid"}

    kind: Literal["usage"] = "usage"
    tokensIn: int = 0
    tokensOut: int = 0


# Union of all known event types.
AgentEvent = Union[Suggestion, Citation, Usage]


def as_event_dict(model: AgentEvent) -> dict[str, Any]:
    """Serialise an :data:`AgentEvent` model to a plain dict.

    Uses ``model_dump()`` so Pydantic validation runs on construction,
    but the stored value on state is a plain ``dict`` (JSON-serialisable,
    no Pydantic dependency on the checkpointer path).
    """

    return model.model_dump()


def coerce_event(value: Any) -> dict[str, Any]:
    """Best-effort coercion of ``value`` to a validated event dict.

    Accepts either an :data:`AgentEvent` model instance or a plain dict.
    Returns a plain dict. Raises :class:`ValueError` if ``value`` is not
    a recognisable event shape.
    """

    if isinstance(value, (Suggestion, Citation, Usage)):
        return value.model_dump()
    if not isinstance(value, dict):
        raise ValueError(f"Expected dict or AgentEvent, got {type(value)!r}")
    kind = value.get("kind")
    if kind == "suggestion":
        return Suggestion(**value).model_dump()
    if kind == "citation":
        return Citation(**value).model_dump()
    if kind == "usage":
        return Usage(**value).model_dump()
    # Unknown kind — return as-is so forward-compatible consumers don't break.
    return dict(value)


__all__ = [
    "AgentEvent",
    "Citation",
    "Suggestion",
    "Usage",
    "as_event_dict",
    "coerce_event",
]
