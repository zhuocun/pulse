# Product done — Board Copilot implementation changelog

Companion to [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md) (backend / wire contract)
and [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md) (UX layer). Tracks what has shipped
to `main`, the per-feature inventory, and pointers to what remains
open. Per-PR history lives in git log.

| Field        | Value                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | Phases 0–4 shipped; AI UX Phase 1 trust/privacy corrections merged; v2.1 SSE migration complete for all six structured routes; architecture-theme backlog closed on ``orch/architecture-todo-impl-9ea4/integrate-architecture-backlog-closeout`` ([`architecture-todo.md`](architecture-todo.md)); **GA §1 partial** — stub LangGraph HITL + FE interrupts verified; **sign-off** tracks organic proposals + Mongo/Jest/replay proof ([`release-todo.md`](release-todo.md) §1; [`verification-logs/2026-05-11-close-theme5-mutation-lifecycle-verifier.md`](verification-logs/2026-05-11-close-theme5-mutation-lifecycle-verifier.md); [`../verification/close-theme5-mutation-lifecycle-verifier-report.md`](../verification/close-theme5-mutation-lifecycle-verifier-report.md)). |
| Last updated | 2026-05-13                                                                                                                                                                       |
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
| Backend release gates | — | ⏳ **GA §1 partial:** stub LangGraph mutation lifecycle + journal APIs on integrate branch; **sign-off** for organic chat + Mongo-backed undo/record + apply/replay Jest proof — [`release-todo.md`](release-todo.md) §1; [`../verification/close-theme5-mutation-lifecycle-verifier-report.md`](../verification/close-theme5-mutation-lifecycle-verifier-report.md) |
| Cross-provider chat failover (`with_fallbacks`, `AGENT_CHAT_MODEL_FAILOVER`) | [`release-todo.md`](release-todo.md) §2 | ✅ Anthropic/OpenAI retryable-error failover with OTel hooks; `tests/test_llm_failover.py` |
| Optional pgvector vector search (`AGENT_VECTOR_SEARCH_ENABLED`, DDL + dimensions alignment) | [`release-todo.md`](release-todo.md) §4 | ✅ Estimation + search agents consume optional neighbours; operator embeddings backfill remains |
| Polish-step JSON schema (`PolishStep`, `method="json_schema"` when supported) | [`release-todo.md`](release-todo.md) §5 | ✅ Provider-level polish validation ahead of FE validators |
| Hermetic vs real-stack tests (`integration` marker, `RUN_INTEGRATION=1`) | [`release-todo.md`](release-todo.md) §6 | ✅ Default CI stays 100%-coverage hermetic; integration suite opt-in for ops |
| Backend CI matrix + `workflow_dispatch` modes | [`release-todo.md`](release-todo.md) §7 | ✅ Workflow definitions; numeric evidence via reruns + [`verification-logs/`](verification-logs/) (not inline totals in status docs) |
| Fly.io default `app` in `backend/fly.toml` | [`release-todo.md`](release-todo.md) §16e | ✅ Repo default `pulse-backend` with explicit rename-before-deploy header; deployment guide + `backend/README.md` aligned |
| Frontend CI (Prettier, ESLint check, tsc, Jest, Vite build on FE paths) | [`release-todo.md`](release-todo.md) §7b | ✅ `.github/workflows/frontend-ci.yml` |
| `custom/suggestion` event handler (`lastSuggestion` / `clearSuggestion`) | — | ✅ |
| Autonomy selector UI in `AiChatDrawer` (Suggest / Plan / Auto-disabled) | — | ✅ |
| `autonomyRef` wired to `useAutonomyLevel` | — | ✅ |
| v2.1 REST-route migration — all six structured routes on SSE in remote builds | — | ✅ |
| Triage-nudge inbox rules (PRD AC-V14: cap-5, dedup, 4h expiry, dismiss) | — | ✅ |
| `mapErrorResponse` honors typed `{code, message}` envelope | — | ✅ |
| `useAgentChat.dismissNudge` propagates to `useAgent` inbox | — | ✅ |
| Security — JWT-in-localStorage XSS exfiltration | [`release-todo.md`](release-todo.md) §3 | ✅ `ai_jwt` (`scp=ai_proxy`) in `sessionStorage`; AI calls prefer `AiProxyJwt` in `aiAuthHeader.ts`; REST rejects narrow proxy scope |
| `AGENT_PROPOSAL_UNDONE` + mutation journal HTTP | — | ⏳ **Partial** — FE toast calls `agents/mutations/undo` after apply (`applyMutation.ts`); end-to-end **Mongo HTTP** + `applyMutationTool.run` Jest coverage not in verifier logs — [`release-todo.md`](release-todo.md) §1 |
| Triage-agent on `/projects` list page | — | ⏳ Skipped (no `project_id`; rate-limit risk) |
| `taskCreator` / `columnCreator` keyboard + a11y rebuild | UX (ui-todo §13) | ✅ `CreateLink` and `AddColumnButton` ship as real `<button type="button">` with focus-visible styling; the always-on faux empty column is gone (collapsed-button → input on click) |
| `column` task card + dropdown actions a11y | UX (ui-todo §21) | ✅ `TaskCard` is a real `<button type="button">` with `aria-label`; dropdown menu uses AntD `<Dropdown>` + `NoPaddingButton` |
| Board task-card visual rebuild (Phase 2.4 partial) | UX (ui-todo §8) | ✅ `EpicTag`, `TaskTypeBadge` (with explicit `Bug` / `Task` text), `StoryPointsTag`, `UserAvatar` for coordinator, count `<Badge>` on column header, `MoreOutlined` dropdown trigger, `overflow-y: auto` (native scrollbar) |
| Edit Task modal — footer-slot delete + dynamic title | UX (ui-todo §10, Phase 2.6) | ✅ `Delete` in real `Modal.footer` slot (Delete-left tablet+, stacked phone); title reads `${editTask} · ${taskName}` with type tag |
| Auth forms — `Form.Item label`, autoComplete, show-password, caps-lock, register password strength, Terms link | UX (ui-todo §11, Phase 2.7) | ✅ Both `loginForm` and `registerForm` use `<Form.Item label>` with i18n labels, proper `autoComplete` attrs (login identifier `username` + `current-password`; register `email`, `username`, `new-password`), show/hide password toggle, caps-lock hint, localized password-strength hint on register (`PasswordStrengthHint`, `microcopy.auth.passwordStrength.*`), login + register `microcopy.auth.terms*` agreement line linking to `/auth/terms` placeholder page (`src/pages/terms/index.tsx`): `routes/index.tsx` |
| `taskSearchPanel` side-effect-in-render fix | UX (ui-todo §9) | ✅ `coordinators` and `types` derived through `useMemo` with `Set`-based deduping; no more `tasks?.map(... return null)` for side effects |
| Design-token contributor reference | UX (ui-todo §20e / §2.C) | ✅ [`docs/design-tokens.md`](../design-tokens.md) documents scales and AntD mapping; implementation remains `src/theme/tokens.ts` + `src/theme/antdTheme.ts` |
| `CopilotAboutPopover` i18n + configurable knowledge cutoff | UX (ui-todo §20c) | ✅ Mode tags from `microcopy.about.*`; cutoff from `knowledgeCutoffTemplate` + `resolveAiKnowledgeCutoffForUi` (`REACT_APP_AI_KNOWLEDGE_CUTOFF`, optional wire `knowledge_cutoff`) |
| Copilot About — `chat-agent` `rate_limit` / `allowed_autonomy` in UI | [`release-todo.md`](release-todo.md) §14 | ✅ Remote-only `useChatAgentMetadata` + session `getSessionCachedAgentMetadata`; loading/empty/error handling in `CopilotAboutPopover` |
| `CopilotShell` tab/title/placeholder i18n (`microcopy.copilotShell`) | UX ([`ui-todo.md`](ui-todo.md) §20f partial) | ✅ `en` / `zh-CN` keys; component + tests read from `microcopy` |
| Task card type icons — decorative img a11y (`TaskTypeBadge`) | UX ([`ui-todo.md`](ui-todo.md) §21) | ✅ `<img alt="" aria-hidden>` beside visible type labels; regression test in `column/index.test.tsx` |
| `useAgent` nudge-inbox extracted into `useNudgeInbox` hook | [`release-todo.md`](release-todo.md) §16b / [`architecture-todo.md`](architecture-todo.md) Theme 3 | ✅ AC-V14 reducer + state moved to `src/utils/hooks/useNudgeInbox.ts`; `useAgent` re-exports `reduceNudgeInbox` / `NUDGE_INBOX_MAX` / `NUDGE_EXPIRY_MS` for compatibility |
| Members popover avatars + count badge + shared cached query | UX ([`ui-todo.md`](ui-todo.md) §14, §19 remaining) | ✅ `useMembersList()` centralizes the `users/members` React Query (5-minute `staleTime`); 4 consumers migrated; popover trigger renders avatar group + count badge; no refetch on open |
| Throttled spinners across AI surfaces | UX ([`ui-todo.md`](ui-todo.md) Phase 3.5 / 2.A.7) | ✅ `useDelayedFlag(active, 250)` hook gates visible spinners in `AiTaskAssistPanel`, `AiChatDrawer`, and `BoardBriefDrawer`; underlying loading state and analytics unchanged |
| Microcopy / casing sentence-case sweep | UX ([`ui-todo.md`](ui-todo.md) §17 / Phase 3.1) | ✅ Value-only update across `src/i18n/locales/en.ts` (`Login` → `Log in`, `Register` → `Sign up`, `Open Chat` → `Open chat`, `Board Brief` → `Board brief`, etc.); zh-CN parity preserved; affected tests updated |
| `CopilotAboutPopover` + wire `AgentMetadata` (budget cap, limits, tags, schema keys) | [`release-todo.md`](release-todo.md) §13–§14 | ✅ BE `as_dict()` + `monthly_token_budget_cap`; FE shows cap line, `recursion_limit`, `tags`, `context_schema` shape; i18n `en`/`zh-CN` |
| MCP streamable HTTP `/mcp` + read-only `fe.*` tools | [`release-todo.md`](release-todo.md) §15 | ✅ `MCP_ENABLED` gates mount; FastMCP + REST JWT middleware (`app/mcp_server.py`, `mcp_tools.py`); tests `test_mcp_wiring.py`, `test_mcp_mount_fn.py` |
| LangGraph store hint: brief drift → triage | [`release-todo.md`](release-todo.md) §16 | ✅ `project_profile` / `last_board_brief` written in `board_brief.py`, read in `triage.py` for polish context |
| `useAgent` SSE stream consumer extraction | [`release-todo.md`](release-todo.md) §16b | ✅ `useAgentStreamConsumer.ts` (`forEachAgentStreamPart`) + `useAgentStreamConsumer.test.ts`; `useAgent.ts` delegates loop |
| Per-project chat model map + header merge | [`release-todo.md`](release-todo.md) §16c | ✅ `AGENT_PROJECT_CHAT_MODEL_MAP` + `X-Pulse-Model` precedence in `_dispatch.py` / `agents.py`; tests `test_dispatch_chat_context_merge.py`, `test_agents_request_context_merge.py` |
| Multi-worker Uvicorn guard + Docker `UVICORN_WORKERS` | [`release-todo.md`](release-todo.md) §16d | ✅ Boot raises if workers>1 without Redis rate/budget/idempotency + `REDIS_URI`; Dockerfile passes `${UVICORN_WORKERS:-1}`; tests `test_production_backend_guards.py` |
| Task card keyboard-drag affordance hint | UX ([`ui-todo.md`](ui-todo.md) Phase 3.4 / 2.A.9 — WCAG 2.5.7) | ✅ Task-card button exposes `title={microcopy.dragHints.taskCardKeyboard}` + `aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"`; en + zh-CN parity; column test asserts the hint |
| `useAgent` FE-tool resolver extracted into `useAgentToolResolver` hook | [`release-todo.md`](release-todo.md) §16b / [`architecture-todo.md`](architecture-todo.md) Theme 3 | ✅ FE-tool registry lookup + 8-round auto-resume loop + stream-part reducer + mid-stream typed-error mapping moved to `src/utils/hooks/useAgentToolResolver.ts`; focused tests in `useAgentToolResolver.test.ts` |
| Header logo a11y label + AI assist / brief drawer live regions | UX ([`ui-todo.md`](ui-todo.md) §21 / Phase 3.4 4.1.3) | ✅ `microcopy.header.logoLabel` (`Pulse home` / `Pulse 首页`) wired to logo button `aria-label` + `title`; `AiTaskAssistPanel` and `BoardBriefDrawer` expose discrete polite live regions for loading/ready/error status without leaking raw payloads |
| Board page error + empty parity with project list | UX ([`ui-todo.md`](ui-todo.md) §16) | ✅ Top-of-board `<Alert>` + Retry on `boards`/`tasks` query failure; zero-column board renders `EmptyState` with `Create your first column` CTA that focuses the inline column creator; new error-state test covers Retry behavior |
| Task modal Type select uses canonical Task / Bug constant | UX ([`ui-todo.md`](ui-todo.md) §10 / Phase 2.6) | ✅ `TASK_TYPE_OPTIONS` mirrors the schema regardless of dataset shape (still localized via `microcopy.options.taskTypes.*`); regression tests added for empty + single-type datasets |
| `Suggested by Copilot` badge on AI story-points Apply | UX ([`ui-todo.md`](ui-todo.md) 2.A.8 partial) | ✅ `appliedFieldOrigin` provenance tracked in `TaskModal`; `microcopy.ai.suggestedByCopilot` (en + zh-CN) renders next to Story points after Apply and clears on user edit; unit test covers both branches |
| Forgot-password link + placeholder `/auth/forgot-password` route | UX ([`ui-todo.md`](ui-todo.md) §11 / Phase 2.7) | ✅ Right-aligned `Forgot password?` link in `LoginForm` (i18n + accessible name); placeholder page in `src/pages/forgotPassword/` with title + body keys; route + auth-route gating wired; tests cover link presence, route render, and gating |
| Architecture / UI status backlog reconciled vs codebase | [`architecture-todo.md`](architecture-todo.md), [`ui-todo.md`](ui-todo.md) | ✅ 2026-05-11 closure snapshot on integrate branch — themes dispositioned to shipped vs archive deferrals; verification pointers in [`architecture-todo.md`](architecture-todo.md); former per-theme action tables retired |
| Architecture integrate branch (Theme 5 + remaining themes) | [`architecture-todo.md`](architecture-todo.md) | ✅ ``orch/architecture-todo-impl-9ea4/integrate-architecture-backlog-closeout`` merges verified Theme 5 + Themes 2–4/6 hygiene — evidence via [`verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md`](verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md) + [`../verification/integrate-architecture-backlog-closeout-verification.log`](../verification/integrate-architecture-backlog-closeout-verification.log) |
| Theme 5 — stub mutation HITL graph + `fe.applyMutation` wiring | [`architecture-todo.md`](architecture-todo.md) Theme 5 / [`release-todo.md`](release-todo.md) §1 | ✅ LangGraph pytest `test_chat_mutation_lifecycle.py` + targeted Jest — commands in [`verification-logs/2026-05-11-close-theme5-mutation-lifecycle-verifier.md`](verification-logs/2026-05-11-close-theme5-mutation-lifecycle-verifier.md) and [`../verification/close-theme5-mutation-lifecycle-verifier-report.md`](../verification/close-theme5-mutation-lifecycle-verifier-report.md) |
| Theme 2 — mid-stream transport errors (`408`/`504`) | [`architecture-todo.md`](architecture-todo.md) Theme 2 | ✅ `mapErrorResponse` + `coerceAgentTransportError` + SSE consumer wiring + tests — transcript [`../verification/close-remaining-architecture-themes-verifier-036a.log`](../verification/close-remaining-architecture-themes-verifier-036a.log) |
| Theme 3 — metadata autonomy allow-list + stable chat deps | [`architecture-todo.md`](architecture-todo.md) Theme 3 | ✅ `useAiEnabled` clamp + `AiChatDrawer` picker + `useAgentChat` dependency hygiene — same verifier log as Theme 2 |
| Theme 4 — operator SSE resume / idempotency runbook | [`architecture-todo.md`](architecture-todo.md) Theme 4 | ✅ [`../operations/agent-stream-resume.md`](../operations/agent-stream-resume.md); FE depth deferrals in [`../archive/architecture-theme4-fe-deferred.md`](../archive/architecture-theme4-fe-deferred.md) |
| Theme 6 — intelligence depth explicitly deferred | [`architecture-todo.md`](architecture-todo.md) Theme 6 | ✅ [`../archive/architecture-theme6-deferred.md`](../archive/architecture-theme6-deferred.md) |
| Integration verifier log (merged baseline) | [`verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md`](verification-logs/2026-05-11-integrate-architecture-backlog-closeout-verifier.md) | ✅ Post-merge typecheck + targeted Jest + pytest (see file); alternate transcript [`../verification/integrate-architecture-backlog-closeout-verification.log`](../verification/integrate-architecture-backlog-closeout-verification.log) |
| Project detail shell collapse + `Breadcrumb` + board redirect | UX ([`ui-todo.md`](ui-todo.md) §1.1 item 5, Phase 1.3, Phase 2.5 §5) | ✅ `orch/todo-sweep-566b/fix-project-detail-shell` — `src/pages/projectDetail.tsx`, `src/pages/projectDetail.test.tsx`, `src/__tests__/projectDetailPage.breadcrumb.test.tsx`, `microcopy.breadcrumb.projects` en/zh-CN |
| `AiChatDrawer` polish (tool payload disclosure, timestamps, copy, char cap) | UX ([`ui-todo.md`](ui-todo.md) §12 / §2.A.8) | ✅ `orch/todo-sweep-566b/chat-drawer-polish` — `src/components/aiChatDrawer`, `src/__tests__/aiAccessibility.strict.test.tsx` |
| Auth forms — `AuthErrorSummary`, paste/`inputMode`/`enterKeyHint`, fluid card, bottom `Link` CTAs | UX ([`ui-todo.md`](ui-todo.md) §11, Phase 2.7) | ✅ `orch/todo-sweep-566b/auth-form-completion` — `loginForm`, `registerForm`, `authErrorSummary`, `authLayout.test.tsx`, `uiQuality.strict.test.tsx` slice |
| Login — Safari / iOS Keychain (`autoComplete="username"` on identifier) + storage persistence guard | UX ([`ui-todo.md`](ui-todo.md) §4 item 3.3.7) | ✅ `loginForm` + `microcopy.feedback.loginCouldNotPersistSession` (`en` / `zh-CN`); `writeAuthToken` failure blocks redirect |
| Login — Safari Mobile session after `/projects` navigation | UX ([`ui-todo.md`](ui-todo.md) §4 item 3.3.7) | ✅ `useCachedQueryData` in `useAuth`, token-primary `home`/`RootRedirect`, iOS `nativeNavigate` post-login, softer `refreshUser` on transient errors; follow-up: `api()` now plumbs `error.status` and `refreshUser` only clears the session on a confirmed 401 (Safari's `TypeError("Load failed")` and Vercel cold-start 5xx no longer bounce the user back to `/login`); `isNetworkFetchFailure` also matches Safari's network-error shapes; iPhone iOS 25.5 follow-up: `loginForm` calls `nativeNavigate` synchronously (no `queueMicrotask`) so the full-document assign preempts the `useSyncExternalStore`-driven `<Navigate>` re-render that would otherwise `replaceState` the URL to `/projects` and make `location.assign(currentURL)` a silent no-op; `nativeNavigate` also falls back to `reload()` when the target URL already matches the current location |
| Drag-and-drop affordances — task lift, drop placeholder, column drag handle | UX ([`ui-todo.md`](ui-todo.md) §15, Phase 3.8 partial) | ✅ `orch/todo-sweep-566b/dnd-affordances` — `src/components/column` (`index.test.tsx`, `column-dnd.test.tsx`), `src/components/dragAndDrop/index.test.tsx`, `src/pages/board.test.tsx` |
| `AiFeedbackPopover` parity on task assist + board brief | UX ([`ui-todo.md`](ui-todo.md) §20b) | ✅ verify-feedback-parity `## Branch` recorded **`(no branch)`** (handoff `Target` was `orch/todo-sweep-566b/feedback-parity`) — `src/__tests__/aiCopilotSurfaceFeedback.strict.test.tsx`, `src/__tests__/aiAccessibility.strict.test.tsx`, `aiTaskAssistPanel`, `boardBriefDrawer`, `microcopy.feedback.*` en/zh-CN |

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
  `src/__tests__/uiAccessibility.strict.test.tsx` — jest-axe coverage across
  the AI surfaces and shared UI scaffolding they depend on (re-count via
  `npm test`). `AiMatchStrengthBadge` compact-mode WCAG 4.1.2 fix.

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

Do **not** treat narrative counts in this section as authoritative — they go
stale quickly. Use [`release-todo.md`](release-todo.md) (**FE verification**
and **BE verification** snippets), the latest run in
[`verification-logs/`](verification-logs/), and local `npm test` /
`pytest --cov` output for current suite sizes and coverage percentages.

Coverage on the runtime AI scope from the last archived summary still reads
**~97% statements / ~92% branches / ~97% functions / ~98% lines** on the AI
surfaces — rerun with `--coverage` to refresh.

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

For the live numbered backlog see [`release-todo.md`](release-todo.md): **only
🛑 GA §1** (`MutationProposal` accept + undo / `fe.applyMutation` path)
remains an open **code** gate in that file. Beta §2/§3/§6 and soft §4/§5/§7
are ✅ there (with operator caveats: Redis bundle for multi-worker,
`MCP_ENABLED`, pgvector backfill, pinned Actions URLs, etc.). Proposal cards
stay gated off by default until §1 closes (see §1 mitigation in
[`release-todo.md`](release-todo.md)).
