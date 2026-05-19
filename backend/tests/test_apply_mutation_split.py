"""Wire-contract tests for the split mutation handshake.

The single-stage fe.applyMutation tool is an anti-pattern (the model can
be coaxed to skip the approval stage via the ``stage`` argument).
:mod:`app.tools.fe_tool_names` now exposes the split pair:

* ``fe.requestMutationApproval`` -- triggers HITL pause
* ``fe.applyApprovedMutation`` -- redeems an approval_id

Plus the legacy ``fe.applyMutation`` constant retained as deprecated.
These tests pin the constants, the schema shapes, and the chat-agent
interrupt payloads so the FE wire contract is stable.
"""

from __future__ import annotations

import asyncio

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from app.agents.catalog.chat import ChatAgent
from app.agents.llm import make_stub_chat_model
from app.tools.fe_tool_names import (
    ALL_FE_TOOL_NAMES,
    FE_APPLY_APPROVED_MUTATION,
    FE_APPLY_MUTATION,
    FE_REQUEST_MUTATION_APPROVAL,
)
from app.tools.fe_tool_schemas import FE_TOOL_SCHEMAS, interrupt_payload


def test_constants_exist_with_canonical_wire_names() -> None:
    assert FE_REQUEST_MUTATION_APPROVAL == "fe.requestMutationApproval"
    assert FE_APPLY_APPROVED_MUTATION == "fe.applyApprovedMutation"


def test_legacy_apply_mutation_constant_retained() -> None:
    """Old clients must still resolve the legacy name (deprecated)."""
    assert FE_APPLY_MUTATION == "fe.applyMutation"
    assert FE_APPLY_MUTATION in ALL_FE_TOOL_NAMES


def test_both_split_tools_registered_in_schema() -> None:
    assert FE_REQUEST_MUTATION_APPROVAL in FE_TOOL_SCHEMAS
    assert FE_APPLY_APPROVED_MUTATION in FE_TOOL_SCHEMAS


def test_request_approval_schema_shape() -> None:
    schema = FE_TOOL_SCHEMAS[FE_REQUEST_MUTATION_APPROVAL]
    # Result must give the model an approval_id + status to redeem.
    result_props = schema["result_schema"]["properties"]
    assert "approval_id" in result_props
    assert "status" in result_props
    # status enum must include the canonical states.
    enum = result_props["status"]["enum"]
    assert "pending" in enum and "rejected" in enum


def test_apply_approved_schema_requires_approval_id() -> None:
    schema = FE_TOOL_SCHEMAS[FE_APPLY_APPROVED_MUTATION]
    assert "approval_id" in schema["args_schema"]["required"]
    result_props = schema["result_schema"]["properties"]
    assert "status" in result_props
    enum = result_props["status"]["enum"]
    assert enum == ["applied", "failed"]


def test_legacy_apply_mutation_schema_marked_deprecated() -> None:
    """The deprecation note must be discoverable on the schema description."""
    schema = FE_TOOL_SCHEMAS[FE_APPLY_MUTATION]
    assert "DEPRECATED" in schema["description"]


def test_request_approval_payload_round_trips_through_interrupt_payload() -> None:
    payload = interrupt_payload(
        FE_REQUEST_MUTATION_APPROVAL,
        {"proposal_id": "pr-1"},
    )
    assert payload == {
        "tool": FE_REQUEST_MUTATION_APPROVAL,
        "args": {"proposal_id": "pr-1"},
    }


def test_apply_approved_payload_round_trips_through_interrupt_payload() -> None:
    payload = interrupt_payload(
        FE_APPLY_APPROVED_MUTATION,
        {"approval_id": "appr-pr-1-abc"},
    )
    assert payload == {
        "tool": FE_APPLY_APPROVED_MUTATION,
        "args": {"approval_id": "appr-pr-1-abc"},
    }


# ---------------------------------------------------------------------------
# End-to-end: the chat-agent emits both interrupts in the new contract.
# ---------------------------------------------------------------------------


@pytest.fixture()
def chat_graph():
    agent = ChatAgent()
    return agent.compile(checkpointer=InMemorySaver(), store=InMemoryStore())


def _ctx():
    return {
        "chat_model": make_stub_chat_model(),
        "project_id": "p-split-test",
        "autonomy_level": "plan",
    }


def test_chat_first_interrupt_uses_request_mutation_approval(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "split-approve-1"}}
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=_ctx(),
        )
        interrupts = first.get("__interrupt__") or []
        assert interrupts
        payload = interrupts[0].value
        assert payload["tool"] == FE_REQUEST_MUTATION_APPROVAL
        # The approval interrupt carries a fresh approval_id so the FE can
        # redeem it later via applyApprovedMutation.
        assert payload["args"].get("approval_id")
        assert payload["args"]["proposal_id"]

    asyncio.run(run())


def test_chat_apply_interrupt_uses_apply_approved_mutation(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "split-apply-1"}}
        ctx = _ctx()
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        mid = await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        interrupts = mid.get("__interrupt__") or []
        assert interrupts
        payload = interrupts[0].value
        assert payload["tool"] == FE_APPLY_APPROVED_MUTATION
        # The apply tool only needs the approval id; project_id + diff are
        # additional context.
        assert payload["args"].get("approval_id")
        # Legacy stage parameter must not appear on the new payload.
        assert "stage" not in payload["args"]

    asyncio.run(run())


def test_chat_accepts_new_apply_result_shape(chat_graph) -> None:
    """``{"status": "applied", ...}`` is the new success shape."""

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "split-success-1"}}
        ctx = _ctx()
        first = await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=ctx,
        )
        ev = next(
            e for e in (first.get("events") or [])
            if isinstance(e, dict) and e.get("kind") == "mutation_proposal"
        )
        pid = ev["proposal"]["proposal_id"]
        await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=ctx,
        )
        final = await chat_graph.ainvoke(
            Command(resume={"status": "applied", "details": {"id": pid}}),
            config=cfg,
            context=ctx,
        )
        applied = final.get("mutation_applied_ids") or []
        assert applied == [pid]

    asyncio.run(run())


def test_chat_refuses_apply_when_approval_id_missing(chat_graph) -> None:
    """Direct call into _mutation_finalize without an approval is refused."""
    from app.agents.catalog import chat as chat_module

    # _mutation_finalize expects the runtime via get_runtime; stub it out.
    class _Rt:
        context = {"autonomy_level": "plan", "project_id": "p1"}

    import pytest

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(chat_module, "get_runtime", lambda _ctx: _Rt())
        out = chat_module._mutation_finalize(
            {
                "mutation_pending": {"proposal_id": "pr-1", "diff": {}},
                "mutation_decision": {"accepted": True},  # no approval_id
            }
        )
    assert "approval id is missing" in out["messages"][0].content
    assert "mutation_applied_ids" not in out
