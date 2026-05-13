<!-- orchestrate handoff
task: fix-taskmodal-open-while-tasks-loading
branch: orch/orch-btn-clicks-7894/fix-taskmodal-open-while-tasks-loading
agentId: bc-c016827a-ea25-43e4-99f5-87cfa6d88487
runId: run-7457b999-2ea9-4292-9d13-95e4fd9f378f
resultStatus: finished
finishedAt: 2026-05-13T03:12:06.032Z
-->

## Status
success

## Branch
`orch/orch-btn-clicks-7894/fix-taskmodal-open-while-tasks-loading`

## What I did
- Read `BUTTON-CLICK-AUDIT.md` modal/portal notes and aligned with `AGENTS.md` (never coerce board `tasks`; keep stale-URL cleanup once `tasks` is a real array).
- Updated `TaskModal` so a non-placeholder `editingTaskId` opens the modal while `tasks === undefined`, centered `Spin` with `microcopy.a11y.loadingBoard`, `save` disabled plus early returns in `onOk` / `onDelete` until `editingTask` exists, and `AiTaskAssistPanel` only after a real task.
- Preserved optimistic-placeholder rules: modal still opens only when the placeholder row is present in `tasks`.
- Kept the `<Form form={form}>` subtree mounted but `hidden` during load so Ant Design `useForm` stays wired (avoids the disconnected-form warning).
- Extended `index.test.tsx`: load → `rerender` with tasks → full form; placeholder + `undefined` tasks stays closed; adjusted the “tasks unavailable” test for the open loading shell.

## Measurements
- `TaskModal` Jest suites under `src/components/taskModal`: `2` suites `==` `2` suites, `20` passing `==` `20` passing (includes new coverage).
- `eslint` on `src/components/taskModal/index.tsx`, `index.test.tsx`: `max-warnings 0` `==` `0`.
- `npx tsc --noEmit`: `0` errors `==` `0` errors.
- `git diff main --stat` (product paths): `2` files `==` `2` files touched.

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- No screen recording artifact: only Jest + ESLint + `tsc` were run in this environment; the behavior is covered by the loading → resolve test.
- Draft PR: https://github.com/zhuocun/pulse/pull/219 (base `main`).
- Jest may still log an existing Ant Design `CSSMotion` / `act(...)` notice on some runs; the prior `useForm` disconnect warning is addressed by keeping `Form` mounted.

## Suggested follow-ups
- Optional manual check: throttle network on the board tasks query and confirm the modal shell appears immediately on task card click.
- If CI tightens on React `act` warnings, consider wrapping more modal open animations in `act` in tests (broader than this change).