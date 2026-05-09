# Agent Architecture Review — 2026-05-09

**Scope**: `app/agents/**`, `app/routers/agents.py`, `app/routers/ai.py`,
`app/services/v1_engine.py`, supporting middleware. Staff-engineer-level
structural review and forward-looking restructuring plan.

**Companion docs**:
- `AGENT_ARCHITECTURE_REVIEW_2026_05_08.md` — granular findings catalogue
  for fixes that shipped on `claude/review-agent-architecture-o0U5x`.
  This document does not duplicate those entries; it is a complement that
  steps back to the layer-coupling and duplication patterns the
  per-finding pass left in place.
- `AI_ARCHITECTURE_REVIEW.md` — earlier structural concerns (provider
  gateway, ReAct prebuilt, multi-agent orchestration). Several items
  there map onto the phases below.
- `AI_REMAINING_WORK.md` — operational backlog.

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

Implementation tracked on `claude/review-agent-architecture-drvY9`.

### Phase 1 — Collapse the v1 shim onto the agent runtime

| Item | Status | Commit |
|---|---|---|
| `AgentRuntime.arun_with_events` (capture `(state, custom_events)` via `astream(stream_mode=("values","custom"))`) | shipped | `82094d6` |
| `fetch_snapshot_node` / `fetch_similar_node` short-circuit when state pre-populated | shipped | `82094d6` |
| `SearchAgent.fetch_candidates` short-circuit | shipped | `82094d6` |
| `build_citation_refs` default `get_id` falls back from `id` to `_id` | shipped | `82094d6` |
| Byte-shape parity goldens for all 7 `/api/ai/*` routes (`tests/test_v1_ai_shim_parity.py`) | shipped | `82094d6` |
| `/api/ai/board-brief` migrated to `runtime.arun_with_events` | shipped | `5e82f2d` |
| `/api/ai/task-draft` migrated | pending | — |
| `/api/ai/task-breakdown` migrated | pending | — |
| `/api/ai/estimate` migrated | pending | — |
| `/api/ai/readiness` migrated | pending | — |
| `/api/ai/search` migrated | pending | — |
| `/api/ai/chat` migrated to `arun_with_events` (today goes through `ainvoke`) | pending | — |
| Privatise `polish_*` helpers (`polish_*` → `_polish_*`) once no router imports them | pending | — |
| Slim `app/services/v1_engine.py` to helpers without an agent equivalent | pending | — |

### Phases 2–6 — not yet started

No work landed on phases 2 (events as state), 3 (PolishStep DSL),
4 (model on context), 5 (pipeline + dispatch), or 6 (hardening).

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

| Phase | Net LOC | Dev effort | Ship gate |
|-------|---------|-----------|-----------|
| 1. Collapse v1 shim | -800 | ~3 days | Parity tests pass |
| 2. Outputs as state | ±0 | ~2 days | SSE snapshot stable |
| 3. PolishStep DSL | -300 | ~2 days | Per-cell tests pass |
| 4. Model on context | -100 | ~1 day | A/B routing works |
| 5. Pipeline + dispatch | -700 | ~3 days | New-agent diff <100 LOC |
| 6. Hardening | ±0 | ~2 days | Manifest deploy gate |
| **Total** | **~−1900** | **~13 days** | |

After Phase 5 the agents directory is approximately:

```
backend/app/agents/
├── base.py              ~120 lines (was 396)
├── runtime.py           ~280 lines (was 547)
├── registry.py           ~80 lines (was 102)
├── pipeline.py    NEW   ~150 lines
├── polish.py      NEW   ~120 lines
├── events.py      NEW    ~80 lines
├── state.py             ~120 lines (mixins)
├── sse.py               ~250 lines
├── stream.py            DELETED
└── catalog/
    ├── *.py             ~80–120 lines each (was 200–440)
    └── _shared.py       ~80 lines (was 370)
```

Net: about 1900 fewer lines of application code, with the cross-cutting
duplication collapsed onto small, well-named primitives. New agents
become one-file changes; new HTTP routes become one-line wire
projections.

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
