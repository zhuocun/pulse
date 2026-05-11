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
- [`todo/architecture-todo.md`](todo/architecture-todo.md) —
  agent-runtime themes (contract hardening, stream errors, mutation
  lifecycle, durable resume, FE simplification, BE
  intelligence/resilience) with phased execution.
- [`todo/ui-todo.md`](todo/ui-todo.md) — phased UI plan
  (foundations, surfaces, polish, stretch).
- [`todo/product-done.md`](todo/product-done.md) — implementation
  changelog: what has shipped, per-feature inventory,
  acceptance-criteria status.

## Operations

- [`operations/deployment.md`](operations/deployment.md) — production
  deployment guide (Vercel limits, Fly.io, Render, ECS / Cloud Run /
  Container Apps, dedicated uvicorn behind nginx, FE env vars, CDN
  cache-purge, FE smoke tests, security considerations, post-deploy
  verification, boot-log signals).
- [`operations/testing.md`](operations/testing.md) — consolidated FE
  Jest / BE pytest / shared infra audit; ranked flaky-test suspects
  and recommended follow-ups.
- [`operations/cursor-cloud.md`](operations/cursor-cloud.md) — VM
  setup notes for Cursor Cloud (mongod, NVM, Jest heap bump,
  vendored `cursor-sdk` / `orchestrate` skills).

## Design

- [`design/ai-ux-best-practices.md`](design/ai-ux-best-practices.md)
  — research reference (Google PAIR, Microsoft HAX, NN/g, NIST AI
  RMF, etc.).
- [`design/mobile-native-best-practices.md`](design/mobile-native-best-practices.md)
  — mobile responsive patterns and red flags.

## Archive

Historical traceability — design decisions, shipped audit trails,
superseded PRDs. **Not** the current source of truth.

- [`archive/README.md`](archive/README.md) — index of archived docs
  and what each was superseded by.
- [`archive/agent-architecture-reviews.md`](archive/agent-architecture-reviews.md)
  — consolidated 2026-05-01 / 2026-05-08 / 2026-05-09 structural
  reviews.
- [`archive/ai-ux-optimization-plan.md`](archive/ai-ux-optimization-plan.md)
  — original AI UX audit (all five phases shipped 2026-05-05).
- [`archive/prd-v1.md`](archive/prd-v1.md) — the v1 PRD (superseded
  by v2.1 + v3).
