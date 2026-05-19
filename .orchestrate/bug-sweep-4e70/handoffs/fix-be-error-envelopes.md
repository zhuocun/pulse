<!-- orchestrate handoff
task: fix-be-error-envelopes
branch: orch/bug-sweep-4e70/fix-be-error-envelopes
agentId: bc-404dea9b-064c-499b-8a87-09678bfd20ab
runId: run-20928831-f2ca-4ba7-a046-4ed7a4057112
resultStatus: finished
finishedAt: 2026-05-19T05:30:18.609Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-be-error-envelopes`

## What I did
- Standardized `AgentError` detail to nested `{"error": {"code", "message", "details"?}}` via `_agent_error_payload` and added `agent_http_error_detail` / `agent_app_error_content` helpers in `backend/app/agents/errors.py`.
- Updated `app_error_handler` in `backend/app/main.py` to format `AgentError` subclasses through `agent_app_error_content` (with legacy string-payload normalization).
- Normalized agents router `HTTPException` paths: autonomy forbidden (`autonomy_forbidden`), rate limit (`rate_limit_exceeded`), budget (`budget_exhausted`), project AI/manager forbidden (`forbidden`), invoke timeout (`timeout`).
- Adjusted and extended tests for nested JSON shape (rate limit, budget, autonomy, invoke `AgentError`, error-module units). SSE error frames were already code-tagged and left unchanged.

## Measurements
- `pytest tests/ -q -k 'error or agent' --no-cov`: 0 passing → 443 passing (1 skipped)

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Draft PR: https://github.com/zhuocun/pulse/pull/266
- `api_error` / validation `AppError` responses remain `{"error": "<string>"}` (out of scope); only agent-specific paths were normalized per B13.
- Flat `{"code","message"}` HTTPException details in `_enforce_project_access` already worked via `unwrap_error_detail`; router now uses explicit nested `agent_http_error_detail` for consistency.

## Suggested follow-ups
- Align v1 `ai.py` gate errors (`_gate` rate limit / budget / forbidden) to the same nested codes in a sibling task for full FE parity across surfaces.