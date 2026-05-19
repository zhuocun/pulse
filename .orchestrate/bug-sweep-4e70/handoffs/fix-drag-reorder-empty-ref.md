<!-- orchestrate handoff
task: fix-drag-reorder-empty-ref
branch: orch/bug-sweep-4e70/fix-drag-reorder-empty-ref
agentId: bc-72f01a0f-260b-47e0-bde7-ba8afbaa5c87
runId: run-2fa383b2-384f-4b0a-baa3-efc51754e4f4
resultStatus: finished
finishedAt: 2026-05-19T05:27:57.425Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-drag-reorder-empty-ref`

## What I did
- Updated `useDragEnd` to omit `referenceId` when there is no reference task at the drop index (instead of sending `""`).
- Normalized `referenceId` in `task_service.reorder` with `reference_id = data.get("referenceId") or None` so empty strings are treated as no reference.
- Adjusted `useDragEnd.test.tsx` to expect a payload without `referenceId` for empty-column drops.
- Added a backend regression in `test_remaining_ordering_branches` for cross-column reorder with `referenceId: ""`.
- Left `reorder.ts` unchanged; it already handles missing/falsy `referenceId` via `if (!referenceId)`.
- Opened draft PR #255 against `main`.

## Measurements
- `npm test (useDragEnd + reorder): 28 passing → 28 passing`
- `pytest test_remaining_ordering_branches: 1 passing → 1 passing`
- `npx tsc --noEmit: exit 0 → exit 0`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Root cause: `referenceTask?._id ?? ""` made the backend hit `(reference_id is not None and reference_task is None)` because `""` is not `None`.
- `reorder.ts` / `reorder.test.ts` already treat `""` as no reference; no change required for optimistic UI consistency.
- Full `pytest -k reorder` hits repo-wide 100% coverage gate when only one test runs; targeted `test_remaining_ordering_branches` passes without `--no-cov`.

## Suggested follow-ups
- None for B1; planner can merge PR #255 after verifier sign-off.