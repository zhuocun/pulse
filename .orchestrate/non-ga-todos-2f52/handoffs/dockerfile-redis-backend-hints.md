<!-- orchestrate handoff
task: dockerfile-redis-backend-hints
branch: orch/non-ga-todos-2f52/dockerfile-redis-backend-hints
agentId: bc-1524a7ab-056d-46aa-9444-e3693b6ceac1
runId: run-f64ed3a4-73a4-4f92-bdbb-3867c4755296
resultStatus: finished
finishedAt: 2026-05-10T12:04:38.005Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/dockerfile-redis-backend-hints`

## What I did
- Extended `backend/Dockerfile` header comments so operators see that raising `--workers` past 1 needs `RATE_LIMIT_BACKEND=redis`, `BUDGET_BACKEND=redis`, `IDEMPOTENCY_BACKEND=redis`, and `REDIS_URI`, with a pointer to `backend/docker-compose.yml`; kept `--workers`, `COPY`, stages, healthcheck, and `CMD` array unchanged aside from tightening the trailing CMD-side comment block.
- Adjusted §16d’s opening paragraph in `docs/status/release-todo.md` so the Dockerfile citation no longer depended on brittle line numbers and briefly points at the header + CMD comments (aligns backlog text with where operators look).

## Measurements
- `uvicorn CMD --workers` default: unchanged (`"1"` == `"1"`).
- `Dockerfile`: multi-worker Redis env bundle named in comments: uncovered for operators → `RATE_LIMIT_BACKEND`, `BUDGET_BACKEND`, `IDEMPOTENCY_BACKEND`, `REDIS_URI` all named (header).

## Verification
not-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Change set is comments + one release-todo sentence; image build semantics and runtime entrypoint are unchanged. §16d’s detailed action bullets were already correct; release-todo edit is for discoverability and accurate file references rather than repeating the env list twice in the backlog body.
- No PR opened per instructions; commit `a8171f3` is on the pushed branch.

## Suggested follow-ups
- Planner: if product-done rows are desired when §16d fully closes, add a shipped line there per `AGENTS.md` hygiene—out of scope for this slice.