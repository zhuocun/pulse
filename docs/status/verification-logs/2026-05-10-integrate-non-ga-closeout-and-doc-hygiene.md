# Verification — integrate non-GA closeout + doc hygiene

- **Branch:** `orch/non-ga-todos-2f52/integrate-non-ga-closeout-and-doc-hygiene`
- **Commit for this snapshot:** run `git log -1 --format=%H -- docs/status/verification-logs/2026-05-10-integrate-non-ga-closeout-and-doc-hygiene.md`

## Purpose

Record a reproducible backend + frontend check after merging
`close-non-ga-release-todo-items` with `release-todo-doc-hygiene-closeout`.
`docs/status/release-todo.md` intentionally **does not** embed fixed
pytest/Jest totals (they drift with optional extras, markers, and new tests);
compare any run to this log and the recipes in **BE verification** / **FE
verification** in [`release-todo.md`](../release-todo.md).

- **Date:** 2026-05-10

## Backend (match CI `test-full` install surface)

```bash
source /workspace/.venv/bin/activate
cd /workspace/backend
python -m pip install -e '.[dev,ai]'
ruff check .
python -m pytest -q --tb=no
```

Observed summary (this runner):

```text
1127 passed, 2 skipped, 40 warnings in 17.89s
```

Skip reasons (`python -m pytest -q -rs --tb=no`):

- `tests/integration/test_integration_gate.py` — set `RUN_INTEGRATION=1` for real-stack checks.
- `tests/test_agents_postgres_live.py` — set `PYTEST_AGENT_POSTGRES_URI` for live Postgres smoke.

**Slim venv counterexample:** If `mcp` (from `[ai]`) is not installed, MCP wiring tests are not collected the same way as CI — see [`2026-05-10-release-todo-doc-hygiene-indep-verifier.md`](2026-05-10-release-todo-doc-hygiene-indep-verifier.md).

## Frontend

```bash
cd /workspace
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use
NODE_OPTIONS=--max-old-space-size=8192 CI=true npm test -- --watchAll=false --runInBand
```

Observed summary (this runner):

```text
Test Suites: 150 passed, 150 total
Tests:       1085 passed, 1085 total
Time:        ~95s
```

## Doc consistency (manual)

- [`release-todo.md`](../release-todo.md): single **🛑** numbered gate under GA blockers (§1); Beta/soft §2–§7 and polish resolutions match integrated branch narrative.
- [`product-done.md`](../product-done.md): **What is open** — only GA §1; **At a glance** includes closure rows for former Beta/soft items with links back to `release-todo.md` §N.
