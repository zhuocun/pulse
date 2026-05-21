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

import asyncio
import logging
import re
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, Mapping, Optional, Sequence, get_args, get_type_hints

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.pregel import Pregel
from langgraph.store.base import BaseStore
from langgraph.types import Command

from app.middleware.rate_limit import DEFAULT_LIMIT

logger = logging.getLogger(__name__)

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
            metadata so the FE knows what permissions the agent needs.
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
    # Declarative redaction contract (PRD §5A.10). Routers walk these
    # tuples to redact user-supplied input uniformly instead of keeping
    # per-route field tuples in the HTTP layer.  ``redactable_text_fields``
    # are top-level string keys; ``redactable_dict_fields`` are nested
    # objects whose strings should be recursively redacted.
    redactable_text_fields: tuple[str, ...] = field(default_factory=tuple)
    redactable_dict_fields: tuple[str, ...] = field(default_factory=tuple)
    # ``rationale`` is a free-form ``{policy_field: justification}`` map
    # so a future author reading e.g. ``recursion_limit=15`` can find the
    # reason inline. Not enforced at runtime; renders in agent docs.
    rationale: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not AGENT_NAME_RE.fullmatch(self.name):
            raise ValueError(
                "Agent name must be non-empty and contain only letters, "
                "numbers, dots, underscores, or hyphens",
            )
        if self.recursion_limit < 1:
            raise ValueError("Agent recursion_limit must be at least 1")
        _valid_statuses = get_args(AgentStatus)
        if self.status not in _valid_statuses:
            raise ValueError(
                f"Agent status must be one of {_valid_statuses!r}",
            )
        if len(self.rate_limit) != 2 or any(value < 1 for value in self.rate_limit):
            raise ValueError(
                "Agent rate_limit must be (per_minute, per_hour) positive ints",
            )
        _valid_autonomy = get_args(AutonomyLevel)
        for level in self.allowed_autonomy:
            if level not in _valid_autonomy:
                raise ValueError(
                    f"Agent allowed_autonomy entries must be one of {_valid_autonomy!r}",
                )
        # Fix 9: Eagerly compute and cache the context_schema dict so that
        # repeated ``as_dict()`` calls (e.g. on every API list request) pay
        # ``get_type_hints`` cost at most once per agent instance.
        schema = self.context_schema
        if schema is not None and hasattr(schema, "__annotations__"):
            try:
                hints = get_type_hints(schema, include_extras=True)
                _schema_dict: Optional[dict[str, Any]] = {
                    k: getattr(v, "__name__", str(v)) for k, v in hints.items()
                }
            except (TypeError, NameError):
                _schema_dict = {}
        else:
            _schema_dict = None
        object.__setattr__(self, "_cached_schema_dict", _schema_dict)

    def as_dict(self) -> dict[str, Any]:
        """Return the wire-shape the FE consumes for the agent picker."""

        per_minute, per_hour = self.rate_limit
        out: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "status": self.status,
            "rate_limit": {"per_minute": per_minute, "per_hour": per_hour},
            "allowed_autonomy": list(self.allowed_autonomy),
            "tools": list(self.tools),
            "recursion_limit": self.recursion_limit,
            "tags": list(self.tags),
        }
        out["context_schema"] = self._cached_schema_dict  # type: ignore[attr-defined]
        return out


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
        # Fix 4: Cache the (compiled, checkpointer, store) triple as a single
        # atomic tuple so that a reader never sees a partially-updated state.
        # Identity (``is``) comparisons drive invalidation; ``id()`` recycling
        # is safe here because the runtime holds strong refs to both
        # persistence objects for its lifetime.
        self._compiled_state: Optional[tuple[Pregel, Any, Any]] = None
        # ``threading.Lock`` guards cache-field writes from sync ``compile()``
        # and from the cache-update step of async ``acompile()``; this keeps
        # cross-path consistency when sync ``invoke()`` (in a threadpool) and
        # async ``astream()`` (on the event loop) race the first build.  The
        # critical section is brief -- only the one tuple assignment -- so
        # holding it from an async path doesn't block the loop meaningfully.
        self._build_lock = threading.Lock()
        # Fix 3: ``asyncio.Lock`` serialises concurrent async waiters during a
        # cache miss.  Created lazily so that constructing an agent in one
        # event-loop does not bind the lock to that loop -- Python 3.12 warns
        # if you await a lock created in a different loop context.
        self._async_build_lock: Optional[asyncio.Lock] = None
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
        """Inject a chat model (used by the runtime / tests).

        When called after ``compile()`` the cached graph is invalidated so
        the next compile binds the new model.  In-flight invocations
        continue with the previously-bound model: LangGraph's compiled
        graph closes over the model reference, which is the desired
        behaviour for live runs but a frequent source of surprise in
        tests.  A debug log is emitted when the swap forces a rebuild so
        the misuse is greppable rather than invisible.
        """

        self._chat_model = model
        self._chat_model_resolved = True
        # Force a rebuild on next compile so the new model is bound.
        # Hold the build lock while clearing so we don't race with a
        # concurrent compile() or acompile() that may be mid-build.
        with self._build_lock:
            if self._compiled_state is not None:
                logger.debug(
                    "set_chat_model called on %r after compile(); "
                    "next compile() will rebuild with the new model.",
                    self.metadata.name,
                )
            self._compiled_state = None

    def _get_async_build_lock(self) -> asyncio.Lock:
        """Return the async build lock, creating it lazily (Fix 3).

        Lazy creation avoids binding the lock to a specific event loop at
        agent construction time -- Python 3.12 warns when you ``await`` a
        lock that was created in a different loop context, which happens in
        tests that spin up fresh event loops per test.
        """
        lock = self._async_build_lock
        if lock is None:
            with self._build_lock:
                lock = self._async_build_lock
                if lock is None:
                    lock = asyncio.Lock()
                    self._async_build_lock = lock
        return lock

    def _cache_hit(
        self,
        checkpointer: Optional[BaseCheckpointSaver],
        store: Optional[BaseStore],
        force: bool,
    ) -> bool:
        """Return ``True`` when the cached compile matches the supplied
        ``(checkpointer, store)`` pair and ``force`` is not set.

        Identity (``is``) comparison is intentional: the runtime hands a
        single pair to every agent for its lifetime so cache hits dominate
        in production.  Reading ``self._compiled_state`` without a lock is
        safe -- Python attribute reads are atomic and the tuple is only ever
        transitioned ``None -> (compiled, cp, store)`` (never partially
        updated) except in :meth:`set_chat_model`, which is test-only.
        """
        state = self._compiled_state
        return (
            not force
            and state is not None
            and state[1] is checkpointer
            and state[2] is store
        )

    def compile(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
        force: bool = False,
    ) -> Pregel:
        """Return the compiled graph, building it on first access.

        Double-checked locking: a fast path exits without acquiring any
        lock when the cache is warm, and the slow path takes
        :attr:`_build_lock` (a ``threading.Lock``) so that two threads
        racing the cache-miss path produce only one ``self.build()``
        call.
        """

        if self._cache_hit(checkpointer, store, force):
            return self._compiled_state[0]  # type: ignore[index]
        with self._build_lock:
            if self._cache_hit(checkpointer, store, force):
                return self._compiled_state[0]  # type: ignore[index]
            compiled = self.build(checkpointer=checkpointer, store=store)
            self._compiled_state = (compiled, checkpointer, store)
            return compiled

    async def acompile(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
        force: bool = False,
    ) -> Pregel:
        """Async variant of :meth:`compile`; preferred in async contexts.

        Double-checked locking with two layers:

        - :attr:`_async_build_lock` (an ``asyncio.Lock``) serialises
          concurrent async waiters on a cache miss without blocking the
          event loop.  This replaces the prior pattern of routing the
          entire compile through :func:`asyncio.to_thread` purely so all
          waiters could share one ``threading.Lock``.
        - :attr:`_build_lock` (a ``threading.Lock``) is held briefly only
          for the tuple write, keeping cross-path consistency with sync
          :meth:`compile` from a threadpool.

        The actual ``self.build()`` call is dispatched to
        :func:`asyncio.to_thread` because graph compilation is CPU-bound
        and the prior contract did not block the event loop.  Cache hits
        take *neither* lock and return immediately.
        """

        if self._cache_hit(checkpointer, store, force):
            return self._compiled_state[0]  # type: ignore[index]
        async with self._get_async_build_lock():
            if self._cache_hit(checkpointer, store, force):
                return self._compiled_state[0]  # type: ignore[index]
            compiled = await asyncio.to_thread(
                self.build, checkpointer=checkpointer, store=store
            )
            with self._build_lock:
                self._compiled_state = (compiled, checkpointer, store)
            return compiled

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
        # Fix 8: pass config directly -- LangGraph already accepts Mapping.
        graph = self.compile(checkpointer=checkpointer, store=store)
        return graph.invoke(
            self._normalize_input(inputs),
            config=config,
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
        # Fix 8: pass config directly -- LangGraph already accepts Mapping.
        graph = await self.acompile(checkpointer=checkpointer, store=store)
        return await graph.ainvoke(
            self._normalize_input(inputs),
            config=config,
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

        # Fix 8: pass config directly -- LangGraph already accepts Mapping.
        graph = await self.acompile(checkpointer=checkpointer, store=store)
        async for event in graph.astream(
            self._normalize_input(inputs),
            config=config,
            context=context,
            stream_mode=list(stream_mode),
        ):
            yield event
