"""Targeted coverage tests for the GA §1 mutation-lifecycle surface.

Pulls the small set of branches that the integration suite does not
already exercise into focused unit / HTTP tests:

* :mod:`app.agents.state` — duplicate-id dedup branch in
  :func:`merge_mutation_applied_ids`.
* :mod:`app.agents.events` — pydantic-failure pass-through in
  :func:`validate_mutation_proposal_event` and the ``mutation_proposal``
  branch in :func:`coerce_event`.
* :mod:`app.agents.catalog.chat` — defensive guards in
  :func:`_mutation_hitl` and :func:`_mutation_finalize` for malformed
  state, already-applied proposals, ``suggest`` autonomy, and FE-tool
  apply-stage errors.
* :mod:`app.routers.agents` — autonomy-merge helper and the
  ``/mutations/record`` and ``/mutations/undo`` endpoints (including the
  404 / 403 mapping for downstream service errors).
"""

from __future__ import annotations

import asyncio
import logging
from http import HTTPStatus
from typing import Any, Optional
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore

from app import security
from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog import chat as chat_module
from app.agents.events import (
    Citation,
    MutationDiffWire,
    MutationProposalEvent,
    MutationProposalWire,
    TaskUpdateWire,
    coerce_event,
    validate_mutation_proposal_event,
)
from app.agents.registry import AgentRegistry
from app.agents.runtime import AgentRuntime
from app.agents.state import BaseAgentState, merge_mutation_applied_ids
from app.routers import agents as agents_router
from app.security import create_token


# ---------------------------------------------------------------------------
# app.agents.state.merge_mutation_applied_ids — dedup branch (line 45)
# ---------------------------------------------------------------------------


def test_merge_mutation_applied_ids_dedups_repeats() -> None:
    """A proposal id seen on both sides is recorded once, order preserved."""

    assert merge_mutation_applied_ids(["a", "b"], ["b", "c", "a"]) == ["a", "b", "c"]
    assert merge_mutation_applied_ids(None, None) == []
    # Single side, no duplicates → identity.
    assert merge_mutation_applied_ids(["x"], None) == ["x"]


# ---------------------------------------------------------------------------
# app.agents.events — pass-through validators (lines 270–280, 359)
# ---------------------------------------------------------------------------


def _proposal_dict() -> dict[str, Any]:
    return {
        "kind": "mutation_proposal",
        "proposal": {
            "proposal_id": "pr-1",
            "description": "Rename for CI",
            "diff": {
                "task_updates": [
                    {
                        "task_id": "000000000000000000000001",
                        "field": "taskName",
                        "from": "Before",
                        "to": "After",
                    }
                ]
            },
            "risk": "low",
            "undoable": True,
        },
    }


def test_validate_mutation_proposal_event_returns_non_mutation_unchanged() -> None:
    """Non-mutation dicts and non-dicts must be returned without validation."""

    other = {"kind": "suggestion", "surface": "brief", "payload": {}}
    assert validate_mutation_proposal_event(other) is other
    assert validate_mutation_proposal_event("not-a-dict") == "not-a-dict"  # type: ignore[arg-type]


