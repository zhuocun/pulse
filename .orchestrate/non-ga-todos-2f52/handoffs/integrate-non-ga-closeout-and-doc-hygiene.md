<!-- orchestrate handoff
task: integrate-non-ga-closeout-and-doc-hygiene
branch: orch/non-ga-todos-2f52/integrate-non-ga-closeout-and-doc-hygiene
agentId: bc-75b96c1b-76cc-4d0f-a4cf-ccf0a998c1c7
runId: run-39c3430e-20d3-4fd7-a668-680a6f0c3fc1
resultStatus: finished
finishedAt: 2026-05-10T16:18:16.176Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/integrate-non-ga-closeout-and-doc-hygiene`

## What I did
- Created the integration branch from `origin/orch/non-ga-todos-2f52/close-non-ga-release-todo-items`, merged `origin/orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout`, and resolved conflicts in `docs/todo/release-todo.md`, `docs/todo/product-done.md`, and `docs/todo/verification-logs/2026-05-10-close-non-ga-release-todo-items-verifier.md`.
- Reworked **`release-todo.md` §7** and the **FE/BE verification** blocks so they no longer assert fixed pytest/Jest totals; they now point at [`docs/todo/verification-logs/`](docs/todo/verification-logs/), document **`pip install -e '.[dev,ai]'`** as the CI **`test-full`** surface, and tell readers to use **`pytest -rs`** for skip reasons and to compare Jest’s trailing summary to the logs.
- Added [`docs/todo/verification-logs/2026-05-10-integrate-non-ga-closeout-and-doc-hygiene.md`](docs/todo/verification-logs/2026-05-10-integrate-non-ga-closeout-and-doc-hygiene.md) with command recipes plus one dated snapshot (including the slim-venv vs `[dev,ai]` caveat echoing the independent verifier). Updated the closeout verifier log to call out the install-surface dependency. Softened a few stray fixed counts in `product-done` (jest-axe row/table narrative).
- Pushed **only** that branch (no PR, no merge to `main`). Two commits: merge resolution + verification-log commit-pin tweak.

## Measurements
- `release-todo.md` §7 / FE snippet embedded pytest & Jest totals: present → **removed from status doc** (recipes + [`verification-logs/`](docs/todo/verification-logs/) only).
- `release-todo.md` **🛑** numbered GA items other than §1: **0** additional (only **§1** uses the open GA blocker heading).
- Backend `pytest` on integrated tree after `pip install -e '.[dev,ai]'`: **1127 passed, 2 skipped** `==` snapshot recorded in integrate verification log (same totals as prior closeout verifier); **FE Jest**: **150 suites, 1085 tests** `==` snapshot in same log.
- `ModuleNotFoundError: mcp` without `[ai]` install: reproduced on thin venv `<=` documented as environment drift (not a code contradiction).

## Verification
- `unit-test-verified` — Full backend `pytest` (with `[dev,ai]`) and root `CI=true npm test -- --watchAll=false --runInBand` were executed on the integrated working tree; `ruff check .` clean. Evidence captured in the integrate verification log; docs no longer hard-code those integers in §7/FE.

## Notes, concerns, deviations, findings, thoughts, feedback
- Numeric snapshots **only** live under `docs/todo/verification-logs/`; `release-todo.md` / `product-done.md` narratives avoid claiming a single universal pytest/Jest count because omitting `.[ai]` materially changes collection (the old independent verifier’s **1042 / 149** case).
- Merge brought in the hygiene branch’s verification artifacts (`2026-05-10-release-todo-doc-hygiene-*.md`); closeout verifier log still carries **1127 / 2 skipped** as a **dated** run with explicit install instructions, not as a contract in the main status doc.
- No screen recording: documentation-only scope, no UI bug fix.

## Suggested follow-ups
- Planner may want CI or `docs/operations` to link the **`pip install -e '.[dev,ai]'`** expectation once in a central place if writers keep missing it.
- Optional: soften remaining **fixed test counts** in `release-todo.md` polish §10/§11 (`18` / `20` tests) the same way if future verifiers flag them.