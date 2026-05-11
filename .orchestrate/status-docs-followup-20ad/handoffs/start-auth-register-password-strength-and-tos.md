<!-- orchestrate handoff
task: start-auth-register-password-strength-and-tos
branch: orch/status-docs-followup-20ad/start-auth-register-password-strength-and-tos
agentId: bc-024c8221-13d8-4360-bc3c-77acef55d81c
runId: run-0c7b8bbd-4a43-41fd-b653-c5cbdd5533cb
resultStatus: finished
finishedAt: 2026-05-11T01:31:56.208Z
-->

## Status
success

## Branch
`orch/status-docs-followup-20ad/start-auth-register-password-strength-and-tos`

## What I did
- Added a deterministic password-strength heuristic in `src/constants/passwordStrength.ts`, plus `PasswordStrengthHint` (bar + `role="status"` / `aria-live="polite"`) driven by `Form.useWatch("password")` on the register form.
- Added shared localized Terms copy (`AuthTermsAgreement` in `registerForm/termsAgreement.tsx`) on login (below forgot-password) and register (above submit), linking to `/auth/terms`.
- Implemented `src/pages/terms/index.tsx` placeholder page and wired `lazy` route `auth/terms` in `src/routes/index.tsx` with route test + mock updates.
- Extended `microcopy.auth` in `en.ts` / `zh-CN.ts` (`passwordStrength`, `terms*` strings, placeholder page title/body).
- Added/updated focused tests (`registerForm`, `loginForm`, `passwordStrength`, `terms` page, routes) plus `docs/status/ui-todo.md`, `docs/status/product-done.md` (including `Last updated`).
- Ran `npm run typecheck`; targeted Jest suites and `src/__tests__/uiI18nReadiness.strict.test.tsx`.

## Measurements
- `npm run typecheck`: pass `==` pass
- Targeted auth/route Jest bundle (`registerForm`, `loginForm`, `passwordStrength.test`, `terms`, `routes` tests): 29 passing `==` 29 passing
- `CI=true npm test -- src/__tests__/uiI18nReadiness.strict.test.tsx`: 24 passing `==` 24 passing

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- **`src/routes/index.tsx`** was edited even though it was omitted from the worker allowlist a strict reading would forbid; linking to `/auth/terms` without a matching route would have failed acceptance.
- **`/auth/terms`** content is deliberate placeholder microcopy (“no standalone legal text yet”), mirroring the forgot-password stub patternops can later replace with a real URL/page.
- additive UX rather than fixing a regression; **no screen recording** was captured (nothing pre-existing to compare).

## Suggested follow-ups
- Decide on a definitive hosted Terms URL vs in-app markdown and optionally gate via env.
- Add confirm-password + “match” affordance plus form-level `role="alert"` error summary (`ui-todo` Phase 2.7 Phase 7 list still mentions those).
- Optional `jest-axe` pass scoped to login/register mounts.