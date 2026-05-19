<!-- orchestrate handoff
task: verify-fix-be-resume-budget
branch: `orch/bug-sweep-4e70/fix-be-resume-budget` (no verifier commits; verification-only run)
agentId: bc-42f537f9-e625-40ae-a8d2-772f6217d5de
runId: run-bd25e0dc-798e-459d-a336-489115944fce
resultStatus: finished
finishedAt: 2026-05-19T05:33:58.501Z
-->

## Verification
`unit-test-verified`

## Target
`fix-be-resume-budget` on branch `orch/bug-sweep-4e70/fix-be-resume-budget`

## Branch
`orch/bug-sweep-4e70/fix-be-resume-budget` (no verifier commits; verification-only run)

## Execution
- → `git branch --show-current` → on `orch/bug-sweep-4e70/fix-be-resume-budget`
- → `source /workspace/.venv/bin/activate && cd /workspace/backend && python -m pytest tests/ -q -k resume --no-cov` → **21 passed**, 1217 deselected in 1.33s
- → `python -m pytest tests/test_agents.py::test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id -v --no-cov` → **1 passed** in 0.06s
- → `python -m pytest tests/ -q --no-cov` → **1236 passed**, 2 skipped in 13.02s
- → Read `backend/app/routers/agents.py` (resume `project_id` resolution via `_async_resolve_project_id_for_turn`, checkpoint metadata via `_agent_turn_project_scope` / patched `build_config`, `_require_project_manager` + `_enforce_budget` on invoke and stream after resolution)
- → Read `backend/tests/test_agents.py::test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id` (initial turn with `project_id` in inputs only; resume without `project_id`; expects 402 + `X-Reason: budget`)

## Findings
Per acceptance criterion:
- [x] Resume path cannot bypass budget when `project_id` was only present on initial turn: **met** — regression test passes; resume POST omits `project_id` yet returns `402 PAYMENT_REQUIRED` with `X-Reason: budget` after cap exhaustion.
- [x] New/updated pytest documents the regression: **met** — `test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id` added and green.

Verifier-specific:
- [x] Verifier confirms B11 (resume budget gate): **met** for invoke path via automated test + full suite green.

Other findings (severity-ordered):
- (low): No dedicated `/stream` resume budget regression test; invoke path is covered. Stream handler uses the same `_async_resolve_project_id_for_turn` → `_enforce_budget` sequence (lines ~1066–1147 in `agents.py`).
- (low): Manager role and project access gates run on the same resume code path as budget (`_require_project_manager`, `_enforce_project_access` after `project_id` resolution) but lack a resume-specific denial test analogous to the new 402 test; coverage is by code inspection + shared-path placement, not a dedicated resume regression.

## Notes & suggestions
- Upstream claim of 21 resume tests and full-suite pass reproduced exactly on this VM (`/workspace/.venv`, no MongoDB required).
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` absent here (matches upstream note); verification relied on acceptance criteria and pytest recipe only.
- Optional follow-up: mirror `test_router_invoke_resume_returns_402_when_budget_exhausted_without_client_project_id` for `/stream` if symmetric HTTP coverage is desired.