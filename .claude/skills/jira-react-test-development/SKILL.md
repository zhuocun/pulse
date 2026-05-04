---
name: jira-react-test-development
description: Develop, extend, and maintain unit and integration tests for this jira-react-app repository until coverage reaches 100%. Use when Codex is asked to add tests, improve Jest/React Testing Library coverage, continue from any existing coverage percentage, create test helpers, test React pages/components/hooks/utils/state, or verify frontend behavior against mocked API contracts in this project.
---

# Jira React Test Development

## Overview

Use this skill to continue test development for the React Jira-style app from any starting point. Treat every invocation as a resume from unknown progress: rebuild project context, audit existing tests, run coverage, then choose the next target.

## First Moves

1. Inspect the current state:
    - `git status --short`
    - `rg --files src __json_server_mock__ .agents/skills | sort`
    - `rg --files -g '*test.*' -g '*spec.*' src __json_server_mock__`
    - `sed -n '1,220p' package.json`
2. Reconstruct the current test system before editing:
    - Read `src/setupTests.ts` and any `src/test-utils*` or `src/**/test-utils*` files if they exist.
    - Read existing tests relevant to the next likely area. Use `rg "describe\\(|it\\(|test\\(" src __json_server_mock__` to identify conventions and covered behavior.
    - Note the current helper style, mocking style, provider wrappers, factories, module mocks, timer usage, and naming/location conventions.
    - Identify source files that already have tests and source files with no direct tests.
3. Run the current test suite with coverage before editing:
    - `CI=true npm test -- --watchAll=false --runInBand --coverage --coverageReporters=text --coverageReporters=json-summary --collectCoverageFrom='src/**/*.{ts,tsx}' --collectCoverageFrom='!src/**/*.d.ts' --collectCoverageFrom='__json_server_mock__/**/*.js'`
4. If the command fails because no tests exist, add the smallest infrastructure test first, then rerun.
5. Build a short working map for yourself before adding tests:
    - Existing test conventions to preserve.
    - Current coverage percentage and files below 100%.
    - The exact source file and behavior branch you will cover next.
    - Any product defect or testability issue discovered while reading.
6. Read only the reference files needed for the next task:
    - `references/project-map.md` for architecture, API contracts, known pitfalls, and current app behavior.
    - `references/test-patterns.md` for recommended Jest/RTL helpers, provider wrappers, fetch mocks, router setup, and Ant Design handling.
    - `references/test-inventory.md` for file-by-file coverage goals and scenario ideas.
    - `references/coverage-workflow.md` for how to continue from 5%, 60%, 99%, or any other coverage state.
    - `references/delegation-workflow.md` only when the user explicitly asks for subagents, delegation, or parallel test work.

## Quality Bar

Write tests that prove behavior, not implementation trivia. Prefer assertions visible to users, public hook returns, API call arguments, cache effects, navigation, localStorage, and DOM state over snapshots or shallow render checks.

Use React Testing Library for UI and integration tests. Use Jest unit tests for pure utilities, reducers/stores, optimistic update callbacks, API wrappers, and JSON-server middleware. Mock the network boundary with `global.fetch`; do not depend on the live JSON server.

Do not lower coverage thresholds, add broad coverage exclusions, or skip hard files to make the report green. Exclude only non-runtime declaration files and static assets. If a runtime file is awkward to test, add a seam through a small behavior-preserving refactor and test that behavior.

## Project-Specific Rules

- Use `npm test` because the project already ran under npm in this workspace. If existing future tests standardize on yarn, follow the repo's current convention.
- Co-locate tests with the file under test unless an existing convention appears. Good defaults are `src/utils/filterRequest.test.ts`, `src/components/projectList/index.test.tsx`, and `src/pages/board.test.tsx`.
- Keep `React.StrictMode` double effects in mind. Use `waitFor` and idempotent fetch mocks for components that trigger effects.
- The checked-in mock backend currently does not match the frontend API contract. Tests should mock the frontend's intended `/api/v1/...` contract, not the old `db.json` shape, unless specifically testing the mock server files.
- Use a fresh `QueryClient` per test with retries disabled. Clear `localStorage`, Jest mocks, and query caches between tests.
- Avoid mocking project modules in integration tests unless the browser or network boundary requires it. Leaf component tests may mock custom hooks when that isolates the component behavior.

## Coverage Strategy

Work in thin vertical passes until global statements, branches, functions, and lines are all 100%.

1. Build or reuse shared test helpers.
2. Cover pure utilities and optimistic callbacks first because they are stable and raise coverage quickly.
3. Cover hooks with realistic router/query/auth contexts.
4. Cover leaf components with focused UI tests.
5. Cover forms, modals, pages, and route flows with integration tests.
6. Cover drag/drop and React Query mutation branches with direct hook tests and controlled component integration tests.
7. Use coverage output to close remaining uncovered lines and branches one file at a time.

At the end of each test-development session, rerun full coverage, summarize remaining uncovered files/branches, and leave tests deterministic.

## Parallel Delegation

Use parallel subagents only when the user explicitly asks for subagents, delegation, or parallel agent work. When enabled, first rebuild context and run baseline coverage locally, then read `references/delegation-workflow.md` before spawning workers.

The coordinator must assign disjoint write ownership. Shared files such as `src/setupTests.ts`, `src/test-utils.tsx`, `src/test-utils/`, `package.json`, and lockfiles need exactly one owner, or the coordinator keeps them local. Every worker must know it is not alone in the codebase, must avoid reverting other edits, and must report changed paths and validation results.

## Completion Criteria

Stop only when all are true:

- Full test command passes.
- Coverage report shows 100% statements, branches, functions, and lines for the agreed runtime scope.
- Tests cover success, failure, empty/loading, and branch behavior where the code has those states.
- No test depends on execution order, real timers without control, live network, or the running dev server.
- Existing user changes outside the test work are left intact.
