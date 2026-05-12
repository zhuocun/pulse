<!-- orchestrate handoff
task: fix-shell-overlay-clicks
branch: orch/orch-btn-clicks-7894/fix-shell-overlay-clicks
agentId: bc-3b4a6e64-1f58-4387-b32d-db431abf0404
runId: run-a56dd41b-cdbf-434d-aba6-ba5e331a3889
resultStatus: finished
finishedAt: 2026-05-12T14:55:48.840Z
-->

## Status
success

## Branch
`orch/orch-btn-clicks-7894/fix-shell-overlay-clicks`

## What I did
- Pulled **BUTTON-CLICK-AUDIT** content via `git show origin/orch/orch-btn-clicks-7894/bootstrap-btn-clicks-ref:.orchestrate/.../BUTTON-CLICK-AUDIT.md` (file absent from workspace checkout).
- **§4 SkipLink (`mainLayout.tsx`):** unfocused skip link uses **`pointer-events: none`**; **`:focus` / `:focus-visible`** restores **`pointer-events: auto`** plus existing slide/transform so high **`z-index`** cannot swallow sticky-header clicks while off-screen.
- **§2 command palette SR helpers (`commandPalette/index.tsx`):** **`HiddenLabel`** and **`aria-live`** announcer span use **`pointer-events: none`**.
- **§4 `ColumnsViewport` (`board.tsx`):** **`isolation: isolate`** on the viewport wrapper; filter **`aria-live`** span **`pointer-events: none`** (same clipped-helper pattern as §2).
- **RTL:** `mainLayout.skipLink.strict.test.tsx`; header theme **`IconButton`** **`setPreference`** test; palette sparkle toggles AI mode; **`CopilotShell`** chat placeholder CTA fires **`onOpenChat`**.
- Draft PR **`#215`** (base **`main`**): https://github.com/zhuocun/pulse/pull/215  
- Left **`copilotWelcomeBanner`** UI unchanged after dropping non-audit speculative layering (**banner uses gradient backgrounds, not overlay pseudos**). No **`column/**`** edits — **no merge conflict** for sibling worker.

## Measurements
- `npm run eslint -- --max-warnings 0` (touched TS/TSX paths listed in verifier plan): **0 warnings**
- `npx tsc --noEmit`: **exit 0**
- `CI=true npm test -- --watchAll=false --runInBand` (verifier path globs + `mainLayout.skipLink.strict.test.tsx`): **5 suites → 30 tests passing**

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- **Screen recording:** not captured here (headless agent VM); PR notes RTL/command/header/board-shell paths exercised instead.
- **`SkipLink` focused-state `pointer-events: auto`** is asserted in CSS only (browser QA); jsdom **`getComputedStyle`** did not resolve Emotion **`:focus`** rules reliably, so the strict test checks **`pointer-events: none`** when blurred plus **`Tab` → `toHaveFocus()`**.
- `.**orchestrate/**` was not staged or shipped per orchestrator rules.

## Suggested follow-ups
- Planner: **`Pull Request #215`** is draft-only for integration with sibling **`column`/DnD/card** branches.
- Optional QA: tap-check sticky header actions after confirming skip-link stacking on real Safari/WebKit if reports persist (beyond RTL coverage).