def test_validate_mutation_proposal_event_logs_and_passes_through_invalid(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pydantic failure → warning logged, original dict returned unchanged,
    and the validation-failure Prometheus counter is bumped so an operator
    can alert on schema drift even though the bad payload still streams.
    """

    captured: list[dict[str, str]] = []

    def fake_record(*, agent: str, kind: str, surface: str = "") -> None:
        captured.append({"agent": agent, "kind": kind, "surface": surface})

    monkeypatch.setattr(
        "app.observability.metrics.record_event_validation_failure",
        fake_record,
    )

    bad = {"kind": "mutation_proposal", "proposal": {"proposal_id": "x"}}
    with caplog.at_level(logging.WARNING):
        result = validate_mutation_proposal_event(bad, agent="chat-agent")
    assert result is bad
    assert any(
        "mutation_proposal validation failed" in rec.message
        for rec in caplog.records
    )
    assert captured == [
        {"agent": "chat-agent", "kind": "mutation_proposal", "surface": ""}
    ]


def test_validate_mutation_proposal_event_accepts_valid_payload() -> None:
    payload = _proposal_dict()
    assert validate_mutation_proposal_event(payload) is payload


def test_coerce_event_round_trips_mutation_proposal_dict() -> None:
    out = coerce_event(_proposal_dict())
    assert out["kind"] == "mutation_proposal"
    assert out["proposal"]["proposal_id"] == "pr-1"


def test_coerce_event_serialises_mutation_proposal_model() -> None:
    evt = MutationProposalEvent(
        proposal=MutationProposalWire(
            proposal_id="pr-2",
            description="d",
            diff=MutationDiffWire(
                task_updates=[
                    TaskUpdateWire(
                        task_id="000000000000000000000002",
                        field="taskName",
                        **{"from": "x"},
                        to="y",
                    )
                ]
            ),
            risk="low",
        )
    )
    out = coerce_event(evt)
    assert out["kind"] == "mutation_proposal"
    assert out["proposal"]["proposal_id"] == "pr-2"


def test_coerce_event_handles_other_event_models() -> None:
    # Hits the ``isinstance(value, (Suggestion, Citation, Usage, ...))`` branch
    # for a non-MutationProposalEvent variant so the union is fully exercised.
    out = coerce_event(Citation(refs=[{"source": "task", "id": "t1", "quote": "q"}]))
    assert out["kind"] == "citation"


# ---------------------------------------------------------------------------
# app.agents.catalog.chat — defensive guards (lines 116, 119, 137, 141, 157, 183)
# ---------------------------------------------------------------------------


def test_mutation_hitl_returns_empty_when_no_pending_proposal() -> None:
    """If ``mutation_pending`` is missing the node short-circuits to ``{}``."""

    assert chat_module._mutation_hitl({}) == {}


def test_mutation_hitl_drops_loudly_for_blank_proposal_id() -> None:
    """A proposal whose id is blank now aborts with a user-visible message.

    Pre-hardening this silently returned ``{}`` and the empty string ended up
    in ``mutation_applied_ids`` on the apply side, poisoning the idempotency
    guard for every later proposal in the same thread.
    """

    state = {"mutation_pending": {"proposal_id": "   "}}
    out = chat_module._mutation_hitl(state)
    assert out["mutation_pending"] is None
    assert out["mutation_decision"] is None
    assert "missing id" in out["messages"][0].content


def test_mutation_finalize_returns_empty_when_no_pending_proposal() -> None:
    assert chat_module._mutation_finalize({}) == {}


def test_mutation_finalize_skips_when_already_applied() -> None:
    """Replay guard: a proposal whose id is in ``mutation_applied_ids`` is a no-op."""

    state = {
        "mutation_pending": {"proposal_id": "pr-dup"},
        "mutation_decision": {"accepted": True},
        "mutation_applied_ids": ["pr-dup"],
    }
    out = chat_module._mutation_finalize(state)
    assert out["mutation_pending"] is None
    assert out["mutation_decision"] is None
    assert out["messages"][0].content == "That proposal was already applied."


def test_mutation_finalize_blocks_apply_under_suggest_autonomy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``autonomy_level=suggest`` short-circuits before the apply interrupt fires."""

    class _Rt:
        context = {"autonomy_level": "suggest", "project_id": "p1"}

    monkeypatch.setattr(chat_module, "get_runtime", lambda _ctx: _Rt())

    state = {
        "mutation_pending": {"proposal_id": "pr-1", "diff": {}},
        "mutation_decision": {"accepted": True},
    }
    out = chat_module._mutation_finalize(state)
    assert out["mutation_pending"] is None
    assert "Suggestions-only" in out["messages"][0].content


def test_mutation_finalize_surfaces_apply_error_from_fe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the FE apply tool returns ``{"error": ...}`` the node reports it."""

    class _Rt:
        context = {"autonomy_level": "plan", "project_id": "p1"}

    monkeypatch.setattr(chat_module, "get_runtime", lambda _ctx: _Rt())
    monkeypatch.setattr(
        chat_module,
        "interrupt",
        lambda _payload: {"error": "task_not_found"},
    )

    state = {
        "mutation_pending": {"proposal_id": "pr-1", "diff": {}},
        "mutation_decision": {"accepted": True},
    }
    out = chat_module._mutation_finalize(state)
    assert "Could not apply: task_not_found" in out["messages"][0].content
    assert out["mutation_pending"] is None
    assert "mutation_applied_ids" not in out


# ---------------------------------------------------------------------------
# app.routers.agents._merge_autonomy_into_context (lines 665–667)
# ---------------------------------------------------------------------------


def test_merge_autonomy_into_context_returns_context_when_autonomy_missing() -> None:
    ctx = {"project_id": "p1"}
    assert agents_router._merge_autonomy_into_context(ctx, None) is ctx


def test_merge_autonomy_into_context_merges_into_dict() -> None:
    merged = agents_router._merge_autonomy_into_context(
        {"project_id": "p1"}, "plan"
    )
    assert merged == {"project_id": "p1", "autonomy_level": "plan"}


def test_merge_autonomy_into_context_passes_non_dict_through() -> None:
    sentinel = object()
    assert agents_router._merge_autonomy_into_context(sentinel, "plan") is sentinel


# ---------------------------------------------------------------------------
# app.routers.agents — /mutations/record + /mutations/undo (lines 678–713)
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("agent-user")
    return {"Authorization": f"Bearer {token}"}


def test_mutations_record_returns_journal_status(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    """Endpoint mirrors :func:`record_apply_journal` ``(created, status)``."""

    with patch.object(
        agents_router.agent_mutation_journal,
        "record_apply_journal",
        return_value=(True, "recorded"),
    ) as call:
        resp = client.post(
            "/api/v1/agents/mutations/record",
            json={
                "proposal_id": "pr-1",
                "project_id": "p-record",
                "undo": {"task_updates": []},
            },
            headers=auth_headers,
        )
    assert resp.status_code == HTTPStatus.OK
    assert resp.json() == {"ok": True, "created": True, "status": "recorded"}
    kwargs = call.call_args.kwargs
    assert kwargs["user_id"] == "agent-user"
    assert kwargs["project_id"] == "p-record"
    assert kwargs["proposal_id"] == "pr-1"
    assert kwargs["undo_diff"] == {"task_updates": []}


def test_mutations_undo_returns_ok_status(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with patch.object(
        agents_router.agent_mutation_journal,
        "undo_mutation",
        return_value=(True, "undone"),
    ):
        resp = client.post(
            "/api/v1/agents/mutations/undo",
            json={"proposal_id": "pr-1", "project_id": "p-record"},
            headers=auth_headers,
        )
    assert resp.status_code == HTTPStatus.OK
    assert resp.json() == {"ok": True, "status": "undone"}


@pytest.mark.parametrize("status_txt", ["not_found", "project_mismatch"])
def test_mutations_undo_maps_missing_proposal_to_404(
    client: TestClient,
    auth_headers: dict[str, str],
    status_txt: str,
) -> None:
    with patch.object(
        agents_router.agent_mutation_journal,
        "undo_mutation",
        return_value=(False, status_txt),
    ):
        resp = client.post(
            "/api/v1/agents/mutations/undo",
            json={"proposal_id": "pr-x", "project_id": "p-record"},
            headers=auth_headers,
        )
    assert resp.status_code == HTTPStatus.NOT_FOUND
    body = resp.json()
    assert body["error"]["code"] == "mutation_not_found"
    assert body["error"]["message"] == status_txt


# ---------------------------------------------------------------------------
# app.agents.runtime — mutation_proposal validation in invoke + stream paths
# (lines 859 + 936)
# ---------------------------------------------------------------------------


class _ProposalEmittingAgent(BaseAgent):
    """Tiny agent whose single node writes a ``mutation_proposal`` event."""

    metadata = AgentMetadata(name="proposal-emitter")

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        def emit(_state: BaseAgentState) -> dict[str, Any]:
            return {"events": [_proposal_dict()]}

        graph = StateGraph(BaseAgentState)
        graph.add_node("emit", emit)
        graph.add_edge(START, "emit")
        graph.add_edge("emit", END)
        return graph.compile(checkpointer=checkpointer, store=store)


def test_runtime_arun_with_events_validates_mutation_proposal() -> None:
    registry = AgentRegistry()
    registry.register(_ProposalEmittingAgent())
    runtime = AgentRuntime(registry=registry)

    _final, events = asyncio.run(
        runtime.arun_with_events("proposal-emitter", {"messages": []})
    )
    assert any(
        isinstance(evt, dict) and evt.get("kind") == "mutation_proposal"
        for evt in events
    )


def test_runtime_astream_validates_mutation_proposal() -> None:
    registry = AgentRegistry()
    registry.register(_ProposalEmittingAgent())
    runtime = AgentRuntime(registry=registry)

    async def collect() -> list[Any]:
        out: list[Any] = []
        async for mode, payload in runtime.astream(
            "proposal-emitter",
            {"messages": []},
        ):
            if mode == "custom":
                out.append(payload)
        return out

    custom_events = asyncio.run(collect())
    assert any(
        isinstance(evt, dict) and evt.get("kind") == "mutation_proposal"
        for evt in custom_events
    )


def test_mutations_undo_maps_forbidden_to_403(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    with patch.object(
        agents_router.agent_mutation_journal,
        "undo_mutation",
        return_value=(False, "forbidden"),
    ):
        resp = client.post(
            "/api/v1/agents/mutations/undo",
            json={"proposal_id": "pr-x", "project_id": "p-record"},
            headers=auth_headers,
        )
    assert resp.status_code == HTTPStatus.FORBIDDEN
    body = resp.json()
    assert body["error"]["code"] == "forbidden"
