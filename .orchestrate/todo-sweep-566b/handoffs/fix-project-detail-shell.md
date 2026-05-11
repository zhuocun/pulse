<!-- orchestrate handoff
task: fix-project-detail-shell
branch: orch/todo-sweep-566b/fix-project-detail-shell
agentId: bc-58cf3776-bb3f-41f8-9eee-508fc067f8c5
runId: run-b7b438cf-ed1d-4d75-8ca0-fbc15d3df0f8
resultStatus: finished
finishedAt: 2026-05-11T04:52:13.255Z
-->

## Status
success

## Branch
`orch/todo-sweep-566b/fix-project-detail-shell`

## What I did
- Updated `src/pages/projectDetail.tsx`: removed `ProjectPopover` from the breadcrumb; first crumb is `<Link to="/projects">` with `microcopy.breadcrumb.projects`; last crumb wraps the project name in `<span aria-current="page">`; added `box-shadow: ${shadow.sm}` on `TopBar` via `shadow` from `src/theme/tokens.ts`; kept the existing redirect to `board`; added `data-testid="project-detail-chrome"` for tests.
- Added `microcopy.breadcrumb.projects` in `src/i18n/locales/en.ts` and `src/i18n/locales/zh-CN.ts`.
- Added `src/__tests__/projectDetailPage.breadcrumb.test.tsx` (breadcrumb link, `aria-current`, source scan for `5 px` + `shadow.sm`, conditional computed `box-shadow` check, redirect).
- Adjusted `src/pages/projectDetail.test.tsx` (drop popover mock; assert Projects `Link`).
- Did not change `src/components/header/**`; header already has `MemberPopover` and brand navigation to projects, so nothing was re-homed there.
- Pushed branch and opened draft PR [#198](https://github.com/zhuocun/pulse/pull/198).

## Measurements
- `src/pages/projectDetail.tsx` `ProjectPopover` usage: present → removed  
- Jest (`src/pages/projectDetail`, `src/__tests__/projectDetailPage`): 3 tests → 3 passing  
- ESLint (touched files): 0 warnings → 0 warnings  
- `tsc --noEmit`: clean → clean  
- `uiI18nReadiness.strict.test.tsx`: 24 tests → 24 passing  

## Verification
`unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- The repo’s `projectDetail` layout was already the single-column sticky chrome + breadcrumb; this change finishes the brief by swapping the popover for a real `Link`, i18n keys, tokenized shadow, and stricter tests. The in-app **project switcher** (list + create in the old popover) is no longer on this page; users rely on **Projects** (`/projects`) or header chrome instead.
- No GUI recording was saved: screen recording was started then discarded (no local dev session captured). Strongest signal is the new `__tests__` suite plus existing `projectDetail.test.tsx`.
- Do not merge the PR per orchestrator instructions.

## Suggested follow-ups
- If product still wants quick project switching without leaving the route, reintroduce it in header or as a dedicated control without duplicating `MemberPopover`.