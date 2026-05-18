<!-- orchestrate handoff
task: fix-sw-registration-logging
branch: orch/code-smell-sweep-2-9be8/fix-sw-registration-logging
agentId: bc-30de0213-b0da-4ec1-8ae9-9b83cfeec4d1
runId: run-f45fdefe-0b85-41b1-ac05-d4a30a6e2f06
resultStatus: finished
finishedAt: 2026-05-18T17:50:40.748Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-2-9be8/fix-sw-registration-logging`

## What I did
- Replaced silent `.catch(() => {})` on `navigator.serviceWorker.register("/sw.js")` with `warnOnServiceWorkerRegistrationFailure`, which emits `console.warn` only when `NODE_ENV !== "production"` (same `isProd` gate and `Board Copilot:` prefix as `warnIfMissingObservabilityEndpoints`).
- Added unit tests for dev warn vs prod silence; refactored index test module loading via shared `loadIndexExports`.
- Opened draft PR #246 against `main`.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/index.test.tsx`: 8 passing → 10 passing
- `npx tsc --noEmit`: clean → clean

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Exported `warnOnServiceWorkerRegistrationFailure(error, isProd)` for testability, consistent with `warnIfMissingObservabilityEndpoints`.
- Production behavior unchanged: `isProd` early-return keeps the catch handler silent in production builds.
- PR: https://github.com/zhuocun/pulse/pull/246

## Suggested follow-ups
- (none)