<!-- orchestrate handoff
task: verify-non-ga-release-todo-closure
branch: `orch/non-ga-todos-2f52/close-non-ga-release-todo-items` @ `9cf7045` (verifier-added log only atop worker `49f6eb5`)
agentId: bc-9d1e35aa-a73a-446e-abb9-790c17c3a870
runId: run-fd68b602-d3ca-4c78-8692-c8f45a89ddfe
resultStatus: finished
finishedAt: 2026-05-10T16:03:20.789Z
-->

## Verification
 
`unit-test-verified`

## Target
`close-non-ga-release-todo-items` on branch `orch/non-ga-todos-2f52/close-non-ga-release-todo-items`

## Branch
`orch/non-ga-todos-2f52/close-non-ga-release-todo-items` @ `9cf7045` (verifier-added log only atop worker `49f6eb5`)

## Execution
- → `cd /workspace/backend && /workspace/.venv/bin/ruff check .` → **All checks passed!**
- → `cd /workspace/backend && /workspace/.venv/bin/python -m pytest -q --cov-fail-under=100` → **1127 passed, 2 skipped**, **TOTAL … 5968 stmts / 100.00%** line coverage; non-fatal `CoverageWarning` about missing/unparseable `app/agents/catalog/test_public_agent.py` in coverage data
- → `cd /workspace && npx eslint src --max-warnings 0` → exit **0**
- → `cd /workspace && npm run typecheck` → `tsc --noEmit` exit **0**
- → `cd //workspace && CI=true npm test -- --watchAll=false --runInBand` → **150** suites / **1085** tests passed
- → `cd /workspace && npx vite build` → **✓ built** (production client bundle)
- → Read `docs/status/release-todo.md` and `docs/status/product-done.md` for backlog vs `release-todo` § numbering and AGENTS hygiene
- → Wrote `docs/status/verification-logs/2026-05-10-close-non-ga-release-todo-items-verifier.md`, committed **“docs: add verifier evidence log for non-GA release-todo closeout”**, pushed to `origin/orch/non-ga-todos-2f52/close-non-ga-release-todo-items`

## Findings
Per acceptance criterion:
- **`release-todo` open backlog limited to GA §1:** [x]: **Met** — every numbered blocker/polish line from §2 onward is ✅ (or legacy 🟡 resolved for §10–§12); only **§1** keeps **🛑** and “still open” narrative. Operational caveats remain in **Backend/Frontend readiness tables** (e.g. estimate/search **⚠️** “quality bounded by §4”, **CI matrix ⚠️** / §7 note), which are status caveats rather than unresolved § headings.
- **AGENTS backlog hygiene (`product-done` rows for closures in this task):** [ ]: **Not met**
  - **Missing dedicated “At a glance” one-liners** (with `[release-todo.md](release-todo.md) §…` pointers) for **§2** (provider failover / `with_fallbacks`), **§4** (optional pgvector / `AGENT_VECTOR_SEARCH_ENABLED`), **§5** (`PolishStep` / `method="json_schema"`), **§6** (`integration` marker + `RUN_INTEGRATION=1` gate), and **§7** (BE CI / manual dispatch rationale). **§3** has an explicit JWT row; **§13–§16d** are covered via combined/other rows (`§13–§14`, MCP, LangGraph hint, consumer hook, model map, multi-worker guard).
  - **`## What is open` in `product-done.md` (lines 377–384)** still states the **three Beta blockers** and search/estimation ceiling **gate design-partner expansion**, which contradicts this branch’s `release-todo` (Beta/soft/polish through §16d marked resolved subject to caveats/backfill).

Other findings (severity-ordered):
- **(high):** **`product-done.md` backlog hygiene incomplete** vs AGENTS (“close in `*-todo.md` **and** add one-liner in `product-done.md`”) and vs target AC (“one-line entries for **each** non-GA … closure”).
- **(med):** **`release-todo.md` inconsistency:** under **Out of scope → Auth**, it still says “**Open security item: see Beta Blocker §3**” while **§3** is marked ✅ resolved.
- **(med):** **§7 body** cites **`1075 passed`** whereas this verifier run shows **1127 passed** — evidence line is stale vs current suite.
- **(low):** **FE verification block** lists **146** Jest suites; current run reports **150** suites.

No live-browser UI excursion for these changes (mostly contracts, BE behavior, tooling); verification is **automated suites + doc audit**, not **`live-ui-verified`**.

## Notes & suggestions
- **Do not treat the closeout docs as planner‑sign‑off‑clean** until `product-done` gains explicit rows for **§2, §4, §5, §6, §7** (and/or a clearly scoped merge of those into dated rows so every closed § in this task maps 1:1), and **`## What is open` + Out-of-scope Auth bullet** align with **`release-todo`**.
- **Code + default CI posture:** rerun after any planner integration; this run’s Python/JS bits match worker **`49f6eb5`**; verifier commit **`9cf7045`** adds only `docs/status/verification-logs/2026-05-10-close-non-ga-release-todo-items-verifier.md`.
- **`RUN_INTEGRATION=1`** real-stack path was **not** exercised here; skipped integration tests behaved as upstream described (default hermetic **`1127 passed, 2 skipped`**).
- **`unit-test-verified`** is grounded in executing **ruff**, **pytest** with **`--cov-fail-under=100`**, **eslint`, **tsc**, **jest**, and **vite build** successfully; **`verifier-failed`** did not apply to the codebase under those commands.