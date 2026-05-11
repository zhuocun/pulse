<!-- orchestrate handoff
task: verify-auth-register-password-strength-and-tos
branch: (no branch — verifier did not modify or push code)
agentId: bc-49395529-fe69-48b1-ae13-75d34d3b3d9a
runId: run-e0090ca1-80ed-438a-9881-2e56e5fea9be
resultStatus: finished
finishedAt: 2026-05-11T01:54:29.809Z
-->

All evidence collected. Let me document the verification results.

## Verification

`unit-test-verified`

## Target

`start-auth-register-password-strength-and-tos` on branch `orch/status-docs-followup-20ad/start-auth-register-password-strength-and-tos`

## Branch

`(no branch — verifier did not modify or push code)`

## Execution

- → `git status && git log --oneline -20` confirmed branch tip `229688b docs(status): bump product-done last updated date` over `7723109 feat(auth): register password strength + Terms link with i18n`; tree clean.
- → `git show --stat 7723109` confirmed feat commit touches all expected files: `src/constants/passwordStrength.ts`, `src/components/registerForm/{index.tsx,passwordStrengthHint.tsx,termsAgreement.tsx,index.test.tsx}`, `src/components/loginForm/{index.tsx,index.test.tsx}`, `src/pages/terms/{index.tsx,index.test.tsx}`, `src/routes/{index.tsx,index.test.tsx}`, `src/constants/authPaths.ts`, `src/__tests__/passwordStrength.test.ts`, `src/i18n/locales/{en.ts,zh-CN.ts}`, `docs/status/{ui-todo.md,product-done.md}`.
- → Read source: `src/constants/passwordStrength.ts` (deterministic length+class heuristic, 5 levels), `src/components/registerForm/passwordStrengthHint.tsx` (bar `aria-hidden`, caption `<span role="status" aria-live="polite" aria-atomic="true">`), `src/components/registerForm/index.tsx` (uses `Form.useWatch("password", form)` and renders the hint inside `Form.Item.extra` above the caps-lock slot), `src/components/registerForm/termsAgreement.tsx` (`<Link to="/auth/terms">` with shared variant for `login`/`register`), `src/components/loginForm/index.tsx` (mounts `<AuthTermsAgreement variant="login" />` below forgot-password row), `src/pages/terms/index.tsx` (uses `useTitle` + `microcopy.auth.termsPage*`), `src/routes/index.tsx` (added `lazy(() => import("../pages/terms"))` and `path: "auth/terms"`).
- → `rg passwordStrength|terms*` in `src/i18n/locales` confirmed en (`:665–679`) and zh-CN (`:628–642`) both add the same `passwordStrength.{meterAriaLabel,tooShort,weak,fair,strong}` block plus `termsLink`/`termsLoginPrefix`/`termsLoginSuffix`/`termsRegisterPrefix`/`termsRegisterSuffix`/`termsPageTitle`/`termsPageBody`.
- → `CI=true npx jest src/__tests__/passwordStrength.test.ts src/components/registerForm/index.test.tsx src/components/loginForm/index.test.tsx src/pages/terms/index.test.tsx src/routes/index.test.tsx` → **5 suites, 29/29 tests pass** in 5.5s. Notable assertions: `RegisterForm › surfaces localized password strength feedback after typing` (toggles between “Too short” and “Strong password”); `RegisterForm › exposes an accessible Terms of Service link inside the auth copy` (link href `/auth/terms`); `LoginForm › renders a Terms of Service link in the auth agreement line`; `TermsPage › surfaces localized legal-placeholder copy under the Terms heading`; `routes › contains auth, project, and catch-all child routes under the home shell` includes `auth/terms` in the expected list.
- → `CI=true npx jest src/__tests__/uiI18nReadiness.strict.test.tsx` → 24/24 pass (3.9s) — the new `passwordStrength.*` and `terms*` keys are present in both locales without breaking key-parity coverage.
- → `npm run typecheck` (`tsc --noEmit`) → exit 0.
- → `npx eslint` on `src/components/registerForm src/components/loginForm src/pages/terms src/constants/passwordStrength.ts src/constants/authPaths.ts src/routes/index.tsx` → exit 0, no warnings.
- → `git diff 8e7ac19..7723109 -- docs/status/{ui-todo.md,product-done.md}` and `git diff 7723109..229688b -- docs/status/product-done.md` to verify the doc edits.

