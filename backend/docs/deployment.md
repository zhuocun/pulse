# Deployment

Production deployment guide for jira-python-server. Companion to the
README's Configuration section.

The agent surface streams long-lived Server-Sent Events and keeps
short-term state on the heap (rate limiter, budget tracker, default
LangGraph checkpointer). That rules out short-window serverless
runtimes for the AI endpoints and shapes every recommendation below.

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
  and resume on a follow-up request. The default `AGENT_CHECKPOINT_BACKEND=memory`
  cannot survive a Vercel cold start, and even with
  `AGENT_CHECKPOINT_BACKEND=postgres` the in-process budget tracker
  and rate limiter are still per-invocation — they reset to zero on
  every cold container, so quotas are not enforced.

The tradeoff: keep `vercel.json` for the v1 surface if that's how the
existing FE talks to the server, and front the AI endpoints with one
of the targets below by routing `/api/v1/agents/*` to the long-lived
deployment at the edge / FE proxy.

---

## Recommended targets

### Fly.io

The repo ships `fly.toml` ready for `fly launch --copy-config`.

```bash
fly launch --copy-config --no-deploy
fly secrets set \
    UUID="$(openssl rand -hex 32)" \
    ANTHROPIC_API_KEY=... \
    POSTGRES_URI="postgresql://..." \
    MONGO_URI="mongodb+srv://..."
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

Scale by adding more machines with one uvicorn worker each, not by
raising `--workers`. See the comment block at the top of `fly.toml`.

### Render

Render's web service runtime accepts the same Dockerfile. A minimal
`render.yaml`:

```yaml
services:
  - type: web
    name: jira-python-server
    runtime: docker
    plan: standard
    region: oregon
    healthCheckPath: /health
    autoDeploy: false
    envVars:
      - key: PORT
        value: 8000
      - key: AGENT_CHECKPOINT_BACKEND
        value: postgres
      - key: AGENT_STORE_BACKEND
        value: postgres
      - key: AGENT_REQUEST_TIMEOUT_SECONDS
        value: "120"
      - key: UUID
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: POSTGRES_URI
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

Same Dockerfile, same one-worker rule. Knobs to verify:

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

```bash
uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 \
    --workers 1 \
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

- [ ] `AGENT_CHECKPOINT_BACKEND=postgres` and `AGENT_STORE_BACKEND=postgres`.
- [ ] `AGENT_POSTGRES_URI` (or `POSTGRES_URI`, or the discrete `POSTGRES_HOST` / `_USER` / `_DATABASE` / `_PASSWORD` / `_PORT` fields) reachable from the deployment.
- [ ] `python -m pip install ".[postgres-agents]"` (or `".[ai]"`) baked into the image — the published `requirements.txt` already includes `langgraph-checkpoint-postgres` so the production Dockerfile picks it up automatically.
- [ ] `CORS_ORIGINS` set to the deployed FE origin (the `localhost` defaults will block every browser request from the real FE; the server logs a WARNING when it detects that case on a production-shaped host, see below).
- [ ] `UUID` is at least 32 bytes of entropy. The server raises `RuntimeError` at startup when this is shorter; do not work around it by lowering the floor.
- [ ] `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set. `langchain-anthropic` and `langchain-openai` are base dependencies; no extra install step is required. Without a key the catalog stays on the deterministic stub.
- [ ] `AGENT_BUDGET_MONTHLY_TOKEN_CAP` reviewed for the deployed tier. The default `1000000` is a placeholder.
- [ ] `RATE_LIMIT_BACKEND=redis` and `BUDGET_BACKEND=redis` with a reachable `REDIS_URI`. The default `memory` backends keep their state per-process, so multi-worker / serverless deploys enforce `workers × cap` rather than `cap`, and a cold start zeroes the running tally. The Redis backends use server-side Lua scripts so check-and-mutate stays atomic across workers without a separate distributed lock. The published `requirements.txt` includes `redis>=5.0` so the production Dockerfile already has the integration; flip the env vars and provide a connection string.
- [ ] `IDEMPOTENCY_BACKEND=redis` (same `REDIS_URI`). Without it, the FE's `Idempotency-Key` header is useless across multiple workers — a duplicate request landing on a different worker is not deduplicated, double-charging the budget.
- [ ] **Hard-fail awareness:** if `AGENT_CHECKPOINT_BACKEND`, `AGENT_STORE_BACKEND`, `IDEMPOTENCY_BACKEND`, `RATE_LIMIT_BACKEND`, or `BUDGET_BACKEND` is left at the `memory` default, the server raises `RuntimeError` at lifespan startup on any production-shaped host (Vercel / Render / Fly / Railway / Kubernetes) and on any process where `WEB_CONCURRENCY` or `UVICORN_WORKERS` parses to an integer > 1. This is intentional: silently splitting state across workers is worse than failing loudly. Set the corresponding `=postgres` / `=redis` env vars (and the matching connection strings) before the deploy completes, or — only if you knowingly want a single-worker deploy — keep `WEB_CONCURRENCY` unset.
- [ ] (Optional) `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` + `LANGSMITH_PROJECT` for trace export. The server re-exports both `LANGSMITH_*` and `LANGCHAIN_*` env vars at startup so LangChain 0.3.x picks them up regardless of subpackage.

### Security considerations

