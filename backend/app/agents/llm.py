"""Provider-agnostic chat-model factory.

The factory hides three concerns from the catalog:

1. Detecting which provider to use. ``AGENT_CHAT_MODEL_PROVIDER=auto`` (the
   default) inspects the environment and picks Anthropic if
   ``ANTHROPIC_API_KEY`` is set, OpenAI if ``OPENAI_API_KEY`` is set, and
   the deterministic stub otherwise. Explicit values (``anthropic``,
   ``openai``, ``stub``) skip the auto-detect.
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
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import itertools
import json
import logging
import os
from typing import Any, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app.config import Settings, settings as default_settings

logger = logging.getLogger(__name__)

PROVIDER_AUTO = "auto"
PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_OPENAI = "openai"
PROVIDER_STUB = "stub"

SUPPORTED_PROVIDERS = frozenset(
    {PROVIDER_AUTO, PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_STUB}
)

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

# (langchain integration module, pyproject extras name) per provider.
_PROVIDER_PACKAGES: dict[str, tuple[str, str]] = {
    PROVIDER_ANTHROPIC: ("langchain_anthropic", "anthropic"),
    PROVIDER_OPENAI: ("langchain_openai", "openai"),
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
    else:
        model = cfg.agent_chat_model_id or "stub"
        api_key = ""
    return ChatModelSpec(
        provider=provider,
        model=model,
        temperature=cfg.agent_chat_model_temperature,
        api_key=api_key,
        max_retries=cfg.agent_chat_model_max_retries,
        timeout_seconds=cfg.agent_chat_model_timeout_seconds,
    )


def resolved_chat_model_id(settings: Optional[Settings] = None) -> str:
    """Provider model id for logging / OTel (no network I/O)."""

    return resolve_chat_model_spec(settings).model


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
    """

    resolved = spec if spec is not None else resolve_chat_model_spec(settings)
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
    if resolved.provider == PROVIDER_OPENAI:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            temperature=resolved.temperature,
            api_key=resolved.api_key or None,
            max_retries=resolved.max_retries,
            timeout=resolved.timeout_seconds,
        )
    logger.debug("Chat model factory returning deterministic stub.")
    return make_stub_chat_model()


# Env vars that indicate a hosted / production-shaped deploy. Mirrors the
# curated list in :mod:`app.main`; duplicated here so the llm module stays
# import-free of app.main (which imports from us).
_PROVIDER_PRODUCTION_SHAPED_ENV_VARS: tuple[str, ...] = (
    "VERCEL",
    "VERCEL_URL",
    "RENDER_EXTERNAL_HOSTNAME",
    "RENDER",
    "KUBERNETES_SERVICE_HOST",
    "FLY_APP_NAME",
    "RAILWAY_PROJECT_ID",
)


def _is_production_like_env() -> bool:
    """``True`` when one of the curated hosted-platform env vars is set."""

    return any(os.getenv(name) for name in _PROVIDER_PRODUCTION_SHAPED_ENV_VARS)


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
    sets ``AGENT_CHAT_MODEL_PROVIDER=anthropic`` (or ``=openai``) but
    forgets to set the matching ``ANTHROPIC_API_KEY`` /
    ``OPENAI_API_KEY``. Today this only blows up mid-SSE on the first
    real model call; on a production-shaped deploy that surfaces as a
    user-visible error envelope. We raise here so the deploy log carries
    the wiring problem instead.

    The check is gated on a production-shaped env on purpose: local dev
    runs without API keys and uses ``provider=auto`` (which falls back
    to the stub). Default ``auto`` keeps that degrade behaviour
    untouched -- only an *explicit* provider with a missing key trips
    the new guard.

    No-op when the resolved provider is the deterministic stub: the stub
    has no integration package to import and is the documented fallback
    for AI-disabled deployments.
    """

    cfg = settings if settings is not None else default_settings
    raw_provider = (cfg.agent_chat_model_provider or PROVIDER_AUTO).strip().lower()
    resolved = spec if spec is not None else resolve_chat_model_spec(settings)
    _require_integration(resolved.provider)

    if (
        raw_provider in (PROVIDER_ANTHROPIC, PROVIDER_OPENAI)
        and not resolved.api_key
        and _is_production_like_env()
    ):
        env_var = (
            "ANTHROPIC_API_KEY"
            if raw_provider == PROVIDER_ANTHROPIC
            else "OPENAI_API_KEY"
        )
        raise RuntimeError(
            f"AGENT_CHAT_MODEL_PROVIDER={raw_provider} but {env_var} is "
            "empty on a production-shaped deploy; the first agent run "
            f"would fail mid-SSE. Set {env_var} or switch the provider "
            "to 'auto' / 'stub'."
        )


def is_stub_model(model: BaseChatModel) -> bool:
    """Return ``True`` when ``model`` is the deterministic Phase A stub.

    Catalog agents use this as a feature flag: stub → keep the deterministic
    Python path; real model → call it (via ``with_structured_output`` for
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


def result_token_usage_from_graph_result(result: Any) -> tuple[int, int]:
    """Best-effort ``(tokens_in, tokens_out)`` from a LangGraph final state dict.

    LangGraph returns the final state; agents that emit usage only via
    ``custom`` stream events may still leave token counts on the trailing
    ``AIMessage`` in ``messages``. Shared by the HTTP router debit path
    and OTel span attributes so both stay aligned.
    """

    if isinstance(result, dict):
        messages = result.get("messages") or []
        if isinstance(messages, list) and messages:
            return extract_token_usage(messages[-1])
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
    if any(ord(ch) > 127 for ch in text):
        # Approximate worst-case BPE expansion for non-ASCII content.
        return max(1, len(text) // 2)
    return max(1, len(text) // 4)
