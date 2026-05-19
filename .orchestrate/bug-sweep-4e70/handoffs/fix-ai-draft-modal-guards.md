<!-- orchestrate handoff
task: fix-ai-draft-modal-guards
branch: orch/bug-sweep-4e70/fix-ai-draft-modal-guards
agentId: bc-9278e642-0de3-4c14-af79-34db7e3aac05
runId: run-373228cb-e705-46df-b59b-62fa2a8f1db3
resultStatus: finished
finishedAt: 2026-05-19T05:29:06.170Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-ai-draft-modal-guards`

## What I did
- Added `whitespace: true` and `taskNameRequired` message to `AiTaskDraftModal` `taskName` rules (aligned with `TaskModal`).
- Introduced `draftValidateContext` and run `validateDraft` / `validateBreakdown` on remote `lastSuggestion` before populating form or breakdown state.
- Added tests: local + remote whitespace-only create blocked; remote invalid column/coordinator IDs clamped to fallbacks.
- Opened draft PR: https://github.com/zhuocun/pulse/pull/262

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskDraftModal`: 18 passing → 20 passing
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `useAi.ts` unchanged; remote sanitization lives in the modal effect where `lastSuggestion` is applied (local path already validates via `useAi.validateResponse`).
- `draftValidateContext` is declared before the remote-suggestion `useEffect` to avoid temporal-dead-zone errors.
- No UI recording: validation-only change; behavior covered by unit tests.

## Suggested follow-ups
- Consider applying `validateBreakdown` on the local breakdown path in the modal for parity (local `useAi` already validates in `run()`).