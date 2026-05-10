# AI Architecture Review — Board Copilot Agents

> **Status (2026-05-05): partially superseded.** This review was written against
> Phase A state at 2026-05-01. Most blocking findings from the original review
> have since shipped: Postgres/Redis backends (F-1 through F-4), real LLM
> provider wiring and token counting (F-7/F-8), per-agent rate-limit from
> metadata (F-34), autonomy validation and shadow/deprecated enforcement
> (F-32/F-33), `is_project_ai_enabled` env config (F-29), and OpenTelemetry
> instrumentation (F-25). The executive summary statements that "the LLM layer
> is a stub", "tokens are charged at a flat 1-token-per-turn fee", and
> "`make_stub_chat_model` is the only model factory" no longer reflect the code.
> This file retains only the **still-open structural concerns**; do not act on
> any finding here without first verifying it has not shipped.
>
> For the operational, prioritized backlog, see `../../backend/docs/ai-remaining-work.md` items
> 7–12. This file is the structural counterpart.

**Original date**: 2026-05-01 — updated 2026-05-05
**Scope**: `app/agents/**`, `app/tools/**`, `app/middleware/`, `app/routers/agents.py`, `app/store/namespaces.py`, `app/auth/project_access.py`, `app/config.py`, `app/main.py`.

---

## Still-open structural concerns

### F-9 — No provider abstraction / fallback / hedging

Production agent platforms sit behind an AI gateway (LiteLLM, Portkey, Truefoundry) that handles fallback (Claude → GPT → Gemini), hedged requests, semantic caching, regional routing, and per-key budgets. The current code routes to a single provider; a 5xx bubbles straight to the client.

*Fix*: standardize on LiteLLM (open source) or Portkey (managed, richer budgets); both are OpenAI-compatible so wiring a `ChatOpenAI(base_url=...)` is sufficient. Configure failover policies for primary/secondary models.

---

### F-10 — No structured output validation

Catalog agents emit `AIMessage(content=json.dumps(...))` and clients do `json.loads`. Once an LLM replaces the deterministic stubs the schema will rot silently. The LangGraph 1.x pattern is `create_react_agent(..., response_format=Pydantic(ISchema))` (imported from `langgraph.prebuilt`), which uses provider-native JSON mode with a tool-call fallback. (LangChain 1.x does not export a top-level `create_agent` — see README.md for the import gotcha.)

*Fix*: define Pydantic schemas (`IBoardBrief`, `ITaskDraft`, `IReadinessReport`, `ITriageNudge`) under `app/agents/schemas/`. Use them as `response_format` on `create_react_agent` and as the contract for the SSE `messages` stream.

---

### F-12 — Catalog does not use the prebuilt ReAct agent

Five out of five catalog agents hand-build a `StateGraph` with linear `add_edge` chains. This is fine for fully deterministic work but misses tool binding, structured output, the prebuilt ReAct loop, and the message-history reducer that LangGraph 1.x ships.

*Fix*: rewrite `chat-agent`, `task-drafting-agent`, `task-estimation-agent`, and `triage-agent` on top of `create_react_agent` (from `langgraph.prebuilt`). Keep `board-brief-agent` as a custom graph if its node-by-node shape matters, and document why.

---

### F-13 — No multi-agent orchestration / hand-offs

`board-brief-agent` and `triage-agent` re-implement the same drift detection. There is no supervisor or swarm; agents cannot call each other. LangGraph supervisor / swarm and the `Command(goto=..., graph=Command.PARENT)` pattern are absent.

*Fix*: introduce a thin supervisor-style top-level agent that routes to the named agents based on intent. Replace duplicated drift logic with a single `drift-agent` that the others call as a subgraph.

---

### F-14 — No reflection or memory-driven adaptation

The store namespaces (`app/store/namespaces.py`) define `user_preferences`, `project_profile`, `user_project_facts`, `feedback`, but no agent reads or writes them. Agents are amnesic across threads.

*Fix*: add a `MemoryAgent` (or memory-writer node) that summarizes interactions into the appropriate namespace; pull relevant facts into the prompt at graph entry. LangMem is the obvious template.

---

### F-15 — MCP is deferred

The catalog has tool schemas in `app/tools/fe_tool_schemas.py` and per-agent `tools` tuples on `AgentMetadata`, but `langchain-mcp-adapters` is not in any dependency group and the `/mcp` mount point does not exist. In 2026, MCP-over-streamable-HTTP is table stakes for external client integration.

*Fix*: add `app/mcp.py` using `langchain-mcp-adapters`; mount a Streamable HTTP transport at `/mcp`; expose the read-only FE tools. Authenticate with OAuth 2.1 + PKCE + RFC 8707 Resource Indicators. See `../../backend/docs/ai-remaining-work.md` §7 for planned scope.

---

### F-18 / F-19 — No real embeddings or vector store

`app/tools/be_tools.py` `summarize` is a length-trim, not a semantic summary. Embeddings are SHA-256 hashes — two near-duplicate texts produce uncorrelated vectors. No persistent embedding store exists; `task-estimation-agent` ranks only on FE-supplied candidates. ~~The OpenAI embedding branch is hard-pinned to 16 dimensions for backward compat with the stub~~ — the 16-dim pin was lifted in `0e990e4` via `EMBEDDINGS_DIMENSIONS` (`app/config.py`); `app/agents/embeddings.py` passes it through to `OpenAIEmbeddings(dimensions=...)`. **The vector store / real RAG gap (F-19) remains open.**

*Fix*: define an `Embedder` protocol; rename `summarize` → `truncate_with_ellipsis`; add a real `summarize` backed by a `BaseChatModel`. Pick a vector store (`pgvector` is lowest-friction); `EMBEDDINGS_DIMENSIONS` is now configurable. See `../../backend/docs/ai-remaining-work.md` §8 for planned scope.

---

### F-43 — `BaseAgentState` carries static run-scoped data in State

`app/agents/state.py` `BaseAgentState` still includes `project_id`, `user_id`, `autonomy_level`. LangGraph 1.x guidance is unambiguous: static, read-only run-scoped data belongs in `Runtime[Context]`; only mutating values (messages, intermediate plans, tool outputs) belong in State. Today these fields (a) bloat every checkpoint, (b) make time-travel replays unsafe, and (c) defeat the point of `context_schema`.

*Fix*: define `BoardCopilotContext` (dataclass) with `user_id`, `project_id`, `tenant_id`, `autonomy_level`. Set it as `context_schema=` on every agent. Drop these fields from `BaseAgentState`. Pass via `runtime.ainvoke(..., context=ctx)`.

---

### F-42 — Test coverage gate incentivises the wrong tests

`pyproject.toml` `--cov-fail-under=100` is a strong signal — but a 100%-coverage suite that does not exercise real LLMs, real Redis, or real Postgres is a synthetic guarantee.

*Fix*: split into `unit` (100% gate, deterministic) and `integration` (real backends, must pass on PR but no coverage gate). Run integration in CI behind a feature flag. See `../../backend/docs/ai-remaining-work.md` §11 for planned scope.
