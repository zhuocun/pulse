<!-- orchestrate handoff
task: verify-fix-use-react-mutation-types
branch: `orch/code-smell-sweep-9be8/fix-use-react-mutation-types` (no verifier commits)
agentId: bc-f4b92671-ac03-44d6-8bee-47c2a4d32482
runId: run-6468e204-33c7-49c3-b926-2108789789fc
resultStatus: finished
finishedAt: 2026-05-18T17:18:50.138Z
-->

## Verification

`unit-test-verified`

## Target
`fix-use-react-mutation-types` on branch `orch/code-smell-sweep-9be8/fix-use-react-mutation-types`

## Branch
`orch/code-smell-sweep-9be8/fix-use-react-mutation-types` (no verifier commits)

## Execution
- → `rg '\bany\b' src/utils/hooks/useReactMutation.ts` — no matches; public `callback` is `OptimisticUpdateCallback` (bivariant `(target: unknown, old?: unknown) => unknown | undefined`); no `eslint-disable` for `no-explicit-any` on that parameter
- → `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useReactMutation` — exit 0; `Test Suites: 1 passed, 1 total`; `Tests: 16 passed, 16 total`; ~3.1s
- → `npm run eslint -- --max-warnings 0 src/utils/hooks/useReactMutation.ts` — exit 0; 0 warnings
- → `npx tsc --noEmit` — exit 0 (production consumers compile with no call-site edits)
- → `git show 31c421e -- src/utils/hooks/useReactMutation.ts` — only change in hook file: `(...args: any) => any` + eslint-disable removed; `OptimisticUpdateCallback` added

## Findings
Per acceptance criterion:
- [x] No `any` in `useReactMutation` public callback type: **met** — grep clean; typed alias on `callback?` parameter
- [x] Existing mutation consumers compile without new eslint disables: **met** — full-project `tsc --noEmit` pass; hook file has no new disables; working tree clean after eslint
- [x] Tests for the hook pass: **met** — 16/16 passing

Other findings (severity-ordered):
- (low): Branch vs `main` includes many unrelated files; verification scoped to `useReactMutation` per recipe; hook change is isolated in commit `31c421e`.

## Notes & suggestions
- Bivariant `bivarianceHack` pattern matches worker notes — needed so narrower optimistic callbacks at production/test call sites stay assignable under strict checking.
- Optional follow-up: export `OptimisticUpdateCallback` for explicit annotations on optimistic helpers; document bivariant pattern in `AGENTS.md` if more callback refactors are planned.