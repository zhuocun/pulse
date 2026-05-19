<!-- orchestrate handoff
task: fix-be-resume-budget
branch: orch/bug-sweep-4e70/fix-be-resume-budget
agentId: bc-5a278c3a-bd5a-4b0c-b1e0-771f49e68e97
runId: run-c748738e-e754-4790-8d5e-76576c609df5
resultStatus: finished
finishedAt: 2026-05-19T05:31:56.996Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-be-resume-budget`

## What I did
- On resume, resolve `project_id` from `inputs`, then `config.configurable`, then LangGraph checkpoint metadata (via `thread_id`).
- Inject `project_id` into `config.configurable` per request (contextvar + patched `AgentRuntime.build_config`) so the initial interrupt turn persists it for later resume lookups.
- Run `_require_project_manager` and `_enforce_budget` on resume using the resolved `project_id` (invoke + stream).
- Added `test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id`.
- Opened draft PR #267.

## Measurements
- `pytest tests/ -q -k resume --no-cov`: 21 passing → 21 passing

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- LangGraph only stores `project_id` in checkpoint metadata when it is present in `config.configurable` at invoke time; the contextvar patch ensures the initial turn writes it even when `project_id` arrives only in `inputs`.
- Resume still accepts client `config.configurable.project_id` when sent; checkpoint metadata is the backstop when omitted (security regression from B11).
- Did not read `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` (not present in workspace).

## Suggested follow-ups
- Mirror the regression for `/stream` resume if the verifier wants symmetric coverage (invoke path is covered).