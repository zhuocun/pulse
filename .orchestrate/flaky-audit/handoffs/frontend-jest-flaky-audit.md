<!-- orchestrate handoff
task: frontend-jest-flaky-audit
branch: orch/flaky-audit/frontend-jest-flaky-audit
agentId: bc-92c4f243-eb76-4ec6-a286-eec4a7f48070
runId: run-9af13dba-a9ef-47cf-823a-1daf0c6e173d
resultStatus: finished
finishedAt: 2026-05-10T01:43:45.878Z
-->

## Status
success

## Branch
`orch/flaky-audit/frontend-jest-flaky-audit`

## What I did
- Added `docs/test-flakiness/frontend.md` with:
  - suite shape + run command,
  - 6 ranked flaky suspects with `file:line`,
  - symptom/root-cause/fix-sketch/risk for each,
  - cross-cutting pattern counts,
  - shipped-fix commit references.
- Shipped 3 surgical flaky-test fixes (test files only):
  - `src/pages/project.test.tsx`: made debounce test deterministic with fake timers + `act`.
  - `src/components/taskModal/index.test.tsx`: moved `Modal.confirm` spy cleanup into guaranteed `try/finally`.
  - `src/components/aiTaskAssistPanel/index.test.tsx`: isolated fake timers per test and normalized timer advancement via `act`.
- Ran targeted validation on changed files, then ran the full Jest suite once with the AGENTS.md command and captured counts.

## Measurements
- `ranked suspects in docs/test-flakiness/frontend.md: 0 → 6`
- `test(flaky) fix commits on branch: 0 → 3`
- `full jest suites (NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles): 146 passed / 0 failed == 146 passed / 0 failed`
- `full jest tests (same command): 1055 passed / 0 failed == 1055 passed / 0 failed`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- I stayed within allowed writable paths (`src/**`, `docs/test-flakiness/frontend.md`) and did not modify forbidden infra/shared files.
- Required fix commit messages were used:
  - `abee0bc` `test(flaky): fix ProjectPage debounce refetch — real timeout race under load`
  - `6ddef00` `test(flaky): fix TaskModal delete-confirm tests — leaked Modal.confirm spy`
  - `c9941a9` `test(flaky): fix AiTaskAssistPanel timer tests — fake-timer state leaked across cases`
- Existing repo warning still appears in pre-commit lint (`src/components/aiChatDrawer/index.tsx` jsx-a11y warning); unrelated to this task and unchanged by me.

## Suggested follow-ups
- Apply the same per-test fake-timer isolation pattern to `src/components/aiTaskAssistPanel/agent.test.tsx` (currently uses suite-level fake timers).
- Wrap `jest.advanceTimersByTime` with `act` in `src/utils/hooks/useAgentHealth.test.tsx` poll-transition case.
- Tighten synchronous mock call assertions in agent-path tests (`aiTaskDraftModal/agent.test.tsx`, `boardBriefDrawer/agent.test.tsx`) by replacing unnecessary `waitFor` usage where applicable.