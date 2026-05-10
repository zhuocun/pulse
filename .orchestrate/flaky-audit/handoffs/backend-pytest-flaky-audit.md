<!-- orchestrate handoff
task: backend-pytest-flaky-audit
branch: orch/flaky-audit/backend-pytest-flaky-audit
agentId: bc-28ea1761-a708-448e-a5b1-89326660ebcb
runId: run-da5bb660-1a5c-4851-8b3e-6254c32f3ba4
resultStatus: finished
finishedAt: 2026-05-10T01:42:45.371Z
-->

## Status
success

## Branch
`orch/flaky-audit/backend-pytest-flaky-audit`

## What I did
- Added backend flakiness audit doc at `docs/test-flakiness/backend.md` with:
  - ranked suspects (7 total) with file:line references and concrete fixes,
  - marker inventory (`skipif`/`skip`/`importorskip`, plus `xfail`/`flaky` absence),
  - shipped-fix summary and inconclusive live-service notes.
- Shipped surgical flaky-test fixes in allowed paths:
  - `backend/tests/test_agents_router_v21.py`
    - replaced sleep-based timeout/disconnect setup with deterministic pending waits (`asyncio.Event().wait()`),
    - tightened timeout test settings from `1` to `0.1` where appropriate.
  - `backend/tests/test_coverage_filling.py`
    - removed sleep-based timeout hangs and kept deterministic timeout branch coverage.
  - `backend/tests/test_agents_postgres_live.py`
    - added module-level `pytest.mark.skipif` gate keyed on `PYTEST_AGENT_POSTGRES_URI`,
    - retained `importorskip` checks for optional postgres/langgraph deps.
- Committed and pushed all changes to the required branch, including fix commits using the required prefix:
  - `test(backend-flaky): fix timeout/disconnect specs — remove sleep-based timing`
  - `test(backend-flaky): fix _with_disconnect timeout case — retain deadline branch coverage`

## Measurements
- `ranked suspects in docs/test-flakiness/backend.md: 0 → 7`
- `backend flaky-fix commits with "test(backend-flaky):": 0 → 2`
- `backend coverage total (full pytest): 99.98% → 100.00%`
- `backend pytest result (collected/passed/skipped/failed): 1043/1042/1/0 == 1043/1042/1/0`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Full verification run executed on this branch from `backend/` with:
  - `"/workspace/.venv/bin/python" -m pytest`
  - result: `1042 passed, 1 skipped, 40 warnings in 16.89s`, coverage gate satisfied at `100.00%`.
- Live Postgres smoke test is intentionally skipped here (`test_agents_postgres_live.py`) because `PYTEST_AGENT_POSTGRES_URI` is not set; treated as environment-gated/inconclusive rather than passed.
- Redis live-service concern is not applicable for `test_redis_backends.py` in this repo because it uses `fakeredis` hermetically.
- I did not open a PR (per your instruction).

## Suggested follow-ups
- Consider relaxing strict full-order SSE transcript assertions in `backend/tests/test_agent_sse_transcripts.py:254` to invariant/subsequence checks to reduce harmless-ordering churn.
- Consider freezing/patching time for `backend/tests/test_redis_backends.py:282` default-now branch coverage to remove ambient wall-clock dependency.
- Tighten `backend/tests/test_ai_limits.py:193` (`status != 413`) to a narrower expected-status assertion so non-limit regressions cannot pass silently.