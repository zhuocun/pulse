"""Base classes every concrete agent extends.

A concrete agent is responsible for two things:

1. Declaring its identity, capabilities and runtime defaults through
   :class:`AgentMetadata`.
2. Building a compiled LangGraph graph in :meth:`BaseAgent.build`.

Everything else (registration, checkpointing, long-term memory store,
context plumbing, recursion limits, exception translation, HTTP exposure,
streaming) is handled by the runtime / registry / router layers.

The :meth:`build` signature deliberately exposes both LangGraph persistence
layers (``checkpointer`` for short-term thread state and ``store`` for
long-term cross-thread memory) so each agent can opt in to whichever it
needs without a separate wiring layer.
"""

from __future__ import annotations

import re
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, Mapping, Optional, Sequence

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import Command

from app.middleware.rate_limit import DEFAULT_LIMIT

AGENT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


AgentStatus = Literal["active", "deprecated", "shadow"]
AutonomyLevel = Literal["suggest", "plan", "auto"]


@dataclass(frozen=True)
class AgentMetadata:
    """Static description of an agent.

    The metadata is what the API exposes to clients and what humans read in
    logs. Keep ``name`` short, kebab/snake-case, and stable -- it is the
    public identifier used in URLs and registry lookups.

    Attributes:
        name: Public identifier, used in URLs and registry lookups.
        description: One-line human description.
        version: SemVer-ish version string.
        tags: Free-form labels (search/grouping in UIs).
        recursion_limit: Per-agent cap on LangGraph supersteps. Hard upper
            bound enforced on every invocation; protects against runaway
            tool-calling / handoff loops -- one of the top production
            failure modes for multi-agent systems.
        context_schema: Optional dataclass / TypedDict / Pydantic model used
            as ``context_schema=`` on the agent's StateGraph and as the
            type of the ``context`` argument on :meth:`Pregel.invoke`. This
            is the v0.6+ replacement for stuffing app-level data into
            ``configurable``.
        status: Lifecycle marker per PRD §5A.3 -- ``"active"`` is exposed
            normally, ``"deprecated"`` is still callable but discouraged,
            ``"shadow"`` is invisible to FE pickers.
        rate_limit: ``(per_minute, per_hour)`` quota the runtime advertises
            and the rate limiter enforces (PRD §5A.8).
        allowed_autonomy: Subset of ``("suggest", "plan", "auto")`` levels
            the agent supports (PRD §5A.5).
        tools: Names of FE / BE tools the agent talks to. Surfaced in the
            metadata so the FE knows what permissions the agent needs and
            so MCP wiring can publish a stable schema.
    """

    name: str
    description: str = ""
    version: str = "0.1.0"
    tags: tuple[str, ...] = field(default_factory=tuple)
    recursion_limit: int = 25
    context_schema: Optional[type[Any]] = None
    status: AgentStatus = "active"
    rate_limit: tuple[int, int] = DEFAULT_LIMIT
    allowed_autonomy: tuple[AutonomyLevel, ...] = ("suggest", "plan")
    tools: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not AGENT_NAME_RE.fullmatch(self.name):
            raise ValueError(
                "Agent name must be non-empty and contain only letters, "
                "numbers, dots, underscores, or hyphens",
            )
        if self.recursion_limit < 1:
            raise ValueError("Agent recursion_limit must be at least 1")
        if self.status not in ("active", "deprecated", "shadow"):
            raise ValueError(
                "Agent status must be one of 'active', 'deprecated', 'shadow'",
            )
        if len(self.rate_limit) != 2 or any(value < 1 for value in self.rate_limit):
            raise ValueError(
                "Agent rate_limit must be (per_minute, per_hour) positive ints",
            )
        for level in self.allowed_autonomy:
            if level not in ("suggest", "plan", "auto"):
                raise ValueError(
                    "Agent allowed_autonomy entries must be one of "
                    "'suggest', 'plan', 'auto'",
                )

    def as_dict(self) -> dict[str, Any]:
        """Return the wire-shape the FE consumes for the agent picker.

        ``tags``, ``recursion_limit`` and ``context_schema`` are kept on
        the dataclass because the runtime / router still read them
        internally (recursion-limit clamp, context-schema introspection
        on the streaming endpoint), but they are deliberately *not*
        emitted here -- the FE never reads them and including them just
        bloats every metadata response. Trim per the v2.1 audit
        follow-up (open item 9).
        """

        per_minute, per_hour = self.rate_limit
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "status": self.status,
            "rate_limit": {"per_minute": per_minute, "per_hour": per_hour},
            "allowed_autonomy": list(self.allowed_autonomy),
            "tools": list(self.tools),
        }


