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
``mutation_proposal`` custom event, pause on
``fe.requestMutationApproval`` for the HITL review card, resume with
``Command(resume={"accepted": <bool>})``, then -- when accepted --
emit a second interrupt for ``fe.applyApprovedMutation`` which the FE
redeems against the approval id the agent issued.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
from typing import Any, List, Literal, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
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
from app.agents.identity import COPILOT_IDENTITY, mutation_policy_reminder
from app.agents.llm import is_stub_model
from app.agents.output_guard import classify_pre_mutation
from app.agents.state import ChatState
from app.agents.tool_envelope import wrap_tool_result
from app.tools import be_tools
from app.tools.fe_tool_names import (
    FE_APPLY_APPROVED_MUTATION,
    FE_REQUEST_MUTATION_APPROVAL,
)
from app.tools.fe_tool_schemas import interrupt_payload
from app.observability.metrics import record_agent_mutation_event

logger = logging.getLogger(__name__)

_CHAT_AGENT_PROMPT = (
    "You are Board Copilot, an assistant embedded in a Jira-style project "
    "management tool. Answer concisely. To inspect board, project, task, "
    "or member data, call one of the listProjects / listMembers / "
    "getProject / listBoard / listTasks / getTask tools -- the FE will "
    "execute the call and return the result. Never invent ids or counts; "
    "ground every factual claim in a tool result."
)

# COPILOT_IDENTITY is the shared system-prompt prefix; the chat-specific
# block extends it with FE-tool guidance.  The combined block is cached
# server-side via Anthropic's ``cache_control: ephemeral`` marker.
_SYSTEM_PROMPT = COPILOT_IDENTITY + "\n\n" + _CHAT_AGENT_PROMPT


# Server-side defensive cap on FE tool-call rounds.  Matches the FE's
# defensive cap of 8 from ``useAgentToolResolver.ts``; without a
# server-side mirror a misbehaving client could remove the FE guard and
# force unbounded provider loops.  Set high enough that legitimate
# multi-tool chats are unaffected but low enough that a runaway is
# bounded in well under a minute of provider time.
MAX_SERVER_TOOL_ROUNDS: int = 8

# Fix 12: Anthropic prompt-caching marker on the system message.
# langchain-anthropic >=1.4.3 serialises the ``cache_control`` key in
# content blocks to the Anthropic API so the provider can cache the
# system prompt across turns in the same session.  Non-Anthropic providers
# ignore unknown content-block keys, so this is safe on all providers.
_SYSTEM_MESSAGE = SystemMessage(
    content=[
        {
            "type": "text",
            "text": _SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }
    ]
)

# Fix 5: Hoist bind_tools to build() time.
# Binding tools to a model is pure decoration (no I/O, no side effects);
# repeated calls with the same model instance produce byte-identical
# results. Cache the bound model so every ``respond`` invocation in the
# same process reuses the already-configured instance rather than
# re-wrapping it on every turn.
_bound_cache: dict[int, BaseChatModel] = {}


def _get_bound(model: BaseChatModel) -> BaseChatModel:
    """Return ``model.bind_tools(CHAT_TOOLS)``, caching by object identity."""
    key = id(model)
    if key not in _bound_cache:
        _bound_cache[key] = model.bind_tools(CHAT_TOOLS)
    return _bound_cache[key]

_STUB_MUTATION_TRIGGER = "__PROPOSE_MUTATION__"
_TASK_ID_RE = re.compile(r"__TASK_ID__:([a-fA-F0-9]{24})__")
# Visible marker on the AIMessage when the live provider failed and we are
# serving the deterministic stub reply instead.  Audience/operator sees it
# without any FE change so a silently-degraded demo is impossible.
_DEGRADED_REPLY_PREFIX = "[Live AI unavailable - showing fallback]"
# Approximate-token budget for the trimmed chat history sent to the
# provider on each turn.  Sized to fit comfortably under Claude / GPT-4
# 128k context with headroom for the system prompt, bound tools, and a
# new turn.  Tests rely on this being a module attribute so they can
# patch it down without re-importing chat.py.
_CHAT_TRIM_TOKEN_BUDGET = 32000


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


