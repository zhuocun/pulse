"""In-process registry of available agents.

Concrete agents register themselves into this registry at import time. The
runtime and routers only ever talk to the registry, so adding or removing
an agent is purely a question of importing (or not importing) its module.
"""

from __future__ import annotations

from typing import Iterator

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.errors import AgentAlreadyRegisteredError, AgentNotFoundError


class AgentRegistry:
    """Mapping of agent name to instance with conflict detection."""

    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {}

    def register(self, agent: BaseAgent, *, replace: bool = False) -> BaseAgent:
        name = agent.name
        if not replace and name in self._agents:
            raise AgentAlreadyRegisteredError(name)
        self._agents[name] = agent
        return agent

    def unregister(self, name: str) -> None:
        if name not in self._agents:
            raise AgentNotFoundError(name)
        del self._agents[name]

    def get(self, name: str) -> BaseAgent:
        try:
            return self._agents[name]
        except KeyError as exc:
            raise AgentNotFoundError(name) from exc

    def names(self) -> list[str]:
        return sorted(self._agents)

    def metadata(self) -> list[AgentMetadata]:
        return [self._agents[name].metadata for name in self.names()]

    def clear(self) -> None:
        self._agents.clear()

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and name in self._agents

    def __iter__(self) -> Iterator[BaseAgent]:
        return (self._agents[name] for name in self.names())

    def __len__(self) -> int:
        return len(self._agents)


registry = AgentRegistry()
