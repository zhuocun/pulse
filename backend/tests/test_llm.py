"""Tests for :mod:`app.agents.llm`."""

from __future__ import annotations

from dataclasses import replace

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app.agents import llm as llm_module
from app.agents.llm import (
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_DEEPSEEK_MODEL,
    DEFAULT_OPENAI_MODEL,
    PROVIDER_ANTHROPIC,
    PROVIDER_DEEPSEEK,
    PROVIDER_OPENAI,
    PROVIDER_STUB,
    ChatModelSpec,
    estimate_text_tokens,
    extract_token_usage,
    is_stub_model,
    make_chat_model,
    make_stub_chat_model,
    resolve_chat_model_spec,
)
from app.config import settings as default_settings


def _settings(**overrides: object) -> object:
    """Return a frozen :class:`Settings` clone with overrides applied."""

    return replace(default_settings, **overrides)


def test_make_stub_chat_model_returns_fake() -> None:
    model = make_stub_chat_model(purpose="tests")
    assert isinstance(model, GenericFakeChatModel)
    response = model.invoke("hello")
    assert isinstance(response, AIMessage)
    assert is_stub_model(model)


def test_make_stub_chat_model_invoke_twice_does_not_raise() -> None:
    """Calling invoke() twice on the same stub model must not raise StopIteration.

    Defect 2: the original implementation used ``iter([sample])`` which is a
    single-use iterator.  The fix uses ``itertools.cycle([sample])`` so the
    same deterministic response is returned on every call.
    """
    from langchain_core.messages import HumanMessage

    model = make_stub_chat_model(purpose="multi-call")
    first = model.invoke([HumanMessage(content="hi")])
    second = model.invoke([HumanMessage(content="hi again")])
    assert isinstance(first, AIMessage), "first invoke must return AIMessage"
    assert isinstance(second, AIMessage), "second invoke must return AIMessage"
    assert first.content, "first response must be non-empty"
    assert second.content, "second response must be non-empty"


def test_resolve_spec_auto_picks_stub_when_no_keys() -> None:
    spec = resolve_chat_model_spec(_settings(anthropic_api_key="", openai_api_key=""))
    assert spec.provider == PROVIDER_STUB
    assert spec.is_stub is True


def test_resolve_spec_auto_picks_anthropic_when_key_set() -> None:
    spec = resolve_chat_model_spec(
        _settings(anthropic_api_key="sk-test", openai_api_key="")
    )
    assert spec.provider == PROVIDER_ANTHROPIC
    assert spec.model == DEFAULT_ANTHROPIC_MODEL
    assert spec.api_key == "sk-test"


def test_resolve_spec_auto_picks_openai_when_only_openai_key_set() -> None:
    spec = resolve_chat_model_spec(
        _settings(anthropic_api_key="", openai_api_key="sk-openai")
    )
    assert spec.provider == PROVIDER_OPENAI
    assert spec.model == DEFAULT_OPENAI_MODEL


def test_resolve_spec_auto_picks_deepseek_after_anthropic_and_openai() -> None:
    spec = resolve_chat_model_spec(
        _settings(
            anthropic_api_key="",
            openai_api_key="",
            deepseek_api_key="sk-deepseek",
        )
    )
    assert spec.provider == PROVIDER_DEEPSEEK
    assert spec.model == DEFAULT_DEEPSEEK_MODEL
    assert spec.api_key == "sk-deepseek"
    assert spec.base_url == "https://api.deepseek.com"


def test_resolve_spec_auto_prefers_openai_over_deepseek() -> None:
    spec = resolve_chat_model_spec(
        _settings(
            anthropic_api_key="",
            openai_api_key="sk-openai",
            deepseek_api_key="sk-deepseek",
        )
    )
    assert spec.provider == PROVIDER_OPENAI


def test_resolve_spec_explicit_provider_overrides_auto() -> None:
    spec = resolve_chat_model_spec(
        _settings(
            agent_chat_model_provider="stub",
            anthropic_api_key="sk-still-here",
        )
    )
    assert spec.provider == PROVIDER_STUB


def test_resolve_spec_uses_explicit_model_id() -> None:
    spec = resolve_chat_model_spec(
        _settings(
            agent_chat_model_provider="anthropic",
            agent_chat_model_id="claude-test",
            anthropic_api_key="sk-x",
        )
    )
    assert spec.model == "claude-test"


def test_resolve_spec_rejects_unknown_provider() -> None:
    with pytest.raises(RuntimeError, match="Unsupported"):
        resolve_chat_model_spec(_settings(agent_chat_model_provider="not-a-thing"))


def test_make_chat_model_uses_stub_by_default() -> None:
    spec = ChatModelSpec(provider=PROVIDER_STUB, model="stub")
    model = make_chat_model(spec)
    assert is_stub_model(model)


