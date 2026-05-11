<!-- orchestrate handoff
task: auth-form-completion
branch: orch/todo-sweep-566b/auth-form-completion
agentId: bc-01fbd75b-2fed-43f0-88fa-4090f41b5aae
runId: run-94acb501-555e-4059-89a6-ba55c9c12fe4
resultStatus: finished
finishedAt: 2026-05-11T04:57:21.513Z
-->

## Status
success

## Branch
`orch/todo-sweep-566b/auth-form-completion`

## What I did
- Added `src/components/authErrorSummary/index.tsx`: `role="alert"` summary with title, intro, optional API line, field links (`href` + `preventDefault` + `focus()` for reliable focus), `aria-labelledby` / `aria-describedby`, and `submitAttempted`-gated field list via `includeFieldErrors`.
- Wired `LoginForm` / `RegisterForm` with `Form.useForm`, `onFinishFailed` / `onFinish` submit-attempt handling, and `serverError` prop; exported `resolveAuthPageErrorMessage` from `errorBox` for shared API message resolution.
- Updated `login.tsx` / `register.tsx`: removed top `ErrorBox`, pass `serverError`, replaced switch CTAs with styled `Link` from `react-router`.
- Adjusted `authLayout` `FormCard` to `max-width: 40rem` and `width: min(40rem, 100% - 2rem)` (layout already used CSS gradients; no SVG `calc()` fix was required).
- i18n: `microcopy.auth.errorSummaryTitle`, `errorSummaryIntro`, `errorSummaryRegionAriaLabel` in `en` + `zh-CN`.
- Tests: login/register (summary, focus, paste), `authLayout.test.tsx` (computed width contains `min(` and `40rem`), page mocks, `uiQuality` switch CTA queries now expect `link` role.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand`: 1100 == 1100 passing
- `npx tsc --noEmit`: 0 errors == 0 errors
- `npx eslint --max-warnings 0` (touched paths): 0 warnings == 0 warnings
- Auth card CSS width rule: contains `min(` + `40rem` == yes (Jest `getComputedStyle`)

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- **Screenshots** (login at 320px and ≥1024px): not captured; repo has no Playwright in `package.json`, so no before/after artifacts.
- **PR**: draft **#201** vs `main`: https://github.com/zhuocun/pulse/pull/201
- `.orchestrate/` was not modified or committed.

## Suggested follow-ups
- Optional manual smoke on `/auth/login` and `/auth/register` and viewport screenshots if the planner wants visual proof.
- If the orchestrator prefers hash navigation without JS, the anchor `onClick` could be narrowed to non-default behavior only where needed—but current behavior matches tests and improves focus in jsdom and typical browsers.