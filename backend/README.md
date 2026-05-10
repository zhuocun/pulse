# pulse — backend

FastAPI port of `jira-express-server`.

## API

The server exposes the same route prefix as the Express app:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users`
- `PUT /api/v1/users`
- `GET /api/v1/users/members`
- `PUT /api/v1/users/likes`
- `POST /api/v1/projects`
- `GET /api/v1/projects`
- `PUT /api/v1/projects`
- `DELETE /api/v1/projects`
- `GET /api/v1/boards`
- `POST /api/v1/boards`
- `PUT /api/v1/boards/orders`
- `DELETE /api/v1/boards`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `PUT /api/v1/tasks`
- `PUT /api/v1/tasks/orders`
- `DELETE /api/v1/tasks`
- `GET /api/v1/agents`
- `GET /api/v1/agents/{name}`
- `POST /api/v1/agents/{name}/invoke`
- `POST /api/v1/agents/{name}/stream` (Server-Sent Events; FE-shaped `StreamPart` envelope)
- `POST /api/ai/task-draft` (legacy v1 shim)
- `POST /api/ai/task-breakdown` (legacy v1 shim)
- `POST /api/ai/estimate` (legacy v1 shim)
- `POST /api/ai/readiness` (legacy v1 shim)
- `POST /api/ai/board-brief` (legacy v1 shim)
- `POST /api/ai/search` (legacy v1 shim)
- `POST /api/ai/chat` (legacy v1 shim; routes to `chat-agent`)

## Local Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ".[dev]"
cp .env.example .env
```

Set `DATABASE` and the matching database environment variables in `.env`, then run:

```bash
uvicorn app.main:app --reload --port 8000
```

## Deployment

The repo ships a production Dockerfile, a Fly.io launch config, and a
`docker-compose.yml` that brings up the server alongside Postgres + Mongo
for parity with a Tier-1 production deploy. See `../docs/deployment.md`
for the full target-by-target guide (Vercel limits, Fly.io, Render,
ECS / Cloud Run / Container Apps, dedicated uvicorn behind nginx).

The `vercel.json` continues to deploy the synchronous v1 surface, but
the SSE streaming endpoint and the four interrupt-using agents need a
long-lived runtime — Vercel's per-tier 10s/60s/300s response cap
truncates streams the FE needs to keep open. Tier-1 readiness items
operators must address before flipping the AI surface live:

- `AGENT_CHECKPOINT_BACKEND=postgres` + `AGENT_STORE_BACKEND=postgres`
  with a reachable `AGENT_POSTGRES_URI` (or `POSTGRES_URI`).
- `CORS_ORIGINS` set to every deployed FE origin you serve. The default
  covers `localhost:3000` and the production `pulse-react-app.vercel.app`
  origin; any other host (custom domain, preview deployment, etc.) must
  be added explicitly or matched via `CORS_ORIGIN_REGEX`.
- `UUID` JWT secret of at least 32 bytes.
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; without one the catalog stays on
  the deterministic stub. `langchain-anthropic` and `langchain-openai` are
  now base dependencies, so no extra install step is required.
- `AGENT_BUDGET_MONTHLY_TOKEN_CAP` reviewed for the tier.
- (Optional) `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` for trace export.

Local end-to-end against the same persistence stack production uses:

```bash
docker compose up --build
```

## Local Git Hooks

Install the local hooks:

```bash
cp scripts/git-hooks/pre-commit .git/hooks/pre-commit
cp scripts/git-hooks/commit-msg .git/hooks/commit-msg
chmod +x .git/hooks/pre-commit .git/hooks/commit-msg
```

- `pre-commit` runs `python -m pytest`, which is configured to fail below `100%` coverage.
- `commit-msg` enforces Conventional Commits with these types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

Examples:

```text
feat: add project search
chore(hooks): enforce commit messages
```

## Configuration

> **Operational caveats.** Before wiring this BE up to a customer, skim
> [`docs/ai-remaining-work.md`](docs/ai-remaining-work.md) for the
> Priority 1 production gotchas (durable backends, idempotency,
> provider-key guard) and the open GA-blockers
> ([`docs/backend-production-readiness.md`](docs/backend-production-readiness.md)).

