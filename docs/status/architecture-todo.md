# Architecture todo — agent runtime roadmap

Forward-looking themes for the Board Copilot agent runtime
(FastAPI + LangGraph + React SSE).

**Audience:** engineers extending Board Copilot v2.1 (FastAPI + LangGraph + React SSE).  
**Grounding:** structural backlog in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md), operational items in [`release-todo.md`](release-todo.md), product contract in [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md).  
**Goal:** turn “streaming agents work” into **predictable contracts**, **recoverable sessions**, **fewer FE dual-paths**, and **production-grade intelligence/resilience** — without expanding scope into unrelated UX polish (see [`ui-todo.md`](ui-todo.md)).

## Current architecture (2026-05-11)

The Pulse backend ships six LangGraph-based agents (`board-brief`, `triage`, `task-drafting`, `task-estimation`, `chat`, `search`) behind two HTTP surfaces: the v1 deterministic JSON shim (`/api/ai/*`) and the v2.1 SSE surface (`/api/v1/agents/*`). The agent runtime owns idempotency, redaction, rate limiting, monthly token budgets, OpenTelemetry, Prometheus, and Postgres-backed checkpointing. Six structural review phases shipped between 2026-05-08 and 2026-05-10 (see [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md) for the measured outcome): events as first-class state, a `PolishStep` DSL replacing per-agent ad-hoc polish flows, model resolution decoupled from graph compilation via `Runtime[Context]`, a linear-pipeline scaffold for the five linear catalog agents and a shared HTTP-route factory, an explicit catalog manifest, and signed thread keys with rotation. **Release posture (2026-05-11):** only **GA Blocker §1** (`MutationProposal` accept + undo) remains an open *code* gate in [`release-todo.md`](release-todo.md); Beta §2/§3/§6, soft §4/§5/§7, and polish through §16e are **closed in repo** subject to operator env / backfill notes there. Themes below are the architectural backlog on top of that posture: **Theme 5** is the planned implementation path for §1; **Themes 1–4** are contracts, FE ergonomics, and resume hygiene; **Theme 6** is optional intelligence / resilience depth (not additional numbered release rows now that §2/§4/§15/§16c shipped).

## Status — 2026-05-11 (reconciled vs `main`)

**Shipped earlier (2026-05-10 and before, now on `main`; evidence consolidated in [`product-done.md`](product-done.md) / numbered rows in [`release-todo.md`](release-todo.md)):**

- **Theme 1:** per-surface Pydantic schemas with `extra="forbid"` (`backend/app/agents/events.py:48–155`), validation hook in the runtime (`validate_suggestion_payload` at `events.py:207–249`), and golden SSE transcript tests for all six agents (`backend/tests/test_agent_sse_transcripts.py`).
- **Theme 2:** normalized `AgentStatus` derived from existing hook state; `rateLimit` mid-stream envelopes now map to `AgentRateLimitError`.
- **Theme 4:** `threadId` persisted in `sessionStorage` per `(agent, projectId)` (helpers + `useState` initializer in `src/utils/hooks/useAgent.ts` ~195–310); F-43 context migration (`project_id` / `user_id` / `autonomy_level` moved off `BaseAgentState` onto `ChatContext`).

**Verified against `main` (2026-05-11):**

- **Theme 3:** `useAgent.ts` is **853** lines (`wc -l`); the SSE consumer loop lives in `src/utils/hooks/useAgentStreamConsumer.ts` (`forEachAgentStreamPart`). Nudge inbox + FE-tool resolver extractions remain as in [`product-done.md`](product-done.md). [`release-todo.md`](release-todo.md) **§16b** is **closed** — further splitting (shared SSE adapter, thinner domain-event layer) is normal FE backlog, not a polish-row blocker.
- **Theme 4 — verified 2026-05-11:** [`release-todo.md`](release-todo.md) **§16d** is **closed** — `_configure_middleware_backends` **raises** if `UVICORN_WORKERS` / `WEB_CONCURRENCY` > 1 unless rate-limit, budget, and idempotency backends are all `redis` with `REDIS_URI` (`backend/tests/test_production_backend_guards.py`). Remaining Theme 4 work is **FE** thread/resume continuity and operator runbooks, not “remove the single-worker default before Redis exists.”
- **Theme 6 — verified 2026-05-11:** **No** `TODO` / `FIXME` / `XXX` markers under `backend/app/` (`rg`, case-sensitive). Per-project / header chat-model merge **shipped** ([`release-todo.md`](release-todo.md) **§16c**; `chat_model_override_from_request`, `AGENT_PROJECT_CHAT_MODEL_MAP`, tests `test_dispatch_chat_context_merge.py`, `test_agents_request_context_merge.py`). `_build_context` documents resolution order in `backend/app/agents/runtime.py` (caller `chat_model` from dispatch wins before the agent default).

