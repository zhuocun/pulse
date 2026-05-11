<!-- orchestrate handoff
task: docs-status-hygiene
branch: orch/todo-sweep-566b/docs-status-hygiene
agentId: bc-3039ecc1-d004-4d34-b47a-968fef6a5f3a
runId: run-fa4946f0-ad0e-4aea-8a76-23a4e2fa33f5
resultStatus: finished
finishedAt: 2026-05-11T05:11:10.466Z
-->

## Status
success

## Branch
`orch/todo-sweep-566b/docs-status-hygiene`

## What I did
- Updated `docs/todo/ui-todo.md` for the five verifier-backed workers: struck completed sub-bullets and added **`[Complete on branch …]`** notes with evidence paths for **fix-project-detail-shell**, **chat-drawer-polish**, **auth-form-completion**, **dnd-affordances**, and **feedback-parity** (open-backlog **§20b** line and **§2.A.8** chat tool-payload rule aligned with the same branches / notes).
- Appended five **At a glance** rows to `docs/todo/product-done.md` (Surface | PRD/status ref | branch + evidence); **feedback-parity** documents **`## Branch` = `(no branch)`** verbatim and cites handoff **`Target` `orch/todo-sweep-566b/feedback-parity`** for integration hygiene.
- Left **`docs/todo/release-todo.md`** untouched; **only** `ui-todo.md` and `product-done.md` are in the diff.
- Committed, pushed `orch/todo-sweep-566b/docs-status-hygiene`, opened **draft PR #203** (`main` ← head).

## Measurements
(none)

## Verification
- `git diff --stat docs/todo/` → **only** `ui-todo.md` and `product-done.md`; **`git diff docs/todo/release-todo.md`** empty (0 bytes).
- No tests run (docs-only worker per brief).

## Notes, concerns, deviations, findings, thoughts, feedback
- **feedback-parity:** All acceptance checks were **pass** in the handoff, but **`## Branch` was `(no branch)`**; **`Status` was not `blocked` / `partial`**, so items are closed in status docs with an explicit branch-recording gap and the separate **v3 PRD §11 “analytics vs memory” product decision** called out as **still open** under §20b (not implementation).
- **auth-form-completion:** Verifier noted **320px / decorative SVG** not `live-ui-verified`; Phase **2.7** last bullet (SVG → gradient) remains **unstruck** in `ui-todo.md`.
- **dnd-affordances:** Verifier caveats (**reduced-motion** / placeholder pixels **not Jest-locked**) are echoed inline next to §15.
- Draft PR: https://github.com/zhuocun/pulse/pull/203

## Suggested follow-ups
- Reconcile **feedback-parity** when the implementation branch is confirmed (handoff `Target` vs empty `## Branch`).
- Optionally extend orchestrator verify recipes (e.g. **projectDetail** breadcrumb test glob) per verifier notes on **`fix-project-detail-shell`**.