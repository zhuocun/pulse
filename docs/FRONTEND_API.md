# API & Integration Reference — pulse (frontend)

## Overview

This document covers three integration layers of the `pulse` React front-end:

**A. HTTP contract** — every REST and AI route the FE calls on the `pulse` backend.
Backend engineers use this table to verify the shape they must return.
Server-side route documentation lives in `backend/docs/BACKEND_API.md`.

**B. Public hook and utility surface** — every hook in `src/utils/hooks/` and every
utility in `src/utils/ai/` that component authors call directly.

**C. Configuration** — environment variables, auth header plumbing, mock server, and
the local-engine fallback that activates when `REACT_APP_AI_BASE_URL` is unset.

---

## Operations

### npm scripts

| Script         | Command                                                | Purpose                          |
| -------------- | ------------------------------------------------------ | -------------------------------- |
| `start`        | `vite --host 0.0.0.0 --port 3000`                      | Local dev server on port 3000    |
| `build`        | `vite build`                                           | Production bundle                |
| `test`         | `jest`                                                 | Unit + integration tests (jsdom) |
| `typecheck`    | `tsc --noEmit`                                         | TypeScript type check, no emit   |
| `server`       | `json-server __json_server_mock__/db.json --port 8080` | Mock REST server on port 8080    |
| `prettier`     | `prettier --check .`                                   | Format check                     |
| `prettier:fix` | `prettier --write .`                                   | Format fix                       |
| `eslint`       | `eslint src … --fix`                                   | Lint + auto-fix                  |
| `pre-commit`   | `prettier && eslint && typecheck`                      | Pre-commit gate (run by Husky)   |

Node version requirement: `>=22 <25`.

---

## Configuration

### Environment variables

_Source: `src/constants/env.ts:1`_

| Variable                     | Default                                   | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_API_URL`          | `https://pulse-python-server.vercel.app`  | Origin of the REST API. The FE appends `/api/v1/` to form `apiBaseUrl`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `REACT_APP_AI_BASE_URL`      | `""` (empty string)                       | Origin of the AI service (highest priority). When set and non-empty, all AI requests go here; validated at module load (`javascript:`, `file:`, `data:`, and malformed URLs are rejected and fall back to the local engine; trailing slashes trimmed; `http:` only accepted in DEV builds). When unset, the 3-way fallback applies: if `REACT_APP_AI_USE_LOCAL=true` or `NODE_ENV==="test"` → local engine; otherwise → `apiOrigin` (so deployed builds reach the backend without setting this var). |
| `REACT_APP_AI_USE_LOCAL`     | —                                         | Set to `"true"` to force the local deterministic engine when `REACT_APP_AI_BASE_URL` is unset. `.env.development` sets this automatically so `npm start` always uses the local engine. Jest short-circuits to local regardless of this flag (`NODE_ENV==="test"` guard).                                                                                                                                                                                                                             |
| `REACT_APP_AI_ENABLED`       | `"true"` (any value other than `"false"`) | Global AI feature gate. Set `"false"` to disable all AI UI and hooks.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `VITE_ANALYTICS_ENDPOINT`    | `""` (unset)                              | Full URL for batched analytics event POSTs. When set, `httpAnalyticsSink` is wired in `src/index.tsx`. Events include `engineMode: "local" \| "remote"`. **Required for production observability**: without this, every analytics event is silently dropped; the only active sink is `devMemorySink` (writes to `window.__copilotEvents__`, lost on reload).                                                                                                                                         |
| `VITE_ERROR_REPORT_ENDPOINT` | `""` (unset)                              | Full URL for error event POSTs. When set, `httpErrorSink` is wired in `src/index.tsx` and `ErrorBoundary.componentDidCatch` reports to it. **Required for production error visibility**: without this, AI surface exceptions are never reported outside the browser console.                                                                                                                                                                                                                         |

The `environment` singleton exported from `src/constants/env.ts` has the shape:

```ts
interface Environment {
    apiBaseUrl: string; // e.g. "https://pulse-python-server.vercel.app/api/v1"
    aiBaseUrl: string; // e.g. "https://my-ai.example.com" or ""
    aiEnabled: boolean; // false only when REACT_APP_AI_ENABLED === "false"
    aiUseLocalEngine: boolean; // true when resolved aiBaseUrl === "" (local flag, test env, or invalid URL)
}
```

### Auth token storage

_Source: `src/utils/tokenStorage.ts:1`_

The JWT returned by `POST /api/v1/auth/login` is stored in `localStorage` under the
key `"Token"`. All REST calls attach it as `Authorization: Bearer <token>`. AI proxy
calls use the same token via `getStoredBearerAuthHeader()` (`src/utils/aiAuthHeader.ts`).

### localStorage keys

| Key                                      | Owner                 | Content                                                      |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `"Token"`                                | `tokenStorage.ts`     | Raw JWT string                                               |
| `"boardCopilot:enabled"`                 | `useAiEnabled.ts`     | `"true"` / `"false"` — per-browser AI toggle                 |
| `"boardCopilot:autonomy"`                | `useAiEnabled.ts`     | `"suggest"` / `"plan"` / `"auto"`                            |
| `"boardCopilot:disabledProjectIds"`      | `projectAiStorage.ts` | JSON array of project ids opted-out of AI                    |
| `"boardCopilot:remoteConsent:<baseUrl>"` | `remoteAiConsent.ts`  | `"1"` when user dismissed remote-AI banner for that base URL |

---

## HTTP Routes Consumed

All REST routes are relative to `apiBaseUrl` (`${REACT_APP_API_URL}/api/v1`).
All AI v1 routes are relative to `aiBaseUrl` (only called when `aiUseLocalEngine` is `false`).
All Agents v2.1 routes are relative to `aiBaseUrl`.

See the server-side docs for request/response schemas: `../backend/docs/BACKEND_API.md`.

### REST Core (`/api/v1/`)

| Method   | Path                    | Called by                                                                         | Request body / query                                             | Response type                  |
| -------- | ----------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `POST`   | `/api/v1/auth/login`    | `authApis.login`, `loginForm`                                                     | `{ email, password }`                                            | `IUser` (includes `jwt`)       |
| `POST`   | `/api/v1/auth/register` | `authApis.register`, `registerForm`                                               | `{ username, email, password }`                                  | `string` (`"User created"`)    |
| `GET`    | `/api/v1/users`         | `authProvider`, `useAuth.refreshUser`                                             | —                                                                | `IUser`                        |
| `PUT`    | `/api/v1/users/likes`   | `projectList`                                                                     | `{ projectId }`                                                  | `IUser`                        |
| `GET`    | `/api/v1/users/members` | `projectModal`, `memberPopover`, `chatTools.listMembers`, `chatTools.getProject`  | —                                                                | `IMember[]`                    |
| `GET`    | `/api/v1/projects`      | `project.tsx`, `projectPopover`, `chatTools.listProjects`, `chatTools.getProject` | `?projectId=…` (optional)                                        | `IProject[]` or `IProject`     |
| `POST`   | `/api/v1/projects`      | `projectModal`                                                                    | `{ projectName, organization }` (1)                              | `string` (`"Project created"`) |
| `PUT`    | `/api/v1/projects`      | `projectModal`                                                                    | `{ _id, projectName, organization, managerId? }`                 | `string` (`"Project updated"`) |
| `DELETE` | `/api/v1/projects`      | `projectList`                                                                     | `?projectId=…`                                                   | `string` (acknowledgement)     |
| `GET`    | `/api/v1/boards`        | `board.tsx`, `useDragEnd`, `chatTools.listBoard`                                  | `?projectId=…`                                                   | `IColumn[]`                    |
| `POST`   | `/api/v1/boards`        | `columnCreator`                                                                   | `{ projectId, columnName }`                                      | `string` (`"Column created"`)  |
| `DELETE` | `/api/v1/boards`        | `column/index.tsx`                                                                | `?columnId=…`                                                    | `string` (acknowledgement)     |
| `PUT`    | `/api/v1/boards/orders` | `useDragEnd`                                                                      | `{ fromId, referenceId, type }`                                  | `string` (acknowledgement)     |
| `GET`    | `/api/v1/tasks`         | `board.tsx`, `useDragEnd`, `chatTools.listTasks`, `chatTools.getTask`             | `?projectId=…` and optional filters                              | `ITask[]`                      |
| `POST`   | `/api/v1/tasks`         | `taskCreator`, `aiTaskDraftModal`                                                 | task fields                                                      | `string` (`"Task created"`)    |
| `PUT`    | `/api/v1/tasks`         | `taskModal`                                                                       | task fields with `_id`                                           | `string` (`"Task updated"`)    |
| `DELETE` | `/api/v1/tasks`         | `taskModal`                                                                       | `?taskId=…`                                                      | `string` (acknowledgement)     |
| `PUT`    | `/api/v1/tasks/orders`  | `useDragEnd`                                                                      | `{ fromId, referenceId, fromColumnId, referenceColumnId, type }` | `string` (acknowledgement)     |

