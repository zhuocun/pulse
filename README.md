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

## Stack

Stack: React 19 + Vite + Redux Toolkit + React Query + AntD + Emotion.
Backend: FastAPI + LangGraph. See `package.json` / `backend/pyproject.toml`
for full deps.

## Board Copilot (AI features)

This app ships an AI assistant called **Board Copilot** with six capabilities: smart task drafting, story-point estimation + readiness check, board brief, conversational Q&A, semantic search, and a triage inbox. AI surfaces are opt-out (gated by `REACT_APP_AI_ENABLED` plus a per-browser runtime toggle persisted in `localStorage` under `boardCopilot:enabled`).

A deterministic in-browser local engine derives suggestions from the React Query cache and runs with **no backend, no API key, and no network call**. Deployed builds default `aiBaseUrl` to the API origin so the FE reaches the v2.1 agent server (`POST /api/v1/agents/{name}/stream`) without extra configuration; set `REACT_APP_AI_BASE_URL` to a different origin or `REACT_APP_AI_USE_LOCAL=true` to override. **Never put the model key in the client bundle.**

For the binding wire contract see [`docs/prd/v2.1-agent.md`](docs/prd/v2.1-agent.md); for the UX layer on top see [`docs/prd/v3-ai-ux.md`](docs/prd/v3-ai-ux.md); for what has shipped vs what is open see [`docs/todo/product-done.md`](docs/todo/product-done.md) and [`docs/todo/release-todo.md`](docs/todo/release-todo.md). Full FE integration reference (env vars, hooks, mock server, local-engine fallback) lives in [`docs/api/frontend.md`](docs/api/frontend.md); contributor gotchas around the `useAgent` hook are documented in [`AGENTS.md`](AGENTS.md).

