# Doc hygiene — `release-todo-doc-hygiene-closeout`

- **Branch:** `orch/non-ga-todos-2f52/release-todo-doc-hygiene-closeout`
- **Date:** 2026-05-10
- **Scope:** Reconcile [`release-todo.md`](../release-todo.md) and [`product-done.md`](../product-done.md) after `verify-non-ga-release-todo-closure` findings (§7 pytest counts, FE suite counts, Out-of-scope Auth vs resolved §3, `product-done` §2/§4/§5/§6/§7 rows, `## What is open`, stale hard-coded test totals).

## Changes

- **`release-todo.md`:** §7 evidence `1075` → **`1127 passed`, `2 skipped`**; FE snippet **`150` suites**; Auth bullet points at resolved §3 + `product-done`; readiness tables and Tier 6 / ship-sequence / TL;DR text aligned with §4 as shipped optional path + operator backfill (not “still open as soft blocker”); §12 cross-ref wording; CI matrix row status; §7 heading vs body contradiction reduced.
- **`product-done.md`:** Explicit **At a glance** rows for **[`release-todo.md`](../release-todo.md) §2, §4, §5, §6, §7**; **`## What is open`** matches single GA §1 gate; **Test coverage** section avoids stale suite/backend integers (points at `release-todo` + verification logs + reruns).
- **`verification-logs/`:** Imported upstream [`2026-05-10-close-non-ga-release-todo-items-verifier.md`](2026-05-10-close-non-ga-release-todo-items-verifier.md) so §7 / product-done links resolve on this branch.

## Verification

Docs-only editset — no application code paths changed. Evidence for numeric reconciliation is the verifier log above plus this branch’s edited snippets.
