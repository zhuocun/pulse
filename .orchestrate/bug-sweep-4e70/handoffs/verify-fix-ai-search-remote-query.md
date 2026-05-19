<!-- orchestrate handoff
task: verify-fix-ai-search-remote-query
branch: orch/bug-sweep-4e70/fix-ai-search-remote-query
agentId: bc-ccb939f2-e23c-40e0-bbeb-3340a916707e
runId: run-93beb483-0bc7-4617-831e-8f697c322296
resultStatus: finished
finishedAt: 2026-05-19T05:30:02.366Z
-->

## Verification
`unit-test-verified`

## Target
`fix-ai-search-remote-query` on branch `orch/bug-sweep-4e70/fix-ai-search-remote-query`

## Branch
`orch/bug-sweep-4e70/fix-ai-search-remote-query`

## Execution
- → Confirmed on `orch/bug-sweep-4e70/fix-ai-search-remote-query` (clean tree before verifier commit).
- → `CI=true npm test -- --watchAll=false --runInBand src/components/aiSearchInput` — **PASS**: 4 suites, **20** tests (was 19 per upstream); includes `uses submitted query for reformulations when draft changes before remote result returns` in `agent.test.tsx`.
- → `npx tsc --noEmit` — **PASS** (exit 0).
- → Read-only code review: remote path sets `lastSubmittedQueryRef.current` at submit (`index.tsx` ~328), applies via `applyResult(result, lastSubmittedQueryRef.current)` (~280); suggestion effect deps omit live `draft`.
- → Committed verifier log: `.orchestrate/bug-sweep-4e70/verification/fix-ai-search-remote-query-verifier.log` (`efd36b8`), pushed to origin.

## Findings
Per acceptance criterion:
- [x] Remote search apply path uses submitted query ref, not stale draft — **met** (ref set on remote submit; `applyResult` uses ref; test mutates draft to `"quantum entanglement"` before empty suggestion, expects reformulation chip `fix flaky` from submitted `"fix flaky login button issue"`, rejects `tasks about quantum entanglement`).
- [x] Tests cover draft mutation before async result returns — **met** (`agent.test.tsx` scenario above passes).

Other findings (severity-ordered):
- None blocking B3 scope.

## Notes & suggestions
- Verification is test-backed only; no live browser run (appropriate for this path — covered by targeted RTL test).
- Local-engine path already passed trimmed `query` into `applyResult`; fix scope was remote async only, consistent with upstream notes.