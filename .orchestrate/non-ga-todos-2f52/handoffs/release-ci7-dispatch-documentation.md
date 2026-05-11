<!-- orchestrate handoff
task: release-ci7-dispatch-documentation
branch: orch/non-ga-todos-2f52/release-ci7-dispatch-documentation
agentId: bc-13303f41-a69d-40c3-8f3d-fd46c2cd5b5e
runId: run-f4585b41-8d3e-4a4e-bdef-182d60bbaca0
resultStatus: finished
finishedAt: 2026-05-10T12:04:11.275Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/release-ci7-dispatch-documentation`

## What I did
- Read `.github/workflows/backend-ci.yml` `workflow_dispatch.inputs.mode` (`choice`, default `both`, options `both` / `test-full` / `test-slim`) and job `if` logic so push/PR always runs both jobs; dispatch can narrow to one job.
- Rewrote `docs/todo/release-todo.md` **§7** to describe the manual **Run workflow** path (Actions → Backend CI → branch selector → **mode**), the three mode values and what runs, and an explicit “no GHA green claim until a URL is pasted” rule plus a placeholder line for the first green run URL.
- Aligned the Backend GA-ready table row for the CI matrix with the same evidence posture (wired; no URL recorded in §7 yet).

## Measurements
- §7 references manual workflow dispatch and mode choices consistent with YAML: doc text `==` aligned to `backend-ci.yml` inputs and job conditions
- No false statement that GHA has been verified on `main` without evidence: doc explicitly defers verification until URL pasted `(none)`
- (none)

## Verification
- `not-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- **§7 vs YAML:** Push/PR behavior is documented as path-filtered `backend/**` + workflow file; both jobs run when the workflow triggers (no `workflow_dispatch` `mode` on push/PR). Dispatch uses the same three strings as the YAML `options` list.
- **AGENTS.md / product-done:** §7 remains an open soft blocker; no strike or `product-done.md` row added (this change is documentation only, not closure).
- **Instructions:** No PR opened; branch pushed only for planner integration.

## Suggested follow-ups
- When ops has a succeeded run, replace `_(none yet)_` in §7 with the real Actions run URL and tighten wording if the item should flip to resolved elsewhere.
- Optional: if §6’s “CI matrix added” sentence should mention `workflow_dispatch`, do it in a separate doc pass (out of scope here if planners want minimal diffs).