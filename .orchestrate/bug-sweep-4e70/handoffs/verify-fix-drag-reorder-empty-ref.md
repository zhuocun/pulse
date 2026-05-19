<!-- orchestrate handoff
task: verify-fix-drag-reorder-empty-ref
branch: orch/bug-sweep-4e70/fix-drag-reorder-empty-ref
agentId: bc-5b30cf39-d314-4813-90a0-622c690c339e
runId: run-e7873ad1-4002-4ade-860d-b68e7d10590e
resultStatus: finished
finishedAt: 2026-05-19T05:30:08.927Z
-->

## Verification

unit-test-verified

## Target
`fix-drag-reorder-empty-ref` on branch `orch/bug-sweep-4e70/fix-drag-reorder-empty-ref`

## Branch
`orch/bug-sweep-4e70/fix-drag-reorder-empty-ref`

## Execution
- → Checked out `orch/bug-sweep-4e70/fix-drag-reorder-empty-ref` (clean working tree before verifier commit).
- → `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useDragEnd src/utils/optimisticUpdate/reorder` — **2 suites, 28 passed**, exit 0.
- → `cd backend && source /workspace/.venv/bin/activate && python -m pytest tests/test_api_features.py -q -k reorder` — **1 passed**, 28 deselected; **exit 1** because subset run trips the repo **100% coverage** gate (33% total). The reorder test itself passed.
- → Same pytest command with `--no-cov` — **1 passed**, exit 0.
- → `npx tsc --noEmit` — exit 0.
- → `pytest tests/test_api_features.py::test_remaining_ordering_branches --no-cov -v` — **PASSED** (service-level regression including `referenceId: ""` cross-column reorder → `"Task reordered"`).
- → `pytest tests/test_api_features.py::test_full_feature_flow --no-cov -q` — **PASSED** (HTTP `PUT /api/v1/tasks/orders` with `referenceId: null` → 200 / `"Task reordered"`).
- → Code review: `useDragEnd` omits `referenceId` when no reference task; `task_service.reorder` normalizes `referenceId` with `or None`; `reorder.ts` unchanged (`!referenceId` path).
- → Pushed verifier log: `.orchestrate/bug-sweep-4e70/verification/fix-drag-reorder-empty-ref-verifier.log` (commit `1616734`).

## Findings
Per acceptance criterion:
- [x]: **PUT reorder with no reference task succeeds on the backend** — met (`test_remaining_ordering_branches` for `None` and `""`; `test_full_feature_flow` HTTP with `referenceId: null`).
- [x]: **FE sends null/omitted `referenceId`, not `""`, when there is no reference task** — met (`useDragEnd.ts` conditional spread; `useDragEnd.test.tsx` `"omits referenceId for empty target-column drops"`).
- [x]: **Regression tests cover the empty-reference path on FE and BE** — met (28 FE tests including new case; BE `test_remaining_ordering_branches` + existing flow test).

Other findings (severity-ordered):
- (low): Recipe `pytest -k reorder` without `--no-cov` exits non-zero on this repo when only one test runs (coverage fail-under), even though the test passes. CI full-suite runs are unaffected; use `--no-cov` for targeted verifier reruns.

## Notes & suggestions
- B1 fix independently confirmed; no live browser drag session run (not required for this contract; tests exercise the paths).
- Planner can treat worker `unit-test-verified` as corroborated; merge PR #255 when ready.