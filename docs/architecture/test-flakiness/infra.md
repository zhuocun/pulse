# Test infra flakiness audit (shared Jest, Babel, mocks, CI)

Scope: `jest.config.cjs`, `babel.config.cjs`, `src/setupTests.ts`, `src/test/**`, `__json_server_mock__/**`, `.github/workflows/**`. Backend `conftest.py` is cited read-only (owned by backend audit).

---

## 1. MessageChannel polyfill defers delivery on the macrotask queue

**Where:** `src/setupTests.ts` — `TestMessagePort.postMessage` schedules the peer handler with `window.setTimeout(..., 0)` (lines 48–51).

**Why it matters:** Any code that pairs `MessageChannel` traffic with `jest.useFakeTimers()` (or assumes microtask ordering relative to `Promise` settlement) can observe ordering races: macrotasks run after the current stack and after microtasks, and fake timers block timer-based delivery until advanced.

**Remediation:** Prefer documenting in tests that touch Workers/MessageChannel to call `jest.runOnlyPendingTimers()` / `advanceTimersByTime(0)` where needed, or migrate the polyfill to a microtask (`queueMicrotask`) **only** after proving no suite depends on timer-based deferral. Do not change lightly—high blast radius.

---

## 2. Global `fetch` is a bare `jest.fn()` with no stubbed resolution

**Where:** `src/setupTests.ts` lines 89–92.

**Why it matters:** Callers that `await fetch(...).json()` without overriding the mock in a given test may see rejected or inconsistent behavior depending on Jest version and whether the mock was left in a weird state by a previous test. Together with missing per-test mock reset (before this audit’s Jest change), that could surface as order-dependent failures.

**Remediation:** In setup, either leave as-is but ensure tests that hit `fetch` always `mockResolvedValueOnce` / MSW, or set a conservative default (`mockResolvedValue(new Response("{}"))`) and update tests that assert on “never called.”

---

## 3. Jest config lacked mock hygiene and lifecycle hooks

**Where:** `jest.config.cjs` (pre-change: only `collectCoverageFrom`, `moduleNameMapper`, `setupFilesAfterEnv`, `testEnvironment`, `transform`).

**Why it matters:** Without `clearMocks` / `restoreMocks`, `jest.fn` call histories and `jest.spyOn` replacements can leak across tests, producing `toHaveBeenCalledTimes` / implementation drift flakes. There is still no `resetModules: true` (usually too breaking for React apps), no explicit `testTimeout`, and no `globalSetup` / `globalTeardown` to catch **open handles** or leaked servers—the suite relies on `--detectOpenHandles` when run manually.

**Remediation:** Landed `clearMocks: true` and `restoreMocks: true` (see § Fixes on this branch). Optionally add an explicit `testTimeout` for slow CI. Consider a dedicated CI job with `--detectOpenHandles` if frontend tests are added to GitHub Actions.

---

## 4. `moduleNameMapper` pins React Router to `dist/development` paths

**Where:** `jest.config.cjs` lines 10–15 map `react-router`, `react-router-dom`, and `react-router/dom` into `node_modules/.../dist/development/...`.

**Why it matters:** Upstream package layout or production vs development export splits can change between minor releases; a mapper pointing at a removed file fails the entire suite hard (stable failure, but surprising during upgrades).

**Remediation:** After each `react-router` upgrade, verify the three files still exist (or switch to mapping to published `exports` targets if Jest supports the resolution). Keep a short comment in `jest.config.cjs` if the team standardizes on that check.

---

## 5. Babel test transform target ≠ `tsconfig` compile target

**Where:** `babel.config.cjs` line 3 uses `@babel/preset-env` with `{ targets: { node: "current" } }`; `tsconfig.json` line 3 sets `"target": "es5"`.

**Why it matters:** Vite builds the app with its own pipeline; Jest exercises code transformed for **modern Node**. You rarely get flakes from this, but you can get **divergent runtime behavior** vs production bundles for edge cases (async/generator, builtins). That mismatch is a correctness/testing-fidelity smell more than a classic flake.

