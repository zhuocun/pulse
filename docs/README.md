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

## Design

- [`design/ai-ux-best-practices.md`](design/ai-ux-best-practices.md)
  — research reference (Google PAIR, Microsoft HAX, NN/g, NIST AI
  RMF, etc.).
- [`design/mobile-native-best-practices.md`](design/mobile-native-best-practices.md)
  — mobile responsive patterns and red flags.
