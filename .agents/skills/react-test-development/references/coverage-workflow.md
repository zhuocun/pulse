# Coverage Workflow

Use this workflow whenever continuing test work from an unknown progress level.

## Contents

- Rebuild Context First
- Determine Current Progress
- Choose The Next Target
- Coverage-stage workflows from 0% through 99%
- Testability refactor guidance
- Coverage Scope
- Running Tests
- Definition Of A Good Test
- Session Handoff

## Rebuild Context First

Before choosing or writing tests, understand the current state of the test suite:

```bash
git status --short
rg --files -g '*test.*' -g '*spec.*' src __json_server_mock__
rg "describe\\(|it\\(|test\\(" src __json_server_mock__
rg --files src | sort
```

Then read:

- `package.json` for scripts, dependencies, and current test command shape.
- `src/setupTests.ts` for global matchers, browser polyfills, and cleanup behavior.
- Any shared helpers or factories, commonly `src/test-utils.tsx`, `src/test-utils/`, `src/**/test-utils.*`, or `src/**/__tests__/helpers.*`.
- Existing tests near the area you plan to touch.
- The source file under test and its direct dependencies.

Produce a small private working map before editing:

- Current test locations and naming convention.
- Shared render/helper/factory style.
- Existing mocks for fetch, router, React Query, Ant Design, timers, and browser APIs.
- Behaviors already covered for the target area.
- Behaviors missing according to source branches and coverage output.

Do not add a new helper, mock pattern, or test location if an equivalent convention already exists.

## Determine Current Progress

Run:

```bash
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text --coverageReporters=json-summary --collectCoverageFrom='src/**/*.{ts,tsx}' --collectCoverageFrom='!src/**/*.d.ts' --collectCoverageFrom='__json_server_mock__/**/*.js'
```

If coverage JSON exists, inspect it:

```bash
sed -n '1,220p' coverage/coverage-summary.json
```

If text output is truncated, inspect HTML locally or grep lcov:

```bash
rg "SF:|DA:|BRDA:" coverage/lcov.info
```

Do not assume old progress from conversation. Current files and coverage output are the source of truth.

## Choose The Next Target

Pick targets in this order:

1. Files with 0% coverage and simple logic.
2. Files with low branch coverage.
3. Files with high user impact: auth, project CRUD, board/task CRUD, drag/drop payloads.
4. Files with uncovered error or empty/loading states.
5. Remaining one-line entry/config files.

Within a target file:

- Read the source and existing tests.
- Identify public behavior and branches.
- Add the smallest useful set of tests.
- Run that file's tests.
- Run full coverage after every small batch.

## If Coverage Is Around 0-20%

Start with infrastructure and pure files:

- Add `src/test-utils.tsx` and factories only if at least two tests need them.
- Cover `filterRequest`, `getError`, `useDebounce`, `useTitle`, optimistic callbacks, and MobX/Redux stores.
- Add `useApi` and auth API tests with fetch mocks.
- Run full coverage and update the target list.

Avoid starting with Ant Design modals, routes, or drag/drop unless the user explicitly asks. Early flaky tests slow down the rest of the work.

## If Coverage Is Around 20-60%

Move to hooks and leaf components:

- Cover `useAuth`, `useReactQuery`, `useReactMutation`, `useUrl`, `useTaskModal`, and `useProjectModal`.
- Cover `ErrorBox`, `Status`, `Row`, `PageContainer`, search panels, creators, popovers, and forms.
- Add provider wrappers and factories as repetition appears.
- Keep each test focused on one behavior branch.

Prioritize branch coverage over line coverage in this phase.

## If Coverage Is Around 60-90%

Move to integration behavior:

- Cover `HomePage`, auth layout switching, route redirects, login/register flows, project page fetch/search/list behavior, project modal create/edit, board rendering, task filtering, task modal edit/delete, column/task creation.
- Use real React Query, router, and user events.
- Mock only `fetch`, browser APIs, and hard-to-observe Ant Design static methods.
- Add error, loading, and empty-state tests for pages.

Run full coverage often. Integration tests can accidentally cover many files and change the best next target.

## If Coverage Is Around 90-99%

Close exact uncovered lines and branches:

- Open the HTML coverage report for the specific file.
- Add targeted tests for conditional branches, default fallbacks, and error paths.
- Cover entry files such as `index.tsx`, `routes/index.tsx`, `appProviders`, `reportWebVitals`, and mock middleware if they remain included.
- Avoid broad snapshots. One uncovered branch usually needs one direct assertion.

Common final branches:

- Error shape fallbacks.
- Loading vs loaded states.
- `enabled=false` query path.
- Modal delete disabled logic.
- Mock item `_id === "mock"` paths.
- `types.length > 1` vs default Task/Bug options.
- Missing created date.
- Unknown manager fallback.
- `destination` missing in drag/drop.

## If Full Coverage Fails Because Of Testability

Prefer a behavior-preserving refactor over brittle tests:

- Extract pure calculation from a component when the calculation is important.
- Export a small helper only if it has real domain meaning.
- Keep UI behavior unchanged.
- Add tests before and after refactor when practical.

Do not refactor broad architecture just for tests. If a file is only hard because of browser APIs, mock the browser boundary instead.

## Coverage Scope

Default runtime scope:

- Include `src/**/*.{ts,tsx}`.
- Exclude `src/**/*.d.ts`.
- Include `__json_server_mock__/**/*.js` when the user expects project-wide coverage.
- Static SVG assets do not need unit tests.

If the user demands literal repository-wide runtime coverage, add tests for:

- `craco.config.js` by requiring it and asserting Less variables/plugin config.
- `commitlint.config.js` by requiring it and asserting conventional config.
- `__json_server_mock__/middleware.js`.

Do not include lockfiles, `package.json`, static assets, type declarations, or generated coverage output in coverage.

## Running Tests

Targeted test:

```bash
CI=true npm test -- --watchAll=false --runInBand src/utils/filterRequest.test.ts
```

Full coverage:

```bash
CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text --coverageReporters=json-summary --collectCoverageFrom='src/**/*.{ts,tsx}' --collectCoverageFrom='!src/**/*.d.ts' --collectCoverageFrom='__json_server_mock__/**/*.js'
```

When tests use fake timers:

- `jest.useFakeTimers()` inside the test or `beforeEach`.
- `jest.runOnlyPendingTimers()` if needed.
- `jest.useRealTimers()` in `afterEach`.

When tests mock modules:

- Reset module registry only for env/import-time tests.
- Restore spies in `afterEach`.
- Avoid persistent module mocks that affect later integration tests.

## Definition Of A Good Test

A good test:

- Has a name that states behavior.
- Arranges realistic input.
- Exercises the public path a user or caller uses.
- Asserts the externally visible result.
- Fails for a real regression.
- Does not overfit to internal implementation.

Examples of weak tests to avoid:

- Snapshot-only coverage of a complex component.
- Testing that a hook calls `useState`.
- Asserting Emotion-generated class names.
- Asserting every Ant Design DOM wrapper.
- Mocking the component under test's own important behavior.

## Session Handoff

Before stopping:

- Run full coverage or state why it could not run.
- Report changed test/helper files.
- Report current coverage percentages and remaining files below 100%.
- Mention any product defects discovered by tests.
- Leave long-running dev servers alone unless the user asked to stop them.