- `DATABASE`: Storage backend. Supported values match the Express app: `mongoDB`, `dynamoDB`, `postgreSQL`. Defaults to `mongoDB`.
- `MONGO_URI`: MongoDB connection string.
- `MONGO_DB`: Database name. Defaults to the database in `MONGO_URI`, then `jira`.
- `AWS_REGION`: DynamoDB region. Defaults to `us-east-1`.
- `DYNAMODB_ENDPOINT_URL`: Optional DynamoDB endpoint for local development.
- `DYNAMODB_TABLE_PREFIX`: Optional prefix for DynamoDB table names.
- `POSTGRES_URI`: Optional PostgreSQL connection URI.
- `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`: PostgreSQL connection fields when `POSTGRES_URI` is not set.
- `POSTGRES_SSL`: Set to `true` to require SSL for PostgreSQL.
- `UUID`: JWT signing secret, matching the original Express app. Must be at least 32 characters; token-issuing endpoints (`POST /api/v1/auth/login`) will fail with HTTP 500 until this is set.
- `CORS_ORIGINS`: Comma-separated allowed frontend origins. Defaults to `http://localhost:3000,http://127.0.0.1:3000,https://pulse-react-app.vercel.app`.
- `CORS_ORIGIN_REGEX`: Optional regex for additional dynamic origins, such as Vercel preview deployments.
- `PORT`: Runtime port for local scripts.
- `AGENT_CHECKPOINT_BACKEND`: LangGraph short-term checkpointer backend. `none`, `memory`, or `postgres`. Defaults to `memory`. Production deployments should use `postgres` so interrupts and threads survive a worker restart; that path requires `python -m pip install ".[postgres-agents]"` and a reachable Postgres cluster.
- `AGENT_STORE_BACKEND`: LangGraph long-term `BaseStore` backend. `none`, `memory`, or `postgres`. Defaults to `memory`. Same install + Postgres requirements as `AGENT_CHECKPOINT_BACKEND` when set to `postgres`.
- `AGENT_POSTGRES_URI`: Optional agent-specific Postgres connection string. Falls back to `POSTGRES_URI`, then to a string built from `POSTGRES_USER` / `POSTGRES_HOST` / `POSTGRES_DATABASE` / `POSTGRES_PASSWORD` / `POSTGRES_PORT` / `POSTGRES_SSL`. Required (via any of those three sources) when either backend is set to `postgres`.
- `AGENT_DEFAULT_THREAD_ID`: Default `thread_id` for stateful agent runs. Defaults to `default`.
- `AGENT_RECURSION_LIMIT`: Process-wide ceiling for LangGraph supersteps. Defaults to `25`.
- `AGENT_REQUEST_TIMEOUT_SECONDS`: Hard cap on a single agent invocation. Returns `504 Gateway Timeout` (or a typed `error` envelope mid-stream) when exceeded. Defaults to `120`.
- `AGENT_DEFAULT_AUTONOMY`: Default autonomy when the FE doesn't send one. `suggest` / `plan` / `auto`. Defaults to `plan`.
- `AGENT_DISABLED_PROJECT_IDS`: Comma-separated project ids that have opted out of AI features (PRD §6.3). Empty = all projects allowed.
- `AGENT_BUDGET_MONTHLY_TOKEN_CAP`: Per-project monthly token cap. Defaults to `1000000`.
- `AGENT_CHAT_MODEL_PROVIDER`: `auto` (env auto-detect), `anthropic`, `openai`, or `stub`. Defaults to `auto`.
- `AGENT_CHAT_MODEL_ID`: Provider-specific model id; defaults vary by provider (`claude-sonnet-4-6` / `gpt-4o-mini`).
- `AGENT_CHAT_MODEL_TEMPERATURE`: Forwarded to providers that accept it. Defaults to `0.2`.
- `ANTHROPIC_API_KEY`: Anthropic API key. Setting this and leaving the provider on `auto` flips the catalog from deterministic stubs to real LLM calls. `langchain-anthropic` is a base dependency, so no extra install step is required.
- `OPENAI_API_KEY`: OpenAI API key. Same `auto` behaviour as Anthropic. `langchain-openai` is a base dependency, so no extra install step is required.
- `EMBEDDINGS_PROVIDER`: `auto` (env auto-detect), `openai`, or `stub`. Defaults to `auto`. Selection mirrors `AGENT_CHAT_MODEL_PROVIDER`; `auto` picks OpenAI when `OPENAI_API_KEY` is set (Anthropic has no embeddings API) and the deterministic SHA-256 stub otherwise. Setting this to `openai` without the `[openai]` (or `[ai]`) extra installed loud-fails at boot.
- `EMBEDDINGS_MODEL_ID`: Provider-specific embeddings model id; defaults to `text-embedding-3-small` on OpenAI. The OpenAI branch always requests `dimensions=16` so vector widths match the stub for backwards compatibility with callers that snapshot the shape.
- `IDEMPOTENCY_BACKEND`: Selects the `Idempotency-Key` response cache backend. `memory` (default) keeps the cache process-local; `redis` shares it across workers and serverless instances via `REDIS_URI`. Multi-worker or serverless deploys must switch to `redis` so a retry that lands on a different worker still hits the cache. Defaults to `memory`.
- `IDEMPOTENCY_TTL_SECONDS`: How long a cached response stays eligible for replay. Defaults to `86400` (24h, matching Stripe). Both backends honour this.
- `RATE_LIMIT_BACKEND`: Selects the per-user / per-agent token-bucket store. `memory` (default) is process-local; `redis` shares the bucket across workers via `REDIS_URI`. Set to `redis` whenever `--workers > 1` or when running multiple containers, otherwise each worker enforces its own copy of the limit and the effective rate is N × the configured cap.
- `BUDGET_BACKEND`: Selects the per-project monthly token-budget store. `memory` (default) is process-local; `redis` shares the counter via `REDIS_URI`. Same multi-worker correctness reasoning as `RATE_LIMIT_BACKEND` — and the consequence is sharper here because the wrong backend lets retries double-spend the cap.
- `REDIS_URI`: Connection string for the Redis instance backing `IDEMPOTENCY_BACKEND` / `RATE_LIMIT_BACKEND` / `BUDGET_BACKEND` when any of them is set to `redis`. Required in that case; install with `python -m pip install ".[redis]"` (or `".[ai]"`).
- `LANGSMITH_TRACING`: Set to `true` to enable LangSmith tracing (also requires `LANGSMITH_API_KEY`).
- `LANGSMITH_PROJECT`: Optional LangSmith project name.
- `OTEL_TRACING`: Set to `true` to enable vendor-neutral OpenTelemetry GenAI spans on every agent invocation and FastAPI request. Defaults to `false`. Requires `python -m pip install ".[observability]"` (or `".[ai]"`); a `RuntimeError` at boot surfaces when the flag is on but the package is missing.
- `OTEL_SERVICE_NAME`: `service.name` resource attribute on emitted spans. Defaults to `pulse-server`.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: HTTP endpoint of the OTLP collector (e.g. `https://otlp.example.com/v1/traces`). Empty (the default) falls back to a console exporter that streams the trace JSON to stderr — useful for local dev without a collector.
- `PROMETHEUS_METRICS`: Set to `true` to mount `GET /metrics` and populate the Tier 9 counters (`agent_invocations_total{agent, outcome}`, `agent_tokens_total{agent, direction}`, `agent_run_duration_seconds{agent, outcome}`, `idempotency_cache_total{route, outcome}`). Defaults to `false`. Same install requirement as `OTEL_TRACING`.

