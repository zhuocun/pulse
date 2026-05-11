<!-- orchestrate handoff
task: header-logo-and-ai-live-regions-a11y
branch: orch/non-ga-todos-2f52/header-logo-and-ai-live-regions-a11y
agentId: bc-c91a92a9-d29b-43bf-993b-239c858b915f
runId: run-8781346a-b255-4fed-9346-593a6d2f71e5
resultStatus: finished
finishedAt: 2026-05-10T13:48:12.024Z
-->

## Status
success

## Branch
`orch/non-ga-todos-2f52/header-logo-and-ai-live-regions-a11y`

## What I did
- Added a distinct localized header logo label/title via new `microcopy.header.logoLabel` (`Pulse home`, zh-CN parity `Pulse 首页`) and wired the logo button to use it for both `aria-label` and `title`.
- Added discrete polite live regions in:
  - `src/components/aiTaskAssistPanel/index.tsx`
  - `src/components/boardBriefDrawer/index.tsx`  
  Each now announces short status-only copy (loading/ready/error) without exposing raw AI payload text.
- Extended tests to assert the new a11y affordances:
  - Header accessible name/title assertions (`uiAccessibility.strict` + header/strict suites updated for new label text)
  - AI status live-region assertions in component agent tests for ready/error states.
- Updated backlog hygiene in `docs/todo/ui-todo.md`:
  - §21 header logo label item marked complete
  - §21 AI assist/brief live region item marked complete
  - Phase 3.4 / 4.1.3 line updated to reflect AI suggestion-arrival coverage across chat + assist + brief surfaces.
- Committed and pushed on the required branch (2 commits):
  - `27a6957` Add header/logo + live regions + tests/docs
  - `0f1a66e` lint formatting follow-up

## Measurements
- `git diff --shortstat main...HEAD (files changed): 0 → 13`
- `git diff --shortstat main...HEAD (insertions): 0 → 119`
- `git diff --shortstat main...HEAD (deletions): 0 → 17`
- `targeted jest suites: 0 failing → 78 passing`
- `CI=true npm test -- --watchAll=false --runInBand: 0 failing → 1070 passing`
- `npm run typecheck (tsc errors): 0 == 0`
- `npm run build (vite build exit code): 0 == 0`
- `npm run eslint (errors): 0 == 0`

## Verification
live-ui-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Recorded UI walkthrough artifact: `/opt/cursor/artifacts/header_logo_and_ai_live_regions_accessibility_demo.mp4`
- Existing lint warning still present in untouched file `src/components/aiChatDrawer/index.tsx` (`jsx-a11y/no-static-element-interactions`, line ~1138); no new lint errors introduced.
- I did not open or update a PR per your orchestration instruction.

## Suggested follow-ups
- Resolve the existing `aiChatDrawer` jsx-a11y warning so the repo can move cleanly to `eslint --max-warnings 0` when desired.