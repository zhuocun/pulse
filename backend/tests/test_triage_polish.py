"""Tests for the ``polish_triage`` helper in ``triage-agent``.

Polish-helper tests live in this module rather than in
``tests/test_agents_catalog.py`` so they can focus on the LLM-polish path
in isolation. The same ``structured_model`` / ``is_not_stub`` scaffold
used by ``test_search_agent.py`` and ``test_ai_v1_router.py`` is reused
here so the mocking idiom stays consistent across the catalog.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.triage import NudgePolish, TriageAgent, TriagePolish, polish_triage
from app.agents.llm import make_stub_chat_model
from tests.conftest import structured_model


# ---------------------------------------------------------------------------
# Helpers shared with emit-shape test
# ---------------------------------------------------------------------------


def _persistence() -> tuple[InMemorySaver, InMemoryStore]:
    return InMemorySaver(), InMemoryStore()


def _drive(
    graph: Any,
    inputs: dict[str, Any],
    resumes: list[Any],
    thread_id: str,
) -> dict[str, Any]:
    cfg = {"configurable": {"thread_id": thread_id}}

    async def run() -> dict[str, Any]:
        result = await graph.ainvoke(inputs, config=cfg)
        for resume in resumes:
            result = await graph.ainvoke(Command(resume=resume), config=cfg)
        return result

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_BOARD_SNAPSHOT: dict = {
    "columns": [
        {"id": "col-1", "name": "In Progress", "wip_limit": 5},
    ],
    "tasks": [
        {"id": "t-1", "column_id": "col-1", "status": "in_progress"},
    ],
}

_DETERMINISTIC_NUDGES = [
    {
        "type": "wip_overflow",
        "summary": "WIP overflow",
        "severity": "warn",
        "details": {"column_id": "col-1", "count": 8, "limit": 5},
        "actions": [{"label": "Acknowledge"}, {"label": "Snooze"}],
    },
    {
        "type": "stale_task",
        "summary": "Stale task",
        "severity": "info",
        "details": {"task_id": "t-42", "days_stale": 14},
        "actions": [{"label": "Acknowledge"}, {"label": "Snooze"}],
    },
]


# ---------------------------------------------------------------------------
# Stub-model path: deterministic result, zero tokens
# ---------------------------------------------------------------------------


def test_polish_triage_returns_deterministic_on_stub() -> None:
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(make_stub_chat_model(), _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT)
    )
    assert result == _DETERMINISTIC_NUDGES
    assert (tokens_in, tokens_out) == (0, 0)


def test_polish_triage_returns_deterministic_on_stub_empty_nudges() -> None:
    """Stub model with empty nudge list also returns immediately."""
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(make_stub_chat_model(), [], _BOARD_SNAPSHOT)
    )
    assert result == []
    assert (tokens_in, tokens_out) == (0, 0)


# ---------------------------------------------------------------------------
# Real-model path: polished summary merged back by nudge_id
# ---------------------------------------------------------------------------


def test_polish_triage_merges_polished_summary() -> None:
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    )
    parsed = TriagePolish(
        nudges=[
            NudgePolish(
                nudge_id="wip_overflow:0",
                summary="WIP overflow in 'In Progress' (8/5) — move 3 tasks out",
            ),
            NudgePolish(
                nudge_id="stale_task:1",
                summary="Task t-42 stale for 14 days — reassign or close",
            ),
        ]
    )
    model = structured_model(parsed=parsed, raw_message=raw)
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT)
    )

    assert result[0]["summary"] == "WIP overflow in 'In Progress' (8/5) — move 3 tasks out"
    assert result[1]["summary"] == "Task t-42 stale for 14 days — reassign or close"
    # Non-polished fields are preserved unchanged.
    assert result[0]["type"] == "wip_overflow"
    assert result[1]["details"] == {"task_id": "t-42", "days_stale": 14}
    assert (tokens_in, tokens_out) == (10, 5)


# ---------------------------------------------------------------------------
# Fallback: provider exception → deterministic, zero tokens
# ---------------------------------------------------------------------------


def test_polish_triage_falls_back_on_provider_exception() -> None:
    model = structured_model(raise_on_call=RuntimeError("provider down"))
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT)
    )
    assert result == _DETERMINISTIC_NUDGES
    assert (tokens_in, tokens_out) == (0, 0)


# ---------------------------------------------------------------------------
# Fallback: parse error → deterministic, tokens still reported
# ---------------------------------------------------------------------------


def test_polish_triage_falls_back_on_parsing_error() -> None:
    raw = AIMessage(
        content="bad",
        usage_metadata={"input_tokens": 3, "output_tokens": 0, "total_tokens": 3},
    )
    model = structured_model(
        parsing_error=ValueError("bad json"), parsed=None, raw_message=raw
    )
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT)
    )
    assert result == _DETERMINISTIC_NUDGES
    # Tokens are still reported so a runaway provider can be billed.
    assert (tokens_in, tokens_out) == (3, 0)


# ---------------------------------------------------------------------------
# Fallback: non-TriagePolish parsed type → deterministic
# ---------------------------------------------------------------------------


def test_polish_triage_falls_back_when_parsed_is_not_schema() -> None:
    """A model that returns a raw dict (not the typed Pydantic class) falls back."""
    model = structured_model(
        parsed={"nudges": [{"nudge_id": "wip_overflow:0", "summary": "bad type"}]}
    )
    result, *_ = asyncio.run(polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT))
    assert result == _DETERMINISTIC_NUDGES


# ---------------------------------------------------------------------------
# Blank polished summary → preserve deterministic copy
# ---------------------------------------------------------------------------


def test_polish_triage_preserves_deterministic_when_summary_blank() -> None:
    parsed = TriagePolish(
        nudges=[
            NudgePolish(nudge_id="wip_overflow:0", summary="   \n  "),
            NudgePolish(nudge_id="stale_task:1", summary=""),
        ]
    )
    model = structured_model(parsed=parsed)
    result, *_ = asyncio.run(polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT))
    assert result[0]["summary"] == "WIP overflow"
    assert result[1]["summary"] == "Stale task"


# ---------------------------------------------------------------------------
# Unknown nudge_id from model → ignored, no new nudges injected
# ---------------------------------------------------------------------------


def test_polish_triage_ignores_unknown_nudge_id() -> None:
    """An id not present in the deterministic list must not inject a new nudge."""
    raw = AIMessage(
        content="x",
        usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    )
    parsed = TriagePolish(
        nudges=[
            # Valid id — should be applied.
            NudgePolish(
                nudge_id="wip_overflow:0",
                summary="WIP overflow in 'In Progress' (8/5)",
            ),
            # Hallucinated id — must be silently dropped.
            NudgePolish(
                nudge_id="injected_nudge:99",
                summary="Injected by model",
            ),
        ]
    )
    model = structured_model(parsed=parsed, raw_message=raw)
    result, tokens_in, tokens_out = asyncio.run(
        polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT)
    )
    # The list length must not grow.
    assert len(result) == len(_DETERMINISTIC_NUDGES)
    # Valid nudge was polished.
    assert result[0]["summary"] == "WIP overflow in 'In Progress' (8/5)"
    # Second nudge keeps its deterministic summary (no polish provided for it).
    assert result[1]["summary"] == "Stale task"
    assert (tokens_in, tokens_out) == (1, 1)


# ---------------------------------------------------------------------------
# Summary cap at 120 chars
# ---------------------------------------------------------------------------


def test_polish_triage_caps_summary_at_120_chars() -> None:
    long_summary = "A" * 200
    parsed = TriagePolish(
        nudges=[
            NudgePolish(nudge_id="wip_overflow:0", summary=long_summary[:120]),
        ]
    )
    model = structured_model(parsed=parsed)
    result, *_ = asyncio.run(polish_triage(model, _DETERMINISTIC_NUDGES, _BOARD_SNAPSHOT))
    assert len(result[0]["summary"]) <= 120


# ---------------------------------------------------------------------------
# Empty nudge list with real (non-stub) model → short-circuit, zero tokens
# ---------------------------------------------------------------------------


def test_polish_triage_empty_nudges_with_real_model_returns_early() -> None:
    """Empty nudge list short-circuits before calling the model."""
    parsed = TriagePolish(nudges=[NudgePolish(nudge_id="wip_overflow:0", summary="x")])
    model = structured_model(parsed=parsed)
    result, tokens_in, tokens_out = asyncio.run(polish_triage(model, [], _BOARD_SNAPSHOT))
    assert result == []
    assert (tokens_in, tokens_out) == (0, 0)


# ---------------------------------------------------------------------------
# Emit-shape test: generate_nudges must emit {kind: "suggestion", surface: "nudge", payload: ...}
# ---------------------------------------------------------------------------


def test_generate_nudges_appends_polish_usage_message_for_budget() -> None:
    """The polish AIMessage with usage_metadata must reach state['messages'].

    Budget reconciliation aggregates token usage from messages at end-of-run
    (Phase 2). Without the raw AIMessage in messages, triage's polish tokens
    would be silently dropped from OTel + Prometheus + project budget.
    """
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 7, "output_tokens": 4, "total_tokens": 11},
    )
    parsed = TriagePolish(
        nudges=[NudgePolish(nudge_id="unowned_bug:0", summary="Polished")]
    )
    agent = TriageAgent()
    agent.set_chat_model(structured_model(parsed=parsed, raw_message=raw))
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    snapshot = {
        "columns": [{"id": "c1", "name": "Todo", "wip_limit": 5}],
        "tasks": [{"id": "bug-1", "column_id": "c1", "type": "bug"}],
    }
    final = _drive(
        graph,
        {"project_id": "p-1"},
        [snapshot],
        thread_id="nudge-budget-1",
    )

    messages = final.get("messages") or []
    polish_msgs = [
        m
        for m in messages
        if isinstance(m, AIMessage)
        and (getattr(m, "usage_metadata", None) or {}).get("total_tokens")
    ]
    assert polish_msgs, "Expected polish AIMessage with usage_metadata in state['messages']"
    usage = polish_msgs[0].usage_metadata
    assert usage["input_tokens"] == 7
    assert usage["output_tokens"] == 4


def test_generate_nudges_emits_suggestion_nudge_shape() -> None:
    """The ``generate_nudges`` node must populate ``state['events']`` with nudge suggestions.

    Phase 2: events are first-class state. The node returns
    ``{"events": [{"kind": "suggestion", "surface": "nudge", "payload": ...}, ...]}``
    which the ``add_events`` reducer accumulates into the final state.

    Previously this test patched ``get_stream_writer`` to intercept
    ``emit_custom`` calls; now it inspects ``final_state["events"]`` directly.
    """
    agent = TriageAgent()
    checkpointer, store = _persistence()
    graph = agent.build(checkpointer=checkpointer, store=store)

    # A snapshot that triggers at least one nudge (unowned bug).
    snapshot = {
        "columns": [{"id": "c1", "name": "Todo", "wip_limit": 5}],
        "tasks": [{"id": "bug-1", "column_id": "c1", "type": "bug"}],
    }

    final = _drive(
        graph,
        {"project_id": "p-emit-test"},
        [snapshot],
        thread_id="nudge-emit-shape-1",
    )

    events = final.get("events") or []
    suggestion_events = [
        e for e in events if isinstance(e, dict) and e.get("kind") == "suggestion"
    ]
    assert suggestion_events, "Expected at least one suggestion event in state['events'] from generate_nudges"

    for evt in suggestion_events:
        assert evt.get("surface") == "nudge", (
            f"Expected surface='nudge', got {evt.get('surface')!r}"
        )
        assert "payload" in evt, "Expected 'payload' key in suggestion event"
        payload = evt["payload"]
        # Verify inner TriageNudge shape.
        assert "nudge_id" in payload
        assert "kind" in payload
        assert "project_id" in payload
        assert "summary" in payload
        assert "target_ids" in payload
        assert "severity" in payload


def test_load_profile_hint_reads_dict_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    from app.agents.catalog.triage import load_profile_hint_node

    store = MagicMock()
    item = MagicMock()
    item.value = {"drift_severity": "warn"}
    store.get.return_value = item
    rt = MagicMock()
    rt.store = store
    rt.context = {"project_id": "p1"}
    monkeypatch.setattr(
        "app.agents.catalog.triage.get_runtime",
        lambda _schema: rt,
    )
    assert load_profile_hint_node({}) == {"profile_hint": {"drift_severity": "warn"}}


def test_load_profile_hint_skips_non_dict_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    from app.agents.catalog.triage import load_profile_hint_node

    store = MagicMock()
    item = MagicMock()
    item.value = "nope"
    store.get.return_value = item
    rt = MagicMock()
    rt.store = store
    rt.context = {"project_id": "p1"}
    monkeypatch.setattr(
        "app.agents.catalog.triage.get_runtime",
        lambda _schema: rt,
    )
    assert load_profile_hint_node({}) == {}


def test_build_triage_prompt_includes_profile_hint() -> None:
    from app.agents.catalog.triage import _build_triage_prompt

    state = {
        "_nudges": [{"type": "triage", "summary": "S", "details": {}}],
        "_snapshot": {"columns": [], "tasks": []},
        "_profile_hint": {"severity": "high"},
    }
    assert "Prior brief drift profile" in _build_triage_prompt(state)


def test_polish_triage_passes_profile_hint_to_polish_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents.catalog import triage as triage_mod

    captured: dict[str, Any] = {}

    async def fake_run(
        state: dict[str, Any],
        model: Any,
    ) -> tuple[dict[str, Any], int, int]:
        captured.clear()
        captured.update(state)
        return {"_result": []}, 0, 0

    monkeypatch.setattr(triage_mod._triage_step, "run", fake_run)

    async def _go() -> None:
        await triage_mod._polish_triage(
            make_stub_chat_model(),
            [{"type": "triage", "summary": "x", "details": {}}],
            {"columns": [], "tasks": []},
            profile_hint={"k": "v"},
        )

    asyncio.run(_go())
    assert captured.get("_profile_hint") == {"k": "v"}
