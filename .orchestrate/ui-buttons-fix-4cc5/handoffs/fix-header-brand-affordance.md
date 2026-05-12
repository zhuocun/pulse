<!-- orchestrate handoff
task: fix-header-brand-affordance
branch: orch/ui-buttons-fix-4cc5/fix-header-brand-affordance
agentId: bc-aff9ac76-91bf-45fc-8571-56ee9cc20d7f
runId: run-fdbf76c3-0c90-4169-8110-8b4ac292b620
resultStatus: finished
finishedAt: 2026-05-12T14:44:58.882Z
-->

## Status
success

## Branch
`orch/ui-buttons-fix-4cc5/fix-header-brand-affordance`

## What I did
- Refactored the header brand cluster: shared layout via `brandClusterCss`; on `/projects` render `BrandPresentation` (`styled.span`) with `BrandMark`; elsewhere keep `BrandLink` (`NoPaddingButton`) with `microcopy.header.logoLabel` on `aria-label`/`title` and `navigate("/projects", { viewTransition: true })`.
- Extended `src/components/header/index.test.tsx` with role/tab/keyboard navigation cases; updated the `MemberPopover` mock to a focusable `button` so Tab order matches real chrome (first tab stop after the brand is Members, not the theme toggle).
- Added `UI quality :: Header brand keyboard affordance` tests in `src/__tests__/uiKeyboardNavigation.strict.test.tsx` for `/projects` vs board stub.
- Pushed the branch and opened draft PR [#208](https://github.com/zhuocun/pulse/pull/208) against `main`.

## Measurements
- Misleading Pulse logo control on `/projects` (button + no `onClick`): **present → removed**
- `CI=true npm test -- --watchAll=false --runInBand src/components/header src/__tests__/uiKeyboardNavigation.strict.test.tsx src/__tests__/uiQuality.strict.test.tsx`: **55 tests == 55 passing**
- `npm run eslint -- --max-warnings 0 -- src/components/header`: **0 warnings == 0 warnings**
- `npx tsc --noEmit`: **clean == clean**

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- Screen recording path from this session: `/opt/cursor/artifacts/header-brand-affordance-fix.mp4` (short capture during verification; no full in-browser app walkthrough).
- zh-CN and other locales were not changed; no new user-visible strings.
- `.orchestrate/` was not modified or included in the commit.

## Suggested follow-ups
- (none)