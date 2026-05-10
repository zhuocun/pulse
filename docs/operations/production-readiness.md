# Production Readiness — Board Copilot

Consolidated view across the FastAPI agent server (`backend/`) and the React client (`src/`). Source of truth for severity; for the per-feature detail and file/test inventory see [`../prd/progress.md`](../prd/progress.md), and for the operational backlog see [`remaining-work.md`](remaining-work.md).

Last updated: 2026-05-08 (FE) / 2026-05-05 (BE).

## TL;DR

- **GA-ready surfaces — Backend.** All v1 deterministic JSON routes; v2.1 SSE read-only / suggestion flows for `board-brief`, `task-drafting`, `task-estimation`, `search`, `chat` (read-only tools only), `triage` nudges; per-project AI opt-out, rate limiting, monthly token budgets, OpenTelemetry, Prometheus, idempotency, durable checkpointing, boot-time prod guards.
- **GA-ready surfaces — Frontend.** All six v2.1 SSE agents consumed via `useAgent` / `useAgentChat` in remote builds; deterministic local-engine fallback under `aiUseLocalEngine`; PRD AC-V14 nudge inbox; autonomy selector; observability; jest-axe a11y coverage; typed backend error envelopes surfaced through FE typed errors.
- **Internal beta only.** Anything that surfaces `MutationProposalCard` to the user — see Hard Blocker §1.
- **Blocks public GA.** Three hard blockers below; the rest is degraded-quality polish.

## ⚠️ GA blocker urgency — resolve ASAP

**The product is NOT ready for public GA.** The three 🛑 hard blockers below are release gates, not backlog items. Until each is closed, the only acceptable deployment posture is **internal beta with proposal cards gated off on the FE** (see Hard Blocker §1 mitigation).

- **Every day each hard blocker stays open is risk.** §1 ships a dead-end UX once a proposal slips into a deployed build; §2 makes a single upstream Anthropic/OpenAI 5xx a full outage with no fallback; §3 leaves the AI proxy token co-located with the primary REST JWT in `localStorage`, so any FE XSS exfiltrates both.
- **Assign owners per blocker, not per polish item.** Polish items can slip; §1–§3 cannot.
- **No public marketing, no design-partner expansion, no removal of the FE proposal-card gate** until §1, §2, §3 all show ✅ in this doc.
- **Re-audit weekly** until ✅. If a blocker is reclassified, justify it in this file with file:line evidence.

The Recommended ship sequence at the bottom of this doc is the contract: internal beta → design-partner GA → public GA, gated on the explicit blocker closures listed there.

## Severity tags

- **🛑 GA-blocker.** Customer-visible failure or material security risk. Must close before public ship.
- **⚠️ Soft blocker.** Quality or reliability ceiling that limits scope; ship-able with documented caveats.
- **🟡 Polish.** Internal hygiene; no customer impact.

## Hard blockers — must close before public GA

### 🛑 1. `MutationProposal` accept path is dead in remote mode  *(BE + FE)*

**Verdict (2026-05-05 re-audit):** still open. No agent emits `custom/mutation_proposal`; no `fe.applyMutation` interrupt is registered.

**Backend symptom.** The FE renders `MutationProposalCard` and calls `agent.resume({accepted: true})` on accept, but no BE agent emits `custom/mutation_proposal`, no `fe.applyMutation` interrupt is registered, and there is no undo endpoint behind the `undoable` badge.

**Frontend symptom.** `AiChatDrawer` renders `MutationProposalCard` and wires `onAccept` to `agentChat.resumeProposal(true)`. The user sees the card vanish but no mutation is applied.

- BE surface: any agent that would propose mutations (most naturally `chat-agent`, future `board-coach-agent`).
- FE files: `src/components/aiChatDrawer/index.tsx`, `src/components/mutationProposalCard/index.tsx`.
- Detail and proposed shape: [`remaining-work.md` §12](remaining-work.md).
- Effort: multi-week. Touches agent runtime, tool registry, mutation execution path, AC-V5 preapproved-tools spec, plus the FE registration of `fe.applyMutation` in `FE_TOOL_REGISTRY`.
- **FE polish already shipped (2026-05-05):** `MutationProposalCard` accepts `onUndo` and fires `AGENT_PROPOSAL_UNDONE`; full 10-second countdown undo path with field-change disclosure. Only the BE half remains for end-to-end GA.
- **Mitigation (v2.1, `5d96e16`):** `MutationProposalCard` gated off by default behind `environment.aiMutationProposalsEnabled` (env var `REACT_APP_AI_MUTATION_PROPOSALS_ENABLED`, default `false`). The card does not render even when an agent emits a `pendingProposal`. Set the env var to `true` only in internal environments where the dead-end UX is acceptable.

### 🛑 2. No provider fallback on 5xx  *(BE-only)*

**Verdict (2026-05-05 re-audit):** still open. No AI gateway, no provider list, no circuit breaker.

A Claude or OpenAI 5xx bubbles straight to the user. There is no AI gateway (LiteLLM, Portkey), no failover policy, no hedged requests, no semantic cache. A single upstream incident is a full outage.

