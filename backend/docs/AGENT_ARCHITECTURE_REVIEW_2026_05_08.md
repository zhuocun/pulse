# Agent Architecture Review — 2026-05-08

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`, `app/middleware/limits/idempotency`. Staff-engineer-level review focused on smartness (correctness), gracefulness (failure paths), scalability, and maintainability.

**Companion docs**:
- `AI_ARCHITECTURE_REVIEW.md` — earlier still-open structural concerns (provider gateway, ReAct prebuilt, multi-agent orchestration). Items there are *not* superseded by this review.
- `AI_REMAINING_WORK.md` — operational backlog.

This document is a structural complement: it catalogues the issues found in this pass, what shipped on `claude/review-agent-architecture-o0U5x`, and what was deliberately deferred (with reasons), so the next author can pick up exactly where this stopped.

**Current status (2026-05-09)**: the actionable follow-up work from this pass is complete, but the full review is **not** fully implemented. The follow-up on `cursor/finish-agent-architecture-review-14d2` added shared v1 route metadata, logical idempotency-operation keys for v1 and v2.1 agent calls, and an opt-in live Postgres smoke test. Three design seams remain deliberately deferred until there is product pressure to justify the churn: F-M2 / P3.3 (standardised polish-helper signatures through the registry), F-G2 (`RunContext`), and F-S5 (stub-branching unification).

---

## Findings catalogue

Cited at file:line. Severity is engineering judgement — none of these are GA-blockers but several were quietly doing the wrong thing.

### Smartness / correctness

| ID | Finding | Location | Severity |
|---|---|---|---|
| F-S1 | Search agent shipped candidate `text` (user-authored task / project names) to the LLM without redaction. Every other catalog agent already redacted via `redact()` / `redact_dict()` / `redact_task_fields()`. PII regression. | `app/agents/catalog/search.py:174` | High |
| F-S2 | `astream` token aggregation only ran on the success branch. Translated-exception paths (`AgentRecursionError`, `AgentExecutionError`) silently recorded zero tokens, even when the run actually consumed provider tokens before failing. Budget bookkeeping under-reported. | `app/agents/runtime.py:428-454` | Medium |
| F-S3 | Shadow-status agents were filtered at the router (`_enforce_status` in `agents.py:341`), not at the registry. A direct registry caller (other internal services, future MCP surface) would happily invoke a shadow agent. Policy lived in the wrong layer. | `app/routers/agents.py:341-356` | Medium |
| F-S4 | `BaseAgent.set_chat_model` after first `compile()` silently invalidated the cache without any signal. Tests that forgot to inject before first compile fell through to the previously-cached model with no error. Easy bug to write, invisible to read. | `app/agents/base.py:213-224` | Low |
| F-S5 | Stub-detection is split across two patterns: `chat.py:104` checks `is_stub_model()` *before* the provider call; every other agent delegates to `structured_llm_call()` which checks *inside* (`_shared.py:263`). Two ways to express the same predicate makes new agents pick the wrong template. | `app/agents/catalog/chat.py:104`, `app/agents/catalog/_shared.py:263` | Low |

### Gracefulness

| ID | Finding | Location | Severity |
|---|---|---|---|
| F-G1 | Triage agent emits `{kind: "nudge"}`; every other agent emits `{kind: "suggestion", surface: "..."}`. The FE forks its discriminator. Either consolidate under `suggestion` with `surface: "nudge"`, or document the divergence in the wire-format spec. | `app/agents/catalog/triage.py:284`, `src/interfaces/agent.d.ts:105` | Low |
| F-G2 | No agent-level observability seam. Catalog nodes that want to tag a span ("fetch_embeddings started", neighbour count, drift severity) have to import `logging` and emit unstructured logs. The runtime span (`instrumentation.py:_AgentRunSpan`) is opaque to graph nodes. | `app/agents/base.py`, `app/agents/instrumentation.py:56-148` | Low |

### Scalability

| ID | Finding | Location | Severity |
|---|---|---|---|
| F-SC1 | Single-connection Postgres checkpointer. `AsyncPostgresSaver.from_conn_string` opens one async connection; every checkpoint write serialises through it. The same applies to `AsyncPostgresStore`. Existing TODO in source. | `app/agents/checkpointing.py:183`, `app/agents/stores.py` | Medium |
| F-SC2 | Limit enforcement re-serialises the whole request body to measure size. For large bodies this is double work. Existing TODO. | `app/agents/limits.py:25-71` | Low |
| F-SC3 | Module-level middleware singletons (`rate_limit.rate_limiter`, `budget.budget_tracker`). Tests must reset them via fixtures (`test_ai_v1_router.py:47-53`); production runs share state across requests with no swap point. Blocks horizontal scale (no shared backend) and process isolation in tests. Symptoms today minor; will bite when budget/rate-limit move to Redis. | `app/middleware/rate_limit.py`, `app/middleware/budget.py` | Medium |

### Maintainability

| ID | Finding | Location | Severity |
|---|---|---|---|
| F-M1 | v1 shim hardcodes agent name strings in 9+ places. Renaming an agent in `metadata` silently breaks v1 routes. | `app/routers/ai.py:457, 504, 573, 619, 686, 751, 917, 928, 957` | Medium |
| F-M2 | v1 shim imports `polish_*` helpers directly from catalog modules. The shim is tied to catalog internals; the "deterministic baseline → polish merge" composition is hand-rolled twice (once in v1 shim, once inside the v2.1 graph) and must stay in lockstep. | `app/routers/ai.py:52-55` | Medium |
| F-M3 | Route-specific redaction field tuples in the router (`_ESTIMATE_DRAFT_FIELDS`, `_READINESS_DRAFT_FIELDS`, `_SEARCH_TASK_FIELDS`, `_SEARCH_PROJECT_FIELDS`). Agents should declare what they read; the router should redact uniformly. | `app/routers/ai.py:348-399`, `app/routers/agents.py:359-393` | Medium |
| F-M4 | Five catalog agents reimplement "validate parsed Pydantic, strip + cap each field, preserve fallback on blank" with subtle drift: search and triage validate ids against an allowlist, drafting and estimation overwrite without id validation, brief and estimation extract a single capped string. ~80 lines of near-duplicate code. | `app/agents/catalog/{board_brief,task_drafting,task_estimation,search,triage}.py` (each `_merge`) | Medium |
| F-M5 | Per-agent policy fields lack documented rationale: `recursion_limit` ranges 6–15, `rate_limit` ranges (10,60)–(30,300), `allowed_autonomy` varies between three-tuple variants, schema `max_length` ranges 80–240. Future authors copy the nearest neighbour and propagate noise. | All `AgentMetadata(...)` declarations in catalog | Low |
| F-M6 | Idempotency keys include the URL path, not the logical operation identity. Two URL aliases (`/api/ai/...` ≡ `/api/v1/ai/...`) produce different cache entries for the same logical call. URL renames invalidate replay history. | `app/routers/agents.py:574-575`, `app/routers/ai.py:443-448`, `app/middleware/idempotency_guard.py:126-128` | Low |
| F-M7 | Magic LangGraph keys: `_INTERRUPT_KEY = "__interrupt__"` is hardcoded. Brittle to LangGraph internal renames; needs at least a version-pin comment or a constant exported from a single place. | `app/agents/sse.py:35` | Trace |

---

## Shipped on `claude/review-agent-architecture-o0U5x`

Four commits, **876 tests passing, 100 % coverage, ruff clean**.

### Phase 1 — correctness fixes (commit `075684e`)

- **F-S1 fixed**: `polish_search` now redacts candidate text via `redact_dict()` and the query via `redact()` before interpolating into the prompt. The id-allowlist check at `search.py:189-193` still uses the unredacted ids so the FE round-trip is unchanged. Regression test in `test_ai_redaction.py::test_polish_search_redacts_candidate_text_before_provider`.
- **F-S2 fixed**: `runtime.astream` aggregates token usage from the final graph state on the translated-exception branches (`AgentError`, `GraphRecursionError`, `Exception`) as well as the success path. Original cause is never masked; aggregation runs in `_aggregate_astream_tokens_no_propagate`, which swallows expected aggregation failures. New tests cover both the success-with-aggregation and failure-with-aggregation paths.
- **F-S3 fixed**: `AgentRegistry.get / names / metadata` accept `include_shadow=False` (default); shadow agents raise `AgentNotFoundError` from the registry itself. Routers no longer reach into `metadata.status`. New tests verify both default-hiding and `include_shadow=True` opt-in.
- **F-S4 fixed**: `BaseAgent.set_chat_model` emits a debug log when called after first `compile()`. Greppable signal without breaking the legitimate test pattern.

### Phase 2 — catalog consolidation (commit `5f871ba`)

- **F-M4 partially fixed**: new `app/agents/catalog/_shared.py` helpers — `cap_polished_text`, `filter_to_allowed_ids`, `merge_keyed_string_updates`. Each catalog `_merge` now composes these primitives. Five `_merge` functions (board-brief, task-estimation rationale, task-estimation readiness, search, triage) collapsed into helper calls; ~80 lines of drifted code consolidated. Task-drafting's `_merge` is left inline (multi-line `note` field doesn't fit the first-line-cap pattern; documented).
- **Schema constants**: new `app/agents/catalog/_schemas.py` holds every `with_structured_output` `max_length` constant with a one-line provenance comment (FE layout cap, UX preference, conservative default). All six catalog schemas import the named constant rather than inlining `80 / 120 / 160 / 180 / 240`. Adds the previously-missing cap on `SearchRanking.expanded_terms` (`EXPANDED_TERMS_MAX = 20`).
- New tests in `test_agents_catalog.py` cover the helpers' guard branches.

### Phase 3 — declarative redaction contract (commit `d6b740a`)

- **F-M3 fixed for v2.1**: `AgentMetadata` gains three new fields:
  - `redactable_text_fields: tuple[str, ...]` — top-level string keys to redact via `redact()`.
  - `redactable_dict_fields: tuple[str, ...]` — nested objects to recursively redact via `redact_dict()`.
  - `rationale: Mapping[str, str]` — free-form `{policy_field: justification}` map (closes F-M5 *for new fields*; existing fields documented retroactively per agent).
- All six catalog agents populate `rationale` with one-line justifications for `recursion_limit`, `rate_limit`, and `allowed_autonomy`.
- `_redact_inputs` in `app/routers/agents.py` consults the metadata: built-in `prompt`/`messages` handling stays as the universal baseline, agent-declared text/dict fields are redacted opportunistically when present.
- New tests in `test_ai_redaction.py` cover both the text-field and dict-field metadata paths.

### Phase 5.2 — content-length fast-path (commit `ffb7a41`)

- **F-SC2 fixed**: `enforce_request_limits` accepts an optional `request: Request` and rejects oversized bodies via `Content-Length` *before* re-serialising the parsed payload. Falls through to the existing body-size check when the header is missing or malformed (chunked transfer, decompressed payloads). Per-field byte checks still run (they need parsed JSON). New tests for header-fastpath, malformed-header, and within-limit behaviour.

---

## Shipped on `claude/finish-subagent-orchestrator-docs-QDAmR`

Three further deferred items resolved. **881 BE tests passing, ruff clean, FE typecheck + Jest (40/40 affected hook tests) clean.**

### F-G1 — Suggestion event surface (BE + FE coordinated)

- **BE**: `app/agents/catalog/triage.py:296` now emits `{"kind": "suggestion", "surface": "nudge", "payload": fe_nudge}` matching every other catalog agent. The previous `{"kind": "nudge", "nudge": ...}` shape is gone.
- **FE type**: `src/interfaces/agent.d.ts` `CustomEvent` union loses the `kind: "nudge"` arm and gains a second `kind: "suggestion"` arm with `surface: "nudge"; payload: TriageNudge` so the discriminator narrows correctly when nudge-shaped.
- **FE consumer**: `src/utils/hooks/useAgent.ts:273-282` collapses to a single `case "suggestion"` that branches on `event.surface === "nudge"` to call `setNudges(event.payload)`; otherwise calls `setLastSuggestion`.
- **Tests**: `useAgent.test.tsx` (5 fixtures) and `useAgentChat.test.tsx` (4 fixtures) all rewritten to the new shape. New BE test `test_generate_nudges_emits_suggestion_nudge_shape` in `tests/test_triage_polish.py` asserts the wire shape directly.

### F-SC1 — AsyncConnectionPool for Postgres checkpointer / store

- `app/config.py` — new `agent_pg_pool_size: int = env_positive_int("AGENT_PG_POOL_SIZE", "10")`.
- `app/agents/checkpointing.py` — `open_checkpointer` now lazy-imports `psycopg_pool.AsyncConnectionPool` and `psycopg.rows.dict_row`, opens an `AsyncConnectionPool(conninfo=..., min_size=1, max_size=settings.agent_pg_pool_size, kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row}, open=False)`, registers it on the lifespan `AsyncExitStack`, and constructs `AsyncPostgresSaver(pool)`. The original `# TODO(perf)` is resolved.
- `app/agents/stores.py` — symmetric change for `AsyncPostgresStore(pool)`.
- For now each function opens its own pool. A one-line comment in each file flags that a future refactor can hoist to a single process-wide pool.
- `tests/test_agents.py` — extended fakes: new `_FakeAsyncConnectionPool` (with `open` / `close` / `__aenter__` / `__aexit__`); new `_install_fake_psycopg_pool_module(monkeypatch)` patching `sys.modules["psycopg_pool"]` and `sys.modules["psycopg.rows"]`; saver / store fakes refactored into callable classes that accept either a pool (new path) or a conn-string (legacy `from_conn_string`, kept for backward compatibility). All 17 postgres-backend tests pass.

