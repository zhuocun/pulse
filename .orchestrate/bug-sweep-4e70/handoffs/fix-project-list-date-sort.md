<!-- orchestrate handoff
task: fix-project-list-date-sort
branch: orch/bug-sweep-4e70/fix-project-list-date-sort
agentId: bc-0a9bc6da-f413-4022-a039-eaa7690d9de4
runId: run-bef4001e-743f-49ba-8d91-280534f02816
resultStatus: finished
finishedAt: 2026-05-19T05:28:53.162Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-project-list-date-sort`

## What I did
- Added `projectCreatedAtTime()` in `src/components/projectList/index.tsx` to map missing, empty, and invalid `createdAt` values to `0` before comparing timestamps (same contract as `projectCard`’s `formatDate`).
- Wired newest/oldest sort comparators through that helper instead of `new Date(createdAt ?? 0)`, which left `""` as `Invalid Date` / `NaN` and unstable order.
- Extended `index.test.tsx` with newest/oldest cases: two `createdAt: ""` projects plus one dated project; empty-date rows keep input order after sort.
- Pushed branch and opened draft PR #260.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/projectList`: 10 passing → 12 passing
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Root cause: `?? 0` only covers `null`/`undefined`; `createdAt: ""` still produced `NaN` in the comparator.
- Invalid date strings (not only `""`) are also normalized to `0` for consistent tie behavior.
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` was not present in this workspace; fix followed the scoped task brief.
- PR: https://github.com/zhuocun/pulse/pull/260

## Suggested follow-ups
- (none)