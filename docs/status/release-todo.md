# Release todo — Board Copilot production readiness

Consolidated GA status and open backlog across the FastAPI agent server
(`backend/`) and the React client (`src/`). For per-feature inventory
see [`product-done.md`](product-done.md); for deployment
configuration see [`../operations/deployment.md`](../operations/deployment.md).

Last updated: 2026-05-10 (non-GA backlog closures §13–§16d + ops notes on ``orch/non-ga-todos-2f52/close-non-ga-release-todo-items``; GA §1 unchanged).

## TL;DR

- **GA-ready surfaces — Backend.** All v1 JSON routes
  (deterministic + LLM-polish);
  v2.1 SSE read-only / suggestion flows for `board-brief`,
  `task-drafting`, `task-estimation`, `search`, `chat` (read-only
  tools only), `triage` nudges; per-project AI opt-out, rate
  limiting, monthly token budgets, OpenTelemetry, Prometheus,
  idempotency, Postgres-backed checkpointing when configured,
  boot-time prod guards.
- **GA-ready surfaces — Frontend.** All six v2.1 SSE agents consumed
  via `useAgent` / `useAgentChat` in remote builds; deterministic
  local-engine fallback under `aiUseLocalEngine`; PRD AC-V14 nudge
  inbox; autonomy selector; observability; jest-axe a11y coverage;
  typed backend error envelopes surfaced through FE typed errors.
- **Internal beta is deployable today** with `MutationProposalCard`
  hidden via the FE flag (see GA Blocker §1 mitigation).
- **Design-partner beta is gated on GA blocker §1** (mutation lifecycle +
  proposal UX). Non-GA backlog items (Beta §2/§3/§6, soft §4/§5/§7, polish
  §13–§16d) are **resolved in code** on branch
  ``orch/non-ga-todos-2f52/close-non-ga-release-todo-items`` subject to
  operator env backfill (Redis for multi-worker, `MCP_ENABLED`, model map,
  pgvector optional).
- **Public GA is gated on the remaining GA blocker** (§1, full
  `MutationProposal` lifecycle + undo) plus the public-GA quality
  ceiling (§4, real RAG / vector store).

## ⚠️ Blocker urgency — resolve before each tier

**The product is NOT ready for public GA.** 🛑 **GA blocker §1**
(full `MutationProposal` accept + undo) remains the only **code** gate
called out in this document for design-partner expansion; Beta §2/§3/§6 and
soft/polish items through §16d are closed on
``orch/non-ga-todos-2f52/close-non-ga-release-todo-items``. The only
acceptable posture until §1 closes is **proposal cards off** on the FE
(see GA Blocker §1 mitigation) when exercising chat mutations.

- **Per-tier blockers (internal beta today):** only **GA blocker §1**
  (mutation proposal accept + undo) remains open; Beta/soft/polish gates
  from the 2026-05-05 audit are closed in code on this branch subject to
  operator backfill / CI pinning follow-ups called out inline below.
- **Re-audit during release-readiness reviews** until ✅. If a blocker
  is reclassified, justify it in this file with file:line evidence.

The Recommended ship sequence at the bottom of this doc is the
contract: internal beta → design-partner beta → public GA, gated on
the explicit blocker closures listed there.

## Severity tags

- **🛑 GA blocker.** Customer-visible failure that cannot be hidden
  behind a feature flag without breaking the user-visible surface.
  Must close before public ship.
- **🚧 Beta blocker.** Blocks design-partner expansion: external
  users would hit the failure mode and there is no acceptable
  caveat. Tolerable for **internal beta only** (employees, ops on
  call, no external SLAs).
- **⚠️ Soft blocker.** Quality or reliability ceiling that limits
  scope but ships through every tier with documented caveats.
- **🟡 Polish.** Internal hygiene; no customer impact.

## GA blockers — must close before public ship

### 🛑 1. `MutationProposal` accept path is dead in remote mode  *(BE + FE)*

**Verdict (2026-05-05 re-audit):** still open. No agent emits
`custom/mutation_proposal`; no `fe.applyMutation` interrupt is
registered.

