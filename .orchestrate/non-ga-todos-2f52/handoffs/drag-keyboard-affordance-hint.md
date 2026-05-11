<!-- orchestrate handoff
task: drag-keyboard-affordance-hint
branch: orch/non-ga-todos-2f52/drag-keyboard-affordance-hint
agentId: bc-67a26ed3-5272-468d-8179-363b01f626b5
runId: run-1a9ccd44-7991-4073-8769-e9ab8ff21c4d
resultStatus: finished
finishedAt: 2026-05-10T12:57:12.989Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/drag-keyboard-affordance-hint`

## What I did
- Added a task-card keyboard-drag discoverability affordance in `src/components/column/index.tsx` by setting:
  - `title={microcopy.dragHints.taskCardKeyboard}`
  - `aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"`
- Added minimal new i18n microcopy key with zh-CN parity:
  - `src/i18n/locales/en.ts` → `dragHints.taskCardKeyboard`
  - `src/i18n/locales/zh-CN.ts` → `dragHints.taskCardKeyboard`
- Added a column test assertion in `src/components/column/index.test.tsx` verifying both the hint text (`title`) and the `aria-keyshortcuts` attribute on task cards.
- Updated `docs/todo/ui-todo.md` (Phase 3.4 / 2.A.9 references) to mark keyboard-drag discoverability on task cards as shipped/partially complete where appropriate.
- Captured a live UI recording demonstrating the tooltip hint on hover: `/opt/cursor/artifacts/task_card_keyboard_drag_hint_demo.mp4`.

## Measurements
- `CI=true npm test -- --watchAll=false src/components/column/index.test.tsx: 13 passing == 13 passing`
- `CI=true npm test -- --watchAll=false: 1065 passing == 1065 passing`
- `npm run typecheck: exit code 0 == 0`
- `npm run build: exit code 0 == 0`
- `npm run eslint: 0 errors == 0 errors (1 warning)`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Existing drag/click behavior was preserved by avoiding wrapper changes around the draggable task-card button (used native `title` + ARIA metadata on the button itself).
- ESLint reports one pre-existing warning in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`); no new lint errors were introduced.
- Manual end-to-end validation was performed live on the board with task cards visible; hover tooltip text matched the new microcopy key.

## Suggested follow-ups
- Complete the remaining Phase 3.4 follow-up by surfacing the same drag keystrokes in the planned global shortcut help dialog (Phase 4) so discoverability is available beyond card hover/title.