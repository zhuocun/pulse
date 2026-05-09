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

    def get(self, name: str, *, include_shadow: bool = False) -> BaseAgent:
        """Look up an agent by name.

        ``shadow``-status agents are hidden by default so the policy lives
        in one place.  Internal callers (e.g. offline comparison runs) can
        opt in via ``include_shadow=True``.
        """

        with self._lock:
            try:
                agent = self._agents[name]
            except KeyError as exc:
                raise AgentNotFoundError(name) from exc
        if not include_shadow and agent.metadata.status == "shadow":
            raise AgentNotFoundError(name)
        return agent

    def names(self, *, include_shadow: bool = False) -> list[str]:
        with self._lock:
            items = [
                name
                for name, agent in self._agents.items()
                if include_shadow or agent.metadata.status != "shadow"
            ]
        return sorted(items)

    def metadata(self, *, include_shadow: bool = False) -> list[AgentMetadata]:
        with self._lock:
            return [
                self._agents[name].metadata
                for name in sorted(self._agents)
                if include_shadow or self._agents[name].metadata.status != "shadow"
            ]

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


class ChainedAgentRegistry(AgentRegistry):
    """Per-app registry that falls through to a parent on reads.

    Writes (``register`` / ``unregister`` / ``clear``) only mutate the
    *local* dict; reads (``get`` / ``names`` / ``metadata`` / ``__iter__``
    / ``__contains__`` / ``__len__``) check the local dict first, then
    fall through to the parent registry.

    Use case: production wants per-app isolation (each ``AgentRuntime``
    should not be able to mutate another's agent set), but the test
    harness registers test-only agents into the module-level
    :data:`registry` *after* the FastAPI lifespan has built the runtime.
    Falling through to that parent on reads keeps those existing test
    patterns working without requiring all ~70 fixtures to migrate.
    """

    def __init__(self, parent: "AgentRegistry") -> None:
        super().__init__()
        self._parent = parent

    def register(
        self, agent: BaseAgent, *, replace: bool = False
    ) -> BaseAgent:
        """Register ``agent`` locally only; the parent is left untouched."""
        return super().register(agent, replace=replace)

    def get(self, name: str, *, include_shadow: bool = False) -> BaseAgent:
        try:
            return super().get(name, include_shadow=include_shadow)
        except AgentNotFoundError:
            return self._parent.get(name, include_shadow=include_shadow)

    def names(self, *, include_shadow: bool = False) -> list[str]:
        local = set(super().names(include_shadow=include_shadow))
        parent = set(self._parent.names(include_shadow=include_shadow))
        return sorted(local | parent)

    def metadata(self, *, include_shadow: bool = False) -> list[AgentMetadata]:
        # ``metadata`` is sorted by name in the base class; merging two
        # sorted iterables and de-duplicating by ``name`` (local wins)
        # keeps the contract identical to a flat registry.
        seen: dict[str, AgentMetadata] = {}
        for meta in super().metadata(include_shadow=include_shadow):
            seen[meta.name] = meta
        for meta in self._parent.metadata(include_shadow=include_shadow):
            seen.setdefault(meta.name, meta)
        return [seen[name] for name in sorted(seen)]

    def __contains__(self, name: object) -> bool:
        if super().__contains__(name):
            return True
        return self._parent.__contains__(name)

    def __iter__(self) -> Iterator[BaseAgent]:
        seen: dict[str, BaseAgent] = {}
        for agent in super().__iter__():
            seen[agent.name] = agent
        for agent in self._parent:
            seen.setdefault(agent.name, agent)
        return iter(seen[name] for name in sorted(seen))

    def __len__(self) -> int:
        return len({agent.name for agent in self})


registry = AgentRegistry()