(1) `projectModal` form state includes `managerId` and the FE sends it on both `POST` and `PUT`. The server silently ignores it on `POST` (the manager is derived from the JWT subject — see `app/services/project_service.py`) and only honours it on `PUT` for ownership transfer. Mutating endpoints on `projects`, `boards`, and `tasks` return a bare acknowledgement string (e.g. `"Project created"`, `"Task updated"`); they do NOT echo the resource. Callers that need the new document must re-`GET` it or invalidate the React Query cache.

### AI v1 (`/api/ai/`)

Only called when `REACT_APP_AI_BASE_URL` is non-empty (`aiUseLocalEngine === false`).
Route called from `useAi.ts` and `useAiChat.ts`.

Every request includes an `Idempotency-Key: <uuid>` header generated by `newIdempotencyKey()` (`src/utils/ai/idempotencyKey.ts`). A fresh key is generated per call (not per retry), so the server's idempotency middleware identifies each attempt as distinct. The server returns a cached response for duplicate keys received within its deduplication window.

| Method | Path                     | Called by                          | Request body                                                | Response type              |
| ------ | ------------------------ | ---------------------------------- | ----------------------------------------------------------- | -------------------------- |
| `POST` | `/api/ai/task-draft`     | `useAi` (route `"task-draft"`)     | `RunPayload` (draft + context)                              | `IDraftTaskSuggestion`     |
| `POST` | `/api/ai/task-breakdown` | `useAi` (route `"task-breakdown"`) | `RunPayload` (draft + count + context)                      | `ITaskBreakdownSuggestion` |
| `POST` | `/api/ai/estimate`       | `useAi` (route `"estimate"`)       | `RunPayload` (estimate + context)                           | `IEstimateSuggestion`      |
| `POST` | `/api/ai/readiness`      | `useAi` (route `"readiness"`)      | `RunPayload` (readiness + context)                          | `IReadinessReport`         |
| `POST` | `/api/ai/board-brief`    | `useAi` (route `"board-brief"`)    | `RunPayload` (brief + context, notes stripped)              | `IBoardBrief`              |
| `POST` | `/api/ai/search`         | `useAi` (route `"search"`)         | `RunPayload` (search query + context)                       | `ISearchResult`            |
| `POST` | `/api/ai/chat`           | `useAiChat`                        | `{ messages: AiChatMessage[], context: ChatEngineContext }` | `ChatTurnResult`           |

Note: `board-brief` payloads have task `note` fields stripped by `sanitizeRemotePayloadForRoute` before the request is sent.

#### AI v1 error responses

Non-OK responses from all AI v1 routes are mapped by `mapErrorResponse` (`src/utils/ai/mapErrorResponse.ts`) to the same typed error classes used by the agent client:

| HTTP status                 | Thrown class          | Notes                                                                 |
| --------------------------- | --------------------- | --------------------------------------------------------------------- |
| 401                         | `AgentAuthError`      |                                                                       |
| 402                         | `AgentBudgetError`    | Server sends `X-Reason: budget`                                       |
| 403                         | `AgentForbiddenError` |                                                                       |
| 404                         | `AgentNotFoundError`  |                                                                       |
| 429 with `X-Reason: budget` | `AgentBudgetError`    | Defensive branch for forward compatibility                            |
| 429                         | `AgentRateLimitError` | Server sends `Retry-After: <seconds>`; `aiChatDrawer` shows countdown |
| >= 500                      | `AgentServerError`    |                                                                       |
| other                       | `AgentTransportError` |                                                                       |

`aiErrorView` (`src/utils/ai/errorTemplate.ts`) maps these to UI copy with explicit `retryable` flags.

The FE always sends the wrapped envelope (e.g. `{ "draft": { ... } }`, `{ "estimate": { ... } }`) — that is `RunPayload` shape verbatim. The server also accepts the equivalent flat body (`{ "prompt": ..., "context": ... }`) for cURL callers and the existing test suite — see `_unwrap_envelope` in `app/routers/ai.py` and the matching note in `../backend/docs/BACKEND_API.md` — but FE callers do not use the flat form.

### Agents v2.1 (`/api/v1/agents/`)

Streaming SSE endpoint. Only used when `REACT_APP_AI_BASE_URL` is non-empty.

| Method | Path                           | Called by                                                               | Request body         | Response                   |
| ------ | ------------------------------ | ----------------------------------------------------------------------- | -------------------- | -------------------------- |
| `POST` | `/api/v1/agents/{name}/stream` | `agentClient.streamAgent`, `useAgent`                                   | `AgentStreamRequest` | SSE stream of `StreamPart` |
| `POST` | `/api/v1/agents/{name}/invoke` | `agentClient.invokeAgent`                                               | `AgentStreamRequest` | JSON (agent-specific)      |
| `GET`  | `/api/v1/agents`               | `agentClient.listAgents`                                                | —                    | `AgentListResponse`        |
| `GET`  | `/api/v1/agents/{name}`        | `agentClient.getAgentMetadata`                                          | —                    | `AgentMetadata`            |
| `GET`  | `/api/v1/health`               | `agentClient.getAgentHealth`, `agentHealth.pingAgent`, `useAgentHealth` | —                    | `AgentHealthResponse`      |

HTTP sample for a streaming start:

```http
POST /api/v1/agents/board-copilot/stream HTTP/1.1
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>

{
  "input": { "messages": [{ "role": "user", "content": "Summarise the board" }] },
  "config": {
    "configurable": {
      "thread_id": "t_abc123",
      "project_id": "proj_xyz",
      "autonomy": "plan"
    }
  },
  "stream_mode": ["updates", "messages", "custom"],
  "version": "v2"
}
```

---

## Hooks Reference

### `useApi`

_Source: `src/utils/hooks/useApi.ts:86`_

```ts
const useApi: () => (
    endpoint: string,
    config?: {
        data?: object;
        token?: string | null;
        method?: string;
        [key: string]: unknown;
    }
) => Promise<unknown>;
```

**Returns** a memoized `api` function scoped to the current user's JWT.

The returned function:

- Prepends `environment.apiBaseUrl/` to `endpoint`.
- On `GET` / `DELETE`: serializes `data` as a query string via `qs.stringify`.
- On other methods: serializes `data` as a JSON body.
- Attaches `Authorization: Bearer <jwt>` from `useAuth`.
- Parses the response body via `parseFetchBody` (JSON or text).
- Rejects with an `Error` whose message is extracted from the response body.
- Converts network-level `TypeError` via `rewriteNetworkFetchError`.

The bare `api` function is also exported for use outside of React components.

---

### `useReactQuery`

_Source: `src/utils/hooks/useReactQuery.ts:18`_

```ts
const useReactQuery: <D>(
    endPoint: string,
    queryParam?: Record<string, unknown>,
    specialQueryKey?: string,
    onSuccess?: (data: D) => void,
    onError?: (err: Error) => void,
    enabled?: boolean
) => UseQueryResult<D> & { isIdle: boolean };
```

Thin wrapper around `@tanstack/react-query` `useQuery`.

- Cache key: `[endPoint]` (no params) or `[specialQueryKey ?? endPoint, filterRequest(queryParam)]`.
- `filterRequest` strips `undefined` / `null` values before hashing.
- `isIdle` is `true` when `status === "pending" && fetchStatus === "idle"`.
- Fires `onSuccess` / `onError` side-effect callbacks once per data or error update.

---

### `useReactMutation`

