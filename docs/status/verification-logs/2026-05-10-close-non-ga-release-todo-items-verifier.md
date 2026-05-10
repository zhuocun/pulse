# Verifier run — `close-non-ga-release-todo-items`

- **Branch:** `orch/non-ga-todos-2f52/close-non-ga-release-todo-items`
- **Commit at run:** `49f6eb5cca201788511c9cbcbd892d9193a021c8`
- **Date:** 2026-05-10

## Commands (excerpts)

Backend (from `backend/` with `/workspace/.venv`):

- `ruff check .` → All checks passed!
- `python -m pytest -q --cov-fail-under=100` → **1127 passed, 2 skipped**, **100.00%** line coverage (602 `task_vector_pg` and related modules covered); CoverageWarning on missing `app/agents/catalog/test_public_agent.py` parse (non-fatal).

Frontend (repo root):

- `npx eslint src --max-warnings 0` → exit 0
- `npm run typecheck` → `tsc --noEmit` exit 0
- `CI=true npm test -- --watchAll=false --runInBand` → **150 suites, 1085 tests** passed
- `npx vite build` → succeeded

## Doc audit (manual)

- `docs/status/release-todo.md`: numbered backlog items show **🛑 §1** open; **§2–§19** (and §7b) marked resolved with ✅ (or 🟡 resolved for §10–§12).
- `docs/status/product-done.md`: **`## What is open`** plus explicit §2/§4/§5/§6/§7 “At a glance” rows reconciled on `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` (see [`2026-05-10-release-todo-doc-hygiene-closeout.md`](2026-05-10-release-todo-doc-hygiene-closeout.md)).
