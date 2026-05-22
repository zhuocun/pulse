"""Tests for request-size enforcement in v1 and v2.1 AI surfaces."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any, Iterable

import pytest
from fastapi.testclient import TestClient
from pytest import FixtureRequest

from app import main, security
from app.agents.limits import enforce_request_limits
from app.routers.agents import _input_token_estimate
from app.security import create_token
from tests.conftest import FakeStore, seed_agent_test_projects_if_absent


# ---------------------------------------------------------------------------
# Unit tests for enforce_request_limits directly
# ---------------------------------------------------------------------------


def test_oversized_prompt_raises_413() -> None:
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"prompt": "x" * 9000})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_too_many_messages_raises_413() -> None:
    messages = [{"role": "user", "content": "hi"} for _ in range(51)]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"messages": messages})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_oversized_single_message_raises_413() -> None:
    messages = [{"role": "user", "content": "x" * 9000}]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"messages": messages})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_oversized_total_body_raises_413() -> None:
    # 70 KiB body exceeds the 64 KiB limit
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"data": "x" * 71680})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_normal_payload_passes() -> None:
    enforce_request_limits(
        {
            "prompt": "Write a task",
            "messages": [{"role": "user", "content": "hello"}],
        }
    )


def test_inputs_messages_too_many_raises_413() -> None:
    msgs = [{"role": "user", "content": "x"} for _ in range(51)]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"inputs": {"messages": msgs}})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_inputs_message_oversized_content_raises_413() -> None:
    msgs = [{"role": "user", "content": "x" * 9000}]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"inputs": {"messages": msgs}})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_inputs_message_oversized_content_block_raises_413() -> None:
    msgs = [
        {
            "role": "user",
            "content": [{"type": "text", "text": "x" * 9000}],
        }
    ]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"inputs": {"messages": msgs}})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_inputs_message_oversized_tool_result_block_raises_413() -> None:
    msgs = [
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "content": [{"type": "text", "text": "x" * 9000}],
                }
            ],
        }
    ]
    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"inputs": {"messages": msgs}})
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_input_token_estimate_counts_content_blocks() -> None:
    assert (
        _input_token_estimate(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "hello world"},
                            {
                                "type": "tool_result",
                                "content": [{"type": "text", "text": "tool output"}],
                            },
                        ],
                    }
                ]
            }
        )
        > 1
    )


def test_exactly_50_messages_passes() -> None:
    messages = [{"role": "user", "content": "hi"} for _ in range(50)]
    enforce_request_limits({"messages": messages})


def test_content_length_header_fastpath_rejects_oversized() -> None:
    """An oversized ``Content-Length`` header is rejected before the
    parsed-body re-serialisation cost is paid."""

    class _RequestStub:
        headers = {"content-length": "10000000"}  # 10 MB declared

    with pytest.raises(Exception) as exc_info:
        enforce_request_limits({"prompt": "tiny"}, request=_RequestStub())  # type: ignore[arg-type]
    assert exc_info.value.status_code == 413  # type: ignore[attr-defined]


def test_content_length_header_invalid_falls_through_to_body_check() -> None:
    """A malformed ``Content-Length`` does not cause a fast-path rejection;
    the body-size check still runs (and passes for a tiny payload)."""

    class _RequestStub:
        headers = {"content-length": "not-a-number"}

    enforce_request_limits({"prompt": "tiny"}, request=_RequestStub())  # type: ignore[arg-type]


def test_content_length_header_within_limit_falls_through() -> None:
    class _RequestStub:
        headers = {"content-length": "100"}

    enforce_request_limits({"prompt": "ok"}, request=_RequestStub())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# HTTP integration: v1 router family (/api/ai/*)
# ---------------------------------------------------------------------------


@pytest.fixture()
def ai_client(request: FixtureRequest) -> Iterable[TestClient]:
    store: FakeStore = request.getfixturevalue("store")
    seed_agent_test_projects_if_absent(store)
    with TestClient(main.app) as client:
        yield client


@pytest.fixture()
def ai_headers() -> dict[str, str]:
    object.__setattr__(
        security.settings,
        "jwt_secret",
        "test-secret-change-me-32-bytes-long",
    )
    token = create_token("ai-user")
    return {"Authorization": f"Bearer {token}"}


def test_v1_task_draft_oversized_prompt_returns_413(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    payload: dict[str, Any] = {
        "prompt": "x" * 9000,
        "context": {"project": {"_id": "p-1"}},
    }
    resp = ai_client.post("/api/ai/task-draft", json=payload, headers=ai_headers)
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_v1_chat_too_many_messages_returns_413(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    messages = [{"role": "user", "content": "hello"} for _ in range(51)]
    payload: dict[str, Any] = {"messages": messages}
    resp = ai_client.post("/api/ai/chat", json=payload, headers=ai_headers)
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_v1_chat_oversized_message_content_returns_413(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    messages = [{"role": "user", "content": "x" * 9000}]
    payload: dict[str, Any] = {"messages": messages}
    resp = ai_client.post("/api/ai/chat", json=payload, headers=ai_headers)
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_v1_estimate_oversized_body_returns_413(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    payload: dict[str, Any] = {"note": "x" * 71680}
    resp = ai_client.post("/api/ai/estimate", json=payload, headers=ai_headers)
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_v1_route_rejects_oversized_content_length_fastpath(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    headers = {
        **ai_headers,
        "content-type": "application/json",
        "content-length": "10000000",
    }
    resp = ai_client.post(
        "/api/ai/task-draft",
        content=b'{"prompt":"tiny","context":{"project":{"_id":"p-1"}}}',
        headers=headers,
    )
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE


def test_v1_normal_payload_passes(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    payload: dict[str, Any] = {
        "prompt": "Build a login page",
        "context": {"project": {"_id": "p-1"}},
    }
    resp = ai_client.post("/api/ai/task-draft", json=payload, headers=ai_headers)
    assert resp.status_code == HTTPStatus.OK
    assert "taskName" in resp.json()


# ---------------------------------------------------------------------------
# HTTP integration: v2.1 router family (/api/v1/agents/*)
# ---------------------------------------------------------------------------


def test_v21_invoke_rejects_oversized_content_length_fastpath(
    ai_client: TestClient, ai_headers: dict[str, str]
) -> None:
    headers = {
        **ai_headers,
        "content-type": "application/json",
        "content-length": "10000000",
    }
    resp = ai_client.post(
        "/api/v1/agents/chat-agent/invoke",
        content=b'{"inputs":{"messages":[{"role":"user","content":"ping"}]}}',
        headers=headers,
    )
    assert resp.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
