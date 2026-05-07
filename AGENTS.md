# Agent notes

Short, durable gotchas for anyone (human or AI) editing this repo. Add an entry
when a fix is non-obvious from the code alone.

## v2.1 agent surface (`useAgent`)

- Both `useAi` (v1 JSON) and `useAgent` (v2.1 SSE) commonly mount unconditionally
  in components that switch on `environment.aiUseLocalEngine`. This is required —
  conditionally calling either hook breaks React's hook-ordering rule. See
  `AiChatDrawer` and `BoardBriefDrawer` for the canonical pattern.
- Migration progress for the six structured routes lives in
  `docs/prd/board-copilot-progress.md`. As of 2026-05-05, all six are on the
  v2.1 SSE surface in remote builds (each component dual-mounts `useAgent`
  alongside `useAi` and switches on `environment.aiUseLocalEngine`). `useAi`
  remains the local-engine fallback path.
- Triage nudges are subject to PRD AC-V14 inbox rules in `useAgent.ts`:
  `NUDGE_INBOX_MAX = 5`, dedup by `(kind, project_id)`, `NUDGE_EXPIRY_MS = 4h`,
  60-second prune sweep, plus an explicit `dismissNudge(nudge_id)` API. The
  pure `reduceNudgeInbox` reducer is exported for unit tests.
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

## Deployment

### Required env vars for production

| Variable                                  | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_AI_BASE_URL`                   | Optional. When set, must be an absolute `https://` URL (or `http:` in dev). Validated at module load; invalid URLs fall back to the local engine. Trailing slashes are trimmed. **When unset**, deployed builds default `aiBaseUrl` to `apiOrigin` so they reach the backend without this var. Set `REACT_APP_AI_USE_LOCAL=true` to force the local engine instead.          |
| `REACT_APP_AI_MUTATION_PROPOSALS_ENABLED` | Defaults **`false`**. Set to `true` to render `MutationProposalCard` in `AiChatDrawer`. **Do not enable in production until the BE `MutationProposal` lifecycle ships** — with the flag off the card is fully suppressed even if an agent emits a `pendingProposal`. See `docs/FRONTEND_PRODUCTION_READINESS.md` §1 for the GA-blocker status.                               |
| `VITE_ANALYTICS_ENDPOINT`                 | Full URL for batched analytics POSTs. **Without this, every `track()` call is silently dropped in production** — `devMemorySink` (in-memory) is the only active sink. In production builds a `console.warn` fires at startup when this var is unset; warnings are also exposed at `window.__copilotObservabilityWarnings__`. De-facto required for production observability. |
| `VITE_ERROR_REPORT_ENDPOINT`              | Full URL for error event POSTs. **Without this, `ErrorBoundary` exceptions and AI error events are never reported.** In production builds a `console.warn` fires at startup when this var is unset (see `window.__copilotObservabilityWarnings__`). De-facto required for production error visibility.                                                                       |

### CDN cache-purge — required for the deploy that lands `a59539f`

Commit `a59539f` migrates FE tool args from camelCase to snake_case (`task_id`,
`project_id`). This is a **breaking change** for any user holding a pre-merge
bundle: the agent will send snake_case args that the old FE tool registry does not
recognise, causing silent `useAgent` interrupt failures.

Vite asset hashing handles JS chunks automatically. However, proxies and CDNs
(Cloudflare, CloudFront, etc.) cache `index.html` separately. **Explicitly purge
`index.html`** on the CDN after this deploy so browsers fetch the new bundle
reference. This only applies to the deploy that first lands `a59539f`; subsequent
deploys are clean.

### Smoke tests (FE-side)

After deploying, verify:

- Force a `402` response from the AI proxy → browser renders a `budget` typed error with no retry button.
- Force `403` → `forbidden` typed error.
- Force `429` → `rateLimit` typed error with countdown-disabled retry button.
- Force `5xx` → `server` typed error with retry available.
- Open the board brief while connected to the agent server → SSE stream completes; citation chips show the correct source label (`task` or `column`).
- Open network tab → every AI request carries an `Idempotency-Key` header.
- Call `POST /api/v1/ai/readiness` with a minimal valid JSON body (e.g. `{"task": {"title": "test"}, "project_id": "proj_x"}`) → response JSON contains an `issues` array where no entry has a `null` value for its `suggestion` field.

### Companion server prereqs

The Python server (now in this monorepo at `backend/`) requires Redis and Postgres
backends plus its own multi-worker env-var configuration before it can serve agent
traffic. See `backend/docs/deployment.md` for that checklist. Do not duplicate it
here.

---

## Cursor Cloud specific instructions

- This is a Vite React SPA. Standard scripts live in `package.json`; `npm start`
  serves the app on port 3000.
- Browser E2E in Cursor Cloud should not depend on the default remote API:
  `https://pulse-python-server.vercel.app` can return 403 from this environment,
  and the checked-in `__json_server_mock__` data is stale relative to the
  current `/api/v1` frontend contract. Use Playwright route mocks or an
  API-compatible local mock when exercising authenticated project and board
  flows.
- If changing `REACT_APP_API_URL`, restart Vite because `vite.config.ts` inlines
  the value into `process.env.REACT_APP_API_URL`.
- The full Jest suite (142 suites / ~980 tests) completes in ~90-100 s when run
  with `NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles`.
  Without the heap bump and `--forceExit`, the suite may hang or OOM on this VM.
- Node.js 24 is required (`.nvmrc`). Load nvm before running any npm/node
  command: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"`.
- The backend uses MongoDB 7 which must be running before the FastAPI server
  starts. The standard `--fork` command fails in Cursor Cloud due to a
  `/tmp/mongodb-27017.sock` permission error. Use a config file that disables
  the Unix socket:
    ```bash
    cat > /tmp/mongod.conf <<EOF
    net:
      bindIp: 127.0.0.1
      port: 27017
      unixDomainSocket:
        enabled: false
    storage:
      dbPath: /data/db
    EOF
    mongod --config /tmp/mongod.conf &
    ```
    Run it in a background tmux session or with `&`; wait ~2 s before hitting
    the port.
- Backend `.env` needs `MONGO_URI=mongodb://localhost:27017/jira` and a `UUID`
  of ≥32 characters. Copy from `.env.example` and update those values.
- Backend tests (801 passing, `python -m pytest` from `backend/`) use in-memory
  fakes and do NOT require MongoDB. Install with `pip install -e ".[dev,ai]"`.
- The frontend's remote API (`https://pulse-python-server.vercel.app`) works from
  this environment for basic CRUD (registration, login, projects, tasks). The
  local backend at `:8000` is a full alternative; set
  `REACT_APP_API_URL=http://localhost:8000` in `.env.development` to use it
  (requires Vite restart).
