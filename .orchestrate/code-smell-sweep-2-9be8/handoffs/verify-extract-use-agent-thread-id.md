<!-- orchestrate handoff
task: verify-extract-use-agent-thread-id
branch: `orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id` (no verifier commits)
agentId: bc-e87a1a7d-eb6a-4565-b09e-38005fba1c64
runId: run-6beee946-5104-416e-ac47-838f62d6e2b5
resultStatus: finished
finishedAt: 2026-05-18T17:52:07.150Z
-->

## Verification

`unit-test-verified`

## Target
`extract-use-agent-thread-id` on branch `orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id`

## Branch
`orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id` (no verifier commits)

## Execution
- → Confirmed checkout on `orch/code-smell-sweep-2-9be8/extract-use-agent-thread-id`; working tree clean.
- → Inspected `src/utils/hooks/useAgentThreadId.ts`: defines `generateThreadId` and `TTFT_SLO_MS = 1500`.
- → Inspected `src/utils/hooks/useAgent.ts`: imports both symbols from `./useAgentThreadId`; re-exports for backward compatibility; no local duplicate definitions.
- → Inspected `src/utils/hooks/useAgentThreadId.test.ts`: covers `t_` prefix, `crypto.randomUUID` path, fallback path, and `TTFT_SLO_MS === 1500`.
- → `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useAgent src/utils/hooks/useAgentThreadId` → **7 suites, 75 tests passed** (includes `useAgent.test.tsx`).
- → `npx tsc --noEmit` → **exit 0**.

## Findings
Per acceptance criterion:
- [x]: `useAgentThreadId.ts` owns thread id + TTFT constant — **met** (`generateThreadId`, `TTFT_SLO_MS` live in `useAgentThreadId.ts`; `useAgent.ts` only imports/re-exports).
- [x]: `useAgent.test.tsx` green — **met** (included in 75/75 passing test run).

Other findings (severity-ordered):
- (none)

## Notes & suggestions
- Extraction is behavior-preserving: re-exports from `useAgent.ts` keep existing import paths working.
- Dedicated `useAgentThreadId.test.ts` covers the extracted symbols directly; no regressions observed in the broader `useAgent*` suite.