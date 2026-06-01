"""Provider-agnostic chat-model factory.

The factory hides three concerns from the catalog:

1. Detecting which provider to use. ``AGENT_CHAT_MODEL_PROVIDER=auto`` (the
   default) inspects the environment and picks Anthropic if
   ``ANTHROPIC_API_KEY`` is set, OpenAI if ``OPENAI_API_KEY`` is set,
   DeepSeek if ``DEEPSEEK_API_KEY`` is set, and the deterministic stub
   otherwise. Explicit values (``anthropic``, ``openai``, ``deepseek``,
   ``stub``) skip the auto-detect.
2. Importing the right LangChain integration package only when it is
   actually needed -- ``langchain-anthropic`` and ``langchain-openai`` are
   optional dependencies, so a deployment that never wants real LLMs does
   not need to install them.
3. Telling the catalog whether the model in hand is a real one. Phase A
   agents fall back to deterministic Python when handed the stub so unit
   tests stay hermetic; with a real model they invoke it via
   ``with_structured_output(...)`` for typed payloads.

Bumping providers, swapping LangChain versions, or wiring a gateway like
LiteLLM is a single-file change as long as :func:`make_chat_model` keeps
returning a ``BaseChatModel``.

Anthropic prompt-caching contract
----------------------------------
``langchain-anthropic>=0.3.0`` (the pinned lower bound) transparently
forwards ``cache_control: {"type": "ephemeral"}`` blocks that callers
place on message content blocks or tool definitions -- no beta header
or extra constructor kwarg is needed at the SDK level. This factory
therefore does **not** add any ``extra_headers``; it simply must not
*strip* cache_control. The instantiation in :func:`_instantiate_chat_model`
passes only the supported constructor kwargs so unknown fields on content
blocks are left untouched by langchain-anthropic and forwarded verbatim
to the Anthropic SDK. Callers (typically catalog system-message builders)
are responsible for adding ``cache_control`` markers where appropriate.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import itertools
import json
import logging
import time
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app.config import Settings, settings as default_settings
from app.deploy_env import (
    HOSTED_PLATFORM_ENV_MARKERS,
    detected_hosted_platform,
    has_hosted_platform_env,
)

logger = logging.getLogger(__name__)

PROVIDER_AUTO = "auto"
PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_OPENAI = "openai"
PROVIDER_DEEPSEEK = "deepseek"
PROVIDER_STUB = "stub"

SUPPORTED_PROVIDERS = frozenset(
    {
        PROVIDER_AUTO,
        PROVIDER_ANTHROPIC,
        PROVIDER_OPENAI,
        PROVIDER_DEEPSEEK,
        PROVIDER_STUB,
    }
)

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# (langchain integration module, pyproject extras name) per provider.
_PROVIDER_PACKAGES: dict[str, tuple[str, str]] = {
    PROVIDER_ANTHROPIC: ("langchain_anthropic", "anthropic"),
    PROVIDER_OPENAI: ("langchain_openai", "openai"),
    PROVIDER_DEEPSEEK: ("langchain_openai", "openai"),
}


def _require_integration(provider: str) -> None:
    """Import the langchain integration for ``provider`` or raise.

    Shared between :func:`make_chat_model` (right before instantiating
    the chat-model class) and :func:`assert_provider_available` (at
    boot) so the user-facing remediation copy stays consistent.
    """

    package = _PROVIDER_PACKAGES.get(provider)
    if package is None:
        return
    module_name, extra_name = package
    try:
        importlib.import_module(module_name)
    except ImportError as exc:
        dist_name = module_name.replace("_", "-")
        raise RuntimeError(
            f"{dist_name} is not installed but AGENT_CHAT_MODEL_PROVIDER "
            f"resolved to '{provider}'. Run "
            f'`pip install ".[{extra_name}]"` (or `".[ai]"`) or set '
            "AGENT_CHAT_MODEL_PROVIDER=stub."
        ) from exc


@dataclass(frozen=True)
class ChatModelSpec:
    """Resolved chat-model configuration.

    ``provider`` is one of the concrete providers (never ``"auto"``).
    ``model`` is the provider-specific model id (e.g. ``claude-sonnet-4-6``).
    ``temperature`` is forwarded to providers that accept it.
    ``api_key`` is captured at resolution time so a later env mutation does
    not silently change runtime behaviour.
    """

    provider: str
    model: str
    temperature: float = 0.2
    api_key: str = ""
    base_url: str = ""
    max_retries: int = 2
    timeout_seconds: float = 30.0

    @property
    def is_stub(self) -> bool:
        return self.provider == PROVIDER_STUB


def _detect_provider(settings: Settings) -> str:
    """Pick a concrete provider based on env when ``provider=auto``."""

    if settings.anthropic_api_key:
        return PROVIDER_ANTHROPIC
    if settings.openai_api_key:
        return PROVIDER_OPENAI
    if settings.deepseek_api_key:
        return PROVIDER_DEEPSEEK
    return PROVIDER_STUB


def resolve_chat_model_spec(
    settings: Optional[Settings] = None,
) -> ChatModelSpec:
    """Translate :class:`Settings` into a :class:`ChatModelSpec`.

    Validates the configured provider, runs auto-detection, and applies
    sensible defaults for the model id when the operator left it blank.
    """

    cfg = settings if settings is not None else default_settings
    raw = (cfg.agent_chat_model_provider or PROVIDER_AUTO).strip().lower()
    if raw not in SUPPORTED_PROVIDERS:
        raise RuntimeError(
            f"Unsupported AGENT_CHAT_MODEL_PROVIDER={raw!r}; expected one of "
            + ", ".join(sorted(SUPPORTED_PROVIDERS))
        )
    provider = _detect_provider(cfg) if raw == PROVIDER_AUTO else raw
    if provider == PROVIDER_ANTHROPIC:
        model = cfg.agent_chat_model_id or DEFAULT_ANTHROPIC_MODEL
        api_key = cfg.anthropic_api_key
    elif provider == PROVIDER_OPENAI:
        model = cfg.agent_chat_model_id or DEFAULT_OPENAI_MODEL
        api_key = cfg.openai_api_key
        base_url = ""
    elif provider == PROVIDER_DEEPSEEK:
        model = cfg.agent_chat_model_id or DEFAULT_DEEPSEEK_MODEL
        api_key = cfg.deepseek_api_key
        base_url = DEEPSEEK_BASE_URL
    else:
        model = cfg.agent_chat_model_id or "stub"
        api_key = ""
        base_url = ""
    if provider == PROVIDER_ANTHROPIC:
        base_url = ""
    return ChatModelSpec(
        provider=provider,
        model=model,
        temperature=cfg.agent_chat_model_temperature,
        api_key=api_key,
        base_url=base_url,
        max_retries=cfg.agent_chat_model_max_retries,
        timeout_seconds=cfg.agent_chat_model_timeout_seconds,
    )


def resolved_chat_model_id(settings: Optional[Settings] = None) -> str:
    """Provider model id for logging / OTel (no network I/O)."""

    return resolve_chat_model_spec(settings).model


def is_chat_model_allowed(model_id: str, settings: Optional[Settings] = None) -> bool:
    """Return ``True`` when ``model_id`` is in the configured allowlist.

    Used by router-level handlers that read the ``X-Pulse-Model`` request
    header.  An empty allowlist means the header-override feature is
    disabled entirely; this returns ``False`` in that case so the caller
    surfaces a 4xx (or ignores the header, depending on policy) rather
    than silently building a model the operator never authorised.
    """

    cfg = settings if settings is not None else default_settings
    allow = cfg.agent_chat_model_allowlist
    return bool(allow) and model_id.strip() in allow


def make_chat_model_for_id(
    model_id: str,
    *,
    settings: Optional[Settings] = None,
) -> BaseChatModel:
    """Build a chat model for ``model_id`` using the configured provider.

    The provider (Anthropic / OpenAI / stub) and credentials come from
    ``settings``; only the *model id* is overridden.  This is the
    intentional split: per-request callers cannot switch providers (would
    require a per-request API key), only swap to another model on the
    already-authenticated provider.

    Caller is responsible for checking :func:`is_chat_model_allowed`
    first; this function does **not** enforce the allowlist.
    """

    cfg = settings if settings is not None else default_settings
    base = resolve_chat_model_spec(cfg)
    spec = ChatModelSpec(
        provider=base.provider,
        model=model_id.strip(),
        temperature=base.temperature,
        api_key=base.api_key,
        base_url=base.base_url,
        max_retries=base.max_retries,
        timeout_seconds=base.timeout_seconds,
    )
    return make_chat_model(spec)


def make_stub_chat_model(purpose: str = "stub") -> GenericFakeChatModel:
    """Return a ``GenericFakeChatModel`` that emits a single deterministic JSON message.

    Preserved for backwards compatibility with the Phase A test suite -- new
    callers should use :func:`make_chat_model` and check ``is_stub_model``.
    """

    sample = AIMessage(content=json.dumps({"purpose": purpose, "result": "ok"}))
    # Use itertools.cycle so repeated invoke() calls on the same stub model
    # always return the same deterministic response rather than raising
    # StopIteration after the first call.
    return GenericFakeChatModel(messages=itertools.cycle([sample]))


def make_chat_model(
    spec: Optional[ChatModelSpec] = None,
    *,
    settings: Optional[Settings] = None,
) -> BaseChatModel:
    """Build a :class:`BaseChatModel` for ``spec`` (or the resolved default).

    ``spec`` may be passed directly (e.g. by tests) to force a particular
    provider; otherwise the spec is resolved from ``settings`` (or the
    process-wide :data:`app.config.settings` when omitted).

    Real providers raise :class:`RuntimeError` if the matching LangChain
    integration package is not installed -- importing inside the branch
    keeps optional dependencies optional.

    When ``AGENT_CHAT_MODEL_FAILOVER`` is ``auto`` (default) and
    credentials for a second provider exist, the primary model is wrapped
    with a cross-provider :meth:`~langchain_core.language_models.BaseChatModel.with_fallbacks`
    chain so transport / 5xx errors on one vendor retry on the other.
    """

    resolved = spec if spec is not None else resolve_chat_model_spec(settings)
    cfg = settings if settings is not None else default_settings
    primary = _instantiate_chat_model(resolved)
    return _wrap_cross_provider_failover(primary, resolved, cfg)


def _instantiate_chat_model(resolved: ChatModelSpec) -> BaseChatModel:
    _require_integration(resolved.provider)
    if resolved.provider == PROVIDER_ANTHROPIC:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=resolved.model,
            temperature=resolved.temperature,
            api_key=resolved.api_key or None,
            max_retries=resolved.max_retries,
            timeout=resolved.timeout_seconds,
        )
    if resolved.provider in (PROVIDER_OPENAI, PROVIDER_DEEPSEEK):
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            temperature=resolved.temperature,
            api_key=resolved.api_key or None,
            base_url=resolved.base_url or None,
            max_retries=resolved.max_retries,
            timeout=resolved.timeout_seconds,
        )
    logger.debug("Chat model factory returning deterministic stub.")
    return make_stub_chat_model()


def _failover_exception_types() -> tuple[type[BaseException], ...]:
    types_list: list[type[BaseException]] = []
    try:
        import anthropic

        types_list.extend(
            (
                anthropic.InternalServerError,
                anthropic.APIConnectionError,
                anthropic.APITimeoutError,
                # 429 from the primary should also failover to the secondary
                # provider; otherwise a steady-state quota dip kills the demo
                # path even though the fallback would have served the call.
                anthropic.RateLimitError,
            )
        )
    except ImportError:
        pass
    try:
        import openai

        types_list.extend(
            (
                openai.InternalServerError,
                openai.APIConnectionError,
                openai.APITimeoutError,
                openai.RateLimitError,
            )
        )
    except ImportError:
        pass
    if types_list:
        return tuple(types_list)
    return (Exception,)


def _failover_secondary_spec(
    primary: ChatModelSpec, cfg: Settings
) -> Optional[ChatModelSpec]:
    mode = (cfg.agent_chat_model_failover or "auto").strip().lower()
    if mode in {"", "none", "off", "false", "0"}:
        return None
    if primary.provider == PROVIDER_STUB:
        return None
    if primary.provider == PROVIDER_ANTHROPIC:
        if not cfg.openai_api_key:
            return None
        # Fix: agent_chat_model_id holds an Anthropic model id when the
        # primary is Anthropic; do NOT carry it over to the OpenAI secondary.
        # Only use it when the providers match (OpenAI->OpenAI), otherwise
        # fall back to the provider-appropriate default.
        return ChatModelSpec(
            provider=PROVIDER_OPENAI,
            model=DEFAULT_OPENAI_MODEL,
            temperature=primary.temperature,
            api_key=cfg.openai_api_key,
            base_url="",
            max_retries=primary.max_retries,
            timeout_seconds=primary.timeout_seconds,
        )
    if primary.provider == PROVIDER_OPENAI:
        if not cfg.anthropic_api_key:
            return None
        # Symmetric: agent_chat_model_id may hold an OpenAI id; use the
        # Anthropic default for the secondary.
        return ChatModelSpec(
            provider=PROVIDER_ANTHROPIC,
            model=DEFAULT_ANTHROPIC_MODEL,
            temperature=primary.temperature,
            api_key=cfg.anthropic_api_key,
            base_url="",
            max_retries=primary.max_retries,
            timeout_seconds=primary.timeout_seconds,
        )
    return None


def _wrap_cross_provider_failover(
    primary: BaseChatModel,
    resolved: ChatModelSpec,
    cfg: Settings,
) -> BaseChatModel:
    if is_stub_model(primary):
        return primary
    secondary_spec = _failover_secondary_spec(resolved, cfg)
    if secondary_spec is None:
        return primary
    # Fix: when failover is active the SDK's per-instance max_retries stacks
    # with with_fallbacks, producing retry storms. Force max_retries=0 on
    # both sides; with_fallbacks itself is the retry/failover mechanism.
    no_retry_primary_spec = ChatModelSpec(
        provider=resolved.provider,
        model=resolved.model,
        temperature=resolved.temperature,
        api_key=resolved.api_key,
        base_url=resolved.base_url,
        max_retries=0,
        timeout_seconds=resolved.timeout_seconds,
    )
    no_retry_secondary_spec = ChatModelSpec(
        provider=secondary_spec.provider,
        model=secondary_spec.model,
        temperature=secondary_spec.temperature,
        api_key=secondary_spec.api_key,
        base_url=secondary_spec.base_url,
        max_retries=0,
        timeout_seconds=secondary_spec.timeout_seconds,
    )
    primary = _instantiate_chat_model(no_retry_primary_spec)
    secondary = _instantiate_chat_model(no_retry_secondary_spec)
    if is_stub_model(secondary):
        return primary
    fb_label = f"{resolved.provider}→{secondary_spec.provider}"
    logger.info(
        "Chat model cross-provider failover enabled (%s); secondary=%s",
        fb_label,
        secondary_spec.model,
    )

    wrapped = primary.with_fallbacks(
        [secondary],
        exceptions_to_handle=_failover_exception_types(),
    )
    if cfg.otel_tracing:
        try:
            from opentelemetry import trace

            span = trace.get_current_span()
            if span.is_recording():
                span.set_attribute("ai.chat_failover.enabled", True)
                span.set_attribute(
                    "ai.chat_failover.primary_provider", resolved.provider
                )
                span.set_attribute(
                    "ai.chat_failover.secondary_provider", secondary_spec.provider
                )
                span.set_attribute(
                    "ai.chat_failover.secondary_model", secondary_spec.model
                )
        except Exception:
            pass
    return wrapped


_PROVIDER_PRODUCTION_SHAPED_ENV_VARS = HOSTED_PLATFORM_ENV_MARKERS


def _provider_api_key_env_var(provider: str) -> str:
    if provider == PROVIDER_ANTHROPIC:
        return "ANTHROPIC_API_KEY"
    if provider == PROVIDER_OPENAI:
        return "OPENAI_API_KEY"
    if provider == PROVIDER_DEEPSEEK:
        return "DEEPSEEK_API_KEY"
    return ""


def _is_production_like_env() -> bool:
    """``True`` when one of the curated hosted-platform env vars is set."""

    return has_hosted_platform_env()


def assert_provider_available(
    spec: Optional[ChatModelSpec] = None,
    *,
    settings: Optional[Settings] = None,
) -> None:
    """Fail fast at boot when the configured provider's package is missing.

    Catalog agents call :func:`make_chat_model` lazily on the first
    request that touches their compiled graph, so a typo like
    ``AGENT_CHAT_MODEL_PROVIDER=anthropic`` without ``langchain-anthropic``
    installed only surfaces when a user clicks Copilot. Calling this from
    the FastAPI lifespan turns that into a startup failure -- operators
    see the wiring problem in the deploy log instead of in user-visible
    500s on the SSE stream.

    A second, parallel failure mode also fails fast here: an operator
    sets ``AGENT_CHAT_MODEL_PROVIDER=anthropic`` (or ``=openai`` /
    ``=deepseek``, or
    ``=auto`` on a deploy where the key is absent) but forgets to set
    the matching provider API key. Today this
    only blows up mid-SSE on the first real model call; on a
    production-shaped deploy that surfaces as a user-visible error
    envelope. We raise here so the deploy log carries the wiring problem
    instead.

    The guard fires on the *resolved* provider (not the raw configured
    value), so ``provider=auto`` that resolved to a hosted provider with
    an empty key is also caught.  Local dev with ``auto`` falling back
    to the stub is unaffected because the resolved provider will be
    ``stub``.

    The check is gated on a production-shaped env on purpose for the
    historical Anthropic/OpenAI providers. Explicit DeepSeek is always
    fail-fast without ``DEEPSEEK_API_KEY`` so a local or hosted
    deployment cannot silently select a provider that has no anonymous
    mode. Default ``auto`` keeps the stub degrade behaviour untouched.

    No-op when the resolved provider is the deterministic stub: the stub
    has no integration package to import and is the documented fallback
    for AI-disabled deployments.
    """

    resolved = spec if spec is not None else resolve_chat_model_spec(settings)
    _require_integration(resolved.provider)

    raw_provider = (
        (settings if settings is not None else default_settings).agent_chat_model_provider
        or PROVIDER_AUTO
    ).strip().lower()
    missing_key_requires_failure = (
        resolved.provider in (PROVIDER_ANTHROPIC, PROVIDER_OPENAI)
        and _is_production_like_env()
    ) or (raw_provider == PROVIDER_DEEPSEEK and resolved.provider == PROVIDER_DEEPSEEK)
    if resolved.provider != PROVIDER_STUB and not resolved.api_key and missing_key_requires_failure:
        env_var = _provider_api_key_env_var(resolved.provider)
        platform = detected_hosted_platform()
        # Name the platform when we recognise it so the operator sees
        # an actionable pointer (e.g. "set it in your Vercel project
        # settings") rather than the generic "production-shaped deploy"
        # framing that requires them to know which marker fired.
        if platform is not None:
            location = {
                "vercel": "your Vercel project settings → Environment Variables",
                "render": "your Render service → Environment",
                "fly": "your Fly app secrets (`fly secrets set`)",
                "railway": "your Railway service → Variables",
                "kubernetes": "your Deployment env or Secret manifest",
            }.get(platform, "your hosting platform's environment settings")
            raise RuntimeError(
                f"{env_var} is empty on {platform.capitalize()}; set it in "
                f"{location}. Without it, every AI call will fail mid-SSE."
            )
        raise RuntimeError(
            f"AGENT_CHAT_MODEL_PROVIDER resolved to '{resolved.provider}' but "
            f"{env_var} is empty on a production-shaped deploy; the first "
            f"agent run would fail mid-SSE. Set {env_var} or switch the "
            "provider to 'auto' / 'stub'."
        )


def is_stub_model(model: BaseChatModel) -> bool:
    """Return ``True`` when ``model`` is the deterministic Phase A stub.

    Catalog agents use this as a feature flag: stub -> keep the deterministic
    Python path; real model -> call it (via ``with_structured_output`` for
    typed payloads, or plain ``ainvoke`` for chat).
    """

    return isinstance(model, GenericFakeChatModel)


def extract_token_usage(message: Any) -> tuple[int, int]:
    """Return ``(input_tokens, output_tokens)`` from a LangChain ``AIMessage``.

    Reads the standardized :attr:`AIMessage.usage_metadata` first, then
    falls back to the provider-specific ``response_metadata`` shapes
    (Anthropic: ``usage.input_tokens`` / ``output_tokens``; OpenAI:
    ``token_usage.prompt_tokens`` / ``completion_tokens``). Returns
    ``(0, 0)`` when nothing is reported -- the caller decides how to
    estimate.
    """

    if message is None:
        return 0, 0
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        return int(usage.get("input_tokens", 0) or 0), int(
            usage.get("output_tokens", 0) or 0
        )
    metadata = getattr(message, "response_metadata", None)
    if isinstance(metadata, dict):
        anthropic = metadata.get("usage")
        if isinstance(anthropic, dict):
            return int(anthropic.get("input_tokens", 0) or 0), int(
                anthropic.get("output_tokens", 0) or 0
            )
        openai_usage = metadata.get("token_usage")
        if isinstance(openai_usage, dict):
            return int(openai_usage.get("prompt_tokens", 0) or 0), int(
                openai_usage.get("completion_tokens", 0) or 0
            )
    return 0, 0


def extract_cache_token_usage(message: Any) -> tuple[int, int]:
    """Return ``(cache_read_tokens, cache_creation_tokens)`` from a LangChain ``AIMessage``.

    Reads ``cache_read_input_tokens`` and ``cache_creation_input_tokens``
    from :attr:`AIMessage.usage_metadata` (the standardized location
    langchain-anthropic populates for Anthropic cache hits). Returns
    ``(0, 0)`` when the fields are absent -- non-Anthropic providers and
    non-cached calls will always return zeros.

    Use this alongside :func:`extract_token_usage` to understand the
    fraction of input tokens served from the prompt cache vs billed at
    the full write rate. Cache hits are charged at ~10% of the normal
    input-token rate, so ``cache_read_tokens`` is a direct cost-reduction
    signal.
    """

    if message is None:
        return 0, 0
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        read = int(usage.get("cache_read_input_tokens", 0) or 0)
        creation = int(usage.get("cache_creation_input_tokens", 0) or 0)
        return read, creation
    return 0, 0


def result_token_usage_from_graph_result(result: Any) -> tuple[int, int]:
    """Best-effort ``(tokens_in, tokens_out)`` from a LangGraph final state dict.

    LangGraph returns the final state; agents that emit usage only via
    ``custom`` stream events may still leave token counts on the trailing
    ``AIMessage`` in ``messages``. Shared by the HTTP router debit path
    and OTel span attributes so both stay aligned.

    Sums across *all* ``AIMessage`` objects in ``messages`` so multi-turn
    graphs (multiple LLM calls per run) are counted correctly -- reading
    only ``messages[-1]`` undercounts every graph that makes more than one
    LLM call.
    """

    if isinstance(result, dict):
        messages = result.get("messages") or []
        if isinstance(messages, list) and messages:
            tokens_in = 0
            tokens_out = 0
            for msg in messages:
                if isinstance(msg, AIMessage):
                    ti, to = extract_token_usage(msg)
                    tokens_in += ti
                    tokens_out += to
            return tokens_in, tokens_out
    return 0, 0


def estimate_text_tokens(text: str) -> int:
    """Cheap pre-call token estimate -- ~4 chars per token, floor of 1.

    Real provider counters are preferred; this is the fallback used to
    debit the budget tracker before the call so a runaway agent cannot
    blow past the cap before we see the ``usage`` metadata.

    The 4-chars-per-token heuristic is calibrated for English ASCII
    against gpt-4 / claude tokenizers; CJK / emoji / code can produce
    1 token per 1-2 chars. We bump non-ASCII text up by a constant
    factor so the estimate stays a safe upper bound rather than a
    systematic undercount.
    """

    if not text:
        return 0
    if not text.isascii():
        # Approximate worst-case BPE expansion for non-ASCII content.
        return max(1, len(text) // 2)
    return max(1, len(text) // 4)


# ---------------------------------------------------------------------------
# Provider connectivity probe -- consumed by the AI readiness endpoint.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderConnectivityResult:
    """Outcome of a cheap connectivity probe against a chat provider.

    ``detail`` carries an operator-facing summary string (e.g.
    ``"authentication failed"``); it MUST NOT include the API key,
    key prefix, or key length -- the readiness endpoint emits it
    verbatim and the response is callable without auth.
    """

    provider: str
    reachable: bool
    detail: str = ""
    checked_at: float = 0.0


# Bound the cache so a misbehaving caller cannot grow it unboundedly;
# 30s matches the FE health-poll cadence, so back-to-back readiness
# pokes collapse onto one upstream request.
_PROBE_CACHE_TTL_SECONDS = 30.0
_probe_cache: dict[tuple[str, str, int], tuple[float, ProviderConnectivityResult]] = {}


def _probe_cache_key(spec: "ChatModelSpec") -> tuple[str, str, int]:
    """Stable cache key that does NOT leak the API key value.

    We hash the key with the built-in :func:`hash` (process-local
    randomized salt) so the cached entry stays unique per
    (provider, key) pair without ever surfacing the key itself.
    """

    return (spec.provider, spec.base_url, hash(spec.api_key))


def _cached_probe_result(spec: "ChatModelSpec") -> ProviderConnectivityResult | None:
    """Return a still-fresh cached result for ``spec``, else ``None``."""

    cached = _probe_cache.get(_probe_cache_key(spec))
    if cached is None:
        return None
    cached_at, result = cached
    if (time.monotonic() - cached_at) > _PROBE_CACHE_TTL_SECONDS:
        return None
    return result


def _store_probe_result(
    spec: "ChatModelSpec", result: ProviderConnectivityResult
) -> None:
    _probe_cache[_probe_cache_key(spec)] = (time.monotonic(), result)


def _reset_probe_cache_for_tests() -> None:
    """Clear the connectivity-probe cache.

    Exists so the test suite can isolate cache-hit / cache-miss runs
    without sleeping for the full TTL.
    """

    _probe_cache.clear()


async def probe_provider_connectivity(
    spec: Optional["ChatModelSpec"] = None,
    *,
    timeout_seconds: float = 5.0,
) -> ProviderConnectivityResult:
    """Cheap connectivity probe -- no token cost.

    Issues a ``models.list()`` call (which is free / quota-light on
    both Anthropic and OpenAI) to confirm the configured key reaches
    the provider. Stub provider always returns reachable. Results are
    cached for 30s keyed by (provider, hashed-api-key) so the
    readiness endpoint cannot be turned into a DoS amplifier.

    Imports are lazy so an install without the ``[ai]`` extra still
    imports this module (the probe just returns ``reachable=False`` for
    the real-provider branches).
    """

    resolved = spec if spec is not None else resolve_chat_model_spec()
    cached = _cached_probe_result(resolved)
    if cached is not None:
        return cached

    if resolved.provider == PROVIDER_STUB:
        result = ProviderConnectivityResult(
            provider=resolved.provider,
            reachable=True,
            detail="stub provider always reachable",
            checked_at=time.time(),
        )
        _store_probe_result(resolved, result)
        return result

    if resolved.provider in (PROVIDER_OPENAI, PROVIDER_DEEPSEEK):
        result = await _probe_openai(resolved, timeout_seconds=timeout_seconds)
    elif resolved.provider == PROVIDER_ANTHROPIC:
        result = await _probe_anthropic(resolved, timeout_seconds=timeout_seconds)
    else:
        result = ProviderConnectivityResult(
            provider=resolved.provider,
            reachable=False,
            detail=f"unsupported provider {resolved.provider!r}",
            checked_at=time.time(),
        )
    _store_probe_result(resolved, result)
    return result


async def _probe_openai(
    spec: ChatModelSpec, *, timeout_seconds: float
) -> ProviderConnectivityResult:
    """Connectivity probe against the OpenAI HTTP API.

    Wrapped in a try/except around the import so an install without
    the ``openai`` SDK still gets a sensible structured response
    instead of a 500.
    """

    try:
        import openai  # type: ignore[import-not-found]
    except ImportError:
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="openai SDK not installed",
            checked_at=time.time(),
        )
    try:
        client = openai.AsyncOpenAI(
            api_key=spec.api_key or None,
            base_url=spec.base_url or None,
            timeout=timeout_seconds,
        )
        await client.models.list()
    except openai.AuthenticationError:
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="authentication failed",
            checked_at=time.time(),
        )
    except (openai.APIConnectionError, openai.APITimeoutError):
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="network error",
            checked_at=time.time(),
        )
    except Exception as exc:  # noqa: BLE001 -- surface as structured failure
        # Strip exception details that could carry the key (the OpenAI
        # SDK has historically reflected the masked key in some error
        # bodies); we keep only the exception class name.
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail=f"unexpected error: {exc.__class__.__name__}",
            checked_at=time.time(),
        )
    return ProviderConnectivityResult(
        provider=spec.provider,
        reachable=True,
        detail="",
        checked_at=time.time(),
    )


async def _probe_anthropic(
    spec: ChatModelSpec, *, timeout_seconds: float
) -> ProviderConnectivityResult:
    """Connectivity probe against the Anthropic HTTP API."""

    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError:
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="anthropic SDK not installed",
            checked_at=time.time(),
        )
    try:
        client = anthropic.AsyncAnthropic(
            api_key=spec.api_key or None, timeout=timeout_seconds
        )
        await client.models.list()
    except anthropic.AuthenticationError:
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="authentication failed",
            checked_at=time.time(),
        )
    except (anthropic.APIConnectionError, anthropic.APITimeoutError):
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail="network error",
            checked_at=time.time(),
        )
    except Exception as exc:  # noqa: BLE001
        return ProviderConnectivityResult(
            provider=spec.provider,
            reachable=False,
            detail=f"unexpected error: {exc.__class__.__name__}",
            checked_at=time.time(),
        )
    return ProviderConnectivityResult(
        provider=spec.provider,
        reachable=True,
        detail="",
        checked_at=time.time(),
    )