## Findings

Per acceptance criterion:

- [x] **Register form surfaces password-strength feedback and a terms-of-service link accessibly** — met. `PasswordStrengthHint` renders a colored progress bar (decorative, `aria-hidden`) plus a textual `role="status" aria-live="polite" aria-atomic="true"` caption sourced from `microcopy.auth.passwordStrength.*`; the hint is wired via `Form.useWatch("password", form)` and rendered inside the password `Form.Item.extra`. `AuthTermsAgreement` renders an inline `<Link to="/auth/terms">` whose visible text comes from `microcopy.auth.termsLink` (i18n-shared between login + register) and points at a real lazy route `auth/terms` backed by `src/pages/terms/index.tsx` (heading + body via `microcopy.auth.termsPage*`). en + zh-CN locales both updated.
- [x] **Relevant tests pass for the updated auth UX** — met. 5/5 targeted suites pass (29/29 tests), including specific assertions for password strength feedback, Terms link presence on both register and login forms, Terms page placeholder copy, and route registration. The strict i18n readiness suite (24/24) also passes, confirming locale-key parity for the new strings. Typecheck and ESLint on touched files are clean.
- [x] **`ui-todo`/`product-done` reflect closure progress for this started item** — met and not over-claimed. `docs/status/ui-todo.md` §1.2 item 11 strikes only the "no password-strength indicator on register, no terms-of-service link" remaining bullet and replaces it with **[Complete: …]** with concrete file refs, while explicitly preserving the still-open card-width / Register-CTA bullets. The §11 heading is downgraded to "Phase 2.7 — register password-strength + ToS linkage shipped …; thin layout follow-ups remain" — accurate. Phase 2 §7 strikes only the "password-strength meter … minimum-length hint inline" sub-bullet and explicitly leaves the "plus a 'Match' indicator if a confirm-password field is added" tail intact, plus retains the open `role="alert"` error-summary, `onPaste` paste-allow, `inputMode`/`enterKeyHint` audit, layout shell, and CTA bullets. `docs/status/product-done.md` augments the existing Auth-forms row in place (does not add a duplicate row) with the new "register password strength, Terms link" delta and the file refs the AGENTS.md guidance asks for. `Last updated` bumped to `2026-05-11`.

Other findings (severity-ordered):

- (low) Worker self-disclosed that `src/routes/index.tsx` was outside an originally narrower allowlist; the edit is a 5-line route registration that is required for the new `<Link to="/auth/terms">` to resolve, otherwise the acceptance criterion would not hold. The accompanying `src/routes/index.test.tsx` change is just adding `auth/terms` to the expected child-route list and the `pages/terms` jest mock — both correct. Treat as acceptable scope expansion, not a regression.
- (low) `PasswordStrengthHint` puts an `aria-label` on a `<span role="status">` whose text content equals the caption portion of the label. Most assistive tech will use `aria-label` and ignore the text node, which is the intended behavior; no functional issue, just a stylistic nit.
- (low) `microcopy.auth.termsPageBody` is intentionally placeholder copy ("This deployment does not yet host standalone legal text…"). This matches the placeholder pattern the codebase already uses for `auth/forgot-password` and is acknowledged in the worker handoff; not a defect for this scope, but a real legal/Terms URL is still owed before a public ship.
- (low) The `AuthTermsAgreement` line is rendered above the submit button on register and below forgot-password on login — visually anchored but worth re-reviewing in a future visual sweep alongside the still-open §11 card-width work.

## Notes & suggestions

- Verification was terminal-driven only, per the brief. No GUI/manual recording was attempted; no env failures occurred (Node 22.22.2, Jest, TS, ESLint all green).
- Behavior evidence is grounded in the targeted Jest suites (29/29) plus locale-parity strict suite (24/24), not just static review of the diff.
- Status-doc edits are surgical and accurate: only the closed sub-bullets are struck/marked complete, all open follow-ups (Match indicator, error summary, layout shell, paste-allow, `inputMode`/`enterKeyHint`, register CTA semantics, real Terms URL) remain visible in `ui-todo.md`. The `product-done.md` row is amended in-place rather than duplicated, in line with AGENTS.md guidance to keep `status/` as the single source of truth without restating per-PR detail elsewhere.
- No code or doc changes were made by the verifier; nothing to commit or push.