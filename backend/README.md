# pulse — backend

FastAPI port of `jira-express-server`. Six LangGraph-based AI agents
ship alongside standard CRUD routes. Default database is MongoDB; AI
features fall back to deterministic stubs when no LLM API key is set.

For the full HTTP reference (auth, projects, boards, tasks, AI v1
shim, v2.1 agents SSE) see
[`../docs/api/backend.md`](../docs/api/backend.md). For the binding
v2.1 agent / wire contract see
[`../docs/prd/v2.1-agent.md`](../docs/prd/v2.1-agent.md).

## Routes (summary)

The server exposes the same `/api/v1/` prefix as the Express app:

- `POST /api/v1/auth/{register,login}`
- `GET|PUT /api/v1/users` plus `/users/members`, `/users/likes`
- `GET|POST|PUT|DELETE /api/v1/projects`
- `GET|POST|PUT|DELETE /api/v1/boards` plus `/boards/orders`
- `GET|POST|PUT|DELETE /api/v1/tasks` plus `/tasks/orders`
- `GET /api/v1/agents`, `GET /api/v1/agents/{name}`
- `POST /api/v1/agents/{name}/invoke`
- `POST /api/v1/agents/{name}/stream` (Server-Sent Events; FE-shaped `StreamPart` envelope)
- `POST /api/ai/{task-draft,task-breakdown,estimate,readiness,board-brief,search,chat}` (legacy v1 shim)

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ".[dev]"
cp .env.example .env
```

Set `MONGO_URI` / `MONGO_DB` in `.env`, then run:

```bash
uvicorn app.main:app --reload --port 8000
```

`langchain-anthropic` and `langchain-openai` are base dependencies —
setting `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is the only step
needed to enable real LLM calls in single-worker dev. Optional
extras:

```bash
python -m pip install ".[postgres-agents]"  # AsyncPostgresSaver/Store for AGENT_*_BACKEND=postgres
python -m pip install ".[redis]"            # Redis-backed idempotency / rate-limit / budget backends
python -m pip install ".[observability]"    # OpenTelemetry SDK + Prometheus client
python -m pip install ".[ai]"               # all of the above
```

The full env-var reference (database, auth, agent runtime, middleware
backends, observability, LLM providers, budgets) lives in
[`../docs/operations/deployment.md`](../docs/operations/deployment.md).

## Local git hooks

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

## Deployment

The repo ships a production Dockerfile, `fly.toml` (default Fly app
`pulse-backend` — rename before deploy), and a `docker-compose.yml`
that brings up the server alongside Postgres + Mongo for parity with a
Tier-1 production deploy. See
[`../docs/operations/deployment.md`](../docs/operations/deployment.md)
for the full target-by-target guide (Vercel limits, Fly.io, Render,
ECS / Cloud Run / Container Apps, dedicated uvicorn behind nginx),
the production checklist, and post-deploy verification.

GA blockers, soft blockers, and the recommended internal-beta →
design-partner → public-ship sequence live in
[`../docs/todo/release-todo.md`](../docs/todo/release-todo.md).

Local end-to-end against the same persistence stack production uses:

```bash
docker compose up --build
```

## Agent runtime

The application ships with an agent runtime built on
[LangGraph](https://github.com/langchain-ai/langgraph)
(`langgraph>=1.1,<2`, the v1.x API line). Six agents are registered
automatically from `app/agents/catalog/` at startup:
`board-brief-agent`, `task-drafting-agent`, `task-estimation-agent`,
`chat-agent`, `triage-agent`, and `search-agent`. For each agent's
purpose, the wire-format details, the four request gates (project
opt-out, rate limit, budget, autonomy), idempotency replay, redaction,
SSE wire format, and observability (OpenTelemetry / Prometheus /
LangSmith), see
[`../docs/prd/v2.1-agent.md`](../docs/prd/v2.1-agent.md). Open
architectural work (provider gateway, vector store / RAG, MCP mount,
mutation lifecycle, supervisor / shared subgraph) is tracked in
[`../docs/todo/architecture-todo.md`](../docs/todo/architecture-todo.md)
and operationally in
[`../docs/todo/release-todo.md`](../docs/todo/release-todo.md).

### Adding a new agent

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

Drop the file at `app/agents/catalog/my_agent.py` and the catalog
auto-discovery imports it on startup. For the common ReAct case,
return a graph compiled from
`langgraph.prebuilt.create_react_agent(...)`.
