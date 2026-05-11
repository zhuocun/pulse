<!-- orchestrate handoff
task: verify-auth-register-password-strength-and-tos
branch: orch/status-docs-followup-20ad/verify-auth-register-password-strength-and-tos
agentId: bc-a20009ba-acbf-499c-9d99-dfe300384c39
runId: run-7888d78a-e18c-4a60-b6c6-e78a10b2ea22
resultStatus: finished
finishedAt: 2026-05-11T01:46:49.550Z
-->

## Verification
`verifier-failed`

## Target
`start-auth-register-password-strength-and-tos` on branch `orch/status-docs-followup-20ad/start-auth-register-password-strength-and-tos`

## Branch
`(no branch)`

## Execution
- → Ran `npm run typecheck` in `/workspace` (pass).
- → Ran focused Jest suites: `CI=true npm test -- src/components/registerForm/index.test.tsx src/components/loginForm/index.test.tsx src/__tests__/passwordStrength.test.ts src/pages/terms/index.test.tsx src/routes/index.test.tsx` (5 suites, 29 tests, all pass).
- → Ran i18n readiness suite: `CI=true npm test -- src/__tests__/uiI18nReadiness.strict.test.tsx` (1 suite, 24 tests, pass).
- → Ran additional auth-gating suite: `CI=true npm test -- src/pages/home.test.tsx` (pass).
- → Started live app (`npm start` in tmux session `auth-ui-verify`) and performed browser verification on `http://localhost:3000/register`, captured recording: `/opt/cursor/artifacts/verifier_register_password_strength_terms_link.mp4`.
- → Live UI observations from recording: password-strength feedback updates (short password shows min-length error; stronger password shows “Fair” strength hint), Terms link is focusable/clickable, but activating Terms navigates to `/login`; direct `/auth/terms` URL also redirects to `/login`.
- → Inspected auth-route gating source: `src/pages/home.tsx` only treats `/login`, `/register`, `/auth/forgot-password` as auth routes; `/auth/terms` is missing from allowlist, causing unauthenticated redirect to `/login`.

## Findings
Per acceptance criterion:
- [x]: Register form surfaces password-strength feedback and a terms-of-service link accessibly (**not met** — strength feedback works, but Terms destination `/auth/terms` is not reachable unauthenticated in live UI).
- [x]: Relevant tests pass for the updated auth UX (**met** — targeted auth/routes/i18n/home suites pass).
- [x]: `ui-todo`/`product-done` reflect closure progress for this started item (**not met** — docs mark this item complete, but live behavior shows Terms route flow is still broken for anonymous users).

Other findings (severity-ordered):
- (high): Functional regression vs claimed closure: `/auth/terms` redirects to `/login` in real browser flow, so “terms link accessibly” is incomplete in practice. Evidence: live recording + `src/pages/home.tsx` auth-route list omission.
- (med): Test coverage gap allowed this through: current tests validate Terms link href and route table presence, but do not verify anonymous navigation to `/auth/terms` through `HomePage` gating.
- (low): Status docs over-claim completion: `docs/status/ui-todo.md` item §11 and `docs/status/product-done.md` auth row describe terms-link/terms-page closure as complete despite unresolved route access behavior.

## Notes & suggestions
- Artifact for planner review: `/opt/cursor/artifacts/verifier_register_password_strength_terms_link.mp4`.
- Suggested follow-up fix: include `/auth/terms` in `HomePage` auth-route allowlist (`src/pages/home.tsx`) so anonymous users can access Terms page.
- Suggested follow-up test hardening: add a `HomePage` test case asserting `/auth/terms` is treated as an auth route (no redirect to `/login`), and an integration-style route test covering Terms-link navigation end-to-end for anonymous users.