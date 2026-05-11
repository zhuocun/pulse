<!-- orchestrate handoff
task: verify-audit-status-doc-open-items
branch: orch/status-docs-followup-20ad/verify-audit-status-doc-open-items
agentId: bc-121aa9b2-c2ec-480d-9ff6-0269b1f900eb
runId: run-0c420ee0-13cf-45dc-807d-b98c04d901d0
resultStatus: finished
finishedAt: 2026-05-11T01:25:36.825Z
-->

## Verification
unit-test-verified

## Target
`audit-status-doc-open-items` on branch `orch/status-docs-followup-20ad/audit-status-doc-open-items`

## Branch
`(no branch)`

## Execution
- → Audited status docs directly: `docs/todo/architecture-todo.md`, `docs/todo/ui-todo.md`, `docs/todo/release-todo.md`, and `docs/todo/product-done.md` via file reads.
- → Verified stale-TODO inventory claims against live code:
  - `rg "TODO|FIXME|XXX" /workspace/backend/app --type py` → **No matches found**.
  - `rg "TODO" /workspace/src --glob "*.{ts,tsx}"` → exactly one hit at `src/components/aiChatDrawer/index.tsx` (`TODO(v3)` docblock around lines 303–316).
- → Verified architecture-todo code-path assertions:
  - `wc -l src/utils/hooks/useAgent.ts` → **853**.
  - `rg "forEachAgentStreamPart" /workspace/src/utils/hooks` → consumer extracted to `useAgentStreamConsumer.ts` and used from `useAgent.ts`.
  - Read `backend/app/main.py` around `_configure_middleware_backends` confirming RuntimeError guard when workers >1 without Redis trio + `REDIS_URI`.
- → Ran targeted backend test for the §16d guard claim:
  - `.venv/bin/python -m pytest tests/test_production_backend_guards.py -q --no-cov` → **15 passed**.
  - (Initial run without `--no-cov` failed only due repo-wide 100% coverage gate when running a single-file suite.)
- → Ran targeted frontend unit test for stream-consumer extraction claim:
  - `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useAgentStreamConsumer.test.ts` → **1 passed**.
- → Verified release-linkage consistency and grouping text:
  - `rg` in `release-todo.md` shows **only GA §1 remains open** and §7b/§8/§14/§16b/§16c/§16d are marked ✅.
  - `architecture-todo.md` includes **“Workstreams — immediate vs later”** and explicitly treats §16b/§16c/§16d as closed.
  - `ui-todo.md` includes **“Open backlog grouping”** with Immediate/Later buckets and explicitly states §8/§14 are closed.
  - `rg "runtime\\.py:578" /workspace/docs/todo` → no stale old reference.

## Findings
Per acceptance criterion:
- [x]: **met** — `architecture-todo`/`ui-todo` open-item text no longer points at already-resolved TODO inventory claims (backend TODO markers removed; FE reduced to one intentional v3 TODO and documented as such).
- [x]: **met** — open work is explicitly identified and grouped as immediate vs later (both docs contain explicit grouping sections).
- [x]: **met** — status docs are consistent with `release-todo` GA-only blocker posture (all three docs align on GA §1 as the only remaining open code gate).
- [x]: **met** — no obvious stale TODO references remain in architecture/ui status docs (targeted grep + stale-path probe found none).
- [x]: **met** — remaining work is clearly identified and actionable (theme/phase tables + gated callouts + immediate/later lists are concrete).

Other findings (severity-ordered):
- (high): none.
- (med): none.
- (low): backend targeted pytest required `--no-cov` to bypass repo-global `--cov-fail-under=100` when running a single-file verifier check; functional assertions still passed (`15 passed`).

## Notes & suggestions
- Verification was evidence-driven against live repo state (grep inventory + targeted tests), not diff-only review.
- No repository files were modified or committed during verification.
- If you want stricter verifier ergonomics for future single-suite checks, consider documenting a standard “targeted verifier test” command that explicitly disables global coverage gating.