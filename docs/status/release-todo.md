# Release todo — Board Copilot production readiness

Consolidated GA status and open backlog across the FastAPI agent server
(`backend/`) and the React client (`src/`). For per-feature inventory
see [`product-done.md`](product-done.md); for deployment
configuration see [`../operations/deployment.md`](../operations/deployment.md).

Last updated: 2026-05-10 (BE + FE re-verification against `claude/review-project-todos-7UKrJ`; previous sweep `claude/review-project-todos-8d5Oo` left the BE blocker / soft-blocker / polish list materially correct — this pass re-verified it line by line with file:line evidence and made stale-claim corrections inside `ui-todo.md` instead).

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
- **Design-partner beta is gated on three Beta blockers** (§2, §3,
  §6): provider 5xx fallback, proxy-scoped JWT, and real-backend
  integration tests.
- **Public GA is gated on the remaining GA blocker** (§1, full
  `MutationProposal` lifecycle + undo) plus the public-GA quality
  ceiling (§4, real RAG / vector store).

## ⚠️ Blocker urgency — resolve before each tier

**The product is NOT ready for design-partner expansion, and NOT
ready for public GA.** The 🛑 GA blocker §1 and the three 🚧 Beta
blockers (§2, §3, §6) are release gates, not backlog items. The only
acceptable deployment posture today is **internal beta with proposal
cards gated off on the FE** (see GA Blocker §1 mitigation).

- **Each blocker delays a specific tier.**
  - §1 ships a dead-end UX once a proposal surfaces in a deployed
    build — gates **public GA**.
  - §2 makes a single upstream Anthropic/OpenAI 5xx a full outage —
    gates **design-partner beta**.
  - §3 leaves the AI proxy token co-located with the primary REST
    JWT in `localStorage`, so any FE XSS exfiltrates both — gates
    **design-partner beta**.
  - §6 means a real-backend regression goes undetected by the
    test suite — gates **design-partner beta**.
- **Assign owners per blocker, not per polish item.** Polish items
  can slip; §1, §2, §3, §6 cannot.
- **No public marketing, no design-partner expansion, no removal of
  the FE proposal-card gate** until the corresponding blockers show
  ✅ in this doc.
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

These three items are tolerable for **internal beta only** (employees
behind a flag, ops on call, no external SLAs). They block any
external exposure: a design partner would hit the failure mode and
there is no acceptable caveat.

### 🚧 2. No provider fallback on 5xx  *(BE-only)*

**Verdict (2026-05-05 re-audit):** still open. No AI gateway, no
provider list, no circuit breaker.

A Claude or OpenAI 5xx bubbles straight to the user. There is no AI
gateway (LiteLLM, Portkey), no failover policy, no hedged requests, no
semantic cache. A single upstream incident is a full outage.

**Beta tier scoping.** Internal beta accepts the outage risk because
ops can babysit the deploy; a design partner with their own users
relying on uptime cannot. Closes design-partner gate.

- Action when prioritised: pick a gateway (LiteLLM is the
  lowest-friction option since it sits behind the same `BaseChatModel`
  shape `make_chat_model` already returns), or implement a
  provider-list with circuit-breaker semantics inside
  `app/agents/llm.py`. Either way the failover path needs OTel
  attributes so dashboards distinguish "Anthropic 5xx, retried OpenAI"
  from a real outage.
- Detail: F-9 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Scope: gateway selection, `make_chat_model` integration, failover
  policy, OTel attributes, and failure-mode tests. `ChatOpenAI(base_url=...)`
  is sufficient for LiteLLM because it is OpenAI-compatible.

### 🚧 3. JWT-in-localStorage XSS exfiltration surface  *(BE + FE)*

**Verdict (2026-05-05 re-audit):** still open. The AI proxy still
reuses the primary FE bearer.

The FE stores the primary bearer JWT in `localStorage`
(`src/utils/aiAuthHeader.ts`) and the AI proxy reuses it verbatim. Any
FE XSS exfiltrates the AI proxy token alongside the REST API token.

