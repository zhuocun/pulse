<!-- orchestrate handoff
task: extract-ai-chat-composer
branch: orch/code-smell-sweep-2-9be8/extract-ai-chat-composer
agentId: bc-87d1a68b-4905-423a-8c61-e0f7b4c933e9
runId: run-52bc7cba-3a40-4f08-826c-58a870711a9f
resultStatus: finished
finishedAt: 2026-05-18T17:53:39.294Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/extract-ai-chat-composer`

## What I did
- Added `src/components/aiChatDrawer/AiChatComposer.tsx` with typed props: `input`, `setInput`, `isLoading`, `onSend`, `onAbort`, `promptCharHintText`, `promptCharHintWarning`, `remoteHealthEnabled`, `healthStatus`, `inputRef`.
- Replaced the inline drawer footer in `index.tsx` with `<AiChatComposer />` wired from `AiChatDrawerInner`.
- Preserved all `aria-label` values and `data-testid="chat-prompt-char-hint"`; removed now-unused `StopOutlined` and `Input` imports from `index.tsx`.
- Opened draft PR #251: https://github.com/zhuocun/pulse/pull/251

## Measurements
- `LOC(src/components/aiChatDrawer/index.tsx): 2275 → 2230`
- `CI=true npm test -- --watchAll=false --runInBand src/components/aiChatDrawer: 25 passing → 25 passing`
- `npx tsc --noEmit: clean → clean`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `promptCharHintText` / `promptCharHintWarning` remain computed in `AiChatDrawerInner` and are passed down as props (composer is presentational only).
- Upstream `extract-ai-chat-tool-display` (styles/tool-display split) is not on `main` yet; this branch is based on current `main` and should merge cleanly after or alongside #249.
- `.orchestrate/` left unstaged per orchestrator instructions.

## Suggested follow-ups
- Rebase or merge after #249 lands if a second pass is needed to avoid duplicate styled-component work in `index.tsx`.
- Optional: add a focused `AiChatComposer.test.tsx` for send-disabled-when-offline if health gating needs isolated coverage later.