_Source: `src/utils/hooks/useReactMutation.ts:27`_

```ts
const useReactMutation: <D>(
    endPoint: string,
    method: string,
    queryKey?: QueryKey | string,
    callback?: (target: unknown, old: unknown) => unknown,
    onError?: (err: Error) => void,
    setCache?: boolean
) => UseMutationResult<D, unknown, MutationParam> & { isLoading: boolean };
```

- `callback` is the optimistic update function: receives `(mutationArg, cachedData)` and returns the next cached value. When `callback` returns `undefined` or the identity, the optimistic update is skipped.
- On error: rolls back the cache if an optimistic update was applied. Calls `onError` if provided; otherwise shows a toast when an optimistic rollback occurs.
- On success: calls `queryClient.invalidateQueries` unless `setCache === true`, in which case it writes the response directly to the cache.
- `isLoading` is an alias for `isPending`.

---

### `useAuth`

_Source: `src/utils/hooks/useAuth.ts:7`_

```ts
const useAuth: () => {
    user: IUser | undefined;
    token: string | null;
    logout: () => void;
    refreshUser: () => Promise<void>;
};
```

- `user` is read from the React Query cache under key `["users"]`.
- `token` is read from `localStorage` via `readAuthToken()`.
- `logout()` clears the query cache, removes the token, and navigates to `/login`.
- `refreshUser()` refetches `["users"]` and patches `jwt` back into the cache entry
  from `localStorage`. On error it clears auth and redirects to `/login`.

---

### `useAi`

_Source: `src/utils/hooks/useAi.ts:247`_

```ts
const useAi: <T>(options: { route: AiRoute }) => {
    run: (payload: RunPayload) => Promise<T>;
    abort: () => void;
    reset: () => void;
    data: T | undefined;
    error: Error | null;
    isLoading: boolean;
};
```

**`AiRoute`** union:

```ts
type AiRoute =
    | "task-draft"
    | "task-breakdown"
    | "estimate"
    | "readiness"
    | "board-brief"
    | "search";
```

**`RunPayload`** shape:

```ts
interface RunPayload {
    draft?: DraftRequest & { count?: number };
    estimate?: EstimateRequest & { context: AiContextProject };
    readiness?: ReadinessRequest & { context: AiContextProject };
    brief?: { context: AiContextProject };
    search?: {
        kind: "tasks" | "projects";
        query: string;
        projectContext?: AiContextProject;
        projectsContext?: AiSearchProjectsContext;
    };
}
```

**Behaviour:**

1. `run(payload)` first calls `assertRunPayloadProjectsAiAllowed(payload)` — throws
   `PROJECT_AI_DISABLED_MESSAGE` if the target project is in the per-project disable list.
2. When `environment.aiUseLocalEngine` is `true`: delegates to `localResolve(route, payload)` (synchronous, deterministic).
3. When remote: POSTs to `${aiBaseUrl}/api/ai/${route}` with `Authorization` header and
   sanitized payload (notes stripped for `board-brief`).
4. The raw response is passed through `validateResponse(route, raw, payload)` which
   coerces invalid ids, story-point values, and confidence scores into valid ranges.
5. Previous in-flight requests are aborted before starting a new one.
6. `abort()` cancels the in-flight fetch and clears `isLoading`.
7. `reset()` aborts, clears `data`, `error`, and `isLoading`.

**Notable side effects:**

- `board-brief` payloads have task `note` fields stripped via `sanitizeRemotePayloadForRoute` before the remote fetch (`aiDataScope.ts`).
- Stale state is not set after unmount (`mountedRef`) or after a subsequent call superseded the controller.

---

### `useAiChat`

_Source: `src/utils/hooks/useAiChat.ts:90`_

```ts
const useAiChat: (ctx: UseAiChatContext | null) => {
    send: (userText: string) => Promise<void>;
    abort: () => void;
    reset: () => void;
    dismissError: () => void;
    messages: AiChatMessage[];
    isLoading: boolean;
    error: Error | null;
    streamingText: string;
};
```

**`UseAiChatContext`:**

```ts
interface UseAiChatContext {
    engine: ChatEngineContext;
    execution: AiChatExecutionContext;
}
```

**Behaviour:**

1. `send(userText)`: checks `isProjectAiDisabled(ctx.execution.projectId)` — sets
   error and returns early if the project is opted out.
2. Appends the user message to `messages` immediately for instant UI feedback.
3. Runs a tool-call loop for up to `MAX_TOOL_ROUNDS` (5) turns:
    - Local mode (`aiUseLocalEngine`): calls `chatAssistantTurn(thread, ctx.engine)`.
    - Remote mode: POSTs `{ messages, context }` to `${aiBaseUrl}/api/ai/chat`.
    - On `kind === "tool_calls"`: executes each tool via `executeChatToolCall` and
      appends results as `role: "tool"` messages.
    - On `kind === "text"`: appends the final assistant turn with accumulated citations.
4. Citations accumulate per-turn (max 4 unique `source:id` pairs per turn). They are
   attached to the assistant message so older turns retain their sources.
5. `streamingText` holds a human-readable label ("List Tasks…") during tool execution.
6. HTTP 429 from the chat endpoint throws `microcopy.ai.chatBusyError`.
7. `abort()` cancels the in-flight request and resets `isLoading` and `streamingText`.
8. `reset()` aborts and clears `messages` and `error`.

---

### `useAgent`

_Source: `src/utils/hooks/useAgent.ts:215`_

```ts
const useAgent: (name: string, options?: UseAgentOptions) => UseAgentResult;
```

**`UseAgentOptions`:**

```ts
interface UseAgentOptions {
    baseUrl?: string;
    projectId?: string;
    userId?: string;
    feToolContext?: Partial<FeToolContext>;
    initialThreadId?: string;
}
```

**`UseAgentResult`:**

```ts
interface UseAgentResult {
    start: (input: unknown, options?: StartOptions) => Promise<void>;
    resume: (resumeValue: unknown) => Promise<void>;
    abort: () => void;
    reset: () => void;
    clearPendingProposal: () => void;
    isStreaming: boolean;
    state: UseAgentState;
    pendingInterrupt: InterruptPayload | null;
    pendingProposal: MutationProposal | null;
    citations: CitationRef[];
    nudges: TriageNudge[];
    error: Error | null;
    threadId: string;
    ttftMs: number | null;
}
```

**`StartOptions`:**

```ts
interface StartOptions {
    threadId?: string;
    autonomy?: AutonomyLevel;
    autoResume?: boolean;
}
```

**Behaviour:**

- `start(input, options)`: checks `isProjectAiDisabled(options.projectId)` — throws
  `AgentForbiddenError` before opening the SSE stream if the project is opted out. Then
  builds an `AgentStreamRequest` and opens an SSE stream via `streamAgent`. String inputs
  become `[{ role: "user", content: input }]`; object inputs are expected to carry a
  `messages` array.
- Wire body includes `thread_id`, `project_id`, and `autonomy` in `configurable`. The
  `user_id` is intentionally absent — the agent server derives identity from the JWT.
- Auto-resume loop: if the stream emits an `interrupt` for a tool in `FE_TOOL_REGISTRY`,
  the hook runs the tool synchronously and POSTs a `command: { resume }` body without
  surfacing the interrupt to the UI. Up to 8 rounds.
- `pendingInterrupt` is set when auto-resume is disabled (`autoResume: false`) or the
  tool is not in the registry.
- `pendingProposal` is set when a `mutation_proposal` custom event arrives.
- `citations` and `nudges` reset on each new `start()` call.
- `ttftMs`: time in ms from `start()` to the first `messages` chunk. Fires
  `ANALYTICS_EVENTS.AGENT_TTFT` automatically.
- Watchdog: aborts the stream and surfaces an error if no chunk arrives within
  `STREAM_WATCHDOG_MS` (from `theme/aiTokens.ts`).
- `threadId` is generated per-reset with `generateThreadId()` (uses `crypto.randomUUID`
  when available, falls back to `Math.random`).
- `clearPendingProposal()` clears `pendingProposal` without aborting the stream.

---

### `useAgentHealth`

_Source: `src/utils/hooks/useAgentHealth.ts:28`_

