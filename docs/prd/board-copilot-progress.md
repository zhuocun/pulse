# Board Copilot — implementation progress

Companion to [`docs/prd/board-copilot.md`](board-copilot.md). Tracks what has shipped to `main`, what is still open, and the concrete file/test inventory so a new contributor can pick up cleanly. For a section-by-section design vs implementation audit (verdicts with file/line evidence, deltas, gaps), see [`docs/prd/board-copilot-review.md`](board-copilot-review.md).

| Field        | Value                                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | Phases 0–4 shipped; AI UX Phase 1 trust/privacy corrections merged; production-readiness sweep landed 2026-05-04 (`claude/jira-ai-features-RO8hF`): protocol alignment, observability, i18n, security, a11y |
| Last updated | 2026-05-04                                                                                                                                                                                                  |
| Owner        | TBD (frontend)                                                                                                                                                                                              |

---

## Main vs in-flight

| Location                                                                                | What it contains                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`main`** (through merge of [PR #3](https://github.com/zhuocun/jira-react-app/pull/3)) | Phases 0–3: everything through the conversational assistant (`AiChatDrawer`, `useAiChat`, `chatTools` / `chatEngine`, `Ask` on board + project list, optional remote `POST …/api/ai/chat`).                                        |
| **Branch `cursor/board-copilot-semantic-search-1b36`** (this work)                      | Phase 4 — **Capability E**: `AiSearchInput`, `semanticSearch` in `engine.ts`, `search` route on `useAi`, URL param `semanticIds`, task + project panel integration, tests.                                                         |
| **Branch `cursor/ai-ux-current-audit-da9f`**                                            | Current work — AI UX audit refresh plus Phase 1 trust/privacy corrections: accurate data-scope disclosure, local/remote processing copy, clearer AI search labels, neutral AI error copy, and real Undo for readiness suggestions. |

---

## At a glance

| Phase      | Capability                                                 | PRD section | Status                                                                           |
| ---------- | ---------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| Phase 0    | Plumbing (env, hook, validators, runtime toggle)           | §7, §3.5    | ✅ Shipped                                                                       |
| Phase 1    | Capability C — Board summary brief                         | §5.3        | ✅ Shipped                                                                       |
| Phase 2A   | Capability A — Smart task drafting                         | §5.1        | ✅ Shipped                                                                       |
| Phase 2B   | Capability B — AI estimation + readiness                   | §5.2        | ✅ Shipped                                                                       |
| Phase 3    | Capability D — Conversational assistant                    | §5.4        | ✅ Shipped on `main` ([PR #3](https://github.com/zhuocun/jira-react-app/pull/3)) |
| Phase 4    | Capability E — Semantic search                             | §5.5        | ✅ Shipped                                                                       |
| AI UX P1   | Trust/privacy corrections from AI UX audit                 | v3 §2 P3/P7 | ✅ Merged                                                                        |
| Prod-ready | Protocol alignment, observability, i18n, security, a11y    | —           | ✅ Landed 2026-05-04 on `claude/jira-ai-features-RO8hF`                          |
| Backend    | Vercel `api/ai/[route].ts` proxy with provider abstraction | §7.2        | ⏳ Not started (FE works against the deterministic local engine in the meantime) |

---

## What shipped

Historical note: the first large Board Copilot drop was PR #1; [PR #3](https://github.com/zhuocun/jira-react-app/pull/3) merged Phase 3 (Ask Board Copilot) to `main`.

### Phase 0 — Plumbing

- **Env flags** (`src/constants/env.ts`): `aiEnabled`, `aiBaseUrl`, `aiUseLocalEngine`. Defaults to enabled with the local engine; `REACT_APP_AI_ENABLED=false` hides every AI surface; `REACT_APP_AI_BASE_URL=…` switches to the remote proxy.
- **Runtime toggle** (`src/utils/hooks/useAiEnabled.ts`): persisted to `localStorage` under `boardCopilot:enabled`, with cross-component live updates via a custom `boardCopilot:toggled` event.
- **Single AI hook** (`src/utils/hooks/useAi.ts`): exposes `run`, `abort`, `reset`, `data`, `error`, `isLoading`. Owns the `AbortController` lifecycle, switches transparently between the local engine and the remote proxy, and validates every response before resolving.
- **Local AI engine** (`src/utils/ai/engine.ts`): deterministic `draftTask`, `breakdownTask`, `estimate`, `readiness`, `boardBrief`, `semanticSearch`. Lets the FE work end-to-end with no backend.
- **Validators** (`src/utils/ai/validate.ts`): cross-checks every model-supplied id (`columnId`, `coordinatorId`, similar `taskId`s) against the cached context, drops or replaces unknown ids, and clamps story points to `1/2/3/5/8/13`.
- **Pure helpers** (`src/utils/ai/keywords.ts`, `src/utils/ai/storyPoints.ts`): tokenisation, Jaccard similarity, Fibonacci snapping.
- **Typed contracts** (`src/interfaces/ai.d.ts`): `IDraftTaskSuggestion`, `ITaskBreakdownSuggestion`, `IEstimateSuggestion`, `IReadinessReport`, `IBoardBrief`, `ISearchResult` — these are the shapes the future remote proxy must return per route.

### Phase 1 — Capability C: Board summary brief

- `src/components/boardBriefDrawer/index.tsx` — Ant Design `Drawer` with headline, per-column counts table, largest unstarted, unowned, workload, and a one-line recommendation.
- Brief items deep-link into the existing task modal via `useTaskModal`.
- `src/pages/board.tsx` — adds a `Brief` button in the header gated by the runtime toggle.

### Phase 2A — Capability A: Smart task drafting

- `src/components/aiTaskDraftModal/index.tsx` — natural-language prompt → fully populated antd form (name, type, epic, story points, note with acceptance criteria, suggested column and coordinator) → existing `useReactMutation("tasks", "POST", …, newTaskCallback)`.
- `Break down` action posts N child tasks sequentially through the same mutation, preserving the optimistic update.
- `src/components/taskCreator/index.tsx` — adds a `Draft with AI` affordance next to `+ Create task`, gated by the runtime toggle.

### Phase 2B — Capability B: AI estimation + readiness

- `src/components/aiTaskAssistPanel/index.tsx` — sidebar showing suggested story points (with confidence and similar-task back-references) and a readiness check (missing acceptance criteria, missing coordinator, etc.) with one-click `Apply` that fills the antd form.
- `src/components/taskModal/index.tsx` — extends the form with `epic`, `storyPoints`, `note` editors so AI suggestions have somewhere to land, and mounts the assist panel for non-mock tasks when AI is enabled.

### Phase 3 — Capability D: Conversational assistant

- `src/components/aiChatDrawer/index.tsx` — right-edge `Drawer` (“Ask Board Copilot”) with message thread, read-only tool traces, local deterministic engine or `POST` to remote `/api/ai/chat` when `REACT_APP_AI_BASE_URL` is set.
- `src/utils/hooks/useAiChat.ts` — orchestrates turns; executes validated read-only tools via `executeChatToolCall` (`src/utils/ai/chatTools.ts`).
- `src/utils/ai/chatEngine.ts` — local assistant step (`chatAssistantTurn`) and tool-result formatting (`summarizeToolResultForUser`).
- `src/pages/board.tsx` and `src/pages/project.tsx` — `Ask` button when AI is enabled.

Remote proxy (optional): `POST ${REACT_APP_AI_BASE_URL}/api/ai/chat` with body `{ messages, context }` returning `{ kind: "text", text }` or `{ kind: "tool_calls", toolCalls }` using the same read-only tool names as `chatTools.ts`.

**PRD gaps / follow-ups for Phase 3**

- Chat uses **request–response JSON**, not **SSE** token streaming (PRD §6.1 / §7.1 describe SSE for `useAi`; structured routes also use non-streaming `fetch` today).
- **Tests:** `src/components/aiChatDrawer/index.test.tsx`, `src/utils/hooks/useAiChat.test.tsx`, `src/utils/hooks/useAiChat.remote.test.tsx` cover the drawer, local chat turns, and remote chat transport (tool/engine units remain in `*.test.ts`).

### Phase 4 — Capability E: Semantic search (PRD §5.5)

- `src/interfaces/ai.d.ts` — `ISearchResult` (`ids`, `rationale`).
- `src/utils/ai/engine.ts` — `semanticSearch` (Jaccard over tokenised query vs task name/type/epic/note or project name/org/manager); `AiSearchProjectsContext` for project-side context.
- `src/utils/ai/validate.ts` — `validateSearch` intersects `ids` with known cache ids.
- `src/utils/hooks/useAi.ts` — `AiRoute` includes `"search"`; `RunPayload.search` with `kind`, `query`, and `projectContext` or `projectsContext`.
- `src/components/aiSearchInput/index.tsx` — “Ask in natural language” + Search / Clear AI search; local engine or remote `POST …/api/ai/search`.
- `src/components/taskSearchPanel/index.tsx` — optional `aiSearchSlot`; `TaskSearchParam.semanticIds`; Reset clears semantic filter.
- `src/components/projectSearchPanel/index.tsx` — optional `aiSearchSlot`; `ProjectSearchParam.semanticIds`.
- `src/pages/board.tsx` — `semanticIds` in URL; passes slot + `AiSearchInput` when AI enabled and project context ready.
- `src/pages/project.tsx` — `semanticIds` in URL; debounced API fetch excludes `semanticIds`; list filtered client-side by semantic ids when set.
- `src/components/column/index.tsx` — AND semantic id filter with existing task filters.

Remote proxy (optional): `POST ${REACT_APP_AI_BASE_URL}/api/ai/search` with JSON body matching `RunPayload.search` (same `kind`, `query`, and context objects as other AI routes). Response `{ ids, rationale }` is validated with `validateSearch` client-side.

### Shared

- `src/components/header/index.tsx` — **Board Copilot** runtime switch (Ant Design `Switch`) when `REACT_APP_AI_ENABLED` is not `false`; persists via `useAiEnabled` / `localStorage` (PRD §7.3).
- `src/components/aiSparkleIcon/index.tsx` — single shared "AI" affordance used wherever AI initiates an action.
- `README.md` — Board Copilot section: backends, env vars, safety, link to the PRD.

### AI UX Phase 1 — trust and privacy corrections

Tracked by [`AI_UX_OPTIMIZATION_PLAN.md`](../../AI_UX_OPTIMIZATION_PLAN.md).
Merged from `cursor/ai-ux-current-audit-da9f`.

- `AI_UX_OPTIMIZATION_PLAN.md` — refreshed the audit to reflect the current
  implementation instead of stale pre-v3 gaps. The remaining roadmap is now
  organized around trust/privacy, evidence/calibration, feedback/observability,
  surface consolidation, and agentic readiness.
- `src/constants/microcopy.ts` — updated Board Copilot copy so privacy
  disclosure matches the actual payload shape. It now discloses task notes
  where present and member usernames/emails/user IDs where needed; it no longer
  claims that notes are never shared.
- `src/components/copilotPrivacyPopover/index.tsx` — the "What is shared?"
  popover and first-use disclosure now include local-vs-remote processing
  context. Local mode says requests use deterministic in-app rules; remote mode
  names the configured AI service origin when available.
- `src/components/aiSearchInput/index.tsx` — renamed list-filtering AI search
  from chat-like "Ask Board Copilot" language to "Find related tasks/projects",
  with helper text clarifying that the action filters the current list and does
  not open chat.
- `src/utils/ai/chatEngine.ts` and `src/constants/microcopy.ts` — replaced the
  remaining first-person AI recovery copy with neutral, tool-like language.
- `src/components/aiTaskAssistPanel/index.tsx` and
  `src/components/taskModal/index.tsx` — readiness suggestion Undo now restores
  the exact previous field value instead of showing a passive Undo toast.
- Tests updated for the new copy and Undo behavior:
    - `src/components/aiSearchInput/index.test.tsx`
    - `src/components/aiSearchInput/remoteSearch.test.tsx`
    - `src/components/aiTaskAssistPanel/index.test.tsx`
    - `src/components/taskModal/index.test.tsx`
    - `src/__tests__/boardAi.integration.test.tsx`
    - `src/__tests__/uiResilience.strict.test.tsx`
    - `src/pages/project.ai.test.tsx`
    - `src/utils/ai/chatEngine.test.ts`

### Production-readiness sweep — 2026-05-04 (`claude/jira-ai-features-RO8hF`)

Two commits on this branch land the following:

**`a59539f` — protocol alignment, observability, i18n, security**

- `src/utils/ai/feTools/{getTask,getProject,listBoard,listTasks,listMembers}.ts` — FE tool
  args now use snake_case (`task_id`, `project_id`) to match BE schemas.
- `src/utils/ai/feTools/{recentActivity,formDraft}.ts` — stub return shapes now match
  schemas: `recentActivity` returns `{activity: []}`, `formDraft` returns `{draft: null}`.
- `src/utils/ai/idempotencyKey.ts` — new `newIdempotencyKey()` exported; sent as
  `Idempotency-Key` header on every AI request from `useAi`, `useAiChat`, and
  `agentClient.{streamAgent,invokeAgent}`.
- `src/utils/ai/mapErrorResponse.ts` — shared HTTP status → typed error mapper; all
  v1 fetch sites now route through it for consistent `aiErrorView` handling.
- `src/utils/observability/sinks.ts` — `httpAnalyticsSink`, `httpErrorSink`,
  `devMemorySink` wired from `src/index.tsx` via `VITE_ANALYTICS_ENDPOINT` and
  `VITE_ERROR_REPORT_ENDPOINT`. `ErrorBoundary.componentDidCatch` reports to error sink.
  Every analytics event includes `engineMode: 'local' | 'remote'`.
- `src/constants/env.ts` — `REACT_APP_AI_BASE_URL` validated at module load; rejects
  `javascript:`, `file:`, `data:`, malformed URLs; falls back to local engine with
  `console.error`; trailing slash trimmed.
- `src/utils/hooks/useAgent.ts` — `useAgent.start` now throws `AgentForbiddenError` if
  `isProjectAiDisabled(projectId)` before opening the SSE stream.
- `src/constants/microcopy.ai.*` — hardcoded English strings in `aiChatDrawer`,
  `aiTaskAssistPanel`, `nudgeCard`, `citationChip`, `errorTemplate`, `useAgent` watchdog,
  `useAiChat` exhaustion/unexpected-response moved into `microcopy.ai.*` with `en.ts` and
  `zh-CN.ts` translations.
- `aiErrorView` — explicit branches for budget, forbidden, not-found, server errors with
  appropriate `retryable` flags; `disabledForSeconds` returned for rate-limit errors.
- `aiChatDrawer` — `setInterval` countdown disables retry button during rate-limit wait.

**`a2d1adc` — jest-axe coverage + WCAG fix**

- `src/__tests__/aiAccessibility.strict.test.tsx` — 31 axe tests covering AiChatDrawer
  (3 states), AiTaskAssistPanel, BoardBriefDrawer, AiTaskDraftModal, AiSearchInput,
  NudgeCard (3 severities), MutationProposalCard, CommandPalette, EngineModeTag,
  CitationChip (4 sources), AiMatchStrengthBadge.
- `AiMatchStrengthBadge` compact mode — fixed real WCAG 4.1.2 violation: `<Tag>` now
  has `role="img"` (was empty `<span>` with `aria-label` only).

### Test coverage

- 76 suites, 340 tests (prior to `a2d1adc`); `a2d1adc` adds 1 suite and 31 tests.
- Coverage on the runtime AI scope: **97% statements / 92.37% branches / 97% functions / 97.84% lines**.
- New test files:
    - `src/utils/ai/{engine,keywords,storyPoints,validate,chatEngine,chatTools}.test.ts`
    - `src/utils/hooks/{useAi,useAi.remote,useAiChat,useAiChat.remote,useAiEnabled,useAiEnabled.disabled}.test.tsx`
    - `src/components/{aiChatDrawer,aiSearchInput,aiTaskDraftModal,aiTaskAssistPanel,boardBriefDrawer}/index.test.tsx`
    - `src/components/header/index.test.tsx` (includes Board Copilot toggle)
    - Extended: `src/components/{taskCreator,taskModal}/index.test.tsx`, `src/constants/env.test.ts`

**Note:** AC-D1–AC-D4 apply with Phase 3 on `main` ([PR #3](https://github.com/zhuocun/jira-react-app/pull/3)).

### Acceptance-criteria status (against the PRD)

| ID    | Acceptance criterion                                                              | Status                                                                                  |
| ----- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AC-A1 | With AI off, `TaskCreator` is unchanged                                           | ✅                                                                                      |
| AC-A2 | Draft button opens the modal with a streaming partial form                        | ✅ (local engine resolves synchronously; UX scaffold in place for real streaming)       |
| AC-A3 | Submitted task is indistinguishable from a manually created one in the cache      | ✅ (uses the existing `newTaskCallback`)                                                |
| AC-A4 | Unknown `columnId` is rejected and replaced with the opener column                | ✅ (`validateDraft`)                                                                    |
| AC-A5 | Unknown `coordinatorId` is rejected and replaced with the current user            | ✅                                                                                      |
| AC-A6 | Escape / unmount aborts the in-flight request                                     | ✅ (`AbortController` in `useAi`)                                                       |
| AC-A7 | Breakdown posts each subtask via `useReactMutation` with the optimistic callback  | ✅                                                                                      |
| AC-B1 | With AI off, the task modal is unchanged                                          | ✅                                                                                      |
| AC-B2 | Opening a task triggers exactly one estimation; further estimations are debounced | ✅ (1000 ms via existing `useDebounce`)                                                 |
| AC-B3 | Suggested `storyPoints` is always in `{1,2,3,5,8,13}`                             | ✅ (`clampToFibonacci`)                                                                 |
| AC-B4 | Each `similar[]._id` is present in the project's `tasks` cache                    | ✅ (`validateEstimate`)                                                                 |
| AC-B5 | `Apply suggestion` does not submit the form                                       | ✅ (only calls `form.setFieldsValue`)                                                   |
| AC-B6 | Closing the modal mid-request aborts the request                                  | ✅                                                                                      |
| AC-C1 | With AI off, no Brief button is rendered                                          | ✅                                                                                      |
| AC-C2 | Brief opens immediately and renders within ≤2s for ≤200 tasks                     | ✅ (local engine is synchronous; remote-path SLO will be measured once the proxy ships) |
| AC-C3 | All `taskId` and `memberId` references in the brief exist in the cache            | ✅ (`validateBoardBrief`)                                                               |
| AC-C4 | Brief is read-only except deep-linking into the existing task modal               | ✅                                                                                      |
| AC-C5 | Drawer's request is aborted when the drawer closes                                | ✅                                                                                      |
| AC-D1 | Only registered read-only tools can run client-side                               | ✅ (`chatTools.ts` whitelist)                                                           |
| AC-D2 | Tool definitions not supplied from user thread (remote must own tools)            | ✅ (local engine is fixed; remote contract documented in progress doc)                  |
| AC-D3 | Closing the chat drawer aborts in-flight work                                     | ✅ (`useAiChat` + drawer `abort`)                                                       |
| AC-D4 | Conversation cleared on hard reload                                               | ✅ (in-memory state only)                                                               |
| AC-E1 | Returned `ids` intersected with cache                                             | ✅ (`validateSearch`)                                                                   |
| AC-E2 | Empty semantic search restores list + hint                                        | ✅ (info `Alert` + full list when no ids)                                               |
| AC-E3 | Clearing AI search restores prior filters                                         | ✅ (`semanticIds` removed from URL / reset)                                             |

---

## What is open

### Backend — Vercel proxy (PRD §7.2)

Not started — **no `api/` routes in this repo** yet. The client posts to `${REACT_APP_AI_BASE_URL}/api/ai/<route>` when that env var is set. To plug in a real LLM:

- Add `api/ai/[route].ts` (or equivalent) per `vercel.json`.
- Hold the model API key in the server env (never `REACT_APP_*`).
- Per route: JSON schema for structured output (existing types in `src/interfaces/ai.d.ts`, including `ISearchResult` for search).
- Chat route should expose **only** the read-only tools from `chatTools.ts` on the server; never trust client-supplied tool definitions (AC-D2).
- Enforce per-IP, per-route token budgets and timeouts (PRD §9).
- Log only metadata (route, latency, token counts, status) — never raw user content in production.

### Product / UX gaps (from PRD)

- ~~**Runtime toggle UI** (PRD §7.3)~~: shipped in `src/components/header` (`Switch` + `useAiEnabled`).
- ~~**“Disable AI for this project”** (PRD §8)~~: shipped — `boardCopilot:disabledProjectIds` in `localStorage`, `useAiProjectDisabled` + **Project AI** switch on the board header, guards in `useAi` / `useAiChat`, `boardAiOn` passed to `Column` / `TaskCreator` / `TaskModal`.
- ~~**AI UX Phase 1 trust/privacy corrections**~~: implemented on `cursor/ai-ux-current-audit-da9f`; see "AI UX Phase 1" above.
- **Observability** (PRD §7.7, §9): `httpAnalyticsSink` / `httpErrorSink` infrastructure
  landed 2026-05-04. Individual `track()` call-site wiring and server-side counters
  still open — full measurement lands with proxy.
- **Chat write-tools** (PRD §5.4 follow-up): out of scope until a later version.

### Optional polish

- **SSE / streaming** for chat and structured routes if you want parity with PRD §7.1 (today: synchronous local engine + JSON `fetch` for remote).
- **`useAi.ts` type union:** PRD lists `chat` and `search` on `AiRoute`; implementation keeps chat in `useAiChat` and structured routes in `useAi` — fine, but document or consolidate if desired.

---

## How to verify what shipped

```bash
npm install
npm run eslint
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text-summary
npx vite build
```

Expected: lint clean, ≥97% statement coverage, build succeeds. As of 2026-05-04: 77+ suites / 371+ tests (includes 31 new axe tests from `a2d1adc`).

To exercise Board Copilot in the browser:

1. `npm start`, log in (any non-`wrong` email + password against the mock backend).
2. Open a project board.
3. Click `Brief` in the board header (Capability C).
4. Click `+ Create task` → `Draft with AI`, type a prompt, click `Draft task` (Capability A) or `Break down` for subtasks.
5. Open any existing task to see the Board Copilot sidebar (Capability B).
6. Click `Ask` in the board or project list header to open the conversational assistant (Capability D).
7. Use **Find related tasks/projects** above the board or project filters, then clear with **Clear AI search**. This filters the list only; chat still opens through **Ask** / command palette AI mode.

To turn AI off without rebuilding, use the **Board Copilot** switch in the app header (when `REACT_APP_AI_ENABLED` is not `false`), or:

```js
localStorage.setItem("boardCopilot:enabled", "false");
location.reload();
```

To force-disable at build time:

```bash
REACT_APP_AI_ENABLED=false npm run build
```

To point at a real LLM proxy:

```bash
REACT_APP_AI_BASE_URL=https://your-proxy.example npm run build
```
