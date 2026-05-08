"""Per-process orchestration glue.

The runtime is the single object the rest of the application (FastAPI
lifespan, routers, services, tests) needs to hold a reference to. It owns:

- the :class:`AgentRegistry` (defaults to the module-level singleton, but
  is overridable for tests),
- the shared LangGraph short-term :class:`BaseCheckpointSaver`,
- the shared LangGraph long-term :class:`BaseStore`,
- a default ``thread_id`` for stateful runs when callers don't pass one,
- a process-wide ``recursion_limit`` ceiling that each agent may tighten
  via :attr:`AgentMetadata.recursion_limit`.

It also normalizes invocation: it builds the ``RunnableConfig`` (with a
namespaced ``thread_id`` so two agents can't collide on the same id),
forwards the v1.x ``context=`` argument, applies the recursion limit, and
translates LangGraph / LangChain exceptions into typed
:class:`app.agents.errors.AgentError` subclasses so FastAPI's existing
exception handler renders them as JSON without leaking tracebacks.
"""

from __future__ import annotations

import logging
from contextlib import AsyncExitStack
from typing import Any, AsyncIterator, Mapping, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.errors import GraphRecursionError
from langgraph.store.base import BaseStore
from langgraph.types import Command

from app.agents.base import AgentMetadata, BaseAgent
from app.agents.checkpointing import (
    PostgresCheckpointerSpec,
    build_checkpointer,
    open_checkpointer,
)
from app.agents.errors import (
    AgentConfigurationError,
    AgentError,
    AgentExecutionError,
    AgentRecursionError,
)
from app.agents.instrumentation import start_run_span
from app.agents.llm import extract_token_usage, resolved_chat_model_id
from app.agents.registry import AgentRegistry
from app.agents.registry import registry as default_registry
from app.agents.stores import (
    PostgresStoreSpec,
    build_store,
    open_store,
)

logger = logging.getLogger(__name__)


