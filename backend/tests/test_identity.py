"""Identity prompt contract: every section heading must be present.

The module is a single source of truth for the Board Copilot role / safety
contract. A silent deletion of any section here would relax the policy
the FE relies on; pin the headings so a rename in identity.py fails CI.
"""

from __future__ import annotations

from app.agents.identity import (
    COPILOT_IDENTITY,
    SECTION_HEADINGS,
    mutation_policy_reminder,
)


def test_identity_loads_as_non_empty_string() -> None:
    assert isinstance(COPILOT_IDENTITY, str)
    # Empirical floor — the doc has five sections plus a preamble; well under
    # 500 chars would mean a section was deleted by mistake.
    assert len(COPILOT_IDENTITY) >= 500


def test_identity_contains_every_required_section_heading() -> None:
    missing = [h for h in SECTION_HEADINGS if f"# {h}" not in COPILOT_IDENTITY]
    assert not missing, f"Missing section headings in COPILOT_IDENTITY: {missing}"


def test_identity_names_board_copilot_role() -> None:
    """The role line must include the product-facing name."""
    assert "Board Copilot" in COPILOT_IDENTITY


def test_identity_locks_mutation_handshake_to_split_tools() -> None:
    """Both halves of the split handshake must be enumerated in the prompt."""
    assert "requestMutationApproval" in COPILOT_IDENTITY
    assert "applyApprovedMutation" in COPILOT_IDENTITY


def test_identity_does_not_mention_legacy_apply_mutation() -> None:
    """The legacy single-stage tool name must not appear in the prompt.

    ``applyMutation`` (without the ``Approved`` qualifier) was the
    deprecated multiplexed tool; mentioning it in the system prompt
    invites the model to call a tool the FE no longer handles.
    """
    # Allow the legitimate split tool name ``applyApprovedMutation``;
    # forbid the bare legacy form.
    stripped = COPILOT_IDENTITY.replace("applyApprovedMutation", "")
    assert "applyMutation" not in stripped


def test_identity_teaches_untrusted_tool_result_block() -> None:
    """The model must be told the envelope is data, not instructions."""
    assert "<untrusted_tool_result" in COPILOT_IDENTITY


def test_mutation_policy_reminder_is_short_and_mentions_handshake() -> None:
    reminder = mutation_policy_reminder()
    assert isinstance(reminder, str)
    # The reminder rides every tool turn -- cap the cost.
    assert len(reminder) <= 320
    assert "requestMutationApproval" in reminder
    assert "applyApprovedMutation" in reminder
