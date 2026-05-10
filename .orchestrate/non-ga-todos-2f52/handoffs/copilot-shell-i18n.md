<!-- orchestrate handoff
task: copilot-shell-i18n
branch: orch/non-ga-todos-2f52/copilot-shell-i18n
agentId: bc-1ae6b953-a57a-472c-a457-bdcadb05f45c
runId: run-090667db-dbda-4573-967e-94d32db841b1
resultStatus: finished
finishedAt: 2026-05-10T11:01:24.571Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/copilot-shell-i18n`

## What I did
- Added `microcopy.copilotShell` to `src/i18n/locales/en.ts` and `src/i18n/locales/zh-CN.ts` (title, tab labels, three placeholder bodies, settings body, two CTA strings).
- Wired `src/components/copilotShell/index.tsx` to read all user-visible strings from `microcopy` (drawer title, tabs, placeholders, CTAs, settings copy).
- Updated `src/components/copilotShell/index.test.tsx` to resolve tabs via `microcopy` + a small `tabName()` helper so queries stay locale-safe.
- Struck the §20f i18n sub-bullet in `docs/status/ui-todo.md` and marked it complete with the new key paths.
- Committed and pushed the branch above.

## Measurements
- Hardcoded user-visible English strings in `src/components/copilotShell/index.tsx`: >0 → == 0
- New `microcopy.copilotShell` keys present in `zh-CN.ts`: 0 → == 11 (one nested object with 4 tab keys + 3 placeholder keys + title + settingsBody + 2 ctas)
- `npx eslint src …` (CI-style, no `--max-warnings`): == 0 errors (1 pre-existing warning in `aiChatDrawer`)
- `npm run typecheck`: pass → pass
- `CI=true npm test`: 1058 passing → 1058 passing
- `npm run build` (vite): pass → pass

## Verification

- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `PATHS_AND_VERIFICATION.md` / `bootstrap/PATHS_AND_VERIFICATION.md` was not found in the repo; FE verification used the commands from `.github/workflows/frontend-ci.yml` (eslint, jest, implied typecheck/build from user request).
- Dictionaries live under `src/i18n/locales/`, not `src/locales/`; changes were made there so `Dictionary` / `microcopy` typing stays consistent.
- `docs/status/product-done.md` was not updated: your scoped paths only allowed `ui-todo.md`. If the planner wants full `AGENTS.md` backlog hygiene, they can add a one-liner there.
- No screen recording: change is copy/i18n wiring only, not an interactive bugfix.
- §20f’s scaffold/phase-2 items (in-shell content, settings controls from 20a) remain open; only the i18n debt called out there is closed.

## Suggested follow-ups
- Optionally add a shipped line to `docs/status/product-done.md` for this i18n pass to satisfy `AGENTS.md` fully.
- When CopilotShell gains real content, extend `microcopy.copilotShell` (or sub-namespaces) instead of reintroducing literals.