class AgentRuntime:
    def __init__(
        self,
        *,
        checkpointer: Optional[BaseCheckpointSaver] = None,
        store: Optional[BaseStore] = None,
        registry: Optional[AgentRegistry] = None,
        default_thread_id: str = "default",
        recursion_limit: int = 25,
    ) -> None:
        default_thread_id = default_thread_id.strip()
        if not default_thread_id:
            raise ValueError("default_thread_id must be non-empty")
        if recursion_limit < 1:
            raise ValueError("recursion_limit must be at least 1")
        self._checkpointer = checkpointer
        self._store = store
        self._registry = registry if registry is not None else default_registry
        self._default_thread_id = default_thread_id
        self._recursion_limit = recursion_limit

    @classmethod
    def from_settings(
        cls,
        settings: Any,
        *,
        registry: Optional[AgentRegistry] = None,
    ) -> "AgentRuntime":
        checkpointer = build_checkpointer(
            settings.agent_checkpoint_backend, settings=settings
        )
        store = build_store(settings.agent_store_backend, settings=settings)
        if isinstance(checkpointer, PostgresCheckpointerSpec) or isinstance(
            store, PostgresStoreSpec
        ):
            raise AgentConfigurationError(
                "Postgres-backed agent persistence requires async setup; use "
                "AgentRuntime.from_settings_async(settings, stack=stack) instead.",
            )
        return cls(
            checkpointer=checkpointer,
            store=store,
            registry=registry,
            default_thread_id=settings.agent_default_thread_id,
            recursion_limit=settings.agent_recursion_limit,
        )

    @classmethod
    async def from_settings_async(
        cls,
        settings: Any,
        *,
        stack: AsyncExitStack,
        registry: Optional[AgentRegistry] = None,
    ) -> "AgentRuntime":
        """Async variant that supports the postgres backend.

        Postgres-backed checkpointers / stores require entering an async
        context manager and awaiting ``setup()``; the FastAPI lifespan
        owns an :class:`AsyncExitStack` for exactly this purpose. Memory
        / none backends pass through unchanged so this is safe to call
        from the lifespan regardless of which backend is configured.
        """

        checkpointer = await open_checkpointer(
            settings.agent_checkpoint_backend, stack=stack, settings=settings
        )
        store = await open_store(
            settings.agent_store_backend, stack=stack, settings=settings
        )
        return cls(
            checkpointer=checkpointer,
            store=store,
            registry=registry,
            default_thread_id=settings.agent_default_thread_id,
            recursion_limit=settings.agent_recursion_limit,
        )

    @property
    def checkpointer(self) -> Optional[BaseCheckpointSaver]:
        return self._checkpointer

    @property
    def store(self) -> Optional[BaseStore]:
        return self._store

    @property
    def registry(self) -> AgentRegistry:
        return self._registry

    @property
    def recursion_limit(self) -> int:
        return self._recursion_limit

    def list_metadata(self) -> list[AgentMetadata]:
        return self._registry.metadata()

    def get(self, name: str) -> BaseAgent:
        return self._registry.get(name)

    def _namespaced_thread(
        self,
        agent: BaseAgent,
        thread_id: Optional[str],
        user_id: Optional[str] = None,
    ) -> str:
        """Namespace the thread id by ``(agent, user)``.

        The canonical form is ``{agent}:{scope}:{tail}`` where ``scope``
        is the authenticated user_id (or ``"anon"``). To prevent a
        client from binding a checkpoint to another user's namespace by
        injecting a victim's prefix, any pre-existing ``{agent}:*:``
        prefix on the supplied id is stripped before the canonical
        prefix for the current user is reapplied. The legitimate case
        where a client round-trips its own previously-namespaced id is
        preserved -- the strip + reapply produces the same final id.
        """

        base = (thread_id or self._default_thread_id).strip()
        if not base:
            base = self._default_thread_id
        scope = (user_id or "anon").strip() or "anon"
        prefix = f"{agent.name}:{scope}:"
        agent_prefix = f"{agent.name}:"
        if base.startswith(agent_prefix):
            remainder = base[len(agent_prefix):]
            # Drop a leading ``<scope>:`` segment so a client cannot
            # bind their work to another user's thread by replaying a
            # ``{agent}:{victim}:{tail}`` id. The unscoped tail is the
            # only part the caller "owns"; we re-namespace it below.
            first_colon = remainder.find(":")
            if first_colon != -1:
                remainder = remainder[first_colon + 1:]
            base = remainder or self._default_thread_id
        return f"{prefix}{base}"

    def _resolved_recursion_limit(self, agent: BaseAgent) -> int:
        return min(agent.metadata.recursion_limit, self._recursion_limit)

    def build_config(
        self,
        agent: BaseAgent,
        *,
        thread_id: Optional[str] = None,
        user_id: Optional[str] = None,
        assistant_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Build a LangGraph ``RunnableConfig`` for ``agent``.

        Only LangGraph-internal keys (``thread_id``, ``user_id``,
        ``assistant_id``) go into ``configurable``; everything else
        belongs in ``context_schema`` / ``Runtime[Context]`` per the
        v1.x recommendation.
        """

        configurable: dict[str, Any] = {
            "thread_id": self._namespaced_thread(agent, thread_id, user_id),
        }
        if user_id is not None:
            configurable["user_id"] = user_id
        if assistant_id is not None:
            configurable["assistant_id"] = assistant_id

        config: dict[str, Any] = {
            "configurable": configurable,
            "recursion_limit": self._resolved_recursion_limit(agent),
        }
        if tags:
            config["tags"] = list(tags)
        return config

    def invoke(
        self,
        name: str,
        inputs: Mapping[str, Any],
        *,
        thread_id: Optional[str] = None,
        user_id: Optional[str] = None,
        assistant_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        context: Any = None,
    ) -> Any:
        """Synchronous invoke. Postgres-backed runtimes should prefer
        :meth:`ainvoke` since the underlying ``AsyncPostgresSaver`` only
        exposes async I/O and the sync path can deadlock under load."""

        agent = self.get(name)
        config = self.build_config(
            agent,
            thread_id=thread_id,
            user_id=user_id,
            assistant_id=assistant_id,
            tags=tags,
        )
        try:
            return agent.invoke(
                inputs,
                config=config,
                context=context,
                checkpointer=self._checkpointer,
                store=self._store,
            )
        except AgentError:
            raise
        except GraphRecursionError as exc:
            raise AgentRecursionError(
                name, self._resolved_recursion_limit(agent)
            ) from exc
        except Exception as exc:  # noqa: BLE001 -- intentional translation boundary
            logger.exception("Agent %r failed during invoke.", name)
            raise AgentExecutionError(name, cause=exc) from exc

    def _resume_input(
        self,
        inputs: Mapping[str, Any],
        resume: Any,
        thread_id: Optional[str],
    ) -> Any:
        """Translate ``(inputs, resume)`` into the value passed to LangGraph.

        When ``resume`` is provided, the runtime forwards a
        :class:`langgraph.types.Command` instead of the inputs dict so the
        graph rewinds to the matching ``interrupt`` and continues. A
        ``thread_id`` is required so LangGraph can locate the paused state,
        and so is a configured checkpointer -- without one the paused
        state simply does not exist.
        """

        if resume is None:
            return dict(inputs)
        if inputs:
            raise AgentConfigurationError(
                "Cannot supply both 'inputs' and 'resume' on the same call",
            )
        if not thread_id or not thread_id.strip():
            raise AgentConfigurationError(
                "thread_id is required to resume an interrupted agent",
            )
        if self._checkpointer is None:
            raise AgentConfigurationError(
                "Resume requires a configured checkpointer; "
                "AGENT_CHECKPOINT_BACKEND must not be 'none'.",
            )
        return Command(resume=resume)

    async def ainvoke(
        self,
        name: str,
        inputs: Mapping[str, Any],
        *,
        thread_id: Optional[str] = None,
        user_id: Optional[str] = None,
        assistant_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        context: Any = None,
        resume: Any = None,
    ) -> Any:
        agent = self.get(name)
        config = self.build_config(
            agent,
            thread_id=thread_id,
            user_id=user_id,
            assistant_id=assistant_id,
            tags=tags,
        )
        graph_input = self._resume_input(inputs, resume, thread_id)
        model_id = resolved_chat_model_id()
        with start_run_span(
            operation="invoke_agent",
            agent_name=name,
            model_id=model_id,
            project_id=_project_id(inputs),
            autonomy=_autonomy(inputs),
        ) as run_span:
            try:
                result = await agent.ainvoke(
                    graph_input,
                    config=config,
                    context=context,
                    checkpointer=self._checkpointer,
                    store=self._store,
                )
            except AgentError:
                raise
            except GraphRecursionError as exc:
                raise AgentRecursionError(
                    name, self._resolved_recursion_limit(agent)
                ) from exc
            except Exception as exc:  # noqa: BLE001 -- intentional translation boundary
                logger.exception("Agent %r failed during ainvoke.", name)
                raise AgentExecutionError(name, cause=exc) from exc
            run_span.set_result(result)
            return result

    async def astream(
        self,
        name: str,
        inputs: Mapping[str, Any],
        *,
        thread_id: Optional[str] = None,
        user_id: Optional[str] = None,
        assistant_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        context: Any = None,
        resume: Any = None,
        stream_mode: tuple[str, ...] = ("updates", "messages", "custom"),
    ) -> AsyncIterator[tuple[str, Any]]:
        agent = self.get(name)
        config = self.build_config(
            agent,
            thread_id=thread_id,
            user_id=user_id,
            assistant_id=assistant_id,
            tags=tags,
        )
        graph_input = self._resume_input(inputs, resume, thread_id)
        model_id = resolved_chat_model_id()
        with start_run_span(
            operation="stream_agent",
            agent_name=name,
            model_id=model_id,
            project_id=_project_id(inputs),
            autonomy=_autonomy(inputs),
        ) as run_span:
            try:
                async for event in agent.astream(
                    graph_input,
                    config=config,
                    context=context,
                    stream_mode=stream_mode,
                    checkpointer=self._checkpointer,
                    store=self._store,
                ):
                    yield event
            except AgentError:
                raise
            except GraphRecursionError as exc:
                raise AgentRecursionError(
                    name, self._resolved_recursion_limit(agent)
                ) from exc
            except Exception as exc:  # noqa: BLE001 -- intentional translation boundary
                logger.exception("Agent %r failed during astream.", name)
                raise AgentExecutionError(name, cause=exc) from exc
            else:
                # On a successful stream, aggregate token usage from the
                # final graph state so OTel and Prometheus see real token
                # counts instead of always 0. This requires a checkpointer
                # to read back the final state; without one we leave the
                # span at 0 rather than spend extra graph calls.
                if self._checkpointer is not None:
                    try:
                        graph = await agent.acompile(
                            checkpointer=self._checkpointer,
                            store=self._store,
                        )
                        final_state = await graph.aget_state(config)
                        messages = (final_state.values or {}).get("messages") or []
                        tokens_in = 0
                        tokens_out = 0
                        for msg in messages:
                            ti, to = extract_token_usage(msg)
                            tokens_in += ti
                            tokens_out += to
                        run_span.set_token_usage(tokens_in, tokens_out)
                    except Exception:  # noqa: BLE001 -- best-effort; never fail the stream
                        logger.debug(
                            "astream token aggregation failed; span will show 0 tokens.",
                            exc_info=True,
                        )


def _project_id(inputs: Mapping[str, Any]) -> Optional[str]:
    """Pull ``project_id`` off the inputs for span tagging.

    Catalog agents standardise on a top-level ``project_id`` so the
    budget tracker can debit the right account; surfacing it on the
    span lets dashboards slice by tenant without a separate
    ``inputs[*]`` projection.
    """

    if not isinstance(inputs, Mapping):
        return None
    value = inputs.get("project_id")
    return value if isinstance(value, str) and value else None


def _autonomy(inputs: Mapping[str, Any]) -> Optional[str]:
    """Pull the resolved autonomy level off the inputs for span tagging."""

    if not isinstance(inputs, Mapping):
        return None
    value = inputs.get("autonomy_level")
    return value if isinstance(value, str) and value else None
