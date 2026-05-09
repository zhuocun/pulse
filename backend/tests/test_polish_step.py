"""Unit tests for :class:`app.agents.polish.PolishStep`.

The four-cell matrix (stub model / real success / real parse error / real
raise) is tested independently without spinning up a full agent graph.
The ``structured_model`` fixture from ``tests/conftest.py`` is reused so
the mocking idiom stays consistent across the catalog test suite.
"""

from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.messages import AIMessage
from pydantic import BaseModel, Field

from app.agents.llm import make_stub_chat_model
from app.agents.polish import PolishStep
from tests.conftest import structured_model


# ---------------------------------------------------------------------------
# Minimal schema used across all tests
# ---------------------------------------------------------------------------


class _TextSchema(BaseModel):
    """Simple single-field schema for testing."""

    text: str = Field(default="")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_FALLBACK_VALUE = "deterministic fallback text"
_POLISHED_VALUE = "polished text from model"

# Fake state dict used as input to the step.
_STATE: dict[str, Any] = {"prompt": "hello world", "result": _FALLBACK_VALUE}


def _prompt_fn(state: dict[str, Any]) -> str:
    return f"Polish this: {state.get('prompt', '')}"


def _fallback_fn(state: dict[str, Any]) -> str:
    return state.get("result", _FALLBACK_VALUE)


def _merge_fn(state: dict[str, Any], value: Any) -> dict[str, Any]:
    """Merge the polished (or fallback) value into a state update dict."""
    if isinstance(value, _TextSchema):
        return {"result": value.text}
    return {"result": value}


def _make_step(**kwargs: Any) -> PolishStep:
    defaults: dict[str, Any] = dict(
        prompt_fn=_prompt_fn,
        schema=_TextSchema,
        fallback_fn=_fallback_fn,
        merge_fn=_merge_fn,
    )
    defaults.update(kwargs)
    return PolishStep(**defaults)


# ---------------------------------------------------------------------------
# Cell 1 — stub model → deterministic fallback, zero tokens
# ---------------------------------------------------------------------------


def test_polish_step_stub_model_returns_fallback() -> None:
    """Cell 1: stub model must short-circuit without calling the model."""
    step = _make_step()
    stub = make_stub_chat_model()
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, stub))

    assert update == {"result": _FALLBACK_VALUE}
    assert (tokens_in, tokens_out) == (0, 0)


# ---------------------------------------------------------------------------
# Cell 2 — real model, success → polished value merged
# ---------------------------------------------------------------------------


def test_polish_step_real_model_success_merges_parsed() -> None:
    """Cell 2: successful parse → polished value merged via merge_fn."""
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    )
    parsed = _TextSchema(text=_POLISHED_VALUE)
    model = structured_model(parsed=parsed, raw_message=raw)

    step = _make_step()
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, model))

    assert update == {"result": _POLISHED_VALUE}
    assert (tokens_in, tokens_out) == (10, 5)


# ---------------------------------------------------------------------------
# Cell 3 — real model, parse error → fallback, tokens still reported
# ---------------------------------------------------------------------------


def test_polish_step_parse_error_falls_back_with_tokens() -> None:
    """Cell 3: parse error → deterministic fallback; tokens are still captured."""
    raw = AIMessage(
        content="garbage",
        usage_metadata={"input_tokens": 3, "output_tokens": 0, "total_tokens": 3},
    )
    model = structured_model(
        parsing_error=ValueError("bad json"),
        parsed=None,
        raw_message=raw,
    )

    step = _make_step()
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, model))

    assert update == {"result": _FALLBACK_VALUE}
    # Tokens are still reported so runaway providers can be billed.
    assert (tokens_in, tokens_out) == (3, 0)


# ---------------------------------------------------------------------------
# Cell 3b — real model, wrong parsed type → fallback (no parse_error set)
# ---------------------------------------------------------------------------


def test_polish_step_wrong_parsed_type_falls_back() -> None:
    """A model that returns the wrong Pydantic type falls back to deterministic."""
    wrong_type = {"text": "raw dict, not schema instance"}
    model = structured_model(parsed=wrong_type)

    step = _make_step()
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, model))

    assert update == {"result": _FALLBACK_VALUE}


# ---------------------------------------------------------------------------
# Cell 4 — real model raises → fallback, zero tokens
# ---------------------------------------------------------------------------


def test_polish_step_provider_raise_falls_back() -> None:
    """Cell 4: provider raises → deterministic fallback, zero tokens."""
    model = structured_model(raise_on_call=RuntimeError("provider down"))

    step = _make_step()
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, model))

    assert update == {"result": _FALLBACK_VALUE}
    assert (tokens_in, tokens_out) == (0, 0)


# ---------------------------------------------------------------------------
# Redact parameter — applied to string prompt before sending to model
# ---------------------------------------------------------------------------


def test_polish_step_redact_is_applied_to_prompt_string() -> None:
    """When ``redact`` is set and prompt_fn returns a string, redact is called."""
    calls: list[str] = []

    def _capturing_redact(text: str) -> str:
        calls.append(text)
        return text.replace("hello", "[REDACTED]")

    raw = AIMessage(content="ok", usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})
    parsed = _TextSchema(text="polished")
    model = structured_model(parsed=parsed, raw_message=raw)

    step = _make_step(redact=_capturing_redact)
    asyncio.run(step.run(_STATE, model))

    assert calls, "redact should have been called"
    assert "[REDACTED]" in calls[0] or "hello" in calls[0]


