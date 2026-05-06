# AI Remaining Work

Status as of the merge of `Accept FE envelope on v1 AI routes; add latencyMs to health` (PR #32), updated through branch `claude/v2.1-ai-features-vjZSA` (2026-05-05, audit follow-up — typed 403 envelope, vercel `maxDuration`, citation-helper alignment, slim/full CI matrix; see "Audit follow-up" below). The structured v1 routes and the v2.1 LangGraph agent surface match the React client (pulse) wire shape. Six agents are registered (`board-brief`, `task-drafting`, `task-estimation`, `chat`, `triage`, `search`); setting `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) flips five of them plus the v1 polish helpers from deterministic stubs to real LLM output — `langchain-anthropic` and `langchain-openai` are now base dependencies so no extra install step is required. The sixth (`triage-agent`) stays deterministic regardless of any key — see item 5. This document tracks what is **not** yet done.

**FE consumer status (2026-05-05, updated).** The React client is now on the v2.1 SSE surface for **all six** structured agents:

- `chat-agent` via `useAgentChat` (2026-05-04).
- `board-brief-agent` via `useAgent("board-brief-agent")` (2026-05-05, `claude/v2.1-ai-features-hGKmE`).
- `triage-agent` via `useAgent("triage-agent")` mounted in `BoardPage`. Triage nudges are consumed under PRD AC-V14 inbox rules (cap-5, dedup by `(kind, project_id)`, 4-hour expiry) so a verbose `triage-agent` will not flood the FE inbox.
- `task-drafting-agent` via `useAgent("task-drafting-agent")` in `AiTaskDraftModal` (2026-05-05, `claude/v2.1-ai-features-NRHhz`). Consumes `surface: "draft"` for both single-draft and `{axis, items}` breakdown payloads. The agent's two sequential interrupts (`fe.boardSnapshot`, `fe.similarTasks`) are auto-resumed by the FE `useAgent` loop.
- `task-estimation-agent` via `useAgent("task-estimation-agent")` in `AiTaskAssistPanel` (2026-05-05, `claude/v2.1-ai-features-NRHhz`). Consumes the bundled `surface: "estimate"` payload `{estimate, readiness}` in a single suggestion event.
- `search-agent` via `useAgent("search-agent")` in `AiSearchInput` (2026-05-05, `claude/v2.1-ai-features-NRHhz`). The FE registers a new `fe.searchCandidates` tool in `FE_TOOL_REGISTRY` that resolves the search-agent interrupt from the React Query cache (up to 50 `{id, text}` candidates per kind).

The v1 JSON shims at `/api/ai/{task-draft,task-breakdown,estimate,readiness,search,board-brief,chat}` remain in place — the FE keeps `useAi` mounted as the deterministic local-engine fallback (toggled via `REACT_APP_AI_USE_LOCAL=true` / `aiUseLocalEngine`). FE migration tracked in `docs/prd/board-copilot-progress.md`.

For background on what already exists, see `AI_ARCHITECTURE_REVIEW.md`.

## Audit follow-up — 2026-05-05 (`claude/v2.1-ai-readiness-review-0w9BG`, commit `0e990e4`)

Three hardening fixes landed on this branch:

- **Input size limits** — `app/agents/limits.py` `enforce_request_limits` is called on every v1 (`POST /api/ai/*`) and v2.1 (`POST /api/v1/agents/*/{invoke,stream}`) endpoint. Defaults: 64 KiB total body (`AI_MAX_BODY_BYTES`), 8 KiB prompt (`AI_MAX_PROMPT_BYTES`), 50 messages (`AI_MAX_MESSAGES`), 8 KiB per-message content (`AI_MAX_MESSAGE_CONTENT_BYTES`). Returns HTTP 413. 13 new tests in `tests/test_ai_limits.py`.
- **PII redaction for `/estimate` and `/readiness`** — `taskName`, `note`, `epic`, and `coordinatorId` now run through `redact_task_fields` (`app/tools/redaction.py`) before the LLM polish call. Closes PRD §5A.10. Response shape unchanged. 9 new tests in `tests/test_ai_redaction.py`.
- **`EMBEDDINGS_DIMENSIONS` env var** — `app/config.py` exposes `EMBEDDINGS_DIMENSIONS` (default `16` for stub back-compat); `app/agents/embeddings.py` passes it through `OpenAIEmbeddings(dimensions=...)`. **This lifts the 16-dim pin but does NOT add a vector store or real RAG — item 8 below remains open.** Set `512+` in production for real semantic quality. 2 new embedding tests.

Full suite after this work: 713 passed, 100% coverage.

## Audit follow-up — 2026-05-05 (`claude/v2.1-ai-readiness-check-TbxeM`)

Second-pass audit of the v2.1 AI surface. The agent runtime ships and works; three GA-blockers identified are explicitly **out of scope for this branch** because each is multi-week / cross-team:

1. **`MutationProposal` lifecycle (item 12).** No agent emits `custom/mutation_proposal` and no `fe.applyMutation` interrupt is registered. The FE renders the proposal card but accept resumes into nothing. Tracked below.
2. **JWT-in-localStorage XSS surface.** The AI proxy reuses the primary FE bearer; any FE XSS exfiltrates an AI-proxy-capable token. Listed under "Out of scope" below; mitigation path is proxy-scoped tokens with a narrower claim set.
3. **Provider 5xx fallback.** No AI gateway, no provider failover. A single Anthropic / OpenAI 5xx burst surfaces as a user-visible error envelope with no degradation path. Tracked below.

Three small surgical fixes landed on this branch:

- **Idempotency-Key on SSE `/stream`** — `app/routers/agents.py` `stream_agent` now runs the same `_check_idempotency_with_metrics` gate as `/invoke` on the initial POST. In-flight siblings get 409, fingerprint mismatches get 422, completed-key replays return a 200 JSON `{status: "stream_completed"}` marker with `Idempotent-Replay: true`. Resume requests skip the check because thread-state checkpointing is already idempotent. Regression test in `tests/test_idempotency.py`.
- **Boot-time provider-key guard** — `app/agents/llm.py` `assert_provider_available` now raises at startup when an explicit `AGENT_CHAT_MODEL_PROVIDER=anthropic|openai` is configured without the matching `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` and the deploy looks production-shaped (Vercel / Render / Fly / Railway / K8s). Default `auto` keeps the degrade-to-stub behaviour.
- **`AgentMetadata.as_dict()` trim (item 9, Resolved)** — `tags`, `recursion_limit`, `context_schema` are dropped from the wire shape; the FE never read them. Fields are kept on the dataclass so the runtime / router still use them internally.

Companion FE polish runs on `claude/v2.1-ai-readiness-check-TbxeM` (separate subagent). The two remaining BE-side GA-blockers (mutation lifecycle, provider fallback) and the cross-cutting JWT XSS concern are tracked under their own items below.

## Audit follow-up — 2026-05-05 (`claude/v2.1-ai-features-vjZSA`)

Cross-repo audit of the v2.1 AI surface against the docs. All six agents and the FE consumer paths confirmed shipped; no multi-week gaps surfaced. Four single-session BE fixes landed:

- **Typed 403 envelope** (item 13) — `app/routers/agents.py` and `app/routers/ai.py` now raise `detail={"code": "forbidden", "message": "AI is disabled for this project"}`. The wire body is `{"error": {"code": "forbidden", "message": "..."}}`. The companion FE change (`mapErrorResponse.ts`) reads the `code` field and threads it onto `AgentForbiddenError.code` / `AgentBudgetError.code`.
- **Vercel `maxDuration`** (item 4 follow-up) — `vercel.json` adds `"functions": {"api/index.py": {"maxDuration": 300}}` so multi-interrupt agent flows (board-brief, task-drafting) are not silently truncated at the default 10s/60s ceiling.
- **Citation schema drift** — `app/agents/catalog/task_estimation.py` `emit_citations` now uses `be_tools.validated_citation_ref(source="task", ...)` instead of a raw dict with the invalid `source="fe.similarTasks"`. Now consistent with `board-brief-agent` and the FE source allowlist.
- **Slim/full CI matrix** (item 11) — `.github/workflows/ci.yml` adds `test-full` (`.[dev,ai]` + `pytest`) and `test-slim` (`.[dev]` + `python -c "import app.main"`) jobs so an optional-import regression fails CI instead of shipping silently.

Companion FE fixes on the same branch (`claude/v2.1-ai-features-vjZSA`):

- `mapErrorResponse.ts` honors `body.code` and threads it onto `AgentForbiddenError` / `AgentBudgetError`. Legacy plain-string bodies still produce a typed error (back-compat).
- `useAgentChat.dismissNudge` now calls `agent.dismissNudge(nudgeId)` so chat-drawer dismissals propagate to the AC-V14 inbox reducer instead of resurrecting after `reset()`.

Test counts after this work: BE 760 passing, 100% coverage; FE 142 suites / 1000 tests passing.

## Readiness tiers — what shipped, in what order

The AI server reached its current state through nine sequential readiness tiers. Each tier closed a class of risk before the next one was started; the ordering is the reason features below depend on features above. Detailed PR-by-PR history lives in git log.

1. **Tier 1 — Durable checkpointing.** Replace the in-memory `MemorySaver` default with Postgres-backed `langgraph-checkpoint-postgres` so multi-worker deployments survive restarts. Closes resolved item 1.
2. **Tier 2 — Idempotent writes.** Replace the in-memory idempotency cache with Redis (or Postgres) so retries don't double-spend tokens or double-apply mutations. Closes resolved item 2.
3. **Tier 3 — Packaging.** Promote `langchain-anthropic` and `langchain-openai` from optional `[ai]` extras to base dependencies, removing the foot-gun where a slim install booted but failed at first agent call. Closes resolved item 3.
4. **Tier 4 — Edge transport.** Fix Vercel SSE truncation (response buffering, header order, timeout interplay) so the FE streaming surface works on the production deploy target. Closes resolved item 4.
5. **Tier 5 — Triage agent.** Ship `triage-agent` as a deterministic graph (LLM-polish caveat noted) so the FE inbox is fed by a real agent, not client-side heuristics. Closes resolved item 5.
6. **Tier 6 — Search agent.** Ship `search-agent` as a v2.1 LangGraph agent backed by FE-supplied candidates (real vector RAG remains open as item 8). Closes resolved item 6.
7. **Tier 7 — Brief recommendations.** Add `recommendationDetail` to `board-brief-agent` so the FE Brief drawer renders structured recommendations, not just prose. Closes resolved item 6b.
8. **Tier 8 — Real LLM wiring.** Move from `make_stub_chat_model` to the `make_chat_model` / `make_embeddings` factories with provider auto-selection (`AGENT_CHAT_MODEL_PROVIDER=auto`), real token counting, and the `is_stub_model` feature flag. Documented in README §"Board Copilot v2.1 — Agent catalog".
9. **Tier 9 — Production middleware and observability.** Per-project AI-disable flag, per-agent rate limiting, per-project monthly token budget, Stripe-style idempotency dedup, OpenTelemetry tracing, Prometheus metrics, LangSmith tracing — plus the boot-time `RuntimeError` that refuses to start production with any middleware backend left at `memory`. Documented in README §"Configuration" and `docs/deployment.md`.

Open work (items 7–13 below) is the layer above Tier 9: MCP transport, real vector store / RAG, FE-consumed metadata trim, CI matrix without extras, and structural concerns from `AI_ARCHITECTURE_REVIEW.md` (provider hedging, structured-output validation, `create_agent` migration, multi-agent orchestration, store/memory layer).

## Priority 1 — Operational defaults that break in production

### 1. Default `AGENT_CHECKPOINT_BACKEND=memory` is unsafe outside a single worker — **Resolved 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 2. Default `IDEMPOTENCY_BACKEND=memory` causes double-spend on retries — **Resolved 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 3. Optional-extras packaging footgun — **resolved 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 4. Vercel SSE truncation — **Resolved 2026-05-04** (extended 2026-05-05)

**Status:** Resolved — see git history for implementation details. 2026-05-05 follow-up: `vercel.json` adds `"functions": {"api/index.py": {"maxDuration": 300}}` so multi-interrupt agent flows are not silently truncated at the default 10s/60s function timeout.

## Priority 2 — Code that does not yet exist

### 5. `triage-agent` LLM polish — **Resolved with caveat 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 6. `search-agent` v2.1 graph — **Resolved 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 6b. `board-brief-agent` `recommendationDetail` — **Resolved 2026-05-04**

**Status:** Resolved — see git history for implementation details.

### 7. No MCP transport

The catalog has tool schemas in `app/tools/fe_tool_schemas.py` and per-agent `tools` tuples on `AgentMetadata`, but `langchain-mcp-adapters` is not in any dependency group and the `/mcp` mount point does not exist. Explicitly deferred in `README.md`.

- Action when prioritised: add `langchain-mcp-adapters` as an extra `[mcp]`, mount a `Streamable HTTP` transport at `/mcp`, expose the read-only FE tools (`fe.listProjects`, `fe.listMembers`, `fe.getProject`, `fe.listBoard`, `fe.listTasks`, `fe.getTask`) plus `fe.boardSnapshot`. Out of scope: the mutation tools, which need an additional consent-and-undo path.

### 8. No vector store / RAG

There is no persistent embedding store. Neighbour scoring in `task-estimation-agent` runs only on FE-supplied `similar_tasks`. ~~The OpenAI embedding branch is hard-pinned to 16 dimensions~~ — the 16-dim pin was lifted in `0e990e4` (`EMBEDDINGS_DIMENSIONS` env var; set `512+` in production). **The absence of a vector store and real RAG pipeline remains open; the embedding-dim fix is a prerequisite, not a solution.**

- Action when prioritised: pick a vector store (`pgvector` is the lowest-friction choice given the existing Postgres runtime), write a backfill job that indexes existing tasks, and add a `vector_search` tool to `task-estimation-agent` and to a real `search-agent` graph. This is a multi-week piece of work — track separately.

### 9. v2.1 metadata fields the FE does not consume — **Resolved 2026-05-05**

**Status:** Resolved on `claude/v2.1-ai-readiness-check-TbxeM`. `AgentMetadata.as_dict()` no longer emits `tags`, `recursion_limit`, or `context_schema`; the fields stay on the dataclass because the runtime clamps `recursion_limit` and the streaming router introspects `context_schema`, but they are no longer on the wire.

## Priority 3 — Docs and developer experience

### 10. README claim is now accurate; keep it that way — **Resolved 2026-05-05**

**Status:** Resolved on `claude/v2.1-ai-readiness-check-TbxeM`. The `Configuration` section in `README.md` now links to `docs/AI_REMAINING_WORK.md` so future contributors see the operational caveats (Priority 1 above) before wiring up a customer.

### 11. Run CI without optional extras to catch optional-import regressions — **Resolved 2026-05-05**

**Status:** Resolved — `.github/workflows/ci.yml` added with `test-full` (`.[dev,ai]` + `pytest`) and `test-slim` (`.[dev]` + `python -c "import app.main"`) jobs, both triggered on push/PR to `main` and `claude/**`.

### 12. No `MutationProposal` lifecycle on any agent — gap surfaced 2026-05-05

The FE has full v2.1 wiring for proposals (`MutationProposal` type in `agent.d.ts`, `MutationProposalCard` component, accept/reject through `agent.resume({accepted})`), but no BE agent ever emits a `custom/mutation_proposal` event. The accept path is therefore unreachable from a deployed build today. Closing this requires:

- A `MutationProposal` Pydantic shape mirroring `agent.d.ts` (`proposal_id`, `description`, `diff: {task_updates, column_updates, bulk_apply}`, `risk`, `undoable`).
- Emission from any write-capable agent — most naturally `chat-agent` for tool-driven mutations and a future `board-coach-agent` for proactive mutations.
- A resume-accept handler that, on `command.resume = {choice: "accept"}`, raises `interrupt(interrupt_payload("fe.applyMutation", {diff}))` so the FE applies the change against `useReactMutation`. On `{choice: "reject"}` the agent terminates the proposal cycle.
- An undo endpoint (or a structured undo payload re-triggered by a follow-up `mutation_proposal`) so the FE 10-second undo toast (PRD AC-V4) has something to call. Without this, `AGENT_PROPOSAL_UNDONE` analytics on the FE side stays unfired.

This is a multi-week piece of work that touches the agent runtime, the tool registry (a new `fe.applyMutation` interrupt), the BE-internal mutation execution path, and the spec for `auto`-autonomy preapproved tools (PRD AC-V5: `assignTask`, in-column `moveTask`, `renameColumn`). Track as its own milestone.

### 13. Per-project AI opt-out body is a plain string — **Resolved 2026-05-05**

**Status:** Resolved — `app/routers/agents.py` and `app/routers/ai.py` now raise `detail={"code": "forbidden", "message": "AI is disabled for this project"}` so the FE receives `{"error": {"code": "forbidden", "message": "..."}}` instead of the bare string.

### 14. No provider 5xx fallback / failover — gap surfaced 2026-05-05

A single Anthropic or OpenAI 5xx burst surfaces verbatim as a user-visible error envelope; there is no AI gateway, no retry-with-different-provider, no graceful degradation to the deterministic stub. The 2026-05-05 audit flagged this alongside the JWT XSS surface as a GA-blocker that is **out of scope** for the readiness-check branch — both are multi-week / cross-team items.

- Action when prioritised: pick a gateway (LiteLLM is the lowest-friction option since it sits behind the same `BaseChatModel` shape `make_chat_model` already returns), or implement a provider-list with circuit-breaker semantics inside `app/agents/llm.py`. Either way the failover path needs OTel attributes so dashboards distinguish "Anthropic 5xx, retried OpenAI" from a real outage.

## Out of scope for this document

- **Cost controls.** Per-project monthly token cap exists (`AGENT_BUDGET_MONTHLY_TOKEN_CAP`) and is debited correctly by `_polish_and_record`. No further work tracked here.
- **Observability.** OpenTelemetry tracing, Prometheus metrics, and LangSmith are wired and tested. No further work tracked here.
- **Auth.** JWT + project access gates are wired and tested. Open security item: the AI proxy accepts the same JWT the React app stores in `localStorage` (`"Token"`); any XSS vector in the FE exfiltrates the AI proxy token. Mitigation path: proxy-scoped tokens with a narrower claim set. Not yet scheduled.