```ts
const useAgentHealth: (
    baseUrl: string,
    opts?: { intervalMs?: number; enabled?: boolean }
) => UseAgentHealthState;
```

```ts
type AgentHealthStatus = "ok" | "degraded" | "offline";

interface UseAgentHealthState {
    status: AgentHealthStatus;
    latencyMs: number;
    lastChecked: number | null;
}
```

**Behaviour:**

- No-op when `baseUrl` is empty or `enabled === false`.
- Polls `GET /api/v1/health` every `intervalMs` (default 30 000 ms).
- `"ok"`: response is successful and round-trip latency is under 1500 ms.
- `"degraded"`: response is successful but round-trip latency is >= 1500 ms. This is a client-side classification — the server's own `status` field can also be `"degraded"` independently (it reports DB-ping or persistence-backend health), but `useAgentHealth` derives `"degraded"` purely from the measured latency rather than the server status field.
- `"offline"`: fetch failed or response is not ok.
- Cleans up on unmount (cancels the interval and aborts the in-flight request).

---

### `useAiEnabled`

_Source: `src/utils/hooks/useAiEnabled.ts:36`_

```ts
const useAiEnabled: () => {
    enabled: boolean;
    setEnabled: (next: boolean) => void;
    available: boolean;
};
```

- `available`: `environment.aiEnabled` (the `REACT_APP_AI_ENABLED` gate).
- `enabled`: `available && localStorage.getItem("boardCopilot:enabled") !== "false"`.
- `setEnabled(next)`: writes to `localStorage` and dispatches a `CustomEvent`
  (`"boardCopilot:toggled"`) so sibling hook instances synchronize across tabs.

```ts
export const useAutonomyLevel: () => {
    level: AutonomyLevel;
    setLevel: (next: AutonomyLevel) => void;
};
```

- Persists autonomy in `localStorage` under `"boardCopilot:autonomy"`.
- Synchronizes across instances via `"boardCopilot:autonomyChanged"` custom event.
- Valid values: `"suggest"` | `"plan"` | `"auto"`. Default: `"plan"`.

---

### `useAiProjectDisabled`

_Source: `src/utils/hooks/useAiProjectDisabled.ts:13`_

```ts
const useAiProjectDisabled: (projectId: string | undefined | null) => {
    disabled: boolean;
    setDisabled: (next: boolean) => void;
};
```

- Reads from `projectAiStorage.isProjectAiDisabled(projectId)`.
- `setDisabled(true)` adds the project id to the `"boardCopilot:disabledProjectIds"` array in `localStorage`.
- Subscribes to the `"boardCopilot:projectAiChanged"` custom event so the hook
  re-renders when another component changes the disabled set.

---

### `useAiChatDrawer`

_Source: `src/utils/hooks/useAiChatDrawer.ts:11`_

```ts
const useAiChatDrawer: () => {
    open: boolean;
    openDrawer: (initialPrompt?: string) => void;
    closeDrawer: () => void;
    pendingPrompt: string | undefined;
};
```

URL-driven drawer state via `?chat=1` or `?chat=1:<encodedPrompt>`. The system back button dismisses the drawer instead of exiting the page.

---

### `useAiDraftModal`

_Source: `src/utils/hooks/useAiDraftModal.ts:13`_

```ts
const useAiDraftModal: () => {
    activeColumnId: string | undefined;
    openModal: (columnId: string) => void;
    closeModal: () => void;
};
```

URL-driven modal state via `?aiDraft=<columnId>`. Each `TaskCreator` only renders the modal when `activeColumnId === columnId`, preventing cross-talk between per-column triggers.

---

### `useBoardBriefDrawer`

_Source: `src/utils/hooks/useBoardBriefDrawer.ts:12`_

```ts
const useBoardBriefDrawer: () => {
    open: boolean;
    openDrawer: () => void;
    closeDrawer: () => void;
};
```

URL-driven drawer state via `?brief=1`.

---

### `useDragEnd`

_Source: `src/utils/hooks/useDragEnd.ts:11`_

```ts
const useDragEnd: (options?: { tasksEnabled?: boolean }) => {
    onDragEnd: (result: DropResult) => void;
    isColumnDragDisabled: boolean;
    isTaskDragDisabled: boolean;
};
```

Handles `@hello-pangea/dnd` drop events. Column reorders call `PUT /api/v1/boards/orders`; task reorders call `PUT /api/v1/tasks/orders`. Both mutations are optimistic. `isColumnDragDisabled` / `isTaskDragDisabled` are `true` while the corresponding mutation is in-flight.

---

### `useUrl`

_Source: `src/utils/hooks/useUrl.ts:6`_

```ts
const useUrl: <K extends string>(
    keys: K[]
) => [Record<K, string | null>, (params: Partial<Record<K, unknown>>) => void];
```

Typed wrapper around React Router `useSearchParams`. Setting a key to `undefined` removes it from the URL. Used by `useAiChatDrawer`, `useAiDraftModal`, `useBoardBriefDrawer`, `useTaskModal`.

---

## Utilities Reference

### `engine.ts` — local deterministic engine

_Source: `src/utils/ai/engine.ts:1`_

All functions are pure and synchronous. They are called by `localResolve` in `useAi.ts` when `REACT_APP_AI_BASE_URL` is unset.

#### `draftTask`

```ts
function draftTask(request: DraftRequest): IDraftTaskSuggestion;
```

**`DraftRequest`:**

```ts
interface DraftRequest {
    prompt: string;
    columnId?: string;
    coordinatorId?: string;
    context: AiContextProject;
    axis?: "by_phase" | "by_surface" | "by_risk" | "freeform";
}
```

Heuristically drafts a task from the prompt:

- `taskName`: first sentence of prompt, truncated to 80 chars.
- `type`: `"Bug"` when the prompt contains bug hint words; otherwise `"Task"`.
- `epic`: mapped from hint-word sets (Bug Fix, Performance, Auth, UI Polish, Refactor, Documentation, Testing); defaults to `"New Feature"`.
- `storyPoints`: inferred from regex patterns (e.g. `"quick"` → 1, `"week"` → 13) then clamped to the Fibonacci sequence. Falls back to word-count bands.
- `columnId`: picks the most appropriate column for the type (triage/inbox for bugs, backlog for tasks).
- `coordinatorId`: uses the provided id if valid, otherwise the first member.
- `confidence`: 0.4 base + 0.2 for a story-point match + up to 0.3 from token count, capped at 0.95.
- `note`: multi-line markdown with `## Summary` and `## Acceptance criteria` sections.

#### `breakdownTask`

```ts
function breakdownTask(
    request: DraftRequest,
    count?: number
): ITaskBreakdownSuggestion;
```

Calls `draftTask` once, then generates `count` (2–6) subtask variants by prepending
rotation verbs ("Investigate", "Implement", "Add tests for", "Document", "Polish UX of").
Each subtask has halved story points and slightly reduced confidence.

#### `estimate`

```ts
function estimate(request: EstimateRequest): IEstimateSuggestion;

interface EstimateRequest {
    taskName: string;
    note?: string;
    type?: string;
    epic?: string;
    tasks: ITask[];
    excludeTaskId?: string;
}
```

Finds the top-3 most similar tasks in `tasks` by Jaccard token overlap over `taskName + note + epic`. Weighted average story points from the top candidates. Falls back to text-length heuristic when no similar task exists. Returns at most 3 `similar` references.

#### `readiness`

```ts
function readiness(request: ReadinessRequest): IReadinessReport;

interface ReadinessRequest {
    taskName: string;
    note?: string;
    epic?: string;
    type?: string;
    coordinatorId?: string;
}
```

Rule-based readiness check. Emits `IReadinessIssue` items for:

- `taskName` shorter than 3 chars (error).
- Empty `note` (warn); note without acceptance-criteria keywords (info).
- Missing `epic` (info).
- Missing `type` (warn).
- Missing `coordinatorId` (warn).

#### `boardBrief`

```ts
function boardBrief(context: AiContextProject): IBoardBrief;
```

Produces a board summary from the project context:

- `headline`: total tasks and in-progress count.
- `counts`: per-column task counts.
- `largestUnstarted`: top-3 unstarted tasks by story points.
- `unowned`: up to 5 tasks with no valid coordinator.
- `workload`: per-member open tasks and open story points.
- `recommendation` / `recommendationDetail`: highest-priority actionable text, with one of three strategies: unowned tasks > large unstarted task > workload imbalance.

