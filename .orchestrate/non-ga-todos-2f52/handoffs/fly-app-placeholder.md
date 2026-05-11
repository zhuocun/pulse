<!-- orchestrate handoff
task: fly-app-placeholder
branch: orch/non-ga-todos-2f52/fly-app-placeholder
agentId: bc-55307abd-6bf2-4289-80db-fe36275f62d5
runId: run-da19aba7-26b0-4c43-b9e1-68fd71fe2ab3
resultStatus: finished
finishedAt: 2026-05-10T11:00:01.353Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/fly-app-placeholder`

## What I did
- Set `backend/fly.toml` to `app = "pulse-backend"` and rewrote the header so operators must rename `app` to their Fly app before deploy (`pulse-backend` is only the repo default).
- Updated `docs/operations/deployment.md` Fly section (`backend/fly.toml`, rename warning, `backend/fly.toml` reference for the uvicorn comment) and the Render example (`name: pulse-backend` + YAML comment to rename).
- Updated `backend/README.md` deployment blurb to mention the default Fly app and the rename requirement.
- Closed polish §16e in `docs/todo/release-todo.md` with a resolved subsection pointing at the new default and docs.
- Added the matching one-liner to `docs/todo/product-done.md` per repo `AGENTS.md` backlog closure rules (this file was outside the worker’s four-path hint but required by workspace rules).

## Measurements
- Literal `jira-python-server` as Fly/Render/deploy-doc implied app name in `backend/fly.toml` + `docs/operations/deployment.md` (Fly + Render snippets) + `backend/README.md`: present → **0** (none); `release-todo.md` §16e still mentions the old string once in the resolved paragraph as historical context.
- `release-todo.md` §16e status: open → **resolved** (✅ subsection).

## Verification
- `not-verified` (documentation and config comments only; validated by content review and repo grep, no `fly deploy` or CI run).

## Notes, concerns, deviations, findings, thoughts, feedback
- **Deviation:** Touched `docs/todo/product-done.md` in addition to the four paths listed in the worker brief, because closing §16e requires the `AGENTS.md` pairing with `product-done.md`. If the orchestrator needs a minimal diff, they can split that line into a follow-up commit.
- **Finding:** `.env.example` still uses `jira-python-server` for LangSmith/OTEL — out of scope here and not the Fly implied production app path.

## Suggested follow-ups
- Planner: confirm whether `.env.example` service-name placeholders should be aligned with `pulse-backend` in a separate hygiene pass.
- Run `fly launch --copy-config` / deploy smoke from `backend/` on a scratch Fly app if you want runtime verification of the renamed default.