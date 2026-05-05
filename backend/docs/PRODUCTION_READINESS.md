# Production Readiness — Board Copilot AI Surface

Consolidated view of what is GA-ready, what is internal-beta-only, and what blocks a public ship. Source of truth for severity; for the per-item detail and remediation steps see [`AI_REMAINING_WORK.md`](AI_REMAINING_WORK.md) (operational) and [`AI_ARCHITECTURE_REVIEW.md`](AI_ARCHITECTURE_REVIEW.md) (structural).

Last updated: 2026-05-05 (re-audit on `claude/v2.1-ai-readiness-check-TbxeM`; hardening fixes on `claude/v2.1-ai-readiness-review-0w9BG` — commit `0e990e4`).

## TL;DR

- **GA-ready surfaces.** All v1 deterministic JSON routes; v2.1 SSE read-only / suggestion flows for `board-brief`, `task-drafting`, `task-estimation`, `search`, `chat` (read-only tools only), `triage` nudges; per-project AI opt-out, rate limiting, monthly token budgets, OpenTelemetry, Prometheus, idempotency, durable checkpointing, boot-time prod guards.
- **Internal beta only.** The full v2.1 surface with proposal cards visible — see Hard Blocker §1.
- **Blocks public GA.** Three hard blockers below; the rest is degraded-quality polish.

## ⚠️ GA blocker urgency — resolve ASAP

**The AI surface is NOT ready for public GA.** The three 🛑 hard blockers below are release gates, not backlog items. Until each is closed, the only acceptable deployment posture is **internal beta with proposal cards gated off on the FE** (see Hard Blocker §1 mitigation).

- **Every day each hard blocker stays open is risk.** §1 ships a dead-end UX once a proposal slips into a deployed build; §2 makes a single upstream Anthropic/OpenAI 5xx a full outage with no fallback; §3 leaves the AI proxy token co-located with the primary REST JWT in `localStorage`, so any FE XSS exfiltrates both.
- **Assign owners per blocker, not per polish item.** §8–§11 polish can slip; §1–§3 cannot.
- **No public marketing, no design-partner expansion, no removal of the FE proposal-card gate** until §1, §2, §3 all show ✅ in this doc.
- **Re-audit weekly** until ✅. If a blocker is reclassified, justify it in this file with file:line evidence.

The Recommended ship sequence at the bottom of this doc is the contract: internal beta → design-partner GA → public GA, gated on the explicit blocker closures listed there.

## Severity tags

- **🛑 GA-blocker.** Customer-visible failure or material security risk. Must close before public ship.
- **⚠️ Soft blocker.** Quality or reliability ceiling that limits scope; ship-able with documented caveats.
- **🟡 Polish.** Internal hygiene; no customer impact.

## Hard blockers — must close before public GA

### 🛑 1. `MutationProposal` accept path is dead in remote mode

**Verdict (2026-05-05 re-audit):** still open. No agent emits `custom/mutation_proposal`; no `fe.applyMutation` interrupt is registered. Confirmed out of scope for `claude/v2.1-ai-readiness-check-TbxeM`.

The FE renders `MutationProposalCard` and calls `agent.resume({accepted: true})` on accept, but no BE agent emits `custom/mutation_proposal`, no `fe.applyMutation` interrupt is registered, and there is no undo endpoint behind the `undoable` badge. A user who sees a proposal in production today gets a card that goes nowhere.

- Surface: any agent that would propose mutations (most naturally `chat-agent` for tool-driven mutations, future `board-coach-agent` for proactive ones).
- Detail and proposed shape: [`AI_REMAINING_WORK.md` §12](AI_REMAINING_WORK.md).
- Effort: multi-week. Touches agent runtime, tool registry, mutation execution path, and AC-V5 preapproved-tools spec.
- **Mitigation for internal beta:** keep the proposal-card render path gated off in deployed builds (the FE already supports omitting `pendingProposal`).

### 🛑 2. No provider fallback on 5xx

**Verdict (2026-05-05 re-audit):** still open. No AI gateway, no provider list, no circuit breaker. Confirmed out of scope for `claude/v2.1-ai-readiness-check-TbxeM`. Tracked as [`AI_REMAINING_WORK.md` §14](AI_REMAINING_WORK.md).

