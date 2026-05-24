# Deployment

Production deployment guide for the pulse backend. Companion to the
README's Configuration section.

The agent surface streams long-lived Server-Sent Events and keeps
short-term state on the heap (rate limiter, budget tracker, default
LangGraph checkpointer). That rules out short-window serverless
runtimes for the AI endpoints and shapes every recommendation below.

> If you just need ~5 users on the AI features, jump to [`small-group-quickstart.md`](./small-group-quickstart.md) — this doc is the full production matrix.

---

## Vercel: where it works and where it doesn't

The repo ships `vercel.json` and `api/index.py` so the non-AI HTTP
surface keeps deploying to Vercel without ceremony. Within Vercel's
documented response-duration cap (10s Hobby / 60s Pro / 300s
Enterprise) the following endpoints are safe:

- `POST /api/v1/auth/*`, `GET|POST|PUT|DELETE /api/v1/{users,projects,boards,tasks}` — synchronous JSON, well under 10s.
- `POST /api/ai/{task-draft,task-breakdown,estimate,readiness,board-brief,search}` — the v1 polish shim returns one JSON payload per call.
- `POST /api/v1/agents/{name}/invoke` — synchronous agent runs that finish inside the tier's cap (`chat-agent` is the typical fit).

The following endpoints are **not** safe on Vercel and should be
deployed elsewhere:

- `POST /api/v1/agents/{name}/stream` — the SSE stream often outlives
  every Vercel tier. The platform truncates the response when its
  duration cap fires, which the FE renders as "Board Copilot took too
  long".
- The five interrupt-using agents (`board-brief-agent`,
  `task-drafting-agent`, `task-estimation-agent`, `triage-agent`,
  `search-agent`). They pause on `langgraph.types.interrupt(...)`
  and resume on a follow-up request. The default `AGENT_CHECKPOINT_BACKEND=auto`
  resolves to memory when no `AGENT_POSTGRES_URI` is set, and memory
  cannot survive a Vercel cold start. Even with `AGENT_POSTGRES_URI`
  set (auto-switching to postgres), the in-process budget tracker
  and rate limiter are still per-invocation — they reset to zero on
  every cold container, so quotas are not enforced.

The tradeoff: keep `vercel.json` for the v1 surface if that's how the
existing FE talks to the server, and front the AI endpoints with one
of the targets below by routing `/api/v1/agents/*` to the long-lived
deployment at the edge / FE proxy.

---

## Recommended targets

### Fly.io

The repo ships `backend/fly.toml` ready for `fly launch --copy-config`
from `backend/`. The default `app` name is `pulse-backend`; rename it
in that file (or pass `--app`) so deploys never target another team's Fly app.

```bash
fly launch --copy-config --no-deploy
fly secrets set \
    ANTHROPIC_API_KEY=... \
    AGENT_POSTGRES_URI="postgresql://..." \
    MONGO_URI="mongodb+srv://..."
# Optional: set UUID="$(openssl rand -hex 32)" only if you want a stable
# JWT secret pinned outside Mongo. Otherwise the lifespan persists one
# into system_config on first boot.
fly deploy
```

What matters for SSE on Fly:

- `auto_stop_machines = false` and `min_machines_running = 1` keep
  the in-process state alive between requests.
- `[http_service.concurrency]` with `soft_limit = 200` lets a single
  machine fan out enough SSE connections without queuing healthy
  callers behind a slow tool.
- Fly's HTTP/2 proxy has a 60-second idle window between bytes on a
  streaming response. Each `messages` chunk from the agent resets it,
  so the wall-clock cap is `AGENT_REQUEST_TIMEOUT_SECONDS` (default
  120s). Interleave a heartbeat custom event from any tool that
  routinely goes silent for >60s.