**FE source TODO inventory (2026-05-11):** a single intentional **v3** tracker — the `AUTONOMY_OPTIONS` docblock in `src/components/aiChatDrawer/index.tsx` (~303–316) describing hard-disabled `auto` until mutation lifecycle + preapproved tools land; `CopilotAboutPopover` carries **no** `TODO` (knowledge cutoff + limits use `microcopy` + `useChatAgentMetadata` per [`release-todo.md`](release-todo.md) §14).

### Workstreams — immediate vs later

- **Immediate (GA-adjacent):** **Theme 5** / [`release-todo.md`](release-todo.md) **§1** — end-to-end `MutationProposal` emission, `fe.applyMutation` / resume, and undo surface the FE toast can call. Keep `MutationProposalCard` behind `environment.aiMutationProposalsEnabled` until §1 closes (per release doc).
- **Immediate (FE hygiene, same release train):** **Theme 3** — sweep `useAgent` consumers per `AGENTS.md` (stable effect deps); metadata-driven autonomy options beyond the About popover once §1 + v3 tool contracts exist (coordinates with `aiChatDrawer` v3 comment above).
- **Later (post-GA or continuous improvement):** **Theme 1–2** residual contract/error hardening; **Theme 4** cross-tab resume policy and support-facing idempotency docs; **Theme 6** depth (operator embeddings backfill under §4, gateway hedging beyond shipped failover, richer orchestration) without inventing new release-tier rows — see theme tables and [`release-todo.md`](release-todo.md) for what already shipped.

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

**Gates:** — **[§5](release-todo.md) closed 2026-05-10** (`PolishStep` JSON-schema path). Remaining Theme 1 work stays important for drift prevention: finish per-output wire schemas, version bumps, and any `create_react_agent(response_format=...)` / graph polish migrations not yet uniform across catalog agents.

| Action                                                                                                                                        | Rationale                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Define **Pydantic wire schemas** per agent output (`IBoardBrief`, drafts, estimate/readiness bundle, nudges) and validate before SSE emission | Matches review **F-10**; prevents silent JSON drift when LLMs replace stubs.                                     |
| Align **OpenAPI / agent metadata** with emitted events; bump **`AgentMetadata.version`** when payloads change                                 | Gives FE a supported deprecation window (PRD §5).                                                                |
| Single **error envelope** everywhere (`{"error": {"code","message"}}`); document legacy paths once and schedule removal                       | FE already dual-reads; narrow the compatibility surface over time.                                               |
| Contract tests: **golden SSE transcripts** (or snapshot parses) per agent in CI                                                               | Catches ordering/regression in `messages` / `custom/*` events without flaky LLM calls (deterministic stub mode). |

**Exit criteria:** Any breaking payload change fails CI or bumps agent version with an intentional FE companion PR.

---

## Theme 2 — Stream error handling

**Gates:** — (engineering quality; no direct release-tier dependency).

| Action                                                                                                                     | Rationale                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Normalize **client-visible states**: connecting → streaming → interrupted → terminal (`completed` / `error` / `cancelled`) | Matches user mental model; simplifies drawers and analytics.                       |
| Map **HTTP/SSE failures** to existing typed errors (`budget`, `forbidden`, `rateLimit`, `server`) with stable `code`       | Already partially shipped; extend to mid-stream parse failures and proxy timeouts. |
| **Retry policy:** idempotent POST + `Idempotency-Key` on initial stream open; no double mutation on resume                 | Pairs with idempotency replay semantics on the server.                             |
| **Heartbeat / stall detection** on long interrupt waits (FE tool approval, network blips) with explicit user messaging     | Reduces “stuck spinner” reports on serverless edges.                               |

