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

### Ad-hoc Vercel inspection

Deploys are Git-driven, so the Vercel CLI is not a project dependency. For one-off inspection (logs, env vars, deployment status) use `npx` instead of a global or dev-dep install:

```bash
npx vercel@latest login            # one-time, opens a browser
npx vercel@latest ls pulse         # recent deployments
npx vercel@latest logs <url>       # runtime logs for a deployment
npx vercel@latest inspect <url>    # build + routing details
npx vercel@latest env ls           # env vars (scope with --environment)
```

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

This app ships an AI assistant called **Board Copilot** with six capabilities: smart task drafting, story-point estimation + readiness check, board brief, conversational Q&A, semantic search, and a triage inbox. AI surfaces are opt-out (gated by `REACT_APP_AI_ENABLED` plus a per-browser runtime toggle persisted in `localStorage` under `boardCopilot:enabled`).

A deterministic in-browser local engine derives suggestions from the React Query cache and runs with **no backend, no API key, and no network call**. Deployed builds default `aiBaseUrl` to the API origin so the FE reaches the v2.1 agent server (`POST /api/v1/agents/{name}/stream`) without extra configuration; set `REACT_APP_AI_BASE_URL` to a different origin or `REACT_APP_AI_USE_LOCAL=true` to override. **Never put the model key in the client bundle.**

For the binding wire contract see [`docs/prd/v2.1-agent.md`](docs/prd/v2.1-agent.md); for the UX layer on top see [`docs/prd/v3-ai-ux.md`](docs/prd/v3-ai-ux.md); for what has shipped vs what is open see [`docs/todo/product-done.md`](docs/todo/product-done.md) and [`docs/todo/release-todo.md`](docs/todo/release-todo.md). Full FE integration reference (env vars, hooks, mock server, local-engine fallback) lives in [`docs/api/frontend.md`](docs/api/frontend.md); contributor gotchas around the `useAgent` hook are documented in [`AGENTS.md`](AGENTS.md).

