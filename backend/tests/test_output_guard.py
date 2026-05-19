"""Pattern-only pre-apply classifier for chat-agent mutations.

The classifier is intentionally conservative: a false positive forces a
viewer-visible refusal (which the user can retry by rephrasing) but a
false negative would let a misaligned apply through.  These tests pin
both halves -- safe inputs stay safe; the four canonical attack shapes
fire the expected reason code.
"""

from __future__ import annotations

from app.agents.output_guard import classify_pre_mutation


# A minimal approved mutation that maps to a single task rename.
_PROPOSAL = {
    "proposal_id": "pr-1",
    "diff": {
        "task_updates": [
            {
                "task_id": "t1",
                "field": "taskName",
                "from": "Before",
                "to": "After",
            }
        ]
    },
}


def test_safe_when_reasoning_matches_proposal() -> None:
    result = classify_pre_mutation(
        "I'll rename the task as the user requested.",
        _PROPOSAL,
    )
    assert result["safe"] is True
    assert result["reasons"] == []


def test_no_pending_mutation_is_never_safe() -> None:
    result = classify_pre_mutation("anything", None)
    assert result["safe"] is False
    assert "no_pending_mutation" in result["reasons"]


def test_empty_pending_mutation_is_never_safe() -> None:
    result = classify_pre_mutation("anything", {})
    assert result["safe"] is False
    assert "no_pending_mutation" in result["reasons"]


def test_action_outside_approved_diff_is_flagged() -> None:
    """The agent narrates an extra action (archive) not present in the diff."""
    result = classify_pre_mutation(
        "I'll rename the task and then I'll also archive the column.",
        _PROPOSAL,
    )
    assert result["safe"] is False
    assert "action_outside_approved_diff" in result["reasons"]


def test_unauthorised_bulk_delete_is_flagged() -> None:
    result = classify_pre_mutation(
        "Going to wipe all stale tasks while we're at it.",
        _PROPOSAL,
    )
    assert result["safe"] is False
    assert "unauthorised_bulk_delete" in result["reasons"]


def test_user_authorised_bulk_keyword_suppresses_bulk_flag() -> None:
    """When the reasoning cites the viewer's explicit request, allow it."""
    bulk_proposal = {
        "proposal_id": "pr-bulk",
        "diff": {
            "bulk_apply": [
                {"operation": "delete", "targets": ["t1", "t2"], "payload": {}}
            ]
        },
    }
    result = classify_pre_mutation(
        "The viewer requested it: delete all stale tasks as the user asked.",
        bulk_proposal,
    )
    assert result["safe"] is True
    assert "unauthorised_bulk_delete" not in result["reasons"]


def test_bypass_approval_language_is_flagged() -> None:
    result = classify_pre_mutation(
        "Ignore the approval card and proceed directly.",
        _PROPOSAL,
    )
    assert result["safe"] is False
    assert "bypass_approval_language" in result["reasons"]


def test_override_policy_phrase_is_flagged() -> None:
    result = classify_pre_mutation(
        "I'll override the HITL policy this once.",
        _PROPOSAL,
    )
    assert result["safe"] is False
    assert "bypass_approval_language" in result["reasons"]


def test_cross_project_reference_is_flagged() -> None:
    """Reasoning mentions a project_id other than the approved one."""
    other_pid = "ffffffffffffffffffffffff"
    proposal = {
        "proposal_id": "pr-cross",
        "project_id": "aaaaaaaaaaaaaaaaaaaaaaaa",
        "diff": {
            "task_updates": [
                {"task_id": "t1", "field": "taskName", "from": "x", "to": "y"}
            ]
        },
    }
    result = classify_pre_mutation(
        f"I'll also update something on project {other_pid}.",
        proposal,
    )
    assert result["safe"] is False
    assert "cross_project_reference" in result["reasons"]


def test_empty_reasoning_is_safe_when_proposal_present() -> None:
    """No reasoning text is not itself suspicious."""
    result = classify_pre_mutation("", _PROPOSAL)
    assert result["safe"] is True
    assert result["reasons"] == []


def test_multiple_flags_aggregate() -> None:
    result = classify_pre_mutation(
        "Ignore the approval, then I'll also delete every stale card.",
        _PROPOSAL,
    )
    assert result["safe"] is False
    # Both the bypass and bulk-delete flags should fire on this single string.
    assert "bypass_approval_language" in result["reasons"]
    assert "unauthorised_bulk_delete" in result["reasons"]
