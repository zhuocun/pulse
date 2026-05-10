<!-- orchestrate handoff
task: test-infra-flaky-audit
branch: orch/flaky-audit/test-infra-flaky-audit
agentId: bc-812a3b59-ce5a-4efb-a198-31a17678576e
runId: run-a94c97c4-3303-4aa1-ba4b-3c0146d0b1e2
resultStatus: finished
finishedAt: 2026-05-10T01:42:04.134Z
-->

## Status
success

## Branch
`orch/flaky-audit/test-infra-flaky-audit`

## What I did
- Added `docs/test-flakiness/infra.md`: sectioned infra flakiness audit with **10** patterns, each with concrete `path:line` citations, impact, and remediation (including read-only notes for `backend/tests/conftest.py` and backend CI per scope rules).
- Updated `jest.config.cjs`: set `clearMocks: true` and `restoreMocks: true` so mock call history and spies reset between tests (one surgical infra change addressing mock leakage).
- Did **not** change `src/setupTests.ts`, `babel.config.cjs`, `src/test/**`, `__json_server_mock__/**`, or `.github/workflows/**` beyond documentation in the audit—MessageChannel `setTimeout(0)` and related items are documented as high–blast-radius.
- Pushed two commits: `test(jest): reset mock state between tests`, `docs(test): audit shared Jest and CI test infra for flakiness`.

## Measurements
- `Jest suites (NODE_OPTIONS=--max-old-space-size=8192, --forceExit --detectOpenHandles):` 146 passing `==` 146 passing
- `Jest tests:` 1055 passing `==` 1055 passing

## Verification
unit-test-verified — Ran `NODE_OPTIONS=--max-old-space-size=8192 npx jest --forceExit --detectOpenHandles` after the Jest config change; **146 suites / 1055 tests passed** (~105 s). No live UI involved.

## Notes, concerns, deviations, findings, thoughts, feedback
- Cloud task asked for branch `orch/flaky-audit/test-infra-flaky-audit` and **no PR**; integration is left to the planner.
- Pre-commit surfaces an **existing** eslint warning in `src/components/aiChatDrawer/index.tsx` (jsx-a11y); it does not block commits. I did not touch that file.
- Combined `clearMocks` + `restoreMocks` into one Jest change (two flags, one behavioral goal). No second code change after full-suite green; remaining items are documented recommendations (frontend CI, backend reruns, mock DB alignment, optional `jwt_secret` teardown in sibling-owned `conftest.py`).

## Suggested follow-ups
- Add a GitHub Actions workflow that runs frontend Jest with the documented `NODE_OPTIONS` and optionally `--detectOpenHandles` on a schedule or main.
- Backend CI: evaluate `pytest-rerunfailures` or controlled `--count=N` flakiness detection without hiding real failures on every push.
- Refresh `__json_server_mock__/db.json` (or replace usage) so it matches the current `/api/v1` contract and stops confusing “flake-like” local failures.
- Backend worker: consider restoring `security.settings.jwt_secret` after the `store` fixture if any cross-test secret dependency appears.