<!-- orchestrate handoff
task: fix-ai-search-remote-query
branch: orch/bug-sweep-4e70/fix-ai-search-remote-query
agentId: bc-020fe87e-da42-4365-967d-74b82067b6ea
runId: run-af896ad1-c9ae-40ed-81d4-e8510d0d11e1
resultStatus: finished
finishedAt: 2026-05-19T05:28:31.258Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-ai-search-remote-query`

## What I did
- Fixed B3 in `src/components/aiSearchInput/index.tsx`: added `lastSubmittedQueryRef`, set it when starting remote search, and passed it into `applyResult` instead of live `draft` state.
- Removed `draft` from the remote suggestion effect dependency array so mid-flight draft edits no longer affect reformulation generation.
- Added `agent.test.tsx` coverage: submit a query, mutate draft before the suggestion arrives, assert "Did you mean?" chips derive from the submitted query.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiSearchInput`: 19 passing → 20 passing
- `npx tsc --noEmit`: 0 errors → 0 errors

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Root cause: the remote suggestion `useEffect` called `applyResult(result, draft)`, so reformulations for empty results tracked whatever was currently in the input, not the query sent to the agent.
- Local-engine path was already correct (`applyResult(..., query)` with the trimmed submit argument); only the remote async path needed the ref.
- Draft PR: https://github.com/zhuocun/pulse/pull/257

## Suggested follow-ups
- None for this scope.