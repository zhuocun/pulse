<!-- orchestrate handoff
task: verify-fix-project-modal-errors
branch: `orch/code-smell-sweep-9be8/fix-project-modal-errors` (no verifier commits; working tree clean)
agentId: bc-cf4197ec-0d11-4190-aa4e-a7a65c62dddf
runId: run-06071cf7-8db5-4cb3-9d94-4259a249ba0c
resultStatus: finished
finishedAt: 2026-05-18T17:19:23.941Z
-->

## Verification

`unit-test-verified`

## Target
`fix-project-modal-errors` on branch `orch/code-smell-sweep-9be8/fix-project-modal-errors`

## Branch
`orch/code-smell-sweep-9be8/fix-project-modal-errors` (no verifier commits; working tree clean)

## Execution
- → `rg '\.catch\(\(\)\s*=>\s*\{\s*\}\)|mutateAsync.*\.catch' src/components/projectModal` and `rg 'catch\(' src/components/projectModal` — no empty promise `.catch(() => {})` on project mutations
- → Read `src/components/projectModal/index.tsx` — `useReactMutation` `onError` sets `saveError`, `ErrorBox` renders it, `onFinish` uses `try/await mutateAsync` with documented empty `catch` (modal stays open; not a swallowed `.catch(() => {})` chain)
- → Read `src/components/projectModal/index.test.tsx` — failure-path tests for failed POST (create) and PUT (edit)
- → `CI=true npm test -- --watchAll=false --runInBand src/components/projectModal` — **6 passed**, 0 failed (includes `surfaces a create error and keeps the modal open when POST fails` and `surfaces a save error and keeps the modal open when PUT fails`)
- → `npm run eslint -- --max-warnings 0 src/components/projectModal` — exit 0
- → `npx tsc --noEmit` — exit 0

## Findings
Per acceptance criterion:
- [x]: **No empty `.catch(() => {})` on project mutation** — met (grep clean; mutation errors flow through `onError` → `saveError` / `ErrorBox`, not a silent `.catch(() => {})` on `mutateAsync`)
- [x]: **Failed mutation leaves modal open with user-visible error** — met (implementation + tests assert dialog stays open, error text visible, Redux `isModalOpened` / `editingProjectId` unchanged on failure)
- [x]: **Tests cover failure path** — met (dedicated create-fail and edit-fail cases; 6/6 suite green)

Other findings (severity-ordered):
- (low): `onFinish` still has a bare `catch { }` after `await mutateAsync` — intentional per inline comment (errors surfaced via `onError`); not the audited `mutateAsync(...).catch(() => {})` smell

## Notes & suggestions
- Verification followed the authored recipe only; no live browser pass (`live-ui-verified` not claimed). Unit tests mock failed API responses and assert DOM error text plus modal/Redux state.
- Upstream noted missing `.orchestrate/...` audit files locally; behavior matches `taskModal`-style `ErrorBox` + `saveError` pattern observed in source.
- No verifier source edits; planner can integrate from current branch as-is.