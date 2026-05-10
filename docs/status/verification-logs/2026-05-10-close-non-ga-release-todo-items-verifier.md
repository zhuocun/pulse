# Verifier run — `close-non-ga-release-todo-items`

- **Branch:** `orch/non-ga-todos-2f52/close-non-ga-release-todo-items`
- **Commit at run:** `49f6eb5cca201788511c9cbcbd892d9193a021c8`
- **Date:** 2026-05-10

## Commands (excerpts)

Backend (from `backend/` with `/workspace/.venv`):

- Match CI **`test-full`** dependency surface before counting tests:
  `python -m pip install -e '.[dev,ai]'` (a venv without `[ai]` omits MCP-backed modules and runs fewer tests — see
  [`2026-05-10-release-todo-doc-hygiene-indep-verifier.md`](2026-05-10-release-todo-doc-hygiene-indep-verifier.md)).
- `ruff check .` → All checks passed!
- `python -m pytest -q --cov-fail-under=100` → **1127 passed, 2 skipped**, **100.00%** line coverage (CoverageWarning on
  missing `app/agents/catalog/test_public_agent.py` parse treated as non-fatal in this log).
- `python -m pytest -q -rs --tb=no` → skips: `RUN_INTEGRATION=1` integration gate;
  `PYTEST_AGENT_POSTGRES_URI` live Postgres smoke.

Frontend (repo root):

- `npx eslint src --max-warnings 0` → exit 0
- `npm run typecheck` → `tsc --noEmit` exit 0
- `CI=true npm test -- --watchAll=false --runInBand` → Jest summary on this runner: **150 suites**, **1085 tests** passed
- `npx vite build` → succeeded

## Doc audit (manual)

- `docs/status/release-todo.md`: numbered backlog items show **🛑 §1** open; **§2–§19** (and §7b) marked resolved with ✅ (or 🟡 resolved for §10–§12).
- `docs/status/product-done.md`: **`## What is open`** plus “At a glance” align with only GA §1 as the active code gate after the hygiene sweep.
