<!-- orchestrate handoff
task: fix-use-agent-chat-resume-errors
branch: orch/code-smell-sweep-2-9be8/fix-use-agent-chat-resume-errors
agentId: bc-71df6c69-1ede-4f4f-a1e7-4cfec709ef2e
runId: run-7b165d69-a424-4725-aeb2-87e804ecb8a0
resultStatus: finished
finishedAt: 2026-05-18T17:51:30.613Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/fix-use-agent-chat-resume-errors`

## What I did
- Replaced the silent `agent.resume().catch(() => { proposalClearAfterResumeRef.current = null })` in `useAgentChat.ts` with error handling that sets `resumeError` and merges it with `agent.error` for user-visible `effectiveError`.
- Stopped clearing `proposalClearAfterResumeRef` on resume failure; the post-resume effect now treats `resumeError` like `agent.error` and only dismisses the proposal card on successful completion.
- Cleared `resumeError` on `send` and `reset` to preserve existing dismiss/reset semantics.
- Strengthened the stream-failure resume test and added a test for rejected resume promises (via scoped `useAgent.resume` override).
- Opened draft PR #250.

## Measurements
- `useAgentChat tests: 17 passing → 18 passing`
- `npx tsc --noEmit: clean → clean`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- `useAgent.runStream` resolves even when transport fails (sets `agent.error` internally), so the stream-failure path uses `agent.error` and the new promise-rejection path uses `resumeError`.
- Dual `useAi`/`useAgent` mount and dismiss/reset behavior are unchanged; only `useAgentChat.ts` and its test file were modified per scope.
- PR: https://github.com/zhuocun/pulse/pull/250

## Suggested follow-ups
- (none)