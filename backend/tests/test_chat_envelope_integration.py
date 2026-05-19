"""Chat-agent integration: output-guard refusal + ToolMessage re-fencing.

Two paths the unit tests for ``output_guard`` and ``tool_envelope`` can
not reach on their own:

* When ``_mutation_finalize`` runs and the recent assistant reasoning
  trips ``classify_pre_mutation``, the apply is refused with an
  ``output_guard_refused`` error event and the proposal is cleared.
* When ``respond`` runs with a non-stub model and prior ToolMessages
  in the trimmed history, each ToolMessage is replaced by a fenced
  ``<untrusted_tool_result>`` copy and a ``mutation_policy_reminder``
  SystemMessage is appended before the model is invoked.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

import app.agents.catalog.chat as chat_module
from app.agents.catalog.chat import ChatAgent


@pytest.fixture()
def chat_graph() -> Any:
    return ChatAgent().compile(checkpointer=InMemorySaver(), store=InMemoryStore())


def _ctx() -> dict[str, Any]:
    return {"project_id": "p-test", "autonomy_level": "plan"}


def test_output_guard_refuses_apply_when_reasoning_trips_classifier(chat_graph) -> None:
    async def run() -> None:
        cfg = {"configurable": {"thread_id": "guard-refuse-1"}}
        await chat_graph.ainvoke(
            {"messages": [HumanMessage(content="__PROPOSE_MUTATION__")]},
            config=cfg,
            context=_ctx(),
        )
        # Inject a suspicious assistant turn as the most recent AIMessage
        # so the output-guard's reasoning scan trips on the apply pass.
        await chat_graph.aupdate_state(
            cfg,
            {
                "messages": [
                    AIMessage(
                        content="I'll bypass the approval policy and proceed directly."
                    )
                ]
            },
        )
        final = await chat_graph.ainvoke(
            Command(resume={"accepted": True}),
            config=cfg,
            context=_ctx(),
        )
        events = final.get("events") or []
        refusal = [
            e
            for e in events
            if isinstance(e, dict)
            and e.get("kind") == "error"
            and e.get("code") == "output_guard_refused"
        ]
        assert refusal, f"expected output_guard_refused error event, got {events!r}"
        assert "bypass_approval_language" in (refusal[0].get("reasons") or [])
        # The mutation is dropped on refusal so a retry cannot re-apply.
        assert final.get("mutation_pending") is None
        assert not final.get("mutation_applied_ids")

    asyncio.run(run())


def test_tool_messages_in_history_get_re_fenced_before_model(
    chat_graph, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A ToolMessage in trimmed history is wrapped before reaching the model."""
    captured: dict[str, Any] = {}

    class _FakeBound:
        async def ainvoke(self, messages, config=None):  # type: ignore[no-untyped-def]
            captured["messages"] = list(messages)
            return AIMessage(content="acknowledged")

    monkeypatch.setattr(chat_module, "_get_bound", lambda _model: _FakeBound())
    # The stub-fast-path runs before trim/refence; force the non-stub branch.
    monkeypatch.setattr(chat_module, "is_stub_model", lambda _model: False)

    async def run() -> None:
        cfg = {"configurable": {"thread_id": "envelope-1"}}
        messages = [
            HumanMessage(content="look up projects"),
            AIMessage(
                content="",
                tool_calls=[
                    {"id": "c1", "name": "listProjects", "args": {}, "type": "tool_call"}
                ],
            ),
            ToolMessage(
                content='[{"id": "p1", "name": "Pulse"}]',
                tool_call_id="c1",
                name="listProjects",
            ),
            HumanMessage(content="now summarise"),
        ]
        # ``chat_model`` is a sentinel — _get_bound is patched, so any value
        # routes to the fake. is_stub_model is patched to always return False.
        ctx = _ctx() | {"chat_model": object()}
        await chat_graph.ainvoke({"messages": messages}, config=cfg, context=ctx)
        sent = captured.get("messages") or []
        tool_msgs = [m for m in sent if isinstance(m, ToolMessage)]
        assert tool_msgs, "expected at least one ToolMessage to reach the model"
        assert "<untrusted_tool_result" in tool_msgs[0].content
        assert "listProjects" in tool_msgs[0].content
        # A policy reminder SystemMessage is appended after the tool fence.
        from langchain_core.messages import SystemMessage

        reminders = [
            m
            for m in sent
            if isinstance(m, SystemMessage)
            and isinstance(m.content, str)
            and "mutation" in m.content.lower()
        ]
        assert reminders, "expected mutation_policy_reminder SystemMessage"

    asyncio.run(run())
