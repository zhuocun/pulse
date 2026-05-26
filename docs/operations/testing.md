# Testing — flakiness audit and follow-ups

Last consolidated: 2026-05-10. Scope: frontend Jest, backend pytest,
shared Jest / CI infrastructure. Earlier per-area docs
(`frontend.md`, `backend.md`, `infra.md`) have been folded in here.

## Executive summary

- **No live red tests on `main`.** Both suites are green on this branch
  (frontend 146 suites / 1055 tests, backend 1042 passing + 1
  environment-gated skip). Every fix landed below was a hardening of a
  silently flake-prone test, not a repair of an already-failing test.
- **The dominant flake pattern is wall-clock dependence in tests that
  should be deterministic.** Frontend debounce tests slept on real
  timers; backend timeout/disconnect tests slept inside async paths to
  drive cancellation. Both classes were converted to fake timers /
  never-signaled `asyncio.Event` waits.
- **Mock state was leaking between Jest tests.** `jest.config.cjs` did
  not set `clearMocks` / `restoreMocks`, so `jest.fn` call histories
  and `jest.spyOn` replacements could survive across files. This is
  the highest-value infra change in this PR.
- **Spy/teardown discipline is uneven in the frontend.**
  `Modal.confirm` spies in `taskModal/index.test.tsx` were restored
  only on the happy path, so any earlier assertion failure would leak
  the spy into the next test. Every place that uses `jest.spyOn`
  outside `beforeEach` should pair it with a `try/finally` or an
  `afterEach` that restores it unconditionally.
- **Fake timers are partially adopted on the frontend.** Suites
  alternate between `beforeAll`-scoped and per-test fake timers;
  pending timers from one case can survive into the next when
  ownership is suite-level. The AiTaskAssistPanel panel suite was
  migrated to per-test ownership; the matching `agent.test.tsx` is the
  next candidate.
- **Live-service tests need module-level skip gates, not in-body
  skips.** `test_agents_postgres_live.py` previously skipped inside the
  test body; it now uses `pytestmark = pytest.mark.skipif(...)` keyed
  on `PYTEST_AGENT_POSTGRES_URI`.
- **Backend SSE transcript assertions are over-strict.** A few tests
  assert the exact `(kind, surface)` sequence emitted by an agent,
  which is fragile against harmless reordering. Not currently red, but
  the most likely first failure of a benign refactor.
- **Frontend Jest now runs in GitHub Actions.**
  `.github/workflows/frontend-ci.yml` runs the CI Jest command,
  typecheck, lint, and build on frontend-path changes.
- **`__json_server_mock__/db.json` is stale relative to `/api/v1`.**
  Not strictly a flaky-test source, but the most common cause of
  "looks-like-a-flake" local failures when developers point the SPA at
  `npm run server`.
- **No `xfail` / `flaky` quarantine markers anywhere.** Healthy today
  (no hidden red), but if reruns are introduced at the CI level, pair
  them with explicit quarantine markers rather than blanket retries.

## Frontend Jest

Suite shape: **146 suites / 1055 tests**.

