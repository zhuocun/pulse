# PRD: Board Copilot — AI assistance inside `pulse`

| Field                   | Value                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                  | v1 — Phases 0–3 on `main`; Phase 4 (semantic search) implemented on `cursor/board-copilot-semantic-search-1b36`; Vercel proxy not started. **Superseded for AI features by [`v2.1-agent.md`](../prd/v2.1-agent.md)**; this document is retained as the v1 fallback contract. |
| Owner                   | TBD (frontend)                                                                                                                                                                                                                                                                                    |
| Last updated            | 2026-04-29                                                                                                                                                                                                                                                                                        |
| Target repository       | `pulse` (this repo)                                                                                                                                                                                                                                                                               |
| Target release          | Internal preview, then opt-in toggle for end users                                                                                                                                                                                                                                                |
| Document scope          | Product, UX, technical contract, rollout, testing                                                                                                                                                                                                                                                 |
| Implementation progress | See [`changelog.md`](../prd/changelog.md)                                                                                                                                                                                                                                      |

---

## 1. Summary

Board Copilot is an in-product AI assistant for the existing Jira-style kanban app. It adds five tightly scoped capabilities on top of the existing project / column / task model:

1. **Smart task drafting** in the create-task flow.
2. **AI story-point and readiness check** in the task editor.
3. **Board summary / standup brief** on the board page.
4. **Conversational assistant** grounded in the current project's data (Phase 2).
5. **Semantic search** layered onto the existing search panels (Phase 2).

All five share one infrastructure spine: a single React hook (`useAi`) that streams from one Vercel serverless route, with structured-output JSON validated against the existing TypeScript domain types in `src/interfaces/`.

The feature is **advisory-only** in v1: every AI suggestion is rendered into existing Ant Design forms, and every write to the kanban still goes through the user clicking Submit and the existing `useReactMutation` plumbing. There is no autonomous mutation of the board in v1.

---

## 2. Background and motivation

### 2.1 Current product gaps

Reading the codebase confirms three concrete user-experience gaps:

- `src/components/taskCreator/index.tsx` collects only `taskName` and hard-codes `type="Task"`, `epic="New Feature"`, `storyPoints=1`, `note="No note yet"`. Every new task starts the same, so the data is not useful for filtering, planning, or reporting.
- `src/components/taskModal/index.tsx` lets the user edit `taskName`, `coordinatorId`, and `type`, but exposes no editor for `note`, `epic`, or `storyPoints`. Estimation is invisible.
- `src/pages/board.tsx` shows columns and tasks, but offers no overview of the work in flight (counts per column, who is loaded, what is largest, what is unowned).

There is no existing AI integration anywhere in the repo (`rg -i "openai|anthropic|ai" src` returns nothing meaningful).

### 2.2 Industry context (2026)

Every dominant project-management tool now ships some flavor of "AI in the work surface":

