"""Coverage for chat-model cross-provider failover wiring."""

from __future__ import annotations

import builtins
import itertools
from unittest.mock import MagicMock

import pytest

from app.agents.llm import (
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_OPENAI_MODEL,
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
    # Failover re-instantiates both models with max_retries=0. Track calls.
    chained = MagicMock()
    calls: list[MagicMock] = []

    def fake_instantiate(_spec: object) -> MagicMock:
        m = MagicMock()
        if not calls:
            m.with_fallbacks.return_value = chained
        calls.append(m)
        return m

    resolved = MagicMock(
        provider=PROVIDER_ANTHROPIC,
        model="m",
        temperature=0.1,
        api_key="k",
        max_retries=1,
        timeout_seconds=1.0,
    )
    cfg = Settings(openai_api_key="sk-open", agent_chat_model_failover="auto")
    monkeypatch.setattr("app.agents.llm._instantiate_chat_model", fake_instantiate)
    monkeypatch.setattr("app.agents.llm.is_stub_model", lambda _m: False)

    original_primary = MagicMock()
    out = _wrap_cross_provider_failover(original_primary, resolved, cfg)
    assert out is chained
    assert len(calls) == 2  # primary and secondary both re-instantiated with max_retries=0
    calls[0].with_fallbacks.assert_called_once()
    args, kwargs = calls[0].with_fallbacks.call_args
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
    # When _instantiate_chat_model always returns a stub, the new_primary is a stub
    # too (is_stub_model returns True for it) so we skip failover entirely and
    # return the re-instantiated primary (which is also a stub).
    original_primary = MagicMock()
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

    out = _wrap_cross_provider_failover(original_primary, resolved, cfg)
    # Both re-instantiations return the stub; out is the re-instantiated primary stub.
    assert isinstance(out, GenericFakeChatModel)


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


# ---------------------------------------------------------------------------
# Cross-provider secondary model ID fix
# ---------------------------------------------------------------------------


def test_failover_secondary_anthropic_to_openai_uses_openai_default_model() -> None:
    """When primary is Anthropic, secondary must use OpenAI default, NOT the
    Anthropic model id from agent_chat_model_id."""

    spec = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC,
        model="claude-sonnet-4-6",
        temperature=0.2,
        api_key="ak-ant",
        max_retries=2,
        timeout_seconds=30.0,
    )
    cfg = Settings(
        openai_api_key="sk-open",
        agent_chat_model_failover="auto",
        # Simulate operator setting an Anthropic model id
        agent_chat_model_id="claude-sonnet-4-6",
    )
    sec = _failover_secondary_spec(spec, cfg)
    assert sec is not None
    assert sec.provider == PROVIDER_OPENAI
    # Must NOT be the Anthropic id
    assert sec.model == DEFAULT_OPENAI_MODEL
    assert "claude" not in sec.model


def test_failover_secondary_openai_to_anthropic_uses_anthropic_default_model() -> None:
    """Symmetric: primary OpenAI -> secondary must use Anthropic default."""

    spec = ChatModelSpec(
        provider=PROVIDER_OPENAI,
        model="gpt-4o-mini",
        temperature=0.2,
        api_key="sk-open",
        max_retries=2,
        timeout_seconds=30.0,
    )
    cfg = Settings(
        anthropic_api_key="ak-ant",
        agent_chat_model_failover="auto",
        agent_chat_model_id="gpt-4o-mini",
    )
    sec = _failover_secondary_spec(spec, cfg)
    assert sec is not None
    assert sec.provider == PROVIDER_ANTHROPIC
    assert sec.model == DEFAULT_ANTHROPIC_MODEL
    assert "gpt" not in sec.model


# ---------------------------------------------------------------------------
# max_retries=0 enforcement when failover is active
# ---------------------------------------------------------------------------


def test_failover_forces_max_retries_zero_on_both_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both primary and secondary must be instantiated with max_retries=0."""

    captured_specs: list[object] = []

    def capturing_instantiate(spec: object) -> MagicMock:
        captured_specs.append(spec)
        m = MagicMock()
        if len(captured_specs) == 1:
            chained = MagicMock()
            m.with_fallbacks.return_value = chained
        return m

    monkeypatch.setattr("app.agents.llm._instantiate_chat_model", capturing_instantiate)
    monkeypatch.setattr("app.agents.llm.is_stub_model", lambda _m: False)

    resolved = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC,
        model="claude-sonnet-4-6",
        temperature=0.2,
        api_key="ak",
        max_retries=3,  # original has retries
        timeout_seconds=30.0,
    )
    cfg = Settings(openai_api_key="sk-open", agent_chat_model_failover="auto")
    primary = MagicMock()
    _wrap_cross_provider_failover(primary, resolved, cfg)

    assert len(captured_specs) == 2
    for spec in captured_specs:
        assert getattr(spec, "max_retries") == 0, (
            f"Expected max_retries=0, got {getattr(spec, 'max_retries')}"
        )


def test_no_failover_preserves_configured_max_retries() -> None:
    """Without failover, max_retries from config is kept."""

    spec = ChatModelSpec(
        provider=PROVIDER_ANTHROPIC,
        model="claude-sonnet-4-6",
        temperature=0.2,
        api_key="ak",
        max_retries=3,
        timeout_seconds=30.0,
    )
    # No openai key -> no secondary -> no failover
    cfg = Settings(openai_api_key="", agent_chat_model_failover="auto")
    sec = _failover_secondary_spec(spec, cfg)
    assert sec is None  # failover not activated
    # The spec's max_retries is untouched
    assert spec.max_retries == 3
