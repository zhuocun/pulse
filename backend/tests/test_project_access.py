"""Tests for :mod:`app.auth.project_access`."""

from __future__ import annotations

from dataclasses import replace

from app.auth.project_access import disabled_project_ids, is_project_ai_enabled
from app.config import settings as default_settings


def _settings(**overrides: object) -> object:
    return replace(default_settings, **overrides)


def test_no_project_id_means_allowed() -> None:
    assert is_project_ai_enabled(None) is True
    assert is_project_ai_enabled("") is True


def test_project_in_allow_list_is_disabled() -> None:
    cfg = _settings(agent_disabled_project_ids=("p1", "p2"))
    assert is_project_ai_enabled("p1", settings=cfg) is False


def test_project_outside_allow_list_is_enabled() -> None:
    cfg = _settings(agent_disabled_project_ids=("p1", "p2"))
    assert is_project_ai_enabled("p3", settings=cfg) is True


def test_disabled_project_ids_filters_blanks() -> None:
    cfg = _settings(agent_disabled_project_ids=("", "p1", " "))
    assert disabled_project_ids(cfg) == {"p1"}


def test_explicit_disabled_set_overrides_settings() -> None:
    assert is_project_ai_enabled("p1", disabled={"p1"}) is False
    assert is_project_ai_enabled("p2", disabled={"p1"}) is True
