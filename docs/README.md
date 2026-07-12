# Pulse documentation

Navigation index for everything under `docs/`. Project-level overview
lives in the repo root [`README.md`](../README.md); contributor
gotchas live in [`AGENTS.md`](../AGENTS.md).

## API

- [`api/backend.md`](api/backend.md) — HTTP API reference for the
  FastAPI server (auth, users, projects, boards, tasks, AI v1 shim,
  v2.1 agents SSE).
- [`api/frontend.md`](api/frontend.md) — FE integration layer:
  hooks, utilities, env vars, mock server, local-engine fallback.

## Product / PRD

- [`prd/core-collaboration.md`](prd/core-collaboration.md) — the non-AI
  product core (as-built): projects + RBAC/membership, boards + WIP
  limits, rich tasks (dates, labels, assignees, sub-tasks) + bulk edit,
  labels, comments + @mentions, notifications. The substrate the AI
  PRDs build on; includes an honest frontend-coverage map.
- [`prd/work-management-depth.md`](prd/work-management-depth.md) —
  proposed (net-new) work-management depth: task priority,
  dependencies/blockers, lifecycle + archive/trash, recurring tasks,
  project/task templates, custom fields, milestones/iterations,
  alternate views (list/table/calendar/timeline) + swimlanes, and
  AI-assisted prioritization, dependency hints, and duplicate detection.
- [`prd/collaboration-notifications.md`](prd/collaboration-notifications.md)
  — proposed collaboration & notifications depth:
  watchers/subscriptions, broader notification kinds + `actorId` +
  per-kind preferences, email/web-push delivery, comment
  reactions/threads/edit-history, and a per-task activity timeline.
- [`prd/accounts-organizations.md`](prd/accounts-organizations.md) —
  proposed accounts & multi-tenancy: first-class
  organizations/workspaces, teams, invite-by-email onboarding, guest
  role + public read-only share links, account/profile management, and
  an enterprise platform horizon.
- [`prd/v2.1-agent.md`](prd/v2.1-agent.md) — current backend / wire
  contract: named LangGraph agents, two-level autonomy, FE↔BE tool
  calling via interrupts.
- [`prd/v3-ai-ux.md`](prd/v3-ai-ux.md) — UX layer on top of v2.1:
  trust calibration, citations, command palette, mutation previews.

## Status — what's done, what's next

Tracking docs grouped under `todo/`. Forward-looking docs follow
`<scope>-todo.md`; the shipped-work doc is `<scope>-done.md`. Survey
the whole backlog without folder-hopping.

- [`todo/release-todo.md`](todo/release-todo.md) — GA blockers,
  soft blockers, polish, and the recommended internal-beta →
  design-partner → public ship sequence.
- [`todo/ui-todo.md`](todo/ui-todo.md) — phased UI plan
  (foundations, surfaces, polish, stretch).
- [`todo/product-done.md`](todo/product-done.md) — implementation
  changelog: what has shipped, per-feature inventory,
  acceptance-criteria status.
- [`todo/feature-build-progress.md`](todo/feature-build-progress.md) —
  dependency-ordered milestone tracker for the collaboration/completeness
  build-out: M1–M4 shipped (documented as-built in
  [`prd/core-collaboration.md`](prd/core-collaboration.md)); M5–M8 are the
  forward roadmap.
- [`todo/prd-gap-todo.md`](todo/prd-gap-todo.md) — consolidated,
  adversarially reviewed PRD-gap backlog (actionable tasks with acceptance
  criteria, tiers P0–P3); complements the milestone trackers above.

## Operations

- [`operations/small-group-quickstart.md`](operations/small-group-quickstart.md)
  — friendliest on-ramp: get Pulse + AI features running for ~5 users
  (Fly BE + Vercel FE recommended; all-Vercel path documented with
  caveats). Skips observability, multi-instance hardening, and vector
  search.
- [`operations/deployment.md`](operations/deployment.md) — production
  deployment guide (Vercel limits, Fly.io, Render, ECS / Cloud Run /
  Container Apps, dedicated uvicorn behind nginx, FE env vars, CDN
  cache-purge, FE smoke tests, security considerations, post-deploy
  verification, boot-log signals).
- [`operations/testing.md`](operations/testing.md) — consolidated FE
  Jest / BE pytest / shared infra audit; ranked flaky-test suspects
  and recommended follow-ups.
- [`operations/cursor-cloud.md`](operations/cursor-cloud.md) — VM
  setup notes for Cursor Cloud (mongod, NVM, Jest heap bump).
