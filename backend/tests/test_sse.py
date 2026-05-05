"""Tests for :mod:`app.agents.sse`."""

from __future__ import annotations

import json

from langchain_core.messages import AIMessageChunk

from app.agents.sse import (
    DONE_FRAME,
    encode_sse,
    error_envelope,
    translate_event,
    usage_envelope,
)


def test_translate_updates_passes_through_jsonable() -> None:
    events = list(translate_event("updates", {"node": {"hello": 1}}))
    assert events == [
        {"type": "updates", "ns": [], "data": {"node": {"hello": 1}}}
    ]


def test_translate_updates_lifts_interrupt_payload() -> None:
    events = list(
        translate_event(
            "updates",
            {"__interrupt__": [{"value": {"tool": "fe.boardSnapshot", "args": {"x": 1}}}]},
        )
    )
    assert events == [
        {
            "type": "interrupt",
            "ns": [],
            "data": {"tool": "fe.boardSnapshot", "args": {"x": 1}},
        }
    ]


def test_translate_updates_skips_invalid_interrupt() -> None:
    events = list(
        translate_event(
            "updates",
            {"__interrupt__": [{"value": {"tool": 123}}], "node": {"ok": True}},
        )
    )
    # Invalid interrupt is dropped; non-interrupt updates still flow.
    assert events == [
        {"type": "updates", "ns": [], "data": {"node": {"ok": True}}}
    ]


def test_translate_updates_handles_empty_interrupt_payload() -> None:
    events = list(translate_event("updates", {"__interrupt__": []}))
    assert events == []


def test_translate_updates_lifts_interrupt_with_remainder() -> None:
    events = list(
        translate_event(
            "updates",
            {
                "__interrupt__": {"tool": "fe.viewerContext", "args": {}},
                "node": {"step": 1},
            },
        )
    )
    types = [event["type"] for event in events]
    assert types == ["interrupt", "updates"]


def test_translate_messages_flattens_chunk() -> None:
    events = list(
        translate_event(
            "messages",
            (AIMessageChunk(content="hi"), {"langgraph_node": "respond"}),
            namespace=["ns1"],
        )
    )
    assert len(events) == 1
    envelope = events[0]
    assert envelope["type"] == "messages"
    assert envelope["ns"] == ["ns1"]
    token, metadata = envelope["data"]
    assert token["content"] == "hi"
    assert token["type"] == "AIMessageChunk"
    assert metadata == {"langgraph_node": "respond"}


def test_translate_messages_falls_back_to_string_content() -> None:
    events = list(translate_event("messages", "raw"))
    assert events[0]["data"][0]["content"] == "raw"


def test_translate_custom_passes_payload() -> None:
    events = list(translate_event("custom", {"kind": "citation", "refs": []}))
    assert events == [
        {"type": "custom", "ns": [], "data": {"kind": "citation", "refs": []}}
    ]


def test_translate_unknown_mode_falls_back_to_custom() -> None:
    events = list(translate_event("debug", {"hello": 1}, namespace=("a", "b")))
    assert events[0]["type"] == "custom"
    assert events[0]["ns"] == ["a", "b"]
    assert events[0]["data"] == {"mode": "debug", "chunk": {"hello": 1}}


def test_translate_handles_non_jsonable() -> None:
    """Unserialisable values fall back to a structured placeholder.

    ``jsonable_encoder`` first tries to coerce the object; for an
    arbitrary class with no schema and no JSON path, the encoder falls
    back to the dict view (an empty dict in the no-attribute case).
    Either way the payload remains a dict so the FE discriminator
    still parses it.
    """

    class Boom:
        def __repr__(self) -> str:
            return "<boom>"

    events = list(translate_event("updates", {"weird": Boom()}))
    assert events[0]["type"] == "updates"
    assert isinstance(events[0]["data"], dict)
    # The exact serialised shape of the unrecognised object is not part
    # of the contract; we just need the wrapping dict structure.
    assert "weird" in events[0]["data"]


def test_namespace_normalisation() -> None:
    events = list(translate_event("updates", {"a": 1}, namespace=None))
    assert events[0]["ns"] == []
    events = list(translate_event("updates", {"a": 1}, namespace="single"))
    assert events[0]["ns"] == ["single"]


def test_error_envelope_shape() -> None:
    envelope = error_envelope("boom", recoverable=True)
    assert envelope == {
        "type": "error",
        "ns": [],
        "data": {"message": "boom", "recoverable": True},
    }


def test_usage_envelope_shape() -> None:
    envelope = usage_envelope(10, 5)
    assert envelope == {
        "type": "custom",
        "ns": [],
        "data": {"kind": "usage", "tokensIn": 10, "tokensOut": 5},
    }


def test_usage_envelope_clamps_negative_inputs() -> None:
    envelope = usage_envelope(-5, -3)
    assert envelope["data"]["tokensIn"] == 0
    assert envelope["data"]["tokensOut"] == 0


def test_encode_sse_produces_bytes_frame() -> None:
    frame = encode_sse({"type": "updates", "ns": [], "data": {"k": 1}})
    assert frame.endswith(b"\n\n")
    payload = json.loads(frame.decode("utf-8").removeprefix("data: ").strip())
    assert payload["type"] == "updates"


def test_done_frame_constant() -> None:
    assert DONE_FRAME == b"data: [DONE]\n\n"


def test_translate_messages_flattens_bare_message() -> None:
    events = list(translate_event("messages", AIMessageChunk(content="solo")))
    token, metadata = events[0]["data"]
    assert token == {"content": "solo", "type": "AIMessageChunk"}
    assert metadata == {}