Scale by adding more Fly machines **or** by raising `UVICORN_WORKERS`
on a single machine **only after** `RATE_LIMIT_BACKEND`,
`BUDGET_BACKEND`, and `IDEMPOTENCY_BACKEND` are `redis` with a real
`REDIS_URI` (otherwise boot fails fast). One worker per machine remains
the safe default when any of those backends stay `memory`. See the
comment block at the top of `backend/fly.toml`.

### Render

Render's web service runtime accepts the same Dockerfile. A minimal
`render.yaml`:

```yaml
services:
  - type: web
    # Rename to your Render service name (repo default below matches fly.toml).
    name: pulse-backend
    runtime: docker
    plan: standard
    region: oregon
    healthCheckPath: /health
    autoDeploy: false
    envVars:
      - key: PORT
        value: 8000
      - key: AGENT_REQUEST_TIMEOUT_SECONDS
        value: "120"
      # UUID is optional; the lifespan persists a bootstrap secret in Mongo when unset.
      - key: UUID
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: AGENT_POSTGRES_URI
        sync: false
      - key: MONGO_URI
        sync: false
      - key: CORS_ORIGINS
        value: https://your-fe.example.com
```

What matters for SSE on Render:

- `plan: standard` (or higher) is required — the free tier sleeps the
  service after 15 minutes of inactivity, which drops every paused
  agent thread.
- Render's HTTP proxy buffers responses by default; FastAPI's
  `StreamingResponse` already sets `Cache-Control: no-cache` and the
  router emits `X-Accel-Buffering: no`, so chunks ship promptly.
- Pin `numInstances: 1` (or use a Postgres-backed budget/rate-limit
  store before scaling out) for the same reason as Fly.

### ECS / Cloud Run / Container Apps

Same Dockerfile. Default **one worker per container**; multiple workers
per container require the Redis middleware trio + `REDIS_URI` (see
production checklist). Knobs to verify:

- **AWS ECS Fargate** behind an ALB: set the target group's
  *deregistration delay* lower than `AGENT_REQUEST_TIMEOUT_SECONDS`,
  and the ALB *idle timeout* to at least 120s (default 60s is below
  the agent timeout, which truncates long streams).
- **Google Cloud Run**: set `--timeout=600` (default 300s) and
  `--min-instances=1`. Cloud Run's request/response streaming is
  on by default with HTTP/2, but the request timeout is the upper
  bound on the whole stream, including any silent tool window.
- **Azure Container Apps**: set the ingress *transport* to `http2`
  and *responseTimeout* to at least 120s. Scale rule should pin
  `minReplicas: 1`.

In every case: one uvicorn worker per container, scale out with
multiple containers only after switching the agent backends to
postgres.

### Dedicated uvicorn behind nginx

For self-hosted deployments without a managed runtime:

For self-hosted deployments without a managed runtime (default one worker;
set `UVICORN_WORKERS` only after the Redis trio + `REDIS_URI` checklist
items above):

```bash
exec uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 \
    --workers "${UVICORN_WORKERS:-1}" \
    --proxy-headers --forwarded-allow-ips '*'
```

nginx `location` block for the streaming surface:

```nginx
location /api/v1/agents/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    chunked_transfer_encoding on;
}
```

The non-obvious knobs: `proxy_buffering off` is mandatory for SSE
(otherwise nginx holds the whole response until the upstream closes),
and `proxy_read_timeout` must exceed `AGENT_REQUEST_TIMEOUT_SECONDS`.

---

## Production checklist

Tier-1 readiness: every box must be ticked before the AI surface goes
live.

