# Agent notes

Short, durable gotchas for anyone (human or AI) editing this repo. Add an entry
when a fix is non-obvious from the code alone.

## Coding harness

Code in this repo should be **precise · efficient · readable · scalable ·
well-architected · well-designed · testable · robust · rigorous ·
decompositional · smart · approaching 100% coverage**. Concretely:

- **Precise.** Types are the contract. No `any` in production; use `unknown` +
  narrowing at boundaries. Validate at edges (HTTP, FE↔BE wire, env, user
  input); trust internal calls — don't double-guard. Constants for every wire
  string (see `backend/app/tools/fe_tool_names.py`; never a bare `"fe.foo"`
  literal).
- **Efficient.** No silent N² patterns. React: memoize only the expensive
  thing — premature `useMemo` clutters more than it helps. Backend: prefer
  streaming/iterators over materialising. Bundle chunks stay under 1 MB
  unminified; `vite build` under 5 s.
- **Readable.** A function should be readable cold. Name says what; body says
  how. Default to **zero comments** — they rot. Only comment the WHY of a
  non-obvious constraint, subtle invariant, or workaround. **Never** embed PR
  IDs, optimisation-plan tags (`P2-D`, `B-R11`, `review follow-up #N`), or
  "added for issue #123" — meaningless after the PR merges.
- **Scalable.** A change should not require touching N similar files. If you
  edit the same shape in 5 places, factor it (see
  `src/utils/hooks/_createOverlayHook.ts`). Single source of truth: tool names
  (`FE_*` constants), microcopy (`src/constants/microcopy.ts`), routes, env
  config. The Mongo-only repository keeps the `Repository` protocol as a seam
  for future stores.
- **Well-architected.** Boundaries are explicit. The agent runtime owns gates
  (rate limit, budget, idempotency, redaction); routers wire HTTP; the
  repository owns persistence. Don't smear concerns across modules. The Vercel
  proxy at `api/index.ts` is the **only** edge into the backend in deploy
  builds.
- **Well-designed.** APIs are the smallest thing the caller actually needs.
  Don't pre-design for futures you can't see. Three similar lines beats a
  premature factory; abstract only when the third caller appears and the shape
  is stable.
- **Testable.** No module-level mutable singletons. If unavoidable, expose
  `reset*ForTests` and document why (see `useApi` rate-limiter as the
  cautionary tale). Inject dependencies; don't fetch them from the global.
  Hooks have one job — split by responsibility, not by file count.
- **Robust.** Fail fast at startup for misconfiguration (BE `_validate_settings`
  raises before the first request). Fail soft at runtime for transient errors.
  Every async call respects `AbortController`/unmount. Every interrupt has a
  defined resolver or an explicit HITL pause.
- **Rigorous.** Wire contracts are pinned by tests on both sides:
  `FE_TOOL_REGISTRY` count matches `ALL_FE_TOOL_NAMES` matches
  `FE_TOOL_SCHEMAS`. Every BE-advertised tool has an FE resolver. Every
  `interrupt(NAME, ...)` callsite resolves to a registry entry or an explicit
  HITL special case.
- **Decompositional.** A file over 800 LOC of business code is a smell;
  extract subcomponents along functional seams. A hook with 5 single-call
  siblings is over-split — inline them. Decompose by responsibility, not
  cosmetic file count.
- **Smart.** Don't add error handling, fallbacks, or validation for cases
  that can't happen. Don't paper over inconsistency with defensive shims —
  fix the root cause. Trust framework guarantees; only validate at system
  boundaries.
- **100% coverage as aspiration, 85% as floor.** Backend `pytest` runs
  `--cov-fail-under=85`; real coverage sits ~98%. Write tests for every
  branch you add — never write tests purely to hit a coverage line (see the
  deleted `test_coverage_filling.py`). The gate is a floor, not a target.

## Other guardrails

- **Dependencies.** Test/build tooling lives in `devDependencies`; `@types/*`
  always in devDeps. Before adding a dep: is it used in source? If a dep has
  one call site, inline it (see lodash `isEqual` → inlined `shallowEqual` in
  `taskModal/index.tsx`). Audit periodically with
  `grep -rn "from \"$pkg" src/`.
- **Configuration coherence.** One source per concern: Node version in
  `.nvmrc` only. Don't ship `requirements.txt` *and* `pyproject.toml` *and*
  `uv.lock` all racing each other — pick the canonical one. Three sources of
  truth means three places to drift.
- **Doc–code coherence.** When you delete code, update or delete every doc
  that names it **in the same PR**. A stale "✅ Resolved" entry pointing at
  files that no longer exist is a worse lie than the deletion itself.
  Verifier logs, orchestrator scratch (`.orchestrate/`), and dated status
  snapshots belong in `.gitignore` — never in the repo.
- **Deprecation discipline.** A compat shim deserves a removal date. After
  sunset: delete, don't preserve "for older clients" forever (see the
  `fe.applyMutation` removal across FE and BE). Mark deprecated entries
  with the date they should disappear.
- **Backwards compat at boundaries only.** Internal refactors don't need
  shims. External-facing surfaces (wire contracts, env vars, public APIs)
  do — and only until the next major version.
- **Accessibility minimums.** Every interactive control declares a 44px
  touch target under `@media (pointer: coarse)` (WCAG 2.5.8); see the
  `*/index.test.tsx` "declares a touch-target height" tests. Every
  top-level surface passes `axe-core` without violations (see
  `src/__tests__/uiAccessibility.strict.test.tsx`). Button microcopy
  flows through `src/constants/microcopy.ts` — never hard-code `Submit`,
  `OK`, `Login`, `Signup`, `Edit Task`, `Create Project` as labels.
  ESLint enforces this via `no-restricted-syntax`.
