<!-- orchestrate handoff
task: release-todo-doc-hygiene-closeout
branch: `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` @ `2c03083`
agentId: bc-2ff6a07b-498d-41b4-b9b1-9951a703bc74
runId: run-e260e956-e8a7-4cb3-a66c-ca53933bcfcd
resultStatus: finished
finishedAt: 2026-05-10T16:07:59.655Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout` @ `2c03083`

## What I did
- Rebased the status narrative on `origin/orch/non-ga-todos-2f52/close-non-ga-release-todo-items`’s `release-todo.md`, then reconciled verifier deltas: §7 pytest **`1075` → `1127 passed`, `2 skipped`**, FE block **`146` → `150` suites**, Out-of-scope **Auth** bullet aligned with **resolved §3** + `product-done`, Tier 6 / TL;DR / ship sequence / readiness tables / §12 cross-refs so §4 reads as **shipped optional path + operator backfill** (not “still soft-blocker open”), §7 heading + CI matrix row no longer contradict closure.
- Updated `product-done.md`: added **five explicit “At a glance” rows** with `[release-todo.md](release-todo.md) §2`, **§4**, **§5**, **§6**, **§7**; rewrote **`## What is open`** so only **GA §1** remains the numbered code gate; replaced stale hard-coded FE/backend suite counts in **Test coverage** with pointers to `release-todo` verification snippets + `verification-logs/` + reruns.
- Added **`docs/status/verification-logs/`**: imported **`2026-05-10-close-non-ga-release-todo-items-verifier.md`**, added **`2026-05-10-release-todo-doc-hygiene-closeout.md`**, and refreshed the verifier log’s doc-audit line to cite the hygiene branch.

## Measurements
- product-done explicit `[release-todo.md](release-todo.md) §§` closure rows for §2/§4/§5/§6/§7 (non-GA sweep): **0 → 5**
- release-todo §7 cited pytest total (same `--cov-fail-under=100` run family): **1075 passed → 1127 passed**
- release-todo FE verification comment (`CI=true npm test …`): **146 suites → 150 suites**

## Verification
not-verified (documentation consistency pass only; numeric reconciliation comes from the imported verifier log and intentional doc edits — full BE/FE suites were not re-run on this worker).

## Notes, concerns, deviations, findings, thoughts, feedback
- **Large `release-todo.md` diff vs `main`**: this branch carries the full upstream closeout doc body from `close-non-ga-release-todo-items`, not only the small reconciliation edits — planner merge order should assume **`close-non-ga-release-todo-items` (implementation) + this hygiene branch** or equivalent squash so `main` never briefly claims §2–§7 resolved without the corresponding code.
- **`product-done` ↔ reality**: rows describe features asserted closed on the orchestrator branch; until that implementation merges to `main`, humans should treat the Status header’s orchestrator-branch caveat as binding.

## Suggested follow-ups
- Planner: merge/rebase **`orch/non-ga-todos-2f52/close-non-ga-release-todo-items`** ahead of (or together with) this branch so live code and status docs stay jointly truthful.
- Optional: archive a **pinned green GitHub Actions URL** for Backend CI when ops have one, then cite it from §7 without weakening the verifier-log fallback.