<!-- orchestrate handoff
task: extract-use-agent-thread-persist
branch: orch/code-smell-sweep-9be8/extract-use-agent-thread-persist
agentId: bc-86d33310-9da2-4afc-8d3d-d15d62993ba6
runId: run-745970c8-7bb5-4322-bfe9-9aea40db46fa
resultStatus: finished
finishedAt: 2026-05-18T17:17:30.330Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/extract-use-agent-thread-persist`

## What I did
- Created `src/utils/hooks/useAgentThreadPersist.ts` with `threadStorageKey`, `readPersistedThread`, `writePersistedThread`, and `clearPersistedThreadStorage` (sessionStorage helpers previously inline in `useAgent.ts`).
- Updated `src/utils/hooks/useAgent.ts` to import those helpers and re-export them for backwards compatibility; default `useAgent` behavior unchanged.
- Added `src/utils/hooks/useAgentThreadPersist.test.ts` with 7 unit tests covering key construction, read/write round-trip, clear, and error-safe storage access via mocked `sessionStorage`.
- Opened draft PR #240 against `main`.

## Measurements
- `LOC(src/utils/hooks/useAgent.ts): 859 → 830`
- `CI=true npm test -- src/utils/hooks/useAgent.test.tsx --watchAll=false --runInBand: 33 passing → 33 passing`
- `CI=true npm test -- src/utils/hooks/useAgentThreadPersist.test.ts --watchAll=false --runInBand: 0 → 7 passing`
- `npm run eslint -- --max-warnings 0 src/utils/hooks/useAgent.ts src/utils/hooks/useAgentThreadPersist.ts: exit 0 → exit 0`
- `npx tsc --noEmit: exit 0 → exit 0`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Discovery docs (`.orchestrate/code-smell-sweep-9be8/...`) were not present in this workspace; extraction followed the task brief and mirrored the prior `useNudgeInbox` / `useAgentToolResolver` split pattern.
- Task brief mentions "mocked localStorage"; implementation and tests use `sessionStorage` to match existing production behavior and `useAgent.test.tsx` Theme 4 coverage.
- `generateThreadId` remains in `useAgent.ts` (not listed in the extraction scope).
- No changes to stream consumer, tool resolver, or nudge inbox modules.

## Suggested follow-ups
- Consider moving `generateThreadId` into `useAgentThreadPersist.ts` or a small `useAgentThreadId.ts` if further decomposition of Theme 4 is planned.
- PR: https://github.com/zhuocun/pulse/pull/240