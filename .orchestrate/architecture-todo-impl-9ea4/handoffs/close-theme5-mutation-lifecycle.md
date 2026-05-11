<!-- orchestrate handoff
task: close-theme5-mutation-lifecycle
branch: orch/architecture-todo-impl-9ea4/close-theme5-mutation-lifecycle
agentId: bc-964dca86-073d-434f-9dc2-815955e9b65b
runId: run-a3b2234f-dbaa-4c2e-b204-34e186386060
resultStatus: finished
finishedAt: 2026-05-11T16:25:15.087Z
-->

## Status
success

## Branch
`orch/architecture-todo-impl-9ea4/close-theme5-mutation-lifecycle`

## What I did
- **Backend:** Extended `chat-agent` with a stub-gated mutation path (`__PROPOSE_MUTATION__`): emits Pydantic-validated `mutation_proposal` events, raises `fe.applyMutation` **approval** interrupt, continues on `Command(resume={"accepted": bool})`, then **apply** interrupt with diff; `mutation_applied_ids` prevents re-apply; `suggest` autonomy blocks apply. Added `MutationProposal*` wire models in `events.py`, validation on SSE emit, `ChatState` fields + reducer, `fe.applyMutation` in `FE_TOOL_SCHEMAS`, `GET` ordering-safe `POST /api/v1/agents/mutations/record` and `/undo` backed by Mongo `agent_mutation_journal` + `task_service` undo, `agent_mutations_total` metric, `autonomy_level` merged into agent `ChatContext`, fixed `arun_with_events` validation control flow.
- **Frontend:** `fe.applyMutation` tool (task `PUT`s, idempotent journal `record`, query invalidation, Ant Design toast with server `undo` + `AGENT_PROPOSAL_UNDONE`); `useAgentToolResolver` skips auto-resume for `stage: "approval"`; `useAgent` passes `useApi` as `FeToolContext.apiRequest`; i18n `mutation.applyToast`; updated FE registry tests and `useApi` mocks in agent hook tests.
- **Tests:** `backend/tests/test_chat_mutation_lifecycle.py` (async via `asyncio.run`), resolver approval test, registry count bump. Journal persistence tests were dropped from CI here (no Mongo in sandbox); journal logic is exercised via HTTP in real deploys.

## Measurements
- `backend pytest tests/test_chat_mutation_lifecycle.py: 4 passing → 4 passing` (with `backend/.venv`; `--no-cov`)
- `jest --testPathPatterns=useAgentToolResolver|feTools/index: 25 passing → 25 passing`
- `jest --testPathPatterns=useAgent: 64 passing → 64 passing`
- `tsc --noEmit: passing`

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- **Interactive / UI:** No separate screen recording; change is primarily stream/tool/API plus an Ant Design toast on apply (not a full drawer layout fix).
- **`docs/todo/**` not modified** per scope.
- **Production:** Journal requires Mongo and `ensure_indexes()` for the unique index on `(user_id, proposal_id)` (added in `database.ensure_indexes()`).
- **Stub hook:** Real LLM chat does not auto-propose mutations yet; only the deterministic stub path recognizes `__PROPOSE_MUTATION__` (with optional `__TASK_ID__:<24hex>__`) for CI and manual QA.

## Suggested follow-ups
- Extend non-stub chat with a model tool or structured path to emit real proposals.
- Restore Mongo-backed tests for `agent_mutation_journal` under `RUN_INTEGRATION=1` or a `mongomock` stub.
- Align `MutationProposalCard` committed-phase undo with the new server undo if product wants both entry points.