<!-- orchestrate handoff
task: forgot-password-link-stub
branch: orch/non-ga-todos-2f52/forgot-password-link-stub
agentId: bc-7b1c5fae-fd83-4209-9003-fe2d7b717f20
runId: run-3628a48a-16e1-41cf-b0a8-be6e3345a9ab
resultStatus: finished
finishedAt: 2026-05-10T13:38:20.655Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/forgot-password-link-stub`

## What I did
- Added a right-aligned, i18n-backed `Forgot password?` link in `src/components/loginForm/index.tsx` (near the password field) pointing to `/auth/forgot-password`, without changing existing show-password, caps-lock, or `autoComplete` behavior.
- Added a new placeholder page at `src/pages/forgotPassword/index.tsx` that renders:
  - `microcopy.auth.forgotPasswordPlaceholderTitle`
  - `microcopy.auth.forgotPasswordPlaceholderBody`
- Wired routing for `/auth/forgot-password` in `src/routes/index.tsx` and updated auth-route gating in `src/pages/home.tsx` so anonymous users can access it as an auth route.
- Added en + zh-CN locale parity for:
  - `auth.forgotPassword`
  - `auth.forgotPasswordPlaceholderTitle`
  - `auth.forgotPasswordPlaceholderBody`
- Added/updated tests to cover requested behavior:
  - `src/components/loginForm/index.test.tsx`: link presence + keyboard focusability.
  - `src/__tests__/app.integration.test.tsx`: route render at `/auth/forgot-password`.
  - `src/pages/forgotPassword/index.test.tsx`: placeholder page content render.
  - `src/routes/index.test.tsx`: route table includes `auth/forgot-password`.
  - `src/pages/home.test.tsx`: `/auth/forgot-password` treated as auth route.
- Updated `docs/status/ui-todo.md` §11 and Phase 2.7 row to reflect partial closure for the forgot-password link/placeholder route item.

## Measurements
- `CI=true npm test -- --runInBand (targeted suites): 23 passing == 23 passing`
- `CI=true npm test -- --runInBand (full suite): 1073 passing == 1073 passing`
- `npm run typecheck (tsc --noEmit): 0 errors == 0 errors`
- `npm run build (vite): exit code 0 == 0`
- `npm run eslint: 0 errors == 0 errors (1 warning)`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- UI walkthrough recording artifact: `/opt/cursor/artifacts/forgot_password_route_steady_url_visible_demo.mp4`
- I did not open a PR (per instruction).
- `eslint` passes with one pre-existing warning in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`), unrelated to this change.

## Suggested follow-ups
- Implement the remaining Phase 2.7 auth items still open in `ui-todo`:
  - register password-strength indicator
  - terms-of-service link