<!-- orchestrate handoff
task: fix-dnd-clone-types
branch: orch/code-smell-sweep-9be8/fix-dnd-clone-types
agentId: bc-43d0feba-23c8-40a9-8b83-58ccc8ed52ec
runId: run-211a978f-a9d4-4e56-b38a-6340965adb14
resultStatus: finished
finishedAt: 2026-05-18T17:17:13.776Z
-->

## Status
success

## Branch
`orch/code-smell-sweep-9be8/fix-dnd-clone-types`

## What I did
- Added `DropCloneProps` and `DragCloneProps` from `@hello-pangea/dnd` provided types plus `RefAttributes<HTMLElement>` and wrapper fields (`provided`, `data-dragging`).
- Replaced `cloneElement<RefAttributes<unknown> | any>` and `base as any` with typed `React.ReactElement<…>` assertions and a `DragCloneProps` object (spread for handle props instead of `Object.assign`).
- Removed all `@typescript-eslint/no-explicit-any` disables from `src/components/dragAndDrop/index.tsx`.
- Opened draft PR #237.

## Measurements
- `eslint no-explicit-any disables in dragAndDrop/index.tsx`: 2 → 0
- `CI=true npm test -- --watchAll=false --runInBand src/components/dragAndDrop`: 6 passing → 6 passing
- `npm run eslint -- --max-warnings 0 src/components/dragAndDrop`: 0 warnings → 0 warnings
- `npx tsc --noEmit`: pass → pass

## Verification
unit-test-verified

## Notes, concerns, deviations, findings, thoughts, feedback
- Discovery audit path `.orchestrate/code-smell-sweep-9be8/discovery/CODE-SMELL-AUDIT.md` was not present in this workspace; followed the scoped task brief instead.
- `DraggableProvidedDraggableProps` is exported by the package but must be imported explicitly (tsc failed until added).
- Child narrowing uses `children as React.ReactElement<DropCloneProps | DragCloneProps>` after `isValidElement` — no `any`, only typed assertions.
- Column/board DnD and `disableInteractiveElementBlocking` were not modified per scope.

## Suggested follow-ups
- Run `src/components/column/column-dnd.test.tsx` in CI or a verifier pass to confirm integration with real `@hello-pangea/dnd` (unit tests mock the library).