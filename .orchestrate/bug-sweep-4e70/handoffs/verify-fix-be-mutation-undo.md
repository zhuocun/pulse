<!-- orchestrate handoff
task: verify-fix-be-mutation-undo
branch: `orch/bug-sweep-4e70/fix-be-mutation-undo` (commit `c2e034d` — verifier log only)
agentId: bc-7fc802d7-8c69-4bf8-b825-cea2055c2c10
runId: run-0245084e-617e-4272-9be1-f06d6e03c4c4
resultStatus: finished
finishedAt: 2026-05-19T05:30:21.849Z
-->

## Verification

`unit-test-verified`

## Target
`fix-be-mutation-undo` on branch `orch/bug-sweep-4e70/fix-be-mutation-undo`

## Branch
`orch/bug-sweep-4e70/fix-be-mutation-undo` (commit `c2e034d` — verifier log only)

## Execution
- → `git branch --show-current` → `orch/bug-sweep-4e70/fix-be-mutation-undo`
- → Read `backend/app/services/agent_mutation_journal.py` — `undo_mutation` sets `undoneAt` only when `attempted == 0` or `succeeded == attempted`; on `succeeded < attempted` returns `(False, "partial_failure")` and records `undo_partial_failure` before any journal update
- → `/workspace/.venv/bin/python -m pytest tests/ -q -k mutation --no-cov` → **49 passed**, 1190 deselected (0.83s)
- → `/workspace/.venv/bin/python -m pytest tests/test_agent_mutation_journal.py -v --no-cov -k "partial_failure or marks_undone_when_all or applies_task_updates"` → **3 passed** (B14 paths)
- → Same recipe with default coverage (`pytest tests/ -q -k mutation`) → 49 tests pass; exit code 1 from `fail-under=100` on subset (49% total) — not a test failure
- → Committed `.orchestrate/bug-sweep-4e70/verification/fix-be-mutation-undo-verifier.log` and pushed

## Findings
Per acceptance criterion:
- [x] **Partial undo does not set `undoneAt`**: met — implementation lines 119–121 short-circuit before `update_one`; tests assert `fake_collection.updates == []` and `documents[0]["undoneAt"] is None` on partial failure
- [x] **Tests cover partial failure semantics**: met — `test_undo_mutation_applies_task_updates_and_skips_malformed`, `test_undo_mutation_partial_failure_leaves_journal_reversible`, `test_undo_mutation_marks_undone_when_all_valid_rows_succeed`

Other findings (severity-ordered):
- (low): `undo_partial_failure` metric is emitted in code but not asserted in tests (not in acceptance criteria)
- (low): Router maps `partial_failure` to HTTP 403 with `code: "forbidden"` (upstream note; out of scope for B14)

## Notes & suggestions
- B14 fix is verified by targeted unit tests; no live HTTP/UI run required for this backend-only journal semantics change.
- Planner may want follow-up to map `partial_failure` to a distinct HTTP status and FE retry UX (already noted by worker).