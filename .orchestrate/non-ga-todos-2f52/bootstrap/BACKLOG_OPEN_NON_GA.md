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

## Status hygiene

After closing an item referenced in `docs/status/*`, follow repo root **`AGENTS.md`**: strike or edit the `-todo.md` row and append a shipped line under `docs/status/product-done.md`.
