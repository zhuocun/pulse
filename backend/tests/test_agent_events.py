"""Tests for ``app.agents.events`` -- typed event models and helpers.

Phase 2 of the agent architecture introduces first-class event state.
These tests exercise all branches of the Pydantic event models
(:class:`~app.agents.events.Suggestion`, :class:`~app.agents.events.Citation`,
:class:`~app.agents.events.Usage`) and the two helpers
(:func:`~app.agents.events.as_event_dict`, :func:`~app.agents.events.coerce_event`).
"""

from __future__ import annotations

import logging

import pytest

from app.agents.events import (
    AgentEvent,
    Citation,
    IBoardBriefPayload,
    IEstimatePayload,
    INudgePayload,
    ISearchPayload,
    ITaskDraftPayload,
    Suggestion,
    Usage,
    as_event_dict,
    coerce_event,
    validate_suggestion_payload,
)


# ---------------------------------------------------------------------------
# Suggestion model
# ---------------------------------------------------------------------------


def test_suggestion_model_defaults_kind_to_suggestion() -> None:
    s = Suggestion(surface="brief", payload={"headline": "all good"})
    assert s.kind == "suggestion"
    assert s.surface == "brief"
    assert s.payload == {"headline": "all good"}


def test_suggestion_model_rejects_extra_keys() -> None:
    with pytest.raises(Exception):
        Suggestion(surface="brief", payload={}, unknown_key="x")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Citation model
# ---------------------------------------------------------------------------


def test_citation_model_defaults_kind_to_citation() -> None:
    c = Citation(refs=[{"source": "task", "id": "t-1", "quote": "Fix login bug"}])
    assert c.kind == "citation"
    assert len(c.refs) == 1


def test_citation_model_rejects_extra_keys() -> None:
    with pytest.raises(Exception):
        Citation(refs=[], extra_field="x")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Usage model
# ---------------------------------------------------------------------------


def test_usage_model_defaults_to_zero_tokens() -> None:
    u = Usage()
    assert u.kind == "usage"
    assert u.tokensIn == 0
    assert u.tokensOut == 0


def test_usage_model_accepts_token_counts() -> None:
    u = Usage(tokensIn=10, tokensOut=5)
    assert u.tokensIn == 10
    assert u.tokensOut == 5


def test_usage_model_rejects_extra_keys() -> None:
    with pytest.raises(Exception):
        Usage(tokensIn=1, bad_key="x")  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# as_event_dict helper
# ---------------------------------------------------------------------------


def test_as_event_dict_suggestion_roundtrip() -> None:
    s = Suggestion(surface="draft", payload={"taskName": "Fix bug"})
    d = as_event_dict(s)
    assert d == {"kind": "suggestion", "surface": "draft", "payload": {"taskName": "Fix bug"}}
    assert isinstance(d, dict)


def test_as_event_dict_citation_roundtrip() -> None:
    c = Citation(refs=[{"source": "task", "id": "t-2", "quote": "Refactor auth"}])
    d = as_event_dict(c)
    assert d["kind"] == "citation"
    assert d["refs"][0]["id"] == "t-2"


def test_as_event_dict_usage_roundtrip() -> None:
    u = Usage(tokensIn=7, tokensOut=3)
    d = as_event_dict(u)
    assert d == {"kind": "usage", "tokensIn": 7, "tokensOut": 3}


# ---------------------------------------------------------------------------
# coerce_event helper
# ---------------------------------------------------------------------------


def test_coerce_event_suggestion_model_instance() -> None:
    s = Suggestion(surface="nudge", payload={"nudge_id": "n1"})
    d = coerce_event(s)
    assert d["kind"] == "suggestion"
    assert d["surface"] == "nudge"


def test_coerce_event_citation_model_instance() -> None:
    c = Citation(refs=[])
    d = coerce_event(c)
    assert d["kind"] == "citation"
    assert d["refs"] == []


def test_coerce_event_usage_model_instance() -> None:
    u = Usage(tokensIn=1, tokensOut=0)
    d = coerce_event(u)
    assert d["kind"] == "usage"
    assert d["tokensIn"] == 1


