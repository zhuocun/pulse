# pulse

`pulse` is a React-based front-end application for a Jira-like project management tool. This app provides a user-friendly interface for managing tasks, projects, and team collaborations.

## Monorepo layout

This repository hosts both the React frontend and the Python (FastAPI) backend that previously lived in `zhuocun/jira-python-server`:

- `/` — React + Vite frontend (this README, `package.json`, `src/`, `vite.config.ts`, root `vercel.json`).
- `backend/` — FastAPI server (`backend/app`, `backend/api`, `backend/pyproject.toml`, `backend/Dockerfile`, `backend/fly.toml`, `backend/vercel.json`). See `backend/README.md` for backend-specific docs.

### Common tasks

Run from the repository root:

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm start`            | Vite dev server on `:3000`.                             |
| `npm run backend:dev`  | Uvicorn auto-reload on `:8000` (`cd`s into `backend/`). |
| `npm test`             | FE Jest suite.                                          |
| `npm run backend:test` | BE pytest suite (100% coverage gate).                   |

### Deployments

Both apps deploy through Vercel's GitHub integration on every push to the tracked branch — no GitHub secrets, no `flyctl` token, no CI workflow to babysit.

| Target            | How it deploys                                                                                                                                                                                       | Configured?         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Frontend → Vercel | Push to the FE Vercel project's tracked branch. Root `.vercelignore` keeps `backend/` out of the build; root `vercel.json` `ignoreCommand` skips the FE rebuild when only `backend/` changed.        | ✅ in repo          |
| Backend → Vercel  | Push to the BE Vercel project's tracked branch. `backend/vercel.json` `ignoreCommand` skips the BE rebuild when nothing under `backend/` changed. Project must have **Root Directory = `backend/`**. | ⚠️ see manual steps |
| Backend CI        | `.github/workflows/backend-ci.yml`, scoped to `backend/**`, runs from `backend/`.                                                                                                                    | ✅ in repo          |

`backend/Dockerfile` and `backend/fly.toml` are kept as a fallback — anyone can `cd backend && fly deploy` from a Fly-authenticated machine — but they're not on the active deploy path.

### Post-merge verification checklist

- [ ] FE Vercel project still builds and serves the app at its existing URL.
- [ ] BE Vercel project, after the Root Directory change, builds and `GET /api/v1/health` returns 200.
- [ ] `Backend CI` workflow runs green on a PR that touches `backend/**`.
- [ ] FE-only and BE-only PRs trigger only the relevant Vercel project (verify in the Vercel deployments tab).

## Technologies

The project utilizes the following technologies:

- **React**: A JavaScript library for building user interfaces, used as the main UI library.
- **Redux**: A predictable state container for JavaScript apps, used for managing the application state.
- **React-Query**: A data-fetching library for React, used for fetching, caching, and syncing server data in the app.
- **Ant Design**: A popular design system and UI library for React, used for building the application components.
- **Emotion**: A CSS-in-JS library (`@emotion/react`, `@emotion/styled`) for styling components.
- **Hello Pangea DnD**: A drag-and-drop library for React, used for implementing drag-and-drop functionality.
- **React Router**: A collection of navigational components for creating single-page applications with navigation.

## Configuration

This project uses a combination of dependencies and devDependencies to ensure smooth development and efficient production builds. Some of the key packages include:

- **Vite**: A development server and production bundler used for local development and production builds.
- **eslint**: A pluggable JavaScript linter used for identifying and reporting patterns in code.
- **prettier**: An opinionated code formatter for consistent code style across the project.
- **husky**: A tool for managing Git hooks, ensuring code quality before committing changes.
- **lint-staged**: A package to run linters on Git staged files, used in conjunction with Husky for pre-commit checks.

The project is configured with scripts to streamline the development process, including scripts for starting the app, building production bundles, running tests, and performing pre-commit checks.

For a full list of dependencies, please refer to the `package.json` file.

## Board Copilot (AI features)

This app ships an AI assistant called **Board Copilot** with six capabilities:

- **Smart task drafting** in the create-task flow (a "Draft with AI" button next to `+ Create task`).
- **Story-point estimation and readiness check** inside the edit-task modal.
- **Board summary / standup brief** opened from the `Brief` button in the board header.
- **Ask Board Copilot** — conversational Q&A from the `Ask` button on the board or project list (read-only project data via local tools, or v2.1 SSE `chat-agent` in remote builds).
- **Semantic search** — natural-language search on the board and project list (local token ranking, or v2.1 SSE `search-agent` in remote builds). Results combine with existing text filters; use **Clear AI search** to drop only the semantic filter.
- **Triage inbox** — drift-signal nudges (`unowned_bug`, `wip_overflow`, `stale_task`) surfaced via `triage-agent` with cap-5, dedup, 4-hour expiry, and dismiss propagation (v2.1).

All AI features are **opt-out**: the existing flows are unchanged, and AI surfaces are gated by a single env flag and a runtime user toggle (persisted in `localStorage` under `boardCopilot:enabled`).

### Backend

Board Copilot has two backends:

1.  **Local engine (dev/test default).** A deterministic in-browser engine derives suggestions from the React Query caches that already exist in the app (project tasks, columns, members). It works with **no backend, no API key, and no network call**.
2.  **Remote agent server (deployed default).** In deployed builds with `REACT_APP_AI_USE_LOCAL` unset, `aiBaseUrl` defaults to the API origin and the frontend uses `/api/v1/agents/{name}/stream` for the v2.1 agents. `REACT_APP_AI_BASE_URL` can point at a separate agent origin. The v1 JSON routes remain as local-engine fallback compatibility paths. **Never put the model key in the client bundle.**

### Environment variables

| Variable                     | Default | Effect                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_AI_ENABLED`       | `true`  | Set to `false` at build time to hide every AI surface and bypass the hook. Also supports `VITE_AI_ENABLED` (see Vite note below).                                                                                                                                                                                                                                |
| `REACT_APP_AI_BASE_URL`      | —       | When non-empty, remote AI calls use this origin for v2.1 agent endpoints such as `/api/v1/agents/{name}/stream` (highest priority). Validated at module load: `javascript:`, `file:`, `data:`, and malformed URLs are rejected and fall back to the local engine. Trailing slashes are trimmed. Also supports `VITE_AI_BASE_URL`.                                |
| `REACT_APP_AI_USE_LOCAL`     | —       | Set to `"true"` to force the local deterministic engine. Takes effect when `REACT_APP_AI_BASE_URL` is unset. `.env.development` sets this automatically, so `npm start` always uses the local engine. Jest also short-circuits to local regardless of this flag.                                                                                                 |
| (neither set)                | —       | Deployed builds default `aiBaseUrl` to the same origin as `REACT_APP_API_URL`, so they reach the backend without any additional configuration. Use `REACT_APP_AI_USE_LOCAL=true` to opt out.                                                                                                                                                                     |
| `VITE_ANALYTICS_ENDPOINT`    | empty   | Full URL for batched analytics POSTs. When set, `httpAnalyticsSink` is wired from `src/index.tsx`. **Required for production observability** — without this every analytics event (`COPILOT_REWRITE_ACCEPT`, `nudge.*`, etc.) is silently dropped. The fallback is an in-memory sink that writes to `window.__copilotEvents__` and does not survive page reload. |
| `VITE_ERROR_REPORT_ENDPOINT` | empty   | Full URL for error event POSTs. When set, `ErrorBoundary` reports caught errors to this endpoint. **Required for production error visibility** — without this, AI surface exceptions are never reported outside the browser console.                                                                                                                             |

Vite inlines `process.env.REACT_APP_*` at build time via `vite.config.ts`. You may use `VITE_AI_BASE_URL` / `VITE_AI_ENABLED` in `.env` files as aliases; they map to the same client bundle flags.

The runtime toggle (per browser) overrides nothing about availability — it only lets a user disable AI on top of an already-enabled build.

### Validation and safety

Every model-supplied identifier (`columnId`, `coordinatorId`, similar `taskId`s) is cross-checked against the React Query cache before any UI action; unknown ids are dropped or replaced with safe defaults. Story points are clamped to `1/2/3/5/8/13`. AI suggestions are advisory only — every write to the board still goes through the user clicking Submit and the existing `useReactMutation` plumbing. Note: there is an open privacy-copy alignment item — several routes (estimate, search, chat) include `task.note` in their payloads while the UI currently displays "no notes shared"; see [`docs/archive/ai-ux-optimization-plan.md` §P0-1](docs/archive/ai-ux-optimization-plan.md) for the original audit (resolved/in-flight items now tracked in [`docs/prd/v3-ai-ux.md`](docs/prd/v3-ai-ux.md)).

For the full design, see [docs/prd/v2.1-agent.md](docs/prd/v2.1-agent.md) (the original v1 design has been archived to [docs/archive/prd-v1.md](docs/archive/prd-v1.md)). For what has shipped vs what is still open, see [docs/prd/changelog.md](docs/prd/changelog.md) and [docs/operations/production-readiness.md](docs/operations/production-readiness.md).

For the **v2.1 redesign** of the AI features — named LangGraph agents over the existing `POST /api/v1/agents/{name}/stream` endpoint, a simplified autonomy dial, Action History + toast Undo, a triage Inbox, a `Cmd/Ctrl+K` palette, MCP compatibility (deferred — see [`docs/operations/production-readiness.md`](docs/operations/production-readiness.md)), and server-side redaction — see [docs/prd/v2.1-agent.md](docs/prd/v2.1-agent.md). The v1 local engine remains the read-only fallback when the agent server is unreachable.

## Board Copilot v2.1 (Phase A scaffolding)

Phase A wires the FE plumbing for the v2.1 agent without changing the v1 surfaces:

- **LangGraph v2 streaming client** at `src/utils/ai/agentClient.ts` parses Server-Sent `StreamPart` events (`updates`, `messages`, `custom`, `interrupt`, `error`) and maps non-OK responses to typed errors (`AgentTransportError`, `AgentAuthError`, `AgentRateLimitError`, `AgentBudgetError`, `AgentNotFoundError`, `AgentServerError`). Sends `Idempotency-Key` on every request. The wire types are in `src/interfaces/agent.d.ts`.
- **FE tool registry** at `src/utils/ai/feTools/` exposes 12 read-only tools (`fe.listProjects`, `fe.boardSnapshot`, `fe.viewerContext`, …) backed by the existing React Query cache. Tool args use snake_case (`task_id`, `project_id`) to match BE schemas. They are invoked when the agent emits an `interrupt` event whose tool is in the registry. Of these 12, six (`listProjects`, `listMembers`, `getProject`, `listBoard`, `listTasks`, `getTask`) are wire-bound to the chat-agent via `chatTools.ts`; the other six (`boardSnapshot`, `viewerContext`, `recentActivity`, `formDraft`, `similarTasks`, `searchCandidates`) are FE-only helpers available for future agent use.
- **`useAgent` hook** at `src/utils/hooks/useAgent.ts` drives a turn end-to-end, reduces stream parts into UI state, persists `thread_id` per `(name, project)`, and auto-resumes on FE-tool interrupts. `start()` enforces per-project AI opt-out before opening the SSE stream.
- **Command palette** at `src/components/commandPalette/` opens with `Cmd/Ctrl+K`, indexes the cache for navigation, and renders an ARIA combobox + listbox. AI mode (`Tab` / `/` prefix) shows a Phase E placeholder.
- **Autonomy level** persisted via `useAutonomyLevel` (in `src/utils/hooks/useAiEnabled.ts`) under `boardCopilot:autonomy` (`suggest` / `plan` / `auto`, default `plan`). `useAgent` subscribes to this value so `autonomyRef` tracks the live setting — it is no longer hard-coded to `"plan"`. An Ant Design `Select` selector in the `AiChatDrawer` extra slot lets users change the level in-app; the choice is persisted immediately. **Note: the "Auto" option is disabled in v2.1 and renders with an explanatory tooltip ("Auto requires an agent that supports preapproved tools. Available in v3.") until v3 preapproved-tools work ships.** The legacy `useAiEnabled` toggle is unchanged.
- **Analytics constants** at `src/constants/analytics.ts` (events `agent.*`, `nudge.*`, `palette.*`, `agent.feedback.*`). Observability sinks at `src/utils/observability/sinks.ts` — configure `VITE_ANALYTICS_ENDPOINT` and `VITE_ERROR_REPORT_ENDPOINT` to enable production event collection.
- **Triage-nudge inbox rules** (PRD AC-V14) live in `useAgent` and apply to every `custom/nudge` event: cap-5 active per board, dedup by `(kind, project_id)` so the newer card supersedes the older, 4-hour expiry with a 60s prune sweep, and an explicit `dismissNudge(nudge_id)` API for user-initiated removals. `BoardPage` wires `onActionNudge` (resolves first task-shaped `target_id` against the in-cache task list and opens the task modal; non-task targets no-op gracefully) and `onDismissNudge` into `AiChatDrawer` for the `triage-agent` mount.
- **Structured-route migration progress.** All six structured routes — chat, `board-brief`, `task-draft`, `task-breakdown`, `estimate`, `readiness`, `search` — are on the v2.1 SSE surface in remote builds (each component dual-mounts `useAgent` alongside the legacy `useAi` hook and switches on `environment.aiUseLocalEngine`). `useAi` now serves as the local-engine fallback path. See the migration row in `docs/prd/changelog.md` for detail.

### Environment

`REACT_APP_AI_BASE_URL` points at a LangGraph server that exposes `/api/v1/agents/{name}/stream`, `/invoke`, `/api/v1/agents`, `/api/v1/agents/{name}`, and `/api/v1/health`. When it is unset, dev/test use the local engine while deployed builds default the agent base URL to the API origin unless `REACT_APP_AI_USE_LOCAL=true` is set. The v1 `useAi` / `useAiChat` hooks remain the local fallback path.

### Developing with Board Copilot

- Run `npm start` with the checked-in `.env.development` to drive every AI surface from the deterministic local engine.
- Set `REACT_APP_AI_BASE_URL=http://localhost:8000` (or your agent server) to use the remote agent. In remote mode `AiChatDrawer` uses `useAgentChat` (backed by `useAgent("chat-agent")`) for SSE streaming; the v1 `useAiChat` path remains active in local mode.
- Toggle Board Copilot for the current browser via `localStorage.setItem("boardCopilot:enabled", "false")`. Toggle the autonomy with `localStorage.setItem("boardCopilot:autonomy", "auto" | "plan" | "suggest")`.
- Open the command palette in Storybook-less dev with `Cmd/Ctrl+K`. The `commandPalette:open` window event is dispatched on the shortcut so any future host shell can mount the palette lazily.
- All new components have `jest-axe` accessibility coverage; `npm test` runs the suite alongside the v1 tests.
