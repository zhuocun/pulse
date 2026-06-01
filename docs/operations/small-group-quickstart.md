# Small-group quickstart (~5 users)

Goal: get Pulse with AI features running for ~5 people. Skip
observability, multi-instance hardening, and vector search. Two paths;
pick one.

## Prerequisites (both paths)

- **MongoDB Atlas** free shared cluster — get a `mongodb+srv://...` URI.
- **One LLM API key** — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
  `DEEPSEEK_API_KEY`. Any one works (`AGENT_CHAT_MODEL_PROVIDER=auto`
  picks whichever you set).
- **Free-tier Postgres** — Neon, Supabase, or Vercel Postgres. Required
  for the four interrupt-using agents (`board-brief-agent`,
  `task-drafting-agent`, `task-estimation-agent`, `triage-agent`) to
  survive cold starts. Skip and accept intermittent failures only if
  you don't use those features.

You do **not** need: Redis, the `UUID` env var, LangSmith,
OpenTelemetry, Prometheus, or pgvector at this scale. The lifespan
bootstraps a JWT secret into the Mongo `system_config` collection on
first boot, so issued tokens survive restarts without `UUID` being
set explicitly.

## Path A: Fly.io BE + Vercel FE (recommended)

This is the path the project's own [`deployment.md`](./deployment.md)
recommends because the AI streaming endpoints work reliably on Fly's
long-lived runtime but get truncated on Vercel's serverless duration
cap.