- [ ] `AGENT_POSTGRES_URI` is set; with the default `AGENT_CHECKPOINT_BACKEND=auto` and `AGENT_STORE_BACKEND=auto`, both backends switch to `postgres` automatically. Explicit `=postgres` is still accepted as an override; explicit `=memory` opts out.
- [ ] `AGENT_POSTGRES_URI` (or `POSTGRES_URI`, or the discrete `POSTGRES_HOST` / `_USER` / `_DATABASE` / `_PASSWORD` / `_PORT` fields) reachable from the deployment.
- [ ] `python -m pip install ".[postgres-agents]"` (or `".[ai]"`) baked into the image — the published `requirements.txt` already includes `langgraph-checkpoint-postgres` so the production Dockerfile picks it up automatically.
- [ ] `CORS_ORIGINS` set to the deployed FE origin (the `localhost` defaults will block every browser request from the real FE; the server logs a WARNING when it detects that case on a production-shaped host, see below).
- [ ] EITHER `UUID` is set (≥32 chars; the server raises `RuntimeError` on shorter values), OR `MONGO_URI` is reachable so the lifespan can persist a bootstrapped secret in the `system_config` collection. On a hosted deploy (Vercel / Render / Fly / Railway / Kubernetes) the boot hard-fails with a platform-named error when BOTH are missing. Explicit `UUID` is recommended when you want a stable secret outside Mongo (e.g. to share with a legacy signer).
- [ ] `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set. `langchain-anthropic` and `langchain-openai` are base dependencies; no extra install step is required. Without a key the catalog stays on the deterministic stub.
- [ ] `AGENT_BUDGET_MONTHLY_TOKEN_CAP` reviewed for the deployed tier. The default `1000000` is a placeholder.
- [ ] `RATE_LIMIT_BACKEND=redis` and `BUDGET_BACKEND=redis` with a reachable `REDIS_URI`. The default `memory` backends keep their state per-process, so multi-worker / serverless deploys enforce `workers × cap` rather than `cap`, and a cold start zeroes the running tally. The Redis backends use server-side Lua scripts so check-and-mutate stays atomic across workers without a separate distributed lock. The published `requirements.txt` includes `redis>=5.0` so the production Dockerfile already has the integration; flip the env vars and provide a connection string.
- [ ] `IDEMPOTENCY_BACKEND=redis` (same `REDIS_URI`). Without it, the FE's `Idempotency-Key` header is useless across multiple workers — a duplicate request landing on a different worker is not deduplicated, double-charging the budget.
- [ ] **Multi-worker / `UVICORN_WORKERS`:** default is `1`. The process
      **raises `RuntimeError` on startup** when `WEB_CONCURRENCY` or
      `UVICORN_WORKERS` is `> 1` unless rate limit, budget, and
      idempotency are **all** Redis-backed with a non-empty `REDIS_URI`.
      Otherwise keep one worker per container and scale out horizontally.
- [ ] **Memory-backend warning awareness:** if `AGENT_CHECKPOINT_BACKEND`, `AGENT_STORE_BACKEND`, `IDEMPOTENCY_BACKEND`, `RATE_LIMIT_BACKEND`, or `BUDGET_BACKEND` is left at the `memory` default, the server logs WARNINGs at lifespan startup on any production-shaped host (Vercel / Render / Fly / Railway / Kubernetes) and on any process where `WEB_CONCURRENCY` or `UVICORN_WORKERS` parses to an integer > 1. These warnings do not block boot by themselves, but they identify production-unsafe split state: interrupt checkpoints, idempotency keys, rate limits, and budgets stay process-local. Set the corresponding `=postgres` / `=redis` env vars (and the matching connection strings) before the deploy completes, or — only if you knowingly want a single-worker deploy — keep `WEB_CONCURRENCY` unset. The code still hard-fails for actual invalid backend configuration, such as unsupported backend names or selecting `postgres` / `redis` without a usable connection string.
- [ ] (Optional) `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` + `LANGSMITH_PROJECT` for trace export. The server re-exports both `LANGSMITH_*` and `LANGCHAIN_*` env vars at startup so LangChain 0.3.x picks them up regardless of subpackage.
- [ ] (Optional) `AGENT_PROJECT_CHAT_MODEL_MAP=project_id:model_id,...`
      assigns a default chat model per project on v1 + v2.1 routes;
      `X-Pulse-Model` still overrides when sent. Entries must satisfy
      `AGENT_CHAT_MODEL_ALLOWLIST` when that allowlist is non-empty.

### Frontend env vars (production)

Set these in the Vercel FE project (or whichever host serves the SPA):

| Variable                                  | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_AI_BASE_URL`                   | Optional. When set, must be an absolute `https://` URL (or `http:` in dev). Validated at module load; invalid URLs fall back to the local engine. Trailing slashes are trimmed. **When unset**, deployed builds default `aiBaseUrl` to `apiOrigin` so they reach the backend without this var. Set `REACT_APP_AI_USE_LOCAL=true` to force the local engine instead.          |
| `REACT_APP_AI_MUTATION_PROPOSALS_ENABLED` | Defaults **`true`**. Set to `false` only as an operator rollback to suppress `MutationProposalCard` even if an agent emits a `pendingProposal`. The BE `MutationProposal` lifecycle is closed in code; see [`../todo/release-todo.md`](../todo/release-todo.md) §1.                                                                                                   |
| `VITE_ANALYTICS_ENDPOINT`                 | Full URL for batched analytics POSTs. **Without this, every `track()` call is silently dropped in production** — `devMemorySink` (in-memory) is the only active sink. In production builds a `console.warn` fires at startup when this var is unset; warnings are also exposed at `window.__copilotObservabilityWarnings__`. De-facto required for production observability. |
| `VITE_ERROR_REPORT_ENDPOINT`              | Full URL for error event POSTs. **Without this, `ErrorBoundary` exceptions and AI error events are never reported.** In production builds a `console.warn` fires at startup when this var is unset (see `window.__copilotObservabilityWarnings__`). De-facto required for production error visibility.                                                                       |
| `BACKEND_URL`                             | Vercel-serverless env var (NOT a Vite/CRA var) read by `api/_proxy.ts` at request time. Defaults to `https://pulse-python-server.vercel.app` when unset. Override when the BE is deployed under a different host (e.g. `https://<your-be>.fly.dev`) — no source edits required.                                                                                              |