### F-SC3 — DI seam for middleware singletons (staged step 1)

Per the doc's own staged-migration recommendation, this PR lands step 1 only — introduce the seam without breaking existing callers or tests. Steps 2–3 (router migration, singleton removal) remain a follow-up.

- `app/middleware/rate_limit.py` — new `get_rate_limiter(request: Request) -> RateLimitBackend` reads `request.app.state.rate_limiter`, falls back to the module-level singleton via `getattr` so unit tests bypassing the lifespan still work.
- `app/middleware/budget.py` — symmetric `get_budget_tracker(request: Request) -> BudgetBackend`.
- `app/main.py` lifespan — attaches `application.state.rate_limiter` / `application.state.budget_tracker` to the existing module-level singletons.
- `tests/test_middleware.py` — four new tests demonstrating both the `app.state` and singleton-fallback paths for each getter.
- No router or production caller changed; existing `rate_limiter.reset()` / `budget_tracker.reset()` fixture pattern is untouched. The 6 test files using that pattern continue to pass.

---

## Shipped on `cursor/finish-agent-architecture-review-7dbd`

Three of the documented follow-ups were completed. **885 BE tests passing, 100 % coverage, ruff clean.**

### F-SC3 — Inject middleware instead of importing singletons (steps 2-3)

- **Step 2 shipped**: both AI routers now receive `RateLimitBackend` / `BudgetBackend` via `Depends(get_rate_limiter)` and `Depends(get_budget_tracker)`. Shared helpers (`_gate`, `_gate_with_reservation`, `_polish_and_record`, `_enforce_rate_limit`, `_enforce_budget`, `_record_real_usage`) accept the injected backends explicitly, so no production route reaches into `rate_limit.rate_limiter` or `budget.budget_tracker` anymore.
- **Test isolation shipped**: router-facing test suites moved off `rate_limiter.reset()` / `budget_tracker.reset()` teardown. `tests/conftest.py` now provides per-test `ai_rate_limit_backend` / `ai_budget_backend` fixtures and autouse `app.dependency_overrides[...]` wiring, so router tests get fresh backends without mutating shared module state.
- **Step 3 shipped for the production path**: `app.main._configure_middleware_backends()` now returns app-owned limiter / budget backends, and the FastAPI lifespan stores them on `application.state`. Redis selection is therefore an app-state swap point rather than a router import convention. The module-level singleton fallback remains only for lightweight tests / mini-apps that bypass lifespan startup.

