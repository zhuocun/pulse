<!-- orchestrate handoff
task: be-board-brief-extract-counts
branch: orch/code-smell-sweep-2-9be8/be-board-brief-extract-counts
agentId: bc-0f7c5193-df88-4861-b668-c5b7635f631f
runId: run-6cdb096f-10aa-47b3-9b21-21e0e4b3bf2c
resultStatus: finished
finishedAt: 2026-05-18T17:51:21.858Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/be-board-brief-extract-counts`

## What I did
- Extracted `_column_index(columns)` and `_column_task_counts(columns, tasks) -> list[dict]` from `_compute_board_brief` in `backend/app/agents/catalog/board_brief.py`.
- `_compute_board_brief` now calls `_column_task_counts` for `counts` and `_column_index` for `largest_unstarted` filtering; behavior unchanged.
- Added `backend/tests/test_board_brief.py` with four unit tests (per-column counts, invalid-entry skips, non-list tasks, parity with full brief).
- Opened draft PR #248: https://github.com/zhuocun/pulse/pull/248

## Measurements
- `pytest tests/test_board_brief.py -q --no-cov`: 0 → 4 passing
- `ruff check app/agents/catalog/board_brief.py`: 0 issues → 0 issues

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Added `_column_index` as a small shared helper so `_compute_board_brief` does not duplicate the column loop; only `_column_task_counts` was in the brief, but both are private and byte-identical.
- Repo pytest defaults enforce 100% coverage on every run; subset runs need `--no-cov` (4/4 passed). Related board-brief tests in `test_coverage_filling` and `test_v1_ai_shim_parity` also pass with `--no-cov`.
- Did not touch `test_v1_ai_shim_parity.py` (existing golden test still covers end-to-end shape).

## Suggested follow-ups
- None required for this slice; planner may run full backend pytest with coverage on merge.