#### `semanticSearch`

```ts
function semanticSearch(
    kind: "tasks" | "projects",
    query: string,
    context: AiContextProject | AiSearchProjectsContext
): ISearchResult;
```

Deterministic Jaccard ranking over token-overlap between the query and task/project text fields. PM-synonym expansion (via `expandWithSynonyms`) broadens the query token set. Returns ranked `ids`, per-result `matches` with strength bands (`"strong"` >= 0.45, `"moderate"` >= 0.20, `"weak"` otherwise), and `expandedTerms` describing which synonyms were applied.

#### `detectType` / `detectEpic`

```ts
function detectType(text: string): "Task" | "Bug";
function detectEpic(text: string): string;
```

Exported helpers used by the engine internally and by AI surface tests.

---

### `agentClient.ts` — streaming agent transport

_Source: `src/utils/ai/agentClient.ts:1`_

Typed HTTP transport over the LangGraph v2 agent surface. All functions attach
`Authorization: Bearer <jwt>` via `getStoredBearerAuthHeader()`.

#### `streamAgent`

```ts
async function* streamAgent(params: {
  name: string;
  body: AgentStreamRequest;
  signal?: AbortSignal;
  baseUrl: string;
  headers?: Record<string, string>;
}): AsyncGenerator<StreamPart, void, void>
```

POSTs to `${baseUrl}/api/v1/agents/${name}/stream` with `Accept: text/event-stream`.
Sends `Idempotency-Key: <uuid>` (via `newIdempotencyKey()`).
Parses the SSE response: splits on `\n\n`, drops comment lines and `event:` lines,
strips exactly one leading space after `data:` per the SSE spec, and yields each
`JSON.parse`d payload as a `StreamPart`. Releases the reader lock on completion or error.

**Error mapping** (via `mapErrorResponse`):

| HTTP status                 | Thrown class                              |
| --------------------------- | ----------------------------------------- |
| 401                         | `AgentAuthError`                          |
| 402                         | `AgentBudgetError`                        |
| 403                         | `AgentForbiddenError`                     |
| 404                         | `AgentNotFoundError`                      |
| 429 with `X-Reason: budget` | `AgentBudgetError` (defensive — see note) |
| 429                         | `AgentRateLimitError(retryAfterSeconds)`  |
| >= 500                      | `AgentServerError(status)`                |
| other                       | `AgentTransportError`                     |

The current `pulse` backend only emits `X-Reason: budget` on 402 (see `app/routers/agents.py` and `app/routers/ai.py`). The `429 + X-Reason: budget` row is a defensive branch for forward compatibility with servers that surface budget exhaustion as a 429; against today's BE the branch is unreachable.

#### `invokeAgent`

```ts
async function invokeAgent<T = unknown>(params: {
    name: string;
    body: AgentStreamRequest;
    signal?: AbortSignal;
    baseUrl: string;
    headers?: Record<string, string>;
}): Promise<T>;
```

POSTs to `${baseUrl}/api/v1/agents/${name}/invoke`. Sends `Idempotency-Key: <uuid>`. Returns the parsed JSON response body. Uses the same error mapping as `streamAgent`.

#### `listAgents`

```ts
async function listAgents(params: {
    baseUrl: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}): Promise<AgentListResponse>;
```

GETs `${baseUrl}/api/v1/agents`. Returns `{ agents: AgentMetadata[] }`.

#### `getAgentMetadata`

```ts
async function getAgentMetadata(params: {
    name: string;
    baseUrl: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}): Promise<AgentMetadata>;
```

GETs `${baseUrl}/api/v1/agents/${name}`. Returns `AgentMetadata`.

#### `getAgentHealth`

```ts
async function getAgentHealth(params: {
    baseUrl: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}): Promise<AgentHealthResponse>;
```

GETs `${baseUrl}/api/v1/health`. Accepts both `{ status, agents_loaded }` (snake_case)
and `{ ok, agentsLoaded }` (camelCase) body shapes for backwards compatibility.
Measures round-trip latency client-side when the body omits `latencyMs`. The server also exposes a legacy `GET /health` alias that returns the same body; the FE does not call it.

**Exported error classes:** `AgentTransportError`, `AgentAuthError`, `AgentForbiddenError`, `AgentRateLimitError`, `AgentBudgetError`, `AgentNotFoundError`, `AgentServerError`.

---

### `chatTools.ts` — chat tool execution

_Source: `src/utils/ai/chatTools.ts:1`_

#### `executeChatToolCall`

```ts
async function executeChatToolCall(
    api: ApiCaller,
    ctx: AiChatExecutionContext,
    call: AiChatToolCall,
    signal: AbortSignal
): Promise<unknown>;
```

**`AiChatExecutionContext`:**

```ts
interface AiChatExecutionContext {
    projectId: string;
    knownProjectIds: Set<string>;
    knownTaskIds: Set<string>;
    knownMemberIds: Set<string>;
    knownColumnIds: Set<string>;
}
```

**`AiChatToolCall`:**

```ts
interface AiChatToolCall {
    id: string;
    name: ChatToolName;
    arguments: Record<string, unknown>;
}

type ChatToolName =
    | "listProjects"
    | "listMembers"
    | "getProject"
    | "listBoard"
    | "listTasks"
    | "getTask";
```

Executes a tool call by forwarding to the REST API using the provided `api` caller.
All `projectId` arguments are validated against `ctx.knownProjectIds`; invalid ids return
`{ error: "Unknown or disallowed projectId" }` instead of making a network request.
Task and member ids are similarly validated. The `signal` is checked before execution.

**Tool-to-endpoint mapping:**

| Tool name      | REST call                                 |
| -------------- | ----------------------------------------- |
| `listProjects` | `GET /api/v1/projects`                    |
| `listMembers`  | `GET /api/v1/users/members`               |
| `getProject`   | `GET /api/v1/projects?projectId=…`        |
| `listBoard`    | `GET /api/v1/boards?projectId=…`          |
| `listTasks`    | `GET /api/v1/tasks?projectId=…&[filters]` |
| `getTask`      | `GET /api/v1/tasks?taskId=…`              |

#### `CHAT_TOOL_NAMES`

```ts
const CHAT_TOOL_NAMES: readonly [
    "listProjects",
    "listMembers",
    "getProject",
    "listBoard",
    "listTasks",
    "getTask"
];
```

Exported constant of allowed chat tool names.

---

### `aiDataScope.ts` — per-route privacy declarations

_Source: `src/utils/ai/aiDataScope.ts:1`_

#### `AI_DATA_SCOPES`

```ts
const AI_DATA_SCOPES: Record<AiRoute | "chat", AiDataScope>;
```

Static table declaring what each AI route sends remotely. Used by the privacy popover UI. Key fields:

- `summary`: one-sentence plain-English description.
- `items`: bullet list of fields transmitted.
- `sendsNotes: boolean`: whether free-text task notes are included.

`board-brief` is the only route with `sendsNotes: false`.

#### `getAiDataScope`

```ts
function getAiDataScope(route: AiRoute | "chat"): AiDataScope;
```

Returns the scope entry for the given route.

#### `sanitizeRemotePayloadForRoute`

```ts
function sanitizeRemotePayloadForRoute<P extends Record<string, unknown>>(
    route: AiRoute | "chat",
    payload: P
): P;
```

When `AI_DATA_SCOPES[route].sendsNotes` is `false`, strips `note` fields from all
`tasks` arrays found at `payload[key].tasks` or `payload[key].context.tasks`.
When `sendsNotes` is `true`, returns the payload unchanged.

Called by `useAi.ts` (before remote AI v1 requests) and `useAiChat.ts` (before remote chat requests).

---

### `projectAiStorage.ts` — per-project AI opt-out

_Source: `src/utils/ai/projectAiStorage.ts:1`_

#### `isProjectAiDisabled`

```ts
function isProjectAiDisabled(projectId: string | null | undefined): boolean;
```

Reads `localStorage["boardCopilot:disabledProjectIds"]` (JSON array of strings).
Returns `false` for `null`/`undefined` inputs.

