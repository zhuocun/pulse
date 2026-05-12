<!-- orchestrate handoff
task: verify-fix-shell-overlay-clicks
branch: `orch/orch-btn-clicks-7894/fix-shell-overlay-clicks` (no verifier commits)
agentId: bc-4284761f-a7aa-436e-b0a3-d9e2c64fa8bd
runId: run-663f98c5-7ad6-45a6-bf87-eaff64133e9c
resultStatus: finished
finishedAt: 2026-05-12T14:57:37.636Z
-->

Verification complete. No commits were made (ESLint left the tree clean). Final handoff:

---

## Verification

`unit-test-verified`

## Target
`fix-shell-overlay-clicks` on branch `orch/orch-btn-clicks-7894/fix-shell-overlay-clicks`

## Branch
`orch/orch-btn-clicks-7894/fix-shell-overlay-clicks` (no verifier commits)

## Execution
- `CI=true npm test -- --watchAll=false --runInBand src/pages/board src/layouts/mainLayout src/components/header src/components/copilotShell src/components/copilotWelcomeBanner src/components/commandPalette` → **6 suites passed, 38 tests passed** (exit 0).
- `npm run eslint -- --max-warnings 0 src/pages/board.tsx src/layouts/mainLayout.tsx src/components/header src/components/copilotShell src/components/copilotWelcomeBanner src/components/commandPalette` → **exit 0** (no working-tree changes after `--fix`).
- `npx tsc --noEmit` → **exit 0**.
- Static cross-check vs audit themes: read `mainLayout.tsx` (skip link + `minmax(0, 1fr)`), `board.tsx` (`ColumnsViewport` gradients + `isolation`, filter announcer `pointerEvents: "none"`), `commandPalette/index.tsx` (`HiddenLabel` + announcer `pointerEvents: "none"`). `BUTTON-CLICK-AUDIT.md` is **not** in this checkout; mapping uses worker § references and on-disk code.

## Findings
Per acceptance criterion:
- [x]: **Audit-cited shell/header/copilot/command hit-targeting** — **met** (skip link `pointer-events: none` until `:focus`/`:focus-visible`; palette helpers non-interactive; board viewport `isolation` + gradient pseudo-elements `pointer-events: none`; filter `aria-live` span `pointerEvents: "none"`). **`minmax(0, 1fr)`** and explanatory comment still present in `mainLayout` (horizontal clipping / header layout constraint preserved).
- [x]: **DnD / layout** — **met** (column DnD wiring unchanged structurally; viewport fades explicitly non-blocking in code comment and styles; no evidence of removing `minmax` grid fix).
- [x]: **Tests or evidence for at least one fixed path** — **met** (`src/__tests__/mainLayout.skipLink.strict.test.tsx` asserts `pointerEvents: "none"` when blurred + Tab focus; broader suites under verifier globs pass).
- [x]: **Lint + tsc for touched areas** — **met** (eslint + full `tsc` clean as run).

Other findings (severity-ordered):
- **(low)**: Jest count **38 tests / 6 suites** vs upstream note **30 / 5** — consistent with more tests under the same path globs, not a failure.
- **(low)**: **No** `BUTTON-CLICK-AUDIT.md` in workspace; audit row IDs could not be copied verbatim—verified against implementation + worker § mapping only.
- **(med)**: **No live browser recording** or dev-server click-through in this VM run (recipe “manual” optional; gradient/skip-link behavior covered by code + RTL, not pixel/visual proof).

## Notes & suggestions
- **Gradient / skip-link regression**: Column edge fades remain `pointer-events: none` on `::before` / `::after`; skip link remains non-interactive until focused—aligned with “don’t swallow chrome clicks” while keeping fades visible.
- Planner: safe to treat **`unit-test-verified`** for integration; for WebKit/sticky-header edge cases per upstream, optional human QA remains valuable if field reports continue.