**Beta tier scoping.** Internal beta accepts the residual risk because
the audience is employees on managed devices; expanding to a design
partner means external users with unknown browser hygiene, which is
not an acceptable XSS surface. Closes design-partner gate.

- Mitigation path: proxy-scoped token with a narrow claim set, or
  httpOnly cookie. Cross-repo work (BE token issuance + FE storage
  migration + middleware updates).
- Scope: BE token issuance, FE storage migration, and middleware
  updates across REST + agent requests.

### 🚧 6. Synthetic 100% coverage — no integration tests  *(BE-only)*

`pyproject.toml` `--cov-fail-under=100` is met against deterministic
stubs. No tests against real Anthropic/OpenAI, real Redis, or real
Postgres. The CI matrix added 2026-05-05 (`test-full` / `test-slim`)
catches optional-import regressions but not real-backend regressions.

**Beta tier scoping.** Internal beta runs on a known-good staging
deploy; a real-backend regression is caught manually before the build
ships. A design partner deploys against their own infra, where a silent
provider/SDK regression breaks user-facing flows with no detection.
Closes design-partner gate.

- Detail: F-42 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Scope: `integration` pytest marker, a secret-gated CI job, real
  provider smoke coverage, and Redis/Postgres service containers.

## Soft blockers — ship-able with documented caveats

### ⚠️ 4. Search and estimation quality ceiling  *(BE + FE)*

`task-estimation-agent` neighbour scoring runs only on FE-supplied
`similar_tasks`. No persistent vector store. `search-agent` ranks
FE-supplied candidates; no real RAG. The 16-dim embedding pin is
lifted as of `0e990e4` (`EMBEDDINGS_DIMENSIONS` env var; **set
`EMBEDDINGS_DIMENSIONS=512`+ for production**), but the absence of a
vector store / real RAG remains open. The FE `fe.searchCandidates`
tool tops out at 50 candidates per kind — no FE-side fix.

- Action when prioritised: pick a vector store (`pgvector` is the
  lowest-friction choice given the existing Postgres runtime), write a
  backfill job that indexes existing tasks, and add a `vector_search`
  tool to `task-estimation-agent` and to a real `search-agent` graph.
- Detail: F-18 / F-19 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Scope: pgvector (or managed vector store), backfill job,
  `vector_search` tool, and migration / rollback plan.
- **Acceptable scope:** suggestion-grade search and estimation, not
  retrieval-grade. Disclose in product copy.

### ⚠️ 5. No structured-output validation  *(BE-only — partially shipped 2026-05-10)*

Catalog agents emit `AIMessage(content=json.dumps(...))` and clients
`json.loads`. Once an LLM replaces the deterministic stubs the schema
can rot silently. **Partial fix shipped 2026-05-10:** per-surface
Pydantic models with `extra="forbid"` in `app/agents/events.py`;
validation hook in `runtime.arun_with_events` and `astream`; on
validation failure, a warning is logged and the payload passes
through (so a schema bug never breaks a streaming response). Golden
SSE transcripts in `tests/test_agent_sse_transcripts.py`.

- Remaining work: migrate the LLM-polish path to provider-level
  `response_format` support so the contract is
  enforced at provider call time, not just at FE emission. Detail:
  F-10 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Scope: provider-level structured-output calls, fallback behaviour on
  schema rejection, and companion transcript tests.
- **Mitigation now:** the FE validates every payload (`validateDraft`,
  `validateEstimate`, `validateBoardBrief`, `validateSearch`) and
  drops unknown ids. A schema regression degrades but does not
  corrupt.

### ⚠️ 7. CI workflow — manual dispatch available; green run URL not recorded here  *(BE-only)*