### F-SC1 follow-up — process-wide pool sharing

- `AgentRuntime.from_settings_async()` now reuses one `AsyncConnectionPool` when the checkpointer and store both use Postgres and resolve to the same DSN. `open_checkpointer()` / `open_store()` still support their standalone paths, but accept an injected pool so the shared-lifespan case enters and cleans up the pool exactly once.
- `tests/test_agents.py` now asserts the shared-pool path, the split-DSN path (two pools), and concurrent lifespans (one pool per runtime, not process-global leakage).
- The original "real Postgres smoke test" follow-up shipped later on `cursor/finish-agent-architecture-review-14d2`; see the live-smoke section below.

### F-M7 — Magic LangGraph key

- `app/agents/sse.py` now documents `_INTERRUPT_KEY = "__interrupt__"` as the single LangGraph-compat shim, with an explicit note that a future upstream rename should only require a one-line update there.

---

## Shipped on `cursor/finish-agent-architecture-review-14d2`

The remaining actionable follow-ups were resolved or converted into explicit opt-in coverage.

### F-M1 / P4.1 — Legacy v1 route metadata

- `app/routers/ai.py` now has a typed `LegacyAiRouteMeta` table for all seven legacy `/api/ai/*` handlers. The table centralises envelope keys, metrics/rate-limit labels, catalog agent names, and logical idempotency operations so handler-local string drift is no longer the source of truth.
- Existing handler bodies remain separate because their deterministic and polish merge paths have route-specific wire contracts, but every handler now resolves its shared identity through the table.