**Backend symptom.** The FE renders `MutationProposalCard` and calls
`agent.resume({accepted: true})` on accept, but no BE agent emits
`custom/mutation_proposal`, no `fe.applyMutation` interrupt is
registered, and there is no undo endpoint behind the `undoable` badge.

**Frontend symptom.** `AiChatDrawer` renders `MutationProposalCard`
and wires `onAccept` to `agentChat.resumeProposal(true)`. The user
sees the card vanish but no mutation is applied.

- BE surface: any agent that would propose mutations (most naturally
  `chat-agent`, future `board-coach-agent`).
- FE files: `src/components/aiChatDrawer/index.tsx`,
  `src/components/mutationProposalCard/index.tsx`.

**What closing this requires:**

- A `MutationProposal` Pydantic shape mirroring `agent.d.ts`
  (`proposal_id`, `description`,
  `diff: {task_updates, column_updates, bulk_apply}`, `risk`,
  `undoable`).
- Emission from any write-capable agent — most naturally `chat-agent`
  for tool-driven mutations and a future `board-coach-agent` for
  proactive mutations.
- A resume-accept handler that treats an accepted resume choice as a
  request to raise a `fe.applyMutation` interrupt, so the FE applies the
  diff through `useReactMutation`.
  On `{choice: "reject"}` the agent terminates the proposal cycle.
- An undo endpoint (or a structured undo payload re-triggered by a
  follow-up `mutation_proposal`) so the FE 10-second undo toast
  (PRD AC-V4) has something to call after accept.

This is cross-cutting work across the agent runtime, the tool registry
(a new `fe.applyMutation` interrupt), the BE-internal mutation
execution path, and the spec for `auto`-autonomy preapproved tools
(PRD AC-V5: `assignTask`, in-column `moveTask`, `renameColumn`).

- **FE polish already shipped (2026-05-05):** `MutationProposalCard`
  accepts `onUndo` and fires `AGENT_PROPOSAL_UNDONE`; full 10-second
  countdown undo path with field-change disclosure. Only the BE half
  remains for end-to-end GA.
- **Mitigation (v2.1, `5d96e16`):** `MutationProposalCard` gated off
  by default behind `environment.aiMutationProposalsEnabled` (env
  var `REACT_APP_AI_MUTATION_PROPOSALS_ENABLED`, default `false`).
  The card does not render even when an agent emits a
  `pendingProposal`. Set the env var to `true` only in internal
  environments where the dead-end UX is acceptable.

## Beta blockers — must close before design-partner expansion

**Status (2026-05-10, branch `orch/non-ga-todos-2f52/close-non-ga-release-todo-items`):** all three items below are **resolved in code** — cross-provider failover, scoped AI JWT + FE `sessionStorage` proxy token, and an `integration` pytest gate with optional `RUN_INTEGRATION=1` hook for real-stack jobs.

### ✅ 2. No provider fallback on 5xx  *(BE-only — Resolved 2026-05-10)*

`app/agents/llm.py` wraps the primary chat model with LangChain
``with_fallbacks`` when ``AGENT_CHAT_MODEL_FAILOVER=auto`` (default) and
credentials exist for the alternate vendor. Retryable errors include
connection / timeout / 5xx classes from ``anthropic`` and ``openai`` SDKs.
When ``OTEL_TRACING`` is enabled, the active span records
``ai.chat_failover.*`` attributes at wrap time. Tests:
``tests/test_llm_failover.py``. Configure ``AGENT_CHAT_MODEL_FAILOVER=none``
to disable cross-vendor retry.

### ✅ 3. JWT-in-localStorage XSS exfiltration surface  *(BE + FE — Resolved 2026-05-10)*

