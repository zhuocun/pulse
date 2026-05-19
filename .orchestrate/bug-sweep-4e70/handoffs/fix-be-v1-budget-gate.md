<!-- orchestrate handoff
task: fix-be-v1-budget-gate
branch: orch/bug-sweep-4e70/fix-be-v1-budget-gate
agentId: bc-ac6d9550-2db5-477a-95d1-6bec3feb972e
runId: run-c3fe9814-97e5-47bf-9e39-466a57b8d5ba
resultStatus: finished
finishedAt: 2026-05-19T05:29:28.669Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-be-v1-budget-gate`

## What I did
- Switched `run_v1_route` from read-only `_gate` (`can_spend`) to `_gate_with_reservation` (atomic `reserve(1)`), matching chat/agents invoke.
- Updated `_reconcile_token_budget` to take `prebooked` and top up with `max(0, max(1, actual) - prebooked)` instead of assuming a phantom gate debit.
- Refund reserved tokens on exceptions and on `AgentError` deterministic fallback paths that skip reconciliation.
- Adjusted budget tests for reserve+record totals; added refund-on-failure and concurrent cap (cap=2, 3 parallel → 2×200, 1×402) tests.
- Opened draft PR #263: https://github.com/zhuocun/pulse/pull/263

## Measurements
- `pytest tests/ -q -k budget --no-cov`: 44 passing → 44 passing

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `_gate` (read-only `can_spend`) remains in `ai.py` but is no longer used by structured routes; only chat and `run_v1_route` use reservation now.
- `AgentError` fallback success still refunds the reservation so stub fallbacks do not debit (same as pre-fix `can_spend` behavior).
- Readiness budget test expected 15 under old phantom-debit math; correct total with reserve is 16 (1 + 15 top-up).
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` was not present in the workspace; implemented from task brief and code inspection.

## Suggested follow-ups
- Consider removing or deprecating unused `_gate` if nothing else should call it.
- Run full backend suite with coverage in CI (local `-k budget` used `--no-cov` to avoid unrelated 100% gate).