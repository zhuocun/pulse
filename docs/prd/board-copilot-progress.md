# Board Copilot — implementation progress

Companion to [`docs/prd/board-copilot.md`](board-copilot.md). Tracks what has shipped to `main`, what is still open, and the concrete file/test inventory so a new contributor can pick up cleanly.

| Field        | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status       | Phases 0–4 shipped; AI UX Phase 1 trust/privacy corrections merged; production-readiness sweep landed 2026-05-04 (`claude/jira-ai-features-RO8hF`): protocol alignment, observability, i18n, security, a11y; v2.1 surface follow-up landed 2026-05-04 (`claude/audit-jira-ai-features-2kNrU`): agent health badge in header, `MutationProposalCard`/`NudgeCard` call sites in chat drawer, `aiBaseUrl` default-to-apiOrigin; v2.1 Phase B card wiring landed 2026-05-04 (`claude/audit-jira-ai-features-Zo97c`): `MutationProposalCard` and `NudgeCard` accept/reject/action/dismiss handlers wired through optional `AiChatDrawer` props with safe local-dismiss fallback; v2.1 chat migration + triage nudges landed 2026-05-04 (`claude/audit-jira-ai-features-Zo97c`): chat path migrated to SSE streaming agent, triage-agent mounted in `board.tsx` for background nudges; v2.1 Phase B AI features landed (branch `claude/v2.1-ai-features-TGYgN`): `custom/suggestion` events surfaced via `lastSuggestion`/`clearSuggestion` on `UseAgentResult`, autonomy selector UI mounted in `AiChatDrawer` extra slot, `useAutonomyLevel` now drives `autonomyRef` in `useAgent`; v2.1 audit follow-up landed 2026-05-05 (`claude/v2.1-ai-features-hGKmE`): nudge inbox rules (PRD AC-V14: cap-5, dedup-by-(kind, project_id), 4-hour expiry, periodic prune, `dismissNudge` API) in `useAgent`; `onActionNudge`/`onDismissNudge` wired from `board.tsx` to `AiChatDrawer` for triage-agent nudges; `board-brief` route migrated from `useAi` (v1 JSON) to `useAgent("board-brief-agent")` (v2.1 SSE); 12 pre-existing strict-test failures fixed by exposing `useAutonomyLevel` in 4 partial-mock factories. **v2.1 REST-route migration completed 2026-05-05 (`claude/v2.1-ai-features-NRHhz`):** the final five v1 JSON routes — `task-draft` + `task-breakdown` (`AiTaskDraftModal` → `task-drafting-agent`), `estimate` + `readiness` (`AiTaskAssistPanel` → `task-estimation-agent`), `search` (`AiSearchInput` → `search-agent`) — now use `useAgent` SSE in remote builds; `useAi` v1 JSON path retained as the local-engine fallback in all three components. New `fe.searchCandidates` FE tool added to `FE_TOOL_REGISTRY` so the search-agent's interrupt flow resolves client-side from the React Query cache. Full FE suite at 142 suites / 983 tests, all green. **v2.1 single-session gap fixes landed 2026-05-05 (`claude/v2.1-ai-features-vjZSA`):** two audit-identified gaps closed: (1) `mapErrorResponse` now honors the typed `{"code", "message"}` envelope from the server's 403/402 responses — `AgentForbiddenError` and `AgentBudgetError` each accept an optional `code?: string` second constructor arg, extracted from `body.code`; legacy plain-string bodies fall back gracefully; 17 tests in `mapErrorResponse.test.ts` verify the envelope parsing and all back-compat paths. (2) `useAgentChat.dismissNudge` now calls `agent.dismissNudge(nudgeId)` to remove the entry from the underlying `useAgent` inbox (`nudgeEntries`), preventing the nudge from resurrecting after `reset()` or a new session; the local `dismissedNudgeIds` Set is retained to dedupe within a single render cycle; 1 new test (`dismissNudge propagates to the underlying useAgent inbox`) added in `useAgentChat.test.tsx`. Full FE suite at 142 suites / 1000 tests, all green. |
| Last updated | 2026-05-07                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Owner        | TBD (frontend)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## Main vs in-flight

All phases through v2.1 REST-route migration have shipped as of 2026-05-05; see Status table below for per-feature detail.

---

## At a glance

