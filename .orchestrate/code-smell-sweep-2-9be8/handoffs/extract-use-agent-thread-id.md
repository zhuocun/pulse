<!-- orchestrate handoff
task: extract-use-agent-thread-id
branch: orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id
agentId: bc-86868faa-0b5e-4726-a1b3-4c3f74c34c5e
runId: run-872cf69d-445c-41cb-a394-38732aa3493d
resultStatus: finished
finishedAt: 2026-05-18T17:50:31.587Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id`

## What I did
- Created `src/utils/hooks/useAgentThreadId.ts` with `generateThreadId` and `TTFT_SLO_MS` (moved verbatim from `useAgent.ts`).
- Updated `useAgent.ts` to import those symbols and re-export them for backward compatibility.
- Added `src/utils/hooks/useAgentThreadId.test.ts` covering `t_` prefix, `crypto.randomUUID` path, fallback path, and `TTFT_SLO_MS === 1500`.
- Pushed branch and opened draft PR #245.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useAgent src/utils/hooks/useAgentThreadId`: 75 passing → 75 passing
- `npx tsc --noEmit`: exit 0 → exit 0

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- No behavior change; `useAgent.test.tsx` was not modified (still green via the matched test run).
- Re-exports from `useAgent.ts` preserve any future/test imports of `generateThreadId` / `TTFT_SLO_MS` from that barrel.
- Draft PR: https://github.com/zhuocun/pulse/pull/245

## Suggested follow-ups
- (none)