1. Create the managed services and copy the connection strings:
   - Atlas → `MONGO_URI` (mongodb+srv://...)
   - Neon / Supabase / Vercel Postgres → `AGENT_POSTGRES_URI` (postgresql://...)
   - Anthropic console, OpenAI dashboard, or DeepSeek console → one API key

2. From the repo root, deploy the backend to Fly. The shipped
   `backend/fly.toml` already pins `auto_stop_machines = false` and
   `min_machines_running = 1`, which is what keeps the in-process
   rate limiter and budget tracker alive between requests.

   ```bash
   cd backend
   fly launch --copy-config --no-deploy
   # Edit fly.toml if you want a different app name; default is pulse-backend.

   fly secrets set \
       MONGO_URI="mongodb+srv://<user>:<pw>@<cluster>/jira?retryWrites=true&w=majority" \
       AGENT_POSTGRES_URI="postgresql://<user>:<pw>@<host>/<db>?sslmode=require" \
       DEEPSEEK_API_KEY="sk-..." \
       AGENT_CHAT_MODEL_PROVIDER="deepseek" \
       AGENT_CHAT_MODEL_ID="deepseek-v4-flash" \
       CORS_ORIGINS="https://<your-fe>.vercel.app"
   # Swap DEEPSEEK_* for OPENAI_API_KEY or ANTHROPIC_API_KEY if that is the provider you use.

   fly deploy
   ```

3. Verify the backend is ready:

   ```bash
   BE_URL="$(fly status --json | jq -r '.Hostname')"
   curl -s "https://${BE_URL}/api/v1/health/ai?probe=true" | jq .
   ```

   Look for:
   - `"ready": true`
   - `"realProviderReady": true`
   - `"providerConnectivity": { "reachable": true }`
   - `"checkpointerBackend": "postgres"` and `"storeBackend": "postgres"`
     (the `auto` default flipped because `AGENT_POSTGRES_URI` is set)

   With smoke credentials ready, run the repo-side AI smoke from the
   repo root:

   ```bash
   PULSE_BE_URL="https://${BE_URL}" \
   PULSE_SMOKE_EMAIL="smoke@example.com" \
   PULSE_SMOKE_PASSWORD="<password>" \
   PULSE_SMOKE_ALLOW_NON_PRODUCTION=true \
   npm run smoke:ai:prod
   ```

   It verifies readiness, login/register, AI-token renewal, agent
   registry access, project manager/budget gates, and one authenticated
   `chat-agent` stream.
   Do not set `PULSE_SMOKE_ALLOW_STUB=true` for production; it only
   permits non-production stub checks by bypassing `realProviderReady` /
   `stubMode` failures while still requiring `ready=true` and provider
   connectivity. This quickstart sets
   `PULSE_SMOKE_ALLOW_NON_PRODUCTION=true` because the 5-user recipe can
   intentionally tolerate health warnings such as memory-backed
   rate-limit/budget/idempotency state; omit it for strict production.

4. Deploy the FE to Vercel. From a Vercel project pointed at the repo:

   ```bash
   vercel env add BACKEND_URL              # -> https://<your-be>.fly.dev (no trailing slash)
   vercel env add REACT_APP_API_URL        # -> same backend origin, for deployed aiBaseUrl fallback
   vercel env add REACT_APP_AI_BASE_URL    # -> same backend origin, for direct agent/SSE calls
   vercel deploy --prod
   ```

   The `api/index.ts` proxy (delegating to `api/_proxy.ts`) in the FE
   project forwards `/api/v1/*` to the Fly backend; nothing else needs
   to change. The proxy reads `BACKEND_URL` from the Vercel serverless
   env at request time and falls back to the bundled default only when
   the var is unset.

   After the FE deploy, run the same smoke through the FE origin to
   exercise the Vercel proxy boundary:

   ```bash
   PULSE_BE_URL="https://<your-fe>.vercel.app" \
   PULSE_SMOKE_EMAIL="smoke@example.com" \
   PULSE_SMOKE_PASSWORD="<password>" \
   PULSE_SMOKE_ALLOW_NON_PRODUCTION=true \
   npm run smoke:ai:prod
   ```

## Path B: All Vercel

Works for the v1 polish AI endpoints
(`/api/ai/{task-draft,task-breakdown,estimate,readiness,board-brief,search}`)
and the synchronous `/api/v1/agents/{name}/invoke` route. Has limits:

- **SSE streaming** (`/api/v1/agents/{name}/stream`) may truncate at the
  Vercel response duration cap (60s Pro / 300s Enterprise) for long
  agent runs.
- **Per-invocation rate-limit and budget state** are tracked in the
  Python process and reset on every cold container. Soft-caps at 5
  users; you will see the cap drift higher than configured because
  each instance enforces its own copy.
- **Interrupt-agent resume across cold starts** is best-effort even
  with Postgres: the FE follow-up request may land on a fresh
  container before the checkpoint commits, in which case the user
  retries and the second attempt resumes correctly.

Acceptable at 5 users **if** the team tolerates occasional retries.
For strict reliability use Path A.

1. Same prerequisites as Path A.

2. Create a Vercel project with `backend/` as the project root. The
   shipped `backend/vercel.json` already wires `api/index.py` to FastAPI.

   ```bash
   cd backend
   vercel link        # pick or create the project
   vercel env add MONGO_URI
   vercel env add AGENT_POSTGRES_URI
   vercel env add DEEPSEEK_API_KEY   # or OPENAI_API_KEY / ANTHROPIC_API_KEY
   vercel env add CORS_ORIGINS       # https://<fe-project>.vercel.app
   vercel deploy --prod
   ```

3. Deploy the FE to a separate Vercel project pointed at the repo
   root. Set `BACKEND_URL` to the BE deployment URL (the FE proxy in
   `api/_proxy.ts` reads it from the serverless env at request time).

4. Verify the backend is ready:

   ```bash
   curl -s "https://<your-be>.vercel.app/api/v1/health/ai?probe=true" | jq .
   ```

   Same checks as Path A. If `checkpointerBackend` reports `"memory"`,
   you forgot to set `AGENT_POSTGRES_URI` — the `auto` default needs
   it to flip to `"postgres"`.

   Then run the same authenticated smoke from the repo root:

   ```bash
   PULSE_BE_URL="https://<your-be>.vercel.app" \
   PULSE_SMOKE_EMAIL="smoke@example.com" \
   PULSE_SMOKE_PASSWORD="<password>" \
   PULSE_SMOKE_ALLOW_NON_PRODUCTION=true \
   npm run smoke:ai:prod
   ```

## After deploying (both paths)

1. Open the BE URL: `GET /api/v1/health/ai?probe=true`. Verify
   `"ready": true`, `"realProviderReady": true`, and
   `"providerConnectivity": { "reachable": true }`.
   The endpoint requires no auth, so this works straight from a
   browser tab or `curl`.

2. Open the FE, register the first user via the signup form.

3. Create a project — the creating user becomes its manager (manager
   is the gate for AI features per [PRD §6.3](../../README.md)).

4. Invite the other 4 users — they register, then the manager adds
   them to the project.

5. Re-run `npm run smoke:ai:prod` after changing AI, auth, or
   project-gate env vars. Point `PULSE_BE_URL` at the FE origin when
   changing proxy env vars so the smoke exercises `/api/:path*` through
   Vercel. Use `PULSE_SMOKE_CLEANUP_PROJECT=true` only when the
   configured smoke project is disposable.

## When to upgrade beyond this recipe

Switch to the full [`deployment.md`](./deployment.md) recipe (Redis
middleware backends, OTel + Prometheus, optional pgvector, multi-worker
hardening) when any of these triggers fire:

- More than ~20 active users — the in-process rate limiter / budget
  tracker stops being accurate enough to enforce real caps.
- Monthly token usage approaches `AGENT_BUDGET_MONTHLY_TOKEN_CAP` — you
  need Redis-backed counters so a cold start doesn't wipe the running
  tally.
- You want SSO / OAuth — out of scope for this recipe; the FE auth
  flow only knows about the email/password endpoints in
  `app/routers/auth.py`.
- You want SLOs or an on-call rotation — turn on `OTEL_TRACING=true`
  and `PROMETHEUS_METRICS=true`, ship spans to the collector of your
  choice, and add the Tier 9 alert rules from `deployment.md`.
- You want pgvector-backed task similarity for `task-estimation-agent`
  — see [`pgvector-task-embeddings.sql`](./pgvector-task-embeddings.sql),
  dry-run `python backend/scripts/backfill_task_embeddings.py --prune-deleted`, then run
  `python backend/scripts/backfill_task_embeddings.py --execute --prune-deleted` before
  setting `AGENT_VECTOR_SEARCH_ENABLED=true`.

For anything not covered above, defer to
[`docs/operations/deployment.md`](./deployment.md) — full env table,
observability wiring, hardening checklist.