Run command:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles
```

Setup at `src/setupTests.ts`; jsdom environment with project-level
test shims. `AGENTS.md` still documents the older envelope (~980
tests / 142 suites) so the suite has grown.

### Top suspects (highest confidence first)

1. **`src/components/aiTaskAssistPanel/index.test.tsx:149`** —
   fake-timer state leaked between cases. The suite used fake timers
   across the entire describe block and advanced timers without a
   single helper, making timer lifecycle control inconsistent
   (`beforeAll` + direct `jest.advanceTimersByTime`). _Fixed in
   `c9941a9`_: per-test timer ownership and an `act`-wrapped
   `advanceBy` helper.

2. **`src/components/taskModal/index.test.tsx:257`** — `Modal.confirm`
   spy could leak on early assertion failure. Three deletion tests
   restored the spy only at the bottom of the happy path
   (`confirmSpy.mockRestore()`), not in guaranteed teardown. _Fixed in
   `6ddef00`_: `try/finally` around each delete-confirm test body.

3. **`src/pages/project.test.tsx:273`** — debounce test waited on real
   `setTimeout(resolve, 400)`, racing under load. _Fixed in `abee0bc`_:
   converted to fake timers + `await act(jest.advanceTimersByTime(400))`.

4. **`src/components/aiTaskAssistPanel/agent.test.tsx:180`** —
   suite-level `beforeAll(useFakeTimers)` still shared across tests.
   Same pattern as #1, not yet migrated. Recommended follow-up.

5. **`src/utils/hooks/useAgentHealth.test.tsx:216`** —
   `advanceTimersByTime` not wrapped in `act`; can miss a state flush
   on slower workers. Wrap timer movement in `act(() =>
   jest.advanceTimersByTime(5_000))` before asserting.

6. **`src/components/aiTaskDraftModal/agent.test.tsx:189`** — `waitFor`
   used for synchronous mock-invocation checks. Replace with immediate
   assertions after interaction (or a single `findBy*` guard) to keep
   `waitFor` only where DOM/state transitions are genuinely async.

### Cross-cutting patterns

- 241 `waitFor` call-sites across 51 files; example
  `src/utils/hooks/useAgent.test.tsx:92`.
- 22 `advanceTimersByTime` call-sites across 10 files; timer ownership
  pattern is inconsistent. Example
  `src/components/aiTaskAssistPanel/agent.test.tsx:287`.
- Real wall-clock `setTimeout` use remains in 3 test files; example
  `src/components/aiTaskAssistPanel/index.test.tsx:305`.
- Strict suites with auto-mocked `useAiEnabled` but no explicit
  `useAutonomyLevel` override appear in 7 files; example
  `src/__tests__/uiQuality.strict.test.tsx:48` (currently safe;
  fragile if Board/Ai drawer surfaces are added later).

## Backend pytest

Suite shape: **1042 passed, 1 skipped (environment-gated), 40
warnings** with coverage above the 85% floor.

Run command (from `backend/`):

```bash
pip install -e ".[dev,ai]"
pytest
```

### Ranked flaky-test suspects

| Rank | Suspect | Evidence | Why flaky | Fix |
| ---- | ------- | -------- | --------- | --- |
| 1 | Sleep-driven timeout tests in v2.1 router suite | `tests/test_agents_router_v21.py:427`, `:449`, `:486`, `:930`, `:952` | `asyncio.sleep(...)` introduces wall-clock dependency and variance under loaded CI workers. | **Shipped (`d650874`)**: replaced sleeps with `await asyncio.Event().wait()`; tightened `timeout` from `1` to `0.1`. |
| 2 | Live Postgres smoke test guard not visible at collection time | `tests/test_agents_postgres_live.py:28` | Previously skipped inside test body; accidental collection in mixed environments could look like intermittent failures. | **Shipped (`bcab537`)**: module-level `pytestmark = pytest.mark.skipif(...)` keyed on `PYTEST_AGENT_POSTGRES_URI`. |
| 3 | Strict full-sequence SSE shape assertion | `tests/test_agent_sse_transcripts.py:254` | Asserts exact `(kind, surface)` sequence; can fail on harmless reordering. | Switch to subsequence/contains assertions for invariant events; filter transient kinds before equality. |
| 4 | Wall-clock branch test without frozen time | `tests/test_redis_backends.py:282` | Uses ambient `time.time()`; current assertion is coarse but the path is sensitive to clock anomalies. | Patch `time.time` (or backend clock provider) for deterministic timestamps. |
| 5 | AI limit status assertions | `tests/test_ai_limits.py` | Limit tests are most valuable when they assert the exact accepted/rejected status and response envelope, not just "not 413". | Keep the focused 413 and accepted-status assertions pinned as the route surface changes. |
| 6 | Mutable singleton repository patching relies on fixture discipline | `tests/conftest.py:231-243` | Singleton monkeypatch is correct but vulnerable if a test bypasses `store` and touches global repository state. | Add an autouse guard asserting `main.repository is FakeStore` during test execution. |

### Marker inventory

- `tests/test_agents_postgres_live.py:22` — `pytestmark =
  pytest.mark.skipif(...)` — justified (optional live Postgres smoke).
- `tests/test_agents_postgres_live.py:29-31` —
  `pytest.importorskip(...)` — justified (optional postgres/langgraph
  extras).
- `tests/test_vercel_config.py:56` — `pytest.skip(...)` when `routes`
  key absent — justified (legacy routing branch).
- No `xfail` or `flaky` markers anywhere.

## Shared test infrastructure

Scope: `jest.config.cjs`, `babel.config.cjs`, `src/setupTests.ts`,
`src/test/**`, `__json_server_mock__/**`, `.github/workflows/**`.

1. **`MessageChannel` polyfill defers delivery on the macrotask
   queue.** `TestMessagePort.postMessage` schedules the peer handler
   with `window.setTimeout(..., 0)` (`src/setupTests.ts:48-51`). Any
   code that pairs `MessageChannel` traffic with `useFakeTimers()`
   can observe ordering races. Document tests that touch
   Workers/MessageChannel to call `runOnlyPendingTimers()` /
   `advanceTimersByTime(0)`; do not migrate the polyfill to
   `queueMicrotask` lightly (high blast radius).

2. **Global `fetch` is a bare `jest.fn()` with no stubbed
   resolution** (`src/setupTests.ts:89-92`). Callers that
   `await fetch(...).json()` without overriding the mock can see
   rejected or inconsistent behaviour. Either ensure all `fetch` tests
   use `mockResolvedValueOnce` / MSW, or set a conservative default
   (`mockResolvedValue(new Response("{}"))`).

3. **Jest config previously lacked mock hygiene.** No `clearMocks` /
   `restoreMocks`, so `jest.fn` call histories and `jest.spyOn`
   replacements could leak across tests. _Fixed (`38c7ad6`)_: both
   flags set. Optionally add an explicit `testTimeout` for slow CI.

4. **`moduleNameMapper` pins React Router to `dist/development/...`**
   (`jest.config.cjs:10-15`). A future React Router upgrade that moves
   those files will fail the suite hard (loud, not flaky). Verify on
   each upgrade.

5. **Babel test target differs from the TS emit target.**
   `babel.config.cjs:3` uses `@babel/preset-env` `{ targets: { node:
   "current" } }`; `tsconfig.json:3` sets `"target": "ES2022"`. Rare
   correctness divergence more than a classic flake; introduce
   `tsconfig.jest.json` only if parity issues appear.

6. **Frontend CI exists, but local reproduction must match it.**
   `.github/workflows/frontend-ci.yml` is the canonical recipe for Jest
   worker count, typecheck, lint, and build flags.

7. **Backend `pytest` runs once with no flaky quarantine / rerun.**
   Treat any add of `pytest-rerunfailures` as a quarantine mechanism,
   not a silent retry on every PR.

8. **`__json_server_mock__/db.json` does not match `/api/v1`**
   (legacy shapes such as `users.id` as number, `projects.personId`).
   Confusing failures that look "flaky" when mixed with MSW or real
   API tests. Regenerate against the current schema or document a
   single supported mock entrypoint.

9. **`tests/conftest.py` mutates `security.settings.jwt_secret` via
   `object.__setattr__` and does not restore it** (lines 231-238).
   Currently safe because every cross-test consumer goes through the
   `store` fixture; add a finalizer that restores the prior value.

10. **`setupFilesAfterEnv` ordering** —
    `@testing-library/jest-dom` first (`src/setupTests.ts:5-6`),
    `window.matchMedia` before `MessageChannel` / `fetch` /
    `ResizeObserver`. No global `jest.useFakeTimers`. No change
    required today; flag if someone adds global fake timers without
    `doNotFake` for required APIs.

## Fixes shipped in this audit

| Branch | Test / file | Cause | Fix |
| --- | --- | --- | --- |
| infra | `jest.config.cjs` | Mock call history and spies leaked across tests. | `clearMocks: true`, `restoreMocks: true`. |
| frontend | `src/pages/project.test.tsx` | Debounce test waited on real `setTimeout`. | Fake timers + `await act(jest.advanceTimersByTime(400))`. |
| frontend | `src/components/taskModal/index.test.tsx` | `Modal.confirm` spy restored only on happy path. | `try/finally` with `confirmSpy.mockRestore()` in `finally`. |
| frontend | `src/components/aiTaskAssistPanel/index.test.tsx` | Suite-level `beforeAll(useFakeTimers)` leaked timer state. | Per-test fake-timer ownership + `act`-wrapped `advanceBy`. |
| backend | `tests/test_agents_router_v21.py` (5 tests) | Cancellation paths driven by `asyncio.sleep(...)`. | `await asyncio.Event().wait()`; `timeout` 1 → 0.1. |
| backend | `tests/test_agents_postgres_live.py` | Live-service skip lived inside test bodies. | Module-level `pytestmark = pytest.mark.skipif(...)` keyed on `PYTEST_AGENT_POSTGRES_URI`. |

## Recommended follow-ups

Ranked by expected impact, with effort tags (S = single-file
hardening, M = a few files / small infra change, L = cross-cutting).

1. **Keep local frontend reproduction aligned with CI (S).** Run the
   exact Jest, typecheck, lint, and build commands from
   `.github/workflows/frontend-ci.yml` when investigating flakes.
2. **Migrate `aiTaskAssistPanel/agent.test.tsx` to per-test fake
   timers (S).**
3. **Wrap `advanceTimersByTime` in `act` in
   `useAgentHealth.test.tsx` (S).**
4. **Tighten `waitFor` usage in
   `aiTaskDraftModal/agent.test.tsx` and
   `boardBriefDrawer/agent.test.tsx` (S).** Use immediate assertions
   or `findBy*` where the transition is genuinely async.
5. **Relax strict full-sequence SSE assertions in
   `test_agent_sse_transcripts.py` (S).**
6. **Freeze time in `test_redis_backends.py:282` (S).**
7. **Keep AI limit tests envelope-specific (S).** Any new limit path
   should assert both status and error body shape.
8. **Restore `security.settings.jwt_secret` in the `store`
   fixture (M).**
9. **Refresh or replace `__json_server_mock__/db.json` (M).** Align
   with `/api/v1` shapes, or document a single supported mock
   entrypoint.
10. **Default global `fetch` mock to a benign resolution (S).**
11. **Add an explicit `testTimeout` to `jest.config.cjs` (S).**
12. **Optional: `pytest-rerunfailures` on backend CI as a quarantine
    mechanism (M).** Pair with explicit `@pytest.mark.flaky` markers
    on individual tests.

## How to detect future flakes

Listed in order of "easiest to land" and most signal-per-effort.

- **Run Jest with `--shuffle`** locally and on CI. Native to Jest
  30+; reproduces order-dependent flakes that `clearMocks` alone
  cannot catch. Pair with a fixed seed in CI logs.
- **`pytest-randomly`** for the backend. Randomizes test order per
  run, prints the seed, supports replay (`-p randomly
  --randomly-seed=N`). Lowest-friction way to flush out fixture-leak
  flakes.
- **`pytest-rerunfailures`** as a quarantine mechanism
  (`@pytest.mark.flaky(reruns=2)` on specific tests) — never as a
  blanket suite-level retry.
- **`jest.retryTimes(N, { logErrorsBeforeRetry: true })`** scoped to
  a single suite while a flake is being investigated, paired with
  a tracking issue.
- **`jest --detectOpenHandles --forceExit` on CI** (the run command
  AGENTS.md already documents) so leaked handles surface as a CI
  failure.
- **Scheduled `pytest --count=N` job on `main`** (via `pytest-repeat`
  or `pytest-stress`) for a statistical signal on whether a test
  fails 1/100 vs 1/10000.
- **Surface artifact diffs between two CI runs of the same SHA.** A
  green-then-red on the same SHA is the cheapest possible flake
  detector.
- **Lightweight lint rule against real `setTimeout` /
  `asyncio.sleep` in test files** (custom ESLint and Ruff/flake8
  rule). Both flake patterns fixed here were variations of "test
  slept on real time"; lint would have caught them at PR review.
