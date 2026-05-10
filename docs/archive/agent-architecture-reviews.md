# Agent Architecture Reviews — historical archive

Three structural reviews of the agent runtime were performed between
2026-05-01 and 2026-05-09. The 2026-05-08 and 2026-05-09 reviews shipped
in full and are retained here as the historical decision log; the
2026-05-01 review has a small set of **still-open** structural concerns
that are now mirrored in the active operational backlog.

| Review | Status (2026-05-10 re-verification) | Source of truth for open items |
|---|---|---|
| [2026-05-01](#review-1-2026-05-01--still-has-open-structural-concerns) | Partially superseded; remaining open items map to operations backlog | [`../status/release-todo.md`](../status/release-todo.md) §2, §4–§6, §15–§16; [`../status/architecture-todo.md`](../status/architecture-todo.md) Themes 5–6 |
| [2026-05-08](#review-2-2026-05-08--shipped-in-full) | Shipped (re-verified 2026-05-10); F-G2 and F-S5 deliberately deferred until consumers exist | n/a |
| [2026-05-09](#review-3-2026-05-09--shipped-in-full) | Phases 1–6 shipped (re-verified 2026-05-10); architectural follow-ups all resolved | n/a |

---

## Review 1: 2026-05-01 — still has open structural concerns

**Original date**: 2026-05-01 — updated 2026-05-05.
**Scope**: `app/agents/**`, `app/tools/**`, `app/middleware/`, `app/routers/agents.py`, `app/store/namespaces.py`, `app/auth/project_access.py`, `app/config.py`, `app/main.py`.

> **Status (2026-05-05): partially superseded.** Most blocking findings
> from the original review have shipped: Postgres/Redis backends (F-1
> through F-4), real LLM provider wiring and token counting (F-7/F-8),
> per-agent rate-limit from metadata (F-34), autonomy validation and
> shadow/deprecated enforcement (F-32/F-33), `is_project_ai_enabled`
> env config (F-29), and OpenTelemetry instrumentation (F-25). The
> executive-summary statements that "the LLM layer is a stub", "tokens
> are charged at a flat 1-token-per-turn fee", and "`make_stub_chat_model`
> is the only model factory" no longer reflect the code. Only the
> still-open structural concerns are retained below.

### F-9 — No provider abstraction / fallback / hedging

Production agent platforms sit behind an AI gateway (LiteLLM, Portkey,
Truefoundry) that handles fallback (Claude → GPT → Gemini), hedged
requests, semantic caching, regional routing, and per-key budgets. The
current code routes to a single provider; a 5xx bubbles straight to the
client.

*Fix*: standardize on LiteLLM (open source) or Portkey (managed,
richer budgets); both are OpenAI-compatible so wiring a
`ChatOpenAI(base_url=...)` is sufficient. Configure failover policies
for primary/secondary models. Tracked operationally as Beta Blocker §2
in [`../status/release-todo.md`](../status/release-todo.md).

### F-10 — No structured output validation

Catalog agents emit `AIMessage(content=json.dumps(...))` and clients
do `json.loads`. Once an LLM replaces the deterministic stubs the
schema will rot silently. The LangGraph 1.x pattern is
`create_react_agent(..., response_format=Pydantic(ISchema))`.

*Fix*: define Pydantic schemas (`IBoardBrief`, `ITaskDraft`,
`IReadinessReport`, `ITriageNudge`) under `app/agents/schemas/`. Use
them as `response_format` on `create_react_agent` and as the contract
for the SSE `messages` stream.

> **Partial 2026-05-10 fix:** per-surface Pydantic models with
> `extra="forbid"` shipped in `app/agents/events.py`; validation hook
> wired into `runtime.arun_with_events` and `astream`. Golden-transcript
> tests in `tests/test_agent_sse_transcripts.py` lock the wire shape.
> The `create_react_agent` migration (F-12) remains open.

### F-12 — Catalog does not use the prebuilt ReAct agent

Five out of five catalog agents hand-build a `StateGraph` with linear
`add_edge` chains. This is fine for fully deterministic work but
misses tool binding, structured output, the prebuilt ReAct loop, and
the message-history reducer that LangGraph 1.x ships.

*Fix*: rewrite `chat-agent`, `task-drafting-agent`,
`task-estimation-agent`, and `triage-agent` on top of
`create_react_agent` (from `langgraph.prebuilt`). Keep
`board-brief-agent` as a custom graph if its node-by-node shape
matters, and document why.

### F-13 — No multi-agent orchestration / hand-offs

`board-brief-agent` and `triage-agent` re-implement the same drift
detection. There is no supervisor or swarm; agents cannot call each
other. LangGraph supervisor / swarm and the
`Command(goto=..., graph=Command.PARENT)` pattern are absent.

*Fix*: introduce a thin supervisor-style top-level agent that routes
to the named agents based on intent. Replace duplicated drift logic
with a single `drift-agent` that the others call as a subgraph.

### F-14 — No reflection or memory-driven adaptation

The store namespaces (`app/store/namespaces.py`) define
`user_preferences`, `project_profile`, `user_project_facts`,
`feedback`, but no agent reads or writes them.

*Fix*: add a `MemoryAgent` (or memory-writer node) that summarizes
interactions into the appropriate namespace; pull relevant facts into
the prompt at graph entry. LangMem is the obvious template.

### F-15 — MCP is deferred

The catalog has tool schemas in `app/tools/fe_tool_schemas.py` and
per-agent `tools` tuples on `AgentMetadata`, but
`langchain-mcp-adapters` is not in any dependency group and the `/mcp`
mount point does not exist.

*Fix*: add `app/mcp.py` using `langchain-mcp-adapters`; mount a
Streamable HTTP transport at `/mcp`; expose the read-only FE tools.
Authenticate with OAuth 2.1 + PKCE + RFC 8707 Resource Indicators.
Tracked operationally as Polish §15 in
[`../status/release-todo.md`](../status/release-todo.md).

### F-18 / F-19 — No real embeddings or vector store

`app/tools/be_tools.py` `summarize` is a length-trim, not a semantic
summary. Embeddings are SHA-256 hashes — two near-duplicate texts
produce uncorrelated vectors. No persistent embedding store exists;
`task-estimation-agent` ranks only on FE-supplied candidates. The
16-dim pin was lifted in `0e990e4` via `EMBEDDINGS_DIMENSIONS`
(`app/config.py`); `app/agents/embeddings.py` passes it through to
`OpenAIEmbeddings(dimensions=...)`. **The vector store / real RAG gap
(F-19) remains open.**

*Fix*: define an `Embedder` protocol; rename `summarize` →
`truncate_with_ellipsis`; add a real `summarize` backed by a
`BaseChatModel`. Pick a vector store (`pgvector` is lowest-friction).
Tracked operationally as Soft Blocker §4 in
[`../status/release-todo.md`](../status/release-todo.md).

### F-43 — `BaseAgentState` carries static run-scoped data — **resolved 2026-05-10**

`project_id`, `user_id`, `autonomy_level` migrated from
`BaseAgentState` into `Runtime[Context]` per F-43. Smaller checkpoints,
safer time-travel.

### F-42 — Test coverage gate incentivises the wrong tests

`pyproject.toml` `--cov-fail-under=100` is a strong signal — but a
100%-coverage suite that does not exercise real LLMs, real Redis, or
real Postgres is a synthetic guarantee.

*Fix*: split into `unit` (100% gate, deterministic) and `integration`
(real backends, must pass on PR but no coverage gate). Run integration
in CI behind a feature flag. Tracked operationally as Beta Blocker §6
in [`../status/release-todo.md`](../status/release-todo.md).

---

## Review 2: 2026-05-08 — shipped in full

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`,
`app/middleware/limits/idempotency`. Staff-engineer-level review focused
on smartness (correctness), gracefulness (failure paths), scalability,
and maintainability.

**Status (2026-05-10 re-verification)**: every actionable finding
shipped. F-G2 (`RunContext`) and F-S5 (stub-branching unification)
remain deliberately deferred; both are conditional design seams with
no current consumer.

### Findings catalogue

Severity is engineering judgement — none of these are GA-blockers but
several were quietly doing the wrong thing.

#### Smartness / correctness

| ID | Finding | Severity | Status |
|---|---|---|---|
| F-S1 | Search agent shipped candidate `text` (user-authored task / project names) to the LLM without redaction. PII regression. | High | Shipped (`075684e`) |
| F-S2 | `astream` token aggregation only ran on the success branch; translated-exception paths silently recorded zero tokens. | Medium | Shipped (`075684e`) |
| F-S3 | Shadow-status agents were filtered at the router, not at the registry. Direct registry callers could invoke a shadow agent. | Medium | Shipped (`075684e`) |
| F-S4 | `BaseAgent.set_chat_model` after first `compile()` silently invalidated the cache. | Low | Shipped (`075684e`) |
| F-S5 | Stub-detection split across two patterns (`is_stub_model()` before vs inside `structured_llm_call()`). | Low | Deferred (see below) |

#### Gracefulness

| ID | Finding | Severity | Status |
|---|---|---|---|
| F-G1 | Triage agent emitted `{kind: "nudge"}` while every other agent emitted `{kind: "suggestion", surface: "..."}`. FE forked its discriminator. | Low | Shipped — standardised under `{kind: "suggestion", surface: "nudge"}` |
| F-G2 | No agent-level observability seam. Catalog nodes wanting to tag a span had to import `logging`. | Low | Deferred (see below) |

#### Scalability

| ID | Finding | Severity | Status |
|---|---|---|---|
| F-SC1 | Single-connection Postgres checkpointer / store. | Medium | Shipped — `AsyncConnectionPool` with `AGENT_PG_POOL_SIZE`; live smoke test gated by `PYTEST_AGENT_POSTGRES_URI` |
| F-SC2 | Limit enforcement re-serialised the whole request body to measure size. | Low | Shipped — `Content-Length` fast-path (`ffb7a41`) |
| F-SC3 | Module-level middleware singletons (`rate_limit.rate_limiter`, `budget.budget_tracker`). | Medium | Shipped — DI getters; routers consume via `Depends(...)`; production app owns instances on `app.state` |

#### Maintainability

| ID | Finding | Severity | Status |
|---|---|---|---|
| F-M1 | v1 shim hardcoded agent name strings in 9+ places. | Medium | Shipped — typed `LegacyAiRouteMeta` table |
| F-M2 | v1 shim imported `polish_*` helpers directly from catalog modules. | Medium | Partially shipped via shared route metadata; full single-dispatcher rewrite deferred (see "deferred" below) |
| F-M3 | Route-specific redaction field tuples in the router. | Medium | Shipped — `AgentMetadata.redactable_text_fields` / `redactable_dict_fields` (`d6b740a`) |
| F-M4 | Five catalog `_merge` functions duplicated ~80 lines of "validate parsed Pydantic, strip + cap each field, preserve fallback on blank". | Medium | Shipped — `app/agents/catalog/_shared.py` helpers (`5f871ba`) |
| F-M5 | Per-agent policy fields lacked documented rationale. | Low | Shipped — `AgentMetadata.rationale` map (`d6b740a`) |
| F-M6 | Idempotency keys included the URL path, not the logical operation identity. | Low | Shipped — `operation_id` parameter; canonical AI prefix |
| F-M7 | Magic `_INTERRUPT_KEY = "__interrupt__"` hardcoded in `app/agents/sse.py`. | Trace | Shipped — single-source comment with version-pin note |

### Deferred — F-S5 (stub-branching unification)

Chat uses `bind_tools` (not `with_structured_output`), has special
`asyncio.CancelledError` / `GeneratorExit` handling for client
disconnects, and has a stub-response-on-exception fallback that no
other agent has. A unified helper would have a callback signature
awkward enough that callers still effectively re-implement chat's
flow. The duplication is ~10 lines in one file. **Revisit if** a
second non-structured agent appears with the same shape.

### Deferred — F-G2 (`RunContext` for graph-node observability)

Additive but plumbing-heavy. LangGraph's context is a typed schema
per agent; adding a shared `RunContext` either forces every agent's
context schema to inherit from a base or requires a sidecar (e.g. a
contextvar). No agent currently *needs* this seam. **Revisit when**
a catalog agent first asks for a tracing seam — ship it with an
actual node-level span attribute or metric so the context propagation
design is exercised end-to-end.

---

## Review 3: 2026-05-09 — shipped in full

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`,
`app/services/v1_engine.py`, supporting middleware. Staff-engineer-level
structural review and forward-looking restructuring plan.

**Status (2026-05-10 re-verification)**: every Phase 1–6 row, every
architectural follow-up, and every latent defect listed shipped.

### Context

Three years of evolution had accreted parallel paths and cross-cutting
leaks: agents reached into HTTP/streaming concerns, routers reached
into agent internals, and "deterministic stub vs real model"
branching was duplicated in every catalog module, every polish
helper, the v1 engine, and the v1 shim. Adding a seventh agent
required touching at least eight files; adding a seventh v1 route
copied ~100 lines of scaffolding. This review identified twelve
structural design issues (A–L) and a six-phase remediation plan.

### Design issues (A–L)

- **A. Two parallel agent execution paths.** `routers/ai.py` was a
  *second* runtime: it imported polish helpers directly, reached into
  the registry for the model, re-ran `v1_engine.py` deterministic
  logic that overlapped with each agent's own deterministic baseline,
  and duplicated citation building.
- **B. `AgentMetadata` was a kitchen sink** for HTTP redaction policy,
  middleware quotas, autonomy validation, and the FE tool catalog —
  all on a static dataclass.
- **C. Catalog agents performed side-effects through a thread-local
  global.** `emit_custom`/`emit_usage` silently no-op'd outside a
  stream context, so `/invoke` JSON couldn't see the suggestions the
  agents produced.
- **D. "Deterministic stub vs real model" was a system-wide branch.**
  Three layers each duplicated the same fallback ladder.
- **E. Per-route HTTP boilerplate.** Six v1 routes each repeated
  ~80 lines of auth → meta lookup → idempotency → gates → polish.
- **F. Graph build bound the chat model in a closure.**
  `BaseAgent.build` was called once and the resulting `Pregel` closed
  over `self.chat_model`, making per-request model overrides
  impossible without a full recompile.
- **G. Process-wide singletons and import-time registration.** Module
  globals blocked per-tenant configurations, in-memory hot-reload,
  and test isolation; auto-discovery silently degraded on import
  failures.
- **H. State schemas had no composition.** `BoardBriefState` and
  `TriageState` both declared `board_snapshot` / `drift_result`
  with no shared mixin.
- **I. Token usage was reconciled in three places** (catalog event,
  SSE router scrape, runtime end-of-state aggregation, v1 shim
  reconciliation).
- **J. FE-tool catalog was duplicated** across `_chat_tools.py` and
  `fe_tool_schemas.py` with no compile-time link.
- **K. `_namespaced_thread` did string-level security.**
  `runtime.py` iteratively stripped `{agent}:{any_segment}:` prefixes
  from a client-supplied `thread_id` to prevent prefix-injection.
- **L. Auto-discovery was implicit and silent.** A `SyntaxError` or
  missing dependency in any module was logged once and silently
  dropped from the registry.

### Phased outcome

| Phase | Targets | Outcome |
|---|---|---|
| **1.** Collapse the v1 shim onto the agent runtime | A, C, D | Shipped: `runtime.arun_with_events` returns `(state, custom_events)`; all 7 `/api/ai/*` routes migrated to it; `polish_*` helpers privatised; `app/services/v1_engine.py` deleted (helpers absorbed into catalog modules). Byte-shape parity tests in `tests/test_v1_ai_shim_parity.py`. |
| **2.** Make agent outputs first-class, not side-effects | C, I, F-G2 | Shipped: `events: Annotated[list[dict], add_events]` field on `BaseAgentState`; typed Pydantic models in `app/agents/events.py`; six catalog modules return `{"events": [...]}` from nodes; runtime re-emits state-delta events for SSE wire continuity; token usage flows through `messages[*].usage_metadata`. |
| **3.** PolishStep DSL | D, F-S5 | Shipped: `app/agents/polish.py` with `PolishStep` (prompt builder, schema, fallback, redaction, cap, merge); `_polish_headline` / `polish_triage` / `_polish_draft` / `_polish_rationale` / `_polish_readiness` / `_polish_search` migrated; `structured_llm_call` retired. |
| **4.** Decouple model resolution from graph compilation | F | Shipped: `app/agents/context.py` with `ChatContext(TypedDict)`; runtime resolves model per call (caller-supplied `context["chat_model"]` overrides; otherwise falls back to `agent.chat_model`); six catalog nodes read the model via `get_runtime(ChatContext).context.chat_model`. `X-Pulse-Model` header gated by `AGENT_CHAT_MODEL_ALLOWLIST`. |
| **5.** Linear-pipeline scaffolding for graphs and HTTP | E, H | Shipped: `app/agents/pipeline.py` `linear_graph(...)`; five linear catalog agents migrated; `WithBoardSnapshot` / `WithDriftResult` / `WithSimilarTasks` mixins; `app/routers/_dispatch.py:run_v1_route` factory collapses the five structured v1 routes to thin handlers. |
| **6.** Hardening | G, J, K, L | Shipped: explicit catalog manifest replaces import-time `registry.register(...)` side-effects (broken modules now FATAL at lifespan startup); single FE-tool source of truth (`CHAT_TOOL_SCHEMAS`); signed thread keys (`sigv1.<base64>` HMAC-SHA256, with `sigv2.` envelope for kid-based rotation via `AGENT_THREAD_SIGNING_KEYS`); `app.state.embeddings` populated at lifespan startup. |

### Architectural follow-ups (all resolved)

- **Per-app registry isolation** — `AgentRuntime.from_settings*`
  constructs a per-app `ChainedAgentRegistry` (writes go local; reads
  fall through to the module-level `default_registry`).
- **Build-cache invalidation race** — `BaseAgent.compile` /
  `acompile` use double-checked locking with two layers
  (`asyncio.Lock` for async waiters, `threading.Lock` held briefly
  for cache-field writes); cache hits take neither lock.
- **`_chat_tools.py` partial single-source** — `build_chat_tools()` is
  now a real data-driven generator that builds each LangChain tool
  stub directly from the schema entry.
- **`X-Pulse-Model` header / tenant-config routing** — gated by
  `AGENT_CHAT_MODEL_ALLOWLIST`; allowlisted ids are built via
  `make_chat_model_for_id()` and injected as `context["chat_model"]`.
- **`_shared.py` final cleanup** — `cap_polished_text` and
  `merge_keyed_string_updates` now live canonically in
  `app/agents/polish.py`; `_shared.py` only re-exports them.

### Latent defects (all resolved)

- **`_dispatch.py` `UnboundLocalError` on null fallback** — pre-init
  pattern + `agent_unavailable` 502 (PR #173).
- **Cross-user signed thread token surfaces as 5xx** —
  `_namespaced_thread` catches `ValueError` and re-raises a dedicated
  `InvalidThreadKeyError` (4xx-mapped, PR #173).
- **No JWT secret rotation strategy for signed thread tokens** —
  `sigv2.<base64url>` envelope with embedded `kid` selecting from
  `AGENT_THREAD_SIGNING_KEYS`. Verification accepts both prefixes
  during rolling restarts.
- **`PolishStep.cap_text` parameter dead** — removed; `cap_field`
  shorthand is the only supported form.
- **Triage polish token leak** — `generate_nudges` discarded the
  polish raw `AIMessage`; fixed by prepending the raw message to
  `state["messages"]` (`9285e51`).

### Deferred

- **F-G2 (`RunContext`)** — schedule when a catalog agent first asks
  for a tracing seam.
- **F-S5 (stub-branching unification)** — revisit if a second
  non-structured agent appears with the same `bind_tools`,
  cancellation, and stub-fallback shape as `chat`.
