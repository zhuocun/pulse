<!-- orchestrate handoff
task: audit-status-doc-open-items
branch: orch/status-docs-followup-20ad/audit-status-doc-open-items
agentId: bc-c6cc0a38-ac03-4b36-9804-2de1608155a3
runId: run-6c1bd63d-1653-42cb-836e-f8accbdac35b
resultStatus: finished
finishedAt: 2026-05-11T01:22:13.791Z
-->

## Status
success

## Branch
`orch/status-docs-followup-20ad/audit-status-doc-open-items`

## What I did
- Re-read `docs/status/release-todo.md` and treated **GA §1** as the only open *code* gate; kept all cross-links and did **not** reopen any closed non-GA items.
- Reconciled **`docs/status/architecture-todo.md`** with the repo: removed the stale `runtime.py:578` BE TODO story ( **`rg` finds no `TODO`/`FIXME`/`XXX` under `backend/app/`** ), corrected **§16b / §16d / §16c / §5** gate language to match shipped closures, refreshed **`useAgent.ts` line count (853)**, documented the single FE **`TODO(v3)`** autonomy docblock in `aiChatDrawer` (~303–316), tightened Theme 3/4/6 action rows (SSE consumer already extracted; multi-worker row now matches the §16d Redis guard), and added **immediate vs later** workstreams.
- Reconciled **`docs/status/ui-todo.md`**: new **2026-05-11** header + **open backlog grouping** (GA-adjacent vs product UX vs later), fixed **§20a** so it does not cite closed **§8/§14** as “operational” blockers, updated Phase **1.5** to the current **`<BrandMark />`** header pattern, and corrected **2.C** `jsx-a11y` text now that **`frontend-ci.yml`** runs ESLint.
- Logged the same reconciliation in **`docs/status/product-done.md`** (at-a-glance row + **Last updated** bump).
- Committed and pushed the branch; **no PR** created per instructions.

## Measurements
- `rg TODO|FIXME|XXX backend/app (py): == 0 matches`
- `rg TODO src (*.{ts,tsx}): == 1 match` (only `src/components/aiChatDrawer/index.tsx` v3 autonomy docblock)
- `wc -l src/utils/hooks/useAgent.ts: 935 (obsolete doc claim) → 853 lines`
- `docs/status/*.md files touched for this audit: 3`

## Verification
not-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Strongest evidence for the doc fixes is **repository inventory**, not tests: `rg 'TODO|FIXME|XXX' backend/app --glob '*.py'` (empty) and `rg 'TODO' src --glob '*.{ts,tsx}'` (single `aiChatDrawer` hit), plus `wc -l` on `useAgent.ts`.
- **`release-todo.md`** was **not modified** (not in the allowed edit list for this worker); posture was read for consistency only.
- Section **20f** still says i18n for Copilot shell tabs shipped; the new grouping emphasizes **placeholder / legacy-drawer bounce** and **§1** honesty — that is intentional (content depth vs string debt).

## Suggested follow-ups
- Planner: land the branch via normal integration; optionally spot-check Theme 6 “Provider resilience beyond §2” wording against product intent (failover is in; “LiteLLM-style” is future depth).
- If **`jsx-da11y` ** `--max-warnings 0`** is adopted, schedule a dedicated FE pass — `ui-todo` now calls that out as the explicit next step, not “when CI exists.”