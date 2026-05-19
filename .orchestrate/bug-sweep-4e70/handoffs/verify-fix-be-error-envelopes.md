<!-- orchestrate handoff
task: verify-fix-be-error-envelopes
branch: `orch/bug-sweep-4e70/fix-be-error-envelopes` (verifier log commit `42c14d3`)
agentId: bc-889e7b3d-c072-4fc8-8c70-6e48b72e6e7a
runId: run-617b8f2a-6083-4dc3-a452-0b3c2da9b6ed
resultStatus: finished
finishedAt: 2026-05-19T05:32:34.978Z
-->

## Verification

unit-test-verified

## Target
`fix-be-error-envelopes` on branch `orch/bug-sweep-4e70/fix-be-error-envelopes`

## Branch
`orch/bug-sweep-4e70/fix-be-error-envelopes` (verifier log commit `42c14d3`)

## Execution
- → `git branch --show-current` — confirmed checkout on `orch/bug-sweep-4e70/fix-be-error-envelopes` at worker commit `b66aa00`
- → `source /workspace/.venv/bin/activate && cd /workspace/backend && pytest tests/ -q -k 'error or agent' --no-cov` — **443 passed, 1 skipped, 797 deselected** in 5.10s (exit 0)
- → `pytest tests/test_agents.py::test_router_invoke_returns_429_with_retry_after_when_rate_limited -q --no-cov` — 1 passed (nested `error.code` = `rate_limit_exceeded`)
- → `pytest tests/test_agents.py::test_router_invoke_returns_402_when_budget_exhausted tests/test_agents.py::test_router_invoke_agent_error_returns_nested_code tests/test_agents.py::test_router_returns_403_when_project_ai_is_disabled tests/test_agents_errors.py -q --no-cov` — 4 passed (`budget_exhausted`, `agent_configuration`, `forbidden`, helper shape units)
- → `pytest tests/test_agents_router_v21.py -k 'autonomy' -q --no-cov` — 4 passed (includes `autonomy_forbidden` nested `error.code`)
- → Read-only cross-check of `backend/app/agents/errors.py`, `backend/app/main.py` (`app_error_handler` → `agent_app_error_content`), and router tests asserting `body["error"]["code"]` on invoke/HTTP paths
- → Committed `.orchestrate/bug-sweep-4e70/verification/fix-be-error-envelopes-verifier.log` and pushed to origin

## Findings
Per acceptance criterion:
- [x] Agent invoke errors include `error.code` in JSON body: **met** — `test_router_invoke_agent_error_returns_nested_code` asserts `body["error"]["code"] == "agent_configuration"` on failed `/api/v1/agents/echo/invoke`; `AgentError` detail built via `_agent_error_payload` in `errors.py`
- [x] Major agent HTTP error paths use consistent nested envelope: **met** — integration tests assert nested shape for `rate_limit_exceeded`, `budget_exhausted`, `forbidden`, `autonomy_forbidden`; unit tests cover `agent_http_error_detail` / `agent_app_error_content`

Other findings (severity-ordered):
- (low): `api_error` / non-agent `AppError` responses remain `{"error": "<string>"}` per worker scope; v1 `ai.py` gate errors not aligned (worker noted follow-up)

## Notes & suggestions
- Full recipe filter (`-k 'error or agent'`) matches upstream worker measurement (443 passing). No live HTTP/UI run; B13 is backend JSON contract + tests only.
- Suggested follow-up from worker still valid: align v1 `ai.py` `_gate` errors to nested codes for full FE `mapErrorResponse` parity across surfaces.