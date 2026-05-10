# Test Flakiness Audit — 2026-05-10

This document consolidates the parallel flakiness audits performed on the
frontend Jest suite, the backend pytest suite, and the shared Jest / CI test
infrastructure. The three per-area docs remain the source of truth for their
respective scopes; this file links to them and surfaces the highest-impact
findings in one place.

- Frontend Jest area doc: [`docs/test-flakiness/frontend.md`](./frontend.md)
- Backend pytest area doc: [`docs/test-flakiness/backend.md`](./backend.md)
- Shared infra area doc: [`docs/test-flakiness/infra.md`](./infra.md)

## Executive summary

- **No live red tests on `main`.** Both suites are green on this synthesis
  branch (frontend 146 suites / 1055 tests, backend 1042 passing + 1
  environment-gated skip). Every "fix" landed below was a hardening of a
  silently flake-prone test, not a repair of an already-failing test.
- **The dominant flake pattern across the codebase is wall-clock dependence
  in tests that should be deterministic.** Frontend debounce tests slept on
  real timers; backend timeout/disconnect tests slept inside async paths to
  drive cancellation. Both classes were converted to fake timers / never-
  signaled `asyncio.Event` waits.
- **Mock state was leaking between Jest tests.** `jest.config.cjs` did not
  set `clearMocks` / `restoreMocks`, so `jest.fn` call histories and
  `jest.spyOn` replacements could survive across files. This is the
  highest-value infra change in this PR.
- **Spy/teardown discipline is uneven in the frontend.** `Modal.confirm`
  spies in `taskModal/index.test.tsx` were restored only on the happy path,
  so any earlier assertion failure would leak the spy into the next test.
  Every place that uses `jest.spyOn` outside `beforeEach` should pair it
  with a `try/finally` or an `afterEach` that restores it unconditionally.
- **Fake timers are partially adopted on the frontend.** Suites alternate
  between `beforeAll`-scoped and per-test fake timers; pending timers from
  one case can survive into the next when ownership is suite-level. The
  AiTaskAssistPanel panel suite was migrated to per-test ownership; the
  matching `agent.test.tsx` is the next candidate (see follow-ups).
- **Live-service tests need module-level skip gates, not in-body skips.**
  `test_agents_postgres_live.py` previously skipped inside the test body; it
  now uses `pytestmark = pytest.mark.skipif(...)` keyed on
  `PYTEST_AGENT_POSTGRES_URI`, so accidental collection in mixed
  environments cannot look like an intermittent failure.
- **Backend SSE transcript assertions are over-strict.** A few tests assert
  the exact `(kind, surface)` sequence emitted by an agent, which is fragile
  against harmless reordering. They are not currently red, but they are the
  most likely "first failure" of a benign refactor.
- **There is no GitHub Actions workflow for the frontend Jest suite.** Only
  `backend-ci.yml` exists. Ordering or environment-only flakes therefore
  surface only locally / in Husky, never on a shared runner.
- **`__json_server_mock__/db.json` is stale relative to `/api/v1`.** This is
  not strictly a flaky-test source, but it is the most common cause of
  "looks-like-a-flake" local failures when developers point the SPA at
  `npm run server`. Documented as a follow-up; not in this PR.
- **No `xfail` / `flaky` quarantine markers exist anywhere.** That is
  healthy today (no hidden red), but it also means there is no place to
  park a known-flaky test while it is being investigated. If reruns are
  introduced (CI level), pair them with explicit quarantine markers rather
  than blanket retries.

## Frontend Jest

Source of truth: [`docs/test-flakiness/frontend.md`](./frontend.md).

