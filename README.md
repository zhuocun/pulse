# jira-react-app

`jira-react-app` is a React-based front-end application for a Jira-like project management tool. This app provides a user-friendly interface for managing tasks, projects, and team collaborations.

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

This app ships an AI assistant called **Board Copilot** with five capabilities:

- **Smart task drafting** in the create-task flow (a "Draft with AI" button next to `+ Create task`).
- **Story-point estimation and readiness check** inside the edit-task modal.
- **Board summary / standup brief** opened from the `Brief` button in the board header.
- **Ask Board Copilot** — conversational Q&A from the `Ask` button on the board or project list (read-only project data via tool calls locally; optional remote `/api/ai/chat` when `REACT_APP_AI_BASE_URL` is set).
- **Semantic search** — natural-language search on the board and project list (local token ranking, or optional remote `POST …/api/ai/search` when `REACT_APP_AI_BASE_URL` is set). Results combine with existing text filters; use **Clear AI search** to drop only the semantic filter.

All AI features are **opt-out**: the existing flows are unchanged, and AI surfaces are gated by a single env flag and a runtime user toggle (persisted in `localStorage` under `boardCopilot:enabled`).

### Backend

Board Copilot has two backends:

1.  **Local engine (default).** A deterministic in-browser engine derives all suggestions from the React Query caches that already exist in the app (project tasks, columns, members). It works with **no backend, no API key, and no network call**, which is how the FE is shipped today.
2.  **Remote proxy (optional).** If `REACT_APP_AI_BASE_URL` is set, the hook posts the same payload to `${REACT_APP_AI_BASE_URL}/api/ai/<route>` instead. The expected route handler should hold the LLM key, return a JSON response shaped according to `src/interfaces/ai.d.ts`, and follow the contract in `docs/prd/board-copilot.md`. **Never put the model key in the client bundle.**

### Environment variables

