<!-- orchestrate handoff
task: verify-fix-project-list-date-sort
branch: `orch/bug-sweep-4e70/fix-project-list-date-sort` (verifier commit `ff7af82`)
agentId: bc-1fdedbda-3071-4b11-9479-92e93114ff41
runId: run-8f41b69a-b50a-40d0-8957-07a656431aea
resultStatus: finished
finishedAt: 2026-05-19T05:30:39.305Z
-->

## Verification

unit-test-verified

## Target
`fix-project-list-date-sort` on branch `orch/bug-sweep-4e70/fix-project-list-date-sort`

## Branch
`orch/bug-sweep-4e70/fix-project-list-date-sort` (verifier commit `ff7af82`)

## Execution
- → Checked out `orch/bug-sweep-4e70/fix-project-list-date-sort` at worker commit `e4e11d2`.
- → `CI=true npm test -- --watchAll=false --runInBand src/components/projectList` — **PASS**: 1 suite, **12 tests** passed (includes `keeps stable order for empty createdAt when sorting newest` and `…oldest`).
- → `npx tsc --noEmit` — **PASS** (exit 0).
- → Inspected `projectCreatedAtTime` in `src/components/projectList/index.tsx`: missing/empty/invalid `createdAt` → `0` before newest/oldest compare (same guard pattern as `projectCard` `formatDate`).
- → Node one-off: `new Date("" ?? 0).getTime()` is `NaN`; helper maps `""` and `"not-a-date"` to `0`; newest → `[Dated, Empty Alpha, Empty Beta]`, oldest → `[Empty Alpha, Empty Beta, Dated]`.
- → Pushed verifier artifacts: `.orchestrate/bug-sweep-4e70/verification/fix-project-list-date-sort-verifier.log`, `.orchestrate/bug-sweep-4e70/handoffs/verify-fix-project-list-date-sort.md`.

## Findings
Per acceptance criterion:
- [x]: Newest/Oldest sort is stable when createdAt is empty or invalid. **(met)** — tests assert stable tie order for two `createdAt: ""` rows; helper normalizes invalid strings to `0`.
- [x]: Tests cover empty-string createdAt. **(met)** — both newest and oldest cases use `createdAt: ""`.

Other findings (severity-ordered):
- (none)

## Notes & suggestions
- No live UI verification; recipe is unit-test + typecheck only.
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` not present in this workspace (upstream worker noted the same).
- Worker PR #260 not reviewed here; verification is independent of PR metadata.