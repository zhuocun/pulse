"""``chat-agent`` -- general-purpose conversational agent.

Implements PRD v2.1 §5A.6. With a deterministic stub model the agent
behaves predictably for tests; with a real provider configured via
``AGENT_CHAT_MODEL_PROVIDER`` (or env auto-detect) the agent binds the
six FE-executed read tools (``listProjects`` / ``listMembers`` /
``getProject`` / ``listBoard`` / ``listTasks`` / ``getTask`` -- see
:mod:`app.agents.catalog._chat_tools`) to the model so it can ground
factual claims in real board data. The FE dispatches each tool call,
posts the result back as a ``role: "tool"`` message, and the loop
repeats until the model returns plain text (max 5 rounds, enforced FE-
side in ``useAiChat.ts``).

GA §1: stub turns that include ``__PROPOSE_MUTATION__`` emit a typed
``mutation_proposal`` custom event, pause on ``fe.applyMutation`` stage
``approval``, resume with ``Command(resume={"accepted": <bool>})``, then
optionally run stage ``apply`` (FE ``fe.applyMutation`` tool).
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, List, Literal, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.messages.utils import trim_messages
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import interrupt
from langgraph.runtime import get_runtime

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._chat_tools import CHAT_TOOLS
from app.agents.context import ChatContext
from app.agents.events import (
    MutationProposalEvent,
    MutationProposalWire,
    MutationDiffWire,
    TaskUpdateWire,
)
from app.agents.llm import is_stub_model
from app.agents.state import ChatState
from app.tools import be_tools
from app.tools.fe_tool_schemas import interrupt_payload
from app.observability.metrics import record_agent_mutation_event

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are Board Copilot, an assistant embedded in a Jira-style project "
    "management tool. Answer concisely. To inspect board, project, task, "
    "or member data, call one of the listProjects / listMembers / "
    "getProject / listBoard / listTasks / getTask tools -- the FE will "
    "execute the call and return the result. Never invent ids or counts; "
    "ground every factual claim in a tool result."
)

_STUB_MUTATION_TRIGGER = "__PROPOSE_MUTATION__"
_TASK_ID_RE = re.compile(r"__TASK_ID__:([a-fA-F0-9]{24})__")


def _last_user_text(state: ChatState) -> str:
    for message in reversed(state.get("messages") or []):
        if isinstance(message, HumanMessage):
            content = message.content
            if isinstance(content, str):
                return content
    return ""


def _stub_response(user_text: str, project_id: str) -> str:
    summary = be_tools.summarize(user_text or "(no message)", max_chars=200)
    return (
        f"[chat-agent project={project_id}] {summary}"
        if user_text
        else f"[chat-agent project={project_id}] How can I help with this board?"
    )


def _stub_mutation_proposal(user_text: str, _project_id: str) -> MutationProposalWire:
    match = _TASK_ID_RE.search(user_text)
    task_id = match.group(1) if match else "000000000000000000000001"
    pid = f"stub-{task_id[:8]}"
    return MutationProposalWire(
        proposal_id=pid,
        description="Stub: rename task for CI (mutation lifecycle)",
        diff=MutationDiffWire(
            task_updates=[
                TaskUpdateWire(
                    task_id=task_id,
                    field="taskName",
                    from_="Before",
                    to="After (stub mutation)",
                )
            ]
        ),
        risk="low",
        undoable=True,
    )


def _after_respond(state: ChatState) -> Literal["mutation_hitl", "end"]:
    if state.get("mutation_pending"):
        return "mutation_hitl"
    return "end"


def _mutation_hitl(state: ChatState) -> dict[str, Any]:
    proposal = state.get("mutation_pending")
    if not proposal:
        return {}
    pid = proposal.get("proposal_id")
    if not isinstance(pid, str) or not pid.strip():
        return {}
    raw = interrupt(
        interrupt_payload(
            "fe.applyMutation",
            {"proposal_id": pid, "stage": "approval"},
        )
    )
    decision = raw if isinstance(raw, dict) else {"accepted": bool(raw)}
    record_agent_mutation_event(
        "proposal_resumed_accept" if decision.get("accepted") else "proposal_resumed_reject"
    )
    return {"mutation_decision": decision}


def _mutation_finalize(state: ChatState) -> dict[str, Any]:
    proposal = state.get("mutation_pending")
    decision = state.get("mutation_decision") or {}
    if not proposal:
        return {}
    pid = str(proposal.get("proposal_id") or "")
    applied = state.get("mutation_applied_ids") or []
    if pid in applied:
        return {
            "messages": [AIMessage(content="That proposal was already applied.")],
            "mutation_pending": None,
            "mutation_decision": None,
        }
    if not decision.get("accepted"):
        return {
            "messages": [AIMessage(content="Okay — leaving the board unchanged.")],
            "mutation_pending": None,
            "mutation_decision": None,
        }

    _rt = get_runtime(ChatContext)
    ctx = _rt.context or {}
    autonomy = str(ctx.get("autonomy_level") or "").strip().lower()
    if autonomy == "suggest":
        return {
            "messages": [
                AIMessage(
                    content=(
                        "Suggestions-only mode is on; switch to plan or auto "
                        "to apply board changes."
                    )
                )
            ],
            "mutation_pending": None,
            "mutation_decision": None,
        }

    diff = proposal.get("diff") or {}
    fe_result = interrupt(
        interrupt_payload(
            "fe.applyMutation",
            {
                "proposal_id": pid,
                "stage": "apply",
                "project_id": str(ctx.get("project_id") or ""),
                "diff": diff,
            },
        )
    )
    if isinstance(fe_result, dict) and fe_result.get("error"):
        return {
            "messages": [
                AIMessage(content=f"Could not apply: {fe_result.get('error')}")
            ],
            "mutation_pending": None,
            "mutation_decision": None,
        }
    record_agent_mutation_event("apply_completed")
    return {
        "mutation_applied_ids": [pid],
        "messages": [AIMessage(content="Applied the agreed change.")],
        "mutation_pending": None,
        "mutation_decision": None,
    }


class ChatAgent(BaseAgent):
    """Lightweight conversational agent for board chat interactions."""

    metadata = AgentMetadata(
        name="chat-agent",
        description="Lightweight conversational agent for board chat interactions.",
        version="1.2.0",
        tags=("board-copilot", "chat"),
        recursion_limit=18,
        status="active",
        rate_limit=(20, 200),
        allowed_autonomy=("suggest", "plan", "auto"),
        tools=(
            "listProjects",
            "listMembers",
            "getProject",
            "listBoard",
            "listTasks",
            "getTask",
            "fe.applyMutation",
        ),
        rationale={
            "recursion_limit": (
                "Multi-turn FE tool loops can take ~5 round-trips; mutation "
                "HITL adds three nodes — 18 keeps modest headroom."
            ),
            "rate_limit": (
                "Interactive UX. 20/min mirrors the chat input throttle."
            ),
            "allowed_autonomy": (
                "All three levels supported: chat is the primary surface "
                "for autonomy-aware command suggestions."
            ),
        },
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        _default_model = self.chat_model  # captured for fallback

        async def respond(state: ChatState) -> dict[str, Any]:
            # Prefer the per-call context model; fall back to the default.
            _rt = get_runtime(ChatContext)
            _ctx = _rt.context or {}
            chat_model: BaseChatModel = _ctx.get("chat_model") or _default_model
            # Keep _last_user_text reading the full (un-trimmed) history so
            # the stub-fallback summary still picks up the actual last user input.
            user_text = _last_user_text(state)
            # F-43: project_id is now in context, not state.
            project_id = _ctx.get("project_id") or "unknown"
            messages = list(state.get("messages") or [])

            if is_stub_model(chat_model) and _STUB_MUTATION_TRIGGER in user_text:
                proposal_model = _stub_mutation_proposal(user_text, project_id)
                proposal_dict = proposal_model.model_dump(mode="json", by_alias=True)
                event = MutationProposalEvent(proposal=proposal_model).model_dump(
                    mode="json", by_alias=True
                )
                msg = AIMessage(
                    content="Please review the proposal card, then accept or reject."
                )
                return {
                    "messages": [msg],
                    "events": [event],
                    "mutation_pending": proposal_dict,
                    "mutation_decision": None,
                }

            if is_stub_model(chat_model):
                reply = _stub_response(user_text, project_id)
                response: AIMessage = AIMessage(content=reply)
                return {
                    "messages": [response],
                    "mutation_pending": None,
                    "mutation_decision": None,
                }

            trimmed = trim_messages(
                messages,
                max_tokens=4000,
                strategy="last",
                token_counter=len,
                include_system=False,
                allow_partial=False,
            )
            conversation: List[Any] = [SystemMessage(content=_SYSTEM_PROMPT)]
            conversation.extend(trimmed)
            bound = chat_model.bind_tools(CHAT_TOOLS)
            try:
                raw = await bound.ainvoke(conversation)
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except Exception:  # noqa: BLE001 -- defensive boundary around provider call
                logger.warning(
                    "chat-agent provider call failed; falling back to stub reply.",
                    exc_info=True,
                )
                reply = _stub_response(user_text, project_id)
                response = AIMessage(content=reply)
                return {
                    "messages": [response],
                    "mutation_pending": None,
                    "mutation_decision": None,
                }
            if isinstance(raw, AIMessage):
                response = raw
            else:
                response = AIMessage(content=str(getattr(raw, "content", raw)))

            return {
                "messages": [response],
                "mutation_pending": None,
                "mutation_decision": None,
            }

        graph: StateGraph = StateGraph(ChatState, context_schema=ChatContext)
        graph.add_node("respond", respond)
        graph.add_node("mutation_hitl", _mutation_hitl)
        graph.add_node("mutation_finalize", _mutation_finalize)
        graph.add_edge(START, "respond")
        graph.add_conditional_edges(
            "respond",
            _after_respond,
            {"mutation_hitl": "mutation_hitl", "end": END},
        )
        graph.add_edge("mutation_hitl", "mutation_finalize")
        graph.add_edge("mutation_finalize", END)
        return graph.compile(checkpointer=checkpointer, store=store)
