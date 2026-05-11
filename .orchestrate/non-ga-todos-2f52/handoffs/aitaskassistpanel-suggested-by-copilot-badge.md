<!-- orchestrate handoff
task: aitaskassistpanel-suggested-by-copilot-badge
branch: orch/non-ga-todos-2f52/aitaskassistpanel-suggested-by-copilot-badge
agentId: bc-de91456c-9e6e-464c-bd8a-def4d3e3ae85
runId: run-b8812ffc-cb87-4535-9dfd-8a01075d9dc0
resultStatus: finished
finishedAt: 2026-05-10T14:29:03.165Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/aitaskassistpanel-suggested-by-copilot-badge`

## What I did
- Added `appliedFieldOrigin` tracking in `src/components/taskModal/index.tsx` and wired AI Apply flows to mark Story points as Copilot-applied.
- Rendered a small purple AntD badge next to the Story points label using `microcopy.ai.suggestedByCopilot` after Apply.
- Cleared the Story points provenance badge on subsequent user edits in the modal edit flow.
- Added new i18n key `ai.suggestedByCopilot` in both:
  - `src/i18n/locales/en.ts`
  - `src/i18n/locales/zh-CN.ts`
- Added a unit test in `src/components/taskModal/index.test.tsx` asserting:
  - badge appears after clicking AI story-points Apply
  - badge disappears after user edit
- Updated `docs/todo/ui-todo.md` (2.A.8 bullet) to reflect partial closure for the story-points path and call out remaining follow-through.
- Captured UI walkthrough artifact: ``

## Measurements
- `git diff --stat: 0 files -> 5 files (132 insertions, 4 deletions)`
- `npm run eslint: exit code == 0 (with 1 pre-existing warning in src/components/aiChatDrawer/index.tsx)`
- `npm run typecheck: exit code == 0`
- `CI=true npm test -- --watchAll=false: 1070 passing == 1070 passing`
- `npm run build: exit code == 0`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Pushed commit `6ab020c` to the required branch.
- Badge behavior is verified live in the modal flow after AI Apply and after user edit.
- Current modal behavior clears the Story points badge on user edits in the modal flow (including the demonstrated edit path); if you want strict same-field-only clearing, that can be tightened in a follow-up.

## Suggested follow-ups
- Extend visible per-field provenance badges to additional AI-applied fields (note/epic/task name/coordinator/type) to complete the rest of 2.A.8 scope.
- If desired, tighten clearing semantics to only clear a field’s badge when that exact field is edited.