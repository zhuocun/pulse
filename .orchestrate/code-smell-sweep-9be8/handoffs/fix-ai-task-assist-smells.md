<!-- orchestrate handoff
task: fix-ai-task-assist-smells
branch: orch/code-smell-sweep-9be8/fix-ai-task-assist-smells
agentId: bc-e6e03fdb-87f6-4bd2-b283-2b3d0fde56c5
runId: run-6c97ccac-bd06-4e3d-932a-301f41d311eb
resultStatus: finished
finishedAt: 2026-05-18T17:18:05.538Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/fix-ai-task-assist-smells`

## What I did
- Added `aiTaskAssistContext.ts` with `buildLocalAiContext`, `buildLocalEstimateRunPayload`, `buildLocalReadinessRunPayload`, debounce/spinner constants, `asMicrocopyString`, and `absorbUseAiRunRejection` (documents `useAi.run` error ownership).
- Refactored `index.tsx` to use shared context/payload builders for the effect and regenerate paths; kept dual unconditional `useAi`/`useAgent` mount.
- Replaced three `.catch(() => undefined)` calls with `.catch(absorbUseAiRunRejection)` so failures surface via `estimateError` / `readinessError`.
- Hoisted `1000` debounce and `250` delayed-spinner ms to `TASK_ASSIST_DEBOUNCE_MS` / `TASK_ASSIST_DELAYED_SPINNER_MS`.
- Replaced `(microcopy… as string)` casts with `asMicrocopyString` in the panel.
- Added `aiTaskAssistContext.test.ts`; existing panel tests still pass.
- Opened draft PR #242.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskAssistPanel`: 18 passing → 22 passing
- `.catch(() => undefined)` in `index.tsx`: 3 → 0
- duplicate local `context` payload blocks in `index.tsx`: 3 → 0 (single `buildLocalAiContext`)

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Discovery audit markdown under `.orchestrate/` was not present in this VM; changes follow the scoped task brief and existing `effectErrors.test.tsx` contract.
- `absorbUseAiRunRejection` still catches promise rejections, but only after `useAi.run` has set hook `error` — UI alerts continue to use `estimateError` / `readinessError`; the helper replaces silent anonymous swallowing with a named, documented sink.
- PR: https://github.com/zhuocun/pulse/pull/242

## Suggested follow-ups
- Planner may fold `absorbUseAiRunRejection` into a shared `useAi` utility if other components still use `.catch(() => undefined)`.