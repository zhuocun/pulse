<!-- orchestrate handoff
task: verify-fix-ai-task-assist-smells
branch: `orch/code-smell-sweep-9be8/fix-ai-task-assist-smells` (no verifier commits; working tree clean)
agentId: bc-a69f530e-ec0d-4a07-857a-f0814f524d32
runId: run-3cf5562d-79d0-4619-8461-92523c934537
resultStatus: finished
finishedAt: 2026-05-18T17:19:54.591Z
-->

## Verification

unit-test-verified

## Target
`fix-ai-task-assist-smells` on branch `orch/code-smell-sweep-9be8/fix-ai-task-assist-smells`

## Branch
`orch/code-smell-sweep-9be8/fix-ai-task-assist-smells` (no verifier commits; working tree clean)

## Execution
- → `git branch --show-current` / `git status -sb` — on `orch/code-smell-sweep-9be8/fix-ai-task-assist-smells`, clean tree
- → `rg '\.catch\(\(\)\s*=>\s*undefined\)' src/components/aiTaskAssistPanel` — 0 matches
- → `rg '\.catch\(' src/components/aiTaskAssistPanel` — 3 hits, all `.catch(absorbUseAiRunRejection)` on `runEstimate` / `runReadiness` (lines 342, 345, 439 in `index.tsx`)
- → `rg '\.catch\(\(\)\s*=>\s*undefined\)' src` — 1 unrelated hit in `useAgent.test.tsx` (not estimate/readiness panel paths)
- → `CI=true npm test -- --watchAll=false --runInBand src/components/aiTaskAssistPanel` — **4 suites, 22 tests passed** (exit 0)
- → `npm run eslint -- --max-warnings 0 src/components/aiTaskAssistPanel` — exit 0, 0 warnings
- → `npx tsc --noEmit` — exit 0
- → Read `aiTaskAssistContext.ts` / `index.tsx` — confirmed `buildLocalAiContext`, `buildLocalEstimateRunPayload`, `buildLocalReadinessRunPayload`, `TASK_ASSIST_DEBOUNCE_MS`, `TASK_ASSIST_DELAYED_SPINNER_MS`, and documented `absorbUseAiRunRejection`

## Findings
Per acceptance criterion:
- [x]: **Single helper builds local-engine context payloads** — met (`buildLocalAiContext` + payload builders in `aiTaskAssistContext.ts`; `index.tsx` uses `useMemo(() => buildLocalAiContext(...))` and shared builders in effect + regenerate)
- [x]: **No `.catch(() => undefined)` on estimate/readiness runs** — met (0 anonymous empty catches in panel; three named `absorbUseAiRunRejection` sinks)
- [x]: **Debounce/delay constants named** — met (`TASK_ASSIST_DEBOUNCE_MS = 1000`, `TASK_ASSIST_DELAYED_SPINNER_MS = 250` wired in `index.tsx`)
- [x]: **Existing aiTaskAssistPanel tests pass** — met (22/22 passing, up from upstream’s 18 via new `aiTaskAssistContext.test.ts`)

Other findings (severity-ordered):
- (low): `absorbUseAiRunRejection` is still a no-op promise sink; upstream note stands — failures are expected to surface via `useAi` hook `error` before rejection. Unit test documents contract only; no new integration test asserts UI alert on rejected `run`.

## Notes & suggestions
- All three recipe commands passed on this VM without blockers.
- Scoped grep goal satisfied for `aiTaskAssistPanel`; repo-wide `.catch(() => undefined)` remains only in unrelated `useAgent.test.tsx`.
- No verifier artifacts committed (nothing to add beyond upstream’s draft PR #242).