**Exit criteria:** Every failure mode has one UX affordance (retry, wait, contact admin, or disable AI) and matching telemetry reason codes.

---

## Theme 3 — Frontend surface simplification

**Gates:** GA Blocker [§1](release-todo.md) for the `MutationProposalCard` rollout only (FE flag stays off until §1 closes). **[§16b](release-todo.md) closed** — stream consumer extracted to `useAgentStreamConsumer.ts`; remaining rows below are FE engineering backlog, not a polish-blocker row.

| Action                                                                                                                            | Rationale                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Decompose `useAgent.ts` further (after §16b consumer extraction).** `useAgentStreamConsumer` now owns the per-chunk loop; remaining scope is a thinner boundary between transport parsing and domain state (shared adapter for `useAgent` / `useAgentChat`), plus clearing duplication in suggestion/nudge reducers. | AC-V14 nudge inbox lives in `useNudgeInbox`; FE-tool resolution in `useAgentToolResolver`; `useAgent` still bundles thread id, TTFT, autonomy guardrails, and wiring — see [`product-done.md`](product-done.md) §16b notes. |
| **Isolate stable callbacks** from streaming identity churn in `useAgent` consumers (effects must not depend on whole hook return) | Documented anti-pattern in repo `AGENTS.md`; sweep chat, brief, assist panel, search.      |
| **Thin adapter layer** over SSE parser → domain events → UI state                                                                 | Limits duplicated parsing between `useAgent`, `useAgentChat`, and future shells.           |
| Reduce **`useAi` vs `useAgent`** divergence where behavior is identical (keep local-engine fallback, centralize switching)        | Lowers duplicate validators and bug surface; preserves `REACT_APP_AI_USE_LOCAL`.           |
| Guard `MutationProposalCard` and autonomy surfaces behind explicit env/capability checks until the backend lifecycle is real      | Already flagged in `AGENTS.md` / `release-todo.md` — formalize as a rollout gate. |
| **Finish autonomy capability gating.** `useAutonomyLevel` has persistence + cross-window sync and `AiChatDrawer` now exposes `suggest` / `plan` with `auto` disabled. Move the control into the broader settings surface when that ships and gate available values from backend `AgentMetadata.allowed_autonomy` instead of hardcoded FE options. | The user-visible picker exists, but the backend metadata that would keep it honest is still unused; future agents could advertise a different autonomy set without the UI adapting. |

**Exit criteria:** No component triggers duplicate agent `start()` loops on benign parent re-renders; structured routes share one parsing/validation path into React state.

---

## Theme 4 — Durable resume / state

**Gates:** — **[§16d](release-todo.md) closed** (multi-worker requires Redis rate/budget/idempotency + `REDIS_URI`; see `test_production_backend_guards.py`). **[§17](release-todo.md) closed** (F-43 / `ChatContext`). Remaining Theme 4 items are **FE** resume continuity, cross-tab policy, and support runbooks — no additional numbered release gate.

| Action                                                                                                                   | Rationale                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Thread **`thread_id` / checkpoint** continuity across refresh and optional multi-tab policy (single writer vs broadcast) | Postgres checkpointing is useless if the FE always mints a fresh thread. |
| FE **persist minimal resume handles** (e.g., thread id, last interrupt id) scoped per project/user session               | Enables “Continue last agent turn” after accidental reload.              |
| Document **idempotency replay** vs **fresh stream** decision tree for support tooling                                    | Clarifies 409/422/`stream_completed` responses already on `/stream`.     |
| **Operate multi-worker / multi-instance with coherent quotas.** Redis-backed rate-limit, budget, and idempotency (`backend/app/middleware/redis_backends.py`) are **required** when `UVICORN_WORKERS` / `WEB_CONCURRENCY` > 1 ([§16d](release-todo.md) closed — boot **raises** otherwise). Operator work: set `RATE_LIMIT_BACKEND`, `BUDGET_BACKEND`, `IDEMPOTENCY_BACKEND` to `redis` with a real `REDIS_URI`, then replay/idempotency smoke before turning workers up. | Horizontal scale still prefers one worker per container with Redis; memory backends are dev/single-instance only. |

**Exit criteria:** User can reload mid-interrupt and either resume cleanly or see an explicit “session expired” with recovery steps — never silent loss or duplicate apply.

