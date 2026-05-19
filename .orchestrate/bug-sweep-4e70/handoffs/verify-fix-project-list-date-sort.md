## Verification

unit-test-verified

## Target
`fix-project-list-date-sort` on branch `orch/bug-sweep-4e70/fix-project-list-date-sort`

## Branch
`orch/bug-sweep-4e70/fix-project-list-date-sort`

## Execution
- → Confirmed checkout on `orch/bug-sweep-4e70/fix-project-list-date-sort` at `e4e11d2`.
- → `CI=true npm test -- --watchAll=false --runInBand src/components/projectList` — 1 suite, 12 tests passed.
- → `npx tsc --noEmit` — exit 0.
- → Read `projectCreatedAtTime` / `sortProjects` in `src/components/projectList/index.tsx`; empty and invalid `createdAt` normalize to `0` before compare (aligned with `projectCard` `formatDate` guard).
- → Node one-off: reproduced NaN from `new Date("" ?? 0)` vs stable `0` from helper; newest/oldest orders match test expectations.

## Findings
Per acceptance criterion:
- [x]: Newest/Oldest sort is stable when createdAt is empty or invalid. (met)
- [x]: Tests cover empty-string createdAt. (met)

Other findings (severity-ordered):
- (none)

## Notes & suggestions
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` still absent in workspace; verification followed scoped recipe only.
- No live UI pass; unit tests assert DOM card order via sort selector.
