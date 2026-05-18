<!-- orchestrate handoff
task: fix-use-react-mutation-types
branch: orch/code-smell-sweep-9be8/fix-use-react-mutation-types
agentId: bc-cf715f23-186d-4c0c-b260-d0e57cea56a8
runId: run-3e2d5895-3ddb-4286-8988-cadf6dc87ffb
resultStatus: finished
finishedAt: 2026-05-18T17:17:15.657Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/fix-use-react-mutation-types`

## What I did
- Replaced `callback?: (...args: any) => any` in `src/utils/hooks/useReactMutation.ts` with a typed `OptimisticUpdateCallback` alias: `(target: unknown, old?: unknown) => unknown | undefined`.
- Used a bivariant method-signature pattern so existing call sites with narrower parameter types compile without edits or new eslint disables.
- Removed the `@typescript-eslint/no-explicit-any` eslint-disable on the callback parameter.
- Left `useReactMutation.test.tsx` unchanged — 16 existing tests already cover optimistic apply, rollback on error, and undefined/same-reference no-op behavior.
- Opened draft PR #238 against `main`.

## Measurements
- `any` in useReactMutation public callback type: 1 → 0
- `CI=true npm test -- --watchAll=false --runInBand src/utils/hooks/useReactMutation`: 16 passing → 16 passing
- `npm run eslint -- --max-warnings 0 src/utils/hooks/useReactMutation.ts`: 0 warnings → 0 warnings
- `npx tsc --noEmit`: pass → pass

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- The audit doc at `.orchestrate/code-smell-sweep-9be8/discovery/CODE-SMELL-AUDIT.md` was not present in the workspace; proceeded from the task brief and source inspection.
- Strict function-parameter contravariance blocked a plain `(target: unknown, old?: unknown) => unknown | undefined` alias — `tsc` failed at 7 production call sites and 6 test mocks. A bivariant method-signature wrapper preserves the public typed contract while keeping all consumers assignable without call-site changes.
- No call-site or test-file edits were required; behavior (rollback on `undefined` / same reference via `Object.is`) is unchanged.
- PR: https://github.com/zhuocun/pulse/pull/238

## Suggested follow-ups
- Optionally export `OptimisticUpdateCallback` if other modules want to annotate optimistic helpers explicitly.
- Consider documenting the bivariant pattern in `AGENTS.md` if similar callback-typing refactors are planned elsewhere.