# Product done — Board Copilot implementation changelog

Companion to [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md) (backend / wire contract)
and [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md) (UX layer). Tracks what has shipped
to `main`, the per-feature inventory, and pointers to what remains
open. Per-PR history lives in git log.

| Field        | Value                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | Phases 0–4 shipped; AI UX Phase 1 trust/privacy corrections merged; v2.1 SSE migration complete for all six structured routes (chat + brief + draft + estimate + readiness + search); release-readiness sweep landed; observability sinks wired; PRD AC-V14 nudge inbox enforced; typed error envelope honoured FE-side. |
| Last updated | 2026-05-10                                                                                                                                                                       |
| Owner        | TBD (frontend)                                                                                                                                                                   |

For the live GA / blocker / soft-blocker / polish status see
[`release-todo.md`](release-todo.md).

---

## At a glance

| Phase / Capability | PRD section | Status |
| --- | --- | --- |
| Phase 0 — Plumbing (env, hook, validators, runtime toggle) | §7, §3.5 | ✅ Shipped |
| Phase 1 — Capability C: Board summary brief | §5.3 | ✅ Shipped |
| Phase 2A — Capability A: Smart task drafting | §5.1 | ✅ Shipped |
| Phase 2B — Capability B: AI estimation + readiness | §5.2 | ✅ Shipped |
| Phase 3 — Capability D: Conversational assistant | §5.4 | ✅ Shipped (PR #3) |
| Phase 4 — Capability E: Semantic search | §5.5 | ✅ Shipped |
| AI UX Phase 1 — trust/privacy corrections | v3 §2 P3/P7 | ✅ Merged |
| Observability sinks (`httpAnalyticsSink`, `httpErrorSink`, `devMemorySink`) | — | ✅ |
| Observability call sites (`AGENT_TURN_*`, `AGENT_HEALTH_DEGRADED`, `COPILOT_REWRITE_ACCEPT`) | — | ✅ |
| v2.1 streaming infra (`useAgent`, `agentClient`, cards, palette AI mode) | — | ✅ |
| v2.1 UI surface — agent health badge, chat-drawer cards | — | ✅ |
| Unified Copilot shell scaffold (`CopilotShell`) | — | ✅ Shipped as a phase-1 drawer scaffold; in-shell tab content remains deferred |
| v2.1 chat path migrated to SSE streaming | — | ✅ |
| v2.1 triage nudges mounted in board page | — | ✅ |
| Protocol / i18n / a11y (snake_case args, `Idempotency-Key`, typed errors, jest-axe) | — | ✅ |
| Security — `REACT_APP_AI_BASE_URL` validation, per-project AI opt-out, snake_case | — | ✅ |
| `aiBaseUrl` 3-way resolution (defaults to `apiOrigin` for deployed builds) | — | ✅ |
| Backend core (FastAPI v1 shims + v2.1 LangGraph SSE) | §7.2 / v2.1 §5A | ✅ Shipped |
| Backend release gates | — | ⏳ Open: mutation lifecycle, JWT-XSS, provider fallback, MCP — see [`release-todo.md`](release-todo.md) |
| Frontend CI (Prettier, ESLint check, tsc, Jest, Vite build on FE paths) | [`release-todo.md`](release-todo.md) §7b | ✅ `.github/workflows/frontend-ci.yml` |
| `custom/suggestion` event handler (`lastSuggestion` / `clearSuggestion`) | — | ✅ |
| Autonomy selector UI in `AiChatDrawer` (Suggest / Plan / Auto-disabled) | — | ✅ |
| `autonomyRef` wired to `useAutonomyLevel` | — | ✅ |
| v2.1 REST-route migration — all six structured routes on SSE in remote builds | — | ✅ |
| Triage-nudge inbox rules (PRD AC-V14: cap-5, dedup, 4h expiry, dismiss) | — | ✅ |
| `mapErrorResponse` honors typed `{code, message}` envelope | — | ✅ |
| `useAgentChat.dismissNudge` propagates to `useAgent` inbox | — | ✅ |
| Security — JWT-in-localStorage XSS exfiltration | — | ⏳ Open (see [`release-todo.md` §3](release-todo.md)) |
| `AGENT_PROPOSAL_UNDONE` end-to-end Undo flow | — | ⏳ Deferred (BE mutation lifecycle blocks it) |
| Triage-agent on `/projects` list page | — | ⏳ Skipped (no `project_id`; rate-limit risk) |
| `taskCreator` / `columnCreator` keyboard + a11y rebuild | UX (ui-todo §13) | ✅ `CreateLink` and `AddColumnButton` ship as real `<button type="button">` with focus-visible styling; the always-on faux empty column is gone (collapsed-button → input on click) |
| `column` task card + dropdown actions a11y | UX (ui-todo §21) | ✅ `TaskCard` is a real `<button type="button">` with `aria-label`; dropdown menu uses AntD `<Dropdown>` + `NoPaddingButton` |
| Board task-card visual rebuild (Phase 2.4 partial) | UX (ui-todo §8) | ✅ `EpicTag`, `TaskTypeBadge` (with explicit `Bug` / `Task` text), `StoryPointsTag`, `UserAvatar` for coordinator, count `<Badge>` on column header, `MoreOutlined` dropdown trigger, `overflow-y: auto` (native scrollbar) |
| Edit Task modal — footer-slot delete + dynamic title | UX (ui-todo §10, Phase 2.6) | ✅ `Delete` in real `Modal.footer` slot (Delete-left tablet+, stacked phone); title reads `${editTask} · ${taskName}` with type tag |
| Auth forms — `Form.Item label`, autoComplete, show-password, caps-lock | UX (ui-todo §11, Phase 2.7) | ✅ Both `loginForm` and `registerForm` use `<Form.Item label>` with i18n labels, proper `autoComplete` attrs (`email`, `current-password`, `new-password`, `username`), show/hide password toggle, caps-lock hint, `aria-live="polite"` error region |
| `taskSearchPanel` side-effect-in-render fix | UX (ui-todo §9) | ✅ `coordinators` and `types` derived through `useMemo` with `Set`-based deduping; no more `tasks?.map(... return null)` for side effects |
| Design-token contributor reference | UX (ui-todo §20e / §2.C) | ✅ [`docs/design-tokens.md`](../design-tokens.md) documents scales and AntD mapping; implementation remains `src/theme/tokens.ts` + `src/theme/antdTheme.ts` |
| `CopilotAboutPopover` i18n + configurable knowledge cutoff | UX (ui-todo §20c) | ✅ Mode tags from `microcopy.about.*`; cutoff from `knowledgeCutoffTemplate` + `resolveAiKnowledgeCutoffForUi` (`REACT_APP_AI_KNOWLEDGE_CUTOFF`, optional wire `knowledge_cutoff`) |
| Copilot About — `chat-agent` `rate_limit` / `allowed_autonomy` in UI | [`release-todo.md`](release-todo.md) §14 partial | ✅ Remote-only `useChatAgentMetadata` + session `getSessionCachedAgentMetadata`; loading/empty/error handling in `CopilotAboutPopover` |

---

## What shipped — per phase

### Phase 0 — Plumbing

- **Env flags** (`src/constants/env.ts`): `aiEnabled`, `aiBaseUrl`,
  `aiUseLocalEngine`. `aiBaseUrl` resolution is 3-way: (a)
  `REACT_APP_AI_BASE_URL` non-empty → use it (validated); (b)
  `REACT_APP_AI_USE_LOCAL=true` or `NODE_ENV==="test"` → empty
  string → local engine; (c) otherwise → default to `apiOrigin` so
  deployed builds reach the backend. `.env.development` sets
  `REACT_APP_AI_USE_LOCAL=true`.
- **Runtime toggle** (`src/utils/hooks/useAiEnabled.ts`): persisted
  to `localStorage` under `boardCopilot:enabled` with cross-component
  live updates via `boardCopilot:toggled` event.
- **Single AI hook** (`src/utils/hooks/useAi.ts`): owns
  `AbortController` lifecycle, switches between local engine and
  remote proxy, validates every response.
- **Local AI engine** (`src/utils/ai/engine.ts`): deterministic
  `draftTask`, `breakdownTask`, `estimate`, `readiness`, `boardBrief`,
  `semanticSearch`. End-to-end with no backend.
- **Validators** (`src/utils/ai/validate.ts`): cross-checks every
  model-supplied id against the cached context; clamps story points
  to `1/2/3/5/8/13`.
- **Pure helpers** (`src/utils/ai/{keywords,storyPoints}.ts`):
  tokenisation, Jaccard similarity, Fibonacci snapping.
- **Typed contracts** (`src/interfaces/ai.d.ts`):
  `IDraftTaskSuggestion`, `ITaskBreakdownSuggestion`,
  `IEstimateSuggestion`, `IReadinessReport`, `IBoardBrief`,
  `ISearchResult`.

### Phase 1 — Board summary brief (Capability C)

- `src/components/boardBriefDrawer/index.tsx` — Ant Design `Drawer`
  with headline, per-column counts, largest unstarted, unowned,
  workload, and a one-line recommendation. Brief items deep-link
  into the existing task modal.
- `src/pages/board.tsx` — `Brief` button gated by the runtime toggle.

### Phase 2A — Smart task drafting (Capability A)

- `src/components/aiTaskDraftModal/index.tsx` — natural-language
  prompt → fully populated antd form → existing `useReactMutation`.
  `Break down` posts N child tasks sequentially.
- `src/components/taskCreator/index.tsx` — `Draft with AI`
  affordance gated by the runtime toggle.

### Phase 2B — AI estimation + readiness (Capability B)

- `src/components/aiTaskAssistPanel/index.tsx` — sidebar with
  story-point estimate (+ confidence, similar-task back-references)
  and a readiness check (missing acceptance criteria, missing
  coordinator, etc.) with one-click `Apply`.
- `src/components/taskModal/index.tsx` — extends form with `epic`,
  `storyPoints`, `note` editors; mounts the assist panel for
  non-mock tasks when AI is enabled.

### Phase 3 — Conversational assistant (Capability D)

- `src/components/aiChatDrawer/index.tsx` — right-edge
  "Ask Board Copilot" drawer with message thread and read-only
  tool traces. Remote builds use `useAgentChat` over
  `useAgent("chat-agent")` SSE; local builds use `useAiChat` and
  the deterministic engine. Accepts optional `pendingProposal` /
  `pendingNudges` props that render `MutationProposalCard` and
  `NudgeCard` inline. Proposal card is gated off in production by
  default (see GA Blocker §1 in `release-todo.md`).
- `src/utils/hooks/useAiChat.ts` and
  `src/utils/hooks/useAgentChat.ts` — local and remote orchestrators.
- `src/utils/ai/chatEngine.ts` — local assistant step
  (`chatAssistantTurn`) and tool-result formatting
  (`summarizeToolResultForUser`).
- `src/pages/{board,project}.tsx` — `Ask` button when AI is enabled.

Remote path: `POST ${aiBaseUrl}/api/v1/agents/chat-agent/stream`
with v2.1 SSE `StreamPart` events. The legacy `POST /api/ai/chat`
JSON shim remains for local/fallback compatibility.

### Phase 4 — Semantic search (Capability E)

- `src/components/aiSearchInput/index.tsx` — "Ask in natural
  language" + Search / Clear AI search; local engine or remote
  `useAgent("search-agent")` over
  `POST …/api/v1/agents/search-agent/stream`.
- `src/components/{taskSearchPanel,projectSearchPanel}/index.tsx` —
  optional `aiSearchSlot`; `semanticIds` filter.
- `src/pages/{board,project}.tsx` — `semanticIds` in URL; client-side
  filter when set.
- `src/components/column/index.tsx` — AND semantic id filter with
  existing task filters.

### Shared

- `src/components/header/index.tsx` — **Board Copilot** runtime
  switch when `REACT_APP_AI_ENABLED` is not `false`. Mounts a
  `useAgentHealth` status dot in remote mode.
- `src/components/aiSparkleIcon/index.tsx` — single shared "AI"
  affordance.
- `src/components/copilotShell/index.tsx` — unified right-rail
  scaffold with `chat`, `brief`, `activity`, and `settings` tabs.
  Current board-page wiring opens the shell, but the tab bodies still
  delegate to the existing drawers or render placeholder copy.

### AI UX Phase 1 — trust and privacy corrections

Merged from `cursor/ai-ux-current-audit-da9f`. Refreshed Board
Copilot copy so privacy disclosure matches the actual payload shape
(notes are disclosed when present); the "What is shared?" popover
now distinguishes local vs remote processing; AI search renamed from
chat-like "Ask Board Copilot" to "Find related tasks/projects" with
helper text; first-person AI recovery copy replaced with neutral
tool-like language; readiness Undo now restores the exact previous
field value.

### Production-readiness sweep

- FE tool args migrated from camelCase to snake_case
  (`task_id`, `project_id`).
- `Idempotency-Key` header on every AI request from `useAi`,
  `useAiChat`, and `agentClient.{streamAgent,invokeAgent}`.
- `mapErrorResponse.ts` — shared HTTP status → typed error mapper;
  honors typed `{code, message}` envelope (legacy plain-string
  bodies still produce a typed error).
- `httpAnalyticsSink` / `httpErrorSink` / `devMemorySink` wired from
  `src/index.tsx` via `VITE_ANALYTICS_ENDPOINT` and
  `VITE_ERROR_REPORT_ENDPOINT`. `ErrorBoundary.componentDidCatch`
  reports to error sink. Every analytics event includes
  `engineMode: 'local' | 'remote'`.
- `REACT_APP_AI_BASE_URL` validated at module load — rejects
  `javascript:`, `file:`, `data:`, malformed URLs.
- `useAgent.start` throws `AgentForbiddenError` if
  `isProjectAiDisabled(projectId)` before opening the SSE stream.
- `microcopy.ai.*` — hardcoded English strings centralised with
  `en.ts` and `zh-CN.ts` translations.
- `aiErrorView` — explicit branches for budget, forbidden,
  not-found, server errors with `retryable` flags;
  `disabledForSeconds` for rate-limit errors with
  `setInterval` countdown disabling the retry button.
- `src/__tests__/aiAccessibility.strict.test.tsx` +
  `src/__tests__/uiAccessibility.strict.test.tsx` — 31 jest-axe tests
  across the AI surfaces and the shared UI scaffolding they depend on.
  `AiMatchStrengthBadge` compact-mode WCAG 4.1.2 fix.

### v2.1 streaming infra

- `agentClient.ts` parses Server-Sent `StreamPart` events and maps
  non-OK responses to typed errors.
- `FE_TOOL_REGISTRY` exposes 12 read-only FE tools; six are
  wire-bound to `chat-agent` via `chatTools.ts`. Snake_case args
  match BE schemas.
- `useAgent` drives a turn end-to-end, reduces stream parts into UI
  state, persists `thread_id` per `(name, project)`, auto-resumes
  on FE-tool interrupts, and enforces per-project AI opt-out.
- `commandPalette` opens with `Cmd/Ctrl+K`; ARIA combobox + listbox.
- `useAutonomyLevel` persists `boardCopilot:autonomy` (`suggest` /
  `plan` / `auto`, default `plan`); `useAgent` subscribes via
  `autonomyRef`. The "Auto" option is hard-disabled in v2.1 with an
  explanatory tooltip until v3 preapproved-tools work ships.
- Triage-nudge inbox rules in `useAgent` (PRD AC-V14): cap-5,
  dedup by `(kind, project_id)`, 4-hour expiry with 60s prune
  sweep, explicit `dismissNudge(nudge_id)` API. Pure
  `reduceNudgeInbox` reducer exported for unit tests.

### v2.1 REST-route migration

All six structured routes are on the v2.1 SSE agent surface in
remote builds; `useAi` v1 JSON path is retained as the
local-engine fallback in each component.

- `BoardBriefDrawer` → `useAgent("board-brief-agent")` — consumes
  `surface: "brief"` payloads; renders `CitationChip` footer.
- `AiTaskDraftModal` → `useAgent("task-drafting-agent")` — consumes
  `surface: "draft"` for both single-draft and `{axis, items}`
  breakdown payloads. Two sequential interrupts (`fe.boardSnapshot`,
  `fe.similarTasks`) auto-resume.
- `AiTaskAssistPanel` → `useAgent("task-estimation-agent")` —
  consumes the bundled `surface: "estimate"` payload
  `{estimate, readiness}`. `adaptV21Readiness` shim maps the
  v2.1 `{ready, missing[]}` shape onto the legacy
  `IReadinessReport.issues[]` shape so existing UI continues to
  work.
- `AiSearchInput` → `useAgent("search-agent")` — consumes
  `surface: "search"` payload; new `fe.searchCandidates` FE tool
  resolves the search-agent interrupt from the React Query cache
  (cap 50 `{id, text}` per kind).
- `AiChatDrawer` → `useAgentChat` (which wraps
  `useAgent("chat-agent")`) — SSE streaming; tool-trace bubbles
  synthesised from `pendingInterrupt` events.

`board.tsx` mounts `useAgent("triage-agent", …)` in remote mode
and fires once per `(projectId, app session)` when the chat drawer
first opens; nudges are fed to `AiChatDrawer` via `pendingNudges`.

---

## Acceptance-criteria status (against the PRD)

| ID | Acceptance criterion | Status |
| ----- | ---- | --- |
| AC-A1 | With AI off, `TaskCreator` is unchanged | ✅ |
| AC-A2 | Draft button opens the modal with a streaming partial form | ✅ (local engine resolves synchronously; UX scaffold for streaming) |
| AC-A3 | Submitted task is indistinguishable from a manually created one | ✅ (uses existing `newTaskCallback`) |
| AC-A4 | Unknown `columnId` is rejected and replaced with the opener column | ✅ (`validateDraft`) |
| AC-A5 | Unknown `coordinatorId` is rejected and replaced with the current user | ✅ |
| AC-A6 | Escape / unmount aborts the in-flight request | ✅ (`AbortController`) |
| AC-A7 | Breakdown posts each subtask via `useReactMutation` | ✅ |
| AC-B1 | With AI off, the task modal is unchanged | ✅ |
| AC-B2 | Opening a task triggers exactly one estimation; further estimations are debounced | ✅ (1000 ms `useDebounce`) |
| AC-B3 | Suggested `storyPoints` is always in `{1,2,3,5,8,13}` | ✅ (`clampToFibonacci`) |
| AC-B4 | Each `similar[]._id` is present in the project's `tasks` cache | ✅ (`validateEstimate`) |
| AC-B5 | `Apply suggestion` does not submit the form | ✅ (only `form.setFieldsValue`) |
| AC-B6 | Closing the modal mid-request aborts the request | ✅ |
| AC-C1 | With AI off, no Brief button is rendered | ✅ |
| AC-C2 | Brief opens immediately and renders within ≤2s for ≤200 tasks | ✅ (local engine synchronous; remote SLO measured once proxy ships) |
| AC-C3 | All `taskId` and `memberId` references in the brief exist in the cache | ✅ (`validateBoardBrief`) |
| AC-C4 | Brief is read-only except deep-linking into the existing task modal | ✅ |
| AC-C5 | Drawer's request is aborted when the drawer closes | ✅ |
| AC-D1 | Only registered read-only tools can run client-side | ✅ (`chatTools.ts` whitelist) |
| AC-D2 | Tool definitions not supplied from user thread (remote must own tools) | ✅ |
| AC-D3 | Closing the chat drawer aborts in-flight work | ✅ |
| AC-D4 | Conversation cleared on hard reload | ✅ (in-memory state only) |
| AC-E1 | Returned `ids` intersected with cache | ✅ (`validateSearch`) |
| AC-E2 | Empty semantic search restores list + hint | ✅ |
| AC-E3 | Clearing AI search restores prior filters | ✅ |

---

## Test coverage

Full FE suite: last recorded full coverage run was **142 suites / 1000
tests, all green** (2026-05-05). The canonical current suite count for
release verification lives in [`release-todo.md`](release-todo.md).
Coverage on the runtime AI scope: **97% statements /
92.37% branches / 97% functions / 97.84% lines**.

Backend: **914+ tests passing, 100% coverage gate**.

---

## How to verify what shipped

```bash
npm install
npm run eslint
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text-summary
npx vite build
```

Expected: lint clean, ≥97% statement coverage, build succeeds.

To exercise Board Copilot in the browser:

1. `npm start`, log in (any non-`wrong` email + password against the
   mock backend).
2. Open a project board.
3. Click `Brief` in the board header (Capability C).
4. Click `+ Create task` → `Draft with AI`, type a prompt, click
   `Draft task` (Capability A) or `Break down` for subtasks.
5. Open any existing task to see the Board Copilot sidebar
   (Capability B).
6. Click `Ask` in the board or project list header (Capability D).
7. Use **Find related tasks/projects** above the board or project
   filters; clear with **Clear AI search**.

To turn AI off without rebuilding, use the **Board Copilot** switch
in the app header, or:

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

To force the local engine in a deployed build (e.g., for a demo
without a backend):

```bash
REACT_APP_AI_USE_LOCAL=true npm run build
```

---

## What is open

For the live blocker / soft-blocker / polish list see
[`release-todo.md`](release-todo.md).
The mutation-lifecycle GA blocker gates public ship; the three Beta
blockers (provider 5xx fallback, proxy-scoped JWT, real-backend
integration tests) gate design-partner expansion; the search /
estimation quality ceiling is the public-GA quality gate.
