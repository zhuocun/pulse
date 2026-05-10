# Architecture todo — agent runtime roadmap

Forward-looking themes for the Board Copilot agent runtime
(FastAPI + LangGraph + React SSE).

**Audience:** engineers extending Board Copilot v2.1 (FastAPI + LangGraph + React SSE).  
**Grounding:** structural backlog in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md), operational items in [`release-todo.md`](release-todo.md), product contract in [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md).  
**Goal:** turn “streaming agents work” into **predictable contracts**, **recoverable sessions**, **fewer FE dual-paths**, and **production-grade intelligence/resilience** — without expanding scope into unrelated UX polish (see [`ui-todo.md`](ui-todo.md)).

## Current architecture (2026-05-10)

The Pulse backend ships six LangGraph-based agents (`board-brief`, `triage`, `task-drafting`, `task-estimation`, `chat`, `search`) behind two HTTP surfaces: the v1 deterministic JSON shim (`/api/ai/*`) and the v2.1 SSE surface (`/api/v1/agents/*`). The agent runtime owns idempotency, redaction, rate limiting, monthly token budgets, OpenTelemetry, Prometheus, and Postgres-backed checkpointing. Six structural review phases shipped between 2026-05-08 and 2026-05-10 (see [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md) for the measured outcome): events as first-class state, a `PolishStep` DSL replacing per-agent ad-hoc polish flows, model resolution decoupled from graph compilation via `Runtime[Context]`, a linear-pipeline scaffold for the five linear catalog agents and a shared HTTP-route factory, an explicit catalog manifest, and signed thread keys with rotation. Outstanding architectural gaps tracked below as Themes 5–6 (mutation lifecycle, provider gateway, real RAG, supervisor / shared subgraph, MCP) and operationally in [`release-todo.md`](release-todo.md) (GA Blocker §1, Beta Blockers §2/§3/§6, Soft Blocker §4, Polish §15–§16).

## Status — 2026-05-10 (PR #177)

The tractable single-day items across Themes 1, 2, and 4 shipped on `claude/complete-subagent-orchestrator-fUazo`. Specifically:

- **Theme 1:** per-surface Pydantic schemas with `extra="forbid"`, validation hook in the runtime, and golden SSE transcript tests for all six agents.
- **Theme 2:** normalized `AgentStatus` derived from existing hook state; `rateLimit` mid-stream envelopes now map to `AgentRateLimitError`.
- **Theme 4:** `threadId` persisted in `sessionStorage` per `(agent, projectId)`; F-43 context migration (`project_id` / `user_id` / `autonomy_level` moved off `BaseAgentState` onto `ChatContext`).

Open: Theme 3 (FE surface simplification sweep), Theme 5 (full mutation lifecycle), Theme 6 (provider gateway, vector store / RAG, `create_react_agent` migration, supervisor, MCP). See [`release-todo.md`](release-todo.md) for the per-item severity / status.

---

## Priority stack (do this order)

1. **Contract hardening** — stale schemas silently break clients; cheapest wins are schema validation + version bumps + FE regression tests.
2. **Stream error handling** — users hit flakes before they hit missing features; classify failures and make retry/idempotency behavior consistent end-to-end.
3. **Mutation lifecycle closure** — proposals today are a GA risk (`MutationProposal` accept path must resume into a real tool + audit trail).
4. **Durable resume/state** — checkpoint/idempotency backends exist; **cross-tab reload**, **explicit resume UX**, and **LangGraph `Runtime[Context]` vs bloated state** complete the story.
5. **Frontend surface simplification** — reduce dual `useAi`/`useAgent` divergence where safe; stabilize hook dependencies and effect-driven starts (see repo `AGENTS.md`).
6. **Backend intelligence & resilience** — structured outputs, provider hedging, real RAG/embeddings, optional orchestration — **after** the stack above is trustworthy.

---

## Theme 1 — Contract hardening

| Action                                                                                                                                        | Rationale                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Define **Pydantic wire schemas** per agent output (`IBoardBrief`, drafts, estimate/readiness bundle, nudges) and validate before SSE emission | Matches review **F-10**; prevents silent JSON drift when LLMs replace stubs.                                     |
| Align **OpenAPI / agent metadata** with emitted events; bump **`AgentMetadata.version`** when payloads change                                 | Gives FE a supported deprecation window (PRD §5).                                                                |
| Single **error envelope** everywhere (`{"error": {"code","message"}}`); document legacy paths once and schedule removal                       | FE already dual-reads; narrow the compatibility surface over time.                                               |
| Contract tests: **golden SSE transcripts** (or snapshot parses) per agent in CI                                                               | Catches ordering/regression in `messages` / `custom/*` events without flaky LLM calls (deterministic stub mode). |

**Exit criteria:** Any breaking payload change fails CI or bumps agent version with an intentional FE companion PR.

---

## Theme 2 — Stream error handling

| Action                                                                                                                     | Rationale                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Normalize **client-visible states**: connecting → streaming → interrupted → terminal (`completed` / `error` / `cancelled`) | Matches user mental model; simplifies drawers and analytics.                       |
| Map **HTTP/SSE failures** to existing typed errors (`budget`, `forbidden`, `rateLimit`, `server`) with stable `code`       | Already partially shipped; extend to mid-stream parse failures and proxy timeouts. |
| **Retry policy:** idempotent POST + `Idempotency-Key` on initial stream open; no double mutation on resume                 | Pairs with idempotency replay semantics on the server.                             |
| **Heartbeat / stall detection** on long interrupt waits (FE tool approval, network blips) with explicit user messaging     | Reduces “stuck spinner” reports on serverless edges.                               |

**Exit criteria:** Every failure mode has one UX affordance (retry, wait, contact admin, or disable AI) and matching telemetry reason codes.

---

