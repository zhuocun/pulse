<!-- orchestrate handoff
task: verify-fix-be-v1-budget-gate
branch: `orch/bug-sweep-4e70/fix-be-v1-budget-gate` (commit `13f6553` — verifier log only)
agentId: bc-0b86f7b7-d1b2-4c8b-b090-26c9aeeb4cf0
runId: run-3bc19f66-e759-45f4-955f-cc455fbb9be4
resultStatus: finished
finishedAt: 2026-05-19T05:31:15.416Z
-->

## Verification

unit-test-verified

## Target
`fix-be-v1-budget-gate` on branch `orch/bug-sweep-4e70/fix-be-v1-budget-gate`

## Branch
`orch/bug-sweep-4e70/fix-be-v1-budget-gate` (commit `13f6553` — verifier log only)

## Execution
- → Checked out `orch/bug-sweep-4e70/fix-be-v1-budget-gate` (clean working tree).
- → Read-only code cross-check: `run_v1_route` in `_dispatch.py` uses `_gate_with_reservation` + `prebooked` reconcile/refund paths; `_gate` (`can_spend`) is defined in `ai.py` but not called by structured routes.
- → Recipe: `cd /workspace/backend && /workspace/.venv/bin/python -m pytest tests/ -q -k budget --no-cov` → **44 passed**, 1195 deselected in 1.53s.
- → Targeted subset: `pytest tests/test_ai_v1_router.py -q --no-cov -k "refund or concurrent or gate_with_reservation or records_budget"` → **9 passed**, 84 deselected in 0.12s (covers `test_v1_structured_route_concurrent_requests_respect_budget_cap`, `test_task_draft_refunds_reservation_on_agent_failure`, `test_gate_with_reservation_*`, `test_chat_refunds_reservation_on_ainvoke_failure`, `test_chat_records_budget_top_up_when_actual_tokens_exceed_reservation`).
- → Committed verifier artifact: `.orchestrate/bug-sweep-4e70/verification/fix-be-v1-budget-gate-verifier.log` and pushed to origin.

## Findings
Per acceptance criterion:
- [x] Structured v1 routes reserve tokens at gate time: **met** — `run_v1_route` reserves via `_gate_with_reservation`; concurrent cap test (cap=2, 3 parallel → 2×200, 1×402, remaining=0) and structured refund-on-failure test pass.
- [x] Reconcile true-ups reservation vs actual usage correctly: **met** — `_reconcile_token_budget` uses `delta = max(0, max(1, actual) - prebooked)`; tests assert reserve(1)+record(delta) totals (e.g. task-draft 15, readiness 16, chat top-up 15).

Other findings (severity-ordered):
- (low): `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` absent (same as upstream); verification relied on recipe + code inspection.
- (low): Legacy `_gate` (`can_spend`) remains in `ai.py` unused by structured routes — upstream suggested optional deprecation; not a regression for B12.

## Notes & suggestions
- Verifier did not run full backend suite with coverage (worker used `-k budget --no-cov` for the same reason); B12 scope is fully covered by the 44 budget-filtered tests.
- No live HTTP/manual endpoint run; behavior is exercised through FastAPI `TestClient` integration tests in the budget suite.
- Upstream draft PR #263 was not opened/updated by this verifier pass (planner owns integration).