#### `setProjectAiDisabledInStorage`

```ts
function setProjectAiDisabledInStorage(
    projectId: string,
    disabled: boolean
): void;
```

Adds or removes `projectId` from the stored set and dispatches the
`"boardCopilot:projectAiChanged"` custom event.

#### `subscribeProjectAiDisabled`

```ts
function subscribeProjectAiDisabled(listener: () => void): () => void;
```

Subscribes to `"boardCopilot:projectAiChanged"`. Returns an unsubscribe function.

#### `PROJECT_AI_DISABLED_MESSAGE`

```ts
const PROJECT_AI_DISABLED_MESSAGE =
    "Board Copilot is disabled for this project.";
```

Stable error message string thrown by `assertRunPayloadProjectsAiAllowed` and used in `useAiChat.send`.

---

### `remoteAiConsent.ts` — one-shot remote-AI consent banner

_Source: `src/utils/ai/remoteAiConsent.ts:1`_

Stores acknowledgement of the "Board Copilot is connected to a remote AI service"
banner per-device and per-configured-base-URL. Falls back to in-memory state when
`localStorage` is unavailable.

#### `hasAcknowledgedRemoteAi`

```ts
function hasAcknowledgedRemoteAi(baseUrl: string): boolean;
```

Returns `true` if the user has already dismissed the consent banner for this `baseUrl`.

#### `acknowledgeRemoteAi`

```ts
function acknowledgeRemoteAi(baseUrl: string): void;
```

Writes acknowledgement to `localStorage["boardCopilot:remoteConsent:<baseUrl>"]` and
the in-memory map.

#### `resetRemoteAiConsentForTests`

```ts
function resetRemoteAiConsentForTests(baseUrl?: string): void;
```

Test-only helper. Clears the in-memory map and removes the matching `localStorage` key.

---

### `aiAuthHeader.ts` — auth header factory

_Source: `src/utils/aiAuthHeader.ts:1`_

#### `getStoredBearerAuthHeader`

```ts
function getStoredBearerAuthHeader(): string;
```

Returns `"Bearer <token>"` if a token exists in `localStorage`, or `""` when no
token is stored. Used by `useAi.ts`, `useAiChat.ts`, and `agentClient.ts` to attach
auth headers to all AI proxy and agent server requests.

---

### `agentHealth.ts` — health probe

_Source: `src/utils/ai/agentHealth.ts:1`_

#### `pingAgent`

```ts
async function pingAgent(
    baseUrl: string,
    signal?: AbortSignal
): Promise<{ ok: boolean; latencyMs: number }>;
```

Calls `getAgentHealth`. On any non-abort error returns `{ ok: false, latencyMs: -1 }` so
callers never need to handle the error case. Called by `useAgentHealth` on each polling
tick.

---

### `idempotencyKey.ts` — idempotency key generator

_Source: `src/utils/ai/idempotencyKey.ts:1`_

```ts
function newIdempotencyKey(): string;
```

Generates a UUID-formatted idempotency key using `crypto.randomUUID()`. Falls back to
a `Math.random()`-based UUID-like string for environments (older Node/jsdom) where
`crypto.randomUUID` is absent. Called once per AI fetch invocation; callers do not
cache the key across retries.

---

### `mapErrorResponse.ts` — HTTP status → typed error mapper

_Source: `src/utils/ai/mapErrorResponse.ts:1`_

```ts
async function mapErrorResponse(response: Response): Promise<Error>;
```

Converts a non-OK `Response` to the appropriate typed Error subclass. Parses the
response body best-effort (JSON `message` field or raw text) for the error message.
Used by `useAi`, `useAiChat`, and `agentClient` so all AI surfaces share the same
error taxonomy and `aiErrorView` can render consistent UI copy.

---

### `sinks.ts` — observability sinks

_Source: `src/utils/observability/sinks.ts:1`_

Three sinks wired from `src/index.tsx`:

```ts
function httpAnalyticsSink(opts: {
    endpoint: string;
    batchSize?: number; // default 20
    flushIntervalMs?: number; // default 5000
    engineMode: "local" | "remote";
}): AnalyticsSink;

function httpErrorSink(opts: { endpoint: string }): ErrorSink;

function devMemorySink(): AnalyticsSink; // DEV only — stores to window.__copilotEvents__
```

`httpAnalyticsSink` batches events and POSTs `{ events: [...] }` to `VITE_ANALYTICS_ENDPOINT`.
Each event is enriched with `engineMode` so metrics can segment local vs remote AI usage.
`httpErrorSink` POSTs single `ErrorEvent` objects to `VITE_ERROR_REPORT_ENDPOINT`.
`devMemorySink` stores events in `window.__copilotEvents__` for QA inspection; it is the
only sink active when `VITE_ANALYTICS_ENDPOINT` is unset.
Both HTTP sinks swallow failures after one retry and never throw.

---

### `chatEngine.ts` — local chat assistant

_Source: `src/utils/ai/chatEngine.ts:1`_

#### `chatAssistantTurn`

```ts
function chatAssistantTurn(
    messages: AiChatMessage[],
    context: ChatEngineContext
): ChatTurnResult;
```

Deterministic single-step engine used in local mode. Inspects the last user message for
intent patterns (list projects, list members, show board, count tasks, get task by id)
and emits a `tool_calls` result or synthesizes an answer from `boardBrief`.

#### `chatAssistantFinalizeAfterTools`

```ts
function chatAssistantFinalizeAfterTools(messages: AiChatMessage[]): string;
```

After tool results have been appended, joins their content into a user-facing answer.
Called when the latest turn already has tool messages after the last user message.

#### `citationsFromToolResult`

```ts
function citationsFromToolResult(
    toolName: ChatToolName,
    payload: unknown
): CitationRef[];
```

Infers up to 3 `CitationRef` objects from a tool result payload by inspecting object
shape (`_id`, `taskName`, `username`, `projectName`, `columnName`). Returns an empty
array for unrecognized shapes.

#### `summarizeToolResultForUser`

```ts
function summarizeToolResultForUser(
    toolName: ChatToolName,
    payload: unknown
): string;
```

Produces a plain-language summary of a tool result (e.g. "Checked 12 tasks." with a
bulleted list). Falls back to truncated JSON (max 4000 chars) for unrecognized payloads.
Raw `_id` strings are not surfaced in the summary.

**`AiChatMessage`** (exported from `useAiChat.ts`):

```ts
interface AiChatMessage {
    role: "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    toolName?: ChatToolName;
    citations?: CitationRef[];
    toolCalls?: AiChatToolCall[];
}
```

**`ChatTurnResult`:**

```ts
type ChatTurnResult =
    | { kind: "text"; text: string }
    | { kind: "tool_calls"; toolCalls: AiChatToolCall[] };
```

---

### FE Tool Registry (`feTools/`)

_Source: `src/utils/ai/feTools/index.ts:34`_

```ts
const FE_TOOL_REGISTRY: Record<string, FeTool<unknown, unknown>>;
```

All FE tools keyed by their qualified name. Adding a tool to this registry makes it
auto-resumable from `useAgent` interrupt events without any hook changes.

**`FeToolContext`:**

```ts
interface FeToolContext {
    queryClient: QueryClient;
    projectId?: string;
    userId?: string;
    autonomyLevel?: AutonomyLevel;
    [key: string]: unknown;
}
```

**`FeTool`:**

```ts
interface FeTool<Args = unknown, Result = unknown> {
    name: string;
    description: string;
    run: (args: Args, ctx: FeToolContext) => Promise<Result> | Result;
}
```

#### Registered tools

