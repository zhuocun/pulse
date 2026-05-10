from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.config import settings as global_settings
from app.routers._dispatch import (
    merged_v1_chat_context,
    project_chat_model_from_map,
)


def test_project_chat_model_from_map_requires_allowlist_match() -> None:
    cfg = replace(
        global_settings,
        agent_project_chat_model_map={"p1": "bad-model"},
        agent_chat_model_allowlist=("good-model",),
    )
    with pytest.raises(HTTPException) as exc:
        project_chat_model_from_map("p1", settings=cfg)
    assert exc.value.status_code == 500


def test_merged_v1_header_wins_over_map() -> None:
    req = MagicMock()
    with (
        patch(
            "app.routers._dispatch.project_chat_model_from_map",
            return_value={"chat_model": "from_map"},
        ),
        patch(
            "app.routers._dispatch.chat_model_override_from_request",
            return_value={"chat_model": "from_header"},
        ),
    ):
        merged = merged_v1_chat_context(project_id="p9", request=req)
    assert merged == {"chat_model": "from_header"}


def test_merged_v1_map_when_no_header() -> None:
    req = MagicMock()
    with (
        patch(
            "app.routers._dispatch.project_chat_model_from_map",
            return_value={"chat_model": "from_map"},
        ),
        patch(
            "app.routers._dispatch.chat_model_override_from_request",
            return_value=None,
        ),
    ):
        merged = merged_v1_chat_context(project_id="p9", request=req)
    assert merged == {"chat_model": "from_map"}


def test_merged_v1_header_only_when_map_absent() -> None:
    req = MagicMock()
    with (
        patch(
            "app.routers._dispatch.project_chat_model_from_map",
            return_value=None,
        ),
        patch(
            "app.routers._dispatch.chat_model_override_from_request",
            return_value={"chat_model": "header_only"},
        ),
    ):
        merged = merged_v1_chat_context(project_id="p9", request=req)
    assert merged == {"chat_model": "header_only"}


def test_merged_v1_returns_none_when_both_absent() -> None:
    req = MagicMock()
    with (
        patch(
            "app.routers._dispatch.project_chat_model_from_map",
            return_value=None,
        ),
        patch(
            "app.routers._dispatch.chat_model_override_from_request",
            return_value=None,
        ),
    ):
        assert merged_v1_chat_context(project_id=None, request=req) is None


def test_project_chat_model_from_map_happy_path() -> None:
    cfg = replace(
        global_settings,
        agent_project_chat_model_map={"p1": "m1"},
        agent_chat_model_allowlist=("m1",),
    )
    sentinel = object()
    with patch(
        "app.routers._dispatch.make_chat_model_for_id",
        return_value=sentinel,
    ):
        out = project_chat_model_from_map("p1", settings=cfg)
    assert out == {"chat_model": sentinel}
