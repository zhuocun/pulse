<!-- orchestrate handoff
task: fix-chat-drawer-focus
branch: orch/bug-sweep-4e70/fix-chat-drawer-focus
agentId: bc-dd607257-b59b-4603-89e7-ead9d2f9902e
runId: run-dbb20eb5-d9f0-4615-ab2d-3cf5e84b2cf4
resultStatus: finished
finishedAt: 2026-05-19T05:29:59.724Z
-->

## Status
success

## Branch
`orch/bug-sweep-4e70/fix-chat-drawer-focus`

## What I did
- Read B9 scope and traced focus theft to the `isLoading` effect in `AiChatDrawer` that always called `lastAssistantRef.current.focus()` on every loading→idle transition.
- Reworked post-streaming focus management: only focus the assistant bubble after an explicit **Regenerate** (`shouldFocusAssistantOnCompleteRef`); when the composer textarea already has focus at completion, leave focus there; removed the blanket assistant focus on every reply.
- Preserved open-drawer composer focus (`open` effect unchanged) and screen-reader completion announcements (`aria-live` region unchanged).
- Added `branches.test.tsx` coverage that mocks a loading→idle transition with composer focus and asserts the assistant bubble is not programmatically focused.
- Pushed branch and opened draft PR #265.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiChatDrawer src/__tests__/aiAccessibility`: 57 passing → 57 passing
- `npx tsc --noEmit`: clean → clean

## Verification
- `unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- `.orchestrate/bug-sweep-4e70/discovery/BUG-SWEEP-AUDIT.md` was not present in the workspace; implemented from the B9 task brief and code audit.
- Draft PR: https://github.com/zhuocun/pulse/pull/265
- Live UI screen recording was not captured (computerUse subagent unavailable for the requested model); behavioral fix is covered by the new unit test plus existing jest-axe suites.

## Suggested follow-ups
- Add an integration test that sends a real message via `useAiChat` (local engine), focuses the composer after reply, sends a follow-up, and asserts focus is not stolen on the second completion.
- Optionally add a regenerate-path test confirming the assistant bubble receives focus only after explicit Regenerate.