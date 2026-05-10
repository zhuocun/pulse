<!-- orchestrate handoff
task: column-decorative-svg-a11y
branch: orch/non-ga-todos-2f52/column-decorative-svg-a11y
agentId: bc-4647fe75-2d92-4e92-9e0d-aa591f47664b
runId: run-7042e62e-962f-474d-a2d0-8165aa8dd86a
resultStatus: finished
finishedAt: 2026-05-10T12:05:07.776Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/column-decorative-svg-a11y`

## What I did
- Read `.orchestrate/non-ga-todos-2f52/bootstrap/PATHS_AND_VERIFICATION.md` (FE: eslint, tsc, CI=true jest, vite build).
- Confirmed `TaskTypeBadge` in `src/components/column/index.tsx` already renders bug/task art as `<img alt="" aria-hidden … />` next to the visible type label (`microcopy.options.taskTypes.*`), so type is not doubled in the a11y tree beside explicit text (no change needed there; kept labels on the text span).
- Added a column unit test that asserts both Task and Bug cards expose exactly one decorative type image with `alt=""` and `aria-hidden="true"`.
- Marked the ui-todo §21 “Decorative SVGs…” sub-bullet complete with a short completion note.
- Saved a screen recording artifact for the slice: `/opt/cursor/artifacts/column-task-type-badge-a11y.mp4`.
- Pushed the branch to `origin` (no merge/rebase/PR).

## Measurements
- `TaskTypeBadge` task/bug `<img>` markup (`alt` + `aria-hidden` beside visible type): unchanged (already correct on `main`); regression guard added via test
- `eslint`: 0 errors, 1 warning (pre-existing `aiChatDrawer` jsx-a11y) → same class (no new issues in `column/`)
- `tsc --noEmit`: pass → pass
- `CI=true npm test -- src/components/column/index.test.tsx`: 11 passing → 12 passing
- `vite build`: pass → pass

## Verification
 
- `unit-test-verified`: New test asserts decorative `img` attributes on Task and Bug cards; full column suite passes under `CI=true`.

## Notes, concerns, deviations, findings, thoughts, feedback
- **Code vs. test:** `main` already had the fix in `column/index.tsx` (`alt=""`, `aria-hidden` on the type icons, comments note intentional lack of Tooltip to avoid double announcement). This slice locks that behavior with tests and closes the tracking bullet in `ui-todo.md`.
- **AGENTS.md hygiene:** Allowed paths were only `src/components/column/**` and `docs/status/ui-todo.md`, so **`docs/status/product-done.md` was not updated**; the orchestrator may add a product-done row if your process requires it for this closeout.
- **eslint:** One repo warning remains in `aiChatDrawer` (not touched).

## Suggested follow-ups
- Optionally add a one-liner to `docs/status/product-done.md` if backlog policy requires it for closed ui-todo items.
- If any AT still surfaces SVG `<title>` from referenced assets in edge browsers, that would require editing `src/assets/*.svg` (out of scope for this worker’s path allowlist).