from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock, patch

from typing import TypedDict

from app.routers.agents import _request_context


@dataclass
class _CtxDataclass:
    suffix: str = "!"
    chat_model: object | None = None


@dataclass(frozen=True)
class _FrozenCtx:
    suffix: str = "!"


class _Ctx:
    __slots__ = ("suffix",)

    def __init__(self, suffix: str = "!") -> None:
        self.suffix = suffix


class _TD(TypedDict, total=False):
    suffix: str


def test_request_context_dict_overlay_merge() -> None:
    runtime = MagicMock()
    runtime.get.return_value.metadata.context_schema = _TD
    payload = {"context": {"suffix": "?"}, "inputs": {"project_id": "p9"}}
    fake_model = object()
    with patch(
        "app.routers.agents.project_chat_model_from_map",
        return_value={"chat_model": fake_model},
    ):
        ctx = _request_context("a", payload, runtime, request=None)
    assert ctx == {"suffix": "?", "chat_model": fake_model}


def test_request_context_setattr_merge_for_dataclass_body() -> None:
    runtime = MagicMock()
    runtime.get.return_value.metadata.context_schema = _CtxDataclass
    payload = {
        "context": {"suffix": "?"},
        "inputs": {"project_id": "p9"},
    }
    fake_model = object()
    with patch(
        "app.routers.agents.project_chat_model_from_map",
        return_value={"chat_model": fake_model},
    ):
        ctx = _request_context("echo-agent", payload, runtime, request=None)
    assert isinstance(ctx, _CtxDataclass)
    assert ctx.suffix == "?"
    assert ctx.chat_model is fake_model


def test_request_context_project_model_without_body_context() -> None:
    runtime = MagicMock()
    payload: dict = {"inputs": {"project_id": "p9"}}
    fake_model = object()
    with patch(
        "app.routers.agents.project_chat_model_from_map",
        return_value={"chat_model": fake_model},
    ):
        ctx = _request_context("echo-agent", payload, runtime, request=None)
    assert ctx == {"chat_model": fake_model}
    runtime.get.assert_not_called()


def test_request_context_overlay_when_body_is_frozen() -> None:
    runtime = MagicMock()
    runtime.get.return_value.metadata.context_schema = _FrozenCtx
    payload = {"context": {"suffix": "?"}, "inputs": {"project_id": "p9"}}
    fake_model = object()
    with patch(
        "app.routers.agents.project_chat_model_from_map",
        return_value={"chat_model": fake_model},
    ):
        ctx = _request_context("echo-agent", payload, runtime, request=None)
    assert ctx == {"chat_model": fake_model}


def test_request_context_overlay_wins_when_setattr_fails() -> None:
    runtime = MagicMock()
    runtime.get.return_value.metadata.context_schema = _Ctx
    payload = {"context": {"suffix": "?"}, "inputs": {"project_id": "p9"}}
    with patch(
        "app.routers.agents.project_chat_model_from_map",
        return_value={"chat_model": object()},
    ):
        ctx = _request_context("a", payload, runtime, request=None)
    assert isinstance(ctx, dict)
    assert "chat_model" in ctx