| Variable                     | Default | Effect                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REACT_APP_AI_ENABLED`       | `true`  | Set to `false` at build time to hide every AI surface and bypass the hook. Also supports `VITE_AI_ENABLED` (see Vite note below).                                                                                                                                                                                                                                |
| `REACT_APP_AI_BASE_URL`      | empty   | When non-empty, AI calls go to `${...}/api/ai/<route>`. Empty = local engine. Also supports `VITE_AI_BASE_URL`. Validated at module load: `javascript:`, `file:`, `data:`, and malformed URLs are rejected and fall back to the local engine. Trailing slashes are trimmed.                                                                                      |
| `VITE_ANALYTICS_ENDPOINT`    | empty   | Full URL for batched analytics POSTs. When set, `httpAnalyticsSink` is wired from `src/index.tsx`. **Required for production observability** — without this every analytics event (`COPILOT_REWRITE_ACCEPT`, `nudge.*`, etc.) is silently dropped. The fallback is an in-memory sink that writes to `window.__copilotEvents__` and does not survive page reload. |
| `VITE_ERROR_REPORT_ENDPOINT` | empty   | Full URL for error event POSTs. When set, `ErrorBoundary` reports caught errors to this endpoint. **Required for production error visibility** — without this, AI surface exceptions are never reported outside the browser console.                                                                                                                             |

Vite inlines `process.env.REACT_APP_*` at build time via `vite.config.ts`. You may use `VITE_AI_BASE_URL` / `VITE_AI_ENABLED` in `.env` files as aliases; they map to the same client bundle flags.

The runtime toggle (per browser) overrides nothing about availability — it only lets a user disable AI on top of an already-enabled build.

### Validation and safety

Every model-supplied identifier (`columnId`, `coordinatorId`, similar `taskId`s) is cross-checked against the React Query cache before any UI action; unknown ids are dropped or replaced with safe defaults. Story points are clamped to `1/2/3/5/8/13`. AI suggestions are advisory only — every write to the board still goes through the user clicking Submit and the existing `useReactMutation` plumbing.

For the full design, see [docs/prd/board-copilot.md](docs/prd/board-copilot.md). For what has shipped vs what is still open, see [docs/prd/board-copilot-progress.md](docs/prd/board-copilot-progress.md). For a section-by-section design vs implementation review with file/line evidence, see [docs/prd/board-copilot-review.md](docs/prd/board-copilot-review.md).

For the **v2.1 redesign** of the AI features — named LangGraph agents over the existing `POST /api/v1/agents/{name}/stream` endpoint, a simplified autonomy dial, Action History + toast Undo, a triage Inbox, a `Cmd/Ctrl+K` palette, MCP compatibility, and server-side redaction — see [docs/prd/board-copilot-v2.1-agent.md](docs/prd/board-copilot-v2.1-agent.md). The prior v2 draft is retained at [docs/prd/board-copilot-v2-agent.md](docs/prd/board-copilot-v2-agent.md) for historical context. The v1 local engine remains the read-only fallback when the agent server is unreachable.

## Board Copilot v2.1 (Phase A scaffolding)

Phase A wires the FE plumbing for the v2.1 agent without changing the v1 surfaces:

- **LangGraph v2 streaming client** at `src/utils/ai/agentClient.ts` parses Server-Sent `StreamPart` events (`updates`, `messages`, `custom`, `interrupt`, `error`) and maps non-OK responses to typed errors (`AgentTransportError`, `AgentAuthError`, `AgentRateLimitError`, `AgentBudgetError`, `AgentNotFoundError`, `AgentServerError`). Sends `Idempotency-Key` on every request. The wire types are in `src/interfaces/agent.d.ts`.
- **FE tool registry** at `src/utils/ai/feTools/` exposes 11 read-only tools (`fe.listProjects`, `fe.boardSnapshot`, `fe.viewerContext`, …) backed by the existing React Query cache. Tool args use snake_case (`task_id`, `project_id`) to match BE schemas. They are invoked when the agent emits an `interrupt` event whose tool is in the registry.
- **`useAgent` hook** at `src/utils/hooks/useAgent.ts` drives a turn end-to-end, reduces stream parts into UI state, persists `thread_id` per `(name, project)`, and auto-resumes on FE-tool interrupts. `start()` enforces per-project AI opt-out before opening the SSE stream.
- **Command palette** at `src/components/commandPalette/` opens with `Cmd/Ctrl+K`, indexes the cache for navigation, and renders an ARIA combobox + listbox. AI mode (`Tab` / `/` prefix) shows a Phase E placeholder.
- **Autonomy level** persisted via `useAutonomyLevel` (in `src/utils/hooks/useAiEnabled.ts`) under `boardCopilot:autonomy` (`suggest` / `plan` / `auto`, default `plan`). The legacy `useAiEnabled` toggle is unchanged.
- **Analytics constants** at `src/constants/analytics.ts` (events `agent.*`, `nudge.*`, `palette.*`, `agent.feedback.*`). Observability sinks at `src/utils/observability/sinks.ts` — configure `VITE_ANALYTICS_ENDPOINT` and `VITE_ERROR_REPORT_ENDPOINT` to enable production event collection.

### Environment

`REACT_APP_AI_BASE_URL` keeps the same semantics: empty means the v1 local engine is the source of truth; non-empty points at a LangGraph server that exposes `/api/v1/agents/{name}/stream`, `/invoke`, `/api/v1/agents`, `/api/v1/agents/{name}`, and `/api/v1/health`. The v1 `useAi` / `useAiChat` hooks remain the fallback path when the v2.1 agent server is unreachable.

### Developing with Board Copilot

- Run the app with `REACT_APP_AI_BASE_URL` unset to drive every AI surface from the deterministic local engine.
- Set `REACT_APP_AI_BASE_URL=http://localhost:8000` (or your agent server) to switch the v1 surfaces to the remote proxy. Phase B will start using `useAgent` for the chat surface.
- Toggle Board Copilot for the current browser via `localStorage.setItem("boardCopilot:enabled", "false")`. Toggle the autonomy with `localStorage.setItem("boardCopilot:autonomy", "auto" | "plan" | "suggest")`.
- Open the command palette in Storybook-less dev with `Cmd/Ctrl+K`. The `commandPalette:open` window event is dispatched on the shortcut so any future host shell can mount the palette lazily.
- All new components have `jest-axe` accessibility coverage; `npm test` runs the suite alongside the v1 tests.
