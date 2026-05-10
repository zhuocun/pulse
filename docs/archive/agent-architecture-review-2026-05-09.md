# Agent Architecture Review — 2026-05-09

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`,
`app/services/v1_engine.py`, supporting middleware. Staff-engineer-level
structural review and forward-looking restructuring plan.

**Companion docs**:
- `agent-architecture-review-2026-05-08.md` — granular findings catalogue
  for fixes that shipped on `claude/review-agent-architecture-o0U5x`.
  This document does not duplicate those entries; it is a complement that
  steps back to the layer-coupling and duplication patterns the
  per-finding pass left in place.
- `ai-architecture-review.md` — earlier structural concerns (provider
  gateway, ReAct prebuilt, multi-agent orchestration). Several items
  there map onto the phases below.
- [`../operations/remaining-work.md`](../operations/remaining-work.md) — operational backlog.

The 2026-05-08 review's deferred items F-G2 (per-node observability seam)
and F-S5 (stub-branching unification) are subsumed by Phase 2 and
Phase 3 of this plan respectively.

---

## Context

The Pulse backend ships six LangGraph-based agents (`board-brief`,
`triage`, `task-drafting`, `task-estimation`, `chat`, `search`) sitting
behind two HTTP surfaces: the v1 JSON shim (`/api/ai/*` in
`app/routers/ai.py`, ~1190 lines) and the v2.1 SSE surface
(`/api/v1/agents/*` in `app/routers/agents.py`, ~990 lines). The agents
share infrastructure under `app/agents/` (~1670 lines core + 1700 lines
of catalog) and feed FE wire shapes via `app/agents/sse.py`.

The system is *correct* and well-instrumented (OTel spans, Prometheus
counters, idempotency, redaction, rate-limit + budget gates). But three
years of evolution have accreted parallel paths and cross-cutting leaks:
agents reach into HTTP/streaming concerns, routers reach into agent
internals, and "deterministic stub vs real model" branching is
duplicated in every catalog module, every polish helper, the v1 engine,
and the v1 shim. Adding a seventh agent today requires touching at
least eight files; adding a seventh v1 route copies ~100 lines of
scaffolding.

This document is a structural review followed by a phased remediation
plan. Each phase is independently shippable; phases are ordered so that
earlier work removes coupling that later work would otherwise have to
preserve.

---

## Status — 2026-05-09

Implementation tracked on `claude/review-agent-architecture-drvY9`,
continued on `claude/complete-subagent-orchestrator-fbQHj`.

**Re-verified 2026-05-10** (`claude/complete-subagent-orchestrator-bswBw`):
every Phase 1–6 row, every architectural follow-up, and every latent
defect listed below is still marked Resolved against the current code.
No new residue has appeared since the last re-check. F-G2 and F-S5
remain conditional and have no waiting consumer (see the 2026-05-08
companion doc for the deferral rationale).

### Phase 1 — Collapse the v1 shim onto the agent runtime — **complete**

| Item | Status | Commit |
|---|---|---|
| `AgentRuntime.arun_with_events` (capture `(state, custom_events)` via `astream(stream_mode=("values","custom"))`) | shipped | `82094d6` |
| `fetch_snapshot_node` / `fetch_similar_node` short-circuit when state pre-populated | shipped | `82094d6` |
| `SearchAgent.fetch_candidates` short-circuit | shipped | `82094d6` |
| `build_citation_refs` default `get_id` falls back from `id` to `_id` | shipped | `82094d6` |
| Byte-shape parity goldens for all 7 `/api/ai/*` routes (`tests/test_v1_ai_shim_parity.py`) | shipped | `82094d6` |
| `/api/ai/board-brief` migrated to `runtime.arun_with_events` | shipped | `5e82f2d` |
| `/api/ai/task-draft` migrated | shipped | `e287b6b` |
| `/api/ai/task-breakdown` migrated | shipped | `e287b6b` |
| `/api/ai/estimate` migrated | shipped | `e287b6b` |
| `/api/ai/readiness` migrated | shipped | `e287b6b` |
| `/api/ai/search` migrated | shipped | `e287b6b` |
| `/api/ai/chat` migrated to `arun_with_events` (today goes through `ainvoke`) | shipped | `e287b6b` |
| 502-fallback parametrised coverage for the 5 migrated structured routes | shipped | `18568d3` |
| Privatise `polish_*` helpers (`polish_*` → `_polish_*`) once no router imports them | shipped | `e287b6b` |
| Slim `app/services/v1_engine.py` to helpers without an agent equivalent (file deleted; helpers absorbed into catalog modules) | shipped | `a302052` |

### Phase 2 — Make agent outputs first-class, not side-effects — **complete**

| Item | Status | Commit |
|---|---|---|
| `events: Annotated[list[dict], add_events]` field on `BaseAgentState`; `add_events` reducer mirrors `add_messages` | shipped | `2be1605` |
| `app/agents/events.py` with typed `Suggestion` / `Citation` / `Usage` Pydantic models + `coerce_event` / `as_event_dict` helpers | shipped | `2be1605` |
| Six catalog modules migrated from `emit_custom(...)` / `emit_usage(...)` side effects to returning `{"events": [...]}` from nodes | shipped | `2be1605` |
| `runtime.astream` re-emits state-delta events as `("custom", evt)` for SSE wire continuity; `arun_with_events` reads from `final_state["events"]` | shipped | `2be1605` |
| Token usage flows through `messages[*].usage_metadata` end-of-run; tests for `get_stream_writer` mocks rewritten to assert on `state["events"]` directly | shipped | `2be1605` |

### Phase 3 — PolishStep DSL — **complete**

| Item | Status | Commit |
|---|---|---|
| `app/agents/polish.py` with `PolishStep` (prompt builder, schema, fallback, redaction, cap, merge) and four-cell matrix unit tests | shipped | `ba44346` |
| Migrate `_polish_headline` (board_brief), `polish_triage` (triage), `_polish_draft` (task_drafting), `_polish_rationale` + `_polish_readiness` (task_estimation), `_polish_search` (search) onto `PolishStep` | shipped | `7bb4e15` |
| Drop `structured_llm_call` from `_shared.py` (no remaining callers); keep `cap_polished_text` and `merge_keyed_string_updates` (still used by merge closures) | shipped | `7bb4e15` |

### Phase 4 — Decouple model resolution from graph compilation — **complete**

| Item | Status | Commit |
|---|---|---|
| `app/agents/context.py` with `ChatContext(TypedDict)` carrying `chat_model`, `user_id`, `project_id` | shipped | `56a092d` |
| Runtime resolves the model per call: caller-supplied `context["chat_model"]` overrides; otherwise falls back to `agent.chat_model`. Wired through `invoke`, `ainvoke`, `arun_with_events`, `astream` | shipped | `56a092d` |
| Six catalog nodes read the model via `get_runtime(ChatContext).context.chat_model` instead of capturing it on `self` at build time | shipped | `56a092d` |
| `tests/test_runtime_context.py` covers context-override priority, default fallback, two-call isolation, and `set_chat_model` propagation | shipped | `56a092d` |

### Phase 5 — Linear-pipeline scaffolding for graphs and HTTP — **complete**

| Item | Status | Commit |
|---|---|---|
| `app/agents/pipeline.py` with `linear_graph(state, [(name, fn), ...])`; five linear catalog agents migrated; chat agent stays manual | shipped | `674c0a9` |
| `WithBoardSnapshot` / `WithDriftResult` / `WithSimilarTasks` TypedDict mixins; per-agent state composes from `BaseAgentState` + relevant mixins; duplicate field declarations removed | shipped | `5ad677e` |
| `app/routers/_dispatch.py:run_v1_route` factory; the five structured v1 routes collapse to a thin handler each (project_inputs / project_body) | shipped | `ca8b3fb` |

### Phase 6 — Hardening — **complete**

| Item | Status | Commit |
|---|---|---|
| Explicit catalog manifest replaces import-time `registry.register(...)` side-effects; broken catalog modules are now FATAL at lifespan startup, not silently degraded | shipped | `fea6045` |
| Single FE-tool source of truth (`fe_tool_schemas.CHAT_TOOL_SCHEMAS`); LangChain `@tool` stubs in `_chat_tools.py` are generated from the schema rather than redeclared | shipped | `39dae9a` |
| Signed thread keys (`sigv1.<base64>` HMAC-SHA256 envelope over `(agent, user, original)` using the JWT secret) replace iterative-strip; old unsigned tokens still validated as a backwards-compat fallback | shipped | `147ea50` |
| `app.state.embeddings` populated at lifespan startup; `_embeddings_singleton` global removed; module-level `registry` retained as the runtime's backing store for test-fixture compatibility (per-app isolation deferred) | shipped | `d9d2983` |

### Post-phase fix — triage polish token leak

| Item | Status | Commit |
|---|---|---|
| `generate_nudges` discarded the polish raw `AIMessage` after Phase 2, so triage's polish tokens were never aggregated by `_aggregate_astream_tokens` / `_token_usage_from_events` (other five catalog agents propagate the message correctly). Added `_polish_triage` 4-tuple helper and prepended the raw message to `state["messages"]`; regression test added. | shipped | `9285e51` |

---

## Deferred / follow-up

The phases above shipped against scope; these items were consciously
punted or surfaced during the post-Phase-6 code review. Each is
recoverable from commits + code, but they live here so the next reader
doesn't repeat the archaeology.

### Architectural follow-ups

- ~~**Per-app registry isolation (Phase 6D residual)**~~: **Resolved.**
  `AgentRuntime.from_settings*` now constructs a per-app
  `ChainedAgentRegistry` (writes go local; reads fall through to the
  module-level `default_registry`).  Two app instances in the same
  process can no longer mutate each other's agent set, while existing
  test fixtures that register test-only agents into the global *after*
  the FastAPI lifespan has built the runtime continue to work because
  reads still fall through.  No fixture migration needed.
- ~~**Build-cache invalidation race (Phase 4 residual)**~~: **Resolved.**
  `BaseAgent.compile` / `acompile` now use double-checked locking
  with two layers: an `asyncio.Lock` serialises concurrent async
  waiters during a cache miss (no more `asyncio.to_thread` trampoline
  for lock acquisition), and the existing `threading.Lock` is held
  briefly only for the three cache-field writes so cross-path
  consistency between sync `invoke()` (in a threadpool) and async
  `astream()` (on the event loop) is preserved.  Cache hits — the
  dominant path post-warmup — take *neither* lock.  The actual
  `self.build()` call is still dispatched via `asyncio.to_thread`
  because graph compilation is CPU-bound.
- **`_chat_tools.py` partial single-source (Phase 6B residual)**:
  ~~`build_chat_tools()` iterates `CHAT_TOOL_SCHEMAS` but the body is
  an `if/elif` chain.~~ **Resolved** by commit `ad2817a`: the function
  is now a real data-driven generator that builds each LangChain tool
  stub directly from the schema entry; adding a `CHAT_TOOL_SCHEMAS`
  row produces a stub with no further code change.
- ~~**`X-Pulse-Model` header / tenant-config routing (Phase 4 follow-up)**~~:
  **Resolved.** New `AGENT_CHAT_MODEL_ALLOWLIST` setting gates which
  model ids the per-request `X-Pulse-Model` header may select. When the
  allowlist is empty the feature is off (header is rejected with a
  400 `unsupported_chat_model`); otherwise allowlisted ids are built via
  `make_chat_model_for_id()` (inherits provider/credentials from
  settings) and injected as `context["chat_model"]` so the runtime
  picks them up. Wired through `_dispatch.run_v1_route` (five v1
  routes), the v1 chat handler in `routers/ai.py`, and the v2.1
  `invoke` / `stream` handlers in `routers/agents.py` (merged with
  payload `context`). Tenant-config routing is a follow-up but the
  injection point is no longer dead.
- **`_shared.py` final cleanup (Phase 3 residual)**: ~~`cap_polished_text`
  and `merge_keyed_string_updates` remain in `_shared.py`.~~ **Resolved**
  by commit `f802dd8`: both helpers' canonical implementations now live
  in `app/agents/polish.py`; `_shared.py` only re-exports them for
  backward compatibility with existing imports.

### Defects worth flagging (not regressions; latent)

- ~~**`_dispatch.py` `UnboundLocalError` on null fallback**~~: **Resolved**
  in PR #173. `body`, `final_state`, `custom_events` are pre-initialised
  before the `try` block (`_dispatch.py:122-124`); the `body is None`
  branch now also checks `final_state is None` and emits the standard
  `agent_unavailable` 502 instead of falling through.
- ~~**Cross-user signed thread token surfaces as 5xx**~~: **Resolved**
  in PR #173. `_namespaced_thread` (`runtime.py:328-332`) catches the
  `ValueError` from `_try_verify_signed_thread_key` and re-raises a
  dedicated `InvalidThreadKeyError` (a 4xx-mapped subclass of
  `AgentError`). Coverage: `tests/test_agents.py:1488,1513`.
- ~~**No JWT secret rotation strategy for signed thread tokens**~~:
  **Resolved.** New `sigv2.<base64url>` envelope embeds a `kid` that
  selects the secret from `AGENT_THREAD_SIGNING_KEYS` (a comma-separated
  list of `kid:secret` entries; the *last* entry is the active signing
  kid so operators rotate by appending). When the env is empty,
  signing falls back to the legacy `sigv1.` envelope (no behaviour
  change for clients that don't need rotation). Verification accepts
  both prefixes during rolling restarts; an unknown kid is a soft
  failure (returns `None` and falls through to the unsigned-fallback
  path, never crashes).
- ~~**`PolishStep.cap_text` parameter is dead**~~: **Resolved.** The
  deprecated parameter has been removed from `PolishStep.__init__`;
  `cap_field=(field_name, max_chars)` is the only supported shorthand.

---

## Design issues identified

### A. Two parallel agent execution paths (highest leverage)

`app/routers/ai.py` is not a thin transport adapter — it is a *second*
agent runtime that:

- imports and calls polish helpers directly: `polish_headline`,
  `polish_search`, `polish_draft`, `polish_rationale`, `polish_readiness`
  (`app/routers/ai.py:53-56`).
- reaches into the registry to grab a model:
  `runtime.get(agent_name).chat_model` (`app/routers/ai.py:370`).
- re-runs `app/services/v1_engine.py` deterministic logic that overlaps
  with each agent's deterministic baseline (e.g. `v1_engine.board_brief`
  at `routers/ai.py:821` vs the same call inside `BoardBriefAgent.build`
  at `catalog/board_brief.py:316`).
- duplicates citation building (`routers/ai.py:828-845`) that the
  agent's own `emit_citations` node already produces.
- depends on `build_recommendation_detail` being module-scoped purely
  because the v1 shim cannot run a graph (`catalog/board_brief.py:152-178`,
  with a comment explicitly calling out the leak).

Consequence: every behavioural change must be made twice and stay
consistent. The v1 shim's chat endpoint (`routers/ai.py:1067-1192`)
*does* go through `runtime.ainvoke`, proving the agent path can serve
v1 — the structured routes don't because the shim was written before
the agent graphs existed and was never collapsed.

### B. `AgentMetadata` is a kitchen sink for cross-cutting policy

`AgentMetadata` (`app/agents/base.py:45-145`) declares: name, version,
tags, recursion_limit, context_schema, status, rate_limit (read by the
rate-limit middleware), allowed_autonomy, FE tools, redactable text/
dict fields, and free-form rationale. The agent now owns:

- HTTP redaction policy (read in `routers/agents.py:_redact_inputs`).
- middleware quotas (`DEFAULT_LIMIT` imported from
  `middleware.rate_limit` into the agent base class).
- autonomy validation (`routers/agents.py:_resolve_autonomy`).
- the FE tool catalog (mixed with internal recursion semantics).

A static dataclass cannot model these as separate concerns; a single
agent module ends up declaring transport-layer rules. New cross-cutting
features (e.g. per-agent tracing sampling, per-agent retries) will
continue to land here unless we split it.

### C. Catalog agents perform side-effects through a thread-local global

Every catalog graph node calls `emit_custom({...})` and `emit_usage(...)`
directly. The implementation in `app/agents/stream.py:18-41` calls
LangGraph's `get_stream_writer()` and *silently no-ops outside a stream
context*. Consequences:

- The `/invoke` JSON path cannot see the suggestions/citations the
  agents produce — which is precisely why `routers/ai.py` re-builds
  citations and recommendation detail by hand (issue A).
- Tests must use either real streaming or accept that the side-effect
  was swallowed; the wire-shape is asserted at multiple distant call
  sites.
- The agent's "what does it produce?" is split between the return value
  (state-update dict) and an out-of-band stream of dicts the agent
  reaches for via a global.
- Wire shapes (`{"kind": "suggestion", "surface": "brief", ...}`) are
  hard-coded in agent code rather than declared once in `sse.py` (which
  already owns the *envelope* layer but not the inner `kind` types).

### D. "Deterministic stub vs real model" is a system-wide branch

Three layers each duplicate the same fallback ladder:

1. `polish_*` helpers in every catalog module short-circuit on
   `is_stub_model(model)` and on any provider exception, returning the
   deterministic input unchanged.
2. `v1_engine.py` is *another* deterministic implementation of the same
   surfaces (board brief, draft, estimate, readiness, search), used by
   the v1 shim before polish.
3. Each catalog agent has its own `_draft_from_prompt`, `_estimate_for`,
   `_readiness`, `_nudges_for` helper that is yet another copy of
   "deterministic baseline".

Effects:

- Three sources of truth for the deterministic shape; updates can
  diverge (`v1_engine.draft_task` vs `task_drafting._draft_from_prompt`
  return slightly different defaults).
- Real-model code paths only run when API keys are configured, so test
  coverage is misleadingly high — the polish branch is the one most
  prone to regressions.
- The "stub-or-fallback" pattern has no name. Every author re-writes it.

### E. Per-route HTTP boilerplate

Six v1 routes (`task-draft`, `task-breakdown`, `estimate`, `readiness`,
`board-brief`, `search`) each repeat the same ~80 lines:

```
auth → meta lookup → unwrap envelope → idempotency check → replay branch
→ try: gate → enforce limits → redact → v1_engine.X → resolve model →
stub branch / polish branch → idem.store → record → return
except: _idem_fail
```

Plus the chat route (~125 lines, similar shape with a reservation gate
and provider-call extraction). The v2.1 router has its own analogous
scaffolding for `invoke` (~130 lines) and `stream` (~200 lines). All of
this is structural — not behaviour — and a change to (e.g.) idempotency
keying touches nine handlers.

### F. Graph build binds the chat model in a closure

`BaseAgent.build` is called once and the resulting `Pregel` closes over
`self.chat_model`. `set_chat_model` invalidates the cache and forces a
rebuild, which is racy for in-flight invocations and makes per-request
model overrides (A/B tests, tenant routing, fallback to a cheaper model)
impossible without a full recompile. The cache is guarded by a
`threading.Lock` accessed from async paths via `asyncio.to_thread`
(`base.py:308-324`) — workable, but indicates the design is fighting its
constraints.

### G. Process-wide singletons and import-time registration

- `app.agents.registry.registry` is a module-level singleton.
- Catalog modules call `registry.register(..., replace=True)` at import
  time; auto-discovery walks `pkgutil.iter_modules`.
- `_embeddings_singleton` is a module global with double-checked locking.
- `_last_discovery_failures` is a module global.

This works for a single-process FastAPI worker but blocks: per-tenant
configurations, in-memory hot-reload (already special-cased with
`replace=True`), test isolation that does not require `clear()`, and
multi-runtime apps. The auto-discovery loop hides registration order
and silently degrades on import failures — broken modules become
"missing" agents.

### H. State schemas have no composition

`app/agents/state.py` is a flat hierarchy: `BaseAgentState` plus 5
per-agent TypedDicts. `BoardBriefState` and `TriageState` both declare
`board_snapshot` and `drift_result` (same shape, same source); the two
agents' graph nodes share the same `fetch_snapshot` and `detect_drift`
function bodies (`catalog/_shared.py:163-227`). Composition (mixins or
small `Snapshot`/`Drift` modules combined per agent) would make this
explicit. TypedDicts also offer no runtime validation — a node can
return `{"draft": "string"}` where a dict was expected and LangGraph
keeps going.

### I. Token usage is reconciled in three places

- Catalog nodes emit `{"kind": "usage", ...}` events via `emit_usage`
  (`_shared.py:230-239`).
- The SSE router scrapes those events out of the envelope and totals
  them (`routers/agents.py:909-920`).
- The runtime separately re-reads tokens from the final graph state
  (`runtime.py:_aggregate_astream_tokens`).
- The v1 shim has its own reconciliation in `_polish_and_record`
  (`routers/ai.py:375-405`).

These can drift. A graph that emits no usage event but has tokens on its
`AIMessage` ends up with different totals on the wire vs in OTel.

### J. FE-tool catalog is duplicated

`app/agents/catalog/_chat_tools.py` declares LangChain `@tool` stubs for
`listProjects`, `listMembers`, etc. — bound to the chat agent at
graph-build time. The same names are exposed to the FE through
`app/tools/fe_tool_schemas.py` (`/api/v1/agents/_tools`). They are
maintained in parallel with no compile-time link.

### K. `_namespaced_thread` does string-level security

`runtime.py:186-237` iteratively strips `{agent}:{any_segment}:` prefixes
from a client-supplied `thread_id` to prevent prefix-injection into
another user's checkpoint namespace. This is a real attack surface, but
solving it with string manipulation is brittle. A structured key (an
opaque server-issued token, or a tuple persisted in the checkpointer)
avoids the class of bugs entirely.

### L. Auto-discovery is implicit and silent

`catalog/__init__.py:53-86` imports every public submodule. A
`SyntaxError` or missing dependency in any module is logged once and
then silently dropped from the registry. The failure surface is a
delayed health-check entry on `last_discovery_failures()` — not a
startup failure. A new agent author who breaks an import sees the agent
missing from `/api/v1/agents` rather than seeing the error.

---

## Resolution plan

The plan is split into 6 phases. Phases 1–2 are the highest leverage and
unblock the rest. Phases 3–5 each remove a category of duplication.
Phase 6 is hardening. Each phase is independently shippable, behind
feature flags where the FE wire is involved.

### Phase 1 — Collapse the v1 shim onto the agent runtime

**Targets issues**: A, C, D

**Critical files**:
- `app/routers/ai.py` (rewrite)
- `app/routers/agents.py` (extend with non-streaming JSON return)
- `app/agents/runtime.py` (add `arun_sync` that returns a structured
  result + collected custom events)
- `app/agents/sse.py` (factor out the wire-shape registry — see Phase 2)
- delete `app/agents/catalog/_shared.py:fetch_snapshot_node` /
  `fetch_similar_node` re-export from the v1 shim path

**Approach**:

1. Add a runtime entry point that runs the graph to completion and
   returns `(final_state, [custom_events])`. The current
   `runtime.ainvoke` discards custom events; adapt by attaching a
   buffering stream writer (LangGraph's `get_stream_writer` is settable
   per-runnable). This makes "JSON request → JSON response with all
   suggestions/citations" a first-class operation.

2. Replace each v1 route in `app/routers/ai.py` with a thin handler that
   calls `runtime.arun_sync(agent_name, inputs)` and projects the final
   state + custom events into the legacy wire envelope (e.g. board-brief
   returns the `brief` payload + `recommendationDetail` built from the
   same custom-event stream the SSE router consumes).

3. Delete `polish_*` direct imports from `routers/ai.py` and the
   `_resolve_polish_model` shim. Polish helpers become *private* to
   their catalog module (rename `polish_*` → `_polish_*`).

4. Delete `app/services/v1_engine.py`'s overlap with catalog determinism
   — keep only the helpers that have no agent equivalent (e.g.
   `_clamp_fibonacci`) and move them under `app/domain/`. Catalog agents
   already produce deterministic output on the stub model, so there is
   no functional reason for two parallel implementations.

5. Stretch: move `build_recommendation_detail` into the agent's graph as
   a final node and return it via state, not via a public function.

**Verification**:
- Existing pytest suite (101 v1-shim tests in `backend/tests/test_ai_*`)
  still passes against the new dispatch path.
- New parity tests assert the v1 wire payload is byte-identical for the
  deterministic-stub case, before/after the change.
- Manual: `curl /api/ai/board-brief` and `/api/ai/task-draft` return the
  same JSON before and after.

### Phase 2 — Make agent outputs first-class, not side-effects

**Targets issues**: C, I (and 2026-05-08 F-G2)

**Critical files**:
- `app/agents/state.py` (add `events: list[dict]` to `BaseAgentState`)
- `app/agents/stream.py` (rewrite as adapter, not silent no-op)
- `app/agents/sse.py` (introduce `EVENT_TYPES` registry of
  `{kind → schema}`)
- All six catalog modules (replace `emit_custom` calls with state
  returns)

**Approach**:

1. Replace inline `emit_custom({...})` with appending to a typed `events`
   field on the agent state. LangGraph already accumulates list state
   via reducers; an `add_events` reducer (mirror of `add_messages`)
   gives us the same accumulation semantics.

2. The HTTP/SSE layer is the *only* place that translates
   `state["events"]` to LangGraph custom-stream chunks (for the SSE
   case) or to a JSON array (for the JSON case). Agents stop knowing
   about the stream writer.

3. Move event-shape declarations (`Suggestion`, `Citation`, `Usage`,
   `Nudge`) into typed Pydantic models in `app/agents/events.py` so the
   FE contract has one source of truth.

4. Token usage becomes a property of the run, not an event: the runtime
   reads `extract_token_usage` once at the end and stamps the result on
   the response envelope. Catalog agents stop calling `emit_usage(...)`;
   the runtime aggregates from `messages`.

5. The runtime's `_aggregate_astream_tokens` and the SSE router's
   `_maybe_capture_usage` can both be deleted in favour of the single
   end-of-run aggregation.

**Verification**:
- Snapshot tests on the SSE wire: each catalog agent's stream still
  emits the same envelopes in the same order.
- The `/invoke` JSON response now carries the events array; the v1 shim
  (Phase 1) reads it instead of guessing.

### Phase 3 — Generalise "deterministic baseline → polish → merge"

**Targets issues**: D, B (partial), F (partial), 2026-05-08 F-S5

**Critical files**:
- new `app/agents/polish.py` (single class)
- `app/agents/catalog/_shared.py` (delete `structured_llm_call`,
  `cap_polished_text`, `merge_keyed_string_updates` once callers
  migrate)
- All six catalog modules (replace ad-hoc polish calls with a single
  `PolishStep.run(state)` invocation)

**Approach**:

1. Define a `PolishStep` (or `Polishable`) abstraction that owns: prompt
   builder, Pydantic schema, fallback (deterministic value), merge
   function, redaction policy, max-length caps, and the call to
   `with_structured_output`. Each catalog agent declares one or more
   `PolishStep` instances per polish pass instead of writing the
   try/except + token-extract dance.

2. Per-step redaction (`redact_dict`, `redact_task_fields`) becomes a
   declarative attribute on the step. Agents stop importing redaction
   helpers directly.

3. The model is passed *into* `PolishStep.run(state, model)` rather than
   captured at build time, which is a stepping stone for Phase 4.

**Verification**:
- Behaviour is preserved: same prompts, same schemas, same fallbacks.
- Unit tests on `PolishStep` cover the four matrix cells: stub model,
  real model success, real model parse error, real model raise.

### Phase 4 — Decouple model resolution from graph compilation

**Targets issues**: F

**Critical files**:
- `app/agents/base.py` (drop `chat_model` capture; `build` no longer
  takes the model)
- `app/agents/runtime.py` (resolve and inject model per call via
  LangGraph `Runtime[Context]`)
- All six catalog modules (read the model off the runtime context, not
  off `self`)

**Approach**:

1. Move the chat model from agent instance to per-call context.
   LangGraph 1.x's `context_schema` + `Runtime[Context]` is purpose-built
   for this and is already declared (but unused) in the metadata.

2. The runtime resolves a `ChatModelSpec` per call (default: settings;
   override: per-request header / per-tenant config) and passes the
   instantiated model on the context.

3. `BaseAgent.set_chat_model` and the graph cache invalidation race
   disappear.

4. `_compiled_checkpointer` / `_compiled_store` cache entries can be
   simplified — once the model is no longer captured, the only reason
   to invalidate is when the persistence layers change, which only
   happens at app boot.

**Verification**:
- A/B test: a single process can serve two concurrent requests with
  different chat models without rebuilding the graph.
- The compile-cache lock can become an `asyncio.Lock` on the async
  path, removing the `asyncio.to_thread` trampoline.

### Phase 5 — Linear-pipeline scaffolding for graphs and HTTP

**Targets issues**: E, G (partial), H

**Critical files**:
- new `app/agents/pipeline.py` (DSL for linear graphs)
- new `app/routers/_dispatch.py` (single handler factory for v1 + v2.1)
- All six catalog modules (graph definitions become a list of nodes)
- `app/routers/ai.py` and `app/routers/agents.py` (call the factory)

**Approach**:

1. Five of six agents are linear: `START → A → B → C → END`. Define a
   `LinearGraph(state, [nodes])` helper that builds `StateGraph` + edges
   in one line. The chat agent stays manual or uses a `Branch` helper.
   Cuts ~20 lines per agent.

2. Express HTTP scaffolding as a pipeline of middleware-style stages:
   `[idempotency, gate, limits, redact, dispatch, idem_store, record]`.
   Each route becomes the agent name + the field projection needed for
   the legacy envelope. ~600 lines of router boilerplate collapses to
   ~120.

3. State composition: split shared snapshot / drift / similar fields
   into `WithBoardSnapshot`, `WithDriftResult`, `WithSimilarTasks`
   TypedDict mixins. Per-agent state is the union of mixins it uses.
   Removes the duplicate field declarations in `BoardBriefState` /
   `TriageState`.

**Verification**:
- The diff for adding a 7th catalog agent should now be a single module
  (~80 lines, mostly prompt + node bodies) and a single line in the
  wire-envelope projection if a v1 alias is needed.

### Phase 6 — Hardening

**Targets issues**: G, J, K, L

**Critical files**:
- `app/agents/registry.py`
- `app/agents/catalog/__init__.py`
- `app/tools/fe_tool_schemas.py` + `app/agents/catalog/_chat_tools.py`
- `app/agents/runtime.py` (`_namespaced_thread`)

**Approach**:

1. **Registration becomes explicit**. Replace import-time
   `registry.register(...)` with a manifest in
   `app/agents/catalog/__init__.py` that explicitly imports each agent
   class and registers it at app-lifespan startup. Removes silent-
   degrade behaviour: a missing dependency now fails the deploy.

2. **Single FE-tool source of truth**. Generate `CHAT_TOOLS` from
   `fe_tool_schemas.py` instead of redeclaring them. The schema already
   carries names, descriptions, and arg shapes; the LangChain `@tool`
   wrapper can be auto-built per definition.

3. **Structured thread keys**. Replace the iterative-strip pattern in
   `_namespaced_thread` with an opaque token that the server signs and
   the client opaquely echoes. The (agent, user, original_thread_id)
   triple is the signed payload. Eliminates the prefix-injection class.

4. **Replace process singletons with per-app instances** for
   `_embeddings_singleton` (move onto `app.state`) and the registry
   (one per `AgentRuntime`). Catalog modules export factories, not
   side-effects.

**Verification**:
- Deploy with a deliberately broken agent module — the lifespan fails
  at startup, not silently at request time.
- An older client's signed thread token still validates after a rolling
  restart.
- `python -m pytest` runs without needing any module-global cleanup
  fixtures.

---

## What this plan deliberately does **not** change

- LangGraph as the orchestration layer. The issues above are about how
  we use it, not about the framework choice.
- The SSE wire contract with the FE. Phases 1–6 preserve the byte-shape
  of `/api/ai/*` responses and `StreamPart` envelopes.
- The 100% backend coverage gate. Each phase ships with parity tests
  and the existing pytest suite remains green throughout.
- The Postgres / memory / none persistence backends. The checkpointing
  architecture is sound; only the per-call thread-key derivation
  changes (Phase 6).

---

## Sequencing & estimated effort

### Original estimate (for reference)

| Phase | Predicted net LOC | Predicted effort |
|-------|------------------|------------------|
| 1. Collapse v1 shim | -800 | ~3 days |
| 2. Outputs as state | ±0 | ~2 days |
| 3. PolishStep DSL | -300 | ~2 days |
| 4. Model on context | -100 | ~1 day |
| 5. Pipeline + dispatch | -700 | ~3 days |
| 6. Hardening | ±0 | ~2 days |
| **Total** | **~−1900** | **~13 days** |

### Measured outcome

The aggressive LoC predictions did not materialise — the catalog
modules grew slightly to accommodate `PolishStep` wrappers and the
backwards-compatible 4-tuple polish helpers, and `runtime.py` grew
because the signed-thread-key code and per-call context resolution
were additive. The structural wins (one polish call site per agent,
one route factory, one events reducer) landed; the headline LoC
reduction did not.

Measured layout after all phases (commit `9285e51`):

```
backend/app/agents/
├── base.py              396 lines (was 396 — unchanged; lock kept)
├── runtime.py           846 lines (was 547; +sigv1, +ChatContext, +token agg)
├── registry.py          102 lines (unchanged)
├── pipeline.py    NEW    45 lines
├── polish.py      NEW   181 lines
├── events.py      NEW   121 lines
├── context.py     NEW    46 lines
├── state.py             154 lines (with mixins)
├── sse.py               258 lines
├── stream.py            DELETED
└── catalog/
    ├── _chat_tools.py    176 lines
    ├── _schemas.py        97 lines
    ├── _shared.py        294 lines
    ├── __init__.py       129 lines (manifest)
    ├── board_brief.py    531 lines
    ├── chat.py           186 lines
    ├── search.py         581 lines
    ├── task_drafting.py  537 lines
    ├── task_estimation.py 657 lines
    └── triage.py         357 lines
```

`routers/ai.py` shrank materially: 1258 → 1002 lines (-256), with the
common scaffolding extracted to `_dispatch.py` (174 lines new). Net
across `routers/ai.py` + `_dispatch.py`: -82 LoC.

The structural goal — "new agent is a single module; new HTTP route is
a one-line wire projection" — is achievable today even though the
overall code volume stayed roughly flat.

---

## End-to-end verification across all phases

1. `cd backend && python -m pytest` — full suite, 100% coverage gate.
2. `ruff check .` clean.
3. Manual SSE smoke: open `BoardBriefDrawer` in the FE, observe the same
   `interrupt → updates → custom(suggestion) → custom(citation) →
   messages → DONE` sequence as before.
4. Manual JSON smoke: `POST /api/ai/board-brief`, `/api/ai/task-draft`,
   `/api/ai/estimate`, `/api/ai/readiness`, `/api/ai/search`,
   `/api/ai/chat` — wire shape unchanged vs main.
5. Load a deliberately broken agent module on a deploy preview and
   confirm the lifespan fails (Phase 6 only).