## Theme 3 — Frontend surface simplification

| Action                                                                                                                            | Rationale                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Isolate stable callbacks** from streaming identity churn in `useAgent` consumers (effects must not depend on whole hook return) | Documented anti-pattern in repo `AGENTS.md`; sweep chat, brief, assist panel, search.      |
| **Thin adapter layer** over SSE parser → domain events → UI state                                                                 | Limits duplicated parsing between `useAgent`, `useAgentChat`, and future shells.           |
| Reduce **`useAi` vs `useAgent`** divergence where behavior is identical (keep local-engine fallback, centralize switching)        | Lowers duplicate validators and bug surface; preserves `REACT_APP_AI_USE_LOCAL`.           |
| Guard `MutationProposalCard` and autonomy surfaces behind explicit env/capability checks until the backend lifecycle is real      | Already flagged in `AGENTS.md` / production readiness notes — formalize as a rollout gate. |

**Exit criteria:** No component triggers duplicate agent `start()` loops on benign parent re-renders; structured routes share one parsing/validation path into React state.

---

## Theme 4 — Durable resume / state

| Action                                                                                                                   | Rationale                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Thread **`thread_id` / checkpoint** continuity across refresh and optional multi-tab policy (single writer vs broadcast) | Postgres checkpointing is useless if the FE always mints a fresh thread. |
| FE **persist minimal resume handles** (e.g., thread id, last interrupt id) scoped per project/user session               | Enables “Continue last agent turn” after accidental reload.              |
| Migrate **static run context** out of `BaseAgentState` into **`Runtime[Context]`**                                       | Review **F-43** — smaller checkpoints, safer replay.                     |
| Document **idempotency replay** vs **fresh stream** decision tree for support tooling                                    | Clarifies 409/422/`stream_completed` responses already on `/stream`.     |

**Exit criteria:** User can reload mid-interrupt and either resume cleanly or see an explicit “session expired” with recovery steps — never silent loss or duplicate apply.

---

## Theme 5 — Mutation lifecycle closure

| Action                                                                                                                             | Rationale                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Implement server **`custom/mutation_proposal`** emission + FE **`fe.applyMutation`** (or equivalent) interrupt contract end-to-end | Backlog explicitly tracks GA blocker in [`release-todo.md`](release-todo.md).                                            |
| Wire **accept/reject** to LangGraph **`Command(resume=…)`** with persisted proposal ids                                            | Ensures graph continues after human decision.                                                              |
| Add **audit log / analytics** for accepted mutations; define **undo** semantics (10s toast vs server undo endpoint)                | Progress doc notes missing `AGENT_PROPOSAL_UNDONE` path — pick one product rule and implement both halves. |
| **Autonomy gates:** Suggest / Plan / Auto must map to enforceable server checks, not UI-only                                       | Aligns with PRD §6 and shadow-mode story.                                                                  |

**Exit criteria:** Acceptance tests cover full loop: proposal → approve → mutation applied → idempotent replay does not re-apply.

---

## Theme 6 — Backend intelligence & resilience

| Action                                                                                                                        | Rationale                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Provider gateway:** LiteLLM/Portkey-style failover + hedged requests (**F-9**)                                              | Converts intermittent 5xx into degraded quality, not hard failure.               |
| **Real embeddings + vector store** (`pgvector` or managed) — retire SHA stub semantics for production ranking (**F-18/F-19**) | Unlocks search and estimation quality beyond FE candidate caps.                  |
| **`create_react_agent` migration** where appropriate (**F-12**)                                                               | Buys tool loops + structured output hooks consistently.                          |
| **Supervisor / shared subgraph** for duplicated drift logic (**F-13**)                                                        | Shrinks catalog maintenance cost — only after single-agent contracts are stable. |
| **Memory namespaces:** read/write paths for `user_preferences`, `project_profile`, etc. (**F-14**)                            | Optional Differentiator once observability proves safe use of store data.        |
| **MCP mount** (**F-15**)                                                                                                      | External integration track — parallel, not blocking core product loop.           |

**Exit criteria:** Production config runs with non-stub embeddings dimensions, documented failover policy, and integration tests that hit gateway mocks / staged providers.

---

## Phased execution

| Phase                             | Scope                                                                                   | Dependencies                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **A — Contract & errors**         | Schemas F-10, SSE/error normalization, golden transcripts, FE typed-error completeness  | None                                          |
| **B — Mutations & governance**    | Full `MutationProposal` lifecycle, audit, autonomy enforcement hooks                    | Phase A error + resume clarity                |
| **C — Resume & state hygiene**    | FE thread continuity; **F-43** context migration; refresh/tab policy                    | Phase B for mutation replay safety            |
| **D — FE simplification**         | Hook stabilization sweep, shared SSE adapter, reduce dual-path drift                    | Phases A–C reduce refactor churn              |
| **E — Intelligence & resilience** | Gateway F-9, vector store F-19, ReAct migration F-12, orchestration F-13/F-14, MCP F-15 | Stable contracts from A; durable state from C |

Workstreams **D** and parts of **E** can proceed in parallel once **A** lands; **B** should not start behind unvalidated schemas.

---

## Metrics (lightweight)

- **Contract:** % of agent responses passing schema validation in staging (target 100%).
- **Streams:** p95 time-to-first-token / interrupt-resolution latency; rate of unexplained client `reset()` calls.
- **Mutations:** proposals shown vs accepted vs failed resume (funnel).
- **Resilience:** provider 5xx → successful retry or fallback rate post-gateway.

---

## References

- [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md) — structural findings **F-9–F-15**, **F-42–F-43**.
- [`release-todo.md`](release-todo.md) — GA blockers, soft blockers, polish, readiness tiers.
- [`product-done.md`](product-done.md) — shipped vs deferred FE/BE features.