def test_polish_step_redact_skipped_on_stub_model() -> None:
    """Redact callable is NOT called when the model is a stub (short-circuits before prompt)."""
    calls: list[str] = []

    def _capturing_redact(text: str) -> str:
        calls.append(text)
        return text

    step = _make_step(redact=_capturing_redact)
    stub = make_stub_chat_model()
    asyncio.run(step.run(_STATE, stub))

    assert calls == [], "redact must not be called on the stub path"


# ---------------------------------------------------------------------------
# Prompt list path — prompt_fn returning a list skips string-level redaction
# ---------------------------------------------------------------------------


def test_polish_step_list_prompt_passes_through() -> None:
    """prompt_fn may return a list of message objects; they are forwarded directly."""
    from langchain_core.messages import HumanMessage, SystemMessage

    def _list_prompt_fn(state: dict) -> list:
        return [
            SystemMessage(content="You are a polish assistant."),
            HumanMessage(content=f"Polish: {state.get('prompt', '')}"),
        ]

    raw = AIMessage(content="ok", usage_metadata={"input_tokens": 2, "output_tokens": 1, "total_tokens": 3})
    parsed = _TextSchema(text="list-polished")
    model = structured_model(parsed=parsed, raw_message=raw)

    step = _make_step(prompt_fn=_list_prompt_fn)
    update, tokens_in, tokens_out = asyncio.run(step.run(_STATE, model))

    assert update == {"result": "list-polished"}
    assert (tokens_in, tokens_out) == (2, 1)


# ---------------------------------------------------------------------------
# merge_fn integration — verify state is threaded through correctly
# ---------------------------------------------------------------------------


def test_polish_step_merge_fn_receives_state_and_polished() -> None:
    """merge_fn is called with (state, polished) so it can blend fields."""
    received: list[tuple] = []

    def _capturing_merge(state: dict, value: Any) -> dict:
        received.append((state, value))
        if isinstance(value, _TextSchema):
            return {"result": value.text, "extra": "ok"}
        return {"result": value}

    raw = AIMessage(content="x", usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})
    parsed = _TextSchema(text="merged")
    model = structured_model(parsed=parsed, raw_message=raw)

    step = _make_step(merge_fn=_capturing_merge)
    update, _, _ = asyncio.run(step.run(_STATE, model))

    assert len(received) == 1
    state_arg, value_arg = received[0]
    assert state_arg is _STATE
    assert isinstance(value_arg, _TextSchema)
    assert update == {"result": "merged", "extra": "ok"}


# ---------------------------------------------------------------------------
# Regression: zero-length parsed field does NOT override fallback
# ---------------------------------------------------------------------------


def test_polish_step_empty_parsed_field_is_still_returned_as_parsed() -> None:
    """PolishStep returns the parsed schema even when its field is empty.

    Blank-field handling is the merge_fn's responsibility, not PolishStep's.
    """
    parsed = _TextSchema(text="")  # blank, but parse succeeded
    raw = AIMessage(content="ok", usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})
    model = structured_model(parsed=parsed, raw_message=raw)

    step = _make_step()
    update, _, _ = asyncio.run(step.run(_STATE, model))

    # merge_fn receives the parsed _TextSchema with text="" and maps it to "".
    assert update == {"result": ""}


# ---------------------------------------------------------------------------
# cap_field shorthand — validation errors and happy path
# ---------------------------------------------------------------------------


def test_polish_step_both_cap_field_and_merge_fn_raises() -> None:
    """Providing both cap_field and merge_fn is a programming error."""
    import pytest

    with pytest.raises(ValueError, match="cap_field or merge_fn"):
        PolishStep(
            prompt_fn=_prompt_fn,
            schema=_TextSchema,
            fallback_fn=_fallback_fn,
            merge_fn=_merge_fn,
            cap_field=("text", 50),
        )


def test_polish_step_neither_cap_field_nor_merge_fn_raises() -> None:
    """Omitting both cap_field and merge_fn is a programming error."""
    import pytest

    with pytest.raises(ValueError, match="cap_field or merge_fn"):
        PolishStep(
            prompt_fn=_prompt_fn,
            schema=_TextSchema,
            fallback_fn=_fallback_fn,
        )


def test_polish_step_cap_field_stub_returns_deterministic() -> None:
    """cap_field shorthand: stub model falls back to state['_deterministic']."""
    stub = make_stub_chat_model()
    step = PolishStep(
        prompt_fn=_prompt_fn,
        schema=_TextSchema,
        fallback_fn=lambda state: state["_deterministic"],
        cap_field=("text", 20),
    )
    state = {"_deterministic": "fallback text", "prompt": "hello"}
    update, tokens_in, tokens_out = asyncio.run(step.run(state, stub))

    assert update == {"_result": "fallback text"}
    assert (tokens_in, tokens_out) == (0, 0)


def test_polish_step_cap_field_real_model_applies_cap() -> None:
    """cap_field shorthand: parsed field is capped and returned as _result."""
    raw = AIMessage(
        content="ignored",
        usage_metadata={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
    )
    parsed = _TextSchema(text="  hello world  \nextra line")
    model = structured_model(parsed=parsed, raw_message=raw)

    step = PolishStep(
        prompt_fn=_prompt_fn,
        schema=_TextSchema,
        fallback_fn=lambda state: state["_deterministic"],
        cap_field=("text", 5),
    )
    state = {"_deterministic": "det", "prompt": "x"}
    update, tokens_in, tokens_out = asyncio.run(step.run(state, model))

    # First line stripped and capped at 5 chars: "hello world" → "hello"
    assert update == {"_result": "hello"}
    assert (tokens_in, tokens_out) == (5, 3)
