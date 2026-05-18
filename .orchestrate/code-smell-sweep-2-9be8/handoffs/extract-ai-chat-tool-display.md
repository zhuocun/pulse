<!-- orchestrate handoff
task: extract-ai-chat-tool-display
branch: orch/code-smell-sweep-2-9be8/extract-ai-chat-tool-display
agentId: bc-b65f7663-b716-48ab-bf3a-20e8217f67e9
runId: run-af259b7e-b023-48ef-9694-58215b089ae6
resultStatus: finished
finishedAt: 2026-05-18T17:51:26.680Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/extract-ai-chat-tool-display`

## What I did
- Added `aiChatToolDisplay.ts` with `TOOL_VERB`, `humanizeTool`, `summarizeToolBody`, `CITATION_INLINE_LIMIT`, `BUDGET_WARN_THRESHOLD`, and `BUDGET_CRITICAL_THRESHOLD`.
- Added `aiChatDrawerStyles.ts` with `MessageRow`, `MessageBubble`, `StreamingCursor`, `AssistantAttribution`, `AssistantDisclaimer`, `ToolPayloadPanel`, and `SamplePrompt` (co-located styled primitive used only in the drawer).
- Updated `index.tsx` to import from both modules; removed unused `@emotion/styled` import; no public API or behavior changes.
- Opened draft PR #249: https://github.com/zhuocun/pulse/pull/249

## Measurements
- `LOC(src/components/aiChatDrawer/index.tsx): 2275 → 2118`
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiChatDrawer: 25 passing → 25 passing`
- `npx tsc --noEmit: clean → clean`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `SamplePrompt` was not in the task brief but moved into `aiChatDrawerStyles.ts` with the other styled primitives to meet the ≥150 LOC reduction on `index.tsx` (net −157).
- Did not run `src/__tests__/aiAccessibility.strict.test.tsx` (outside `pathsAllowed`); scoped suite and `tsc` both green.
- `.orchestrate/` left unstaged per orchestrator instructions.

## Suggested follow-ups
- Deduplicate `TOOL_VERB` / `humanizeTool` between `aiChatToolDisplay.ts` and `useAgentChat.ts` in a follow-up refactor.
- Run `aiAccessibility.strict.test.tsx` in CI or a verifier pass for broader AI UI coverage.