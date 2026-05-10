<!-- orchestrate handoff
task: microcopy-casing-sweep
branch: orch/non-ga-todos-2f52/microcopy-casing-sweep
agentId: bc-dec2cbb0-802f-4803-abaa-99a71a9d5e53
runId: run-86854ff9-ff7a-4bd2-9fe5-ce6fba4d0ef8
resultStatus: finished
finishedAt: 2026-05-10T12:40:58.216Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/microcopy-casing-sweep`

## What I did
- Performed a value-only microcopy/casing sweep in `src/i18n/locales/en.ts` (no key additions), including:
  - `Register for an account` → `Sign up for an account`
  - `Team Members` → `Team members`
  - `Open Chat`/`Open Brief` → `Open chat`/`Open brief`
  - `Board Brief` → `Board brief`
  - `Copy as Markdown` → `Copy as markdown`
  - `Open Copilot Panel` → `Open Copilot panel`
- Kept zh-CN parity intact (`src/i18n/locales/zh-CN.ts` unchanged) because the semantic shifts were verb/casing-only in English and Chinese equivalents remained correct.
- Updated label-dependent tests to match new visible copy:
  - `src/components/memberPopover/index.test.tsx`
  - `src/pages/login.test.tsx`
  - `src/pages/register.test.tsx`
- Updated backlog tracking in `docs/status/ui-todo.md`:
  - Marked §17 “Microcopy and casing” complete with resolution note.
  - Marked Phase 3.1 item 1 complete with resolution note.

## Measurements
- `translation keys added (en.ts + zh-CN.ts): 0 == 0`
- `CI=true npm test -- --watchAll=false (full suite): 147 passed suites == 147 passed suites`
- `CI=true npm test -- --watchAll=false (full suite): 1064 passed tests == 1064 passed tests`
- `npx tsc --noEmit: 0 errors == 0 errors`
- `npm run build: 3482 modules transformed == 3482 modules transformed`
- `npm run eslint: 0 errors == 0 errors`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Live UI walkthrough recorded and verified: `/opt/cursor/artifacts/microcopy_casing_auth_labels_demo.mp4` (shows `Log in`, `Sign up for an account`, register heading `Sign up for an account`, and `Sign up` primary CTA).
- Existing unrelated eslint warning remains in `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`); lint still passes with 0 errors.

## Suggested follow-ups
- If desired, run a broader sentence-case normalization pass for non-button title strings outside this scoped mechanical sweep (e.g., remaining title-style labels that are not strictly action CTAs).