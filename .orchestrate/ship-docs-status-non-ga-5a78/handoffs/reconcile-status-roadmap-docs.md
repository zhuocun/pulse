<!-- orchestrate handoff
task: reconcile-status-roadmap-docs
branch: orch/ship-docs-status-non-ga-5a78/reconcile-status-roadmap-docs
agentId: bc-3ed1dc27-9973-459a-9dea-f7d91b3a8688
runId: run-c1064880-c168-46cf-a465-4cd55365e0aa
resultStatus: finished
finishedAt: 2026-05-11T02:45:51.230Z
-->

## Status
success

## Branch
`orch/ship-docs-status-non-ga-5a78/reconcile-status-roadmap-docs`

## What I did
- **`architecture-todo.md`:** Replaced the branch-name-only “shipped earlier” line with a **`main` + `product-done.md` / `release-todo.md`** evidence pointer; left Theme/grouping and GA §1 vs later themes as-is.
- **`release-todo.md`:** Re-centered non-GA closure narrative on **`main`** (header, TL;DR, blocker urgency, Beta §2/§3/§6 status line, recommended ship sequence §2); kept **`orch/*` / `claude/*` only as merge archaeology** where historically useful (§7b, §8, §16e, design-partner footnote).
- **`ui-todo.md`:** In the open-backlog grouping, §1.2 item **11**, Phase **2.7** header, **§3 step 8**, and heuristics **§2.B Error prevention** row: explicitly split **shipped** register password-strength + terms/ToS routing from **remaining** shell / WCAG error-summary / paste / `inputMode` work so nothing implies those features are missing.
- **`product-done.md`:** Updated Status / backend-gates rows to **`main`**; extended the 2026-05-11 reconciliation row; added one-liners for **`release-todo.md` `main` alignment** and **Phase 2.7 auth doc dedup** per AGENTS backlog hygiene.

## Measurements
(none)

## Verification
not-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- **`release-todo.md` still mentions historical integration branches** in a few ✅ rows and the design-partner bullet — wording now states outcomes live on **`main`**, with branch names secondary.
- **Code evidence for password strength + terms (sanity for reviewers):** `src/components/registerForm/index.tsx` imports `PasswordStrengthHint` and `AuthTermsAgreement` from `./passwordStrengthHint` / `./termsAgreement`; tests assert `href="/auth/terms"` in `loginForm` / `registerForm` test files. **`useAgent.ts` line count** cited in `architecture-todo.md` matches **`wc -l` → 853** in this workspace.
- **No PR opened** per instructions; branch pushed for planner integration.

## Suggested follow-ups
- If the planner wants **zero** branch names in `release-todo.md`, move all `orch/*` mentions into `verification-logs/` only and keep `release-todo.md` strictly `main`-relative.