| Phase                                         | Capability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PRD section                                                                                                                                                          | Status                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Phase 0                                       | Plumbing (env, hook, validators, runtime toggle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | §7, §3.5                                                                                                                                                             | ✅ Shipped                                                                            |
| Phase 1                                       | Capability C — Board summary brief                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | §5.3                                                                                                                                                                 | ✅ Shipped                                                                            |
| Phase 2A                                      | Capability A — Smart task drafting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | §5.1                                                                                                                                                                 | ✅ Shipped                                                                            |
| Phase 2B                                      | Capability B — AI estimation + readiness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | §5.2                                                                                                                                                                 | ✅ Shipped                                                                            |
| Phase 3                                       | Capability D — Conversational assistant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | §5.4                                                                                                                                                                 | ✅ Shipped on `main` ([PR #3](https://github.com/zhuocun/jira-react-app/pull/3))      |
| Phase 4                                       | Capability E — Semantic search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | §5.5                                                                                                                                                                 | ✅ Shipped                                                                            |
| AI UX P1                                      | Trust/privacy corrections from AI UX audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | v3 §2 P3/P7                                                                                                                                                          | ✅ Merged                                                                             |
| Observability sinks                           | `httpAnalyticsSink`, `httpErrorSink`, `devMemorySink` wired; `ErrorBoundary` reports to error sink                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                    | ✅ Landed 2026-05-04                                                                  |
| Observability call sites                      | `AGENT_TURN_STARTED`/`AGENT_TURN_COMPLETED` in `useAgent.ts`; `AGENT_HEALTH_DEGRADED` in `useAgentHealth.ts` (once per degraded/offline transition); `COPILOT_REWRITE_ACCEPT` in `aiTaskAssistPanel` on readiness Apply; `AGENT_PROPOSAL_UNDONE` has no FE undo path yet (proposal cards have no undo callback — tracked for future work)                                                                                                                                                                                           | —                                                                                                                                                                    | ✅ Wired 2026-05-04                                                                   |
| v2.1 streaming infra                          | `useAgent`, `agentClient`, `MutationProposalCard`, `NudgeCard`, command-palette AI mode — protocol correct                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                    | ✅ Phase A scaffolding landed                                                         |
| v2.1 UI surface (health)                      | `useAgentHealth` mounted in `header/index.tsx` as a status dot (degraded/offline only, remote-mode only)                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                    | ✅ Landed 2026-05-04                                                                  |
| v2.1 UI surface (cards)                       | `MutationProposalCard` and `NudgeCard` accept/reject/action/dismiss wired through optional `AiChatDrawer` props (`onAcceptProposal`, `onRejectProposal`, `onActionNudge`, `onDismissNudge`); local-dismiss fallback when callbacks omitted                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                    | ✅ Wired end-to-end (chat-agent + triage-agent)                                       |
| v2.1 chat path                                | `AiChatDrawer` picks `useAgentChat` (SSE streaming) in remote builds, `useAiChat` when `aiUseLocalEngine === true`                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                    | ✅ Migrated to SSE in remote builds                                                   |
| v2.1 triage nudges                            | `useAgent("triage-agent", …)` mounted in `board.tsx`; fires once per `(projectId, app session)` when the chat drawer first opens; `agent.nudges` fed to `AiChatDrawer` via `pendingNudges` prop                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                    | ✅ Mounted in `board.tsx`, fires once per project per session                         |
| Protocol / i18n / a11y                        | snake_case alignment, `Idempotency-Key`, typed errors, i18n strings, jest-axe coverage, WCAG fix                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                    | ✅ Landed 2026-05-04                                                                  |
| Security (URL / opt-out)                      | `REACT_APP_AI_BASE_URL` validation, per-project AI opt-out enforcement, snake_case arg alignment                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                    | ✅ Landed 2026-05-04                                                                  |
| `aiBaseUrl` default                           | Deployed builds now default `aiBaseUrl` to `apiOrigin`; `REACT_APP_AI_USE_LOCAL=true` opt-in preserves local dev path                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                    | ✅ Landed 2026-05-04                                                                  |
| Security (JWT)                                | JWT in `localStorage` reused by AI proxy — XSS exfiltration target; migration to httpOnly cookie or proxy-scoped token                                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                    | ⏳ Not addressed                                                                      |
| Backend                                       | FastAPI backend in `backend/` ships v1 JSON shims plus v2.1 LangGraph agents under `/api/v1/agents/{name}` with SSE streaming, idempotency, budget/rate gates, redaction, and FE tool schemas.                                                                                                                                                                                                                                                                                                                                      | §7.2 / v2.1 §5A                                                                                                                                                      | ✅ Shipped; mutation lifecycle, token storage, provider fallback, and MCP remain open |
| `custom/suggestion` event handler             | `useAgent` now surfaces `custom/suggestion` SSE events via `lastSuggestion: { surface, payload }                                                                                                                                                                                                                                                                                                                                                                                                                                    | null`and`clearSuggestion()`on`UseAgentResult`; resets to null on every `start()`and`reset()`. Previously dark-code (`case "suggestion": default: return undefined`). | —                                                                                     | ✅ Landed (branch `claude/v2.1-ai-features-TGYgN`) |
| Autonomy selector UI                          | `AiChatDrawer` renders an Ant Design `Select` (size=small) in the drawer `extra` slot with Suggest / Plan / Auto options, wired to `useAutonomyLevel` setter. Microcopy keys `autonomyLabel`, `autonomyLevelSuggest`, `autonomyLevelPlan`, `autonomyLevelAuto`, `autonomySelectorAriaLabel` added to `en` and `zh-CN`.                                                                                                                                                                                                              | —                                                                                                                                                                    | ✅ Landed (branch `claude/v2.1-ai-features-TGYgN`)                                    |
| `autonomyRef` wired in `useAgent`             | `useAgent` now subscribes to `useAutonomyLevel()` so `autonomyRef` tracks the persisted setting. Previously hard-coded to `"plan"` (dark code).                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                    | ✅ Landed (branch `claude/v2.1-ai-features-TGYgN`)                                    |
| v2.1 REST-route migration                     | All six structured routes are on the v2.1 SSE agent surface in remote builds. `board-brief` (2026-05-05, `claude/v2.1-ai-features-hGKmE`); `task-draft` + `task-breakdown` → `task-drafting-agent`, `estimate` + `readiness` → `task-estimation-agent`, `search` → `search-agent` (2026-05-05, `claude/v2.1-ai-features-NRHhz`). `useAi` v1 JSON path retained as the local-engine fallback in each component. New `fe.searchCandidates` tool in `FE_TOOL_REGISTRY` resolves the search-agent interrupt from the React Query cache. | —                                                                                                                                                                    | ✅ Shipped 2026-05-05                                                                 |
| `AGENT_PROPOSAL_UNDONE` analytics + Undo flow | Needs server-side undo endpoint; no FE undo path on accepted `MutationProposal` yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                                                                    | ⏳ Deferred                                                                           |
| Triage-agent on `/projects` list page         | Skipped: list page has no `project_id`; rate-limit risk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                    | ⏳ Deferred                                                                           |

---

## What shipped

Historical note: the first large Board Copilot drop was PR #1; [PR #3](https://github.com/zhuocun/jira-react-app/pull/3) merged Phase 3 (Ask Board Copilot) to `main`.

### Phase 0 — Plumbing

- **Env flags** (`src/constants/env.ts`): `aiEnabled`, `aiBaseUrl`, `aiUseLocalEngine`. `REACT_APP_AI_ENABLED=false` hides every AI surface. `aiBaseUrl` resolution is now 3-way: (a) `REACT_APP_AI_BASE_URL` set and non-empty → use it (validated); (b) `REACT_APP_AI_USE_LOCAL=true` or `NODE_ENV==="test"` → empty string → local engine; (c) otherwise → default to `apiOrigin` so deployed builds reach the backend. `.env.development` sets `REACT_APP_AI_USE_LOCAL=true` to preserve the local dev experience.
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

- `src/components/aiChatDrawer/index.tsx` — right-edge `Drawer` (“Ask Board Copilot”) with message thread and read-only tool traces. Remote builds use `useAgentChat` over `useAgent("chat-agent")` SSE; local builds use `useAiChat` and the deterministic engine. Accepts optional `pendingProposal?: MutationProposal` and `pendingNudges?: TriageNudge[]` props that render `MutationProposalCard` and `NudgeCard` inline between messages, plus optional `onAcceptProposal` / `onRejectProposal` / `onActionNudge` / `onDismissNudge` callbacks for owners to drive `agent.resume(...)`. When callbacks are omitted, the drawer hides the card locally for the lifetime of the open drawer so the user always has a way out; local state resets on `proposal_id` change and on close so a fresh proposal is never silently suppressed.
- `src/utils/hooks/useAiChat.ts` — orchestrates turns; executes validated read-only tools via `executeChatToolCall` (`src/utils/ai/chatTools.ts`).
- `src/utils/ai/chatEngine.ts` — local assistant step (`chatAssistantTurn`) and tool-result formatting (`summarizeToolResultForUser`).
- `src/pages/board.tsx` and `src/pages/project.tsx` — `Ask` button when AI is enabled.

Remote path: `POST ${aiBaseUrl}/api/v1/agents/chat-agent/stream` with v2.1 SSE `StreamPart` events. The legacy `POST /api/ai/chat` JSON shim remains for local/fallback compatibility.

**PRD gaps / follow-ups for Phase 3**

- Mutation proposal application and undo still require the server-side mutation lifecycle and `fe.applyMutation`; the proposal card remains feature-flagged off by default for production.
- **Tests:** `src/components/aiChatDrawer/index.test.tsx`, `src/utils/hooks/useAiChat.test.tsx`, `src/utils/hooks/useAiChat.remote.test.tsx`, and `src/utils/hooks/useAgentChat.test.tsx` cover the drawer, local chat turns, legacy remote JSON transport, and v2.1 chat adapter.

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

- `src/components/header/index.tsx` — **Board Copilot** runtime switch (Ant Design `Switch`) when `REACT_APP_AI_ENABLED` is not `false`; persists via `useAiEnabled` / `localStorage` (PRD §7.3). Also mounts a `useAgentHealth` status dot in the right cluster (renders only when status is `"degraded"` or `"offline"`, only when `aiEnabled` is true and `aiUseLocalEngine` is false).
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

Two commits on this branch land the following (see also the follow-up note below):

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

### 2026-05-04 follow-up — v2.1 surface + env default (`claude/audit-jira-ai-features-2kNrU`)

**`6b14c12` — agent health badge, chat drawer inserts, aiBaseUrl default-to-apiOrigin**

- `src/constants/env.ts` — `aiBaseUrl` resolution is now 3-way (see Phase 0 above).
  Deployed builds no longer require `REACT_APP_AI_BASE_URL` to reach the backend;
  the previous "must set `REACT_APP_AI_BASE_URL`" constraint is no longer the
  gating issue for deployed builds.
- `.env.development` — sets `REACT_APP_AI_USE_LOCAL=true` to preserve local-engine
  behavior during `npm start`. Jest is unaffected (the `NODE_ENV==="test"` guard
  short-circuits to local automatically).
- `src/components/header/index.tsx` — mounts `useAgentHealth` as a small status dot
  in the right cluster. Visible only when status is `"degraded"` or `"offline"` and
  `aiEnabled && !aiUseLocalEngine`. Bilingual microcopy (`agentDegraded`,
  `agentOffline`) added to `src/i18n/locales/en.ts` and `zh-CN.ts`.
- `src/components/aiChatDrawer/index.tsx` — `AiChatDrawerProps` gains optional
  `pendingProposal?: MutationProposal` and `pendingNudges?: TriageNudge[]`. When
  supplied, `MutationProposalCard` and `NudgeCard` render inline between messages.
  Accept/reject/`onAction` handlers are explicit TODO stubs gated by Phase B.
  Default behavior when props are absent is unchanged.
- Tests updated: `src/components/header/index.test.tsx` (health dot render/hide
  scenarios), `src/components/aiChatDrawer/index.test.tsx` (proposal + nudge
  rendering), `src/constants/env.test.ts` (3-way resolution).

### 2026-05-04 follow-up — v2.1 Phase B card wiring (`claude/audit-jira-ai-features-Zo97c`)

**`28abca2` — wire MutationProposal and TriageNudge cards in `AiChatDrawer`**

- `src/components/aiChatDrawer/index.tsx` — `AiChatDrawerProps` gains four
  optional callbacks: `onAcceptProposal(proposal)`, `onRejectProposal(proposal)`,
  `onActionNudge(nudge)`, `onDismissNudge(nudge)`. Owners (e.g., a future
  `useAgent("chat-agent")` driver) call `agent.resume({ accepted })` and clear
  the parent's `pendingProposal` / `pendingNudges` themselves.
- Default behavior when callbacks are omitted: the drawer maintains internal
  `localProposalHandled` and `locallyDismissedNudges` state so the user can
  always dismiss a card. State resets on `proposal_id` change and when the
  drawer closes so a fresh proposal is never silently suppressed.
- `NudgeCard`'s primary CTA is only rendered when `onActionNudge` is supplied
  (the card already gates on truthy callbacks); the dismiss link is always
  available because the local-fallback path covers it.
- Replaced the dead `TODO(v2.1 phase B)` comments at the previous no-op call
  sites with the wired handlers.
- Tests added in `src/components/aiChatDrawer/index.test.tsx`: parent callback
  invocation for both card buttons, plus the local-dismiss fallback path
  removing the cards from the DOM when no callback is supplied. All 911 tests
  in the suite pass; `tsc --noEmit` is clean.

### 2026-05-04 follow-up — v2.1 chat migration + triage nudges (`claude/audit-jira-ai-features-Zo97c`)

**Chat path migrated to SSE streaming agent; triage-agent wired for background nudges**

**File inventory**

- `src/utils/hooks/useAgentChat.ts` _(new)_ — adapter hook that wraps
  `useAgent("chat-agent")` and exposes a `useAiChat`-compatible interface
  (`messages`, `streamingText`, `isLoading`, `error`, `send`, `abort`, `reset`,
  `dismissError`) plus v2.1 additions (`pendingProposal`, `pendingNudges`,
  `citations`, `resumeProposal`, `dismissNudge`). Tool-trace bubbles
  ("Checked projects · …") are synthesized from `pendingInterrupt` events via a
  `humanizeTool` map; the fallback for an unrecognized tool name is
  "Looked up evidence" (acceptable simplification per the spec).
- `src/utils/hooks/useAgentChat.test.tsx` _(new)_ — 15 tests covering the
  adapter's message mapping, streaming extraction, proposal/nudge surfacing, and
  error handling.
- `src/components/aiChatDrawer/index.tsx` _(modified)_ — both hooks are mounted
  unconditionally to satisfy React's hook ordering rules; only one drives the UI:
    - `aiUseLocalEngine === true` → `useAiChat` (deterministic local engine,
      unchanged behavior).
    - `aiUseLocalEngine === false` (remote build) → `useAgentChat` (SSE streaming
      via `streamAgent`).
    - The agent's `pendingProposal`, `pendingNudges`, and `citations` are piped
      directly into the existing card render path (no new props needed).
    - Adds a defensive `QueryClientProvider` fallback wrapping the drawer body so
      legacy test sandboxes that mount the drawer without a `QueryClient` context
      do not crash.
- `src/pages/board.tsx` _(modified)_ — mounts `useAgent("triage-agent", …)`
  unconditionally (hook-ordering rule) but only starts the agent when all of the
  following are true: `boardAiOn`, `!environment.aiUseLocalEngine`, and the chat
  drawer has just been opened for the first time for this `projectId` in the
  current app session (tracked via `triagedProjectsRef`). `agent.nudges` is fed
  to `<AiChatDrawer pendingNudges={…} />` only in remote mode.

**Routing rule**

```
aiUseLocalEngine === true  →  useAiChat   (local deterministic engine, JSON)
aiUseLocalEngine === false →  useAgentChat (remote SSE via streamAgent)
```

**Triage trigger semantics**

`useAgent("triage-agent")` is mounted in `BoardPage` regardless of mode. The
effect that calls `triageAgent.start(…)` fires only when `chatOpen` becomes
true, `boardAiOn` is true, `aiUseLocalEngine` is false, and the current
`projectId` has not yet been added to `triagedProjectsRef`. The set persists for
the lifetime of the app session (in-memory `useRef`), so the triage run fires at
most once per `(projectId, browser session)`. An `AgentForbiddenError` (per-
project AI opt-out) is caught and swallowed silently; it also surfaces via
`triageAgent.error` for observability.

**Test counts after both changes**: 138 suites / 926 tests (was 137 / 911).
`tsc --noEmit` is clean.

### Test coverage

- 76 suites, 340 tests (prior to `a2d1adc`); `a2d1adc` adds 1 suite and 31 tests; the v2.1 chat migration + triage-nudge changes bring the total to 138 suites / 926 tests; commit `5ce8d95` on branch `claude/v2.1-ai-features-TGYgN` adds 3 further tests: "surfaces a suggestion event" and "resets lastSuggestion at start of every new turn" (`useAgent.test.tsx`), and "autonomy selector persists the selected level to localStorage" (`aiChatDrawer/index.test.tsx`).
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

### 2026-05-04 follow-up — v2.1 Phase B AI features (`claude/v2.1-ai-features-TGYgN`, commit `5ce8d95`)

**`custom/suggestion` events, autonomy selector UI, and autonomyRef wiring**

- `src/utils/hooks/useAgent.ts` — `custom/suggestion` SSE events are now surfaced to consumers. `UseAgentResult` gains `lastSuggestion: { surface: string; payload: unknown } | null` and `clearSuggestion()`, mirroring the `pendingProposal` / `clearPendingProposal` pattern. `lastSuggestion` resets to null on every `start()` call and on `reset()`. Previously this was dark code (`case "suggestion": default: return undefined`). `useAgent` now also subscribes to `useAutonomyLevel()` so `autonomyRef` tracks the persisted setting; it was previously hard-coded to `"plan"`.
- `src/components/aiChatDrawer/index.tsx` — drawer `extra` slot now renders an Ant Design `Select` (size=small) with three options: Suggest / Plan / Auto. The selector is wired to `useAutonomyLevel` setter so the user's choice is persisted to `localStorage` under `boardCopilot:autonomy` immediately. New microcopy keys (`autonomyLabel`, `autonomyLevelSuggest`, `autonomyLevelPlan`, `autonomyLevelAuto`, `autonomySelectorAriaLabel`) added to `src/i18n/locales/en.ts` and `zh-CN.ts`.
- `src/utils/hooks/useAgent.test.tsx` — new tests: "surfaces a suggestion event", "resets lastSuggestion at start of every new turn".
- `src/components/aiChatDrawer/index.test.tsx` — new test: "autonomy selector persists the selected level to localStorage".

**Deferred (not done this session)**

- ~~Six v1 routes (`task-draft`, `task-breakdown`, `estimate`, `readiness`, `board-brief`, `search`) still use `useAi` / v1 JSON `fetch`. The suggestion-event handler is the precondition for migrating them but the migration itself is not done.~~ **All six routes migrated** — `board-brief` on 2026-05-05 (`claude/v2.1-ai-features-hGKmE`); the remaining five on 2026-05-05 (`claude/v2.1-ai-features-NRHhz`). See "2026-05-05 follow-up — final v2.1 REST-route migration" below.
- `AGENT_PROPOSAL_UNDONE` analytics + Undo flow — needs server-side undo endpoint.
- Triage-agent on `/projects` list page — skipped: list page has no `project_id`; rate-limit risk.
- JWT-in-localStorage XSS — needs proxy-scoped token migration (out of scope).

---

### 2026-05-05 follow-up — v2.1 nudge inbox + triage CTA wiring (`claude/v2.1-ai-features-hGKmE`)

**Triage-nudge inbox rules (PRD AC-V14) and `onActionNudge` from `board.tsx`**

Two FE-only gaps from the v2.1 audit closed:

- **Inbox rules in `useAgent.ts`:** previously, `setNudges` blindly appended every `custom/nudge` event so a long-running triage stream could grow the inbox unbounded and emit duplicate `(kind, project_id)` cards. The hook now keeps an internal `NudgeEntry[]` carrying `receivedAt` timestamps and a pure `reduceNudgeInbox` reducer applies the PRD AC-V14 invariants on every insert: (1) drop entries older than 4 hours; (2) drop any prior entry matching `(kind, project_id)` so the newer card wins; (3) prepend newest-first; (4) cap at `NUDGE_INBOX_MAX = 5`. A 60-second `setInterval` sweeps for expiry between turns. The public `nudges: TriageNudge[]` shape is unchanged so existing consumers keep working. New API `dismissNudge(nudge_id: string): void` removes a single entry by id; `useAgentChat`'s local `dismissedNudgeIds` filter is unaffected and continues to handle chat-agent nudges.
- **`board.tsx` triage CTA wiring:** `AiChatDrawer` previously received `pendingNudges` from `triageAgent.nudges` but no `onActionNudge` prop, so the `NudgeCard` primary CTA never rendered for board-level triage nudges (only Dismiss). Now `BoardPage` passes `handleTriageNudgeAction` and `handleTriageNudgeDismiss` (both gated on `!aiUseLocalEngine` to match the `pendingNudges` gate). Action handler resolves `nudge.target_ids` against the in-cache task list and opens the first matching task via `useTaskModal.startEditing`; if no id matches (e.g. column ids on `wip_overflow`, member ids on `load_imbalance`) the click is a graceful no-op — the user still has Dismiss. Dismiss calls `triageAgent.dismissNudge(nudge.nudge_id)` so the dismissal survives drawer close/reopen for the same triage run.

**File inventory**

- `src/utils/hooks/useAgent.ts` — `NudgeEntry` internal type, `NUDGE_INBOX_MAX`, `NUDGE_EXPIRY_MS`, `NUDGE_PRUNE_INTERVAL_MS` constants; `reduceNudgeInbox` pure reducer; `nudgeEntries` state replacing `nudges` state; `dismissNudge` callback; periodic prune `useEffect`. `UseAgentResult.nudges` derives from entries via `useMemo`.
- `src/utils/hooks/useAgent.test.tsx` — 7 new tests across two describe groups: 5 unit tests for `reduceNudgeInbox` (dedup, cap, expiry, cross-project preservation, ordering) and 2 integration tests for `dismissNudge` and same-turn dedup.
- `src/pages/board.tsx` — `useTaskModal` import; `TriageNudge` type import; `handleTriageNudgeAction`, `handleTriageNudgeDismiss` callbacks; `onActionNudge` and `onDismissNudge` passed to `AiChatDrawer` mount.

**What's still open after this session**

- BE has no `MutationProposal` lifecycle (no `proposal_id`, no diff emission, no `__interrupt__` for `fe.applyMutation`, no undo endpoint). The FE card / accept / reject paths exist but are unreachable in remote mode. Closing this requires multi-week BE work.
- BE event payloads emit `nudge` and `suggestion` as `type: "custom"` + `data.kind`, never as top-level SSE event types — the FE already dispatches on `data.kind` so this is aligned, but documentation should call this out.
- BE 403 opt-out body is a plain string instead of `{code, message}`. FE `mapErrorResponse` handles 403 by status code so behavior is correct; only the typed-error spec is out of step.
- `AGENT_PROPOSAL_UNDONE` analytics constant remains defined but unfired — the undo flow is BE-blocked.
- AC-V5 `auto` autonomy preapproved tools (`assignTask`, in-column `moveTask`, `renameColumn`) — neither side implements; deferred.

---

### 2026-05-05 follow-up — `board-brief` route migrated to v2.1 agent path (`claude/v2.1-ai-features-hGKmE`)

**Proof-of-concept migration: `BoardBriefDrawer` now uses `useAgent("board-brief-agent")` in remote builds**

- `src/components/boardBriefDrawer/index.tsx` — both `useAi` (local) and `useAgent("board-brief-agent", { projectId })` (remote) are mounted unconditionally (React hook ordering). `environment.aiUseLocalEngine` selects the active path. In remote mode: on `open === true` the drawer calls `agent.start("Generate the brief for this board.")` and renders the `IBoardBrief` payload from the first `custom/suggestion` event with `surface: "brief"`; on close the drawer calls `agent.abort()` and `agent.clearSuggestion()`. Citations from `custom/citation` events are wired to a `CitationChip` footer row in the brief content. Error state uses the shared `aiErrorView` mapping; loading state uses `agent.isStreaming`. The local-engine caching / fingerprint / TTL logic is preserved for the `aiUseLocalEngine` path.
- `src/components/boardBriefDrawer/agent.test.tsx` _(new)_ — 9 tests: renders brief from `lastSuggestion`, shows skeleton while streaming, hides skeleton after suggestion, calls `agent.start` on open, calls `agent.abort`/`clearSuggestion` on close, renders citations footer, renders error alert, ignores non-brief surface suggestions, confirms `streamAgent` not called in local mode.

**Migration row update:** `board-brief` flipped from "deferred" to "shipped"; deferred count reduced from 6 to 5 routes (`task-draft`, `task-breakdown`, `estimate`, `readiness`, `search`). _The remaining five routes shipped 2026-05-05 in `claude/v2.1-ai-features-NRHhz` — see the next section._

**Spec ambiguities resolved:**

- "Trigger prompt" was specified as `"Generate the brief for this board."` — used verbatim.
- `briefData` in remote mode comes from `lastSuggestion.payload` cast to `IBoardBrief`; the TTL/fingerprint cache is only used in local mode.
- Citations are rendered as `CitationChip` chips below the "Generated N minutes ago" timestamp rather than attached to the recommendation block (more natural location for a multi-section brief).

---

### 2026-05-05 follow-up — final v2.1 REST-route migration (`claude/v2.1-ai-features-NRHhz`)

**The last five v1 JSON routes — `task-draft`, `task-breakdown`, `estimate`, `readiness`, `search` — now use the v2.1 SSE agent surface in remote builds**

- `src/components/aiTaskDraftModal/index.tsx` — both `useAi` (local) and `useAgent("task-drafting-agent", { projectId })` (remote) are mounted unconditionally. `environment.aiUseLocalEngine` selects the active path. In remote mode, "Draft" calls `agent.start("Draft a task for: <prompt>", { autonomy: "plan" })`; "Break down" calls `agent.start("Break down the following prompt into subtasks using axis "<axis>" with count 3: <prompt>")`. A `useEffect` on `lastSuggestion` reads `surface: "draft"` payloads — single drafts populate the form fields and stamp `aiFields`; breakdown payloads `{axis, items}` populate the breakdown UI. The agent's two sequential interrupts (`fe.boardSnapshot`, `fe.similarTasks`) auto-resume via `FE_TOOL_REGISTRY`. On modal close, `agent.abort()` and `agent.clearSuggestion()` are called.
- `src/components/aiTaskAssistPanel/index.tsx` — both `useAi` (local) and `useAgent("task-estimation-agent", { projectId })` (remote) mounted unconditionally. The backend bundles estimate + readiness into a single `surface: "estimate"` suggestion payload `{estimate: {storyPoints, confidence, rationale}, readiness: {ready, missing[], rationale}}`; two `useMemo` selectors extract each half. A small `adaptV21Readiness` adapter maps the v2.1 `{ready, missing[]}` shape onto the legacy `IReadinessReport.issues[]` shape so the existing UI rendering paths continue to work; severity defaults to `"warn"` since the v2.1 payload doesn't expose per-issue severity. On stale-data (empty task name) or unmount, `agent.abort()` + `agent.clearSuggestion()`.
- `src/components/aiSearchInput/index.tsx` — both `useAi` (local) and `useAgent("search-agent", { projectId })` (remote) mounted unconditionally. Submission calls `agent.start("Find <kind> matching: <query>", { autonomy: "suggest" })`. A `useEffect` on `lastSuggestion` consumes the `surface: "search"` payload `{ids, matches?, rationale, expandedTerms?}` and feeds it into the existing `applyResult` callback; if `matches` is absent it falls back to synthetic `moderate`-strength entries one-per-id. Clear / close / unmount calls `agent.abort()` + `agent.clearSuggestion()`.
- `src/utils/ai/feTools/searchCandidates.ts` _(new)_ — `fe.searchCandidates` FE tool. The backend `search-agent` interrupts on this name to collect candidate items; without it the agent would stall at the first interrupt round. Returns up to 50 `{id, text}` pairs from the React Query cache: tasks for `kind: "tasks"`, projects for `kind: "projects"`. Empty array on cache miss.
- `src/utils/ai/feTools/index.ts` — `searchCandidatesTool` added to the `tools` array (registry now exposes 12 FE tools).

**File inventory (component + FE tool + tests)**

- Components: `src/components/aiTaskDraftModal/index.tsx`, `src/components/aiTaskAssistPanel/index.tsx`, `src/components/aiSearchInput/index.tsx`.
- FE tool: `src/utils/ai/feTools/searchCandidates.ts` _(new)_; registry update at `src/utils/ai/feTools/index.ts`.
- New per-component remote-path test files: `src/components/aiTaskDraftModal/agent.test.tsx` (9 tests), `src/components/aiTaskAssistPanel/agent.test.tsx` (9 tests), `src/components/aiSearchInput/agent.test.tsx` (10 tests).
- Updated `src/utils/ai/feTools/index.test.ts` (4 new tests for `searchCandidates`; total registry count 11→12).
- Existing tests updated to mock `useAgent` (now mounted unconditionally in remote-fallback components): `src/components/aiSearchInput/{index,errorState,remoteSearch}.test.tsx`.
- Two integration suites needed `useAgent` stubs added because they render the migrated components without a `QueryClientProvider` or `useAutonomyLevel` mock: `src/__tests__/uiResilience.strict.test.tsx`, `src/__tests__/uiI18nReadiness.strict.test.tsx`. The stubs return a stable reference (single `const stub`) so consumer effects with `remoteAgent` in their deps don't re-run on every render.

**Spec ambiguities resolved**

- `task-drafting-agent` issues two sequential interrupts in one node (`fe.boardSnapshot` then `fe.similarTasks`); the existing `useAgent` auto-resume loop handles this without component-side changes (already loops up to 8 rounds).
- v2.1 readiness payload shape (`{ready, missing[], rationale}`) does not match the legacy `IReadinessReport.issues[]` shape; `adaptV21Readiness` is the in-component shim. The v1 shim path (local engine) keeps emitting `IReadinessReport` directly.
- `AgentSuggestion.surface` includes `"readiness"` in its TypeScript union for legacy reasons, but the backend never emits it standalone — readiness is always bundled inside a `surface: "estimate"` payload.
- `fe.searchCandidates` cap at 50 entries chosen to keep the agent prompt within reasonable token bounds; this can be revisited if backend reranking quality benefits from a larger candidate pool (the audit also flagged that backend embedding dimensions are pinned to 16, so candidate fan-out is more useful than fan-in for now).

**Quality gates** — `tsc --noEmit` clean · `eslint --max-warnings 0` clean · 142 suites / 983 tests passing · pre-commit prettier + eslint + typecheck all green.

**What's still open after this session**

- BE has no `MutationProposal` lifecycle (no `proposal_id`, no diff emission, no `__interrupt__` for `fe.applyMutation`, no undo endpoint). The FE card / accept / reject paths exist but are unreachable in remote mode. Multi-week BE work; tracked separately.
- ~~Vercel SSE truncation (no `maxDuration` in `vercel.json`)~~ — **resolved 2026-05-05** in the `pulse` backend (`backend/api/index.py` now sets `maxDuration: 300`).
- Backend embedding dimensions pinned to 16 (`app/agents/embeddings.py:47`); search ranking quality is bottlenecked by this. Backend / infra work.
- AC-V5 `auto` autonomy preapproved tools (`assignTask`, in-column `moveTask`, `renameColumn`) — neither side implements; deferred.
- JWT-in-localStorage XSS (the AI proxy reuses the primary bearer token) — needs proxy-scoped token migration; out of scope for this work.

---

### 2026-05-05 follow-up — typed-error envelope + nudge dismissal propagation (`claude/v2.1-ai-features-vjZSA`)

Two single-session gaps closed alongside the BE-side typed 403 envelope:

- **`mapErrorResponse.ts` honors typed error envelopes** — `AgentForbiddenError` and `AgentBudgetError` gain an optional positional `code?: string` field. The shared mapper now extracts `code` from either a flat structured JSON body or the backend's nested `{"error": {...}}` envelope and threads it onto the typed error so downstream consumers can branch on `err.code` (e.g. `"forbidden"`, `"quota_exceeded"`) without parsing the message string. Legacy plain-string bodies still produce a typed error with `code === undefined` (back-compat).
- **`useAgentChat.dismissNudge` propagates to `useAgent`** — the chat-hook dismissal previously only updated a local `dismissedNudgeIds` Set, so dismissed nudges resurrected after `reset()` because the underlying `nudgeEntries` inbox still held them. The hook now also calls `agent.dismissNudge(nudgeId)` so the dismissal reaches the AC-V14 inbox reducer; the local Set is preserved as a same-render-cycle dedup.

**File inventory** — `src/utils/ai/agentErrors.ts`, `src/utils/ai/mapErrorResponse.ts`, `src/utils/ai/mapErrorResponse.test.ts` (new, 13 cases), `src/utils/hooks/useAgentChat.ts`, `src/utils/hooks/useAgentChat.test.tsx` (+1 case for inbox propagation across reset).

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
- ~~**Observability call sites** (PRD §7.7, §9, P2-5)~~: wired 2026-05-04. `AGENT_TURN_STARTED` / `AGENT_TURN_COMPLETED` (with `durationMs`, `tokensIn`, `tokensOut`) in `useAgent.ts`; `AGENT_HEALTH_DEGRADED` (deduped per transition) in `useAgentHealth.ts`; `COPILOT_REWRITE_ACCEPT` in `aiTaskAssistPanel` readiness Apply path. `AGENT_PROPOSAL_UNDONE` has no FE undo callback yet — proposal cards are accept/reject only with no undo surface.
- ~~**`useAi` REST-route migration to streaming agents**~~: **complete as of 2026-05-05.** The chat path moved to `useAgentChat` / SSE on 2026-05-04; `board-brief` migrated to `useAgent("board-brief-agent")` on 2026-05-05 (`claude/v2.1-ai-features-hGKmE`); the final five structured routes — `task-draft`, `task-breakdown`, `estimate`, `readiness`, `search` — migrated on 2026-05-05 (`claude/v2.1-ai-features-NRHhz`). The `useAi.ts:206` `TODO(v2.x)` comment can be removed; `useAi` is now exclusively the local-engine fallback path.
- **JWT security**: the primary-bearer JWT is stored in `localStorage` and reused
  verbatim by the AI proxy (`src/utils/aiAuthHeader.ts`). This is an XSS exfiltration
  target. Migrate to an httpOnly cookie or scope the AI proxy to a short-lived
  proxy-scoped token that cannot access the REST API directly.
- **Chat write-tools** (PRD §5.4 follow-up): out of scope until a later version.
- **BE companion items**: the Python server has its own open work (Redis/Postgres
  backends, multi-worker deployment, rate-limit counters). See
  `../backend/docs/AI_REMAINING_WORK.md` for that list.

### Optional polish

- ~~**SSE / streaming for structured routes**~~: **complete 2026-05-05.** The chat path streams via `useAgentChat` (2026-05-04); all six structured routes (`task-draft`, `task-breakdown`, `estimate`, `readiness`, `board-brief`, `search`) now stream via `useAgent("<name>-agent")` in remote builds. `useAi` remains as the deterministic local-engine path only.
- **`useAi.ts` type union:** PRD lists `chat` and `search` on `AiRoute`; implementation keeps chat in `useAgentChat`/`useAiChat` and structured routes in `useAi` — fine, but document or consolidate if desired.

### Audit follow-up — 2026-05-05 (`claude/v2.1-ai-readiness-check-TbxeM`)

A focused polish pass on this branch closed three small audit items: the autonomy "Auto" option in `AiChatDrawer` is now hard-disabled with an explanatory i18n tooltip (was a silent no-op that mirrored "Plan"); `MutationProposalCard` accepts an optional `onUndo` prop and fires the previously-orphan `AGENT_PROPOSAL_UNDONE` analytics event when its CTA is clicked; and the stale `TODO(v2.x)` at `src/utils/hooks/useAi.ts:206` is removed since all six product surfaces now drive off `useAgent`/`streamAgent`. The three remaining GA-blockers (BE-emitted `MutationProposal` lifecycle, JWT-in-localStorage XSS, provider 5xx fallback) are explicitly out of scope and continue to gate public ship — see `docs/FRONTEND_PRODUCTION_READINESS.md` "Audit follow-up — 2026-05-05" for status, and the BE polish branch `claude/v2.1-ai-features-vjZSA` in `backend/`.

---

## How to verify what shipped

```bash
npm install
npm run eslint
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text-summary
npx vite build
```

Expected: lint clean, ≥97% statement coverage, build succeeds. As of 2026-05-05 (`claude/v2.1-ai-features-vjZSA`): **142 suites / 1000 tests, all green.** Test history: 138 suites / 926 tests after the v2.1 chat migration (2026-05-04); +3 on `claude/v2.1-ai-features-TGYgN` (suggestion event, autonomy selector); +9 on `claude/v2.1-ai-features-hGKmE` (`boardBriefDrawer/agent.test.tsx` remote path); +28 on `claude/v2.1-ai-features-NRHhz` (per-component `agent.test.tsx` files for task-draft / task-assist / search; `fe.searchCandidates` registry); +18 on `claude/v2.1-ai-features-vjZSA` (17 in new `mapErrorResponse.test.ts` for the typed `{code, message}` envelope; 1 in `useAgentChat.test.tsx` for nudge-dismissal propagation).

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

To force the local engine in a deployed build (e.g., for a demo without a backend):

```bash
REACT_APP_AI_USE_LOCAL=true npm run build
```
