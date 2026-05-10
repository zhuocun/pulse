# Backend pytest flakiness audit

## Scope

- Audited `backend/tests/**` for flake-prone patterns (async timing, SSE ordering, live-service dependencies, clock dependence, fixture state leakage, marker hygiene).
- Kept analysis within test code and `backend/tests/conftest.py`.
- Applied three low-risk test-only fixes on this branch (listed under **Fixes shipped**).

## Ranked flaky-test suspects

| Rank | Suspect                                                            | Evidence                                                                      | Why flaky                                                                                                                                             | Concrete fix                                                                                                                                                 |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Sleep-driven timeout tests in v2.1 router suite                    | `backend/tests/test_agents_router_v21.py:427`, `:449`, `:486`, `:930`, `:952` | `asyncio.sleep(...)` introduces wall-clock dependency and variance under loaded CI workers.                                                           | **Shipped**: replace sleeps with `await asyncio.Event().wait()` and use short explicit timeout settings so cancellation path is deterministic.               |
| 2    | Sleep-driven timeout tests in coverage filler suite                | `backend/tests/test_coverage_filling.py:1247`, `:1968`                        | Timeout assertions depended on sleep length and event-loop scheduling, creating timing jitter.                                                        | **Shipped**: replace sleeps with never-signaled event waits and use a small positive timeout (`0.01`) instead of `0`.                                        |
| 3    | Live Postgres smoke test guard not visible at collection time      | `backend/tests/test_agents_postgres_live.py:28`                               | Previously skipped inside test body; accidental collection/runs in mixed environments could look like intermittent failures.                          | **Shipped**: add module-level `pytest.mark.skipif` (`:22`) keyed on `PYTEST_AGENT_POSTGRES_URI` and keep `importorskip` for optional deps.                   |
| 4    | Strict full-sequence SSE shape assertion                           | `backend/tests/test_agent_sse_transcripts.py:254`                             | Asserts exact `(kind, surface)` sequence for several agents; can fail on harmless event emission reordering.                                          | Prefer subsequence/contains assertions for invariant events, or normalize by filtering transient event kinds before equality checks.                         |
| 5    | Wall-clock branch test without frozen time                         | `backend/tests/test_redis_backends.py:282`                                    | Uses ambient `time.time()` path; while current assertion is coarse (`zcard == 1`), wall-clock based tests are typically sensitive to clock anomalies. | Patch `time.time` (or backend clock provider) in-test for deterministic timestamps while still covering default-now branch.                                  |
| 6    | Broad “non-413 means pass” assertion                               | `backend/tests/test_ai_limits.py:193`                                         | Test can pass on unrelated 4xx/5xx outcomes, which creates false confidence and apparent intermittency across envs.                                   | Assert a tighter accepted status set (e.g. `200`/expected validation status) and verify response envelope shape.                                             |
| 7    | Mutable singleton repository patching relies on fixture discipline | `backend/tests/conftest.py:231-243`                                           | Singleton monkeypatch pattern is correct but vulnerable if a test bypasses `store` fixture and touches global repository state.                       | Add a lightweight autouse guard that asserts `main.repository` is `FakeStore` during test execution, or codify “must use store fixture” in a helper fixture. |

## Marker inventory (`skipif` / `skip` / `xfail` / `flaky`)

- `backend/tests/test_agents_postgres_live.py:22` — `pytestmark = pytest.mark.skipif(...)` (**justified**: optional live Postgres smoke test).
- `backend/tests/test_agents_postgres_live.py:29-31` — `pytest.importorskip(...)` (**justified**: optional postgres/langgraph extras).
- `backend/tests/test_vercel_config.py:56` — `pytest.skip(...)` when `routes` key absent (**justified**: branch only relevant for legacy routing key).
- `xfail` markers: none found.
- `flaky` markers: none found.

## Fixes shipped

1. `backend/tests/test_agents_router_v21.py`
    - Removed sleep-based timeout/disconnect setup in five tests.
    - Switched to never-signaled async event waits to exercise cancellation paths deterministically.
    - Reduced timeout config in timeout-path tests from `1` to `0.1` to lower wall-clock sensitivity and runtime.

2. `backend/tests/test_coverage_filling.py`
    - Removed sleep-based timeout setup in `_with_disconnect` and v1 chat timeout tests.
    - Replaced `timeout=0` with `timeout=0.01` to avoid immediate scheduling edge races.

3. `backend/tests/test_agents_postgres_live.py`
    - Added module-level `skipif` gate on `PYTEST_AGENT_POSTGRES_URI` for explicit collection-time environment gating.

## Inconclusive / environment-bound areas

- `backend/tests/test_agents_postgres_live.py` remains environment-dependent by design; if `PYTEST_AGENT_POSTGRES_URI` is unset or points to unavailable service, this module is correctly skipped/inconclusive rather than “passed.”
- `backend/tests/test_redis_backends.py` is hermetic (`fakeredis`) and does not require live Redis.
