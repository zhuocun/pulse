<!-- orchestrate handoff
task: fix-task-assist-estimate-deps
branch: orch/bug-sweep-4e70/fix-task-assist-estimate-deps
agentId: bc-03cf498b-e167-4fe2-87a1-03534f3c4ae0
runId: run-ac3d1915-6e27-4b67-8bf8-eb87b3eabda1
resultStatus: finished
finishedAt: 2026-05-19T05:29:02.137Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-task-assist-estimate-deps`

## What I did
- Read `AiTaskAssistPanel` estimate effect and audit context (B5: bare `tasks` in deps restarted remote estimate on unrelated cache updates).
- Split the monolithic suggestion `useEffect` into three effects: empty-name reset, remote estimate (`trimmedName` + `remoteInput` + stable `startRemoteEstimate`), and local estimate/readiness (`localAiContext` + draft fields).
- Removed bare `tasks` from remote estimate dependencies; local paths use `localAiContext.tasks` inside the effect and in `handleRegenerate`.
- Added remote-agent tests: unrelated `tasks` cache update does not call `start` again; debounced draft change does call `start` again with updated `task_draft`.
- Pushed branch and opened draft PR #261.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskAssistPanel`: 24 passing → 24 passing
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Remote estimate effect deps are now `[trimmedName, isRemote, remoteInput, startRemoteEstimate]` only — no `tasks` or `localAiContext`, so React Query task-list reference churn on the board no longer retriggers estimation when the draft is stable.
- Local engine still re-runs when `localAiContext` changes (intended for cold-cache board/member load per existing `index.test.tsx` behavior).
- PR: https://github.com/zhuocun/pulse/pull/261
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` was not present in the workspace; fix followed the scoped task brief and AGENTS.md `useAgent` stable-deps guidance.

## Suggested follow-ups
- Consider a stable fingerprint for `localAiContext` if local-engine estimate should also ignore referentially-new but semantically identical task arrays (out of B5 scope).