- [`operations/agent-stream-resume.md`](operations/agent-stream-resume.md)
  — support/operator runbook for agent SSE resume, idempotency, and
  retries (`thread_id` vs `Idempotency-Key`, `409` / `422` triage).
- [`operations/pgvector-task-embeddings.sql`](operations/pgvector-task-embeddings.sql)
  — pgvector extension + `task_embeddings` table DDL for
  `AGENT_VECTOR_SEARCH_ENABLED`; includes the embeddings-provider
  enablement order and resumable backfill-script steps.
- [`operations/agent-memory.sql`](operations/agent-memory.sql) —
  `agent_memory` table DDL backing `PostgresMemoryStore`, the durable
  Board Copilot memory store (upsert-on-remember, project/user scope).
- [`operations/agent-budget-counter.sql`](operations/agent-budget-counter.sql)
  — `agent_budget_counter` table DDL backing `PostgresBudgetBackend`,
  the multi-worker-safe per-(project, month) token budget counter.

## Design

- [`design-tokens.md`](design-tokens.md) — contributor reference for the
  design system (space, radius, palette, typography, motion, z-index
  scales); implementation source of truth is `src/theme/tokens.ts`.
- [`design/ai-ux-best-practices.md`](design/ai-ux-best-practices.md)
  — research reference (Google PAIR, Microsoft HAX, NN/g, NIST AI
  RMF, etc.).
- [`design/desktop-ux-best-practices.md`](design/desktop-ux-best-practices.md)
  — comprehensive desktop web UX principles and actionable checklists
  for PM / kanban / collaboration SaaS (keyboard, multi-pane, tables,
  hover, bulk actions, keyboard-accessible DnD, auth/session,
  context menus, undo model).
- [`design/mobile-ux-best-practices.md`](design/mobile-ux-best-practices.md)
  — comprehensive mobile / responsive-web UX principles and checklists
  (PWA, touch, safe areas, virtual keyboard, thumb reach, passkeys,
  deep links, pull-to-refresh, offline conflict UX).
- [`design/mobile-native-best-practices.md`](design/mobile-native-best-practices.md)
  — Pulse-specific mobile mechanics and red flags (viewport meta,
  service worker, implementation status); complements
  `mobile-ux-best-practices.md`.
- [`design/modal-routing-policy.md`](design/modal-routing-policy.md) —
  adopted policy: new detail surfaces are routed (URL-addressable) by
  default; the `Dialog` primitive is reserved for ephemeral
  yes/no/cancel prompts.
- [`design/ui-ux-comprehensive-review-2026-05.md`](design/ui-ux-comprehensive-review-2026-05.md)
  — consolidated 2026-05 UI/UX audit (124 findings across six surface
  reports, 30 screenshots). The per-surface source reports under
  [`design/_review-2026-05/`](design/_review-2026-05/) are frozen
  point-in-time snapshots:
  - [`_review-2026-05/01-auth-and-projects.md`](design/_review-2026-05/01-auth-and-projects.md)
    — auth surfaces + projects list.
  - [`_review-2026-05/02-board-and-project-detail.md`](design/_review-2026-05/02-board-and-project-detail.md)
    — board, column/card, and project-detail shell.
  - [`_review-2026-05/03-modals-and-forms.md`](design/_review-2026-05/03-modals-and-forms.md)
    — modals + forms surfaces.
  - [`_review-2026-05/04-ai-copilot.md`](design/_review-2026-05/04-ai-copilot.md)
    — AI / Copilot surfaces (chat drawer, brief, task assist, drafts).
  - [`_review-2026-05/05-pwa-mobile-a11y-designsystem.md`](design/_review-2026-05/05-pwa-mobile-a11y-designsystem.md)
    — cross-cutting PWA, mobile shell, a11y, and design-system audit.
  - [`_review-2026-05/06-screenshot-audit.md`](design/_review-2026-05/06-screenshot-audit.md)
    — visual / Playwright screenshot audit (30 shots under
    `_review-2026-05/screenshots/`).
  - [`_review-2026-05/_capture/capture.mjs`](design/_review-2026-05/_capture/capture.mjs)
    — Playwright capture script that regenerated the audit screenshots.

## Related (outside `docs/`)

- [`backend/app/eval/README.md`](../backend/app/eval/README.md) —
  Board Copilot eval harness: LLM-as-judge outcome scoring layered on
  top of the backend structure tests (`python -m app.eval`).
