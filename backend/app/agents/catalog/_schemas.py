"""Catalog-wide max-length constants for LLM-polish output schemas.

The catalog uses ``with_structured_output(...)`` to constrain provider
output to small Pydantic schemas before merging back into deterministic
baselines.  The numeric ``max_length`` bound on each field used to be
sprinkled inline across six files which made it impossible to tell
whether ``120`` was an FE layout cap, a UX preference, or a value
copy-pasted from the nearest agent.

Each constant here carries a one-line comment explaining where the
bound comes from so a new agent author can choose deliberately.

Module name is prefixed with ``_`` so the catalog auto-discovery loop
in ``app.agents.catalog.__init__`` skips it.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# board_brief
# ---------------------------------------------------------------------------

# IBoardBrief.headline is rendered on a single FE row; 120 chars is the
# longest the layout absorbs before truncation.
HEADLINE_MAX = 120


# ---------------------------------------------------------------------------
# task_drafting
# ---------------------------------------------------------------------------

# ITaskDraft.taskName is the FE card title; 80 chars matches the existing
# task title column UX cap.
TASKNAME_MAX = 80
# ITaskDraft.note is the multi-line description block; conservative cap
# keeps cost flat without truncating realistic descriptions.
NOTE_MAX = 500
# ITaskDraft.rationale renders as a one-line "why" badge alongside the
# card; 180 keeps it on one wrapped row.
DRAFT_RATIONALE_MAX = 180


# ---------------------------------------------------------------------------
# task_estimation
# ---------------------------------------------------------------------------

# ``Estimate.rationale`` shares the same FE row treatment as drafting.
ESTIMATION_RATIONALE_MAX = 180
# ReadinessIssue.field is a JSON property name (taskName, note,
# coordinatorId); 40 covers all known fields with headroom.
READINESS_FIELD_MAX = 40
# ReadinessIssue.message and .suggestion render in the issue chip; 160
# matches the chip's two-line layout.
READINESS_MESSAGE_MAX = 160


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------

# SearchRanking.ids: hard cap on the LLM-returned ranking (the v1 shim
# already truncates to 10 client-side; mirror it server-side).
SEARCH_IDS_MAX = 10
# SearchRanking.rationale renders inline above the result list; 240
# allows a slightly longer one-line summary than the per-card rationale.
SEARCH_RATIONALE_MAX = 240
# SearchRanking.expanded_terms is an open list; cap at 20 so a misbehaving
# model can't return thousands of expansions to flood the FE.
EXPANDED_TERMS_MAX = 20


# ---------------------------------------------------------------------------
# triage
# ---------------------------------------------------------------------------

# TriagePolish.nudge_id mirrors the deterministic ``{type}:{idx}`` key;
# 80 is comfortably above the longest type name + index.
NUDGE_ID_MAX = 80
# TriagePolish.summary renders in the nudge chip alongside the icon;
# 120 keeps it on one row.
NUDGE_SUMMARY_MAX = 120


__all__ = [
    "DRAFT_RATIONALE_MAX",
    "ESTIMATION_RATIONALE_MAX",
    "EXPANDED_TERMS_MAX",
    "HEADLINE_MAX",
    "NOTE_MAX",
    "NUDGE_ID_MAX",
    "NUDGE_SUMMARY_MAX",
    "READINESS_FIELD_MAX",
    "READINESS_MESSAGE_MAX",
    "SEARCH_IDS_MAX",
    "SEARCH_RATIONALE_MAX",
    "TASKNAME_MAX",
]
