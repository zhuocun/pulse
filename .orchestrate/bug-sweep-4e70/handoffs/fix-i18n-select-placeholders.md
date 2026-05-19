<!-- orchestrate handoff
task: fix-i18n-select-placeholders
branch: orch/bug-sweep-4e70/fix-i18n-select-placeholders
agentId: bc-9809ed18-523c-46f5-8fdc-34b3d11bb743
runId: run-4ba4740a-c7b5-4d81-909f-c6c43bb4e343
resultStatus: finished
finishedAt: 2026-05-19T05:29:36.865Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-i18n-select-placeholders`

## What I did
- Added `microcopy.placeholders.selectCoordinator`, `selectType`, `selectManager`, and `selectStoryPoints` to `en.ts` and `zh-CN.ts`.
- Replaced four English template placeholders in `taskModal` (coordinator, type, story points) and `projectModal` (manager) with the new keys.
- Extended `taskModal` and `projectModal` tests to set `zh-CN` and assert localized placeholder text (and that English `Select a` / `Select story points` strings are absent).
- Opened draft PR [#264](https://github.com/zhuocun/pulse/pull/264).

## Measurements
- Hardcoded `Select a ${...}` / `Select ${...}` in taskModal+projectModal: 4 → 0
- `CI=true npm test -- --watchAll=false --runInBand src/components/taskModal src/components/projectModal`: 28 passing → 28 passing
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `microcopy.ts` is a locale proxy; no file change was required—new keys flow through `en.ts` / `Dictionary` typing automatically.
- Also fixed story-points placeholder (`Select ${...}` without “a”), same i18n bug class as B8.
- No UI screen recording (copy-only change; covered by unit tests).

## Suggested follow-ups
- None for B8 scope.