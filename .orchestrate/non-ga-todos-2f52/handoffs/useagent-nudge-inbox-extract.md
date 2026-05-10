<!-- orchestrate handoff
task: useagent-nudge-inbox-extract
branch: orch/non-ga-todos-2f52/useagent-nudge-inbox-extract
agentId: bc-972362d7-f1f2-4a52-8542-a140d7efa4dc
runId: run-012625a9-9841-4958-8e76-f5736f670d0e
resultStatus: finished
finishedAt: 2026-05-10T12:38:44.599Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/useagent-nudge-inbox-extract`

## What I did
- Extracted AC-V14 nudge-inbox logic from `src/utils/hooks/useAgent.ts` into new `src/utils/hooks/useNudgeInbox.ts`:
  - moved `NUDGE_INBOX_MAX`, `NUDGE_EXPIRY_MS`, `NUDGE_PRUNE_INTERVAL_MS`
  - moved pure reducer `reduceNudgeInbox`
  - moved inbox state ownership (`nudges`), periodic prune (60s), `dismissNudge`, and reset behavior into `useNudgeInbox`.
- Updated `useAgent` to consume `useNudgeInbox` so it no longer owns nudge reducer state internally.
- Preserved backwards compatibility by re-exporting from `useAgent.ts`:
  - `reduceNudgeInbox`
  - `NUDGE_INBOX_MAX`
  - `NUDGE_EXPIRY_MS`
  - `NUDGE_PRUNE_INTERVAL_MS`
  - runtime surface still exposes `nudges` and `dismissNudge` unchanged.
- Updated backlog docs for partial closure:
  - `docs/status/release-todo.md` §16b now marks nudge-inbox extraction as partial completion and leaves SSE adapter + tool resolver pending.
  - `docs/status/architecture-todo.md` Theme 3 updated to reflect the partial split and remaining decomposition scope.
- Committed and pushed to the required branch (latest: `8be732e5d17e148f3f92ec81e0ceef057c0e8c96`).

## Measurements
- `wc -l src/utils/hooks/useAgent.ts: 1010 → 935`
- `CI=true npm test -- src/utils/hooks/useAgent.test.tsx --watchAll=false --runInBand: 33 passing == 33 passing`
- `CI=true npm test -- --watchAll=false --runInBand: 1064 passing == 1064 passing`
- `npx tsc --noEmit: exit 0 == exit 0`
- `npx vite build: exit 0 == exit 0`
- `npm run eslint: exit 0 == exit 0` (0 errors, 1 pre-existing warning in `src/components/aiChatDrawer/index.tsx:1133`)

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- No import-path churn was required for existing nudge reducer tests: `src/utils/hooks/useAgent.test.tsx` still imports reducer/constants from `useAgent` and passes.
- `npm run eslint` in this repo runs with `--fix`; it introduced only formatting changes in touched hook files, which were committed.
- I did not modify `AGENTS.md` because there were no cited line-range references to update.

## Suggested follow-ups
- Continue §16b/Theme 3 decomposition by extracting:
  - SSE parsing/event adapter from `useAgent`
  - FE-tool registry + auto-resume loop into a dedicated `useAgentToolResolver` hook/module.