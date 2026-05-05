"""Tests for PII redaction of task-card fields before LLM polish calls."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage

from app.agents.catalog.task_estimation import polish_rationale, polish_readiness
from app.agents.llm import make_stub_chat_model
from app.tools.redaction import redact_task_fields


# ---------------------------------------------------------------------------
# Unit tests: redact_task_fields
# ---------------------------------------------------------------------------


def test_redact_task_fields_strips_email_from_taskname() -> None:
    task = {"taskName": "Assign alice@example.com to fix login", "note": "normal"}
    out = redact_task_fields(task)
    assert "[EMAIL]" in out["taskName"]
    assert "alice@example.com" not in out["taskName"]
    # original untouched
    assert task["taskName"] == "Assign alice@example.com to fix login"


def test_redact_task_fields_strips_ssn_from_note() -> None:
    task = {"taskName": "Task", "note": "SSN 123-45-6789 must not leak"}
    out = redact_task_fields(task)
    assert "[SSN]" in out["note"]
    assert "123-45-6789" not in out["note"]


def test_redact_task_fields_strips_card_number_from_epic() -> None:
    task = {"epic": "Payment 4111111111111111 refund", "taskName": "T"}
    out = redact_task_fields(task)
    assert "[CARD]" in out["epic"]
    assert "4111111111111111" not in out["epic"]


def test_redact_task_fields_strips_secret_from_coordinator_id() -> None:
    task = {"coordinatorId": "Bearer abc1234567890xyz", "taskName": "T"}
    out = redact_task_fields(task)
    assert "[SECRET]" in out["coordinatorId"]


def test_redact_task_fields_does_not_mutate_original() -> None:
    task = {"taskName": "Contact admin@corp.com", "note": "keep"}
    _ = redact_task_fields(task)
    assert task["taskName"] == "Contact admin@corp.com"


def test_redact_task_fields_leaves_clean_fields_unchanged() -> None:
    task = {"taskName": "Build a login page", "note": "No PII here", "epic": "Auth"}
    out = redact_task_fields(task)
    assert out == task


def test_redact_task_fields_passes_non_string_values_unchanged() -> None:
    task = {"taskName": None, "note": 42, "epic": ["list"]}
    out = redact_task_fields(task)
    assert out["taskName"] is None
    assert out["note"] == 42
    assert out["epic"] == ["list"]


# ---------------------------------------------------------------------------
# Integration: polish_rationale and polish_readiness receive redacted draft
#
# Strategy: use a real-looking (non-stub) model that records what
# HumanMessage content was passed to ``invoke``. Assert that the content
# does not contain PII patterns.
# ---------------------------------------------------------------------------


class _CapturingModel:
    """Minimal fake chat model that captures the prompt for inspection."""

    def __init__(self, response_rationale: str = "7 points is reasonable") -> None:
        self._rationale = response_rationale
        self.received_prompts: list[str] = []

    def with_structured_output(self, schema: Any, *, include_raw: bool = False) -> Any:
        from app.agents.catalog.task_estimation import (
            EstimationRationale,
            ReadinessPolish,
        )

        rationale_val = self._rationale
        model_self = self

        class _Runnable:
            def invoke(self, messages: Any, **_: Any) -> dict[str, Any]:
                for msg in messages:
                    if isinstance(msg, HumanMessage):
                        model_self.received_prompts.append(msg.content)
                if schema is EstimationRationale:
                    parsed = EstimationRationale(rationale=rationale_val)
                else:
                    # ReadinessPolish: return empty issues so merge is a no-op
                    parsed = ReadinessPolish(issues=[])
                return {"raw": None, "parsed": parsed, "parsing_error": None}

        return _Runnable()


def _pii_draft() -> dict[str, Any]:
    return {
        "taskName": "Contact user@secret.org for review",
        "note": "SSN 111-22-3333 in requirements",
        "epic": "Card 4111111111111111 refund",
        "coordinatorId": "Bearer sk-abc1234567890",
        "type": "feature",
    }


def test_polish_rationale_does_not_forward_pii_in_draft() -> None:
    """The draft passed to polish_rationale must have PII patterns stripped."""

    model = _CapturingModel()
    draft = _pii_draft()
    # Redact before calling, as the ai.py handler now does
    redacted_draft = redact_task_fields(draft)

    polish_rationale(model, "initial rationale", redacted_draft, 5, [])  # type: ignore[arg-type]

    assert model.received_prompts, "model was not called"
    prompt_text = "\n".join(model.received_prompts)
    assert "user@secret.org" not in prompt_text
    assert "111-22-3333" not in prompt_text
    assert "4111111111111111" not in prompt_text
    assert "sk-abc1234567890" not in prompt_text


def test_polish_readiness_does_not_forward_pii_in_draft() -> None:
    """The draft passed to polish_readiness must have PII patterns stripped."""

    model = _CapturingModel()
    draft = _pii_draft()
    redacted_draft = redact_task_fields(draft)

    deterministic: dict[str, Any] = {
        "ready": False,
        "issues": [
            {
                "field": "taskName",
                "severity": "warn",
                "message": "Missing description",
                "suggestion": "Add more detail",
            }
        ],
    }

    polish_readiness(model, deterministic, redacted_draft)  # type: ignore[arg-type]

    assert model.received_prompts, "model was not called"
    prompt_text = "\n".join(model.received_prompts)
    assert "user@secret.org" not in prompt_text
    assert "111-22-3333" not in prompt_text
    assert "4111111111111111" not in prompt_text


def test_polish_rationale_stub_model_returns_deterministic() -> None:
    """Stub model must short-circuit without calling any LLM."""

    result, ti, to = polish_rationale(
        make_stub_chat_model(), "det rationale", {"taskName": "T"}, 3, []
    )
    assert result == "det rationale"
    assert (ti, to) == (0, 0)


def test_polish_readiness_stub_model_returns_deterministic() -> None:
    det: dict[str, Any] = {"ready": True, "issues": []}
    result, ti, to = polish_readiness(make_stub_chat_model(), det, {"taskName": "T"})
    assert result == det
    assert (ti, to) == (0, 0)