### CDN cache-purge — required for the deploy that landed `a59539f`

Commit `a59539f` migrated FE tool args from camelCase to snake_case
(`task_id`, `project_id`). This is a **breaking change** for any user
holding a pre-merge bundle: the agent will send snake_case args that
the old FE tool registry does not recognise, causing silent `useAgent`
interrupt failures.

Vite asset hashing handles JS chunks automatically. However, proxies
and CDNs (Cloudflare, CloudFront, etc.) cache `index.html` separately.
**Explicitly purge `index.html`** on the CDN after that deploy so
browsers fetch the new bundle reference. Subsequent deploys are clean.

### FE smoke tests after deploy

- Force a `402` response from the AI proxy → browser renders a `budget` typed error with no retry button.
- Force `403` → `forbidden` typed error.
- Force `429` → `rateLimit` typed error with countdown-disabled retry button.
- Force `5xx` → `server` typed error with retry available.
- Open the board brief while connected to the agent server → SSE stream completes; citation chips show the correct source label (`task` or `column`).
- Open network tab → every AI request carries an `Idempotency-Key` header.
- Call `POST /api/v1/ai/readiness` with a minimal valid JSON body (e.g. `{"task": {"title": "test"}, "project_id": "proj_x"}`) → response JSON contains an `issues` array where no entry has a `null` value for its `suggestion` field.

### Security considerations

The AI proxy accepts **`ai_jwt`** (`scp=ai_proxy`, session-oriented TTL)
from `sessionStorage` for `/api/ai/*` and `/api/v1/agents/*` requests while
full **`jwt`** (`scp=rest`) remains in `localStorage` for REST CRUD.
Limit XSS blast radius by keeping proxy tokens short-lived and renewing
on login — see Beta §3 closure in
[`../todo/release-todo.md`](../todo/release-todo.md).

---

## Post-deploy verification

Run these checks after first deploy with a real `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`:

