<!-- orchestrate handoff
task: close-remaining-architecture-themes
branch: orch/architecture-todo-impl-9ea4/close-remaining-architecture-themes
agentId: bc-03bc0936-60b5-41be-aca2-c0b89cca21ee
runId: run-97207853-8cac-453a-a317-c25dd06cd591
resultStatus: finished
finishedAt: 2026-05-11T16:18:28.059Z
-->

## Status
success

## Branch
`orch/architecture-todo-impl-9ea4/close-remaining-architecture-themes`

## What I did
- **Theme 3 — autonomy / capability gating:** `useAutonomyLevel` now accepts an optional server allow-list (`clampAutonomyToAllowlist`), persists/clamps on metadata changes, and the chat drawer builds the autonomy `Select` from `useChatAgentMetadata().allowed_autonomy`, with **Auto** enabled only when `environment.aiMutationProposalsEnabled` is true **and** the backend lists `auto`. The same allow-list is passed into `useAgentChat` → `useAgent` so `autonomyRef` / wire `configurable.autonomy` cannot drift ahead of advertised modes.
- **Theme 2 — stream / HTTP errors:** Exported `coerceAgentTransportError` from `agentClient.ts` and use it for mid-stream transport failures in `useAgent`’s SSE consumer. Extended `mapErrorResponse` so **408** and **504** map to `AgentTransportError` with codes `request_timeout` and `gateway_timeout` (504 is handled before the generic `>= 500` path).
- **Theme 3 — stable hook consumers:** `useAgentChat` callbacks now depend on stable methods (`start`, `reset`, `resume`, `seedMessages`, `dismissNudge`, `clearPendingProposal`) instead of the whole `agent` object; proposal resume effect deps use `pendingProposal?.proposal_id`.
- **Theme 4 — operator docs:** Added `docs/operations/agent-stream-resume.md` (thread id vs `Idempotency-Key`, 200+SSE vs idempotent JSON replay, 409/422 semantics, retry vs thread reset, multi-worker pointer).
- **Theme 6 — explicit deferral:** Added `docs/archive/architecture-theme6-deferred.md` with concrete rationale for not shipping hedging-beyond-failover, embeddings “depth”, and ReAct/supervisor/memory refactors in this pass.

## Measurements
- `npm run typecheck`: pass → pass  
- `npm test` (full Jest): 1115 tests passing → 1115 tests passing  

(none)

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, feedback
- **Backlog row mapping (evidence for status docs, without editing `docs/todo/`):** Theme 3 “finish autonomy capability gating” / adapter alignment → `useAiEnabled.ts`, `aiChatDrawer/index.tsx`, `useAgentChat.ts`, `useAgent.ts` + tests in `useAiEnabled.autonomy.test.tsx`. Theme 2 “proxy timeout / classify failures” → `mapErrorResponse.ts`, `mapErrorResponse.test.ts`, `agentClient.ts`, `useAgent.ts`. Theme 4 “idempotency decision tree” → `docs/operations/agent-stream-resume.md`. Theme 6 depth rows → deferred with rationale in `docs/archive/architecture-theme6-deferred.md` (hedging beyond §2 failover, embeddings backfill-dependent ranking, ReAct/supervisor/memory blocked on stable mutation/autonomy work).
- **Not in this branch:** New cross-tab broadcast for thread id, persisting last interrupt id, and further `useAi`/`useAgent` code sharing — would need product/UX decisions and broader refactors; thread continuity remains sessionStorage-per-tab as before.
- **No live UI recording** — changes are hook/metadata/error-mapping and docs; validation is automated tests only.

## Suggested follow-ups
- Optional smoke: remote FE against a real `chat-agent` metadata payload that omits `suggest` or `auto` to confirm the selector list and clamping in the browser.
- When Theme 5 lands, re-verify **Auto** enablement rules against real `MutationProposal` lifecycle and adjust microcopy if the mutations flag semantics change.