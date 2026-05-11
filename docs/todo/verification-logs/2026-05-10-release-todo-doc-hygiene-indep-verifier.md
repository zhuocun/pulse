# Independent verifier — `release-todo-doc-hygiene-closeout` doc audit

- **Branch verified:** `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` @ `2c03083`
- **Date:** 2026-05-10
- **Scope:** `docs/todo/release-todo.md` + `docs/todo/product-done.md` consistency with AGENTS backlog rules; live pytest/Jest counts vs doc hard-codes.

## Doc audit (read-only)

### Non-GA `release-todo.md` gates

- Only **`### 🛑 1.`** in “GA blockers” uses “still open” / active blocker language. Beta §2/§3/§6 and soft §4/§5/§7/§7b etc. are marked **✅ Resolved** (or equivalent). No additional numbered **🛑** items beyond §1.

### `product-done.md` “At a glance” closure rows (sweep §2/§4/§5/§6/§7)

Explicit `[release-todo.md](release-todo.md) §N` rows present for **§2**, **§4**, **§5**, **§6**, **§7** (table lines 42–46). §3 also has a dedicated row (line 56); not part of the five-item sweep but consistent with closed Beta §3.

### `product-done.md` “What is open” vs `release-todo.md`

- Both state **only GA §1** remains the open **code** gate among numbered release-todo items; non-GA items are described as closed on the orchestrator branch with operator caveats. No direct contradiction found on **open vs closed** status (aside from **numeric evidence** below).

### Stale hard-coded counts in `release-todo.md` (fails live reconciliation)

**Document claims** (`release-todo.md`):

- §7 body: `1127 passed`, `2 skipped` (integration gate).
- FE verification snippet: `150 suites`.

**Observable runs on this VM** (same branch):

```text
# Backend (venv: /workspace/.venv, cwd: /workspace/backend)
$ source /workspace/.venv/bin/activate && python -m pytest -q --tb=no
1042 passed, 1 skipped, 40 warnings in ~20s
# Skip reason: tests/test_agents_postgres_live.py — PYTEST_AGENT_POSTGRES_URI not set (not “integration gate”)
```

```text
# Frontend (Node from .nvmrc)
$ cd /workspace && NODE_OPTIONS=--max-old-space-size=8192 CI=true npm test -- --watchAll=false --runInBand
Test Suites: 149 passed, 149 total
Tests:       1082 passed, 1082 total
```

**Delta:** pytest totals and skip count/reason do not match §7; Jest **suite** count is **149** vs documented **150**.

`product-done.md` “Test coverage” correctly defers authoritative counts to reruns, but **`release-todo.md` still embeds stale integers** in §7 and the FE snippet, so the “no stale hard-coded counts” acceptance criterion is **not** satisfied for those lines.

## Verdict (for planner)

- Backlog **closure hygiene** (§2/§4/§5/§6/§7 rows; only §1 open in narrative): **pass**.
- **Numeric / evidence strings** in `release-todo.md`: **fail** vs live runs on this commit.
