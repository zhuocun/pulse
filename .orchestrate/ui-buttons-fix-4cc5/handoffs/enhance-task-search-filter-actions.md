<!-- orchestrate handoff
task: enhance-task-search-filter-actions
branch: orch/ui-buttons-fix-4cc5/enhance-task-search-filter-actions
agentId: bc-e6c70a3b-b5a6-4dc0-b3c2-56ac2b071e4f
runId: run-0c992918-8a65-49b0-9fd3-246873e158bc
resultStatus: finished
finishedAt: 2026-05-12T14:45:05.146Z
-->

## Status
success

## Branch
`orch/ui-buttons-fix-4cc5/enhance-task-search-filter-actions`

## What I did
- Passed `onClearAll={resetParams}` into `FilterChips` on `TaskSearchPanel` so multi-chip clears match `ProjectSearchPanel` behavior. The visible label is the default `microcopy.actions.clear` (same as `FilterChips` default; not passed explicitly).
- Wrapped the filter inputs, Reset cluster, and chip row in one `role="search"` region with `aria-labelledby` pointing at a screen-reader-only `h2` using stable id `task-search-panel-filter-label` and text `microcopy.a11y.filterTasks`.
- Grouped the Reset control in `FilterActionsCluster`: top border on narrow layouts, left border + padding + `margin-inline-start: auto` on `md+` so Reset reads as part of the filter toolbar.
- Extended `src/components/taskSearchPanel/index.test.tsx` for clear-all, single-chip (no Clear control), reset disabled with no chips, and grouping/semantics (search region + nested active-filters region).

## Measurements
- `TaskSearchPanel` Jest tests: 6 → 10 passing
- `CI=true npm test -- … src/components/taskSearchPanel src/components/filterChips`: 1 suite → 1 suite passing
- `npm run eslint -- … src/components/taskSearchPanel` (with `--max-warnings 0`): 0 warnings → 0 warnings
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- **Reset disabled when no chips:** unchanged — `disabled={chips.length === 0}`; no change when any derived chip would render (including coordinator only when `coordinatorName` resolves).
- **Clear-all handler:** same `resetParams` as Reset (clears via `undefined` fields), consistent with existing reset test expectations; differs from `ProjectSearchPanel`’s string clears but matches this panel’s established reset contract.
- **Screen recording:** `/opt/cursor/artifacts/task-search-filter-toolbar.mp4` — environment capture; behavioral proof is the targeted tests.
- **PR:** draft **#209** opened against `main` (`https://github.com/zhuocun/pulse/pull/209`).
- Did not touch `docs/`, `projectSearchPanel/`, `board.tsx`, or `.orchestrate/`.

## Suggested follow-ups
- If the planner wants explicit `clearAllLabel={microcopy.actions.clear}` at the call site for symmetry with future localization overrides, it is optional (behavior is already the default).