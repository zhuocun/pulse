# Non-GA backlog slices (discovery 2026-05-10)

Excludes GA Blocker §1 (`MutationProposal` accept/undo end-to-end) — that gates public GA and stays explicit product work.

Prioritized quick wins wired as worker tasks:

| Source | Item | Repo signal |
|--------|------|-------------|
| `docs/status/release-todo.md` §16d | Docker compose parity for Redis-backed middleware | `backend/docker-compose.yml` sets `RATE_LIMIT_BACKEND`, `BUDGET_BACKEND`; **missing `IDEMPOTENCY_BACKEND`** next to REDIS_URI |
| `docs/status/release-todo.md` §16e | Fly placeholder app name | `backend/fly.toml` line `app = "jira-python-server"` |
| `docs/status/ui-todo.md` §20f | `CopilotShell` hard-coded English | `src/components/copilotShell/index.tsx` |
| `docs/status/release-todo.md` §14 | FE does not consume `AgentMetadata.rate_limit`, `allowed_autonomy`, etc. | Wire minimally into existing Copilot/agent health UX without breaking tests |

Excluded from this sprint (remain open / future workers): Beta §2/§3/§6, Soft §4/§5 remainder, MCP §15, `useAgent` split §16b, LiteLLM, proxy JWT migration, GA §1.

## Wave 2 — 2026-05-10 (planner `bc-ef458bd7-de29-4d59-a77f-43f2b0cdb654`)

| Source | Item | Worker task |
|--------|------|-------------|
| `docs/status/release-todo.md` §7 | Doc still reads as if only path-filter runs exist; `workflow_dispatch` now ships | `release-ci7-dispatch-documentation` |
| `docs/status/release-todo.md` §16d | Dockerfile lacks explicit Redis-backed middleware env guidance next to `workers=1` pin | `dockerfile-redis-backend-hints` |
| `docs/status/ui-todo.md` §21 | Decorative task-type SVGs on cards | `column-decorative-svg-a11y` |

## Wave 3 — 2026-05-10 (planner `bc-9bc499b0-ccea-4cf8-a9d2-1b1d925e528b`, model `gpt-5.3-codex-high-fast`)

| Source | Item | Worker task |
|--------|------|-------------|
| `docs/status/release-todo.md` §16b / `architecture-todo.md` Theme 3 | `useAgent.ts` is a 1,010-line monolith; nudge-inbox already has an exported reducer; finish the move | `useagent-nudge-inbox-extract` |
| `docs/status/ui-todo.md` §14 + §19 remaining | Members popover refetches on open and lacks avatars / count | `members-popover-avatars-cache` |
| `docs/status/ui-todo.md` Phase 3.5 / 2.A.7 | AI surfaces flash spinners on fast local-engine responses | `throttled-spinners-hook` |
| `docs/status/ui-todo.md` Phase 3.1 / §17 | Microcopy / casing inconsistencies (`Login`/`Register` etc.) | `microcopy-casing-sweep` |
| `docs/status/release-todo.md` §14 polish extension | Other `AgentMetadata` fields still unsurfaced (`recursion_limit`, `tags`) | `agent-metadata-recursion-tags-about` |
| `docs/status/ui-todo.md` Phase 3.4 / 2.A.9 (WCAG 2.5.7) | Drag-and-drop keyboard alternative is undiscoverable on task cards | `drag-keyboard-affordance-hint` |

## Status hygiene

After closing an item referenced in `docs/status/*`, follow repo root **`AGENTS.md`**: strike or edit the `-todo.md` row and append a shipped line under `docs/status/product-done.md`.
