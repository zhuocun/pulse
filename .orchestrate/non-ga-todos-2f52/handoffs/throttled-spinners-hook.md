<!-- orchestrate handoff
task: throttled-spinners-hook
branch: orch/non-ga-todos-2f52/throttled-spinners-hook
agentId: bc-a471a8bc-688a-4ed9-8440-607d2935369c
runId: run-c20188fd-e6f3-4753-ac93-08dc040553b0
resultStatus: finished
finishedAt: 2026-05-10T13:06:19.090Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/throttled-spinners-hook`

## What I did
- Hardened `src/utils/hooks/useDelayedFlag.ts` JSDoc with explicit behavior contract (delayed-on, immediate-off, timer cancellation) and kept default `250ms`.
- Extended `src/utils/hooks/useDelayedFlag.test.tsx` to cover:
  - delayed-on transition,
  - immediate-clear transition after becoming true,
  - no late true-flip when loading stops before delay.
- Applied delayed spinner rendering (without changing underlying loading/analytics state) to:
  - `src/components/aiChatDrawer/index.tsx` (loading bubble/skeleton branch),
  - `src/components/boardBriefDrawer/index.tsx` (brief skeleton branch).
- Updated timing-sensitive tests for those surfaces:
  - `src/components/aiChatDrawer/branches.test.tsx`,
  - `src/components/boardBriefDrawer/agent.test.tsx`.
- Updated `docs/todo/ui-todo.md` to strike throttled-spinner items in:
  - §1.2 item 19 (AiTaskAssistPanel spinner note),
  - Phase 3.5 loading states bullet,
  - 2.A.7 Performance UX throttled-spinners bullet.
- Committed and pushed: `085dc37e1e50d6a3fbfede00ebb84237276ff017`.

## Measurements
- `targeted jest (useDelayedFlag + aiChatDrawer/branches + boardBriefDrawer/agent)`: 20 passing == 20 passing
- `CI=true npm test -- --watchAll=false --runInBand`: 1065 passing == 1065 passing
- `npm run typecheck`: 0 errors == 0 errors
- `npm run build`: exit code 0 == 0
- `npm run eslint`: 0 errors == 0 errors (1 warning present)

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- UI artifact recorded: `/opt/cursor/artifacts/delayed_spinner_ai_drawers_demo.mp4`.
- Manual verification covered opening Board Brief and Ask Copilot drawers on a live board and confirmed no immediate spinner flash on fast responses after the delayed-spinner change.
- To enable manual board-flow verification in this environment, I ran local backend services (Mongo + FastAPI) and restarted Vite against `REACT_APP_API_URL=http://localhost:8000` for the test session only.
- I did not open a PR, per instruction.

## Suggested follow-ups
- Consider addressing the remaining jsx-a11y warning in `AiChatDrawer` (`no-static-element-interactions`) so eslint can run warning-free if you later enforce `--max-warnings 0`.