A Claude or OpenAI 5xx bubbles straight to the user. There is no AI gateway (LiteLLM, Portkey), no failover policy, no hedged requests, no semantic cache. A single upstream incident is a full outage.

- Detail: [`AI_ARCHITECTURE_REVIEW.md` F-9](AI_ARCHITECTURE_REVIEW.md).
- Effort: ~1 week to wire LiteLLM behind `make_chat_model` (`ChatOpenAI(base_url=...)` is sufficient since LiteLLM is OpenAI-compatible).

### 🛑 3. JWT-in-localStorage XSS surface

**Verdict (2026-05-05 re-audit):** still open. The AI proxy still reuses the primary FE bearer. Confirmed out of scope for `claude/v2.1-ai-readiness-check-TbxeM` (cross-repo migration).

The FE stores the primary bearer JWT in `localStorage` and the AI proxy reuses it verbatim. Any FE XSS exfiltrates the AI proxy token alongside the REST API token. Documented in [`AI_REMAINING_WORK.md` "Out of scope §Auth"](AI_REMAINING_WORK.md) but explicitly "not yet scheduled."

- Mitigation path: proxy-scoped token with a narrow claim set, or httpOnly cookie. The FE side change is tracked in `jira-react-app/docs/PRODUCTION_READINESS.md`.
- Effort: ~1 week (token issuance endpoint + FE migration + middleware update).

## Soft blockers — ship-able with documented caveats

### ⚠️ 4. Search and estimation quality ceiling

`task-estimation-agent` neighbour scoring runs only on FE-supplied `similar_tasks`. No persistent vector store. `search-agent` ranks FE-supplied candidates; no real RAG. ~~The OpenAI embedding branch is hard-pinned to 16 dimensions~~ — the 16-dim pin is lifted as of `0e990e4` (`EMBEDDINGS_DIMENSIONS` env var, default `16` for stub back-compat); **set `EMBEDDINGS_DIMENSIONS=512` (or higher) when using real OpenAI embeddings**. The absence of a vector store / real RAG remains open.

- Detail: [`AI_REMAINING_WORK.md` §8](AI_REMAINING_WORK.md), [`AI_ARCHITECTURE_REVIEW.md` F-18 / F-19](AI_ARCHITECTURE_REVIEW.md).
- Effort: multi-week (pgvector + backfill job + `vector_search` tool). Embedding-dim config is now unblocked.
- **Acceptable scope:** suggestion-grade search and estimation, not retrieval-grade. Disclose in product copy.

### ⚠️ 5. No structured-output validation

Catalog agents emit `AIMessage(content=json.dumps(...))` and clients `json.loads`. Once an LLM replaces the deterministic stubs the schema can rot silently — there is no `response_format=Pydantic(...)` contract.

- Detail: [`AI_ARCHITECTURE_REVIEW.md` F-10](AI_ARCHITECTURE_REVIEW.md).
- Effort: ~3 days to define schemas under `app/agents/schemas/` and migrate to `create_agent(..., response_format=...)`.
- **Mitigation for now:** the FE validates every payload (`validateDraft`, `validateEstimate`, `validateBoardBrief`, `validateSearch`) and drops unknown ids. A schema regression degrades but does not corrupt.

### ⚠️ 6. Synthetic 100% coverage — no integration tests

`pyproject.toml` `--cov-fail-under=100` is met against deterministic stubs. There are no tests against real Anthropic/OpenAI, real Redis, or real Postgres. The CI matrix added 2026-05-05 (`test-full` / `test-slim`) catches optional-import regressions but not real-backend regressions.

- Detail: [`AI_ARCHITECTURE_REVIEW.md` F-42](AI_ARCHITECTURE_REVIEW.md).
- Effort: ~1 week to add an `integration` pytest marker, a CI job behind a secret-gated flag, and Redis/Postgres service containers.

### ⚠️ 7. CI workflow not yet validated against GitHub Actions

