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

Per-surface payload schemas (:class:`IBoardBriefPayload`,
:class:`ITaskDraftPayload`, :class:`IEstimatePayload`,
:class:`ISearchPayload`, :class:`INudgePayload`) lock the FE wire shape
at the SSE emit boundary. :func:`validate_suggestion_payload` dispatches
on ``surface`` and validates the payload dict against the matching schema.
On validation failure it **passes the event through unchanged** with a
warning log so a schema bug never breaks a streaming response in
production; CI catches drift via the transcript tests.
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Per-surface payload schemas
# ---------------------------------------------------------------------------


class IBoardBriefPayload(BaseModel):
    """FE wire schema for ``surface="brief"`` suggestions.

    Mirrors the ``IBoardBrief + recommendationDetail`` shape emitted by
    ``board_brief.emit_citations``.  Fields intentionally accept ``None``
    so the schema is liberal (existing behaviour preserved).
    """

    model_config = ConfigDict(extra="forbid")

    headline: Optional[str] = None
    counts: Optional[list] = None
    largestUnstarted: Optional[list] = None
    unowned: Optional[list] = None
    workload: Optional[list] = None
    recommendation: Optional[str] = None
    recommendationDetail: Optional[dict] = None


class ITaskDraftPayload(BaseModel):
    """FE wire schema for ``surface="draft"`` and ``surface="breakdown"`` suggestions.

    Covers both the single-card draft shape and the ``{axis, items}``
    breakdown variant (``axis`` / ``items`` are optional to accommodate
    the single-card case).  Fields accept ``None`` to be liberal.
    """

    model_config = ConfigDict(extra="forbid")

    # Single-card fields (all optional so breakdown payloads also pass).
    taskName: Optional[str] = None
    type: Optional[str] = None
    epic: Optional[str] = None
    storyPoints: Optional[Any] = None
    note: Optional[str] = None
    columnId: Optional[str] = None
    coordinatorId: Optional[str] = None
    confidence: Optional[Any] = None
    rationale: Optional[str] = None
    # Breakdown variant fields.
    axis: Optional[str] = None
    items: Optional[list] = None


class IEstimatePayload(BaseModel):
    """FE wire schema for ``surface="estimate"`` suggestions.

    Bundles ``{estimate, readiness}`` as emitted by ``task_estimation.emit_citations``.
    ``estimate_v1`` and ``readiness_v1`` surfaces share the same top-level structure
    but carry only one sub-object; handled by optional fields.
    """

    model_config = ConfigDict(extra="forbid")

    estimate: Optional[dict] = None
    readiness: Optional[dict] = None
    # v1-shim pass-through fields (estimate_v1 / readiness_v1 surface payloads
    # are flat dicts, not nested — validated by the catch-all pass-through).
    storyPoints: Optional[Any] = None
    confidence: Optional[Any] = None
    rationale: Optional[str] = None
    similar: Optional[list] = None
    ready: Optional[bool] = None
    issues: Optional[list] = None


class ISearchPayload(BaseModel):
    """FE wire schema for ``surface="search"`` suggestions.

    Mirrors the ``SearchRanking``-derived dict emitted by ``search.emit``.
    ``matches`` and ``expandedTerms`` are optional (not present in all paths).
    """

    model_config = ConfigDict(extra="forbid")

    ids: Optional[list] = None
    rationale: Optional[str] = None
    matches: Optional[list] = None
    expandedTerms: Optional[list] = None


class INudgePayload(BaseModel):
    """FE wire schema for ``surface="nudge"`` suggestions.

    Mirrors the ``fe_nudge`` dict emitted by ``triage.generate_nudges``.
    """

    model_config = ConfigDict(extra="forbid")

    nudge_id: Optional[str] = None
    kind: Optional[str] = None
    project_id: Optional[str] = None
    summary: Optional[str] = None
    target_ids: Optional[list] = None
    severity: Optional[str] = None