### F-M6 / P4.2 — Idempotency by logical operation

- `app/middleware/idempotency_guard.py` accepts an optional `operation_id`; both `app/routers/ai.py` and `app/routers/agents.py` pass stable operation identities instead of relying on raw URL paths.
- `app/middleware/idempotency.py` also canonicalises the dual-mounted v1 AI prefixes (`/api/ai/*` and `/api/v1/ai/*`) so legacy aliases replay the same cached response.
- `tests/test_idempotency.py` covers operation-id replay, AI prefix alias replay, mismatch handling across aliases, and a real v1 chat replay across both mounted prefixes.

### F-SC1 follow-up — live Postgres smoke path

- `tests/test_agents_postgres_live.py` is an opt-in smoke test gated by `PYTEST_AGENT_POSTGRES_URI`. When pointed at a throwaway Postgres database, it exercises `AgentRuntime.from_settings_async()` with both agent persistence backends set to Postgres, asserts the saver and store share the same real `AsyncConnectionPool`, probes the database through that pool, and verifies the exit stack closes it.
- The normal backend suite skips this test when the env var is unset, so the default in-memory/fakeredis suite still has no external service dependency.

---

## Deferred (with rationale)

Each deferred item is independently shippable in a follow-up PR. Reasons are explicit so the next author isn't guessing what was tried.