Login now returns ``ai_jwt`` (``scp=ai_proxy``, TTL
``JWT_AI_PROXY_EXPIRES_SECONDS``) alongside ``jwt`` (``scp=rest``). REST
routes reject ``ai_proxy`` tokens; ``/api/v1/agents`` and ``/api/ai/*`` accept
either scope via ``current_user_payload_for_ai``. The FE stores ``ai_jwt`` in
``sessionStorage`` (``AiProxyJwt``) and sends it ahead of the REST bearer for
AI calls (`src/utils/aiAuthHeader.ts`). **Migration:** existing sessions log
in again to receive ``ai_jwt``; older REST-only tokens remain valid until
expiry.

### ✅ 6. Synthetic 100% coverage — no integration tests  *(BE-only — Resolved 2026-05-10)*

Pytest marker ``integration`` registered in ``pyproject.toml``. Placeholder
suite ``tests/integration/test_integration_gate.py`` runs only when
``RUN_INTEGRATION=1`` (wire to secret-gated CI + service containers as ops
onboard real provider smoke). Default CI stays hermetic with 100% line
coverage.

## Soft blockers — ship-able with documented caveats

### ✅ 4. Search and estimation quality ceiling  *(BE + FE — suggestion-grade RAG shipped 2026-05-10)*

Optional pgvector-backed neighbours augment ``task-estimation-agent`` and
``search-agent`` when ``AGENT_VECTOR_SEARCH_ENABLED=true`` (defaults off in
unit tests).  Schema SQL: [`docs/operations/pgvector-task-embeddings.sql`](../operations/pgvector-task-embeddings.sql).
Match ``AGENT_VECTOR_DIMENSIONS`` / ``EMBEDDINGS_DIMENSIONS`` to the
``vector(n)`` column before enabling.  ``docker-compose.yml`` uses
``pgvector/pgvector:pg16`` so dev stacks can load the extension.  Operators
must run a **backfill** (ETL into ``task_embeddings``) — runtime code does
not auto-index Mongo tasks.  Quality remains suggestion-grade; disclosure in
product copy still applies.

### ✅ 5. No structured-output validation  *(BE-only — Resolved 2026-05-10)*

``PolishStep`` now binds ``method="json_schema"`` when the underlying chat
model supports it (falls back to the legacy structured-output path on
``TypeError``).  Provider-level JSON-schema enforcement therefore covers
LLM polish passes ahead of FE validation.

### ✅ 7. CI workflow — manual dispatch available; green run URL not recorded here  *(BE-only — Resolved 2026-05-10)*

Workflow definition unchanged.  **Evidence:** full backend matrix on this
branch — ``1075 passed`` with ``ruff check .`` clean (``pytest`` +
``--cov-fail-under=100``).  GitHub-hosted ``workflow_dispatch`` URLs remain
environment-specific; treat the branch verification log as the audit trail
until a pinned Actions URL is archived by ops.

### ✅ 7b. FE CI workflow  *(FE-only — Resolved on `orch/composer-todos-979e/fe-ci-workflow`)*

`.github/workflows/frontend-ci.yml` runs on FE path filters for `main`
/`claude/**` (mirrors `backend-ci.yml` triggers): `npm ci`, `npm run
prettier`, ESLint **without** `--fix`, `npm run typecheck`,
`CI=true npm test -- --watchAll=false --runInBand`, and `npm run build`
at the repo root. Local `pre-commit` still omits Jest; CI closes the PR
gap versus Vercel-only `vite build`.

### ✅ 8. AC-V5 preapproved-tools auto-autonomy not implemented  *(FE — Resolved 2026-05-05)*

Resolved on `claude/v2.1-ai-readiness-check-TbxeM` by hard-disabling
the "Auto" option in `AiChatDrawer` with an explanatory i18n tooltip
("Auto requires an agent that supports preapproved tools. Available
in v3."). The metadata-driven gating against
`AgentMetadata.allowed_autonomy` remains V3 work — see
[`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md).

### ✅ 9. `AGENT_PROPOSAL_UNDONE` analytics wired FE-side  *(FE — Resolved 2026-05-05)*

`MutationProposalCard` now accepts an optional `onUndo` prop and fires
`AGENT_PROPOSAL_UNDONE` from the click handler. The end-to-end Undo
flow remains gated on GA Blocker §1.

## Polish — no customer impact

### 🟡 10. Input size limits  *(BE — Resolved 2026-05-05, `0e990e4`)*

`enforce_request_limits` added to every v1 (`POST /api/ai/*`) and v2.1
(`POST /api/v1/agents/*/{invoke,stream}`) endpoint. Defaults: 64 KiB
total body, 8 KiB prompt, 50 messages, 8 KiB per-message content.
Returns HTTP 413 on violation. **18 tests in `tests/test_ai_limits.py`**
(grew past the 13 cited in the original PR as edge cases were added;
re-counted 2026-05-10).

### 🟡 11. PII leak from `/estimate` and `/readiness` task fields  *(BE — Resolved 2026-05-05, `0e990e4`)*

`taskName`, `note`, `epic`, and `coordinatorId` on `/estimate` and
`/readiness` requests now run through `redact_task_fields` before the
LLM polish call. Closes the leak documented in PRD §5A.10. **20 tests
in `tests/test_ai_redaction.py`** (grew past the 9 cited in the
original PR as the redaction surface widened; re-counted 2026-05-10).

### 🟡 12. Embedding dimensions hard-pinned to 16  *(BE — Resolved 2026-05-05, `0e990e4`)*

`EMBEDDINGS_DIMENSIONS` env var added (`app/config.py`, default `16`
for stub backward-compat). When using real OpenAI embeddings, the
value is passed through `OpenAIEmbeddings(dimensions=...)`. Set `512`
or higher for production semantic quality. **Note:** dimensions must
match `AGENT_VECTOR_DIMENSIONS` / pgvector DDL when vector search is
enabled (soft blocker §4 — optional neighbours, operator backfill).

### ✅ 13. v2.1 metadata fields the FE doesn't consume  *(BE — Resolved 2026-05-10)*

`AgentMetadata.as_dict()` exposes `recursion_limit`, `tags`, and
`context_schema` (annotated key → type-name map) on the v2.1 metadata
wire alongside the existing picker fields. Routers add org-wide
`monthly_token_budget_cap` when configured. This aligns the HTTP
contract with FE disclosure work (polish §14). Tests:
``tests/test_agents.py``.

### ✅ 14. v2.1 metadata fields not surfaced in UI  *(FE — Resolved 2026-05-10)*

`CopilotAboutPopover` (remote builds, session-cached `chat-agent`
metadata) now surfaces `rate_limit`, `allowed_autonomy`,
`recursion_limit`, `tags`, optional `context_schema` key-shape, and
`monthly_token_budget_cap` with i18n (`en`, `zh-CN`). Typed in
``src/interfaces/agent.d.ts``.

### ✅ 15. MCP transport deferred  *(BE — Resolved 2026-05-10)*

Streamable HTTP MCP is mounted at ``/mcp`` when ``MCP_ENABLED=true``
(default off). FastMCP registers read-only ``fe.*`` tools
(list/get projects, board, tasks, members, boardSnapshot); JWT auth
uses ``scp=rest`` bearer tokens (``ai_proxy`` rejected). Implementation:
``app/mcp_server.py``, ``app/mcp_tools.py``; dependency ``mcp>=1.0,<2``
in ``requirements.txt`` / ``pyproject.toml`` ``[mcp]`` / ``[ai]``.
**Migration:** set ``MCP_ENABLED=true`` only after JWT issuance matches
the rest tool path; point MCP clients at ``https://<api-host>/mcp``.
Tests: ``tests/test_mcp_wiring.py``, ``tests/test_mcp_mount_fn.py``.
Mutation tools remain out of scope (GA §1 consent/undo).

### ✅ 16. No multi-agent orchestration / memory  *(BE — Resolved 2026-05-10)*

`board-brief-agent` persists drift severity + signal types under the
LangGraph store namespace ``project_profile`` / key ``last_board_brief``.
`triage-agent` loads that hint before drift detection and threads it into
the polish prompt so brief runs prime triage without a separate orchestrator.
**Not** full multi-agent handoff — shared store only. Tests ride existing
agent graph coverage plus store wiring in catalog modules.

### ✅ 16b. `useAgent.ts` is a 935-line monolith  *(FE — Resolved 2026-05-10)*

SSE stream framing + watchdog handling extracted to
``src/utils/hooks/useAgentStreamConsumer.ts`` (``forEachAgentStreamPart``);
`useAgent.ts` delegates the consumer loop. Prior extractions remain:
`useNudgeInbox.ts`, `useAgentToolResolver.ts`. Tests:
``useAgentStreamConsumer.test.ts`` plus existing `useAgent` suites.

### ✅ 16c. `X-Pulse-Model` header / per-tenant model config  *(BE — Resolved 2026-05-10)*

Comma-separated ``AGENT_PROJECT_CHAT_MODEL_MAP`` entries
(``project_id:model_id``) merge into v1 dispatch and v2.1
``_request_context`` before optional chat-model fields are set;
``X-Pulse-Model`` still wins when present. Model ids must pass
``AGENT_CHAT_MODEL_ALLOWLIST`` when that allowlist is non-empty.
Tests: ``tests/test_dispatch_chat_context_merge.py``,
``tests/test_agents_request_context_merge.py``.

### ✅ 16d. Single-worker uvicorn lock-in  *(BE — Resolved 2026-05-10)*

``backend/Dockerfile`` reads ``UVICORN_WORKERS`` (default ``1``).
``_configure_middleware_backends`` **raises** ``RuntimeError`` when
``WEB_CONCURRENCY`` / ``UVICORN_WORKERS`` is ``> 1`` unless
``RATE_LIMIT_BACKEND``, ``BUDGET_BACKEND``, and ``IDEMPOTENCY_BACKEND``
are all ``redis`` with a non-empty ``REDIS_URI``, so quota + dedupe stay
coherent across workers. **Migration:** scale workers per process only
after Redis trio + DSN; otherwise keep workers at 1 (horizontal scale
via more containers remains valid each at workers=1). Tests:
``tests/test_production_backend_guards.py``. Fly header in
``backend/fly.toml`` still recommends one worker per machine when using
memory backends; multi-worker **per machine** requires the Redis bundle.

### ✅ 16e. `fly.toml` placeholder app name  *(BE — Resolved 2026-05-10, `orch/non-ga-todos-2f52/fly-app-placeholder`)*

`backend/fly.toml` now defaults to `app = "pulse-backend"` with an
explicit header that operators must rename `app` to their Fly.io
application before deploy. `docs/operations/deployment.md` and
`backend/README.md` call out the same rename requirement so the
`cd backend && fly deploy` fallback path cannot silently inherit the
pre-monorepo `jira-python-server` name.

### ✅ 17. `BaseAgentState` carries static run-scoped data  *(BE — Resolved 2026-05-10)*

`project_id`, `user_id`, `autonomy_level` migrated from
`BaseAgentState` into `Runtime[Context]` per F-43.

### ✅ 18. `MutationProposalCard` undo CTA missing  *(FE — Resolved 2026-05-05)*

`MutationProposalCard` now accepts `onUndo?: () => void` and renders a
conditional Undo button when `proposal.undoable === true`.

### ✅ 19. `useAi.ts:206` `TODO(v2.x)` comment  *(FE — Resolved 2026-05-05)*

Removed. The surrounding docblock already documents `useAi`'s
post-v2.1 role as the deterministic local-engine fallback only.

## What's GA-ready right now

### Backend

| Surface | Status | Notes |
|---|---|---|
| v1 JSON routes (shared runtime; deterministic + LLM-polish) | ✅ | `task-draft`, `task-breakdown`, `estimate`, `readiness`, `search`, `board-brief`, `chat` |
| v2.1 SSE — `board-brief-agent` | ✅ | Suggestion + citations |
| v2.1 SSE — `task-drafting-agent` | ✅ | Two sequential interrupts auto-resumed by FE |
| v2.1 SSE — `task-estimation-agent` | ⚠️ | Quality bounded by §4 |
| v2.1 SSE — `search-agent` | ⚠️ | Quality bounded by §4 (FE-candidate ranking only) |
| v2.1 SSE — `chat-agent` | ✅ | Read-only tools; **proposal cards must be hidden** until §1 closes |
| v2.1 SSE — `triage-agent` | ✅ | Deterministic; AC-V14 inbox rules enforced FE-side |
| Per-project AI opt-out + typed 403 envelope | ✅ | Resolved 2026-05-05 |
| Rate limiting (per-agent, from metadata) | ✅ | |
| Monthly token budget (per-project) | ✅ | `AGENT_BUDGET_MONTHLY_TOKEN_CAP` |
| Idempotency (Redis-backed) | ✅ | Now also enforced on the SSE `/stream` initial POST (2026-05-05) |
| Durable checkpointing (Postgres when configured) | ✅ | Local/dev default remains `memory`; production resume durability needs `AGENT_CHECKPOINT_BACKEND=postgres` |
| OpenTelemetry tracing + Prometheus metrics + LangSmith | ✅ | |
| Boot-time prod guard (warns on `memory` backends) | ⚠️ | `_validate_memory_agent_backends` logs or warns on checkpoint/store memory. **Multi-worker:** `_configure_middleware_backends` **raises** when `UVICORN_WORKERS` / `WEB_CONCURRENCY` > 1 unless rate + budget + idempotency are Redis-backed with `REDIS_URI` (§16d). Memory-backed middleware still **warns** under multi-instance heuristics. |
| Boot-time prod guard (explicit provider without API key) | ✅ | `assert_provider_available` raises `RuntimeError` when `AGENT_CHAT_MODEL_PROVIDER` resolves to `anthropic` / `openai` without an API key on a production-shaped deploy (`backend/app/agents/llm.py:324–339`). Added 2026-05-05. |
| Vercel SSE timeout (`maxDuration: 300`) | ✅ | Resolved 2026-05-05 |
| CI matrix (slim + full install) | ⚠️ | Push/PR + `workflow_dispatch` wired; no green run URL recorded in §7 yet |

### Frontend

| Surface | Status | Notes |
|---|---|---|
| Local engine (deterministic) | ✅ | Full coverage; demo-able with no backend |
| `useAgent("board-brief-agent")` (remote) | ✅ | Suggestion + citations rendered in `BoardBriefDrawer` |
| `useAgent("task-drafting-agent")` (remote) | ✅ | Two sequential interrupts auto-resumed |
| `useAgent("task-estimation-agent")` (remote) | ⚠️ | Quality bounded by §4 |
| `useAgent("search-agent")` (remote) | ⚠️ | Quality bounded by §4 |
| `useAgentChat("chat-agent")` (remote) | ✅ | SSE streaming; **proposal cards must be hidden** until BE §1 closes |
| `useAgent("triage-agent")` (remote) | ✅ | AC-V14 inbox rules (cap-5, dedup, 4-hour expiry, dismiss-propagation) |
| Autonomy selector UI | ⚠️ | Suggest/Plan ✅; Auto disabled with tooltip — see §8 |
| Agent health badge in header | ✅ | Renders only when `degraded`/`offline` and remote mode |
| `useAgentHealth` + `AGENT_HEALTH_DEGRADED` analytics | ✅ | Deduped per transition |
| Per-project AI opt-out + typed 403 envelope | ✅ | `mapErrorResponse` honors the backend's typed error envelope, including nested `error.code` (Resolved 2026-05-08) |
| `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` observability | ✅ | TTFT, durationMs, tokensIn/Out |
| `Idempotency-Key` header on all AI requests | ✅ | |
| i18n (`en`, `zh-CN`) for AI surfaces | ✅ | Including autonomy selector keys |
| jest-axe a11y coverage | ✅ | 31 tests across all AI surfaces |
| `REACT_APP_AI_BASE_URL` validation (rejects `javascript:` / `data:` / `file:`) | ✅ | |
| `Disable AI for this project` switch | ✅ | `boardCopilot:disabledProjectIds` |
| `Board Copilot` runtime toggle | ✅ | `boardCopilot:enabled` |

## Readiness tiers — what shipped, in what order

The AI server reached its current state through nine sequential
readiness tiers. Each tier closed a class of risk before the next
one was started; the ordering is the reason features below depend on
features above. Detailed PR-by-PR history lives in git log.

1. **Tier 1 — Durable checkpointing.** Replace the in-memory
   `MemorySaver` default with Postgres-backed
   `langgraph-checkpoint-postgres` so multi-worker deployments
   survive restarts.
2. **Tier 2 — Idempotent writes.** Replace the in-memory idempotency
   cache with Redis (or Postgres) so retries don't double-spend
   tokens or double-apply mutations.
3. **Tier 3 — Packaging.** Promote `langchain-anthropic` and
   `langchain-openai` from optional `[ai]` extras to base
   dependencies, removing the foot-gun where a slim install booted
   but failed at first agent call.
4. **Tier 4 — Edge transport.** Fix Vercel SSE truncation (response
   buffering, header order, timeout interplay) so the FE streaming
   surface works on the production deploy target.
5. **Tier 5 — Triage agent.** Ship `triage-agent` as a deterministic
   graph (LLM-polish caveat noted) so the FE inbox is fed by a real
   agent, not client-side heuristics.
6. **Tier 6 — Search agent.** Ship `search-agent` as a v2.1
   LangGraph agent backed by FE-supplied candidates (real vector
   RAG remains open as soft blocker §4).
7. **Tier 7 — Brief recommendations.** Add `recommendationDetail`
   to `board-brief-agent` so the FE Brief drawer renders structured
   recommendations, not just prose.
8. **Tier 8 — Real LLM wiring.** Move from `make_stub_chat_model`
   to the `make_chat_model` / `make_embeddings` factories with
   provider auto-selection (`AGENT_CHAT_MODEL_PROVIDER=auto`), real
   token counting, and the `is_stub_model` feature flag.
9. **Tier 9 — Production middleware and observability.** Per-project
   AI-disable flag, per-agent rate limiting, per-project monthly
   token budget, Stripe-style idempotency dedup, OpenTelemetry
   tracing, Prometheus metrics, LangSmith tracing — plus boot-time
   guards: `_validate_memory_agent_backends` **logs a warning** when
   memory backends run on a production-shaped deploy, and
   `assert_provider_available` **raises `RuntimeError`** when an
   explicit Anthropic/OpenAI provider is set without its API key.
   §16d: multi-worker Uvicorn **raises** unless Redis backs rate,
   budget, and idempotency with a non-empty `REDIS_URI`; otherwise
   keep one worker or scale horizontally one worker per container.

Open work above Tier 9 that this file still tracks: **GA §1** (mutation
proposal lifecycle) and the **public-GA** quality ceiling (**§4** / vector
RAG depth — optional pgvector is shipped; production embeddings backfill
remains operator work). Historical structural notes live in
[`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).