def test_coerce_event_dict_suggestion() -> None:
    raw = {"kind": "suggestion", "surface": "search", "payload": {"ids": []}}
    d = coerce_event(raw)
    assert d["kind"] == "suggestion"
    assert d["surface"] == "search"


def test_coerce_event_dict_citation() -> None:
    raw = {"kind": "citation", "refs": [{"source": "task", "id": "t-1", "quote": "q"}]}
    d = coerce_event(raw)
    assert d["kind"] == "citation"


def test_coerce_event_dict_usage() -> None:
    raw = {"kind": "usage", "tokensIn": 4, "tokensOut": 2}
    d = coerce_event(raw)
    assert d == {"kind": "usage", "tokensIn": 4, "tokensOut": 2}


def test_coerce_event_unknown_kind_passes_through() -> None:
    """Unknown kind is forwarded as-is for forward compatibility."""
    raw = {"kind": "future_event", "data": "x"}
    d = coerce_event(raw)
    assert d == {"kind": "future_event", "data": "x"}


def test_coerce_event_raises_on_non_dict_non_model() -> None:
    with pytest.raises(ValueError, match="Expected dict or AgentEvent"):
        coerce_event("not a dict")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# AgentEvent union type (structural check)
# ---------------------------------------------------------------------------


def test_agent_event_union_is_exported() -> None:
    """AgentEvent is exported so external validators can use it."""
    assert AgentEvent is not None


# ---------------------------------------------------------------------------
# Per-surface payload schemas
# ---------------------------------------------------------------------------


def test_board_brief_payload_schema_accepts_known_good() -> None:
    payload = {
        "headline": "3 tasks across 2 columns; 1 unowned, 0 large unstarted.",
        "counts": [{"columnId": "c1", "columnName": "Todo", "count": 1}],
        "largestUnstarted": [],
        "unowned": [{"taskId": "t1", "taskName": "Fix crash"}],
        "workload": [],
        "recommendation": "Reassign unowned bugs first.",
        "recommendationDetail": {
            "text": "Reassign unowned bugs first.",
            "strength": "strong",
            "basis": "1 unowned bug(s)",
            "sources": [],
        },
    }
    # Must not raise
    IBoardBriefPayload(**payload)


def test_task_draft_payload_schema_accepts_known_good() -> None:
    payload = {
        "taskName": "Fix SSO",
        "type": "feature",
        "epic": "Auth",
        "storyPoints": 3,
        "note": "Acceptance criteria pending.",
        "columnId": "c1",
        "coordinatorId": "u1",
        "confidence": 0.55,
        "rationale": "Heuristic draft from prompt keywords.",
    }
    ITaskDraftPayload(**payload)


def test_task_draft_breakdown_payload_schema_accepts_items() -> None:
    """``{axis, items}`` breakdown variant must also pass validation."""
    payload = {
        "axis": "frontend",
        "items": [
            {
                "taskName": "Fix SSO (frontend 1)",
                "type": "feature",
                "epic": "Auth",
                "storyPoints": 3,
                "note": "part 1",
                "columnId": "c1",
                "coordinatorId": "u1",
                "confidence": 0.55,
                "rationale": "Slice 1",
            }
        ],
    }
    ITaskDraftPayload(**payload)


def test_estimate_payload_schema_accepts_known_good() -> None:
    payload = {
        "estimate": {
            "storyPoints": 5,
            "confidence": "moderate",
            "rationale": "Derived from prompt.",
        },
        "readiness": {
            "ready": False,
            "issues": [{"field": "taskName", "severity": "error", "message": "Required."}],
            "rationale": "Missing required fields: taskName",
        },
    }
    IEstimatePayload(**payload)


def test_search_payload_schema_accepts_known_good() -> None:
    payload = {
        "ids": ["t-1", "t-2"],
        "rationale": "Ranked by keyword overlap.",
        "matches": [{"id": "t-1", "strength": "strong"}],
    }
    ISearchPayload(**payload)