### F-S5 / P2.3 — Stub-branching unification

**What the plan said**: Move chat's pre-call `is_stub_model` check into a shared `chat_with_stub_fallback(...)` helper alongside the existing `structured_llm_call(...)`.

**Why deferred**: chat uses `bind_tools` (not `with_structured_output`), has special `asyncio.CancelledError` / `GeneratorExit` handling for client disconnects, and has a stub-response-on-exception fallback that no other agent has. A unified helper would have a callback signature awkward enough that callers still effectively have to re-implement chat's flow. The duplication is ~10 lines in one file, not five — extracting it would obscure rather than clarify.

**To revisit if**: a second non-structured agent appears (e.g. a multi-turn planning agent) with the same shape.

### F-G1 / P2.4 — Standardise the suggestion event surface — **shipped**

Resolved on `claude/finish-subagent-orchestrator-docs-QDAmR`; see the section above.

### F-M2 / P3.3 — Polish helpers via the registry

**What the plan said**: Add `agent.deterministic()` and `agent.polish()` accessors on `BaseAgent` that lazy-import functions referenced in `polish_fn_path` / `deterministic_fn_path`. The v1 shim then calls `runtime.get(name).polish(...)` instead of importing `polish_draft` directly.

**Why deferred**: each polish function has a different signature (`polish_headline(model, deterministic, facts)` vs `polish_draft(model, deterministic, prompt, similar)` vs `polish_search(model, deterministic, query, candidates)`). The v1 shim still has to know the signature to pass arguments — so removing the import statement does not actually decouple the shim from the catalog. The cleaner fix is to standardise the polish signature to `polish(model, deterministic, **kwargs)` and parse `kwargs` inside each polish helper. The `cursor/finish-agent-architecture-review-14d2` pass reduced the practical risk by centralising route identity and catalog agent names; a full polish signature migration is now a standalone follow-up, not required for the completed idempotency / route-metadata fix.

