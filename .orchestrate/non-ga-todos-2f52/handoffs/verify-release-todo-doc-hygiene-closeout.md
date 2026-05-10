<!-- orchestrate handoff
task: verify-release-todo-doc-hygiene-closeout
branch: `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` @ `cf2ddac` (pushed after adding `docs/status/verification-logs/2026-05-10-release-todo-doc-hygiene-indep-verifier.md`)
agentId: bc-b86205d5-239c-4917-a085-fe0e1a140009
runId: run-04cbba5a-5c63-47dc-8839-2ff4f01cd9cf
resultStatus: finished
finishedAt: 2026-05-10T16:12:36.635Z
-->

## Verification

`verifier-failed`

Live pytest and Jest runs on this branch do **not** match the hard-coded totals in `release-todo.md` (§7 and the FE verification block). Backlog narrative hygiene (only GA §1 open, five `product-done` §2/§4/§5/§6/§7 rows) checks out from file review.

## Target

`release-todo-doc-hygiene-closeout` on branch `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout`

## Branch

`orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` @ `cf2ddac` (pushed after adding `docs/status/verification-logs/2026-05-10-release-todo-doc-hygiene-indep-verifier.md`)

## Execution

- Read and cross-checked `docs/status/release-todo.md` and `docs/status/product-done.md` for open vs ✅-closed numbered gates and `product-done` “At a glance” links.
- `source /workspace/.venv/bin/activate && cd /workspace/backend && python -m pytest -q --tb=no` → **`1042 passed, 1 skipped`**; **`100%` line coverage** met; **`1042 passed, 1 skipped, 40 warnings in ~19–22s`** on repeated run.
- Same venv: `python -m pytest -q --tb=no -rs` → single skip: **`tests/test_agents_postgres_live.py`** requires **`PYTEST_AGENT_POSTGRES_URI`** (not the “integration gate” wording used in §7).
- `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" && nvm use` (Node **v24.15.0**), `cd /workspace && NODE_OPTIONS=--max-old-space-size=8192 CI=true npm test -- --watchAll=false --runInBand` → **`Test Suites: 149 passed, 149 total`**, **`Tests: 1082 passed, 1082 total`**, ~94s.
- Wrote and pushed verifier log with the above output captured for the planner.

## Findings

Per acceptance criterion:

- [x] **product-done has explicit one-line closure entries for §2, §4, §5, §6, §7 from this sweep:** met (table rows with `[release-todo.md](release-todo.md) §2` … `§7`).
- [x] **release-todo and product-done no longer contradict each other about what remains open (except GA §1):** met for **open/closed semantics** (only §1 is the active numbered code gate; both docs align on “only GA §1” for that role).
- [ ] **Updated docs reference current test/suite counts or avoid stale hard-coded counts:** **not met** — `release-todo.md` still states **`1127 passed`, `2 skipped (integration gate)`** and **`150` Jest suites**; live runs on this commit are **`1042 passed`, `1 skipped`** (postgres live smoke) and **`149` suites**.

Verifier-specific acceptance criteria:

- [ ] **Verifier confirms AGENTS doc-close requirements are met for this sweep:** **partially** — closing entries + single §1 gate narrative are satisfied; **numeric evidence strings in `release-todo.md` are not trustworthy vs reruns**.
- [x] **Only GA blocker §1 remains open in release-todo:** met (no other **🛑** numbered GA items; Beta/soft sections for §2–§7 are ✅ Resolved in prose).

Other findings (severity-ordered):

- **(high)** `release-todo.md` §7 and the **FE verification** snippet embed **incorrect** pytest and Jest **suite** totals relative to **`2c03083` / `cf2ddac`** runs (`1127`/`2` vs `1042`/`1`; `150` vs `149`).
- **(med)** Documented **skip reason** (“integration gate”, two skips) does **not** match the observed **single** skip (`test_agents_postgres_live.py` / `PYTEST_AGENT_POSTGRES_URI`).
- **(low)** `product-done.md` still carries some **fixed** test counts in long-form narrative (e.g. **31** jest-axe tests); the “Test coverage” section correctly points readers to reruns, but those inline integers can still go stale.

## Notes & suggestions

- Treat **`docs/status/verification-logs/2026-05-10-release-todo-doc-hygiene-indep-verifier.md`** on **`cf2ddac`** as the live counterexample to the §7 / FE snippet numbers until the worker refreshes them (or removes hard-coded totals entirely).
- Planner should **not** treat this hygiene branch as “numeric reconciliation verified” without editing `release-todo.md` to match a fresh CI/local log or replacing integers with “see latest verifier log / CI artifact” only.