The AI proxy validates requests with the same JWT that the React app stores in `localStorage` under the key `"Token"`. Any XSS vector in the FE can exfiltrate that token and call the AI proxy on the user's behalf. This is pre-existing auth architecture, not introduced by the AI surface, but operators deploying the AI server should be aware: a compromised FE token equals a compromised AI proxy token. Consider issuing proxy-scoped tokens with a narrower claim set to limit blast radius — tracked as a follow-up in `docs/AI_REMAINING_WORK.md`.

---

## Post-deploy verification

Run these checks after first deploy with a real `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`:

- `POST /api/ai/readiness` with at least one issue → response must contain no `suggestion: null` keys (the key must be omitted entirely when there is no suggestion).
- `POST /api/v1/agents/board-brief-agent/stream` → SSE citation objects must carry `source: "task"` or `source: "column"`, not `"fe.boardSnapshot"`.
- Idempotency dedupe: send the same `Idempotency-Key` twice within the dedup window → the second call must return the cached result without re-invoking the LLM (confirm by checking that `/health` budget metrics did not increment twice).
- Multi-worker rate limiting: start with `--workers 2` and `RATE_LIMIT_BACKEND=memory`, verify the effective cap is doubled — that is the known bug confirming you must set `RATE_LIMIT_BACKEND=redis` for correct enforcement.
- Interrupt resume: trigger an agent run that exceeds 2 minutes and crosses an `interrupt()` pause, then send the FE tool reply → confirm the run resumes from the saved checkpoint (validates that `AGENT_CHECKPOINT_BACKEND=postgres` is correctly wired).

---

## Boot-log signals to grep for

Two boot-time helpers in `app/main.py` surface common
misconfigurations directly in the deploy log. Operators should grep
the deploy logs for these strings on every release:

**Memory backends on a production host** (`_validate_memory_agent_backends`):

On a single-worker dev / test process, the helper logs the original WARNING at startup so operators see the gotcha:

```
Agent persistence is using the in-process memory backend (checkpoint=%s, store=%s). Interrupt-using agents (board-brief, task-drafting, task-estimation, triage) cannot resume across processes; production deployments should set AGENT_CHECKPOINT_BACKEND=postgres and AGENT_STORE_BACKEND=postgres with AGENT_POSTGRES_URI (or POSTGRES_URI) configured.
```

On a production-shaped host (any of `VERCEL`, `VERCEL_URL`, `RENDER_EXTERNAL_HOSTNAME`, `RENDER`, `KUBERNETES_SERVICE_HOST`, `FLY_APP_NAME`, `RAILWAY_PROJECT_ID` is set, or `WEB_CONCURRENCY` / `UVICORN_WORKERS` parses to an integer > 1), the helper now raises `RuntimeError` and the deploy never finishes booting:

```
Unsafe memory backend(s) detected in a multi-worker / multi-instance environment (production-shaped env var <VAR> is set | WEB_CONCURRENCY=<N> indicates multiple workers): AGENT_CHECKPOINT_BACKEND=memory[, AGENT_STORE_BACKEND=memory]. Interrupt-using agents (board-brief, task-drafting, task-estimation, triage) cannot resume across processes. Fix: set AGENT_CHECKPOINT_BACKEND=postgres, AGENT_STORE_BACKEND=postgres, and AGENT_POSTGRES_URI=<dsn>. Install the required extras: pip install ".[postgres-agents]" (or ".[ai]").
```

A parallel guard in `_configure_middleware_backends` raises a single `RuntimeError` listing every memory-backed middleware (`RATE_LIMIT_BACKEND=memory`, `BUDGET_BACKEND=memory`, `IDEMPOTENCY_BACKEND=memory`) detected under the same multi-instance condition, with the matching Redis fix.

**Postgres backend with no connection string** (`_validate_agent_postgres_backend`, raises `RuntimeError`, deploy never finishes booting):

```
AGENT_CHECKPOINT_BACKEND=postgres but no connection string is configured; set AGENT_POSTGRES_URI or POSTGRES_URI (or the discrete POSTGRES_HOST / POSTGRES_USER / POSTGRES_DATABASE / POSTGRES_PASSWORD fields) before starting the server.
```

(Substitute `AGENT_STORE_BACKEND=postgres` when the store, not the
checkpointer, is the misconfigured one.)

**Localhost-only CORS on a production host** (`_warn_about_localhost_only_cors`):

```
CORS is configured with localhost-only origins (...) on a production-shaped deploy; browser requests from the real FE origin will be blocked at the CORS preflight, so the AI features will not load. Set CORS_ORIGINS to the deployed FE origin (or CORS_ORIGIN_REGEX for multi-origin matches).
```

The localhost-only check fires on any of `VERCEL`, `VERCEL_URL`,
`RENDER_EXTERNAL_HOSTNAME`, `RENDER`, `KUBERNETES_SERVICE_HOST`,
`FLY_APP_NAME`, or `RAILWAY_PROJECT_ID` being set in the environment.

---

## See also

- `docs/AI_ARCHITECTURE_REVIEW.md` — still-open structural concerns (provider fallback, multi-agent orchestration, MCP, real embeddings/vector store, test-strategy gaps); cross-references `AI_REMAINING_WORK.md` as the operational backlog.
- `docs/AI_REMAINING_WORK.md` — prioritised operational backlog; items 7–12 are open.
- `Dockerfile`, `fly.toml`, `docker-compose.yml` in the `backend/` directory.
