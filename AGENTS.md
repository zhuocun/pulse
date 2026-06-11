# Agent notes

Short, durable gotchas for anyone (human or AI) editing this repo. Add an entry
when a fix is non-obvious from the code alone.

## Coding harness

Aim for code that is **precise · efficient · readable · scalable ·
well-architected · well-designed · testable · robust · rigorous ·
decompositional · smart · high-coverage**. Each quality below is one
concrete rule plus the canonical anchor that demonstrates it.

- **Precise** — Types are the contract. No `any` in production; use `unknown`
  with narrowing. Validate at system edges (HTTP, env, FE↔BE wire) and trust
  internal calls.
- **Efficient** — No silent N² patterns. Memoise only the expensive thing;
  premature `useMemo` is clutter. Guardrails: bundle chunks ≤1 MB unminified,
  `vite build` ≤5 s (currently 559 KB / 1.86 s — keep the slack).
- **Readable** — A function reads cold: name says *what*, body says *how*.
  Default to **zero comments**; only comment a non-obvious WHY. Never embed
  PR IDs, optimisation-plan tags (`P2-D`, `B-R11`), or "added for #123" —
  meaningless after merge (`9a182ec` scrubbed 62 such refs).
- **Scalable** — One source of truth for shared strings: tool names live in
  `backend/app/tools/fe_tool_names.py` (`FE_*` constants — never a bare
  `"fe.foo"` literal); microcopy in `src/constants/microcopy.ts`. A change
  should not require touching N similar files.
- **Well-architected** — Boundaries are explicit. Agent runtime owns the
  gates (rate limit, budget, idempotency, redaction); routers wire HTTP;
  the repository owns persistence. `api/index.ts` is the **only** edge into
  the backend in deploy builds.
- **Well-designed** — Smallest API the caller actually needs. Don't
  pre-design for futures you can't see. Three similar lines beats a
  premature factory; abstract only when the third caller arrives and the
  shape is stable (`src/utils/hooks/_createOverlayHook.ts` is the model).
- **Testable** — No module-level mutable state. If unavoidable, expose
  `reset*ForTests` and document the constraint (`useApi.ts` rate-limiter
  is the cautionary example). Inject dependencies; don't fetch from the
  global.
- **Robust** — Fail fast at boot for misconfiguration (BE settings
  validation raises before the first request handles). Fail soft at
  runtime for transient errors. Every async call respects
  `AbortController`/unmount.
- **Rigorous** — Wire contracts pinned by tests on both sides:
  `FE_TOOL_REGISTRY.size` (currently 11) matches `ALL_FE_TOOL_NAMES`
  matches `FE_TOOL_SCHEMAS`. Every BE-advertised tool has an FE
  resolver; every `interrupt(NAME, …)` reaches a registry entry or an
  explicit HITL special case (`useAgentToolResolver.ts:241-243`).
- **Decompositional** — Split by responsibility, not by cosmetic file
  count. >800 LOC of business code in one file is a smell; <50 LOC files
  that always travel together should fold back. Outliers
  (`aiChatDrawer/index.tsx`, `useAgent.ts`) are tracked debt, not models.
- **Smart** — Don't defend against scenarios that can't happen. No
  compat shims for refactors that completed (the `fe.applyMutation`
  cleanup is the template). Fix root causes, not symptoms.
- **High-coverage** — Backend gate is `--cov-fail-under=85`; real
  coverage runs ~98%. Write a test for every branch you add — never a
  test purely to hit a coverage line (deleted coverage-filler tests are
  why the gate was lowered).

## Other guardrails

- **Dependencies** — `@types/*` and test/build tooling live in
  `devDependencies`. Before adding a dep, grep
  `src/ vite.config.ts jest.config.cjs` for an existing equivalent. If a
  candidate dep has one call site, inline (lodash `isEqual` → inlined
  `shallowEqual` in `taskModal/index.tsx` is the model).
- **Configuration coherence** — One source per concern. Node version in
  `.nvmrc` only (not `.node-version` + `engines.node` + `.nvmrc`). Backend
  keeps `pyproject.toml` canonical and mirrors production runtime deps in
  `requirements.txt`; do not add `uv.lock` as a third source.
- **Doc–code coherence** — When you delete code, update every doc that
  names it **in the same PR**. A `✅ Resolved` entry linking to files
  that no longer exist is worse than the deletion. Tracking files
  (`docs/todo/*.md`) live in the same PR as the work they describe;
  never restate blockers in `README.md` or PR bodies — link to the
  entry. Orchestrator scratch (`.orchestrate/`), verifier logs, and
  dated status snapshots belong in `.gitignore`, not the repo.
- **Deprecation discipline** — A compat shim ships with a removal date.
  After sunset: delete on both sides. Don't preserve "for older
  clients" indefinitely.
- **Backwards compat at boundaries only** — Internal refactors don't
  need shims. External surfaces (wire contracts, env vars, public APIs)
  do, until the next major.
- **Accessibility minimums** — Every interactive control declares
  ≥44 px touch-target under `@media (pointer: coarse)` (WCAG 2.5.8);
  the `declares a touch-target height` tests in
  `src/components/*/index.test.tsx` and `layouts/authLayout.test.tsx`
  pin this. Every top-level surface passes `axe-core` clean
  (`src/__tests__/uiAccessibility.strict.test.tsx`). Button labels
  flow through `src/constants/microcopy.ts` — ESLint
  `no-restricted-syntax` blocks raw `Submit`/`OK`/`Login`/`Signup`/
  `Edit Task`/`Create Project` as `<Button>` children or `okText`/
  `cancelText` props.
- **Observability** — Pick one telemetry stack. OTel and Prometheus
  side-by-side doubles the dimension surface for half the value;
  current code carries both as tech debt, not as a template.

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

## Claude Code auto-compact (`.claude/settings.json`)

`.claude/settings.json` pins `autoCompactWindow: 400000` and
`env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "80"`, so auto-compaction fires at 80% of a
400K window (~320K tokens) instead of the model's full 1M default. The percentage
override has no settings key — it only takes effect from the `env` block — and is
clamped by `Math.min` to the default, so it can pull compaction *earlier* but
never later. Verified on Claude Code 2.1.173; older builds ignored the override on
1M-context Opus and compacted at a hardcoded ~195K. To re-verify, read an
auto-compact event's `preTokens` in the session `.jsonl`: ~320K means it works,
~195K means it regressed.

## PR & merge process

The same review-and-merge flow applies across the `agent`, `pulse`, and `agent-skills` repos.

- **One concern per PR.** Keep PRs small and single-purpose, and squash-merge to keep `main` history clean. A larger change ships as a single PR only when its commits share one integration story — one logical commit per concern.
- **Open a PR before wrapping up.** A task isn't finished until its changes are up for review; don't leave finished work stranded on a pushed branch with no PR. Check for an existing PR on the branch first. If that branch's earlier PR has already merged, branch off fresh `main` and open a new PR rather than pushing onto the dead branch.
- **Watch CI, then merge on green.** After opening a PR, watch its checks (subscribe to PR activity, or poll the check runs). Once all required checks pass, squash-merge. If CI goes red, push a fix rather than leaving it stranded. A PR-activity subscription only wakes on *failures* and review comments — a green pass emits no event, so confirm success by polling the checks, not by waiting to be notified. Merging `main` triggers the production deploy, so green CI is the merge gate.
- **Never bypass hooks.** Don't use `--no-verify` / `--no-gpg-sign`, especially on workflow-file changes. If a commit-msg or pre-commit hook fails, fix the cause and make a new commit — don't amend past it.