Run command:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles
```

Suite shape on this branch: **146 suites / 1055 tests**.

Top suspects (ranked, see frontend doc for full evidence):

1. **`src/components/aiTaskAssistPanel/index.test.tsx:149`** — fake-timer
   state leaked between cases (suite-level `beforeAll(useFakeTimers)`).
   _Fixed in this PR_ (`c9941a9`): per-test timer ownership and an
   `act`-wrapped `advanceBy` helper.
2. **`src/components/taskModal/index.test.tsx:257`** — `Modal.confirm` spy
   leaked when an early assertion failed. _Fixed in this PR_ (`6ddef00`):
   `try/finally` around each delete-confirm test body.
3. **`src/pages/project.test.tsx:273`** — debounce test waited on real
   `setTimeout`, racing under load. _Fixed in this PR_ (`abee0bc`):
   converted to fake timers + `await act(jest.advanceTimersByTime(400))`.
4. **`src/components/aiTaskAssistPanel/agent.test.tsx:180`** — same
   suite-level fake-timer pattern as #1; not yet migrated. Recommended
   follow-up (S).
5. **`src/utils/hooks/useAgentHealth.test.tsx:216`** — `advanceTimersByTime`
   not wrapped in `act`; can miss a state flush on slower workers (M).
6. **`src/components/aiTaskDraftModal/agent.test.tsx:189`** — `waitFor`
   used for synchronous mock-invocation assertions; over-tolerant retries
   can hide real ordering issues (M).

Cross-cutting numbers: 241 `waitFor` call-sites across 51 files; 22
`advanceTimersByTime` call-sites across 10 files (timer ownership pattern is
inconsistent); 3 files still use real wall-clock `setTimeout` in tests.

## Backend pytest

Source of truth: [`docs/test-flakiness/backend.md`](./backend.md).

Run command (from `backend/`):

```bash
pip install -e ".[dev,ai]"
pytest
```

Suite shape on this branch: **1042 passed, 1 skipped (environment-gated),
40 warnings** at 100% coverage.

Top suspects (ranked, see backend doc for full evidence):

1. **`backend/tests/test_agents_router_v21.py` (5 timeout/disconnect
   tests)** — drove cancellation paths via `asyncio.sleep(...)` plus a
   short `timeout` setting; wall-clock dependent. _Fixed in this PR_
   (`d650874`): replaced sleeps with `await asyncio.Event().wait()`,
   tightened timeouts to `0.1` so the cancellation branch is reached
   deterministically.
2. **`backend/tests/test_coverage_filling.py:1247, :1968`** — same pattern
   (sleep-based timeout setup). _Fixed in this PR_ (`244baaf`,
   `d650874`): `Event().wait()` plus `timeout=0.01` (avoids the
   immediate-scheduling edge race that `timeout=0` caused).
3. **`backend/tests/test_agents_postgres_live.py:28`** — live Postgres
   smoke test gated only inside test body, so collection could still run
   in mixed environments. _Fixed in this PR_ (`bcab537`): module-level
   `pytestmark = pytest.mark.skipif(...)` keyed on
   `PYTEST_AGENT_POSTGRES_URI`, with `importorskip` retained for optional
   extras.
4. **`backend/tests/test_agent_sse_transcripts.py:254`** — strict
   `(kind, surface)` sequence assertion across agents; will fail on
   harmless reordering. Recommended follow-up (S): switch to subsequence
   /contains assertions for invariant events.
5. **`backend/tests/test_redis_backends.py:282`** — wall-clock branch
   without frozen time; current assertion is coarse but ambient
   `time.time()` is a smell. Recommended follow-up (S): patch the clock.
6. **`backend/tests/test_ai_limits.py:193`** — "non-413 means pass"
   broadens what qualifies as a green test. Recommended follow-up (S):
   tighten to a specific accepted status set.
7. **`backend/tests/conftest.py:231-243`** — `store` fixture mutates
   `security.settings.jwt_secret` via `object.__setattr__` and does not
   restore it. Currently safe because every cross-test consumer goes
   through `store`; recommended follow-up (M) to add a finalizer that
   restores the prior value.

Marker hygiene: `xfail` and `flaky` markers do not appear anywhere; the
only `skipif`/`skip`/`importorskip` uses are justified
(`test_agents_postgres_live.py`, `test_vercel_config.py`).

## Shared test infrastructure

Source of truth: [`docs/test-flakiness/infra.md`](./infra.md).

Top patterns (ranked, see infra doc for the full ten):

1. **`jest.config.cjs` lacked `clearMocks` / `restoreMocks`.** Mock call
   histories and spy replacements could leak across tests. _Fixed in this
   PR_ (`38c7ad6`): set both flags. This is the highest-leverage infra
   change because it guards every Jest test in the repo.
2. **`MessageChannel` polyfill in `src/setupTests.ts` (lines 48–51)**
   schedules peer delivery via `window.setTimeout(..., 0)`. Tests that mix
   `MessageChannel` with `useFakeTimers()` can observe ordering races.
   Documented; **not changed** in this PR (high blast radius). Plan: add
   `runOnlyPendingTimers()` helpers in tests that need it before touching
   the polyfill.
3. **Global `fetch` is `jest.fn()` with no default resolution
   (`src/setupTests.ts:89-92`).** Combined with previously-missing
   `clearMocks`, this could surface as order-dependent failures when a
   test forgot to override the mock. With `clearMocks: true` now in place,
   the second-order risk drops materially.
4. **`moduleNameMapper` pins React Router to `dist/development/...`
   (`jest.config.cjs:10-15`).** A future React Router upgrade that moves
   those files will fail the suite hard (loud, not flaky), but is worth
   keeping in mind during dependency bumps.
5. **No frontend Jest workflow in `.github/workflows/`.** Only
   `backend-ci.yml` runs in CI today.
6. **Backend CI runs `pytest` once with no flaky quarantine / rerun.** Not
   urgent; treat any add of `pytest-rerunfailures` as a quarantine
   mechanism, not as a silent-retry on every PR.
7. **`__json_server_mock__/db.json` is stale vs `/api/v1`.** Not a Jest
   flake, but a common source of "looks-like-a-flake" reports during
   manual development.

## Fixes shipped in this PR

| Branch | Test / file | One-line cause | One-line fix |
| --- | --- | --- | --- |
| `orch/flaky-audit/test-infra-flaky-audit` | `jest.config.cjs` | Mock call history and spies leaked across tests. | Set `clearMocks: true` and `restoreMocks: true`. |
| `orch/flaky-audit/frontend-jest-flaky-audit` | `src/pages/project.test.tsx` | Debounce test waited on real `setTimeout`, racing under load. | Switched to fake timers + `await act(jest.advanceTimersByTime(400))`. |
| `orch/flaky-audit/frontend-jest-flaky-audit` | `src/components/taskModal/index.test.tsx` | `Modal.confirm` spy was restored only on the happy path. | Wrapped each delete-confirm test in `try/finally` and restored the spy in `finally`. |
| `orch/flaky-audit/frontend-jest-flaky-audit` | `src/components/aiTaskAssistPanel/index.test.tsx` | Suite-level `beforeAll(useFakeTimers)` leaked timer state across cases. | Per-test fake-timer ownership and an `act`-wrapped `advanceBy` helper. |
| `orch/flaky-audit/backend-pytest-flaky-audit` | `backend/tests/test_agents_router_v21.py` (5 tests) | Cancellation paths driven by `asyncio.sleep(...)`. | Replaced with `await asyncio.Event().wait()`; tightened `timeout` from `1` to `0.1`. |
| `orch/flaky-audit/backend-pytest-flaky-audit` | `backend/tests/test_coverage_filling.py` (`_with_disconnect` + v1 chat timeout) | Sleep-based timeout setup; `timeout=0` caused an immediate-scheduling edge race. | `Event().wait()` plus `timeout=0.01`. |
| `orch/flaky-audit/backend-pytest-flaky-audit` | `backend/tests/test_agents_postgres_live.py` | Live-service skip lived inside test bodies, not at collection time. | Module-level `pytestmark = pytest.mark.skipif(...)` keyed on `PYTEST_AGENT_POSTGRES_URI`. |

## Recommended follow-ups (not in this PR)

Ranked by expected impact, with rough effort tags (S = a single-file
hardening, M = a few files or a small infra change, L = cross-cutting work
or new CI infrastructure).

1. **Add a frontend Jest GitHub Actions workflow (M).** Runs `npm ci` and
   `NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit
   --detectOpenHandles` on PR + main. Optional `--shard` for parallelism.
   Without it, ordering / environment-only flakes only surface locally.
2. **Migrate `src/components/aiTaskAssistPanel/agent.test.tsx` to per-test
   fake timers (S).** Mirrors the pattern that landed in `index.test.tsx`
   in this PR.
3. **Wrap `jest.advanceTimersByTime` in `act` in
   `src/utils/hooks/useAgentHealth.test.tsx` (S).** Avoids missed state
   flushes on slow workers.
4. **Tighten `waitFor` usage in `aiTaskDraftModal/agent.test.tsx` and
   `boardBriefDrawer/agent.test.tsx` (S).** Replace `waitFor(() =>
   expect(start).toHaveBeenCalledTimes(1))` style with immediate
   assertions or `findBy*` where the transition is genuinely async.
5. **Relax strict full-sequence SSE assertions in
   `backend/tests/test_agent_sse_transcripts.py` (S).** Switch to
   subsequence/contains for invariant events; filter transient kinds
   before equality checks.
6. **Freeze time in `backend/tests/test_redis_backends.py:282` (S).**
   Patch `time.time` (or backend clock provider) to remove ambient
   wall-clock dependence in the default-now branch.
7. **Tighten `backend/tests/test_ai_limits.py:193` (S).** Replace `status
   != 413` with a narrow expected-status set so unrelated failures cannot
   pass silently.
8. **Restore `security.settings.jwt_secret` in the `store` fixture (M).**
   Add a finalizer that snapshots/restores the prior value, even though
   no current test depends on it.
9. **Refresh or replace `__json_server_mock__/db.json` (M).** Align with
   `/api/v1` shapes, or document a single supported mock entrypoint
   (likely MSW).
10. **Default global `fetch` mock to a benign resolution (S).** Set
    `mockResolvedValue(new Response("{}"))` in `setupTests.ts` so tests
    that forget to override it fail loudly instead of returning
    `undefined`.
11. **Add an explicit `testTimeout` to `jest.config.cjs` (S).** Currently
    relies on Jest's default; a tighter ceiling makes hung tests fail
    faster and louder on CI.
12. **Optional: `pytest-rerunfailures` on backend CI as a quarantine
    mechanism (M).** Pair with explicit `@pytest.mark.flaky` markers on
    individual tests so reruns are scoped and visible, not blanket
    retries on every PR.

## How to detect future flakes

The project does not currently run any of these tools. They are listed in
order of "easiest to land" and most signal-per-effort.

- **Run Jest with `--shuffle` locally and on CI.** Native to Jest 30+;
  reproduces order-dependent flakes that `clearMocks` alone cannot catch
  (e.g. module-state leaks). Pair with a fixed seed in CI logs so failed
  runs are reproducible.
- **`pytest-randomly`** for the backend. Randomizes test order per run,
  prints the seed, and supports replay (`-p randomly --randomly-seed=N`).
  Adds well under a second of overhead and is the lowest-friction way to
  flush out fixture-leak flakes.
- **`pytest-rerunfailures`** for the backend, used as a quarantine
  mechanism (`@pytest.mark.flaky(reruns=2)` on specific tests), not as a
  blanket retry on every test. Avoid `--reruns N` at the suite level.
- **`jest.retryTimes(N, { logErrorsBeforeRetry: true })`** scoped to a
  single suite while a flake is being investigated, plus an open issue.
  Same principle: visible quarantine, not blanket retries.
- **`jest --detectOpenHandles --forceExit` on CI** (already what
  `AGENTS.md` documents for local runs) so leaked handles surface as a
  CI failure instead of "the suite hung once."
- **Scheduled `pytest --count=N` job on `main`** (via `pytest-repeat`
  or `pytest-stress`) to get a statistical signal on whether a test
  fails 1/100 vs 1/10000 — the data needed to triage a real quarantine.
- **Surface `attention.log` / artifact diffs between two CI runs of the
  same SHA.** A green-then-red on the same SHA is the cheapest possible
  flake detector; just having that diff visible in the merge UI is half
  the battle.
- **Lightweight lint rule against real `setTimeout`/`asyncio.sleep` in
  test files** (custom ESLint and Ruff/flake8 rule). Both flake patterns
  fixed in this PR were variations of "test slept on real time"; a lint
  rule would have caught them at PR review.