### F-M1, F-M2 / P4.1 — V1_ROUTES dispatcher table — **shipped for shared route identity**

**What the plan said**: Replace seven near-identical handlers in `routers/ai.py` (`task_draft`, `task_breakdown`, `estimate`, `readiness`, `board_brief`, `search`, `chat`) with a single dispatcher driven by a `V1_ROUTES` table that names the agent, the deterministic function, the polish function, and any per-route post-processing hook.

**Outcome**: `cursor/finish-agent-architecture-review-14d2` landed the safe half of this refactor: a typed route metadata table now owns the common route identity, envelope key, catalog agent name, metrics label, and idempotency operation. The handlers still keep their route-specific post-processing because chat's reservation/reconciliation flow, task-breakdown's per-item suffix re-application, and search's `projectContext` envelope are materially different.

A future full single-dispatcher rewrite would still need:
1. Standardising the polish signature (see P3.3 above).
2. Extending the typed route metadata into a `V1Route` dataclass that captures the gate variant and post-processor.
3. Migrating one handler at a time to the dispatcher, running the v1 test suite at each step.

The remaining value is now lower because the drift-prone strings and idempotency identities are centralised.

### F-M6 / P4.2 — Idempotency keys by `(agent, payload)` — **shipped**

**What the plan said**: Cache key derived from a logical operation identity rather than a raw URL path. The shipped shape keeps Stripe-style client keys (`Idempotency-Key`) but uses operation strings such as `legacy-ai:v1-task-draft`, `agent:{name}:invoke`, and `agent:{name}:stream` for the slot and fingerprint identity. The body fingerprint still hashes the canonical operation plus payload so same-key / different-body replays remain 422.

Resolved on `cursor/finish-agent-architecture-review-14d2`; see the section above.

### F-SC1 / P5.1 — AsyncConnectionPool for Postgres checkpointer / store — **shipped**

Resolved across `claude/finish-subagent-orchestrator-docs-QDAmR`, `cursor/finish-agent-architecture-review-7dbd`, and `cursor/finish-agent-architecture-review-14d2`; see the sections above. The shared-pool refactor is shipped, and the live Postgres smoke path is now available behind `PYTEST_AGENT_POSTGRES_URI`.

### F-SC3 / P5.3 — Inject middleware instead of importing singletons — **shipped**

Step 1 (introduce DI getters with the singleton as default) shipped on `claude/finish-subagent-orchestrator-docs-QDAmR`. Steps 2-3 shipped on `cursor/finish-agent-architecture-review-7dbd`: routers now receive the backends via `Depends(...)`, tests isolate them through `app.dependency_overrides`, and the production app owns the live limiter / budget instances on `app.state`. The module-level singletons remain only as a fallback for mini-app / unit-test scenarios that do not run the lifespan.

### F-G2 / P6.1 — `RunContext` for graph-node observability

**What the plan said**: Augment `BaseAgent.invoke/ainvoke/astream` to thread an `AgentRunContext` (active span, metric bag, structured-log adapter) into the LangGraph context schema. Catalog nodes can `ctx.span.set_attribute(...)` instead of using a module logger.

**Why deferred**: additive but plumbing-heavy. LangGraph's context is a typed schema per agent; adding a shared `RunContext` either forces every agent's context schema to inherit from a base (mild type-system gymnastics) or requires a sidecar mechanism (e.g. a contextvar). Both work; both warrant their own design pass. No agent currently *needs* this seam to ship correctly.

---

## Pickup checklist for the next pass

After the `cursor/finish-agent-architecture-review-14d2` round, the actionable items from this review have shipped. The remaining items are conditional design seams:

1. **F-M2 / P3.3 (polish-helper signature standardisation)** — revisit when v1 shim / catalog duplication starts blocking agent work. Route identity is now centralised, but the direct `polish_*` imports remain because the helpers still have incompatible argument shapes.
2. **F-G2 (RunContext)** — schedule when a catalog agent first asks for a tracing seam. Today only 3 catalog log call sites exist (all error paths in `__init__.py`, `_shared.py`, `chat.py`), so the demand isn't there yet.
3. **F-S5 (stub-branching unification)** — revisit if a second non-structured agent appears (e.g. a multi-turn planning agent) with the same `bind_tools` shape as `chat`.
