<!-- orchestrate handoff
task: fix-project-modal-errors
branch: orch/code-smell-sweep-9be8/fix-project-modal-errors
agentId: bc-583bd554-a26a-4fd2-9860-c74a4aa50f0e
runId: run-f5934930-e8b7-453f-9e5c-d2481f8588ec
resultStatus: finished
finishedAt: 2026-05-18T17:17:40.733Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/fix-project-modal-errors`

## What I did
- Replaced `mutateAsync(payload).then(onClose).catch(() => {})` in `ProjectModal` with the `taskModal` pattern: `onError` callbacks set local `saveError`, `ErrorBox` renders it, async `onFinish` only calls `onClose` on success.
- Cleared `saveError` on modal close so stale errors don't persist.
- Added tests for failed POST (create) and PUT (edit): modal stays open, error message visible, Redux modal state unchanged.

## Measurements
- `empty catch on project mutation`: 1 → 0
- `CI=true npm test -- --watchAll=false --runInBand src/components/projectModal`: 4 passing → 6 passing

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `.orchestrate/code-smell-sweep-9be8/` audit files were not present locally; implementation followed existing `taskModal` inline `ErrorBox` + `saveError` pattern rather than `message.error`.
- Draft PR: https://github.com/zhuocun/pulse/pull/241

## Suggested follow-ups
- (none)