- Detail: [`../archive/ai-architecture-review.md` F-9](../archive/ai-architecture-review.md), [`remaining-work.md` §14](remaining-work.md).
- Effort: ~1 week to wire LiteLLM behind `make_chat_model` (`ChatOpenAI(base_url=...)` is sufficient since LiteLLM is OpenAI-compatible).

### 🛑 3. JWT-in-localStorage XSS exfiltration surface  *(BE + FE)*

**Verdict (2026-05-05 re-audit):** still open. The AI proxy still reuses the primary FE bearer.

The FE stores the primary bearer JWT in `localStorage` (`src/utils/aiAuthHeader.ts`) and the AI proxy reuses it verbatim. Any FE XSS exfiltrates the AI proxy token alongside the REST API token.

- Mitigation path: proxy-scoped token with a narrow claim set, or httpOnly cookie. Cross-repo work (BE token issuance + FE storage migration + middleware updates).
- Effort: ~1 week.

## Soft blockers — ship-able with documented caveats

### ⚠️ 4. Search and estimation quality ceiling  *(BE + FE)*

`task-estimation-agent` neighbour scoring runs only on FE-supplied `similar_tasks`. No persistent vector store. `search-agent` ranks FE-supplied candidates; no real RAG. The 16-dim embedding pin is lifted as of `0e990e4` (`EMBEDDINGS_DIMENSIONS` env var; **set `EMBEDDINGS_DIMENSIONS=512`+ for production**), but the absence of a vector store / real RAG remains open. The FE `fe.searchCandidates` tool tops out at 50 candidates per kind — no FE-side fix.

- Detail: [`remaining-work.md` §8](remaining-work.md), [`../archive/ai-architecture-review.md` F-18 / F-19](../archive/ai-architecture-review.md).
- Effort: multi-week (pgvector + backfill job + `vector_search` tool).
- **Acceptable scope:** suggestion-grade search and estimation, not retrieval-grade. Disclose in product copy.

### ⚠️ 5. No structured-output validation  *(BE-only)*

Catalog agents emit `AIMessage(content=json.dumps(...))` and clients `json.loads`. Once an LLM replaces the deterministic stubs the schema can rot silently — there is no `response_format=Pydantic(...)` contract.

- Detail: [`../archive/ai-architecture-review.md` F-10](../archive/ai-architecture-review.md).
- Effort: ~3 days to define schemas under `app/agents/schemas/` and migrate to `create_agent(..., response_format=...)`.
- **Mitigation now:** the FE validates every payload (`validateDraft`, `validateEstimate`, `validateBoardBrief`, `validateSearch`) and drops unknown ids. A schema regression degrades but does not corrupt.

### ⚠️ 6. Synthetic 100% coverage — no integration tests  *(BE-only)*

`pyproject.toml` `--cov-fail-under=100` is met against deterministic stubs. No tests against real Anthropic/OpenAI, real Redis, or real Postgres. The CI matrix added 2026-05-05 (`test-full` / `test-slim`) catches optional-import regressions but not real-backend regressions.

- Detail: [`../archive/ai-architecture-review.md` F-42](../archive/ai-architecture-review.md).
- Effort: ~1 week to add an `integration` pytest marker, a CI job behind a secret-gated flag, and Redis/Postgres service containers.

### ⚠️ 7. CI workflow not yet validated against GitHub Actions  *(BE-only)*

`.github/workflows/ci.yml` landed on `claude/v2.1-ai-features-vjZSA` (2026-05-05) but no GHA run has executed yet. The slim job (`pip install -e ".[dev]"` + `python -c "import app.main"`) is untested in the GHA environment.

- Effort: open a PR to trigger the first run; iterate until green.

### ✅ 8. AC-V5 preapproved-tools auto-autonomy not implemented  *(FE — Resolved 2026-05-05)*

Resolved on `claude/v2.1-ai-readiness-check-TbxeM` by hard-disabling the "Auto" option in `AiChatDrawer` with an explanatory i18n tooltip ("Auto requires an agent that supports preapproved tools. Available in v3."). The metadata-driven gating against `AgentMetadata.allowed_autonomy` remains V3 work — see [`../prd/v3.md`](../prd/v3.md).

### ✅ 9. `AGENT_PROPOSAL_UNDONE` analytics defined but unfired  *(FE — Resolved 2026-05-05)*

`MutationProposalCard` now accepts an optional `onUndo` prop and fires `AGENT_PROPOSAL_UNDONE` from the click handler. The end-to-end Undo flow remains gated on Hard Blocker §1.

## Polish — no customer impact

### 🟡 10. Input size limits  *(BE — Resolved 2026-05-05, `0e990e4`)*

`enforce_request_limits` added to every v1 (`POST /api/ai/*`) and v2.1 (`POST /api/v1/agents/*/{invoke,stream}`) endpoint. Defaults: 64 KiB total body, 8 KiB prompt, 50 messages, 8 KiB per-message content. Returns HTTP 413 on violation. 13 new tests in `tests/test_ai_limits.py`.

