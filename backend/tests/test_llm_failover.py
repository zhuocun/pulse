"""Coverage for chat-model cross-provider failover wiring."""

from __future__ import annotations

import builtins
import itertools
from unittest.mock import MagicMock

import pytest

from app.agents.llm import (
    PROVIDER_ANTHROPIC,
    PROVIDER_OPENAI,
    PROVIDER_STUB,
    ChatModelSpec,
    _failover_exception_types,
    _failover_secondary_spec,
    _wrap_cross_provider_failover,
)
from app.config import Settings
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage


def test_failover_exception_types_non_empty() -> None:
    assert len(_failover_exception_types()) >= 1


def test_failover_exception_types_include_rate_limit() -> None:
    """A 429 from the primary must trigger failover, not bubble up.

    Pre-fix, RateLimitError was missing from the tuple and a steady-state
    quota dip on the primary provider killed the demo path even though the
    secondary would have answered.
    """

    types = _failover_exception_types()
    try:
        import anthropic
    except ImportError:  # pragma: no cover -- vendor optional in CI
        anthropic = None
    try:
        import openai
    except ImportError:  # pragma: no cover
        openai = None
    if anthropic is not None:
        assert anthropic.RateLimitError in types
    if openai is not None:
        assert openai.RateLimitError in types


def test_failover_secondary_none_for_stub_provider() -> None:
    spec = ChatModelSpec(
        provider=PROVIDER_STUB,
        model="stub",
        temperature=0.2,
        api_key="",
        max_retries=1,
        timeout_seconds=1.0,
    )
    assert _failover_secondary_spec(spec, Settings(openai_api_key="sk")) is None


    cfg = Settings(agent_chat_model_failover="none")
    spec = MagicMock()
    spec.provider = PROVIDER_ANTHROPIC
    assert _failover_secondary_spec(spec, cfg) is None


def test_wrap_cross_provider_skips_stub_primary() -> None:
    cfg = Settings()
    sample = AIMessage(content="{}")
    stub = GenericFakeChatModel(messages=itertools.cycle([sample]))
    out = _wrap_cross_provider_failover(stub, MagicMock(), cfg)
    assert out is stub


def test_wrap_cross_provider_failover_invokes_with_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    primary = MagicMock()
    chained = MagicMock()
    primary.with_fallbacks.return_value = chained
    resolved = MagicMock(
        provider=PROVIDER_ANTHROPIC,
        model="m",
        temperature=0.1,
        api_key="k",
        max_retries=1,
        timeout_seconds=1.0,
    )
    cfg = Settings(openai_api_key="sk-open", agent_chat_model_failover="auto")
    monkeypatch.setattr(
        "app.agents.llm._instantiate_chat_model", lambda _spec: MagicMock()
    )
    monkeypatch.setattr("app.agents.llm.is_stub_model", lambda _m: False)

    out = _wrap_cross_provider_failover(primary, resolved, cfg)
    assert out is chained
    primary.with_fallbacks.assert_called_once()
    args, kwargs = primary.with_fallbacks.call_args
    assert args[0]  # fallbacks non-empty
    assert "exceptions_to_handle" in kwargs


def test_wrap_sets_otel_attributes_when_tracing_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    primary = MagicMock()
    chained = MagicMock()
    primary.with_fallbacks.return_value = chained
    resolved = MagicMock(
        provider=PROVIDER_ANTHROPIC,
        model="m",
        temperature=0.1,
        api_key="k",
        max_retries=1,
        timeout_seconds=1.0,
    )
    cfg = Settings(
        openai_api_key="sk",
        agent_chat_model_failover="auto",
        otel_tracing=True,
    )
    monkeypatch.setattr(
        "app.agents.llm._instantiate_chat_model", lambda _spec: MagicMock()
    )
    monkeypatch.setattr("app.agents.llm.is_stub_model", lambda _m: False)
    span = MagicMock()
    span.is_recording.return_value = True
    monkeypatch.setattr(
        "opentelemetry.trace.get_current_span", MagicMock(return_value=span)
    )
    _wrap_cross_provider_failover(primary, resolved, cfg)
    assert span.set_attribute.call_count >= 1


def test_failover_exception_types_when_vendor_imports_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import = builtins.__import__

    def fake_import(name: str, *args: object, **kwargs: object) -> object:
        if name in {"anthropic", "openai"}:
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert _failover_exception_types() == (Exception,)


def test_failover_secondary_for_openai_primary() -> None:
    spec = ChatModelSpec(
        provider=PROVIDER_OPENAI,
        model="gpt-4o-mini",
        temperature=0.2,
        api_key="sk",
        max_retries=1,
        timeout_seconds=30.0,
    )
    cfg = Settings(anthropic_api_key="ak-ant", agent_chat_model_failover="auto")
    sec = _failover_secondary_spec(spec, cfg)
    assert sec is not None
    assert sec.provider == PROVIDER_ANTHROPIC


def test_failover_secondary_returns_none_for_unknown_provider() -> None:
    spec = MagicMock()
    spec.provider = "alien"
    assert _failover_secondary_spec(spec, Settings()) is None


def test_wrap_returns_primary_when_secondary_is_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    primary = MagicMock()
    resolved = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC,
        model="c",
        temperature=0.2,
        api_key="k",
        max_retries=1,
        timeout_seconds=1.0,
    )
    cfg = Settings(openai_api_key="sk", agent_chat_model_failover="auto")
    sample = AIMessage(content="{}")
    stub = GenericFakeChatModel(messages=itertools.cycle([sample]))
    monkeypatch.setattr("app.agents.llm._instantiate_chat_model", lambda _s: stub)

    out = _wrap_cross_provider_failover(primary, resolved, cfg)
    assert out is primary


def test_wrap_swallows_otel_exporter_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    primary = MagicMock()
    chained = MagicMock()
    primary.with_fallbacks.return_value = chained
    resolved = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC,
        model="m",
        temperature=0.1,
        api_key="k",
        max_retries=1,
        timeout_seconds=1.0,
    )
    cfg = Settings(
        openai_api_key="sk",
        agent_chat_model_failover="auto",
        otel_tracing=True,
    )
    monkeypatch.setattr(
        "app.agents.llm._instantiate_chat_model", lambda _spec: MagicMock()
    )
    monkeypatch.setattr("app.agents.llm.is_stub_model", lambda _m: False)
    monkeypatch.setattr(
        "opentelemetry.trace.get_current_span",
        MagicMock(side_effect=RuntimeError("no sdk")),
    )
    _wrap_cross_provider_failover(primary, resolved, cfg)