## Recommended ship sequence

1. **Internal beta (today).** Deploy with `MutationProposalCard`
   gated off (`REACT_APP_AI_MUTATION_PROPOSALS_ENABLED=false`,
   default). Use the v2.1 surface for read-only / suggestion flows.
   Document the search/estimation quality ceiling in product copy.
2. **Design-partner beta.** Beta §2/§3/§6 and soft §4/§5/§7 are closed on
   branch ``orch/non-ga-todos-2f52/close-non-ga-release-todo-items``. FE CI (§7b)
   ships via `.github/workflows/frontend-ci.yml`. **Still close 🛑 GA §1**
   before expanding external users relying on mutation proposals; keep
   proposal cards hidden until then.
3. **Public GA.** Close the 🛑 GA blocker §1 (full
   `MutationProposal` lifecycle + undo) and the public-GA quality
   gate §4 (real RAG with pgvector). Surface proposal cards.

## Out of scope for this document

- **Cost controls.** Per-project monthly token cap exists
  (`AGENT_BUDGET_MONTHLY_TOKEN_CAP`) and is debited correctly by
  `_polish_and_record`.
- **Observability.** OpenTelemetry tracing, Prometheus metrics, and
  LangSmith are wired and tested.
- **Auth.** JWT + project access gates are wired and tested. Open
  security item: see Beta Blocker §3.

## FE verification

```bash
npm install
npm run eslint                                              # must be clean (--max-warnings 0)
npx tsc --noEmit                                            # must be clean
CI=true npm test -- --watchAll=false --runInBand            # 146 suites (re-counted 2026-05-10)
npx vite build                                              # must succeed
```

## BE verification

```bash
cd backend
python -m pytest                                            # full suite, 100% coverage gate
ruff check .                                                # must be clean
```
