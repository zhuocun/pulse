<!-- orchestrate handoff
task: compose-idempotency-redis
branch: orch/non-ga-todos-2f52/compose-idempotency-redis
agentId: bc-4c86e7f7-6688-4035-b857-e2e7382186f7
runId: run-4d518271-0722-4161-83aa-311059f2ad03
resultStatus: finished
finishedAt: 2026-05-10T10:59:44.648Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/compose-idempotency-redis`

## What I did
- Added `IDEMPOTENCY_BACKEND: redis` immediately above `REDIS_URI` in `backend/docker-compose.yml` next to `RATE_LIMIT_BACKEND` / `BUDGET_BACKEND`.
- Refreshed the file header so Redis is described as backing rate limit, budget, and idempotency, and that agents share those Redis-backed concerns locally.
- Tightened `docs/todo/release-todo.md` §16d action bullets: compose now sets all three backends against `REDIS_URI`; caveat about missing idempotency in compose removed; clarified Dockerfile / prod paths still need parity before multi-worker.
- Committed and pushed the branch; did not merge, rebase, or open a PR.

## Measurements
- `IDEMPOTENCY_BACKEND=redis` adjacent to `REDIS_URI` in `backend/docker-compose.yml`: absent → present
- Compose header mentions Redis for rate limit + budget + idempotency: partial → yes
- `docs/todo/release-todo.md` §16d matches current compose wiring: no → yes

## Verification
- `not-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `.orchestrate/non-ga-todos-2f52/bootstrap/BACKLOG_OPEN_NON_GA.md` and `PATHS_AND_VERIFICATION.md` were not present under that path in this workspace (glob found no `BACKLOG_OPEN_NON_GA.md`). Work followed the written task brief and inspected `release-todo.md` §16d directly.
- No edits under `**/src/**`, `backend/app/**`, or `backend/tests/**`; GA §1 mutation scope untouched.
- §16d remains open overall (single-worker `workers=1` story); only the compose / idempotency wording was corrected.

## Suggested follow-ups
- Planner: `docker compose -f backend/docker-compose.yml config` or a short `up` + health smoke to validate the stack reads the new env as intended.