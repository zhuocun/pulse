<!-- orchestrate handoff
task: taskmodal-canonical-types
branch: orch/non-ga-todos-2f52/taskmodal-canonical-types
agentId: bc-105f9f94-b39c-4374-bd66-56e7b134c7a0
runId: run-195d478f-1390-4cf6-a437-6b64af7e7a8a
resultStatus: finished
finishedAt: 2026-05-10T13:37:22.948Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/taskmodal-canonical-types`

## What I did
- Replaced the TaskModal type-option builder call with a canonical constant (`TASK_TYPE_OPTIONS`) in `src/components/taskModal/index.tsx`, still localized via `microcopy.options.taskTypes.task` / `.bug`.
- Added regression coverage in `src/components/taskModal/index.test.tsx` for single-type datasets:
  - dataset with only `Task` entries still renders both `Task` and `Bug` options
  - dataset with only `Bug` entries still renders both `Task` and `Bug` options
- Kept/used existing empty-dataset behavior coverage (`initialTasks: []`) and updated backlog tracking in `docs/todo/ui-todo.md` §10 and Phase 2.6 to mark the canonical-type item complete.
- Captured a UI screen recording showing the modal Type select with both options visible: `/opt/cursor/artifacts/taskmodal_type_select_canonical_options_demo.mp4`.

## Measurements
- `TaskModal suite (CI=true npm test -- src/components/taskModal/index.test.tsx): 16 passing == 16 passing`
- `TaskModal canonical-option single-type cases in test file: 0 → 2`
- `docs/todo/ui-todo.md canonical type-option item status: open → complete`
- `npm run eslint: 0 errors == 0 errors (1 warning)`
- `npm run typecheck: exit code 0 == 0`
- `CI=true npm test: 1071 passing == 1071 passing`
- `npm run build: exit code 0 == 0`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- I did not open a PR (per your instruction).
- ESLint currently reports one pre-existing warning in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`) but exits successfully with no errors.
- UI artifact confirms live dropdown rendering of both options; dataset-shape guarantees are validated by the new/targeted tests.

## Suggested follow-ups
- If you want explicit “empty tasks list still shows canonical options” proof in UI (not just test coverage), we’d need a lightweight test harness/state entrypoint that can open `TaskModal` without requiring an existing task row.