`.github/workflows/backend-ci.yml` defines `test-full` (install `.[dev,ai]`,
run `pytest`) and `test-slim` (install `.[dev]`, run
`python -c "import app.main"`). On `push` / `pull_request`, changes under
`backend/**` or the workflow file run **both** jobs. **`workflow_dispatch`**
adds a **mode** input (type `choice`, default **`both`**) with options
exactly: **`both`**, **`test-full`**, **`test-slim`**. Each option keeps the
same job definitions; `both` runs the full matrix in one dispatch, while
`test-full` / `test-slim` narrow to a single job via the workflow `if`
conditions.

**Manual run (no claim of green until a URL exists below):** GitHub →
Actions → **Backend CI** → **Run workflow** → choose the **target branch**
in the Run workflow UI → set **mode** to `both`, `test-full`, or `test-slim`
(see above) → **Run workflow**. When you have a **succeeded** run, paste its
URL in this section so the backlog points at evidence; until then, this doc
does **not** assert that Backend CI has passed on `main` (or any branch) in
GitHub Actions.

- **First green Backend CI run URL (paste when available):** _(none yet)_
- **Scope for closing §7:** replace the placeholder with a concrete green
  `workflow_dispatch` or push/PR run URL after ops confirms the first good
  execution.

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
or higher for production semantic quality. **Note: this does NOT add
a vector store or real RAG — soft blocker §4 remains open.**

### 🟡 13. v2.1 metadata fields the FE doesn't consume  *(BE — Resolved 2026-05-05)*

`AgentMetadata.as_dict()` no longer emits `tags`, `recursion_limit`,
or `context_schema`. The fields stay on the dataclass for the runtime
/ router.

### 🟡 14. v2.1 metadata fields not surfaced in UI  *(FE)*

`AgentMetadata.allowed_autonomy`, `rate_limit`, `recursion_limit`,
`context_schema`, `tags` are on the BE wire; most have no FE disclosure yet,
so there is little user-visible calibration for limits or wire-only policy.
Would let the autonomy selector self-gate and a future "limits" surface
render rate / budget visibly.

**Partial (2026-05-10):** About Board Copilot now shows server `rate_limit`
and `allowed_autonomy` for `chat-agent` (session-cached metadata fetch)
in remote builds with a non-empty AI base URL. Other metadata fields
remain unsurfaced.

### 🟡 15. MCP transport deferred  *(BE)*

No `/mcp` mount, no `langchain-mcp-adapters` dependency. The catalog
has tool schemas in `app/tools/fe_tool_schemas.py` and per-agent
`tools` tuples on `AgentMetadata`, but `langchain-mcp-adapters` is
not in any dependency group and the `/mcp` mount point does not exist.

- Action when prioritised: add `langchain-mcp-adapters` as an extra
  `[mcp]`, mount a `Streamable HTTP` transport at `/mcp`, expose the
  read-only FE tools (`fe.listProjects`, `fe.listMembers`,
  `fe.getProject`, `fe.listBoard`, `fe.listTasks`, `fe.getTask`) plus
  `fe.boardSnapshot`. Out of scope: the mutation tools, which need
  an additional consent-and-undo path.
- Detail: F-15 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Not on the GA path.

### 🟡 16. No multi-agent orchestration / memory  *(BE)*

`board-brief-agent` and `triage-agent` re-implement drift detection.
Memory namespaces (`user_preferences`, `project_profile`, `feedback`)
are defined but unused.

