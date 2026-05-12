<!-- orchestrate handoff
task: dedup-board-copilot-toolbar
branch: orch/ui-buttons-fix-4cc5/dedup-board-copilot-toolbar
agentId: bc-95c33294-3cfc-4a07-9c90-d868a25ce2f6
runId: run-bfdf005e-5a9d-480a-beee-0dd0a5fc1444
resultStatus: finished
finishedAt: 2026-05-12T14:45:30.483Z
-->

## Status
success

## Branch
`orch/ui-buttons-fix-4cc5/dedup-board-copilot-toolbar`

## What I did
- Removed the duplicate `Space.Compact` Brief + Ask buttons from the board header AI cluster so only the sparkle Copilot **dropdown** exposes Ask, Brief, and Open panel (`src/pages/board.tsx`).
- Wrapped dropdown menu labels with spans that reuse `microcopy.ai.askCopilot` and `microcopy.a11y.openBoardCopilotBrief` so those localized strings remain in the accessibility tree for the menu items.
- Dropped obsolete `.ant-space-compact` styling from `BoardActions` and refreshed its header comment to match the layout.
- Updated `src/pages/board.test.tsx` and `src/__tests__/boardAi.integration.test.tsx` to open **Board Copilot menu** then target `menuitem` roles by the preserved accessible names.

## Measurements
- Redundant Ask/Brief header buttons (explicit `Space.Compact`): `2 → 0`
- `CI=true npm test -- … src/pages/board src/pages/board.test.tsx`: `8 passing → 8 passing`
- `CI=true npm test -- … boardAi.integration.test.tsx`: `5 passing → 5 passing`
- `eslint --max-warnings 0 src/pages/board.tsx`: `clean → clean`
- `npx tsc --noEmit`: `clean → clean`

## Verification
`unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- Draft PR: https://github.com/zhuocun/pulse/pull/211 (base `main`, draft, not merged).
- `CopilotWelcomeBanner` still uses `onCta={() => openBriefDrawer()}`; `src/components/copilotWelcomeBanner/index.test.tsx` already asserts `onCta` — no code changes required there.
- Screen recording artifact path: `/opt/cursor/artifacts/board-copilot-toolbar-dedup.mp4` (workspace/desktop capture during this session, not a full manual browser tour).
- Local `.orchestrate/` was not staged or modified.

## Suggested follow-ups
- If CI runs a broader Jest suite than the scoped commands here, watch for any other tests that assumed standalone Brief/Ask **buttons** on the board (none found beyond the updated integration suite under allowed paths).