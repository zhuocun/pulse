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

import base64
import hashlib
import hmac as _hmac
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
    enter_agent_postgres_pool,
    open_checkpointer,
)
from app.agents.errors import (
    AgentConfigurationError,
    AgentError,
    AgentExecutionError,
    AgentRecursionError,
)
from app.agents.context import ChatContext
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

# ---------------------------------------------------------------------------
# Signed thread-key helpers (Phase 6C)
# ---------------------------------------------------------------------------

# Token prefix used to detect the signed envelope format.
_SIGNED_PREFIX = "sigv1."
# NUL byte used as a field separator inside the payload (never valid in a
# thread ID so it cannot be injected).
_SEP = "\x00"


def _signing_key() -> bytes:
    """Return the HMAC-SHA256 signing key (bytes-encoded JWT secret)."""
    from app.config import settings as _settings

    return _settings.jwt_secret.encode()


def sign_thread_key(
    agent_name: str,
    scope: str,
    original_thread_id: str,
) -> str:
    """Return an opaque signed token for ``(agent_name, scope, original_thread_id)``.

    The token is a ``sigv1.<base64url>`` string where the base64url payload
    encodes ``agent_name NUL scope NUL original_thread_id NUL hmac_hex``.
    The HMAC-SHA256 digest is computed over the same three fields so
    the signature covers all components and cannot be stripped or swapped.

    Signing is deterministic: same inputs → same token regardless of call order.
    """
    message = f"{agent_name}{_SEP}{scope}{_SEP}{original_thread_id}"
    digest = _hmac.new(
        _signing_key(), message.encode(), hashlib.sha256
    ).hexdigest()
    payload = f"{agent_name}{_SEP}{scope}{_SEP}{original_thread_id}{_SEP}{digest}"
    encoded = base64.urlsafe_b64encode(payload.encode()).decode()
    return f"{_SIGNED_PREFIX}{encoded}"


