"""Agent infrastructure built on LangGraph.

This package is the single home for every agent the application ships. New
agents are added by subclassing :class:`BaseAgent` inside
``app.agents.catalog`` and registering them with the module-level
:data:`registry`. Auto-discovery picks them up at startup -- no edits to
wiring or routers needed.

Public surface kept intentionally small so the higher levels (FastAPI
routers, services, tests) can depend on stable names.
"""

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.errors import (
    AgentAlreadyRegisteredError,
    AgentConfigurationError,
    AgentError,
    AgentExecutionError,
    AgentNotFoundError,
    AgentRecursionError,
    InvalidThreadKeyError,
)
from app.agents.registry import AgentRegistry, registry
from app.agents.runtime import AgentRuntime
from app.agents.state import (
    AgentState,
    BaseAgentState,
    BoardBriefState,
    ChatState,
    SearchState,
    TaskDraftingState,
    TaskEstimationState,
    TriageState,
)

__all__ = [
    "AgentAlreadyRegisteredError",
    "AgentConfigurationError",
    "AgentError",
    "AgentExecutionError",
    "AgentMetadata",
    "AgentNotFoundError",
    "AgentRecursionError",
    "AgentRegistry",
    "AgentRuntime",
    "InvalidThreadKeyError",
    "AgentState",
    "BaseAgent",
    "BaseAgentState",
    "BoardBriefState",
    "ChatState",
    "SearchState",
    "TaskDraftingState",
    "TaskEstimationState",
    "TriageState",
    "registry",
]
