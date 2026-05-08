# Agent Architecture Review — 2026-05-08

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`, `app/middleware/limits/idempotency`. Staff-engineer-level review focused on smartness (correctness), gracefulness (failure paths), scalability, and maintainability.

**Companion docs**:
- `AI_ARCHITECTURE_REVIEW.md` — earlier still-open structural concerns (provider gateway, ReAct prebuilt, multi-agent orchestration). Items there are *not* superseded by this review.
- `AI_REMAINING_WORK.md` — operational backlog.

This document is a structural complement: it catalogues the issues found in this pass, what shipped on `claude/review-agent-architecture-o0U5x`, and what was deliberately deferred (with reasons), so the next author can pick up exactly where this stopped.

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

## Deferred (with rationale)

Each deferred item is independently shippable in a follow-up PR. Reasons are explicit so the next author isn't guessing what was tried.

### F-S5 / P2.3 — Stub-branching unification

**What the plan said**: Move chat's pre-call `is_stub_model` check into a shared `chat_with_stub_fallback(...)` helper alongside the existing `structured_llm_call(...)`.

**Why deferred**: chat uses `bind_tools` (not `with_structured_output`), has special `asyncio.CancelledError` / `GeneratorExit` handling for client disconnects, and has a stub-response-on-exception fallback that no other agent has. A unified helper would have a callback signature awkward enough that callers still effectively have to re-implement chat's flow. The duplication is ~10 lines in one file, not five — extracting it would obscure rather than clarify.

**To revisit if**: a second non-structured agent appears (e.g. a multi-turn planning agent) with the same shape.

### F-G1 / P2.4 — Standardise the suggestion event surface

**What the plan said**: Triage emits `{kind: "suggestion", surface: "nudge", payload: fe_nudge}` matching every other agent. FE updates `agent.d.ts` discriminator and `useAi*` hooks to listen for `surface === "nudge"`.

**Why deferred**: BE → FE wire-format change must be atomic. The Python venv on this branch can't run the FE Jest suite, and 9+ FE test files reference `kind: "nudge"` (`useAgent.test.tsx`, `useAgentChat.test.tsx`, `nudgeCard/index.tsx`). Shipping just the BE half breaks the live FE; shipping just the FE half is meaningless. Needs a coordinated branch with FE tests run.

### F-M2 / P3.3 — Polish helpers via the registry

**What the plan said**: Add `agent.deterministic()` and `agent.polish()` accessors on `BaseAgent` that lazy-import functions referenced in `polish_fn_path` / `deterministic_fn_path`. The v1 shim then calls `runtime.get(name).polish(...)` instead of importing `polish_draft` directly.

**Why deferred**: each polish function has a different signature (`polish_headline(model, deterministic, facts)` vs `polish_draft(model, deterministic, prompt, similar)` vs `polish_search(model, deterministic, query, candidates)`). The v1 shim still has to know the signature to pass arguments — so removing the import statement does not actually decouple the shim from the catalog. The cleaner fix is to standardise the polish signature to `polish(model, deterministic, **kwargs)` and parse `kwargs` inside each polish helper, but that is a larger refactor than this seam justifies on its own. Better tackled alongside F-M1 / P4.1 below.

### F-M1, F-M2 / P4.1 — V1_ROUTES dispatcher table

**What the plan said**: Replace seven near-identical handlers in `routers/ai.py` (`task_draft`, `task_breakdown`, `estimate`, `readiness`, `board_brief`, `search`, `chat`) with a single dispatcher driven by a `V1_ROUTES` table that names the agent, the deterministic function, the polish function, and any per-route post-processing hook.

**Why deferred**: ~600 lines of seven handlers, each with subtly different gate / idempotency / agent-label logic; every handler has its own quirks (chat's reservation/reconciliation flow, task-breakdown's per-item suffix re-application, search's `projectContext` envelope). The test suite couples to the per-handler shape. A safe migration needs:
1. Standardising the polish signature (see P3.3 above).
2. Building a typed `V1Route` dataclass that captures the gate variant, idempotency strategy, and post-processor.
3. Migrating one handler at a time to the dispatcher, running the v1 test suite at each step.

This is a multi-day refactor. Out of scope for the surgical-fixes-and-seams pass.

### F-M6 / P4.2 — Idempotency keys by `(agent, payload)`

**What the plan said**: Cache key derived from `(auth_subject, agent_name, sha256(canonical_payload))` rather than `(auth_subject, route, raw_idempotency_key)`. Survives URL aliasing and agent rename.

**Why deferred**: meaningful test churn (`test_idempotency.py` is keyed on the path-based cache shape), and the practical impact is low — clients rarely re-key the same Idempotency-Key against two URL aliases. Better as a follow-up alongside F-M1.

### F-SC1 / P5.1 — AsyncConnectionPool for Postgres checkpointer / store

**What the plan said**: Resolve the existing TODO by wiring an `AsyncConnectionPool` per process at lifespan startup; pass it to `AsyncPostgresSaver(conn=pool)` and `AsyncPostgresStore(conn=pool)`. Configure pool size via `AGENT_PG_POOL_SIZE` (default 10).

**Why deferred**: the existing test fakes (`_FakeAsyncPostgresHandle`, `_install_fake_postgres_saver_module` in `test_agents.py:540-600`) stub `AsyncPostgresSaver.from_conn_string`. Switching to the pool pattern requires writing new fakes for `psycopg_pool.AsyncConnectionPool` and the direct `AsyncPostgresSaver(conn=pool)` constructor. Code change is small, test change is moderate. Recommend doing it alongside a Postgres integration smoke test so the pool's lifecycle is exercised against a real DB.

### F-SC3 / P5.3 — Inject middleware instead of importing singletons

**What the plan said**: Wrap `rate_limit.rate_limiter` and `budget.budget_tracker` in FastAPI dependencies, with the singleton attached to `app.state` at lifespan startup. Routers receive the instance via `Depends(get_rate_limiter)`; tests get clean per-test instances via FastAPI's dependency overrides.

**Why deferred**: every test fixture currently calls `rate_limiter.reset()` / `budget_tracker.reset()` in setup/teardown. Migrating to DI without breaking the existing reset pattern requires either a parallel teardown shim or rewriting every fixture. Recommended sequencing: (1) introduce the DI getters with the singleton as default; (2) migrate one test file at a time to override; (3) remove the singletons.

### F-G2 / P6.1 — `RunContext` for graph-node observability

**What the plan said**: Augment `BaseAgent.invoke/ainvoke/astream` to thread an `AgentRunContext` (active span, metric bag, structured-log adapter) into the LangGraph context schema. Catalog nodes can `ctx.span.set_attribute(...)` instead of using a module logger.

**Why deferred**: additive but plumbing-heavy. LangGraph's context is a typed schema per agent; adding a shared `RunContext` either forces every agent's context schema to inherit from a base (mild type-system gymnastics) or requires a sidecar mechanism (e.g. a contextvar). Both work; both warrant their own design pass. No agent currently *needs* this seam to ship correctly.

---

## Pickup checklist for the next pass

The deferred items are not equally cheap. Suggested order if a follow-up branch tackles them:

1. **F-G1 (suggestion event surface)** — small BE change + FE coordination. Highest UX clarity gain.
2. **F-SC1 (AsyncConnectionPool)** — small code, moderate test rewrite. Real production scalability win.
3. **F-M1 + F-M2 + F-M6 + P3.3 (V1_ROUTES dispatcher + idempotency keys)** — single coordinated refactor. Largest maintenance dividend.
4. **F-SC3 (DI middleware)** — unblocks Redis-backed budget/rate-limit. Pair with a Redis adapter PR.
5. **F-G2 (RunContext)** — schedule when a catalog agent first asks for a tracing seam.