class TaskUpdateWire(BaseModel):
    """Board task row diff — mirrors ``MutationProposal`` FE typing."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    task_id: str
    field: str
    from_: Optional[Any] = Field(default=None, alias="from")
    to: Optional[Any] = None


class ColumnUpdateWire(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    column_id: str
    field: str
    from_: Optional[Any] = Field(default=None, alias="from")
    to: Optional[Any] = None


class BulkApplyWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: str
    targets: list[str]
    payload: dict[str, Any]


class MutationDiffWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_updates: Optional[list[TaskUpdateWire]] = None
    column_updates: Optional[list[ColumnUpdateWire]] = None
    bulk_apply: Optional[list[BulkApplyWire]] = None


class MutationProposalWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal_id: str
    description: str
    diff: MutationDiffWire
    risk: Literal["low", "med", "high"]
    undoable: Literal[True] = True


class MutationProposalEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["mutation_proposal"] = "mutation_proposal"
    proposal: MutationProposalWire


# Mapping from ``surface`` value to the corresponding payload schema class.
_SURFACE_SCHEMAS: dict[str, type[BaseModel]] = {
    "brief": IBoardBriefPayload,
    "draft": ITaskDraftPayload,
    "breakdown": ITaskDraftPayload,
    "estimate": IEstimatePayload,
    "estimate_v1": IEstimatePayload,
    "readiness_v1": IEstimatePayload,
    "search": ISearchPayload,
    "nudge": INudgePayload,
}


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
AgentEvent = Union[Suggestion, Citation, Usage, MutationProposalEvent]


def validate_mutation_proposal_event(
    evt: dict[str, Any],
    *,
    agent: str = "<unknown>",
) -> dict[str, Any]:
    """Validate ``kind="mutation_proposal"`` against the wire schema.

    Pass-through with warning on failure (same policy as suggestions).
    A Prometheus counter is bumped on every failure so operators can
    alert on drift even though the bad payload still streams through.
    """

    if not isinstance(evt, dict) or evt.get("kind") != "mutation_proposal":
        return evt
    try:
        MutationProposalEvent(**evt)
    except ValidationError as exc:
        logger.warning(
            "mutation_proposal validation failed for agent=%r: %s",
            agent,
            exc,
        )
        # Local import: app.observability imports from this package
        # tree transitively (via app.agents.instrumentation), so
        # top-level import would cycle.
        from app.observability.metrics import record_event_validation_failure

        record_event_validation_failure(agent=agent, kind="mutation_proposal")
    return evt


def validate_suggestion_payload(
    suggestion: "dict[str, Any]",
    *,
    agent: str = "<unknown>",
) -> "dict[str, Any]":
    """Validate the payload of a suggestion event against its surface schema.

    Dispatches on ``suggestion["surface"]`` and runs the matching Pydantic
    schema from :data:`_SURFACE_SCHEMAS` against ``suggestion["payload"]``.

    **Failure behaviour: pass-through with a warning.**
    On :class:`~pydantic.ValidationError` this function logs a warning
    containing ``agent``, ``surface``, and the validation errors, then
    returns the original ``suggestion`` dict **unchanged** — so a schema
    bug never breaks a streaming response in production. CI catches drift
    via the golden transcript tests which assert on top-level payload keys.

    ``suggestion`` must be a plain dict (as stored on ``state["events"]``)
    with at least ``kind``, ``surface``, and ``payload`` keys. Non-suggestion
    events (``kind != "suggestion"``) are returned as-is without validation.
    """
    if not isinstance(suggestion, dict):
        return suggestion
    if suggestion.get("kind") != "suggestion":
        return suggestion
    surface = suggestion.get("surface", "")
    payload = suggestion.get("payload")
    if not isinstance(payload, dict):
        return suggestion
    schema_cls = _SURFACE_SCHEMAS.get(surface)
    if schema_cls is None:
        # Unknown surface — forward as-is so future surfaces are not blocked.
        return suggestion
    try:
        schema_cls(**payload)
    except ValidationError as exc:
        logger.warning(
            "Suggestion payload validation failed for agent=%r surface=%r: %s",
            agent,
            surface,
            exc,
        )
        from app.observability.metrics import record_event_validation_failure

        record_event_validation_failure(
            agent=agent, kind="suggestion", surface=surface
        )
    return suggestion


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

    if isinstance(value, (Suggestion, Citation, Usage, MutationProposalEvent)):
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
    if kind == "mutation_proposal":
        return MutationProposalEvent(**value).model_dump()
    # Unknown kind — return as-is so forward-compatible consumers don't break.
    return dict(value)


__all__ = [
    "AgentEvent",
    "Citation",
    "IBoardBriefPayload",
    "IEstimatePayload",
    "INudgePayload",
    "ISearchPayload",
    "ITaskDraftPayload",
    "MutationDiffWire",
    "MutationProposalEvent",
    "MutationProposalWire",
    "Suggestion",
    "TaskUpdateWire",
    "Usage",
    "as_event_dict",
    "coerce_event",
    "validate_mutation_proposal_event",
    "validate_suggestion_payload",
]