- `GET /api/v1/health/ai?probe=true` (no auth required — operator-debugging probe). Confirm:
  - `"ready": true`
  - `"providerConnectivity": { "reachable": true }`
  - `"checkpointerBackend"` and `"storeBackend"` show `"postgres"` (the `auto` default flipped because `AGENT_POSTGRES_URI` is set)
  - `"jwtSecretSource"` is `"env"` (explicit UUID) or `"persisted"` (Mongo-bootstrapped) — never `"ephemeral"` in production
  - `"issues": []` is empty
  Example: `curl -s https://<your-be>/api/v1/health/ai?probe=true | jq .`
- `POST /api/ai/readiness` with at least one issue → response must contain no `suggestion: null` keys (the key must be omitted entirely when there is no suggestion).
- `POST /api/v1/agents/board-brief-agent/stream` → SSE citation objects must carry `source: "task"` or `source: "column"`, not `"fe.boardSnapshot"`.
- Idempotency dedupe: send the same `Idempotency-Key` twice within the dedup window → the second call must return the cached result without re-invoking the LLM (confirm by checking that `/health` budget metrics did not increment twice).
- Multi-worker without Redis: set `UVICORN_WORKERS=2` (or equivalent)
  with `RATE_LIMIT_BACKEND=memory` → the process **must not start**
  (`RuntimeError` from `_configure_middleware_backends`). Fix by
  switching all three middleware backends to `redis` with `REDIS_URI`, or
  drop back to one worker.
- Multi-worker rate limiting (legacy check): with `--workers 2` and all
  Redis backends correctly configured, verify per-key limits are not
  doubled across workers.
- Interrupt resume: trigger an agent run that exceeds 2 minutes and crosses an `interrupt()` pause, then send the FE tool reply → confirm the run resumes from the saved checkpoint (validates that `AGENT_CHECKPOINT_BACKEND=postgres` is correctly wired).

---

## Boot-log signals to grep for

Two boot-time helpers in `app/main.py` surface common
misconfigurations directly in the deploy log. Operators should grep
the deploy logs for these strings on every release:

**Memory backends on a production host** (`_validate_memory_agent_backends`):

On a single-worker dev / test process, the helper logs the memory-backend note at DEBUG to avoid noisy local boots:

```
Agent persistence is using the in-process memory backend (checkpoint=%s, store=%s). Interrupt-using agents (board-brief, task-drafting, task-estimation, triage) cannot resume across processes; production deployments should set AGENT_POSTGRES_URI (the default `auto` then switches both backends to postgres) or set the backends explicitly.
```

On a production-shaped host (any of `VERCEL`, `VERCEL_URL`, `RENDER_EXTERNAL_HOSTNAME`, `RENDER`, `KUBERNETES_SERVICE_HOST`, `FLY_APP_NAME`, `RAILWAY_PROJECT_ID` is set, or `WEB_CONCURRENCY` / `UVICORN_WORKERS` parses to an integer > 1), the helper logs this WARNING:

```
Unsafe memory backend(s) detected in a multi-worker / multi-instance environment (%s): %s. Interrupt-using agents cannot resume across processes. Set AGENT_CHECKPOINT_BACKEND=postgres, AGENT_STORE_BACKEND=postgres, and AGENT_POSTGRES_URI=<dsn> for production.
```

A parallel guard in `_configure_middleware_backends` **raises**
`RuntimeError` when `UVICORN_WORKERS` / `WEB_CONCURRENCY` is `> 1` but
rate, budget, or idempotency is not fully Redis-backed with `REDIS_URI`.
It also logs a WARNING listing every memory-backed middleware
(`RATE_LIMIT_BACKEND=memory`, `BUDGET_BACKEND=memory`,
`IDEMPOTENCY_BACKEND=memory`) detected under the same multi-instance
heuristic as the checkpoint guard, with the matching Redis fix.

