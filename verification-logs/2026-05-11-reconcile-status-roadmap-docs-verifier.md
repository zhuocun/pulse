# Independent verification — `reconcile-status-roadmap-docs` (2026-05-11)

Verifier: cloud agent. Branch: `orch/ship-docs-status-non-ga-5a78/reconcile-status-roadmap-docs`.  
Target scope: `docs/status/architecture-todo.md`, `ui-todo.md`, `product-done.md`, `release-todo.md` mutual consistency vs codebase.

## Commands run

```bash
wc -l src/utils/hooks/useAgent.ts
# → 853

rg -n "PasswordStrengthHint|termsAgreement|/auth/terms" src/components/registerForm src/components/loginForm
# Evidence: registerForm imports PasswordStrengthHint, AuthTermsAgreement; tests assert href="/auth/terms"

rg 'TODO|FIXME|XXX' backend/app --glob '*.py'
# → no matches (case-sensitive per architecture-todo claim)

CI=true npm test -- --watchAll=false --runInBand
# → Test Suites: 152 passed; Tests: 1095 passed

npx tsc --noEmit
# → exit 0

npx eslint src eslint.config.mjs --max-warnings 0
# → exit 0
```

## Result

- Auth password-strength + terms routing **matches** source (`passwordStrengthHint.tsx`, `termsAgreement.tsx`, `registerForm/index.tsx`, login importing terms from registerForm).
- **`docs/status/release-todo.md` §16b** heading still describes `useAgent.ts` as a **935-line** monolith; **`docs/status/architecture-todo.md`** and **`wc -l`** agree on **853** lines — **cross-doc contradiction** (factual staleness in the resolved §16b row).