def _try_verify_signed_thread_key(
    token: str,
    agent_name: str,
    scope: str,
) -> Optional[str]:
    """Validate a signed token and return the original thread_id, or ``None``.

    Returns ``None`` when:
    - the token does not have the ``sigv1.`` prefix,
    - base64 decoding fails,
    - the payload does not have the expected 4 NUL-separated fields,
    - the embedded agent_name / scope do not match the current call, or
    - the HMAC signature is invalid (constant-time comparison).

    Callers that receive ``None`` should fall back to the iterative-strip
    path for backwards compatibility with unsigned thread IDs.
    """
    if not token.startswith(_SIGNED_PREFIX):
        return None
    encoded = token[len(_SIGNED_PREFIX):]
    try:
        payload = base64.urlsafe_b64decode(encoded.encode()).decode()
    except Exception:  # noqa: BLE001 -- malformed base64
        return None
    parts = payload.split(_SEP, 3)
    if len(parts) != 4:
        return None
    tok_agent, tok_scope, tok_original, tok_digest = parts
    # Reject tokens for a different agent or user scope.
    if tok_agent != agent_name or tok_scope != scope:
        raise ValueError(
            f"Signed thread key rejected: token was issued for "
            f"agent={tok_agent!r} scope={tok_scope!r}, but the current "
            f"call is agent={agent_name!r} scope={scope!r}."
        )
    # Constant-time HMAC comparison.
    message = f"{tok_agent}{_SEP}{tok_scope}{_SEP}{tok_original}"
    expected = _hmac.new(
        _signing_key(), message.encode(), hashlib.sha256
    ).hexdigest()
    if not _hmac.compare_digest(expected, tok_digest):
        raise ValueError(
            "Signed thread key rejected: HMAC signature mismatch."
        )
    return tok_original


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
        # Cache the model id at construction time so every ainvoke/astream
        # request doesn't re-parse settings.  Intentionally snapshotted at
        # construction: set_chat_model testing uses the model directly and
        # span attribution is informational only.
        self._model_id: str = resolved_chat_model_id()

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

        checkpointer_spec = build_checkpointer(
            settings.agent_checkpoint_backend, settings=settings
        )
        store_spec = build_store(settings.agent_store_backend, settings=settings)

        # One AsyncConnectionPool for both LangGraph layers when they target the
        # same resolved DSN; otherwise each postgres open_* allocates its own.
        shared_pool = None
        if isinstance(checkpointer_spec, PostgresCheckpointerSpec) and isinstance(
            store_spec, PostgresStoreSpec
        ):
            if checkpointer_spec.conn_string == store_spec.conn_string:
                shared_pool = await enter_agent_postgres_pool(
                    stack, checkpointer_spec.conn_string, settings
                )

        checkpointer = await open_checkpointer(
            settings.agent_checkpoint_backend,
            stack=stack,
            settings=settings,
            pool=shared_pool,
        )
        store = await open_store(
            settings.agent_store_backend,
            stack=stack,
            settings=settings,
            pool=shared_pool,
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

    def list_metadata(self, *, include_shadow: bool = False) -> list[AgentMetadata]:
        return self._registry.metadata(include_shadow=include_shadow)

    def get(self, name: str, *, include_shadow: bool = False) -> BaseAgent:
        return self._registry.get(name, include_shadow=include_shadow)

    def _namespaced_thread(
        self,
        agent: BaseAgent,
        thread_id: Optional[str],
        user_id: Optional[str] = None,
    ) -> str:
        """Namespace the thread id by ``(agent, user)``.

        The canonical form is ``{agent}:{scope}:{tail}`` where ``scope``
        is the authenticated user_id (or ``"anon"``).

        **Signed path** (preferred, Phase 6C): if ``thread_id`` starts with
        the ``sigv1.`` prefix, it is treated as an HMAC-signed envelope.  The
        signature is validated against the JWT secret and the original thread
        ID is extracted.  A mismatched agent/scope or invalid HMAC raises
        :class:`ValueError` immediately so prefix-injection via a stolen token
        is rejected with a clear error rather than silently re-scoped.

        **Unsigned fallback** (backwards compat): plain thread IDs (no
        ``sigv1.`` prefix) are processed with the original iterative-strip
        logic so rolling restarts and older clients remain functional.  All
        leading ``{agent}:{any_segment}:`` prefixes are stripped iteratively
        before the canonical prefix for the current user is reapplied.  This
        protects against chained prefix injection
        (``agent:u1:agent:u2:tail`` → ``tail`` → ``agent:u_current:tail``).
        """

        raw = (thread_id or self._default_thread_id).strip()
        if not raw:
            raw = self._default_thread_id
        scope = (user_id or "anon").strip() or "anon"
        prefix = f"{agent.name}:{scope}:"

        # ------------------------------------------------------------------
        # Signed path: validate and unwrap the HMAC envelope.
        # ------------------------------------------------------------------
        if raw.startswith(_SIGNED_PREFIX):
            original = _try_verify_signed_thread_key(raw, agent.name, scope)
            if original is None:
                # Malformed envelope; treat as an unsigned id to preserve
                # rolling-restart safety (the new server code may restart
                # while old clients are mid-flight with a plain id that
                # coincidentally starts with "sigv1." -- extremely unlikely
                # but handle gracefully).
                pass
            else:
                base = original.strip() or self._default_thread_id
                return f"{prefix}{base}"

        # ------------------------------------------------------------------
        # Unsigned fallback: iterative-strip (backwards compat).
        # ------------------------------------------------------------------
        base = raw
        agent_prefix = f"{agent.name}:"
        # Iteratively strip all leading ``{agent}:{any_segment}:`` prefixes
        # so a chained injection like ``agent:u1:agent:u2:tail`` is reduced
        # to ``tail`` rather than ``agent:u2:tail`` after the first pass.
        # When the stripped form has no second colon (legacy ``{agent}:{tail}``
        # format), the remaining segment IS the tail -- preserve it.
        while base.startswith(agent_prefix):
            remainder = base[len(agent_prefix):]
            first_colon = remainder.find(":")
            if first_colon != -1:
                # Has another scope segment; strip it and loop again in case
                # of further chained agent prefixes.
                stripped = remainder[first_colon + 1:]
                base = stripped or self._default_thread_id
            else:
                # Legacy ``{agent}:{tail}`` with no scope component -- the
                # remainder is the tail itself (not a scope to drop).
                base = remainder or self._default_thread_id
                break
        return f"{prefix}{base}"

    def _resolved_recursion_limit(self, agent: BaseAgent) -> int:
        return min(agent.metadata.recursion_limit, self._recursion_limit)

    def set_chat_model(self, name: str, model: Any) -> None:
        """Set the default chat model for the named agent.

        The model is stored on the agent instance via
        :meth:`~app.agents.base.BaseAgent.set_chat_model` and then propagated
        onto the per-call context by :meth:`_build_context` so every
        subsequent invocation uses the new default.

        This is the primary injection point for tests: calling
        ``runtime.set_chat_model("board-brief-agent", fake_model)`` is
        equivalent to the old pattern of ``agent.set_chat_model(fake_model)``
        but also ensures the context carries the model for the new per-call
        context path.
        """
        self.get(name).set_chat_model(model)

    def _build_context(
        self,
        agent: BaseAgent,
        caller_context: Any,
        *,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> Any:
        """Resolve a context object for one agent call.

        For catalog agents that declare ``context_schema=ChatContext`` (or
        no context_schema at all), the runtime builds and returns a
        :class:`~app.agents.context.ChatContext` dict with the resolved
        ``chat_model``.  Resolution order:

        1. ``caller_context["chat_model"]`` — enables per-request overrides;
           TODO wire to ``X-Pulse-Model`` header / tenant config in Phase 5.
        2. Agent's own ``chat_model`` property (resolved lazily from settings
           on first access).

        For agents with a *different* ``context_schema`` (e.g. test-only
        agents, or future agents with specialised contexts), the caller's
        context is returned unchanged so LangGraph can coerce it against the
        declared schema without a ``KeyError``.

        ``user_id`` and ``project_id`` are informational fields mirrored from
        ``configurable``.
        """
        schema = agent.metadata.context_schema
        if schema is not None and schema is not ChatContext:
            # Non-ChatContext agent: pass caller's context through unchanged.
            return caller_context

        # ChatContext agent (or no declared schema): inject the resolved model.
        ctx_model: Any = None
        if isinstance(caller_context, dict):
            ctx_model = caller_context.get("chat_model")
        if ctx_model is None:
            ctx_model = agent.chat_model
        ctx: ChatContext = {"chat_model": ctx_model}
        if user_id is not None:
            ctx["user_id"] = user_id
        if project_id is not None:
            ctx["project_id"] = project_id
        return ctx

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
        resolved_context = self._build_context(
            agent, context, user_id=user_id, project_id=_project_id(inputs)
        )
        try:
            return agent.invoke(
                inputs,
                config=config,
                context=resolved_context,
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
        resolved_context = self._build_context(
            agent, context, user_id=user_id, project_id=_project_id(inputs)
        )
        with start_run_span(
            operation="invoke_agent",
            agent_name=name,
            model_id=self._model_id,
            project_id=_project_id(inputs),
            autonomy=_autonomy(inputs),
        ) as run_span:
            try:
                result = await agent.ainvoke(
                    graph_input,
                    config=config,
                    context=resolved_context,
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

    async def arun_with_events(
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
    ) -> tuple[Any, list[Any]]:
        """Run agent ``name`` to completion, capturing custom events.

        Returns ``(final_state, events)`` where ``events`` is
        ``final_state.get("events", [])``.  The first element is the
        agent's final state dict; the second is the ordered list of event
        dicts accumulated on ``state["events"]`` during the run (Phase 2
        — events are first-class state, not side-effects).

        The same span / error-translation machinery as :meth:`ainvoke`
        wraps the run, so OTel and Prometheus dimensions stay aligned
        across the two entry points.
        """

        agent = self.get(name)
        config = self.build_config(
            agent,
            thread_id=thread_id,
            user_id=user_id,
            assistant_id=assistant_id,
            tags=tags,
        )
        graph_input = self._resume_input(inputs, resume, thread_id)
        resolved_context = self._build_context(
            agent, context, user_id=user_id, project_id=_project_id(inputs)
        )
        final_state: Any = None
        with start_run_span(
            operation="run_agent_with_events",
            agent_name=name,
            model_id=self._model_id,
            project_id=_project_id(inputs),
            autonomy=_autonomy(inputs),
        ) as run_span:
            try:
                async for mode, payload in agent.astream(
                    graph_input,
                    config=config,
                    context=resolved_context,
                    stream_mode=("values", "custom"),
                    checkpointer=self._checkpointer,
                    store=self._store,
                ):
                    if mode == "values":
                        # ``values`` yields after every superstep; the last
                        # one is the final state.  Overwriting is correct.
                        final_state = payload
            except AgentError:
                raise
            except GraphRecursionError as exc:
                raise AgentRecursionError(
                    name, self._resolved_recursion_limit(agent)
                ) from exc
            except Exception as exc:  # noqa: BLE001 -- intentional translation boundary
                logger.exception(
                    "Agent %r failed during arun_with_events.", name
                )
                raise AgentExecutionError(name, cause=exc) from exc
            run_span.set_result(final_state)
            # Source events from state (Phase 2); fall back to empty list when
            # the agent pre-dates the ``events`` field (e.g. test-only agents).
            events: list[Any] = list(
                (final_state or {}).get("events") or []
            )
            return final_state, events

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
        resolved_context = self._build_context(
            agent, context, user_id=user_id, project_id=_project_id(inputs)
        )
        # Track how many events we have already surfaced as ``custom`` chunks
        # so we can emit exactly the new ones after each superstep.
        _emitted_event_count = 0
        # Determine which modes to request from LangGraph. We always add
        # ``"values"`` so we can diff the ``events`` list after each superstep
        # and re-emit new entries as ``custom`` chunks (Phase 2 SSE re-emission).
        _request_modes: tuple[str, ...] = stream_mode
        _need_values = "values" not in stream_mode
        if _need_values:
            _request_modes = stream_mode + ("values",)
        with start_run_span(
            operation="stream_agent",
            agent_name=name,
            model_id=self._model_id,
            project_id=_project_id(inputs),
            autonomy=_autonomy(inputs),
        ) as run_span:
            try:
                async for event in agent.astream(
                    graph_input,
                    config=config,
                    context=resolved_context,
                    stream_mode=_request_modes,
                    checkpointer=self._checkpointer,
                    store=self._store,
                ):
                    mode, payload = event
                    if mode == "values":
                        # After each superstep, emit new state-events as
                        # ``custom`` chunks so SSE consumers see the same
                        # wire shape regardless of whether the node used
                        # ``emit_custom`` or returned ``{"events": [...]}``.
                        current_events: list[Any] = list(
                            (payload or {}).get("events") or []
                        )
                        for evt in current_events[_emitted_event_count:]:
                            yield ("custom", evt)
                        _emitted_event_count = len(current_events)
                        if _need_values:
                            # Caller did not ask for ``values``; skip it.
                            continue
                    yield event
            except AgentError:
                await self._aggregate_astream_tokens_no_propagate(
                    agent, config, run_span
                )
                raise
            except GraphRecursionError as exc:
                await self._aggregate_astream_tokens_no_propagate(
                    agent, config, run_span
                )
                raise AgentRecursionError(
                    name, self._resolved_recursion_limit(agent)
                ) from exc
            except Exception as exc:  # noqa: BLE001 -- intentional translation boundary
                await self._aggregate_astream_tokens_no_propagate(
                    agent, config, run_span
                )
                logger.exception("Agent %r failed during astream.", name)
                raise AgentExecutionError(name, cause=exc) from exc
            else:
                # On a successful stream, aggregate token usage from the
                # final graph state so OTel and Prometheus see real token
                # counts instead of always 0. AgentError from aggregation
                # surfaces normally on this path so a misbehaving graph is
                # visible; on the failure paths above we suppress it to
                # preserve the original exception cause.
                if self._checkpointer is not None:
                    try:
                        await self._aggregate_astream_tokens(
                            agent, config, run_span
                        )
                    except AgentError:
                        raise
                    except (LookupError, KeyError, ValueError, RuntimeError):
                        logger.debug(
                            "astream token aggregation failed; span will show 0 tokens.",
                            exc_info=True,
                        )

    async def _aggregate_astream_tokens(
        self,
        agent: BaseAgent,
        config: Mapping[str, Any],
        run_span: Any,
    ) -> None:
        """Read the final graph state and report token totals on the span.

        Lets exceptions propagate so callers can decide whether to swallow
        (failure paths) or surface (success path).  Callers must gate on
        ``self._checkpointer is not None`` — no checkpointer means no
        persisted final state to read back.
        """

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

    async def _aggregate_astream_tokens_no_propagate(
        self,
        agent: BaseAgent,
        config: Mapping[str, Any],
        run_span: Any,
    ) -> None:
        """Best-effort aggregation on failure paths.

        Runs after a translated exception is in flight; the original cause
        must win, so any aggregation failure (including AgentError) is
        swallowed.  Without a checkpointer there's no state to read.
        """

        if self._checkpointer is None:
            return
        try:
            await self._aggregate_astream_tokens(agent, config, run_span)
        except (AgentError, LookupError, KeyError, ValueError, RuntimeError):
            logger.debug(
                "Token aggregation during failure cleanup failed; span will show 0 tokens.",
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