### 🟡 11. PII leak from `/estimate` and `/readiness` task fields  *(BE — Resolved 2026-05-05, `0e990e4`)*

`taskName`, `note`, `epic`, and `coordinatorId` on `/estimate` and `/readiness` requests now run through `redact_task_fields` before the LLM polish call. Closes the leak documented in PRD §5A.10. 9 new tests in `tests/test_ai_redaction.py`.

### 🟡 12. Embedding dimensions hard-pinned to 16  *(BE — Resolved 2026-05-05, `0e990e4`)*

`EMBEDDINGS_DIMENSIONS` env var added (`app/config.py`, default `16` for stub backward-compat). When using real OpenAI embeddings, the value is passed through `OpenAIEmbeddings(dimensions=...)`. Set `512` or higher for production semantic quality. **Note: this does NOT add a vector store or real RAG — `remaining-work.md` §8 remains open.**

### 🟡 13. v2.1 metadata fields the FE doesn't consume  *(BE — Resolved 2026-05-05)*

`AgentMetadata.as_dict()` no longer emits `tags`, `recursion_limit`, or `context_schema`. The fields stay on the dataclass for the runtime / router. Detail: [`remaining-work.md` §9](remaining-work.md).

### 🟡 14. v2.1 metadata fields not surfaced in UI  *(FE)*

`AgentMetadata.allowed_autonomy`, `rate_limit`, `recursion_limit`, `context_schema`, `tags` are all on the BE wire but the FE consumer reads none of them. Zero impact on user-visible behaviour today; would let the autonomy selector self-gate and a future "limits" surface render rate / budget visibly.

### 🟡 15. MCP transport deferred  *(BE)*

No `/mcp` mount, no `langchain-mcp-adapters` dependency. Explicitly deferred. Not on the GA path. Detail: [`remaining-work.md` §7](remaining-work.md), [`../archive/ai-architecture-review.md` F-15](../archive/ai-architecture-review.md).

### 🟡 16. No multi-agent orchestration / memory  *(BE)*

`board-brief-agent` and `triage-agent` re-implement drift detection. Memory namespaces (`user_preferences`, `project_profile`, `feedback`) are defined but unused. Detail: [`../archive/ai-architecture-review.md` F-13 / F-14](../archive/ai-architecture-review.md). Quality-of-life, not GA-gating.

### ✅ 17. `BaseAgentState` carries static run-scoped data  *(BE — Resolved 2026-05-10)*

`project_id`, `user_id`, `autonomy_level` migrated from `BaseAgentState` into `Runtime[Context]` per F-43.

### ✅ 18. `MutationProposalCard` undo CTA missing  *(FE — Resolved 2026-05-05)*

`MutationProposalCard` now accepts `onUndo?: () => void` and renders a conditional Undo button when `proposal.undoable === true`.

### ✅ 19. `useAi.ts:206` `TODO(v2.x)` comment  *(FE — Resolved 2026-05-05)*

Removed. The surrounding docblock already documents `useAi`'s post-v2.1 role as the deterministic local-engine fallback only.

## What's GA-ready right now

### Backend

| Surface | Status | Notes |
|---|---|---|
| v1 JSON routes (deterministic + LLM-polish) | ✅ | `task-draft`, `task-breakdown`, `estimate`, `readiness`, `search`, `board-brief`, `chat` |
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
| Durable checkpointing (Postgres) | ✅ | |
| OpenTelemetry tracing + Prometheus metrics + LangSmith | ✅ | |
| Boot-time prod guard (refuses `memory` backends) | ✅ | |
| Boot-time prod guard (explicit provider without API key) | ✅ | Added 2026-05-05 |
| Vercel SSE timeout (`maxDuration: 300`) | ✅ | Resolved 2026-05-05 |
| CI matrix (slim + full install) | ⚠️ | Wired but not yet run — see §7 |

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

## Recommended ship sequence

1. **Internal beta (today).** Deploy with `MutationProposalCard` gated off (`REACT_APP_AI_MUTATION_PROPOSALS_ENABLED=false`, default). Use the v2.1 surface for read-only / suggestion flows. Document the search/estimation quality ceiling in product copy.
2. **Design-partner GA (~3 weeks).** Close hard blocker §3 (proxy-scoped token migration), §2 (LiteLLM gateway), and §6 (real-backend integration tests). Keep proposal cards hidden.
3. **Public GA (~6–8 weeks).** Close hard blocker §1 (full `MutationProposal` lifecycle + undo) and §4 (real RAG with pgvector). Surface proposal cards.

## FE verification

```bash
npm install
npm run eslint                                              # must be clean (--max-warnings 0)
npx tsc --noEmit                                            # must be clean
CI=true npm test -- --watchAll=false --runInBand            # 142 suites / 1000 tests
npx vite build                                              # must succeed
```

## BE verification

```bash
cd backend
python -m pytest                                            # full suite, 100% coverage gate
ruff check .                                                # must be clean
```
