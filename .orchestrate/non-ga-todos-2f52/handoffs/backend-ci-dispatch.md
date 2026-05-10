<!-- orchestrate handoff
task: backend-ci-dispatch
branch: orch/non-ga-todos-2f52/backend-ci-dispatch
agentId: bc-0446f72d-22f3-4621-850e-902fad95c80f
runId: run-890911b6-2c99-4f75-a087-f88f7b6c5018
resultStatus: finished
finishedAt: 2026-05-10T11:00:28.372Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/backend-ci-dispatch`

## What I did
- Extended `.github/workflows/backend-ci.yml` with `workflow_dispatch` and a **mode** input (`both` / `test-full` / `test-slim`), default `both`, with a short description of jobs and that the branch is chosen in the Run workflow UI.
- Left `push` and `pull_request` triggers and their `paths` / `branches` filters unchanged; only added dispatch.
- Added workflow-level `concurrency`: shared `push-pr` group with `cancel-in-progress: true` for push/PR; per-run `dispatch-{run_id}` group with `cancel-in-progress: false` so manual runs are not cancelled by each other or by each other’s concurrency rule in a surprising way.
- Gated each job with `if:` using short-circuit `github.event_name != 'workflow_dispatch' || …` so `github.event.inputs.mode` is not evaluated on push/PR.
- Updated `docs/status/release-todo.md` §7: evidence bullet for manual dispatch + Green run URL; clarified path filters wording (no stale line numbers).

## Measurements
- `actionlint` on `.github/workflows/backend-ci.yml`: 0 issues → 0 issues
- `python3` `yaml.safe_load` on workflow file: pass → pass
- Existing `push`/`pull_request` path filters: unchanged → unchanged
- `workflow_dispatch` present with documented inputs + default: absent → present

## Verification
- `not-verified` (static validation only: YAML parse + actionlint v1.7.12; no GitHub Actions run in this environment)

## Notes, concerns, deviations, findings, thoughts, feedback
- §7 remains open; edits only document how to gather CI evidence via dispatch and align copy with the new trigger.
- Did not merge, rebase, or open a PR per task instructions.
- No UI change; no screen recording.

## Suggested follow-ups
- On GitHub: Actions → Backend CI → Run workflow → pick branch → run with desired **mode**; paste the successful run URL into §7 when closing that item.
- Planner: integrate/rebase this branch as needed for the orchestrated PR.