class BaseAgent(ABC):
    """Abstract base class for all LangGraph-powered agents.

    Subclasses implement :meth:`build` to return a compiled LangGraph graph.
    The base class memoizes the result so the (potentially expensive) graph
    construction only happens once per agent instance, with an explicit
    ``force=True`` escape hatch for tests / hot-reload.

    Concrete agents do **not** need to know about HTTP, the FastAPI app,
    settings, or env vars -- the :class:`AgentRuntime` injects everything
    they need (checkpointer, store, recursion limit, thread namespace,
    context object) at invocation time.
    """

    metadata: AgentMetadata

    def __init__(self, *, chat_model: Any = None) -> None:
        if not isinstance(getattr(self, "metadata", None), AgentMetadata):
            raise TypeError(
                f"{type(self).__name__} must define a class-level 'metadata'",
            )
        # Cache the (checkpointer, store, compiled) triple so identity
        # comparisons (``is``) drive invalidation. We keep strong refs to
        # both persistence objects while they are cached; ``id()`` would
        # be unsafe because CPython recycles ids after GC (review F-4).
        self._compiled: Optional[Pregel] = None
        self._compiled_checkpointer: Any = None
        self._compiled_store: Any = None
        # Serialise concurrent ``compile()`` callers so two tasks racing
        # on the cache miss path cannot both call ``self.build()``.
        self._compile_lock = threading.Lock()
        # Resolved lazily on first ``compile()`` so unit tests that never
        # touch the LLM never construct a real provider client.
        self._chat_model: Any = chat_model
        self._chat_model_resolved: bool = chat_model is not None

    @property
    def name(self) -> str:
        return self.metadata.name

    @abstractmethod
    def build(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
    ) -> Pregel:
        """Construct and return the compiled LangGraph graph.

        Implementations call ``StateGraph(..., context_schema=...).compile(
        checkpointer=checkpointer, store=store)`` themselves -- this keeps
        each agent in full control of its state schema and node wiring
        while still receiving the shared persistence layers from the
        runtime.
        """

    @property
    def chat_model(self) -> Any:
        """Return the agent's chat model, resolving from settings on demand.

        The default model is the deterministic stub when
        ``AGENT_CHAT_MODEL_PROVIDER=stub`` (or when no provider key is set
        in ``auto`` mode). Catalog agents inspect
        :func:`app.agents.llm.is_stub_model` to decide whether to take the
        deterministic Python path or call a real provider.
        """

        if not self._chat_model_resolved:
            from app.agents.llm import make_chat_model  # local import: avoid cycles

            self._chat_model = make_chat_model()
            self._chat_model_resolved = True
        return self._chat_model

    def set_chat_model(self, model: Any) -> None:
        """Inject a chat model (used by the runtime / tests)."""

        self._chat_model = model
        self._chat_model_resolved = True
        # Force a rebuild on next compile so the new model is bound.
        self._compiled = None
        self._compiled_checkpointer = None
        self._compiled_store = None

    def compile(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
        force: bool = False,
    ) -> Pregel:
        """Return the compiled graph, building it on first access.

        The cache holds strong references to the (checkpointer, store)
        pair the graph was compiled against; comparison uses ``is`` so
        ``id()`` recycling cannot short-circuit a rebuild to a stale
        graph (review F-4). The runtime hands a single pair to every
        agent for its lifetime, so cache hits dominate in production.

        ``self._compile_lock`` serialises concurrent callers; without
        it, two tasks racing the cache-miss path could both invoke
        ``self.build()`` and the second-write-wins semantic would
        discard one freshly-built graph that may already be executing.
        """

        with self._compile_lock:
            same_checkpointer = self._compiled_checkpointer is checkpointer
            same_store = self._compiled_store is store
            if (
                self._compiled is None
                or not same_checkpointer
                or not same_store
                or force
            ):
                self._compiled = self.build(checkpointer=checkpointer, store=store)
                self._compiled_checkpointer = checkpointer
                self._compiled_store = store
            return self._compiled

    @staticmethod
    def _normalize_input(inputs: Any) -> Any:
        """Pass :class:`Command` resume payloads through untouched.

        LangGraph distinguishes a resume request (``Command(resume=...)``)
        from a regular state update; the former must reach the graph
        unwrapped, otherwise it is rebuilt as a plain mapping and the
        ``interrupt()`` consumer never receives the value.
        """

        if isinstance(inputs, Command):
            return inputs
        return dict(inputs)

    def invoke(
        self,
        inputs: Any,
        *,
        config: Optional[Mapping[str, Any]] = None,
        context: Any = None,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
    ) -> Any:
        graph = self.compile(checkpointer=checkpointer, store=store)
        return graph.invoke(
            self._normalize_input(inputs),
            config=dict(config) if config else None,
            context=context,
        )

    async def ainvoke(
        self,
        inputs: Any,
        *,
        config: Optional[Mapping[str, Any]] = None,
        context: Any = None,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
    ) -> Any:
        graph = self.compile(checkpointer=checkpointer, store=store)
        return await graph.ainvoke(
            self._normalize_input(inputs),
            config=dict(config) if config else None,
            context=context,
        )

    async def astream(
        self,
        inputs: Any,
        *,
        config: Optional[Mapping[str, Any]] = None,
        context: Any = None,
        stream_mode: Sequence[str] = ("updates", "messages", "custom"),
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
    ) -> AsyncIterator[tuple[str, Any]]:
        """Async-iterate over LangGraph events.

        With ``stream_mode`` containing more than one mode (the default),
        LangGraph yields ``(mode, payload)`` tuples. We forward them as-is
        so consumers can fan them out to SSE / WebSocket / log sinks.
        """

        graph = self.compile(checkpointer=checkpointer, store=store)
        async for event in graph.astream(
            self._normalize_input(inputs),
            config=dict(config) if config else None,
            context=context,
            stream_mode=list(stream_mode),
        ):
            yield event
