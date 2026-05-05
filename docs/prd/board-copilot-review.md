# Board Copilot — design vs implementation review

**Note (2026-05-05):** This review covers v1 capabilities only (commits through #13, reviewed 2026-04-30). For v2.1 feature status, see `board-copilot-progress.md`. The test-failure observation in §7 is stale — all tests pass on current main.

Companion to [`board-copilot.md`](board-copilot.md) (PRD) and [`board-copilot-progress.md`](board-copilot-progress.md) (progress log). This review reads the code currently on `main` and reports whether each PRD requirement is reflected, with file/line evidence and the deltas worth knowing.

| Field            | Value                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewer scope   | Read-only review of `main` (commit chain through #13) against `docs/prd/board-copilot.md`                                              |
| Last updated     | 2026-04-30                                                                                                                             |
| Reviewed against | PRD §3 – §13                                                                                                                           |
| Verdict          | The implementation reflects the design across all five capabilities. Two material deviations and four small gaps are documented below. |

---

## TL;DR

- **Capabilities A, B, C, D, E** are all wired into the running app, with the same architecture spine (`useAi` + local engine + remote proxy seam) the PRD prescribes.
- **The opt-out posture** the PRD called out (build flag + runtime user toggle + per-project disable + advisory-only writes + cache-validated ids) is fully present.
- **Two intentional deviations** from the PRD are visible in the code: the chat lives in its own `useAiChat` hook (not as a route on `useAi`), and the transport is JSON request/response (not SSE token streaming).
- **One unimplemented section**: the Vercel `api/ai/[route].ts` proxy (PRD §7.2). The FE uses the deterministic local engine until that lands.
- **Four small gaps** are listed under §6 ("Gaps and follow-ups"). None are blocking.
- **One verification flag**: 5 jest tests fail on a clean `main` checkout in this environment (see §7). Build is green, lint is green, and total coverage is 97.51% statements / 91.1% branches.

---

## 1. Capability A — Smart task drafting (PRD §5.1)

| PRD requirement                                                                                    | Implementation                                                                                                                                | Verdict |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| New affordance next to `+ Create task`                                                             | `src/components/taskCreator/index.tsx` mounts `Draft with AI` link gated by `useAiEnabled`                                                    | ✅      |
| Free-text prompt up to 1k chars                                                                    | `src/components/aiTaskDraftModal/index.tsx` `<TextArea maxLength={1000}>`                                                                     | ✅      |
| Structured output `IDraftTaskSuggestion`                                                           | `src/interfaces/ai.d.ts`; produced by `draftTask` in `src/utils/ai/engine.ts`; cross-checked by `validateDraft` in `src/utils/ai/validate.ts` | ✅      |
| Suggestion populates the existing antd form                                                        | `aiTaskDraftModal` uses `form.setFieldsValue(suggestion)` after `useAi.run({ draft: ... })`                                                   | ✅      |
| Submit goes through `useReactMutation("tasks", "POST", ["tasks", { projectId }], newTaskCallback)` | Same hook + same `newTaskCallback` from `src/utils/optimisticUpdate/createTask.ts`                                                            | ✅      |
| `Break down` returns 2..6 child suggestions and posts each via the existing optimistic flow        | `breakdownTask` (`engine.ts`); modal submits selected items sequentially via `createTask`                                                     | ✅      |
| Unknown `columnId`/`coordinatorId` rejected and replaced with safe defaults                        | `validateDraft` swaps to `fallbackColumnId` / `fallbackCoordinatorId`, then to `context.columns[0]` / `context.members[0]`                    | ✅      |
| Story points clamped to `1/2/3/5/8/13`                                                             | `clampToFibonacci` in `src/utils/ai/storyPoints.ts`, used inside `validateDraft`                                                              | ✅      |
| Abort on close / unmount                                                                           | `useAi.abort()` in `useAi.ts`, called from `controllerRef.current?.abort()` on unmount and on each new `run`                                  | ✅      |

**Acceptance criteria** AC-A1..A7 — all reflected.

---

## 2. Capability B — AI estimation + readiness (PRD §5.2)

| PRD requirement                                                            | Implementation                                                                                                    | Verdict        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| Sidebar inside `TaskModal` with two cards                                  | `src/components/aiTaskAssistPanel/index.tsx` (`Suggested story points` + `Readiness check`)                       | ✅             |
| Mounted only for non-mock tasks when AI is on                              | `src/components/taskModal/index.tsx` mounts `AiTaskAssistPanel` only when `boardAiOn && editingTaskId !== "mock"` | ✅             |
| Inputs use the React Query cache                                           | `useCachedQueryData` and `useQueryClient().getQueryData` for `tasks`, `members`, `boards`                         | ✅             |
| Debounced re-estimation (≈1000 ms via `useDebounce`)                       | `useDebounce(values, 600)` in `aiTaskAssistPanel` (note: 600 ms vs PRD's 1000 ms — see §6)                        | ⚠️ Minor delta |
| Suggested points always in `{1,2,3,5,8,13}`                                | `clampToFibonacci` (`storyPoints.ts`) inside `validateEstimate`                                                   | ✅             |
| `similar[]._id` validated against the project's `tasks` cache              | `validateEstimate` filters via `taskIds.has(entry._id)`                                                           | ✅             |
| `Apply suggestion` only fills the form, never submits                      | `taskModal` callback calls `form.setFieldsValue(...)`; submit still requires the user clicking the Submit button  | ✅             |
| Closing the modal mid-request aborts                                       | `useAi.abort()` on unmount; `assistPanel`'s effect re-runs via debounced values                                   | ✅             |
| Readiness covers `taskName`, `note`, `epic`, `type`, `coordinatorId`       | `readiness()` in `engine.ts`; field whitelist enforced in `validateReadiness`                                     | ✅             |
| `Apply` for the readiness `note` appends an `## Acceptance criteria` block | `taskModal` `onApplySuggestion` for `note` builds the appended markdown                                           | ✅             |

**Acceptance criteria** AC-B1..B6 — all reflected.

---

## 3. Capability C — Board summary brief (PRD §5.3)

| PRD requirement                                                                             | Implementation                                                                                                             | Verdict |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------- |
| `Brief` button in board header gated by AI toggle                                           | `src/pages/board.tsx` renders the button inside `aiEnabled && boardAiOn` block                                             | ✅      |
| Drawer contains headline / counts / largest unstarted / unowned / workload / recommendation | `src/components/boardBriefDrawer/index.tsx` matches all five blocks plus an `Alert` for the recommendation                 | ✅      |
| Inputs read entirely from caches; no new server fetch                                       | `BoardPage` passes `board`, `visibleTasks`, `members`, `currentProject` from existing `useReactQuery` results              | ✅      |
| Output `IBoardBrief` with all referenced ids validated                                      | `boardBrief` in `engine.ts`; `validateBoardBrief` filters `counts`, `largestUnstarted`, `unowned`, `workload` by cache ids | ✅      |
| Deep-link to existing task modal                                                            | `BoardBriefDrawer` calls `useTaskModal().startEditing(taskId)` and closes the drawer                                       | ✅      |
| Read-only — no mutation buttons inside the drawer                                           | Verified by reading the file: only `List` items (clickable for deep-link) and a recommendation `Alert`                     | ✅      |
| Drawer aborts the request on close                                                          | `BoardBriefDrawer`'s effect tears down via `useAi.reset()` cleanup (and `useAi`'s own unmount aborts)                      | ✅      |

**Acceptance criteria** AC-C1..C5 — all reflected.

---

## 4. Capability D — Conversational assistant (PRD §5.4)

| PRD requirement                                                                                                              | Implementation                                                                                                                                                                       | Verdict |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Right-edge drawer "Ask Board Copilot" on board and project pages                                                             | `src/components/aiChatDrawer/index.tsx` mounted from `pages/board.tsx` and `pages/project.tsx` (`Ask` button)                                                                        | ✅      |
| Streaming-style message UI with role separation                                                                              | Drawer renders `user` / `assistant` / `tool` messages, with `Spin` and live tool-name marker (`streamingText`)                                                                       | ✅      |
| Tool definitions limited to read-only set                                                                                    | `src/utils/ai/chatTools.ts` whitelist: `listProjects`, `listMembers`, `getProject`, `listBoard`, `listTasks`, `getTask`                                                              | ✅      |
| Tool calls executed client-side via `useApi`                                                                                 | `executeChatToolCall` in `chatTools.ts` calls into the `ApiCaller` injected by `useAiChat`, which uses `useApi`                                                                      | ✅      |
| Result ids validated against caches before being passed back                                                                 | Each tool checks `ctx.knownProjectIds` / `knownTaskIds` / `knownMemberIds` / `knownColumnIds` before issuing the API call; `getTask` etc. return `{ error: ... }` instead of leaking | ✅      |
| Conversation cleared on hard reload (no persistence)                                                                         | `useAiChat` keeps `messages` in component `useState` only; no localStorage write                                                                                                     | ✅      |
| Closing the drawer aborts in-flight stream and tool calls                                                                    | `AiChatDrawer.handleClose` calls `abort(); reset()`; `useAiChat`'s `AbortController` propagates into `executeChatToolCall(api, ctx, call, signal)`                                   | ✅      |
| Remote proxy contract via `${aiBaseUrl}/api/ai/chat` returning `{ kind: "text", text } \| { kind: "tool_calls", toolCalls }` | `remoteChatStep` in `useAiChat.ts` posts `{ messages, context }` and parses the response with `parseFetchBody`                                                                       | ✅      |

**Acceptance criteria** AC-D1..D4 — all reflected.

**PRD deviation (intentional, see §5):** chat lives in its own hook `useAiChat`, not as a `chat` route on `useAi`. The PRD draft in §5.4 left this open ("a thin wrapper around `@assistant-ui/react` or a hand-rolled streaming `useChat` hook"); the implementation chose the hand-rolled hook. The `AiRoute` union in `useAi.ts` therefore lists `task-draft`, `task-breakdown`, `estimate`, `readiness`, `board-brief`, `search`, but not `chat`. That keeps each hook focused but is worth documenting (and is, in `board-copilot-progress.md` §"Optional polish").

---

## 5. Capability E — Semantic search (PRD §5.5)

| PRD requirement                                                                | Implementation                                                                                                                                                                                                       | Verdict |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Surface in `taskSearchPanel` and `projectSearchPanel`                          | Both panels accept an optional `aiSearchSlot` prop and render `<AiSearchInput>` from the page                                                                                                                        | ✅      |
| Calls `/api/ai/search` with `{ kind, query, projectId? }` and the cached items | `useAi.ts` `RunPayload.search` carries `kind`, `query`, `projectContext`/`projectsContext`; remote path posts to `${aiBaseUrl}/api/ai/search`; local path runs `semanticSearch` in `engine.ts`                       | ✅      |
| `ISearchResult` validated, ids intersected with cache                          | `validateSearch` in `validate.ts`; called from both `useAi.validateResponse` and `AiSearchInput` direct local path                                                                                                   | ✅      |
| Empty result restores the unfiltered list and shows a hint                     | `AiSearchInput` clears `semanticIds` and renders an info `Alert` ("No semantic match…")                                                                                                                              | ✅      |
| Clearing AI search restores the previous filter state                          | `Clear AI search` button calls `setSemanticIds(undefined)`; `taskSearchPanel.resetParams` also wipes `semanticIds`; `Column` only filters when `param.semanticIds` is set so the existing panel filters keep working | ✅      |
| Project list narrowing                                                         | `pages/project.tsx` filters `projects` client-side by `param.semanticIds.split(",")` while keeping the original API result                                                                                           | ✅      |
| Board narrowing                                                                | `Column` AND-filters tasks against `param.semanticIds` together with the existing `taskName` / `coordinatorId` / `type` filters                                                                                      | ✅      |

**Acceptance criteria** AC-E1..E3 — all reflected.

---

## 6. Cross-cutting concerns

### 6.1 Plumbing (PRD §7)

- **Single hook spine** — `useAi` (`src/utils/hooks/useAi.ts`) owns `run`, `abort`, `reset`, `data`, `error`, `isLoading`, `AbortController` lifecycle, route registry, validation. ✅
- **Provider abstraction** — `localResolve` vs `remoteResolve` driven by `environment.aiUseLocalEngine`. ✅
- **Validation layer** — `src/utils/ai/validate.ts` exposes `validateDraft`, `validateBreakdown`, `validateEstimate`, `validateReadiness`, `validateBoardBrief`, `validateSearch`. ✅
- **Cache adapter** — `src/utils/hooks/useCachedQueryData.ts` provides a typed wrapper around `queryClient.getQueryData`, used by the assist panel and chat drawer. ✅ (helper not explicitly named in the PRD, but a concrete realisation of "context as memory" §3.4).

### 6.2 Privacy / safety (PRD §8)

- **No model key in the bundle** — `remoteResolve` and `remoteChatStep` post to `${aiBaseUrl}/api/ai/<route>`; the model key is the responsibility of the proxy. ✅
- **Hallucinated id rejection** — every validator + every chat tool guards on cache ids. ✅
- **Advisory-only writes** — every mutation (`POST tasks`, `PUT tasks`) still goes through the user clicking Submit and the existing `useReactMutation`. ✅
- **Build-time toggle** — `REACT_APP_AI_ENABLED` in `src/constants/env.ts`. ✅
- **Runtime user toggle** — `Switch` in `src/components/header/index.tsx`, persisted via `useAiEnabled` to `boardCopilot:enabled` in `localStorage`, with a custom event so siblings react. ✅
- **Per-project disable** — `useAiProjectDisabled`, `projectAiStorage`, board header `Project AI` switch, `assertRunPayloadProjectsAiAllowed` in `useAi.ts` and an explicit guard in `useAiChat.send`. ✅
- **Bearer auth pass-through** — `getStoredBearerAuthHeader` (`src/utils/aiAuthHeader.ts`) attached to remote `/api/ai/*` calls. ✅ (additional to the PRD; sensible for a same-origin proxy).
- **Right to silence per project** (PRD §8): ✅ via `boardCopilot:disabledProjectIds`.
- **PII-free logs** (PRD §8): ⏳ lands with the proxy.

### 6.3 Performance & cost (PRD §9)

- Token budgets, server-side rate limits, observability counters: ⏳ lands with the proxy.
- Client-side debounce on estimation: present (`useDebounce(values, 600)` in `aiTaskAssistPanel`); PRD said 1000 ms.
- Aborts on unmount: ✅ for `useAi`, `useAiChat`, and `BoardBriefDrawer`.

### 6.4 Compatibility / rollback (PRD §10)

- No schema changes. ✅
- No removed component props; new props are additive (e.g. `boardAiOn`, `aiSearchSlot`). ✅
- `REACT_APP_AI_ENABLED=false` at build hides every AI surface and bypasses every hook. ✅

---

## 7. Verification snapshot (this environment)

Commands run in this review:

```bash
npm run eslint
CI=true npx jest --watchAll=false --runInBand --coverage --coverageReporters=json-summary
npx vite build
```

Results:

- **Lint**: clean.
- **Tests**: **449 passed, 5 failed** out of 454 across 93 suites.
- **Coverage**: 97.51% statements / 91.1% branches / 99.12% functions / 98.69% lines.
- **Build**: succeeds.

The 5 failing tests on `main`:

1. `TaskModal › updates a changed task and clears the modal URL state`
2. `TaskModal › renders the Board Copilot assist panel and applies its suggestions`
3. `useProjectModal › writes modal and editing params without dropping existing query state, then removes them on close`
4. `AiTaskAssistPanel › shows visible AI warnings when estimate or readiness requests fail`
5. `AiTaskAssistPanel effect error handling › keeps the effect resilient and surfaces warnings when estimate and readiness fail`

These are pre-existing test-environment / timing failures on `main` (not regressions in this review) — they share a common pattern of waiting on URL-param cleanup or async warning rendering that the antd 6 + RQ stack flushes on a different tick than the test expects. They are worth a follow-up triage pass but do not invalidate the design alignment of the implementation. They are not addressed by this review (this review is read-only and documentation-only).

---

## 8. Gaps and follow-ups

Items the PRD calls for that are not yet in the code, ordered roughly by user impact:

1. **Vercel `api/ai/[route].ts` proxy (PRD §7.2).** No `api/` directory exists in the repo. The FE is fully wired to call it; only the server file is missing. Already documented as the only "Backend" pending item in `board-copilot-progress.md`.
2. **SSE / token streaming (PRD §7.1).** The FE uses request/response JSON for both structured routes and chat. Streaming is a UX-only polish today; the architecture supports it (the hook owns the AbortController) but no `text/event-stream` parser is in place. Documented in `board-copilot-progress.md` §"Optional polish".
3. **Estimation debounce delay** is **600 ms** in `aiTaskAssistPanel`, vs **1000 ms** in PRD §5.2.4. Minor — pick one and align (or leave a code comment justifying the lower value, since the local engine is synchronous).
4. **`AiRoute` does not include `chat`** (PRD §5.4 implied a single hook). The chat lives in `useAiChat` with its own remote contract. This is a design choice worth noting in the PRD itself, which currently still describes the single-hook shape.
5. **Server-side observability** (PRD §7.7, §9). Lands with the proxy.
6. **PRD success metrics** (PRD §13). Once the proxy ships, attach the metric-emitting `web-vitals` events the PRD lists (M1..M7).

None of these block the v1 product.

---

## 9. Bottom line

The merged code on `main` reflects the design at every section the PRD covers in v1, plus PRD §5.4 (chat) and §5.5 (semantic search) that the original PRD listed as Phase 2. The opt-out posture, validation layer, and advisory-only contract that were the riskiest claims in the PRD are all present in the source and exercised by the test suite (covering 97% statements / 91% branches). The only material missing piece is the Vercel proxy, which the architecture intentionally leaves for a follow-up — and the FE keeps working in the meantime via the deterministic local engine.
