"""In-process registry of available agents.

Concrete agents register themselves into this registry at import time. The
runtime and routers only ever talk to the registry, so adding or removing
an agent is purely a question of importing (or not importing) its module.
"""

from __future__ import annotations

import threading
from typing import Iterator

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.errors import AgentAlreadyRegisteredError, AgentNotFoundError


class AgentRegistry:
    """Mapping of agent name to instance with conflict detection.

    The registry is a process-wide mutable singleton; concurrent imports
    (catalog auto-discovery on cold start) and tests calling
    ``registry.clear()`` in teardown can race on the underlying dict.
    All mutating operations take :attr:`_lock` so the dict mutation is
    serialised. Read operations also take it briefly so that test
    teardown calling ``clear()`` while a request thread iterates cannot
    produce a ``RuntimeError: dictionary changed size during iteration``
    -- the lock keeps reads consistent during writes.
    """

    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {}
        self._lock = threading.Lock()

    def register(self, agent: BaseAgent, *, replace: bool = False) -> BaseAgent:
        name = agent.name
        with self._lock:
            if not replace and name in self._agents:
                raise AgentAlreadyRegisteredError(name)
            self._agents[name] = agent
        return agent

    def unregister(self, name: str) -> None:
        with self._lock:
            if name not in self._agents:
                raise AgentNotFoundError(name)
            del self._agents[name]

    def get(self, name: str) -> BaseAgent:
        with self._lock:
            try:
                return self._agents[name]
            except KeyError as exc:
                raise AgentNotFoundError(name) from exc

    def names(self) -> list[str]:
        with self._lock:
            return sorted(self._agents)

    def metadata(self) -> list[AgentMetadata]:
        with self._lock:
            return [self._agents[name].metadata for name in sorted(self._agents)]

    def clear(self) -> None:
        with self._lock:
            self._agents.clear()

    def __contains__(self, name: object) -> bool:
        if not isinstance(name, str):
            return False
        with self._lock:
            return name in self._agents

    def __iter__(self) -> Iterator[BaseAgent]:
        with self._lock:
            snapshot = [self._agents[name] for name in sorted(self._agents)]
        return iter(snapshot)

    def __len__(self) -> int:
        with self._lock:
            return len(self._agents)


registry = AgentRegistry()