- **Atlassian Rovo / Agents in Jira** — natural-language work creation, one-click work breakdown, summaries, related work, Workflow Builder Agent, Work Readiness Checker, agents addressable as assignees and via @mention.
- **Linear AI** — AI Issue Triage, AI Summarization of long threads, smart project/priority suggestions.
- **Asana AI Studio + AI Teammates** — natural-language automation builder, Smart Summaries, multilingual semantic Smart Search.
- **ClickUp Brain / Brain MAX / Autopilot Agents** — AI Project Manager, drift/bottleneck detection, AI Kanban Board Generator, AI Knowledge Manager.
- **Specialized estimation tools** (estimio, scagile, Atlassian Marketplace's Intelligent Story Point Estimation) — story-point prediction with confidence + similar-issue grounding; advisory only.
- **Lightweight kanban AI** (sigmaqu, workstreams.ai) — one-click standup-style summary, generative card descriptions, AI subtask generation from a card title.

The convergent set of capabilities — task drafting, breakdown, estimation, summarization, conversational Q&A grounded in project data — is exactly what Board Copilot proposes for this repo.

### 2.3 Strategic fit for this repo

- The data model is small and fully typed (`ITask`, `IColumn`, `IProject`, `IMember`), so structured outputs from an LLM map 1:1 to existing forms.
- The fetch boundary is already centralized (`src/utils/hooks/useApi.ts`, `useReactQuery.ts`, `useReactMutation.ts`), so a new AI hook fits the same pattern with no architectural change.
- Vercel deployment is already configured (`vercel.json`), so a serverless `api/ai/*` route is the natural place to keep the model key off the client.
- The repo includes a test-development skill at `.agents/skills/jira-react-test-development/SKILL.md` requiring 100% coverage, mocked at `global.fetch`. Routing all AI calls through one seam keeps that test discipline intact.

---

## 3. Goals and non-goals

### 3.1 Goals (v1)

- G1 — Reduce time-to-create a well-formed task to under ten seconds for a typical task, from a single natural-language prompt.
- G2 — Surface a story-point estimate with confidence inside the task editor, grounded in the project's existing tasks.
- G3 — Provide a one-click board summary that reads only existing client-side caches.
- G4 — Keep the model API key off the client at all times.
- G5 — Keep AI features fully optional via a settings toggle, with the rest of the app unchanged when the toggle is off.
- G6 — Maintain the repo's existing 100%-coverage discipline on all new runtime code.

### 3.2 Goals (Phase 2, behind the same toggle)

- G7 — A conversational assistant grounded in the current project's data via tool calls.
- G8 — Semantic / natural-language search on top of the existing `taskSearchPanel` and `projectSearchPanel`.

### 3.3 Non-goals

- N1 — Autonomous mutation of the board (no auto-create, auto-move, auto-assign in v1).
- N2 — A new automation engine ("if X then Y" rules). The app has none today, and AI on top of a missing engine is not in scope.
- N3 — Code-generating dev agents in the style of Rovo Dev. Out of scope for a frontend with a mocked backend.
- N4 — Voice / speech-to-text composer. Nice-to-have, not required.
- N5 — Multi-tenant model-key management. The proxy uses a single server-held key.
- N6 — Persistence of AI conversations or suggestions on the backend (the mock backend has no schema for this; v1 keeps everything client-side).
- N7 — Replacing the existing search panels. AI search is additive.

---

## 4. Personas and primary scenarios

### 4.1 Personas

- **Maya, IC engineer.** Lives in the board. Wants to drop in tasks fast without a 5-field form. Wants to know whether a story is "small or big" before committing.
- **Devon, tech lead.** Triages the board daily. Wants a one-glance summary of who is loaded, what is unowned, and what large stories are still in Backlog.
- **Priya, product manager.** Less technical. Asks questions about the board in plain English ("which tasks are blocked?", "what's the biggest item in Sprint scope?").
- **Ari, IT/admin.** Cares that the model key cannot leak from the browser, that AI can be turned off org-wide, and that no data leaves the proxy without consent.

### 4.2 Primary scenarios

- S1 — Maya types "Investigate flaky login on Safari, blocks v2, ~half a day" into the create box. Board Copilot returns a fully-populated antd form with name, type=`Bug`, epic, story points, note, suggested column and coordinator. Maya tweaks one field and submits.
- S2 — Maya opens an existing task. The task modal sidebar shows "Suggested 5 points (72% confidence)" with two similar past tasks linked, plus a readiness alert: "Acceptance criteria missing. Suggested: …".
- S3 — Devon opens the board, clicks "Brief", and reads a structured summary in a Drawer: per-column counts, three largest unstarted tasks, two unowned tasks, one-line recommendation.
- S4 (Phase 2) — Priya opens the chat sidebar and asks "who has the most open bugs in this project?" — the assistant calls the tasks/members tool and answers with names and counts.
- S5 (Phase 2) — Priya types "auth bugs caused by token expiry" into the search panel; the AI search returns a ranked list of `_id`s and the existing filter narrows the board.

---

## 5. Detailed feature specification

### 5.1 Capability A — Smart task drafting

#### 5.1.1 Surface

`src/components/taskCreator/index.tsx`. The existing `+ Create task` link expands into the existing `Input`. A second control is added: a sparkle/AI button next to the input that opens a small Ant Design `Popover` (or, if the prompt is long, an Ant Design `Modal`) titled "Draft with Board Copilot".

#### 5.1.2 Input

Free-text natural-language description. Up to 1,000 characters. Empty input disables the AI button.

#### 5.1.3 Output (structured)

A JSON object that conforms to `IDraftTaskSuggestion`:

```ts
interface IDraftTaskSuggestion {
    taskName: string; // required, <= 120 chars
    type: "Task" | "Bug"; // restricted to existing task types in the project, fallback to Task/Bug
    epic: string; // <= 60 chars; reused from existing epics if a match is strong
    storyPoints: 1 | 2 | 3 | 5 | 8 | 13;
    note: string; // markdown; should include "Acceptance criteria" section
    columnId: string; // must be a real columnId from the current board
    coordinatorId: string; // must be a real member _id; falls back to current user
    confidence: number; // 0..1
    rationale: string; // <= 280 chars, shown under the form
}
```

#### 5.1.4 Behavior

1. The hook posts `{ projectId, prompt, context }` to `/api/ai/task-draft`.
2. `context` is computed client-side from existing React Query caches:
    - All `IColumn[]` for the current project (id, name, index).
    - All `IMember[]` (id, username).
    - A truncated list of recent `ITask[]` summaries for the project (id, name, type, epic, storyPoints) to ground epic and point suggestions.
3. The proxy calls the model in JSON-schema mode using the `IDraftTaskSuggestion` schema.
4. The response is **validated client-side**: any `columnId`/`coordinatorId` not present in the cache is replaced with the safe default (current column for create-from-column, current user for coordinator). Invalid `storyPoints` snap to the nearest allowed Fibonacci value.
5. The validated suggestion populates the existing `Form.setFieldsValue` in a small drafting modal that wraps the same fields as the edit modal.
6. The user clicks Submit, which calls the existing `useReactMutation("tasks", "POST", ["tasks", { projectId }], newTaskCallback)`.

#### 5.1.5 "Break down" sub-action

In the same popover, a "Break down" button asks the model to return `IDraftTaskSuggestion[]` (length 2..6). The user sees a checklist of suggested subtasks; checking and submitting posts each via the same mutation. Each post still goes through `newTaskCallback` so the optimistic update keeps working.

#### 5.1.6 Acceptance criteria

- AC-A1 — With AI off (settings toggle), the existing TaskCreator works exactly as today; no AI controls are rendered.
- AC-A2 — With AI on and a non-empty prompt, the AI button opens the drafting modal and within ≤2s shows a streaming partial form.
- AC-A3 — The submitted task is indistinguishable from a manually-created task in the React Query cache (same shape, same optimistic flow).
- AC-A4 — Any model-returned `columnId` not in the project's `IColumn[]` is rejected and replaced with the column the user opened the creator from.
- AC-A5 — Any model-returned `coordinatorId` not in `IMember[]` is rejected and replaced with `useAuth().user?._id`.
- AC-A6 — Pressing Escape or unmounting the modal aborts the in-flight request via `AbortController`.
- AC-A7 — The breakdown action posts each subtask via `useReactMutation` with the existing optimistic callback; partial failures leave the rest visible.

### 5.2 Capability B — AI story-point estimation and readiness check

#### 5.2.1 Surface

`src/components/taskModal/index.tsx`. Add a right-aligned sidebar inside the modal (or a collapsible section above the buttons) labeled "Board Copilot". Two cards inside:

- "Suggested story points": large number (1/2/3/5/8/13), confidence bar, expandable "Why" section listing up to three similar tasks (from cache) with their final points.
- "Readiness": Ant Design `Alert` listing missing fields, ambiguous scope, and one-click "Apply suggestion" actions.

The same panel is mounted in the drafting modal from Capability A.

#### 5.2.2 Inputs

- Current form values for the task being edited (`taskName`, `type`, `note`, `epic`, current `storyPoints` if any, `coordinatorId`).
- Up to N=50 most recently created tasks in the same project, summarized as `{ _id, taskName, type, epic, storyPoints }`. Selection is by similarity heuristic on the client (substring/keyword overlap) before sending, to keep the prompt small.

#### 5.2.3 Outputs (structured)

```ts
interface IEstimateSuggestion {
    storyPoints: 1 | 2 | 3 | 5 | 8 | 13;
    confidence: number; // 0..1
    rationale: string; // <= 280 chars
    similar: Array<{ _id: string; reason: string }>; // up to 3, ids must exist in cache
}

interface IReadinessIssue {
    field: "taskName" | "note" | "epic" | "type" | "coordinatorId";
    severity: "info" | "warn" | "error";
    message: string; // <= 160 chars
    suggestion?: string; // optional value to one-click apply
}

interface IReadinessReport {
    issues: IReadinessIssue[];
}
```

#### 5.2.4 Behavior

- Estimation request is debounced via the existing `useDebounce` hook (1000ms) on form changes. While the user types, the panel shows a `Spin` and the previous suggestion fades.
- "Apply suggestion" fills the antd Form via `form.setFieldsValue`. It does not submit.
- "Why" expands a list of similar past tasks; clicking one calls `useTaskModal().startEditing(_id)` to jump to that task.

#### 5.2.5 Acceptance criteria

- AC-B1 — With AI off, the modal is identical to today; the sidebar is not rendered.
- AC-B2 — With AI on, opening a task triggers exactly one estimation request; further estimation requests are debounced.
- AC-B3 — Suggested `storyPoints` is always in `{1,2,3,5,8,13}`. Out-of-range responses are clamped.
- AC-B4 — Each `similar[]._id` returned by the model must be present in the project's `tasks` cache. Unknown ids are dropped.
- AC-B5 — `Apply suggestion` does not submit the form. The user must still click Submit to mutate.
- AC-B6 — Closing the modal mid-request aborts the request.

### 5.3 Capability C — Board summary / standup brief

#### 5.3.1 Surface

`src/pages/board.tsx`. A new "Brief" button next to the page title opens an Ant Design `Drawer` from the right at 480px width.

#### 5.3.2 Inputs

Read-only from existing React Query caches for the current `projectId`:

- `IProject` (current project)
- `IColumn[]` (board)
- `ITask[]` (tasks)
- `IMember[]` (members)

The hook composes a compact JSON snapshot client-side, then posts it to `/api/ai/board-brief`. No new server data fetch.

#### 5.3.3 Output (structured)

```ts
interface IBoardBrief {
    headline: string; // one sentence, <= 140 chars
    counts: Array<{ columnId: string; columnName: string; count: number }>;
    largestUnstarted: Array<{
        taskId: string;
        taskName: string;
        storyPoints: number;
    }>; // up to 3
    unowned: Array<{ taskId: string; taskName: string }>; // up to 5
    workload: Array<{
        memberId: string;
        username: string;
        openTasks: number;
        openPoints: number;
    }>;
    recommendation: string; // <= 280 chars, one actionable next step
}
```

#### 5.3.4 Rendering

- Headline at the top, in `<h3>`.
- Counts as a small Ant Design `Table`.
- Largest unstarted, unowned, workload as three `List` blocks.
- Recommendation as a highlighted `Alert` with type `info`.
- Each `taskId` reference is clickable and calls `useTaskModal().startEditing(taskId)`.

#### 5.3.5 Acceptance criteria

- AC-C1 — With AI off, no Brief button is rendered.
- AC-C2 — Clicking Brief opens the Drawer immediately and streams content within ≤2s for a project with ≤200 tasks.
- AC-C3 — All `taskId` and `memberId` references in the brief exist in the cache; otherwise they are filtered out before render.
- AC-C4 — Brief is read-only. There are no buttons that mutate the board from inside the drawer in v1, except the deep-link to open a task in the existing modal.
- AC-C5 — The drawer's request is aborted when the drawer closes.

### 5.4 Capability D — Conversational assistant (Phase 2)

#### 5.4.1 Surface

A persistent right-edge `Drawer` toggle on the board and project pages, labeled "Ask Board Copilot". When open, shows a streaming chat thread.

#### 5.4.2 Tool calls

The assistant is given a small set of tools that wrap the existing endpoints from `useApi`:

- `listProjects(filter?)`
- `listMembers()`
- `getProject(projectId)`
- `listBoard(projectId)`
- `listTasks(projectId, filter?)` — supports `taskName`, `coordinatorId`, `type`, `columnId`
- `getTask(taskId)`

All tool calls are **read-only in Phase 2**. Write tools are out of scope until v3.

#### 5.4.3 Behavior

- Each tool call is executed client-side (using `useApi`) and the result is sent back to the model as the next turn.
- Tool results are validated before being passed back: ids that came from the model are checked against caches before being used as filter parameters.
- The thread is local to the browser session in Phase 2; no backend persistence.

#### 5.4.4 Acceptance criteria

- AC-D1 — The model cannot invoke any tool other than the registered read-only tools.
- AC-D2 — A user message cannot inject tool definitions; tool definitions are only set on the server side of `/api/ai/chat`.
- AC-D3 — Closing the drawer aborts the in-flight stream and any in-flight tool calls.
- AC-D4 — Conversation state is reset on hard reload.

### 5.5 Capability E — Semantic search (Phase 2)

#### 5.5.1 Surface

`src/components/taskSearchPanel` and `src/components/projectSearchPanel` gain an "Ask in natural language" input next to the existing filters. Submitting calls `/api/ai/search` with `{ kind: "tasks" | "projects", query, projectId? }` and the cached items.

#### 5.5.2 Output

```ts
interface ISearchResult {
    ids: string[];
    rationale: string;
}
```

The existing filter state is updated with the returned ids. The existing substring filters still apply on top.

#### 5.5.3 Acceptance criteria

- AC-E1 — Returned `ids` are intersected with the cache; unknown ids are dropped.
- AC-E2 — Empty result returns the unfiltered list and shows a small "No semantic match" hint.
- AC-E3 — Clearing the AI search restores the previous filter state exactly.

---

## 6. UX details

### 6.1 Visual language

- Use the existing Ant Design 6 component set. No new component library.
- Consistent "AI" affordance: an `<AntdIcon component={Sparkles} />` (Heroicons-style sparkles SVG, added under `src/assets/sparkles.svg`) and the label "Board Copilot" wherever AI initiates an action.
- Streaming text uses `React.startTransition` to avoid jank and fades partial output at 70% opacity until the stream completes.
- Loading states reuse `<Spin />`; error states reuse `<ErrorBox />` from `src/components/errorBox`.

### 6.2 Empty / disabled / failure states

- AI off: no AI affordances rendered anywhere. The whole feature is invisible.
- AI on but proxy unreachable: a single inline `<Alert type="warning" />` under the AI control with a Retry button. The non-AI flow always remains usable.
- AI on but rate-limited (HTTP 429): show "Board Copilot is busy. Try again in a moment." Do not block the form.
- AI on but model returned invalid JSON: show "Couldn't draft a task this time. You can keep typing manually." Do not throw.

### 6.3 Accessibility

- All AI controls are keyboard-reachable (Tab, Enter, Escape).
- Streaming messages live-update an `aria-live="polite"` region.
- All Drawer triggers have `aria-label`.

---

## 7. Technical design

### 7.1 New module: `src/utils/hooks/useAi.ts`

A single hook that all five capabilities call.

```ts
type AiRoute =
    | "task-draft"
    | "task-breakdown"
    | "estimate"
    | "readiness"
    | "board-brief"
    | "chat"
    | "search";

interface UseAiOptions<T> {
    route: AiRoute;
    schema?: unknown; // JSON schema, narrowed per route
    onPartial?: (partial: Partial<T>) => void;
}

interface UseAiResult<T> {
    run: (body: unknown) => Promise<T>;
    abort: () => void;
    isLoading: boolean;
    error: Error | null;
    data: T | undefined;
}
```

Implementation rules:

- Calls only `${env.aiBaseUrl}/api/ai/${route}` (same origin in production; configurable in dev).
- Uses `fetch` with `signal: controller.signal` and `Accept: text/event-stream`.
- Parses SSE chunks; emits partial JSON via `onPartial`.
- Validates final JSON against the route's schema before resolving.
- `run` is stable across renders (`useCallback`) and aborts any prior in-flight request when called again.

### 7.2 New serverless route: `api/ai/[route].ts` (Vercel function)

- Single file routes by `req.query.route`.
- Reads `OPENAI_API_KEY` (or generic `AI_PROVIDER_KEY`) from environment. Never echoed to the client.
- Wraps the user input in a server-defined system prompt per route (mitigates prompt injection).
- Per route, defines:
    - JSON schema for structured output.
    - Tool definitions (only for `chat`; only the read-only tools listed in 5.4.2).
- Streams SSE chunks back as they arrive.
- Enforces a per-IP, per-route token budget and a hard timeout (default 30s).
- Logs only request metadata (route, latency, token counts, status), never raw prompts in production logs.

### 7.3 Configuration

- New constants in `src/constants/env.ts` (or extension of the existing one):
    - `aiEnabled: boolean` from `import.meta.env.VITE_AI_ENABLED ?? false`.
    - `aiBaseUrl: string` from `import.meta.env.VITE_AI_BASE_URL ?? ""` (empty = same origin).
- New runtime toggle in a settings menu (Phase 1.5): a single switch persisted to `localStorage` under `boardCopilot:enabled`. The hook short-circuits if either source is `false`.

### 7.4 Data flow per capability

```
TaskCreator ──prompt──▶ useAi("task-draft") ──SSE──▶ /api/ai/task-draft ──▶ LLM
       ◀────IDraftTaskSuggestion──── validated ◀────────────────────────────
TaskCreator ──Submit──▶ useReactMutation("tasks", "POST")  (existing path)
```

```
TaskModal ──fields+similar──▶ useAi("estimate") ──SSE──▶ /api/ai/estimate ──▶ LLM
       ◀────IEstimateSuggestion────
       (Apply Suggestion ──▶ form.setFieldsValue, no mutation)
       (Submit ──▶ existing useReactMutation("tasks", "PUT"))
```

```
BoardPage  ──snapshot──▶ useAi("board-brief") ──SSE──▶ /api/ai/board-brief ──▶ LLM
       ◀────IBoardBrief────
```

### 7.5 Validation layer (`src/utils/ai/validate.ts`)

- Per-route validators that cross-check ids against caches passed in.
- Fibonacci-clamp helper for `storyPoints`.
- `IDraftTaskSuggestion` -> `Partial<ITask>` adapter for safe `setFieldsValue`.
- `IBoardBrief` cleaner that drops references to ids no longer in the cache.

### 7.6 Abort and lifecycle

- All hooks register `AbortController` in a `useEffect` cleanup.
- `useAi` exposes `abort()` so modals/drawers can cancel on close.
- Streams are explicitly drained in `finally` blocks to avoid leaking response bodies.

### 7.7 Observability (Phase 1)

- Each AI request logs (server-side only) `{ route, latency_ms, tokens_in, tokens_out, status, project_id_hash }`.
- A single counter `board_copilot_requests_total{route,status}` if the deployment platform exposes metrics.
- Client emits `web-vitals`-style events for AI-initiated actions (already a dependency).

---

## 8. Privacy, safety, and policy

- **Key safety.** Model API key lives only in the Vercel function environment. The client never sees it. Documented in `README.md` AI section.
- **No third-party data leak.** Only the explicit fields per route are sent to the proxy. Whole-DB dumps are forbidden by route schemas.
- **Prompt injection mitigation.** Route handlers wrap user-supplied text in a server-defined system prompt. Tool calls cannot be defined or modified by user input.
- **Hallucinated id rejection.** All ids returned by the model are validated against the React Query cache before any UI action.
- **Advisory only.** No AI suggestion mutates kanban state without an explicit user submit (v1).
- **Opt-in.** AI features are gated by both a build-time flag and a runtime user toggle. The product is fully usable with AI off.
- **Right to silence.** A "Disable AI for this project" setting (Phase 1.5) prevents any AI request from being sent for tasks/projects under that project id.
- **No PII in logs.** Server logs include `project_id_hash` only; user content is not logged in production.
- **Provider neutrality.** The proxy abstracts the model provider behind a single `chat()` call; swapping providers does not require client changes.

---

## 9. Performance and cost

- Time-to-first-token target: ≤1.2s p50, ≤2.5s p95 under 50 RPS.
- Capability C end-to-end target: ≤2s p50, ≤4s p95 for projects with ≤200 tasks.
- Per-request token budget per route:
    - `task-draft`, `estimate`, `readiness`, `search`: ≤2k input, ≤512 output.
    - `board-brief`: ≤6k input, ≤1k output.
    - `chat`: ≤8k input over the whole turn, ≤1k output per turn.
- Server-side rate limit: 30 requests / minute / IP per route, 200 / hour / IP overall. Returns HTTP 429 with `Retry-After`.
- Client-side debounce on estimation (1000ms via existing `useDebounce`).
- Aborts on unmount free both client buffers and server-side streaming costs.

---

## 10. Compatibility, migrations, and rollback

- No schema changes to `db.json` or the Python backend.
- No changes to existing public component props. New props are additive and optional.
- New env vars: `VITE_AI_ENABLED`, `VITE_AI_BASE_URL`, server-side `OPENAI_API_KEY` (or generic `AI_PROVIDER_KEY`).
- Rollback: setting `VITE_AI_ENABLED=false` at build time hides every AI surface and bypasses the hook entirely. The proxy can be left deployed with no client traffic.

---

## 11. Testing strategy

Anchored in `.agents/skills/jira-react-test-development/SKILL.md` and the existing test layout.

### 11.1 Unit tests

- `src/utils/ai/validate.test.ts` — id cross-check, Fibonacci clamp, schema rejection.
- `src/utils/hooks/useAi.test.ts` — fetch mocked at `global.fetch`; covers happy path, partial streaming, abort, JSON-parse failure, HTTP 4xx/5xx.

### 11.2 Component tests

- `src/components/taskCreator/index.test.tsx` — extends to cover AI on/off, prompt → drafting modal, abort on close, invalid id replacement, breakdown action posting N tasks.
- `src/components/taskModal/index.test.tsx` — extends to cover sidebar render, debounce behavior, "Apply suggestion" mutates the form (not the server), abort on close.

### 11.3 Page / integration tests

- `src/pages/board.test.tsx` — extends to cover Brief button render gate, drawer open/close, deep-link to task modal from a brief reference.
- A new `src/pages/board.copilot.test.tsx` if the existing file gets too large.

### 11.4 Server route tests

- `api/ai/__tests__/task-draft.test.ts` — schema enforcement, prompt-injection wrapper present, model client mocked.
- Same for `estimate`, `readiness`, `board-brief`. `chat` and `search` covered when Phase 2 ships.

### 11.5 Coverage gate

- Maintain 100% statements/branches/functions/lines across runtime files, per existing repo policy.
- Exclude only declaration files and static assets, per existing convention.

### 11.6 Manual QA checklist

- AI toggle off: app behaves identically to today (full regression of existing flows).
- AI toggle on, network blocked to `/api/ai/*`: every AI surface degrades to a single inline warning; non-AI flows still work.
- Long prompt (>1k chars): clipped with a visible counter, not silently truncated.
- Slow network (4G throttled): streams render progressively; abort on close cancels within 200ms.
- Screen reader walks each AI surface and reads suggestions.

---

## 12. Rollout plan

Phasing is by capability, not by calendar.

- **Phase 0 — Plumbing.** Add `useAi`, validators, the single `api/ai/[route].ts` Vercel function, env vars, the runtime toggle, and the off-state regression tests. No user-visible features yet.
- **Phase 1 — Capability C (Board summary).** Ships the smallest read-only feature end-to-end through the new spine. Validates the proxy, streaming, structured outputs, and abort lifecycle in production.
- **Phase 2 — Capabilities A and B.** Smart drafting and estimation. These are the highest user-impact features and they reuse Phase 0/1 infra exactly.
- **Phase 3 — Capability D (Chat).** Adds tool calls; still read-only.
- **Phase 4 — Capability E (Semantic search).** Smallest standalone polish item.

Each phase ships behind the same toggle and is independently revertible.

---

## 13. Success metrics

Tracked via the same web-vitals-style events emitted by the client and the server-side metrics from §7.7.

- M1 — Adoption: % of new tasks created via Smart drafting (target ≥40% within 4 weeks of GA among AI-on users).
- M2 — Quality: % of drafted tasks submitted without modifying any AI-suggested field other than `taskName` (target ≥30%).
- M3 — Estimation acceptance: % of "Apply suggestion" clicks in the estimation panel (target ≥25% of opens).
- M4 — Brief usage: median Briefs / active board / week (target ≥2).
- M5 — Reliability: AI proxy 5xx rate ≤ 0.5%, p95 time-to-first-token ≤ 2.5s.
- M6 — Safety: 0 incidents of API key exposure, 0 incidents of model-supplied id reaching a mutation without validation.
- M7 — Coverage: 100% on the runtime AI scope, in line with the repo's existing standard.

---

## 14. Open questions

- OQ1 — Provider selection: OpenAI by default vs. provider-agnostic abstraction from day one? Lean: provider-agnostic interface, OpenAI as the first impl.
- OQ2 — Persistence of chat history (Phase 3): keep client-only as proposed, or add a tiny persisted thread store under `localStorage`? Lean: localStorage keyed by `projectId`, capped at last 20 turns.
- OQ3 — Should "Apply suggestion" auto-submit when the form was empty? Lean: no; v1 keeps the human in the loop universally.
- OQ4 — Where should the runtime toggle live? Header user menu vs. a dedicated `/settings` route? Lean: header user menu (no new route required).
- OQ5 — Should the breakdown action run inside an `<Form.List>` or as N independent submissions? Lean: N independent submissions, since each must run the existing optimistic callback.
- OQ6 — Phase 2 chat: keep tools strictly read-only or add a narrow `updateTaskField` tool with explicit per-field user confirmation? Lean: read-only in v2; revisit after metrics on M4.

---

## 15. Appendix

### 15.1 Code-area touch list

- New
    - `api/ai/[route].ts` (Vercel function)
    - `src/utils/hooks/useAi.ts`
    - `src/utils/ai/validate.ts`
    - `src/utils/ai/schemas.ts` (JSON schemas mirrored from TS interfaces)
    - `src/components/aiPanel/` (shared sidebar used by Capabilities A and B)
    - `src/components/boardBriefDrawer/` (Capability C)
    - `src/components/aiChatDrawer/` (Capability D, Phase 3)
    - `src/components/aiSearchInput/` (Capability E, Phase 4)
    - `src/assets/sparkles.svg`
- Modified
    - `src/components/taskCreator/index.tsx` (Capability A)
    - `src/components/taskModal/index.tsx` (Capability B)
    - `src/pages/board.tsx` (Capability C trigger)
    - `src/components/taskSearchPanel/index.tsx`, `src/components/projectSearchPanel/index.tsx` (Capability E)
    - `src/constants/env.ts` (new flags)
    - `package.json` (add provider SDK + zod or a lightweight schema validator)
    - `README.md` (AI section, including key safety)
    - `vercel.json` (routes for `/api/ai/*` if needed)

### 15.2 Out-of-scope but worth tracking for v3

- Agent-as-assignee paradigm (Rovo-style): an `IMember` whose `_id` is an agent, with its own queue. Requires a real backend.
- Workflow Builder Agent (build natural-language automations): requires an automation engine first.
- MCP-compatible server in front of the `pulse` backend to expose the Capability D tools to external assistants.
- AI-generated cycle / sprint planning across projects.
- Per-team fine-tuning on historical estimations.