**Remediation:** Accept as intentional (fast tests) or introduce a dedicated `tsconfig.jest.json` / Babel overrides aligned closer to the browser target if parity issues show up.

---

## 6. No GitHub workflow runs the frontend Jest suite

**Where:** `.github/workflows/backend-ci.yml` is the only workflow; it runs backend `pytest` only.

**Why it matters:** Local and Husky runs may differ from a missing CI matrix; ordering flakes and environment-only failures surface late.

**Remediation:** Add a `frontend-ci.yml` (or composite job) running `npm ci` and `npm test` with the same `NODE_OPTIONS` as in `AGENTS.md`. Optional: `jest --shard` for parallelism.

---

## 7. Backend `pytest` runs once with no flaky quarantine / rerun

**Where:** `.github/workflows/backend-ci.yml` lines 31–32 (`pip install` then `pytest`).

**Why it matters:** Legitimate product bugs aside, infra flakes (timeouts, IO) are not retried; a single red run blocks the merge with no signal as to “always fails vs rarely fails.”

**Remediation (sibling/backend):** Consider `pytest-rerunfailures` or a scheduled job with `pytest --count=10` on main for statistical flakiness—without masking real bugs via aggressive silent retries on every PR.

---

## 8. `__json_server_mock__/db.json` does not match the v1 API contract

**Where:** `__json_server_mock__/db.json` uses legacy shapes (`users.id` as number, `projects.personId`, etc.).

**Why it matters:** `AGENTS.md` documents that this mock is stale vs `/api/v1`. Tests or devs pointing the SPA at `npm run server` can see confusing failures that look “flaky” when mixed with MSW or real API tests.

**Remediation:** Regenerate or hand-align the JSON with the current OpenAPI/schema (owned change alongside contract tests), or document a single supported mock entrypoint in the frontend audit.

---

## 9. `backend/tests/conftest.py`: mutable JWT secret on `security.settings`

**Where:** `store` fixture (lines 231–238) assigns `jwt_secret` via `object.__setattr__` on `security.settings` and does not restore the prior value after the test.

**Why it matters:** Any test that relies on the default secret without using the `store` fixture could theoretically see cross-test pollution. **Do not modify in this worker** (backend-owned).

**Remediation (sibling/backend):** Consider saving/restoring the previous `jwt_secret` in a finalizer or moving secret mutation to a dedicated autouse fixture with guaranteed teardown.

---

## 10. `setupFilesAfterEnv` ordering (matchMedia, globals)

**Where:** `src/setupTests.ts`: `@testing-library/jest-dom` first (lines 5–6), `window.matchMedia` before `MessageChannel` / `fetch` / `ResizeObserver`.

**Why it matters:** No `jest.useFakeTimers` is enabled globally here—good—so the main ordering concern is components that read `matchMedia` at import time; the mock is installed before tests run. No change required today; flag if someone adds global fake timers without `doNotFake` for necessary APIs.

**Remediation:** If global fake timers are introduced, exclude `'queueMicrotask'` / timer APIs per Jest docs and re-validate MessageChannel polyfill behavior.

---

## Fixes landed on this branch (infra worker)

| Change                                                      | Rationale                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jest.config.cjs`: `clearMocks: true`, `restoreMocks: true` | Resets mock call state and restores spies between tests; reduces order-dependent mock leakage without altering mock implementations installed in `beforeEach`. |

Verification: full suite `NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles` — 146 suites, 1055 tests passed (see handoff).

---

## Suggested follow-ups for planner

- Frontend GitHub Actions job for Jest with documented `NODE_OPTIONS`.
- Backend CI: optional statistical rerun or `pytest-rerunfailures` with tight caps.
- Align or replace `__json_server_mock__` with current v1 shapes.
- Backend: restore `jwt_secret` after `store` fixture (if any cross-test oddities appear).
