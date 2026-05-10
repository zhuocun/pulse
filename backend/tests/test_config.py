"""Tests for new Settings fields added for LLM retry / timeout configuration."""

from __future__ import annotations

from dataclasses import replace

from app.config import Settings, parse_project_chat_model_map, settings as default_settings


def test_default_agent_chat_model_max_retries() -> None:
    """Default value for max_retries is 2."""

    assert default_settings.agent_chat_model_max_retries == 2


def test_default_agent_chat_model_timeout_seconds() -> None:
    """Default value for timeout_seconds is 30.0."""

    assert default_settings.agent_chat_model_timeout_seconds == 30.0


def test_agent_chat_model_max_retries_env(monkeypatch) -> None:
    """AGENT_CHAT_MODEL_MAX_RETRIES env var is read into Settings."""

    monkeypatch.setenv("AGENT_CHAT_MODEL_MAX_RETRIES", "5")
    s = Settings()
    assert s.agent_chat_model_max_retries == 5


def test_agent_chat_model_timeout_seconds_env(monkeypatch) -> None:
    """AGENT_CHAT_MODEL_TIMEOUT_SECONDS env var is read into Settings."""

    monkeypatch.setenv("AGENT_CHAT_MODEL_TIMEOUT_SECONDS", "45.5")
    s = Settings()
    assert s.agent_chat_model_timeout_seconds == 45.5


def test_settings_replace_preserves_new_fields() -> None:
    """dataclasses.replace on Settings works correctly with the new fields."""

    s = replace(default_settings, agent_chat_model_max_retries=3, agent_chat_model_timeout_seconds=10.0)
    assert s.agent_chat_model_max_retries == 3
    assert s.agent_chat_model_timeout_seconds == 10.0


def test_parse_project_chat_model_map() -> None:
    raw = "p1:model-a, p2 : model-b ,,, bad, nocolon"
    assert parse_project_chat_model_map(raw) == {"p1": "model-a", "p2": "model-b"}
