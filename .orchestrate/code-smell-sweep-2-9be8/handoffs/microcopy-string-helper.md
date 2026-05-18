<!-- orchestrate handoff
task: microcopy-string-helper
branch: orch/code-smell-sweep-2-9be8/microcopy-string-helper
agentId: bc-a6f19723-dcbc-449a-b42b-092c164bd882
runId: run-95a05395-fd27-4f57-b4bf-3b8bb87664b2
resultStatus: finished
finishedAt: 2026-05-18T17:50:05.696Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/microcopy-string-helper`

## What I did
- Exported `microcopyString(value: unknown): string` from `src/constants/microcopy.ts` (string passthrough; `String(value ?? '')` otherwise).
- Replaced all `(microcopy… as string)` leaf reads in `src/components/aiChatDrawer/index.tsx` with `microcopyString(...)` (tool verbs, templates, ARIA, announcements, tool-details toggle, copy button).
- Replaced `microcopy.ai.toolRoundExhausted as string` in `src/utils/hooks/useAgent.ts` with `microcopyString(microcopy.ai.toolRoundExhausted)`.
- Added `microcopyString` unit tests in `src/constants/microcopy.test.ts`.
- Opened draft PR: https://github.com/zhuocun/pulse/pull/244

## Measurements
- `microcopy as-string casts (aiChatDrawer + useAgent): 18 → 0`
- `CI=true npm test -- --watchAll=false --runInBand src/constants/microcopy src/components/aiChatDrawer src/utils/hooks/useAgent: 115 passing → 115 passing`
- `microcopyString unit tests: 0 → 2`

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Used permissive coercion (`String(value ?? '')`) rather than dev-only throw; matches audit brief default.
- ESLint `--fix` reformatted a few `microcopyString` call sites; committed as follow-up `8fdd21f`.
- Locale files untouched.

## Suggested follow-ups
- Apply `microcopyString` in other components still using `(microcopy… as string)` outside this scoped task.