def _new_approval_id(proposal_id: str) -> str:
    """Generate a unique approval_id for the two-step mutation handshake.

    Includes the proposal id as a prefix so logs / events can pair
    approval ids back to their originating proposal without a database
    lookup; the random suffix prevents collisions if the same proposal
    is re-issued in a different thread.
    """

    return f"appr-{proposal_id}-{secrets.token_hex(4)}"


def _mutation_hitl(state: ChatState) -> dict[str, Any]:
    proposal = state.get("mutation_pending")
    if not proposal:
        return {}
    pid = proposal.get("proposal_id")
    if not isinstance(pid, str) or not pid.strip():
        # Defensive: a malformed proposal would silently coast through the
        # finalize node with pid="" and write the empty string into
        # mutation_applied_ids, breaking idempotency for every future
        # proposal in the thread. Drop it loudly instead.
        logger.warning("chat-agent: dropping mutation_pending with blank proposal_id.")
        return {
            "messages": [
                AIMessage(content="Could not surface that proposal (missing id).")
            ],
            "mutation_pending": None,
            "mutation_decision": None,
        }
    approval_id = _new_approval_id(pid)
    raw = interrupt(
        interrupt_payload(
            FE_REQUEST_MUTATION_APPROVAL,
            {
                "proposal_id": pid,
                "approval_id": approval_id,
                "mutation": proposal,
            },
        )
    )
    # Resume payload contract: ``Command(resume={"accepted": <bool>})``.
    # Reject anything else loudly rather than coercing — a non-dict resume
    # historically became ``{"accepted": True}`` for any truthy value, so a
    # client bug could auto-accept a mutation the user never saw.
    if not isinstance(raw, dict) or "accepted" not in raw:
        logger.warning(
            "chat-agent: malformed resume payload (%r); treating as rejection.",
            type(raw).__name__,
        )
        decision: dict[str, Any] = {"accepted": False, "reason": "malformed_resume"}
    else:
        decision = {"accepted": bool(raw.get("accepted"))}
        # Preserve optional editor-modified diff if the FE sends one.
        if "edited_diff" in raw:
            decision["edited_diff"] = raw["edited_diff"]
    decision["approval_id"] = approval_id
    record_agent_mutation_event(
        "proposal_resumed_accept" if decision["accepted"] else "proposal_resumed_reject"
    )
    update: dict[str, Any] = {"mutation_decision": decision}
    if decision["accepted"]:
        # Persist the approval payload so applyApprovedMutation can redeem it
        # against the same approval_id even if the runtime is checkpointed
        # and resumed between the approval interrupt and the apply call.
        update["pending_approvals"] = {
            approval_id: {
                "proposal_id": pid,
                "mutation": proposal,
                "edited_diff": decision.get("edited_diff"),
            }
        }
    return update


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

    approval_id = str(decision.get("approval_id") or "")
    pending = state.get("pending_approvals") or {}
    if not approval_id or approval_id not in pending:
        # The applyApprovedMutation contract requires a redeemable approval
        # id; without one the apply is not authorised even if the prior
        # interrupt fired (the FE may have lost the approval cache).
        logger.warning(
            "chat-agent: apply requested without a redeemable approval_id "
            "(id=%r, known=%r); refusing.",
            approval_id,
            list(pending.keys()),
        )
        return {
            "messages": [
                AIMessage(
                    content=(
                        "Could not apply: approval id is missing or expired. "
                        "Please re-issue the proposal."
                    )
                )
            ],
            "mutation_pending": None,
            "mutation_decision": None,
        }

    # ``decision["edited_diff"]`` is populated when the FE resume payload
    # carried a user-edited diff (PRD §5.3 resume shape).  Prefer it over
    # the original proposal so an in-flight edit during approval actually
    # reaches the apply stage instead of being silently dropped.
    diff = decision.get("edited_diff") or proposal.get("diff") or {}

    # Output-guard pre-apply check: scan the recent reasoning text + the
    # approved mutation for the four classifier patterns.  A flagged apply
    # is refused with a clear error message rather than silently passed
    # through.
    recent_text = ""
    for msg in reversed(state.get("messages") or []):
        if isinstance(msg, AIMessage):
            content = msg.content
            if isinstance(content, str):
                recent_text = content
                break
    guard = classify_pre_mutation(recent_text, proposal)
    if not guard.get("safe", True):
        logger.warning(
            "chat-agent: output_guard refused apply for proposal=%r reasons=%r",
            pid,
            guard.get("reasons"),
        )
        record_agent_mutation_event("output_guard_refused")
        reasons = ", ".join(guard.get("reasons") or []) or "policy_violation"
        return {
            "messages": [
                AIMessage(
                    content=(
                        "Refusing to apply this mutation -- the planned action "
                        f"failed safety checks ({reasons}). Please rephrase or "
                        "re-issue a narrower proposal."
                    )
                )
            ],
            "events": [
                {
                    "kind": "error",
                    "scope": "mutation",
                    "code": "output_guard_refused",
                    "reasons": guard.get("reasons") or [],
                }
            ],
            "mutation_pending": None,
            "mutation_decision": None,
        }

    fe_result = interrupt(
        interrupt_payload(
            FE_APPLY_APPROVED_MUTATION,
            {
                "approval_id": approval_id,
                "proposal_id": pid,
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
    # Two valid success shapes are accepted:
    #   * canonical contract: ``{"status": "applied", "details": {...}}``
    #   * legacy contract:    ``{"applied": True}``
    # The legacy form is kept as a defensive shield for operator-managed
    # deploys where an older FE bundle may still be cached client-side;
    # current FE always sends the canonical shape.  Anything else (empty
    # dict, non-dict, ``{"applied": False}``) is treated as a failure so
    # the user is not told an apply succeeded when it didn't.
    applied_ok = isinstance(fe_result, dict) and (
        fe_result.get("status") == "applied"
        or fe_result.get("applied") is True
    )
    if not applied_ok:
        logger.warning(
            "chat-agent: applyApprovedMutation returned non-success shape %r; "
            "treating as failure.",
            fe_result,
        )
        return {
            "messages": [
                AIMessage(
                    content=(
                        "Could not confirm the apply succeeded; please "
                        "refresh the board and try again."
                    )
                )
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
            FE_REQUEST_MUTATION_APPROVAL,
            FE_APPLY_APPROVED_MUTATION,
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

            # Server-side defensive cap on FE tool-call rounds.  Counted by
            # how many AIMessages in the history carry ``tool_calls`` -- one
            # entry per round.  Past the cap we refuse to invoke the model
            # again and surface an error frame so the FE can show a clear
            # state instead of looping forever.
            tool_rounds_used = sum(
                1
                for msg in messages
                if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None)
            )
            if tool_rounds_used >= MAX_SERVER_TOOL_ROUNDS:
                logger.warning(
                    "chat-agent: server-side tool-round cap reached "
                    "(rounds=%d, cap=%d); aborting respond.",
                    tool_rounds_used,
                    MAX_SERVER_TOOL_ROUNDS,
                )
                record_agent_mutation_event("tool_round_cap_reached")
                return {
                    "messages": [
                        AIMessage(
                            content=(
                                "Tool round limit reached -- please rephrase "
                                "your request or break it into smaller steps."
                            )
                        )
                    ],
                    "events": [
                        {
                            "kind": "error",
                            "scope": "chat",
                            "code": "tool_round_cap_reached",
                            "limit": MAX_SERVER_TOOL_ROUNDS,
                        }
                    ],
                    "tool_rounds_used": tool_rounds_used,
                    "mutation_pending": None,
                    "mutation_decision": None,
                }

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
                    "tool_rounds_used": tool_rounds_used,
                }

            if is_stub_model(chat_model):
                reply = _stub_response(user_text, project_id)
                response: AIMessage = AIMessage(content=reply)
                return {
                    "messages": [response],
                    "mutation_pending": None,
                    "mutation_decision": None,
                    "tool_rounds_used": tool_rounds_used,
                }

            # Token-budget trim with two safety properties beyond the prior
            # ``len``-based no-op:
            # * ``token_counter="approximate"`` actually bounds context size;
            #   the previous ``len`` counter measured items, so
            #   ``max_tokens=4000`` meant "up to 4000 messages" and never
            #   trimmed in practice.
            # * ``start_on="human"`` keeps tool_use / tool_result message
            #   pairs intact -- LangChain's trim drops the leading tool_*
            #   messages so a trimmed-mid-loop conversation never sends an
            #   orphan tool_use to Anthropic (which 400s on that shape).
            trimmed = trim_messages(
                messages,
                max_tokens=_CHAT_TRIM_TOKEN_BUDGET,
                strategy="last",
                token_counter="approximate",
                include_system=False,
                allow_partial=False,
                start_on="human",
            )
            # ``start_on="human"`` returns an empty list when no HumanMessage
            # fits the budget (e.g. the whole window is AI + tool messages).
            # Sending ``[SystemMessage]`` alone strips the user's request and
            # the model responds with a generic greeting -- worse than a
            # potential trim violation.  Fall back to the most recent human
            # message so the model always sees what the user asked.
            if not trimmed and messages:
                for msg in reversed(messages):
                    if isinstance(msg, HumanMessage):
                        trimmed = [msg]
                        break
            conversation: List[Any] = [_SYSTEM_MESSAGE]
            # Trust boundary: re-fence every ToolMessage in the trimmed window
            # so the provider treats its content as untrusted data, and
            # re-anchor the mutation policy after each tool result so a
            # long multi-round conversation can't drift past the guardrails.
            for msg in trimmed:
                if isinstance(msg, ToolMessage):
                    tool_name = getattr(msg, "name", None) or msg.tool_call_id or "tool"
                    fenced = wrap_tool_result(tool_name, msg.content)
                    conversation.append(
                        ToolMessage(
                            content=fenced,
                            tool_call_id=msg.tool_call_id,
                            name=getattr(msg, "name", None),
                        )
                    )
                    conversation.append(
                        SystemMessage(content=mutation_policy_reminder())
                    )
                else:
                    conversation.append(msg)
            bound = _get_bound(chat_model)
            try:
                raw = await bound.ainvoke(conversation)
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except Exception:  # noqa: BLE001 -- defensive boundary around provider call
                logger.warning(
                    "chat-agent provider call failed; falling back to stub reply.",
                    exc_info=True,
                )
                # Make the degradation visible to the operator/audience instead
                # of silently serving a deterministic answer.  Without this
                # marker the demo can show a "successful" turn that never
                # actually hit the live LLM.
                reply = _stub_response(user_text, project_id)
                response = AIMessage(
                    content=f"{_DEGRADED_REPLY_PREFIX} {reply}"
                )
                return {
                    "messages": [response],
                    "mutation_pending": None,
                    "mutation_decision": None,
                    "tool_rounds_used": tool_rounds_used,
                }
            if isinstance(raw, AIMessage):
                response = raw
            else:
                response = AIMessage(content=str(getattr(raw, "content", raw)))

            new_rounds = tool_rounds_used + (
                1 if getattr(response, "tool_calls", None) else 0
            )
            return {
                "messages": [response],
                "mutation_pending": None,
                "mutation_decision": None,
                "tool_rounds_used": new_rounds,
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