| Name                | Description                                                                     | Source                      |
| ------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `fe.listProjects`   | Lists projects from React Query cache                                           | `feTools/listProjects.ts`   |
| `fe.listMembers`    | Lists members from React Query cache                                            | `feTools/listMembers.ts`    |
| `fe.getProject`     | Returns a single project by id from cache                                       | `feTools/getProject.ts`     |
| `fe.listBoard`      | Returns columns for a project from cache                                        | `feTools/listBoard.ts`      |
| `fe.listTasks`      | Returns tasks for a project from cache                                          | `feTools/listTasks.ts`      |
| `fe.getTask`        | Returns a single task by id from cache                                          | `feTools/getTask.ts`        |
| `fe.boardSnapshot`  | Compact board summary: counts, unowned tasks, workload                          | `feTools/boardSnapshot.ts`  |
| `fe.similarTasks`   | Jaccard-ranked task ids for a free-text query                                   | `feTools/similarTasks.ts`   |
| `fe.viewerContext`  | Viewer user, role, current route, focused task, selection                       | `feTools/viewerContext.ts`  |
| `fe.recentActivity` | Last-24h action log (returns `{activity: []}` until action history slice lands) | `feTools/recentActivity.ts` |
| `fe.formDraft`      | In-progress form draft (returns `{draft: null}` until form context lands)       | `feTools/formDraft.ts`      |

FE tool argument names use **snake_case** to match the Python server's schemas:

| Tool             | Key argument(s)                          |
| ---------------- | ---------------------------------------- |
| `fe.getTask`     | `task_id: string`, `project_id?: string` |
| `fe.getProject`  | `project_id: string`                     |
| `fe.listBoard`   | `project_id?: string`                    |
| `fe.listTasks`   | `project_id?: string`                    |
| `fe.listMembers` | `project_id?: string`                    |

**`fe.boardSnapshot`** redacts task notes longer than 4 KB at `"suggest"` autonomy to
`head(1024) + …[redacted len=N h=<djb2>]… + tail(512)`. At `"plan"` / `"auto"` the
full note is forwarded.

---

## Types Reference

### `IDraftTaskSuggestion`

_Source: `src/interfaces/ai.d.ts:3`_

```ts
interface IDraftTaskSuggestion {
    taskName: string;
    type: string;
    epic: string;
    storyPoints: StoryPoints;
    note: string;
    columnId: string;
    coordinatorId: string;
    confidence: number;
    rationale: string;
}
```

The result of the `task-draft` and individual items within `task-breakdown` responses.
`confidence` is a [0, 1] float reflecting the engine's certainty. `rationale` is a short
plain-English explanation for display. `storyPoints` is constrained to the Fibonacci
sequence: `1 | 2 | 3 | 5 | 8 | 13`.

---

### `ITaskBreakdownSuggestion`

_Source: `src/interfaces/ai.d.ts:95`_

```ts
interface ITaskBreakdownSuggestion {
    items: IDraftTaskSuggestion[];
}
```

Wrapper returned by the `task-breakdown` route. `items` contains 2–6 subtasks derived
from the parent draft. Each item has its own `confidence` and `rationale`.

---

### `IEstimateSuggestion`

_Source: `src/interfaces/ai.d.ts:21`_

```ts
interface IEstimateSuggestion {
    storyPoints: StoryPoints;
    confidence: number;
    rationale: string;
    similar: IEstimateSimilar[];
}

interface IEstimateSimilar {
    _id: string;
    reason: string;
}
```

Result of the `estimate` route. `similar` lists at most three task ids from the
project whose text best overlaps with the new task, together with a human-readable
similarity percentage. When no similar tasks exist, the engine falls back to text-length
heuristics and sets a lower `confidence`.

---

### `IReadinessReport`

_Source: `src/interfaces/ai.d.ts:33`_

```ts
interface IReadinessReport {
    issues: IReadinessIssue[];
}

interface IReadinessIssue {
    field: "taskName" | "note" | "epic" | "type" | "coordinatorId";
    severity: "info" | "warn" | "error";
    message: string;
    suggestion?: string;
}
```

Result of the `readiness` route. An empty `issues` array means the task is ready to
start. `severity` escalates from informational nudges (`"info"`) through soft warnings
(`"warn"`) to blocking issues (`"error"`). `suggestion` provides actionable copy.

---

### `IBoardBrief`

_Source: `src/interfaces/ai.d.ts:80`_

```ts
interface IBoardBrief {
    headline: string;
    counts: IBoardBriefCount[];
    largestUnstarted: IBoardBriefTaskRef[];
    unowned: IBoardBriefTaskRef[];
    workload: IBoardBriefWorkload[];
    recommendation: string;
    recommendationDetail?: IBoardBriefRecommendation;
}

interface IBoardBriefCount {
    columnId: string;
    columnName: string;
    count: number;
}

interface IBoardBriefTaskRef {
    taskId: string;
    taskName: string;
    storyPoints?: number;
}

interface IBoardBriefWorkload {
    memberId: string;
    username: string;
    openTasks: number;
    openPoints: number;
}

interface IBoardBriefRecommendation {
    text: string;
    strength: "strong" | "moderate" | "low" | "none";
    basis: string;
    sources: IBoardBriefTaskRef[];
}
```

Result of the `board-brief` route. `recommendation` is the compact legacy string (kept
for remote engine compatibility and markdown export). `recommendationDetail` carries
the richer structured form with `strength` and grounding `sources`. Remote engines that
pre-date this field omit it; surfaces degrade gracefully.

---

### `ISearchResult`

_Source: `src/interfaces/ai.d.ts:114`_

```ts
interface ISearchResult {
    ids: string[];
    rationale: string;
    matches?: IAiSearchMatch[];
    expandedTerms?: string[];
}

interface IAiSearchMatch {
    id: string;
    strength: AiSearchMatchStrength;
}

type AiSearchMatchStrength = "strong" | "moderate" | "weak";
```

Result of the `search` route. `ids` is the ranked list of task or project ids.
`matches` provides per-id strength bands so the UI can flag weak hits.
`expandedTerms` is a list of human-readable synonym expansion notes (e.g. `"todo → backlog, inbox"`).
Remote engines that pre-date these optional fields omit them; the UI degrades gracefully.

---

### `MutationProposal`

_Source: `src/interfaces/agent.d.ts:79`_

```ts
interface MutationProposal {
    proposal_id: string;
    description: string;
    diff: MutationDiff;
    risk: "low" | "med" | "high";
    undoable: true;
}

interface MutationDiff {
    task_updates?: TaskUpdate[];
    column_updates?: ColumnUpdate[];
    bulk_apply?: BulkApply[];
}

interface TaskUpdate {
    task_id: string;
    field:
        | "coordinatorId"
        | "columnId"
        | "epic"
        | "type"
        | "storyPoints"
        | "taskName"
        | "note";
    from: unknown;
    to: unknown;
}

interface ColumnUpdate {
    column_id: string;
    field: "name" | "order";
    from: unknown;
    to: unknown;
}

interface BulkApply {
    operation: string;
    targets: string[];
    payload: Record<string, unknown>;
}
```

Emitted by the agent as a `custom` event with `kind: "mutation_proposal"`. The FE
surfaces it in `useAgent.pendingProposal` and renders it in `MutationProposalCard`.
`risk` determines whether the UI offers a one-click accept or requires a confirmation
step. `undoable` is always `true` — the server only proposes changes that can be
reversed via the undo toast.

---

### `StreamPart`

_Source: `src/interfaces/agent.d.ts:122`_

```ts
type StreamPart =
    | { type: "updates"; ns: string[]; data: Record<string, unknown> }
    | { type: "messages"; ns: string[]; data: [LLMTokenChunk, MessageMetadata] }
    | { type: "custom"; ns: string[]; data: CustomEvent }
    | { type: "interrupt"; ns: string[]; data: InterruptPayload }
    | {
          type: "error";
          ns: string[];
          data: { message: string; recoverable?: boolean };
      };
```

Each SSE event payload yielded by `streamAgent`. `ns` is the LangGraph node namespace.
`messages` chunks carry incremental LLM text token-by-token; the `useAgent` hook
concatenates them onto the last assistant message. `custom` events carry typed
application events (citations, proposals, usage, nudges). `interrupt` events suspend
the agent run pending a tool result or user approval. `error` events are non-fatal
by default; `recoverable: false` is treated as terminal.

**`CustomEvent`** discriminated union:

```ts
type CustomEvent =
    | { kind: "citation"; refs: CitationRef[] }
    | { kind: "mutation_proposal"; proposal: MutationProposal }
    | {
          kind: "suggestion";
          surface: "brief" | "draft" | "estimate" | "readiness" | "search";
          payload: unknown;
      }
    | { kind: "usage"; tokensIn: number; tokensOut: number }
    | { kind: "nudge"; nudge: TriageNudge };
```

