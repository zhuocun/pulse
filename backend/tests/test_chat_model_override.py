"""Tests for the ``X-Pulse-Model`` header that overrides the chat model
on a per-request basis.

The header path is wired through:

- :func:`app.routers._dispatch.chat_model_override_from_request` — reads
  the header, validates against ``AGENT_CHAT_MODEL_ALLOWLIST``, and
  returns a context dict.
- :func:`app.agents.llm.is_chat_model_allowed` /
  :func:`app.agents.llm.make_chat_model_for_id` — the model factory.
- :meth:`app.agents.runtime.AgentRuntime._build_context` — already picks
  ``caller_context["chat_model"]`` if present (Phase 4 wiring).

These tests exercise the helper, the factory, and the end-to-end flow
of header → context → runtime resolution.  Per-request overrides do not
rebuild the agent's compiled graph; they only flow on the context.

Settings is a frozen dataclass, so tests pass an explicitly constructed
:class:`Settings` to the helper (its ``settings=`` parameter) rather
than mutating the process-wide singleton.
"""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.agents.llm import (
    is_chat_model_allowed,
    make_chat_model_for_id,
    make_stub_chat_model,
)
from app.config import settings as default_settings
from app.routers._dispatch import (
    CHAT_MODEL_OVERRIDE_HEADER,
    chat_model_override_from_request,
)


def _request_with_headers(headers: dict[str, str]) -> MagicMock:
    """Build a MagicMock request whose ``.headers.get`` mirrors a real
    Starlette ``Headers``."""
    req = MagicMock()
    req.headers.get.side_effect = lambda key, default=None: headers.get(
        key, default
    )
    return req


def _settings_with(**overrides):
    """Return a copy of the process-wide settings with ``overrides`` applied."""
    return replace(default_settings, **overrides)


# ---------------------------------------------------------------------------
# Allowlist semantics
# ---------------------------------------------------------------------------


def test_allowlist_empty_disables_override() -> None:
    """Empty allowlist disables the feature; every model id is rejected."""
    cfg = _settings_with(agent_chat_model_allowlist=())
    assert is_chat_model_allowed("claude-sonnet-4-6", cfg) is False
    assert is_chat_model_allowed("gpt-4o-mini", cfg) is False


def test_allowlist_non_empty_admits_only_listed_ids() -> None:
    """Non-empty allowlist admits exactly the listed model ids."""
    cfg = _settings_with(
        agent_chat_model_allowlist=("claude-sonnet-4-6", "gpt-4o-mini"),
    )
    assert is_chat_model_allowed("claude-sonnet-4-6", cfg) is True
    assert is_chat_model_allowed("gpt-4o-mini", cfg) is True
    assert is_chat_model_allowed("claude-opus-4-7", cfg) is False
    # Stripping is applied to the input.
    assert is_chat_model_allowed("  claude-sonnet-4-6  ", cfg) is True


# ---------------------------------------------------------------------------
# Header → context dict
# ---------------------------------------------------------------------------


def test_header_absent_returns_none() -> None:
    """No header → no override; runtime falls through to agent default."""
    cfg = _settings_with(agent_chat_model_allowlist=("claude-sonnet-4-6",))
    request = _request_with_headers({})
    assert chat_model_override_from_request(request, settings=cfg) is None


def test_header_blank_returns_none() -> None:
    """Blank header value treated as absent."""
    cfg = _settings_with(agent_chat_model_allowlist=("claude-sonnet-4-6",))
    request = _request_with_headers({CHAT_MODEL_OVERRIDE_HEADER: "   "})
    assert chat_model_override_from_request(request, settings=cfg) is None


def test_header_valid_returns_context_with_chat_model() -> None:
    """Allowlisted header value yields ``{"chat_model": <model>}``."""
    cfg = _settings_with(
        agent_chat_model_allowlist=("stub",),
        agent_chat_model_provider="stub",
    )
    request = _request_with_headers({CHAT_MODEL_OVERRIDE_HEADER: "stub"})
    override = chat_model_override_from_request(request, settings=cfg)
    assert override is not None
    assert "chat_model" in override
    # The model is a real BaseChatModel-compatible object (stub is a
    # GenericFakeChatModel).
    assert hasattr(override["chat_model"], "invoke")


def test_header_disallowed_raises_400() -> None:
    """A header value not in the allowlist surfaces as a 400."""
    cfg = _settings_with(agent_chat_model_allowlist=("claude-sonnet-4-6",))
    request = _request_with_headers(
        {CHAT_MODEL_OVERRIDE_HEADER: "claude-opus-4-7"}
    )
    with pytest.raises(HTTPException) as exc_info:
        chat_model_override_from_request(request, settings=cfg)
    assert exc_info.value.status_code == 400
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail["error"]["code"] == "unsupported_chat_model"


def test_header_with_feature_disabled_still_400() -> None:
    """When the feature is off (empty allowlist), a header *value* is a
    clear configuration error: surface a 400 rather than silently use
    the default model."""
    cfg = _settings_with(agent_chat_model_allowlist=())
    request = _request_with_headers(
        {CHAT_MODEL_OVERRIDE_HEADER: "claude-sonnet-4-6"}
    )
    with pytest.raises(HTTPException) as exc_info:
        chat_model_override_from_request(request, settings=cfg)
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# Factory (no allowlist enforcement; that's the helper's job)
# ---------------------------------------------------------------------------


def test_make_chat_model_for_id_uses_configured_provider() -> None:
    """The factory inherits provider/credentials from settings; only the
    model id is overridden."""
    cfg = _settings_with(
        agent_chat_model_provider="stub",
        agent_chat_model_id="default-stub",
    )
    model = make_chat_model_for_id("override-stub", settings=cfg)
    # Stub is a GenericFakeChatModel — same shape as
    # make_stub_chat_model().
    assert type(model) is type(make_stub_chat_model())
