<!-- orchestrate handoff
task: verify-remaining-architecture-themes
branch: orch/architecture-todo-impl-9ea4/close-remaining-architecture-themes
agentId: bc-ccf2e7ee-33a6-40b2-8d5f-fde49437036a
runId: run-e373d2e3-862b-4a45-ac70-6c4f7df5e21a
resultStatus: finished
finishedAt: 2026-05-11T16:21:16.649Z
-->

## Verification

**unit-test-verified**

## Target

`close-remaining-architecture-themes` on branch `orch/architecture-todo-impl-9ea4/close-remaining-architecture-themes`

## Branch

`orch/architecture-todo-impl-9ea4/close-remaining-architecture-themes`

## Execution

- `npm run typecheck` → exit **0** (`tsc --noEmit`, no diagnostics).
- `npm test -- --watchAll=false` → exit **0** — **155** suites passed, **1115** tests passed (45.3s).
- Backend SSE / Theme 1 transcript execution → **blocked**: `python` missing; `python3 -m pytest tests/test_agent_sse_transcripts.py` failed (`No module named pytest`). Baseline checked statically: `backend/app/agents/events.py` defines `extra="forbid"` payload models and `validate_suggestion_payload`; `backend/tests/test_agent_sse_transcripts.py` exists.
- Code/doc trace for worker claims: `src/utils/ai/mapErrorResponse.ts` + `mapErrorResponse.test.ts` (408/`request_timeout`, 504/`gateway_timeout`); `src/utils/ai/agentClient.ts` exports `coerceAgentTransportError`; `src/utils/hooks/useAgent.ts` passes `coerceAgentTransportError` into stream consumer `onNonAbortTransportError`; `src/utils/hooks/useAiEnabled.ts` (`clampAutonomyToAllowlist`, metadata-driven clamp in `useAutonomyLevel`); `src/components/aiChatDrawer/index.tsx` (selector from `useChatAgentMetadata().allowed_autonomy`, **auto** gated on `environment.aiMutationProposalsEnabled` and server `auto`); `src/utils/hooks/useAgentChat.ts` (callbacks/effects depend on `agent.start` / `reset` / `resume` / `seedMessages` / `dismissNudge` / `clearPendingProposal`, proposal settle effect uses `agent.pendingProposal?.proposal_id`); `docs/operations/agent-stream-resume.md`; `docs/archive/architecture-theme6-deferred.md`.
- Pushed verifier artifact: `docs/verification/close-remaining-architecture-themes-verifier-036a.log` (commit `a922dca`).

## Findings

Per acceptance criterion:

- Residual Theme 1/2/3/4/6 actionable items have concrete implementation evidence or explicit closure rationale ready for status-doc integration: **[ ] not met**
- No remaining unstable `useAgent` consumer effect dependency loops or autonomy-capability drift in active surfaces: **[x] met** (manual review of `board.tsx`, `boardBriefDrawer`, `aiTaskAssistPanel`, `aiSearchInput`, `aiTaskDraftModal`, `useAgentChat`; full Jest green — not a live DOM proof).
- Operator-facing docs for resume/idempotency/failure policy are updated when behavior changes: **[x] met** for stream/idempotency/retry (`agent-stream-resume.md`); autonomy / new transport error codes are not called out in a separate operator runbook (minor gap).

Other findings (severity-ordered):

- **(high)** **Theme 4 — residual table rows:** `docs/todo/architecture-todo.md` still lists **optional multi-tab / broadcast thread policy** and **persisting minimal resume handles (e.g. last interrupt id)** as actions. Implementation evidence for those is absent on this branch; closure exists only in upstream handoff prose, not as a repo deferral artifact comparable to `docs/archive/architecture-theme6-deferred.md`. Thread-id continuity across **refresh** is described as shipped in the same doc; multi-tab and last-interrupt persistence remain **defensibility gaps** for “every residual actionable row closed.”
- **(med)** **Theme 1 — execution gap:** Golden SSE transcript tests were not run in this environment (pytest unavailable); closure rests on existing sources plus architecture-doc narrative, not fresh CI-equivalent proof here.
- **(low)** **`useAgentChat`:** One effect still keys off `pendingInterrupt` by reference (`useAgentChat.ts` ~211–225); no failing test observed; slightly higher churn risk than primitive-keyed deps.

## Notes & suggestions

- Treat upstream **success** as **partial**: Theme **2** (408/504 + mid-stream transport coercion + tests), Theme **3** (metadata autonomy allow-list + clamp + stable `useAgentChat` deps), Theme **4** (operator idempotency/retry doc), and Theme **6** (explicit deferral doc) are well supported. Theme **1** is adequately grounded in the existing backend schema/transcript layout but was not re-executed here. Theme **4** FE continuity rows still need either implementation or an explicit archived deferral + backlog edit when the planner integrates status docs.
- Optional follow-up for parity with Theme 6: add `docs/archive/architecture-theme4-fe-deferred.md` (or strike/update rows in `architecture-todo.md`) if multi-tab and last-interrupt persistence are intentionally out of scope for this train.
- Install backend test deps (or run transcript tests in CI) before treating Theme 1 as **machine-verified** in the next loop.