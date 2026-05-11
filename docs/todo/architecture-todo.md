# Architecture todo — agent runtime (closure snapshot)

Forward-looking themes for the Board Copilot agent runtime
(FastAPI + LangGraph + React SSE).

**Audience:** engineers extending Board Copilot v2.1 (FastAPI + LangGraph + React SSE).  
**Grounding:** structural backlog in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md), operational items in [`release-todo.md`](release-todo.md), product contract in [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md).

## Status — architecture backlog complete (2026-05-11)

All former theme action rows are **dispositioned**: shipped on the integration baseline,
explicitly deferred (archive docs), or folded into [`release-todo.md`](release-todo.md)
GA wording where product gates remain (§1 organic LLM coverage). **Do not treat the
tables in historical reviews as an actionable checklist** — open net-new work with a
fresh backlog entry.

**Integration baseline (merge of verified branches):** branch
`orch/architecture-todo-impl-9ea4/integrate-architecture-backlog-closeout` — Theme 5
mutation lifecycle commits merged with `close-remaining-architecture-themes`.

**Verification evidence (prefer logs over inline totals):**

| Scope | Evidence |
| --- | --- |
| Integration merge sanity (post-merge baseline) | [`verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md`](verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md) |
| Themes 2–4 / 6 FE–BE hygiene + full Jest command transcript | [`../verification/close-remaining-architecture-themes-verifier-036a.log`](../verification/close-remaining-architecture-themes-verifier-036a.log) |
| Theme 6 depth deferrals | [`../archive/architecture-theme6-deferred.md`](../archive/architecture-theme6-deferred.md) |
| Theme 4 FE resume depth deferrals | [`../archive/architecture-theme4-fe-deferred.md`](../archive/architecture-theme4-fe-deferred.md) |

---

## Current architecture (concise)

The Pulse backend ships six LangGraph-based agents behind v1 JSON (`/api/ai/*`) and v2.1
SSE (`/api/v1/agents/*`). The runtime owns idempotency, redaction, rate limiting, budgets,
OpenTelemetry, Prometheus, and Postgres-backed checkpointing when configured. Structural
review phases through 2026-05-10 are summarized in
[`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).

---

## Theme disposition reference

### Theme 1 — Contract hardening — **closed on baseline**

Shipped: Pydantic payload models with `extra="forbid"` and validation hooks in
`backend/app/agents/events.py` (`validate_suggestion_payload`); golden SSE transcript
tests in `backend/tests/test_agent_sse_transcripts.py`. Typed error envelope parity on
the FE remains centralized in `src/utils/ai/mapErrorResponse.ts`. **Machine verification**
for transcript tests: follow the backend recipe in [`release-todo.md`](release-todo.md)
(`python -m pytest`); the Theme 5 verifier run focused on mutation lifecycle pytests.

### Theme 2 — Stream error handling — **closed on baseline**

Shipped: mid-stream HTTP/SSE transport coercion (`408`/`504` mapping and
`coerceAgentTransportError` wiring into the SSE consumer), with unit coverage in
`src/utils/ai/mapErrorResponse.test.ts`. Heartbeat / stall UX polish stays ordinary FE
backlog — not an architecture-row blocker.

### Theme 3 — Frontend surface simplification — **closed on baseline**

Shipped: metadata-driven autonomy allow-list + clamp (`useAiEnabled`, tests in
`useAiEnabled.autonomy.test.tsx`); `AiChatDrawer` respects `allowed_autonomy` and gates
`auto` on `environment.aiMutationProposalsEnabled`; stable effect dependencies in
`useAgentChat` keyed on concrete callbacks / ids rather than whole hook objects where
required by review.

Further decomposition of `useAgent` beyond shipped extractions (`useAgentStreamConsumer`,
`useAgentToolResolver`, `useNudgeInbox`) is normal refactor backlog — see
[`product-done.md`](product-done.md).

### Theme 4 — Durable resume / state — **closed with documented deferrals**

Shipped: `thread_id` continuity helpers in `useAgent`; backend multi-worker Redis guards
([`release-todo.md`](release-todo.md) §16d); operator runbook
[`../operations/agent-stream-resume.md`](../operations/agent-stream-resume.md).

Deferred (explicit rationale): optional multi-tab policy + persistence of extra resume
handles beyond thread id — [`../archive/architecture-theme4-fe-deferred.md`](../archive/architecture-theme4-fe-deferred.md).

### Theme 5 — Mutation lifecycle — **architecture theme closed; GA §1 partially gated**

Shipped on baseline: LangGraph `mutation_hitl` stub path (`__PROPOSE_MUTATION__` with stub
LLM), `custom/mutation_proposal` emission, `fe.applyMutation` interrupt plumbing,
accept/reject resume behavior, `mutation_applied_ids` idempotency guard in graph tests
(`backend/tests/test_chat_mutation_lifecycle.py`), mutation journal + undo HTTP surface
(wire-up from `src/utils/ai/feTools/applyMutation.ts`).

**Remaining product gate** (tracked in [`release-todo.md`](release-todo.md) §1): organic
(non-stub) chat sessions emitting proposals, broader HTTP/Mongo verification for
`agents/mutations/record|undo`, and optional Jest coverage for `applyMutationTool.run`.

### Theme 6 — Backend intelligence & resilience — **closed (depth deferred)**

Shipped baseline capabilities remain per [`release-todo.md`](release-todo.md) (§2 failover,
§4 pgvector path, §15 MCP mount, §16c model merge). Hedging beyond failover, full
production embeddings ranking depth, ReAct/supervisor/memory expansions — deferred with
rationale in [`../archive/architecture-theme6-deferred.md`](../archive/architecture-theme6-deferred.md).

---

## Priority stack (historical — retained for planning literacy)

1. Contract hardening  
2. Stream error handling  
3. Mutation lifecycle closure  
4. Durable resume/state  
5. Frontend surface simplification  
6. Backend intelligence & resilience  

New work should cite current [`release-todo.md`](release-todo.md) gates rather than this ordering alone.

---

## Phased execution (historical map)

| Phase | Scope |
| --- | --- |
| A — Contract & errors | Schemas, SSE/error normalization, transcripts |
| B — Mutations & governance | Mutation lifecycle, audit hooks |
| C — Resume & state hygiene | Thread continuity, operator docs |
| D — FE simplification | Hook stabilization, adapters |
| E — Intelligence & resilience | Gateway, vector depth, orchestration |

---

## Metrics (lightweight)

- Contract: staging validation pass rate on emitted payloads.  
- Streams: TTFT / interrupt latency; client-initiated `reset()` anomalies.  
- Mutations: proposal → accept → apply funnel.  
- Resilience: failover success rate after provider errors.

---

## References

- [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md) — findings **F-9–F-15**, **F-42–F-43**.  
- [`release-todo.md`](release-todo.md) — GA / beta / polish tiers.  
- [`product-done.md`](product-done.md) — shipped inventory lines.