- **Observability.** Pick one telemetry stack and commit. Running OTel
  and Prometheus side-by-side doubles the dimension surface for half
  the value.
- **No god components / god tests.** Production components or test files
  over 800 LOC are smells — split by topic. The current outliers
  (`aiChatDrawer/index.tsx`, `useAgent.ts`) are tech debt, not models.
- **Heritage tracking is debt.** `docs/todo/*.md` drifts by design — keep
  it slim; remove shipped entries; never duplicate PR history that lives
  in `git log` and `git blame`.

## Keep the backlog current

Add or remove items in the relevant `docs/todo/*.md` in the same PR. Don't
restate blockers in `README.md` or PR descriptions — link to the entry.

## v2.1 agent surface (`useAgent`)

- Both `useAi` (v1 JSON) and `useAgent` (v2.1 SSE) commonly mount unconditionally
  in components that switch on `environment.aiUseLocalEngine`. This is required —
  conditionally calling either hook breaks React's hook-ordering rule. See
  `AiChatDrawer` and `BoardBriefDrawer` for the canonical pattern.
- Migration progress for the six structured routes lives in
  `docs/todo/product-done.md`. As of 2026-05-05, all six are on the
  v2.1 SSE surface in remote builds (each component dual-mounts `useAgent`
  alongside `useAi` and switches on `environment.aiUseLocalEngine`). `useAi`
  remains the local-engine fallback path.
- Triage nudges are subject to PRD AC-V14 inbox rules in
  `src/utils/hooks/useNudgeInbox.ts` (re-exported from `useAgent.ts`):
  `NUDGE_INBOX_MAX = 5`, dedup by `(kind, project_id)`, `NUDGE_EXPIRY_MS = 4h`,
  60-second prune sweep, plus an explicit `dismissNudge(nudge_id)` API. The
  pure `reduceNudgeInbox` reducer is exported for unit tests.
- The FastAPI backend wraps typed AI errors as `{"error": {"code", "message"}}`
  rather than returning `code`/`message` at the top level. Keep
  `src/utils/ai/mapErrorResponse.ts` compatible with both shapes, because older
  tests/docs still refer to the flat envelope while the live FE-BE contract is
  nested.
- Tests that render `BoardPage` or `AiChatDrawer` and partial-mock
  `../utils/hooks/useAiEnabled` MUST also mock `useAutonomyLevel: () => ({level:
"plan", setLevel: jest.fn()})`. Otherwise `useAgent` crashes destructuring
  `{level}` from `undefined`. See the four `src/__tests__/*.strict.test.tsx`
  suites for examples.
- Components that trigger `remoteAgent.start()` from an effect must not depend on
  the whole `useAgent()` return object. `useAgent` returns a memoized object
  whose identity still changes on streaming state updates (`isStreaming`,
  `lastSuggestion`, `error`), which can restart the same agent request in a
  loop. Destructure the specific stable methods/data you need and depend on
  those instead. See `src/components/aiTaskAssistPanel/index.tsx`.

## Drag-and-drop (`@hello-pangea/dnd`)

- The library blocks drags whose event target is a native interactive element
  (`<input>`, `<button>`, `<textarea>`, `<select>`, `<option>`, `<optgroup>`,
  `<video>`, `<audio>`). If a `Draggable`'s root is one of these — or a
  `<Drag>` wraps a component whose root renders one — pass
  `disableInteractiveElementBlocking` on the `<Drag>` (or `<Draggable>`) to
  opt out, otherwise the card will look draggable but never start a drag.
  See `src/components/column/index.tsx` for the task-card case.
- `<DragDropContext onDragEnd>` is wired up in `src/pages/board.tsx` via
  `useDragEnd` (`src/utils/hooks/useDragEnd.ts`). Reorder mutations are
  optimistic — see `src/utils/optimisticUpdate/reorder.ts`.

## Task modal / URL state

- `TaskModal` treats `tasks === undefined` as "still loading" and only clears a
  stale `editingTaskId` from the URL after tasks resolve to a concrete array.
  Do not coerce the board page's tasks query to `[]` before passing it into
  `TaskModal`, or deep-linked edits will close immediately during load.

## Vercel API proxy (non-Next FE)

- Catch-all filenames like ``api/[...path].ts`` are a **Next.js-only**
  feature. On this Vite static deploy, only ``api/index.ts`` is wired
  up; ``vercel.json`` must rewrite ``/api/:path*`` → ``/api`` so nested
  paths such as ``/api/v1/auth/login`` hit the proxy. A missing rewrite
  surfaces Vercel's plain-text ``NOT_FOUND`` page in the login error
  summary ("The page could not be found").

## Deployment

For required env vars, CDN cache-purge guidance, FE smoke tests after
deploy, and the BE companion-server prerequisites, see
[`docs/operations/deployment.md`](docs/operations/deployment.md). Per-tier
GA blockers and ship sequence live in
[`docs/todo/release-todo.md`](docs/todo/release-todo.md).

- Access Vercel via `npx vercel@latest <cmd>` (e.g. `ls pulse`,
  `logs <url>`, `inspect <url>`, `env ls`). See README's "Ad-hoc Vercel
  inspection" subsection.

