"""Tests for ``app.agents.events`` -- typed event models and helpers.

Phase 2 of the agent architecture introduces first-class event state.
These tests exercise all branches of the Pydantic event models
(:class:`~app.agents.events.Suggestion`, :class:`~app.agents.events.Citation`,
:class:`~app.agents.events.Usage`) and the two helpers
(:func:`~app.agents.events.as_event_dict`, :func:`~app.agents.events.coerce_event`).
"""

from __future__ import annotations

import pytest

from app.agents.events import (
    AgentEvent,
    Citation,
    Suggestion,
    Usage,
    as_event_dict,
    coerce_event,
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