MongoDB support is installed by default. DynamoDB and PostgreSQL drivers are optional:

```bash
python -m pip install ".[databases]"
```

`langchain-anthropic` and `langchain-openai` are base dependencies — a plain `pip install .` installs them. Setting `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is the only step needed to enable real LLM calls in single-worker development. Production-shaped deploys (Vercel, Render, Fly, Railway, Kubernetes) and any process running with `WEB_CONCURRENCY` or `UVICORN_WORKERS` > 1 must additionally swap the memory-backed persistence and middleware to Postgres / Redis for correct cross-worker behavior; the server logs warnings when those defaults are left in place under multi-instance conditions. See [`docs/ai-remaining-work.md`](docs/ai-remaining-work.md) item #10 for the operational caveats. Optional extras cover persistence, observability, and Redis:

```bash
python -m pip install ".[postgres-agents]"  # AsyncPostgresSaver/Store for AGENT_*_BACKEND=postgres
python -m pip install ".[redis]"            # Redis-backed idempotency / rate-limit / budget backends
python -m pip install ".[observability]"    # OpenTelemetry SDK + Prometheus client (Tier 9)
python -m pip install ".[ai]"               # all of the above (plus langchain-anthropic/openai again)
```

Without an API key, `AGENT_CHAT_MODEL_PROVIDER=auto` (the default) runs the deterministic stub; the `make_chat_model` branch raises `RuntimeError` at first invocation only if a provider is *explicitly* selected but its package is not importable.

## Agents

> **GA blockers — not yet production-ready for public ship.** Three hard blockers documented in [`docs/backend-production-readiness.md`](docs/backend-production-readiness.md) must close before the agent surface goes public: (1) the `MutationProposal` accept/undo lifecycle is a dead-end (no agent emits `custom/mutation_proposal`, no `fe.applyMutation` interrupt is registered); (2) there is no provider 5xx fallback — a single upstream Anthropic/OpenAI error is a full outage; (3) the AI proxy reuses the primary bearer JWT from `localStorage`, creating an XSS exfiltration surface. Until these are resolved, deploy with proposal cards gated off and treat the surface as internal beta only.

The application ships with an agent runtime built on [LangGraph](https://github.com/langchain-ai/langgraph) (`langgraph>=1.1,<2`, the v1.x API line). Six agents are registered automatically from `app/agents/catalog/` at startup — `board-brief-agent`, `task-drafting-agent`, `task-estimation-agent`, `chat-agent`, `triage-agent`, and `search-agent`; see the [Board Copilot v2.1 — Agent catalog](#board-copilot-v21--agent-catalog) section below for what each one does.

The design follows current LangGraph 1.x guidance:

- Both persistence layers are first-class: `BaseCheckpointSaver` (short-term, thread-scoped) and `BaseStore` (long-term, cross-thread).
- Run-scoped data flows through `Runtime[Context]` / `context_schema` (the v0.6+ pattern), not via `configurable`.
- Each agent declares its own `recursion_limit` to bound runaway tool / handoff loops.
- LangGraph and LangChain exceptions are translated into typed HTTP errors.
- Streaming is exposed via Server-Sent Events using `astream(stream_mode=("updates","messages","custom"))`.

Layout:

- `app/agents/base.py` — `AgentMetadata` + `BaseAgent` ABC. Every agent subclasses `BaseAgent` and returns a compiled LangGraph graph from `build(checkpointer=..., store=...)`.
- `app/agents/state.py` — default `AgentState` schema with the `add_messages` reducer.
- `app/agents/registry.py` — process-wide `AgentRegistry` (and `registry` singleton) where agents register themselves.
- `app/agents/checkpointing.py` — factory for the LangGraph checkpointer (`none` / `memory` / `postgres` via `langgraph-checkpoint-postgres`; `sqlite` plugs in here).
- `app/agents/stores.py` — factory for the LangGraph long-term store (`none` / `memory` / `postgres` via `langgraph-checkpoint-postgres`).
- `app/agents/runtime.py` — `AgentRuntime` ties registry + checkpointer + store + thread namespacing + recursion limits + exception translation together. Built once from `Settings` in the FastAPI lifespan and exposed through `request.app.state.agent_runtime`.
- `app/agents/catalog/` — drop new agent modules here. `discover()` auto-imports every public submodule at startup; no manual wiring.
- `app/routers/agents.py` — registry-driven HTTP surface:
  - `GET  /api/v1/agents`
  - `GET  /api/v1/agents/{name}`
  - `POST /api/v1/agents/{name}/invoke`
  - `POST /api/v1/agents/{name}/stream` (Server-Sent Events)

Adding a new agent is a single file:

```python
from dataclasses import dataclass
from langgraph.graph import StateGraph, START, END
from langgraph.runtime import Runtime
from typing_extensions import TypedDict