**Postgres backend with no connection string** (`_validate_agent_postgres_backend`, raises `RuntimeError`, deploy never finishes booting):

```
AGENT_CHECKPOINT_BACKEND=postgres but no connection string is configured; set AGENT_POSTGRES_URI or POSTGRES_URI (or the discrete POSTGRES_HOST / POSTGRES_USER / POSTGRES_DATABASE / POSTGRES_PASSWORD fields) before starting the server.
```

(Substitute `AGENT_STORE_BACKEND=postgres` when the store, not the
checkpointer, is the misconfigured one.)

**Localhost-only CORS on a production host** (`_warn_about_localhost_only_cors`):

```
CORS is configured with localhost-only origins (%s) on a %s deploy; browser requests from the real FE origin will be blocked at the CORS preflight, so the AI features will not load. Set CORS_ORIGINS to the deployed FE origin (or CORS_ORIGIN_REGEX for multi-origin matches).
```

The first `%s` is the comma-joined list of configured origins; the
second `%s` is the detected platform name (capitalized: `Vercel`,
`Render`, `Fly`, `Railway`, `Kubernetes`) or the fallback string
`"this hosted"` when no platform marker resolves cleanly.

The localhost-only check fires on any of `VERCEL`, `VERCEL_URL`,
`RENDER_EXTERNAL_HOSTNAME`, `RENDER`, `KUBERNETES_SERVICE_HOST`,
`FLY_APP_NAME`, or `RAILWAY_PROJECT_ID` being set in the environment.

**Missing provider API key on a production host** (`assert_provider_available` in `app/agents/llm.py`, raises `RuntimeError`, deploy never finishes booting):

```
<ENV_VAR> is empty on <Platform>; set it in <platform-specific location>. Without it, every AI call will fail mid-SSE.
```

`<ENV_VAR>` is `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` depending on
the resolved provider; `<Platform>` is the detected hosted platform
capitalized; `<platform-specific location>` is one of:

- `your Vercel project settings → Environment Variables`
- `your Render service → Environment`
- `` your Fly app secrets (`fly secrets set`) ``
- `your Railway service → Variables`
- `your Deployment env or Secret manifest`
- `your hosting platform's environment settings` (fallback)

When the deploy is production-shaped but the platform marker is not
one of the recognised values, the generic fallback message is raised:

```
AGENT_CHAT_MODEL_PROVIDER resolved to '<provider>' but <ENV_VAR> is empty on a production-shaped deploy; the first agent run would fail mid-SSE. Set <ENV_VAR> or switch the provider to 'auto' / 'stub'.
```

**JWT-secret bootstrap failure** (`_resolve_and_install_jwt_secret` in `app/main.py`, raises `RuntimeError`, deploy never finishes booting):

```
MONGO_URI is unreachable on <Platform> and no UUID env var was set; the persisted JWT-secret bootstrap requires Mongo. Set MONGO_URI to a reachable cluster (Mongo Atlas serverless is the canonical option for Vercel) or set UUID to a stable secret of at least 32 characters.
```

`<Platform>` is the detected hosted platform capitalized (or the
fallback string `this hosted platform`). A separate guard raises a
shorter error when `UUID` is set but shorter than the minimum length:

```
UUID must be at least 32 characters; token-issuing endpoints would fail at first request.
```

---

## Post-merge verification checklist

- [ ] FE Vercel project still builds and serves the app at its existing URL.
- [ ] BE Vercel project, after the Root Directory change, builds and `GET /api/v1/health` returns 200.
- [ ] `Backend CI` workflow runs green on a PR that touches `backend/**`.
- [ ] FE-only and BE-only PRs trigger only the relevant Vercel project (verify in the Vercel deployments tab).

---

## See also

- [`../todo/release-todo.md`](../todo/release-todo.md) — current AI release status, soft blockers, and operational backlog.
- `Dockerfile`, `fly.toml`, `docker-compose.yml` in the `backend/` directory.
