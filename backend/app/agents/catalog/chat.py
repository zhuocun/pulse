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
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.catalog._chat_tools import CHAT_TOOLS
from app.agents.llm import extract_token_usage, is_stub_model
from app.agents.registry import registry
from app.agents.state import ChatState
from app.agents.stream import emit_custom
from app.tools import be_tools

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are Board Copilot, an assistant embedded in a Jira-style project "
    "management tool. Answer concisely. To inspect board, project, task, "
    "or member data, call one of the listProjects / listMembers / "
    "getProject / listBoard / listTasks / getTask tools -- the FE will "
    "execute the call and return the result. Never invent ids or counts; "
    "ground every factual claim in a tool result."
)


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


class ChatAgent(BaseAgent):
    """Lightweight conversational agent for board chat interactions."""

    metadata = AgentMetadata(
        name="chat-agent",
        description="Lightweight conversational agent for board chat interactions.",
        version="1.1.0",
        tags=("board-copilot", "chat"),
        recursion_limit=15,
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
        ),
    )

    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        chat_model: BaseChatModel = self.chat_model

        async def respond(state: ChatState) -> dict[str, Any]:
            user_text = _last_user_text(state)
            project_id = state.get("project_id") or "unknown"
            messages = list(state.get("messages") or [])

            if is_stub_model(chat_model):
                reply = _stub_response(user_text, project_id)
                response: AIMessage = AIMessage(content=reply)
                tokens_in = 0
                tokens_out = 0
            else:
                # Use ``ainvoke`` so a real provider call yields the
                # event loop; otherwise the synchronous HTTP roundtrip
                # would block every other in-flight request on the same
                # worker for the duration of the LLM response.
                #
                # ``bind_tools`` returns a Runnable that exposes the FE-
                # executed tool catalogue to the model; the FE posts each
                # tool result back as a ``role: "tool"`` message and the
                # shim's loop continues until the model emits plain text.
                conversation: List[Any] = [SystemMessage(content=_SYSTEM_PROMPT)]
                conversation.extend(messages)
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
                    emit_custom(
                        {"kind": "usage", "tokensIn": 0, "tokensOut": 0}
                    )
                    return {"messages": [response]}
                if isinstance(raw, AIMessage):
                    response = raw
                else:
                    response = AIMessage(
                        content=str(getattr(raw, "content", raw))
                    )
                tokens_in, tokens_out = extract_token_usage(response)

            emit_custom(
                {"kind": "usage", "tokensIn": tokens_in, "tokensOut": tokens_out}
            )
            # No citation event here: the user's own message is not a
            # citable entity and ``source: "user"`` is not in the FE
            # contract enum (``task | column | member | project`` --
            # see ``src/interfaces/agent.d.ts``). Emitting it caused the
            # FE citation chip renderer to silently drop the ref.
            return {"messages": [response]}

        graph: StateGraph = StateGraph(ChatState)
        graph.add_node("respond", respond)
        graph.add_edge(START, "respond")
        graph.add_edge("respond", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(ChatAgent(), replace=True)