def test_make_chat_model_resolves_default_when_spec_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``spec`` is None it falls back to the resolved global settings."""

    monkeypatch.setattr(
        llm_module,
        "default_settings",
        _settings(agent_chat_model_provider="stub"),
    )
    model = make_chat_model()
    assert is_stub_model(model)


def test_extract_token_usage_from_usage_metadata() -> None:
    msg = AIMessage(
        content="ok",
        usage_metadata={"input_tokens": 11, "output_tokens": 22, "total_tokens": 33},
    )
    assert extract_token_usage(msg) == (11, 22)


def test_extract_token_usage_from_anthropic_metadata() -> None:
    msg = AIMessage(
        content="ok",
        response_metadata={"usage": {"input_tokens": 5, "output_tokens": 7}},
    )
    assert extract_token_usage(msg) == (5, 7)


def test_extract_token_usage_from_openai_metadata() -> None:
    msg = AIMessage(
        content="ok",
        response_metadata={
            "token_usage": {"prompt_tokens": 9, "completion_tokens": 4},
        },
    )
    assert extract_token_usage(msg) == (9, 4)


def test_extract_token_usage_returns_zero_when_unknown() -> None:
    assert extract_token_usage(None) == (0, 0)
    assert extract_token_usage(AIMessage(content="ok")) == (0, 0)


def test_estimate_text_tokens_handles_empty_input() -> None:
    assert estimate_text_tokens("") == 0


def test_estimate_text_tokens_floors_at_one() -> None:
    assert estimate_text_tokens("hi") == 1


def test_estimate_text_tokens_scales_with_length() -> None:
    assert estimate_text_tokens("a" * 80) >= 20


# ---------------------------------------------------------------------------
# assert_provider_available -- explicit-provider-without-key guard
# ---------------------------------------------------------------------------


def _clear_production_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in llm_module._PROVIDER_PRODUCTION_SHAPED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_assert_provider_available_passes_for_stub() -> None:
    """Default ``auto`` resolving to stub should never raise."""

    llm_module.assert_provider_available(
        settings=_settings(
            agent_chat_model_provider="auto",
            anthropic_api_key="",
            openai_api_key="",
        )
    )


def test_assert_provider_available_passes_when_key_present_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_production_env(monkeypatch)
    monkeypatch.setenv("VERCEL", "1")
    llm_module.assert_provider_available(
        settings=_settings(
            agent_chat_model_provider="anthropic",
            anthropic_api_key="sk-real",
        )
    )


def test_assert_provider_available_passes_for_deepseek_with_key() -> None:
    llm_module.assert_provider_available(
        settings=_settings(
            agent_chat_model_provider="deepseek",
            deepseek_api_key="sk-real",
        )
    )


def test_assert_provider_available_raises_for_explicit_deepseek_without_key() -> None:
    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        llm_module.assert_provider_available(
            settings=_settings(
                agent_chat_model_provider="deepseek",
                deepseek_api_key="",
            )
        )


def test_assert_provider_available_passes_in_local_dev_without_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local dev (no production-shaped env vars) keeps degrade-to-stub behaviour."""

    _clear_production_env(monkeypatch)
    llm_module.assert_provider_available(
        settings=_settings(
            agent_chat_model_provider="anthropic",
            anthropic_api_key="",
        )
    )


def test_assert_provider_available_raises_for_anthropic_without_key_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_production_env(monkeypatch)
    monkeypatch.setenv("VERCEL", "1")
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        llm_module.assert_provider_available(
            settings=_settings(
                agent_chat_model_provider="anthropic",
                anthropic_api_key="",
            )
        )


def test_assert_provider_available_raises_for_openai_without_key_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_production_env(monkeypatch)
    monkeypatch.setenv("RENDER", "1")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        llm_module.assert_provider_available(
            settings=_settings(
                agent_chat_model_provider="openai",
                openai_api_key="",
            )
        )


def test_assert_provider_available_default_auto_does_not_raise_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``auto`` with no keys resolves to stub and must keep degrade behaviour."""

    _clear_production_env(monkeypatch)
    monkeypatch.setenv("FLY_APP_NAME", "demo")
    llm_module.assert_provider_available(
        settings=_settings(
            agent_chat_model_provider="auto",
            anthropic_api_key="",
            openai_api_key="",
        )
    )


# ---------------------------------------------------------------------------
# max_retries / timeout_seconds flow through spec
# ---------------------------------------------------------------------------


def test_resolve_spec_uses_default_retry_and_timeout() -> None:
    """Default settings produce spec with max_retries=2 and timeout_seconds=30.0."""

    spec = resolve_chat_model_spec(
        _settings(
            agent_chat_model_provider="stub",
            agent_chat_model_max_retries=2,
            agent_chat_model_timeout_seconds=30.0,
        )
    )
    assert spec.max_retries == 2
    assert spec.timeout_seconds == 30.0


def test_resolve_spec_propagates_custom_retry_and_timeout() -> None:
    """Custom env values for retries and timeout flow into the spec."""

    spec = resolve_chat_model_spec(
        _settings(
            agent_chat_model_provider="stub",
            agent_chat_model_max_retries=5,
            agent_chat_model_timeout_seconds=60.0,
        )
    )
    assert spec.max_retries == 5
    assert spec.timeout_seconds == 60.0


def test_chat_model_spec_defaults_are_backward_compatible() -> None:
    """Constructing ChatModelSpec without max_retries/timeout uses sensible defaults."""

    from app.agents.llm import ChatModelSpec

    spec = ChatModelSpec(provider=PROVIDER_STUB, model="stub")
    assert spec.max_retries == 2
    assert spec.timeout_seconds == 30.0


# ---------------------------------------------------------------------------
# probe_provider_connectivity -- stub branch is hermetic
# ---------------------------------------------------------------------------


def test_probe_provider_connectivity_stub_branch() -> None:
    """The stub branch never touches the network and is always reachable."""

    import asyncio

    from app.agents.llm import (
        ChatModelSpec,
        ProviderConnectivityResult,
        probe_provider_connectivity,
    )

    llm_module._reset_probe_cache_for_tests()
    spec = ChatModelSpec(provider=PROVIDER_STUB, model="stub", api_key="")
    result = asyncio.run(probe_provider_connectivity(spec))

    assert isinstance(result, ProviderConnectivityResult)
    assert result.provider == PROVIDER_STUB
    assert result.reachable is True
    assert result.checked_at > 0
