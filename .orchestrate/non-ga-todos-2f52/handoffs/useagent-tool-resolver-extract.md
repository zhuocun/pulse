<!-- orchestrate handoff
task: useagent-tool-resolver-extract
branch: orch/non-ga-todos-2f52/useagent-tool-resolver-extract
agentId: bc-97575462-583f-4515-b222-456b103e9b0c
runId: run-65039698-68cc-4a65-a5fc-717d18460eac
resultStatus: finished
finishedAt: 2026-05-10T13:31:40.510Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/useagent-tool-resolver-extract`

## What I did
- Extracted FE-tool interrupt resolution + auto-resume sequencing out of `src/utils/hooks/useAgent.ts` into new `src/utils/hooks/useAgentToolResolver.ts`.
- Moved the stream-part reducer + mid-stream typed error mapping into the same resolver module so `useAgent.ts` no longer owns FE-tool execution plumbing inline.
- Wired `useAgent.ts` to use `useAgentToolResolver` with explicit inputs at call time (`registry`, `autonomy`, `threadId`, `lastInterrupt`) and hooked resolver outputs (`status`, `error`) on the new hook surface.
- Re-exported resolver public types/hook from `useAgent.ts` for compatibility.
- Added `src/utils/hooks/useAgentToolResolver.test.ts` (new focused tests for known-tool resume, thrown-tool error envelope, resume-body threading, and 8-round exhaustion behavior).
- Updated backlog docs for partial closure continuation:
  - `docs/todo/release-todo.md` §16b sub-bullet
  - `docs/todo/architecture-todo.md` Theme 3 row

## Measurements
- `LOC(src/utils/hooks/useAgent.ts): 934 → 806`
- `inline 8-round auto-resume loop in useAgent.ts (rg "for \(let round = 0; round < 8; round \+= 1\)"): 1 → 0`
- `inline FE-tool registry lookup in useAgent.ts (rg "FE_TOOL_REGISTRY\[part\.data\.tool\]"): 1 → 0`
- `src/utils/hooks/useAgentToolResolver.test.ts test cases: 0 → 4`
- `CI=true npm test -- --watchAll=false --runInBand: 148 passed == 148 passed`
- `npm run typecheck errors: 0 == 0`
- `npm run build failures: 0 == 0`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Full required matrix passed: `eslint`, `typecheck`, `CI=true jest`, `vite build`.
- `eslint` still reports one pre-existing warning in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`); this task did not modify that file.
- No PR was opened (per instruction).

## Suggested follow-ups
- Complete the remaining Theme 3 / §16b scope by extracting the SSE parsing adapter from `useAgent.ts` into its own module/hook, then trim `useAgent` further around TTFT/watchdog/state wiring.