from app.agents import AgentMetadata, BaseAgent, registry


@dataclass
class MyContext:
    user_id: str = ""


class MyState(TypedDict, total=False):
    answer: str


class MyAgent(BaseAgent):
    metadata = AgentMetadata(
        name="my-agent",
        description="...",
        version="0.1.0",
        recursion_limit=15,
        context_schema=MyContext,
    )

    def build(self, *, checkpointer, store):
        def respond(state: MyState, runtime: Runtime[MyContext]) -> dict:
            ...
            return {"answer": "..."}

        graph = StateGraph(MyState, context_schema=MyContext)
        graph.add_node("respond", respond)
        graph.add_edge(START, "respond")
        graph.add_edge("respond", END)
        return graph.compile(checkpointer=checkpointer, store=store)


registry.register(MyAgent())
```

Drop the file at `app/agents/catalog/my_agent.py` and the catalog auto-discovery will import it on startup.

For the common ReAct case, prefer LangGraph's `from langgraph.prebuilt import create_react_agent` and return its compiled graph from `build` — it is built on the same LangGraph runtime, so it composes seamlessly with this scaffold. (LangChain 1.x does not export a top-level `create_agent`; an earlier draft of this README cited that import and would have raised `ImportError` for any reader who copied it.)

## Board Copilot v2.1 — Agent catalog

Phase A of PRD v2.1 ships six named agents, all registered automatically via `app/agents/catalog/`:

- `board-brief-agent` — fetches a board snapshot, runs deterministic drift detection, and emits a structured `IBoardBrief` payload.
- `task-drafting-agent` — drafts a single task or a breakdown across an axis, grounded in similar tasks.
- `task-estimation-agent` — estimates story points and surfaces an `IReadinessReport` for missing inputs. With `OPENAI_API_KEY` set, the `fetch_embeddings` node routes through the real OpenAI embeddings provider so neighbour scoring lives in a learned semantic space; without a key it falls back to the deterministic SHA-256 stub so nothing breaks (see `EMBEDDINGS_PROVIDER`).
- `chat-agent` — single-turn conversational agent for ad-hoc board questions.
- `triage-agent` — turns drift signals into actionable nudges (`unowned_bug`, `wip_overflow`, `stale_task`). The rules engine is the source of truth for *which* signals fire and at what severity; with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, `polish_triage` rewrites each nudge `summary` with signal-specific context (e.g. "WIP overflow in 'In Progress' (8/5)" instead of the generic title). Without a key the deterministic title is used. See `docs/ai-remaining-work.md` item #5 for the still-open product call on whether the polish path stays.
- `search-agent` — embedding-based search rerank: interrupts to the FE to collect `{id, text}` candidates, embeds query + candidates via `be_tools.embed`, ranks by cosine similarity via `be_tools.embedding_neighbors`, then calls `polish_search` (LLM rerank) if a real model is configured. With a real model set, the LLM may reorder the top-10 hits with a rationale. Also holds the chat model consumed by `polish_search` for the v1 `/api/ai/search` shim. Status is `"active"`; the v2.1 streaming entries (`/invoke` and `/stream`) are now functional.

Each agent accepts a `BaseChatModel` from `app.agents.llm.make_chat_model` (resolved on first compile). When `AGENT_CHAT_MODEL_PROVIDER=auto` (the default) the factory inspects `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in turn and falls back to a deterministic stub when neither is set. The catalog uses `is_stub_model` as a feature flag: with the stub, agents take their hand-written deterministic path; with a real provider, `chat-agent` forwards the conversation to the model, and `board-brief` / `task-drafting` / `task-estimation` polish their text fields via `model.with_structured_output(Schema, include_raw=True)` so the parsed output is a typed Pydantic payload (with token usage still reachable on the raw `AIMessage`). **Adding `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is the only change needed to flip the catalog from stubs to real LLM output in single-worker dev** — `langchain-anthropic` and `langchain-openai` are base dependencies, so no separate extra install is required. With a key set, `polish_triage` is also active, so all six agents now exercise the model on at least one path. Production-shaped deploys (Vercel, Render, Fly, Railway, Kubernetes) and any `WEB_CONCURRENCY` / `UVICORN_WORKERS` > 1 process additionally require Postgres-backed checkpointer/store and Redis-backed idempotency / rate-limit / budget for correct cross-worker behavior; the server warns if memory backends are left in place under those conditions. The remaining open code work (Vercel SSE truncation, MCP transport, vector store) is tracked in [`docs/ai-remaining-work.md`](docs/ai-remaining-work.md).

Supporting modules:

- `app/agents/llm.py` — provider factory (`anthropic` / `openai` / `stub`) + `extract_token_usage` / `estimate_text_tokens` helpers used by the budget tracker.
- `app/agents/embeddings.py` — embeddings provider factory (`openai` / `stub`) mirroring the chat-model factory; powers `task-estimation-agent`'s neighbour scoring via `be_tools.embed` (Tier 8). The OpenAI branch pins `dimensions=16` so swapping providers does not change the vector shape downstream.
- `app/agents/sse.py` — Server-Sent Events wire envelope translator; maps LangGraph `(mode, chunk)` tuples into the FE's `StreamPart` shape (`{type, ns, data}`), lifts `__interrupt__` payloads into typed `interrupt` events, and surfaces mid-stream errors.
- `app/tools/redaction.py` — server-side PII / secret redaction (`[EMAIL]`, `[SSN]`, `[CARD]`, `[SECRET]`).
- `app/tools/fe_tool_schemas.py` — JSON schema catalogue for FE-side read tools (`fe.boardSnapshot`, `fe.similarTasks`, ...). Agents pause via `langgraph.types.interrupt({"tool": ..., "args": ...})` and the FE resumes them via `Command(resume=...)`.
- `app/tools/be_tools.py` — `summarize` / `embed` / `embedding_neighbors` / `detect_drift` / `budget_check` helpers. `embed` routes through the configured embeddings provider (Tier 8) when one resolves and falls back to the deterministic SHA-256 stub on any provider exception; the wire shape is unchanged so existing callers stay green.
- `app/middleware/rate_limit.py` — per-agent, per-user token-bucket limiter that reads its quotas from `AgentMetadata.rate_limit` (one source of truth, PRD §5A.8).
- `app/middleware/budget.py` — per-project monthly token budget tracker; pre-call estimate via `estimate_text_tokens`, true-up after the call from provider-reported usage (PRD §5A.7 / §6.4).
- `app/store/namespaces.py` — tuple-based namespace conventions for the LangGraph long-term store.
- `app/auth/project_access.py` — per-project AI-disable allow-list driven by `AGENT_DISABLED_PROJECT_IDS` (PRD §6.3 / AC-V10).

The router wire format matches the FE `StreamPart` discriminator in `src/interfaces/agent.d.ts`:

```json
{"type": "updates"|"messages"|"custom"|"interrupt"|"error", "ns": ["..."], "data": ...}
```

`messages` chunks flatten LangChain `AIMessage` objects to `[{content, type}, metadata]`. Custom events use the FE's `kind` discriminator (`citation`, `usage`, `mutation_proposal`, `nudge`, `suggestion`). Token usage is summed across the stream and emitted as a final `{kind: "usage"}` envelope; per-stream totals are also debited against the project budget cap. Mid-stream failures are surfaced as `{type: "error", data: {message, recoverable}}` instead of dropping the connection silently.

MCP server wiring (`langchain-mcp-adapters`) is **deferred** to a follow-up commit. The named-agent catalog is MCP-ready (per-agent tool schemas via `AgentMetadata.tools` and the FE tool catalogue in `app/tools/fe_tool_schemas.py`), but the `streamable-http` MCP transport is not yet mounted at `/mcp`. Until then, every agent stays reachable through the existing `/api/v1/agents/{name}/{invoke,stream}` HTTP surface.

### Legacy `/api/ai/*` shim (v1 FE surfaces)

The shipped Board Copilot UI (Phases 0–4) posts JSON to `/api/ai/<route>`. Those endpoints live in `app/routers/ai.py` and call deterministic helpers in `app/services/v1_engine.py`; the chat route forwards to `chat-agent` so it shares the configured LLM. Every request goes through the same auth + redaction + project-disable + rate-limit + budget gates as the v2.1 endpoints. The v2.1 streaming surface remains the recommended path for new clients.

Every turn passes through four gates wired into the agents router:

- per-project AI-disable flag (`403 Forbidden`),
- per-agent rate limit, sourced from `AgentMetadata.rate_limit` (`429 Too Many Requests` + `Retry-After`),
- per-project monthly token budget — pre-booked from a prompt-length estimate, trued up after the call from the provider's reported usage (`402 Payment Required` + `X-Reason: budget`),
- per-agent `allowed_autonomy` validation (`403 Forbidden` when the request asks for an autonomy level the agent doesn't permit).

Mutating routes also honour an opt-in `Idempotency-Key` request header (Stripe-style). For `POST /api/v1/agents/{name}/invoke` and the `POST /api/ai/{...}` shim, the first 2xx response is cached and any retry with the same key + same body returns the cached response with an added `Idempotent-Replay: true` header — without re-running the agent or re-debiting the project budget. For the initial `POST /api/v1/agents/{name}/stream` request, a clean SSE completion stores a completion marker (`{"status": "stream_completed"}`) instead of the event stream, so a retry with the same key returns that marker as a replay. Resume requests bypass idempotency because LangGraph checkpoint state is the resume guard. A retry with the same key but a different body returns 422 (`idempotency_key_reused`); a request that arrives while a sibling with the same key is still in flight returns 409 (`idempotency_key_in_progress`). Failed handlers and errored streams release the reservation so a real retry can proceed. See `IDEMPOTENCY_BACKEND` / `IDEMPOTENCY_TTL_SECONDS` for backend and TTL configuration.

Beyond the gates, the router also enforces:

- `status="shadow"` agents are hidden from `GET /api/v1/agents` and 404 on direct lookup;
- `status="deprecated"` agents add an RFC 8594 `Deprecation: true` response header;
- a per-call `AGENT_REQUEST_TIMEOUT_SECONDS` cap (504 on `/invoke`, typed `error` envelope on `/stream`);
- cancel-on-disconnect on `/stream` so a closed SSE connection short-circuits the LangGraph run.

Inbound user text in `inputs.messages[*].content` (where `role == "user"`) and `inputs.prompt` is redacted server-side via `app/tools/redaction.py` before the agent receives it; the matched spans are recorded on `request.state.redaction_spans` so a future "What is shared?" panel can read them. Resume payloads passed via `command.resume` are also redacted recursively.

Agents resume from a LangGraph `interrupt()` by sending the next request as `{"command": {"resume": <value>}, "config": {"configurable": {"thread_id": <thread>}}}` — see PRD §5A.5. Resume requests with no configured checkpointer fail loudly with `AgentConfigurationError` instead of LangGraph's low-level error.

Configuration: see the [Configuration](#configuration) section above for the full env-var reference (`AGENT_CHECKPOINT_BACKEND`, `AGENT_STORE_BACKEND`, `AGENT_POSTGRES_URI`, `AGENT_DEFAULT_THREAD_ID`, `AGENT_RECURSION_LIMIT`, `AGENT_REQUEST_TIMEOUT_SECONDS`, `AGENT_DEFAULT_AUTONOMY`, `AGENT_DISABLED_PROJECT_IDS`, `AGENT_BUDGET_MONTHLY_TOKEN_CAP`, `AGENT_CHAT_MODEL_PROVIDER`, `AGENT_CHAT_MODEL_ID`, `AGENT_CHAT_MODEL_TEMPERATURE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`). Setting a provider key with `AGENT_CHAT_MODEL_PROVIDER=auto` is sufficient to flip the catalog from deterministic stubs to real LLM calls in single-worker dev; `langchain-anthropic` and `langchain-openai` are base dependencies so no extra install is required. Production-shaped or multi-worker deploys must additionally set `AGENT_CHECKPOINT_BACKEND=postgres`, `AGENT_STORE_BACKEND=postgres`, `IDEMPOTENCY_BACKEND=redis`, `RATE_LIMIT_BACKEND=redis`, `BUDGET_BACKEND=redis` (with `AGENT_POSTGRES_URI` and `REDIS_URI` populated) for correct cross-worker behavior. Current memory-backend detection warns in boot logs rather than refusing to boot.

### Observability — OpenTelemetry + Prometheus

`LANGSMITH_TRACING=true` is a single-vendor switch. Tier 9 adds a vendor-neutral path so operators can ship traces and metrics to whatever backend they already run (Datadog, Honeycomb, Tempo, Jaeger, Grafana Cloud) without per-vendor code changes. Both signals are opt-in; the dev / test paths and slim installs without the `[observability]` extra stay untouched.

- `OTEL_TRACING=true` installs an OpenTelemetry `TracerProvider` at lifespan startup. Every `runtime.ainvoke` / `runtime.astream` call emits a `agent.<name>.<operation>` span carrying the standard `gen_ai.*` semantic-convention attributes (`gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.response.model`) plus `app.project_id` / `app.autonomy` for tenant slicing. FastAPI requests are instrumented automatically. Exporter selection: when `OTEL_EXPORTER_OTLP_ENDPOINT` is set we ship to that OTLP/HTTP endpoint; otherwise we fall back to `ConsoleSpanExporter` (sane local-dev default that does not require a collector).
- `PROMETHEUS_METRICS=true` mounts `GET /metrics` and starts populating `agent_invocations_total{agent, outcome}` (outcome ∈ `success | error | timeout | rate_limited | budget_exhausted | replay`), `agent_tokens_total{agent, direction}`, `agent_run_duration_seconds{agent, outcome}` (latency histogram with buckets sized for typical agent runs), and `idempotency_cache_total{route, outcome}` (`hit | miss | mismatch | in_flight`). The `replay` outcome makes the Tier 7 `Idempotent-Replay: true` cache-hit ratio observable so operators can SLO on it.

Install: `python -m pip install ".[observability]"` (or `".[ai]"` to cover everything).
