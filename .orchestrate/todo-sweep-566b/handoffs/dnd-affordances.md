<!-- orchestrate handoff
task: dnd-affordances
branch: orch/todo-sweep-566b/dnd-affordances
agentId: bc-6a6c2ba5-88ef-4b20-9bdf-831d50af9546
runId: run-f3fb4359-96f9-46ea-bb69-dab29bc864ab
resultStatus: finished
finishedAt: 2026-05-11T04:56:28.398Z
-->

## Status
success

## Branch
`orch/todo-sweep-566b/dnd-affordances`

## What I did
- Added **`shadow.lift`** and a **`TaskRowDragShell`** wrapper so task drags get **`box-shadow: shadow.lift`** and **`scale(1.02)`** on the inner card when the draggable root has **`data-dragging="true"`**, with **`transform` / `transition` only under `@media (prefers-reduced-motion: no-preference)`**; reduced-motion still gets lift **shadow** without animated transition.
- Styled **`[data-rfd-placeholder-context-id]`** inside **`TaskContainer`** with **1px dashed `var(--ant-color-primary)`**, **`brand.primaryBg` tint**, **`border-radius`**, and **`transition: none !important`** under **`prefers-reduced-motion: reduce`**.
- Extended **`Drag`** with **`detachDragHandle`**, **`useDetachedDragHandleProps()`**, and **`data-dragging`** on the cloned child; **board** column **`Drag`** now uses **`detachDragHandle`**, **`disableInteractiveElementBlocking`**, and a header **`HolderOutlined`** grip with **`aria-label`** from **`microcopy.dragHints.columnDragHandle`** (`en` + **`zh-CN`**).
- Tests: **`column-dnd.test.tsx`** (real `@hello-pangea/dnd` for handle placement), **`index.test.tsx`** lift wiring + updated **`Drag` mock**, **`dragAndDrop/index.test.tsx`** for **`data-dragging`** / **`detachDragHandle`**.
- Opened **draft PR #200** (`main` ← this branch). No **`docs/todo`** edits (forbidden for this worker). No screen recording in this headless run.

## Measurements
- `CI=true npm test -- --watchAll=false --runInBand src/components/column src/components/dragAndDrop/index.test.tsx`: 0 failing → 0 failing (27 tests)
- `CI=true npm test -- --watchAll=false --runInBand src/pages/board.test.tsx`: 0 failing → 0 failing (8 tests)
- `npm run eslint -- --max-warnings 0`: fail → pass (after `cloneElement` typing fix)
- `npx tsc --noEmit`: pass == pass
- Horizontal **column** drop placeholder (board droppable): unchanged → unchanged (only task-lane placeholders styled per brief)
- (none)

## Verification
`unit-test-verified`

## Notes, concerns, deviations, findings, thoughts, feedback
- **`src/components/dragAndDrop/index.tsx`** and **`src/pages/board.tsx`** were updated so **`dragHandleProps`** are not applied to the whole column; this was required for the explicit grip and **`disableInteractiveElementBlocking`** on a **`<button>`** handle.
- **Before/after drag recording**: not produced here; no artifact path.
- **`docs/todo`** / ui-todo closure text was **not** edited (explicit out-of-scope).

## Suggested follow-ups
- Optionally mirror **task-style placeholder** treatment on the **horizontal column** `Drop` in **`board.tsx`** so column reorder gaps match the task lane.