def test_nudge_payload_schema_accepts_known_good() -> None:
    payload = {
        "nudge_id": "unowned_bug:0",
        "kind": "unowned_bug",
        "project_id": "p1",
        "summary": "Unowned bug",
        "target_ids": ["t1"],
        "severity": "critical",
    }
    INudgePayload(**payload)


# ---------------------------------------------------------------------------
# validate_suggestion_payload behaviour
# ---------------------------------------------------------------------------


def test_validate_suggestion_payload_known_good_brief() -> None:
    """Known-good brief payload passes validation without warnings."""
    evt = {
        "kind": "suggestion",
        "surface": "brief",
        "payload": {
            "headline": "3 tasks",
            "counts": [],
            "largestUnstarted": [],
            "unowned": [],
            "workload": [],
            "recommendation": "ok",
            "recommendationDetail": None,
        },
    }
    result = validate_suggestion_payload(evt, agent="board-brief-agent")
    assert result is evt  # same object returned


def test_validate_suggestion_payload_known_good_nudge() -> None:
    evt = {
        "kind": "suggestion",
        "surface": "nudge",
        "payload": {
            "nudge_id": "stale_task:0",
            "kind": "stale_task",
            "project_id": "p1",
            "summary": "Stale task",
            "target_ids": [],
            "severity": "warn",
        },
    }
    result = validate_suggestion_payload(evt)
    assert result["surface"] == "nudge"


def test_validate_suggestion_payload_bad_payload_logs_and_passes_through(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Extra field in payload triggers a warning + Prometheus counter bump
    but does not mutate or drop the event.

    The counter is the only signal that closes the fail-safe pass-through
    gap; without it a schema drift in production is invisible until the FE
    starts rendering half-cards.
    """
    captured: list[dict[str, str]] = []

    def fake_record(*, agent: str, kind: str, surface: str = "") -> None:
        captured.append({"agent": agent, "kind": kind, "surface": surface})

    monkeypatch.setattr(
        "app.observability.metrics.record_event_validation_failure",
        fake_record,
    )

    evt = {
        "kind": "suggestion",
        "surface": "search",
        "payload": {
            "ids": ["t-1"],
            "rationale": "ok",
            "UNEXPECTED_EXTRA_FIELD": "should trigger warning",
        },
    }
    with caplog.at_level(logging.WARNING, logger="app.agents.events"):
        result = validate_suggestion_payload(evt, agent="search-agent")
    # Event is passed through unchanged
    assert result is evt
    assert result["payload"]["UNEXPECTED_EXTRA_FIELD"] == "should trigger warning"
    # A warning was logged
    assert any("search" in record.message for record in caplog.records)
    assert captured == [
        {"agent": "search-agent", "kind": "suggestion", "surface": "search"}
    ]


def test_validate_suggestion_payload_does_not_mutate_dict() -> None:
    """Validation must never mutate the payload dict."""
    payload = {"ids": ["t-1"], "rationale": "ok"}
    evt = {"kind": "suggestion", "surface": "search", "payload": payload}
    before = dict(payload)
    validate_suggestion_payload(evt)
    assert payload == before


def test_validate_suggestion_payload_unknown_surface_passes_through() -> None:
    """Unknown surfaces are forwarded without validation."""
    evt = {"kind": "suggestion", "surface": "future_surface", "payload": {"x": 1}}
    result = validate_suggestion_payload(evt, agent="some-agent")
    assert result is evt


def test_validate_suggestion_payload_non_suggestion_event_passes_through() -> None:
    """Citation and Usage events bypass validation."""
    citation = {"kind": "citation", "refs": []}
    result = validate_suggestion_payload(citation)
    assert result is citation


def test_validate_suggestion_payload_non_dict_passes_through() -> None:
    """Non-dict values are returned as-is."""
    assert validate_suggestion_payload("not a dict") == "not a dict"  # type: ignore[arg-type]


def test_validate_suggestion_payload_non_dict_payload_passes_through() -> None:
    """A suggestion whose ``payload`` is not a dict bypasses schema validation."""
    evt = {"kind": "suggestion", "surface": "brief", "payload": "not a dict"}
    result = validate_suggestion_payload(evt, agent="board-brief-agent")
    assert result is evt