- Detail: F-13 / F-14 in [`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md).
- Quality-of-life, not GA-gating.

### 🟡 16b. `useAgent.ts` is a 1,010-line monolith  *(FE)*

`src/utils/hooks/useAgent.ts` owns SSE parsing, thread-id persistence,
FE-tool auto-resume, TTFT tracking, the AC-V14 nudge inbox reducer,
the autonomy gate, the per-project AI-disable check, and the proposal
lifecycle plumbing — in one file. Every consumer that destructures the
return shape risks the effect-loop anti-pattern documented in
`AGENTS.md`. Cross-references: architecture-todo Theme 3 (FE surface
simplification).

- Action when prioritised: extract the SSE-parsing layer into a thin
  adapter (architecture-todo Theme 3 calls this out), the nudge-inbox
  reducer into its own module (already exported as `reduceNudgeInbox`
  for tests — finish the move), and the FE-tool registry / auto-resume
  loop into a separate hook (`useAgentToolResolver`).
- Quality-of-life, not GA-gating.

### 🟡 16c. `X-Pulse-Model` header / per-tenant model config  *(BE)*

`backend/app/agents/runtime.py:578` carries a TODO to wire the
`X-Pulse-Model` header to a per-tenant config in "Phase 5". The
header path itself is wired (`backend/app/routers/_dispatch.py:46–75`)
and gated by `AGENT_CHAT_MODEL_ALLOWLIST` (empty by default → header
ignored), so this is **not a security exposure today**. It becomes
relevant once design partners pick their own preferred model: today
the only choice is a process-wide env var.

- Action when prioritised: replace the runtime TODO with either a
  per-project / per-tenant model setting (read from project metadata),
  or document the deferred decision and remove the TODO.
- Scope: per-project setting, migration/defaulting, allowlist semantics,
  and request/stream tests.

### 🟡 16d. Single-worker uvicorn lock-in  *(BE)*

`backend/Dockerfile:81–84` and `backend/fly.toml:17–39` pin uvicorn
to a single worker because in-process rate-limit and budget state
would diverge across processes. Postgres-backed checkpointing /
Redis-backed idempotency exist; the rate-limit and budget paths still
default to in-memory backends. Capacity ceiling is per-process today;
horizontal scaling is blocked by this implicit invariant. Cross-ref:
architecture-todo Theme 4.

- Action when prioritised: configure `RATE_LIMIT_BACKEND=redis`,
  `BUDGET_BACKEND=redis`, and `IDEMPOTENCY_BACKEND=redis` wherever the
  app may run multiple workers. `backend/docker-compose.yml` sets all
  three against `REDIS_URI`; Dockerfile / production deploy paths must
  match before lifting `workers=1`. After full env parity is proven,
  document the multi-worker guarantee and remove the `workers=1` pin.
- Scope: env wiring, compose parity, smoke tests against
  `app/middleware/redis_backends.py`, and duplicate-request replay tests.

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
| Boot-time prod guard (warns on `memory` backends) | ⚠️ | `_validate_memory_agent_backends` (`backend/app/main.py:437–493`) and the middleware-backend warning (`main.py:309–333`) **log a warning**, they do not raise. The single-worker pin (§16d) is what actually keeps the in-memory state from drifting today; the warning is the prompt to fix the env before lifting `--workers 1`. |
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
   The single-worker uvicorn pin (§16d) is what actually keeps
   in-memory state coherent today; the warning is the operator
   prompt to fix the env before that pin is lifted.

Open work above Tier 9 is what remains in this doc: MCP transport,
real vector store / RAG, FE-consumed metadata trim, CI matrix
without extras, and structural concerns from
[`../archive/agent-architecture-reviews.md`](../archive/agent-architecture-reviews.md)
(provider hedging, structured-output validation, `create_agent`
migration, multi-agent orchestration, store/memory layer).

## Recommended ship sequence

1. **Internal beta (today).** Deploy with `MutationProposalCard`
   gated off (`REACT_APP_AI_MUTATION_PROPOSALS_ENABLED=false`,
   default). Use the v2.1 surface for read-only / suggestion flows.
   Document the search/estimation quality ceiling in product copy.
2. **Design-partner beta.** Close every 🚧 Beta blocker:
   §2 (LiteLLM gateway / provider fallback), §3 (proxy-scoped token
   migration), and §6 (real-backend integration tests). FE CI gate (§7b)
   ships via `.github/workflows/frontend-ci.yml`; keep tightening eslint
   jsx-a11y warnings until they fail CI. Keep proposal cards hidden.
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
