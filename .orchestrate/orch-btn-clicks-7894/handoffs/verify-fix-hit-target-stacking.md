<!-- verifier handoff: fix-hit-target-stacking -->
## Verification

`unit-test-verified`

## Target

`fix-hit-target-stacking` on branch `orch/orch-btn-clicks-7894/fix-hit-target-stacking`

## Branch

`orch/orch-btn-clicks-7894/fix-hit-target-stacking`

## Execution

- `CI=true npm test -- --watchAll=false --runInBand src/components/projectCard src/components/projectList src/components/projectPopover` → Test Suites: 3 passed; Tests: 16 passed
- `npm run eslint -- --max-warnings 0 src/components/projectCard/index.tsx src/components/projectCard.test.tsx` → exit 0
- `npx tsc --noEmit` → exit 0
- Bootstrap audit path `.orchestrate/orch-btn-clicks-7894/discovery/BUTTON-CLICK-AUDIT.md` → not present in this workspace (cross-checked `Glob` + `.orchestrate` tree); cross-checked implementation against `bootstrap-btn-clicks-ref.md` item (2) / inline `ProjectCard` comments (TitleLink `::after` z-index 1; MetaRow/actions elevated)

## Findings

Per acceptance criterion:

- [x] Buttons/menus on project cards/lists respond to click in new/updated tests: **met** — `projectCard.test.tsx` (`userEvent`) like, kebab→edit/delete, title link `href` + click; `projectList` tests fire like/edit/delete and link rendering via embedded `ProjectCard`
- [x] No regression to keyboard focus order or primary link navigation: **met (tests)** — primary link `href` and click asserted; full tab-order not instrumented in this slice
- [x] CI test slice for touched components passes: **met**

Other findings (severity-ordered):

- **(med)** Audit file from bootstrap worker not in this checkout; verification leans on bootstrap handoff + code/test alignment, not row-by-row audit replay
- **(low)** No live browser run in this verification (`npm run dev` optional in recipe); stacking/pointer behavior in real DOM+Dnot covered beyond RTL

## Notes & suggestions

- If planner needs audit row citations, merge or fetch `.orchestrate/.../BUTTON-CLICK-AUDIT.md` from `orch/orch-btn-clicks-7894/bootstrap-btn-clicks-ref` or re-bootstrap discovery path
- `projectPopover` suite passed; no new pointer/stacking-specific tests added there in this branch — behavior is indirect via shared patterns / existing tests