`.github/workflows/ci.yml` landed on `claude/v2.1-ai-features-vjZSA` (2026-05-05) but no GHA run has executed yet. The slim job (`pip install -e ".[dev]"` + `python -c "import app.main"`) is untested in the GHA environment.

- Effort: open a PR to trigger the first run; iterate until green.

## Polish — no customer impact

### 🟡 15. Input size limits — **Resolved 2026-05-05** (`0e990e4`)

`enforce_request_limits` added to every v1 (`POST /api/ai/*`) and v2.1 (`POST /api/v1/agents/*/{invoke,stream}`) endpoint. Defaults: 64 KiB total body (`AI_MAX_BODY_BYTES`), 8 KiB prompt (`AI_MAX_PROMPT_BYTES`), 50 messages (`AI_MAX_MESSAGES`), 8 KiB per-message content (`AI_MAX_MESSAGE_CONTENT_BYTES`). Returns HTTP 413 on violation. All limits are overridable via env vars without a code change. 13 new tests in `tests/test_ai_limits.py`.

### 🟡 16. PII leak from `/estimate` and `/readiness` task fields — **Resolved 2026-05-05** (`0e990e4`)

`taskName`, `note`, `epic`, and `coordinatorId` on `/estimate` and `/readiness` requests now run through `redact_task_fields` (`app/tools/redaction.py`) before the LLM polish call. Closes the leak documented in PRD §5A.10. Response shape unchanged. 9 new tests in `tests/test_ai_redaction.py`.

### 🟡 17. Embedding dimensions hard-pinned to 16 — **Resolved 2026-05-05** (`0e990e4`)

`EMBEDDINGS_DIMENSIONS` env var added (`app/config.py`, default `16` for stub backward-compat). When using real OpenAI embeddings, the value is passed through `OpenAIEmbeddings(dimensions=...)` in `app/agents/embeddings.py`. Set `512` or higher for production semantic quality. The stub path always returns 16 regardless. **Note: this does NOT add a vector store or real RAG — `AI_REMAINING_WORK.md` §8 remains open.**

### 🟡 8. v2.1 metadata fields the FE doesn't consume — **Resolved 2026-05-05**

`AgentMetadata.as_dict()` no longer emits `tags`, `recursion_limit`, or `context_schema`. The fields stay on the dataclass for the runtime / router. Closed on `claude/v2.1-ai-readiness-check-TbxeM`.

- Detail: [`AI_REMAINING_WORK.md` §9](AI_REMAINING_WORK.md).

### 🟡 9. MCP transport deferred

No `/mcp` mount, no `langchain-mcp-adapters` dependency. Explicitly deferred. Not on the GA path.

- Detail: [`AI_REMAINING_WORK.md` §7](AI_REMAINING_WORK.md), [`AI_ARCHITECTURE_REVIEW.md` F-15](AI_ARCHITECTURE_REVIEW.md).

### 🟡 10. No multi-agent orchestration / memory

`board-brief-agent` and `triage-agent` re-implement drift detection. Memory namespaces (`user_preferences`, `project_profile`, `feedback`) are defined but unused.

- Detail: [`AI_ARCHITECTURE_REVIEW.md` F-13 / F-14](AI_ARCHITECTURE_REVIEW.md). Quality-of-life, not GA-gating.

### 🟡 11. `BaseAgentState` carries static run-scoped data

`project_id`, `user_id`, `autonomy_level` belong in `Runtime[Context]`, not State.

- Detail: [`AI_ARCHITECTURE_REVIEW.md` F-43](AI_ARCHITECTURE_REVIEW.md). Refactor under `context_schema=`; ~1 day.

## What's GA-ready right now

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

## Recommended ship sequence

1. **Internal beta (today).** Deploy with proposal cards hidden via FE flag. Use the v2.1 surface for read-only / suggestion flows. Document the search/estimation quality ceiling in product copy.
2. **Design-partner GA (~3 weeks).** Close hard blocker §3 (proxy-scoped token), §2 (LiteLLM gateway), and §6 (real-backend integration tests). Keep proposal cards hidden.
3. **Public GA (~6–8 weeks).** Close hard blocker §1 (full `MutationProposal` lifecycle + undo) and §4 (real RAG with pgvector). Surface proposal cards.