---

## Theme 5 — Mutation lifecycle closure

**Gates:** GA Blocker [§1](release-todo.md) — this theme is the architectural plan that closes §1.

| Action                                                                                                                             | Rationale                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Implement server **`custom/mutation_proposal`** emission + FE **`fe.applyMutation`** (or equivalent) interrupt contract end-to-end | Backlog explicitly tracks GA blocker in [`release-todo.md`](release-todo.md).                                            |
| Wire **accept/reject** to LangGraph **`Command(resume=…)`** with persisted proposal ids                                            | Ensures graph continues after human decision.                                                              |
| Add **audit log / analytics** for accepted mutations; define **server undo** semantics behind the 10s toast                       | FE-side `AGENT_PROPOSAL_UNDONE` now fires from `MutationProposalCard`; the open work is the BE accept/apply/undo lifecycle that makes the toast reversible end-to-end. |
| **Autonomy gates:** Suggest / Plan / Auto must map to enforceable server checks, not UI-only                                       | Aligns with PRD §6 and shadow-mode story.                                                                  |

**Exit criteria:** Acceptance tests cover full loop: proposal → approve → mutation applied → idempotent replay does not re-apply.

---

## Theme 6 — Backend intelligence & resilience

**Gates:** — **[§2](release-todo.md), [§4](release-todo.md), [§15](release-todo.md), [§16c](release-todo.md) closed in repo** (cross-provider failover baseline, optional pgvector augmentation path behind env, MCP `/mcp` mount, per-project map + `X-Pulse-Model` merge). Remaining Theme 6 rows are **depth** (hedging beyond the shipped fallback, production embeddings **backfill** under §4 notes, fuller ReAct / supervisor patterns) — follow [`release-todo.md`](release-todo.md) for operator caveats, not new numbered blockers.

| Action                                                                                                                        | Rationale                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Provider resilience (beyond §2):** hedged requests / richer routing (**F-9**)                                              | §2 ships `with_fallbacks` between configured vendors (`tests/test_llm_failover.py`); this row is extra hedging LiteLLM/Portkey-style products may add. |
| **Real embeddings + vector store** (`pgvector` or managed) — retire stub semantics for production ranking (**F-18/F-19**) | Code path + DDL exist ([`release-todo.md`](release-todo.md) §4); ranking depth still depends on operator **backfill** + dimension alignment.                  |
| **`create_react_agent` migration** where appropriate (**F-12**)                                                               | Buys tool loops + structured output hooks consistently.                          |
| **Supervisor / shared subgraph** for duplicated drift logic (**F-13**)                                                        | Shrinks catalog maintenance cost — only after single-agent contracts are stable. |
| **Memory namespaces:** read/write paths for `user_preferences`, `project_profile`, etc. (**F-14**)                            | Optional Differentiator once observability proves safe use of store data.        |
| **MCP usage expansion** (**F-15**)                                                                                            | Transport ships when `MCP_ENABLED=true` ([§15](release-todo.md)); read-only `fe.*` today — broader tool exposure stays out of scope until GA §1 patterns exist.           |
| **Per-project / header chat model merge**                                                                                     | **Complete** ([§16c](release-todo.md)): `AGENT_PROJECT_CHAT_MODEL_MAP`, `chat_model_override_from_request` / `X-Pulse-Model` + `AGENT_CHAT_MODEL_ALLOWLIST`, tests `test_dispatch_chat_context_merge.py` + `test_agents_request_context_merge.py`; `_build_context` documents stack order in `backend/app/agents/runtime.py`. |

**Exit criteria:** Production config runs with non-stub embeddings dimensions, documented failover policy, and integration tests that hit gateway mocks / staged providers.

---

## Phased execution

| Phase                             | Scope                                                                                   | Dependencies                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| **A — Contract & errors**         | Schemas F-10, SSE/error normalization, golden transcripts, FE typed-error completeness  | None                                          |
| **B — Mutations & governance**    | Full `MutationProposal` lifecycle, audit, autonomy enforcement hooks                    | Phase A error + resume clarity                |
| **C — Resume & state hygiene**    | FE thread continuity; resume handles; refresh/tab policy                                | Phase B for mutation replay safety            |
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
