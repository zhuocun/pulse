<!-- orchestrate handoff
task: board-error-empty-states
branch: orch/non-ga-todos-2f52/board-error-empty-states
agentId: bc-3c804d75-6a15-456a-b636-6f856fc03b2b
runId: run-0532be17-3b6e-48ce-97e0-adb076c1c423
resultStatus: finished
finishedAt: 2026-05-10T13:59:21.310Z
-->

## Status
partial

## Branch
`orch/non-ga-todos-2f52/board-error-empty-states`

## What I did
- Updated `src/pages/board.tsx` zero-column branch to render an illustrated `EmptyState` with a primary CTA (`microcopy.empty.board.cta` = “Create your first column”) and keep `ColumnCreator` as fallback below it.
- Wired the new empty-state CTA to trigger/focus the fallback `ColumnCreator` button so it opens the inline new-column input.
- Kept board fetch-failure treatment aligned with project-page parity (`Alert` + `Retry` for `boards`/`tasks` query errors).
- Added i18n parity keys for the new CTA in:
  - `src/i18n/locales/en.ts`
  - `src/i18n/locales/zh-CN.ts`
- Expanded `src/pages/board.test.tsx`:
  - Added new error-state test asserting board failure alert appears and Retry re-runs the board query.
  - Updated empty-state test to assert title + new CTA + fallback creator behavior (including opening “New column name” input).
- Updated `docs/todo/ui-todo.md` §16 to mark board loading/empty/error parity as complete.

## Measurements
- `src/pages/board.test.tsx it() count: 7 → 8`
- `CI=true npm test -- --watchAll=false: 1070 passing == 1070 passing`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Required checks run:
  - `npm run eslint` (pass, with 1 pre-existing warning in `src/components/aiChatDrawer/index.tsx:1138`)
  - `npm run typecheck` (pass)
  - `CI=true npm test -- --watchAll=false` (pass)
  - `npm run build` (pass)
- Live UI validation for board empty/error states was blocked by persistent board-page loading spinner in this cloud environment, even after standing up a local mock API and restarting Vite with `REACT_APP_API_URL`.
- Captured blocker recording artifact: `/opt/cursor/artifacts/board_page_loading_spinner_blocker.mp4` (verified: spinner persists, no empty/error UI rendered during recording).

## Suggested follow-ups
- Investigate the persistent board-route loading state in cloud runtime (AuthProvider/users query loop or board bootstrap path) so live UI verification can be completed.
- After runtime unblocks, re-record a short walkthrough showing:
  1) `/projects/project-1/board` empty state + “Create your first column” CTA opening creator input, and  
  2) `/projects/project-error/board` top alert + Retry behavior.