<!-- orchestrate handoff
task: verify-fix-hit-target-stacking
branch: orch/orch-btn-clicks-7894/fix-hit-target-stacking
agentId: bc-9e52a6ab-5a01-4378-b71a-aea1829753e2
runId: run-1eefea0d-1ff9-44c0-828d-8386f0e3d722
resultStatus: finished
finishedAt: 2026-05-12T14:55:41.908Z
-->

## Verification

`unit-test-verified`

## Target

`fix-hit-target-stacking` on branch `orch/orch-btn-clicks-7894/fix-hit-target-stacking`

## Branch

`orch/orch-btn-clicks-7894/fix-hit-target-stacking`

## Execution

- → `CI=true npm test -- --watchAll=false --runInBand src/components/projectCard src/components/projectList src/components/projectPopover` — **3 suites, 16 tests, all passed** (stdout: `Test Suites: 3 passed`, `Tests: 16 passed`, exit 0)
- → `npm run eslint -- --max-warnings 0 src/components/projectCard/index.tsx src/components/projectCard.test.tsx` — **exit 0** (no working-tree changes after run)
- → `npx tsc --noEmit` — **exit 0**
- → `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` — present on unified branch after bootstrap merge; cross-checked `ProjectCard` stacking (`TitleLink::after` z-index 1, `MetaRow` / actions above, `Body` containing block)

## Findings

Per acceptance criterion:

- [x]: Buttons/menus on project cards/lists respond in tests — **met** (`projectCard.test.tsx`: `userEvent` on like, kebab → edit/delete; `projectList` tests: `fireEvent.click` on like, edit, delete, plus link href checks via rendered cards)
- [x]: No regression to primary link navigation / focus contract — **met (within test coverage)** — title link `href` and click covered; **full keyboard tab order not asserted** in this slice
- [x]: CI-style test slice for touched paths — **met** (16/16)

Other findings (severity-ordered):

- **(low):** No **live** browser or screen recording in this pass (recipe lists `npm run dev` as optional); stacking/pointer behavior is **not** `live-ui-verified`

## Notes & suggestions

- Audit markdown: `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` (from `bootstrap-btn-clicks-ref` merge).
- `projectPopover` tests passed but are not new pointer/stacking–specific coverage; list/card behavior is covered by `ProjectCard` + `ProjectList` tests above.
- For residual risk (DnD wrappers on the real board), a follow-up `live-ui-verified` pass on the board route may still be useful per upstream note.