---

### `AgentMetadata`

_Source: `src/interfaces/agent.d.ts:14`_

```ts
interface AgentMetadata {
    name: string;
    version: string;
    description: string;
    status: "active" | "deprecated" | "shadow";
    allowed_autonomy: AutonomyLevel[];
    tools?: string[];
    rate_limit?: { per_minute: number; per_hour: number };
}
```

Returned by `GET /api/v1/agents` and `GET /api/v1/agents/{name}`. `status: "shadow"`
means the agent is deployed but not yet user-visible. `allowed_autonomy` lists which
`AutonomyLevel` values the server permits for this agent; the FE gates the autonomy
selector to this set.

The server response also carries `tags: string[]`, `recursion_limit: number`, and `context_schema: string | null` (see `../backend/docs/BACKEND_API.md` and `app/agents/base.py`). The FE interface above intentionally narrows the surface to the fields it consumes — the additional fields are accepted at runtime and ignored.

---

### `AgentStreamRequest`

_Source: `src/interfaces/agent.d.ts:133`_

```ts
interface AgentStreamRequest {
    input: {
        messages?: Array<{ role: string; content: string }>;
        [k: string]: unknown;
    } | null;
    command?: { resume: unknown };
    config: {
        configurable: {
            thread_id: string;
            [k: string]: unknown;
        };
    };
    stream_mode: Array<"updates" | "messages" | "custom">;
    version: "v2";
}
```

Wire body for `POST /api/v1/agents/{name}/stream` and `/invoke`. `input` is `null`
when posting a `command.resume`. The `configurable` object carries `thread_id`,
`project_id`, and `autonomy` but intentionally omits `user_id` — the server derives
the caller's identity from the JWT and rejects client-supplied `user_id` with HTTP 400
to prevent identity spoofing.

---

### `InterruptPayload`

_Source: `src/interfaces/agent.d.ts:107`_

```ts
interface InterruptPayload {
    tool: string;
    args: Record<string, unknown>;
}
```

Payload of an `interrupt` `StreamPart`. `tool` is the fully-qualified FE tool name
(e.g. `"fe.boardSnapshot"`). The `useAgent` hook looks up `tool` in `FE_TOOL_REGISTRY`;
if found and `autoResume` is enabled, it runs the tool and resumes the stream without
surfacing the interrupt to the UI.

---

### `TriageNudge`

_Source: `src/interfaces/agent.d.ts:87`_

```ts
interface TriageNudge {
    nudge_id: string;
    kind: "load_imbalance" | "wip_overflow" | "unowned_bug" | "stale_task";
    project_id: string;
    summary: string;
    target_ids: string[];
    severity: "info" | "warn" | "critical";
}
```

Proactive triage signal emitted as a `custom` event with `kind: "nudge"`. Collected in
`useAgent.nudges` and rendered as `NudgeCard` components. `target_ids` identifies
the tasks or members the nudge applies to.

---

### `CitationRef`

_Source: `src/interfaces/agent.d.ts:28`_

```ts
interface CitationRef {
    source: "task" | "column" | "member" | "project";
    id: string;
    quote: string;
}
```

A typed link from an AI answer to a board record. `quote` is the display name of the
referenced entity (task name, username, etc.) shown in `CitationChip` components.
In `useAiChat`, citations are attached to the assistant turn that finalizes each tool
round; in `useAgent`, they accumulate from `custom` events per turn.

---

### `AutonomyLevel`

_Source: `src/interfaces/agent.d.ts:12`_

```ts
type AutonomyLevel = "suggest" | "plan" | "auto";
```

Agent autonomy mode. `"suggest"` — agent gives text advice only, no mutation proposals.
`"plan"` (default) — agent proposes mutations for user approval. `"auto"` — agent applies
low-risk undoable mutations immediately with a toast-based undo.

---

### Domain interfaces

_Sources: `src/interfaces/`_

| Interface     | Key fields                                                                                                  | Source         |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| `ITask`       | `_id`, `columnId`, `coordinatorId`, `epic`, `taskName`, `type`, `note`, `projectId`, `storyPoints`, `index` | `task.d.ts`    |
| `IColumn`     | `_id`, `columnName`, `projectId`, `index`                                                                   | `column.d.ts`  |
| `IProject`    | `_id`, `projectName`, `managerId`, `organization`, `createdAt?`                                             | `project.d.ts` |
| `IMember`     | `_id`, `username`, `email`                                                                                  | `member.d.ts`  |
| `IUser`       | extends `IMember`, adds `likedProjects: string[]`, `jwt?: string`                                           | `user.d.ts`    |
| `IError`      | `error: { msg: string }[] \| string`                                                                        | `error.d.ts`   |
| `StoryPoints` | `1 \| 2 \| 3 \| 5 \| 8 \| 13`                                                                               | `ai.d.ts`      |

`IUser.jwt` is present only in `POST /auth/login` responses. `GET /users` and `PUT /users/likes` intentionally omit it. `useAuth.refreshUser` patches the token back into the cache from `localStorage`.

---

## Local Fallback Engine

When `REACT_APP_AI_BASE_URL` is unset (empty string), `environment.aiUseLocalEngine`
is `true`. In this mode:

- `useAi.run(payload)` calls `localResolve(route, payload)` in `useAi.ts` which
  delegates to the functions in `engine.ts`. No HTTP request is made.
- `useAiChat.send(text)` calls `chatAssistantTurn(thread, ctx.engine)` in
  `chatEngine.ts`. No HTTP request is made.
- `useAgent` still tries to reach `${baseUrl}/api/v1/agents/…` — but since `baseUrl`
  defaults to `environment.aiBaseUrl` which is `""`, every `streamAgent` call would
  attempt to `fetch("/api/v1/agents/…")` against the current origin. Agent-based
  surfaces should disable themselves when `aiBaseUrl` is empty.
- `useAgentHealth` is a no-op when `baseUrl` is empty (`enabled` defaults to
  `baseUrl.length > 0`).

The local engine is deterministic, runs entirely in the browser, and sends no data to
any external service. Its outputs are calibrated to approximate what a remote LLM-backed
service returns, but they are purely heuristic.

---

## Mock Server

_Source: `__json_server_mock__/middleware.js`, `__json_server_mock__/db.json`_

Run with:

```
npm run server
```

This starts `json-server` on `http://localhost:8080` with a custom `middleware.js` and
seeds data from `db.json`. Point the FE at it by setting `REACT_APP_API_URL=http://localhost:8080`.

### Auth routes (handled by middleware)

The middleware intercepts auth and user-info routes before `json-server`'s default
router sees them.

#### `POST /login` and `POST /api/v1/auth/login`

```json
{ "email": "alice@example.com", "password": "any" }
```

Success (200): returns a synthetic `IUser` with `_id = email`, `jwt = email`,
`username = email.split("@")[0]`. Any `email` containing the substring `"wrong"`
returns a 400 with `{ "error": "Invalid credential, please try again" }`.

#### `POST /register` and `POST /api/v1/auth/register`

```json
{ "email": "alice@example.com", "password": "any" }
```

Success (201): `{ "message": "User created" }`. Emails containing `"wrong"` return 400.

#### `GET /userInfo` and `GET /api/v1/users`

Requires `Authorization: Bearer <token>` header. Reconstructs the user from the token
value (treated as email). Missing auth header returns 401.

### Auth guard

All other routes require `Authorization` header. Requests without it return:

```json
{ "error": "Unauthorized" }
```

### Resource routes (handled by json-server)

`db.json` seeds `users` and `projects` collections. `json-server` auto-generates REST
routes for them. The seed data does not include `boards`, `tasks`, or `columns`
collections — those need to be created at runtime or the seed file extended.

```json
{
    "users": [
        { "id": 1, "name": "Tim" },
        { "id": 2, "name": "Jack" }
    ],
    "projects": [
        {
            "id": 1,
            "name": "Employee Management APP",
            "personId": 1,
            "department": "Dev team 0"
        }
    ]
}
```

Note: the seed `id` field is numeric and the field name is `id`, not `_id`. The live
server uses MongoDB-style `_id` strings. When testing against the mock server, component
code that reads `project._id` will receive `undefined` from the seed data unless the
seed is updated to match the live schema.
