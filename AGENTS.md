# Agent notes

Short, durable gotchas for anyone (human or AI) editing this repo. Add an entry
when a fix is non-obvious from the code alone.

## Drag-and-drop (`@hello-pangea/dnd`)

- The library blocks drags whose event target is a native interactive element
  (`<input>`, `<button>`, `<textarea>`, `<select>`, `<option>`, `<optgroup>`,
  `<video>`, `<audio>`). If a `Draggable`'s root is one of these — or a
  `<Drag>` wraps a component whose root renders one — pass
  `disableInteractiveElementBlocking` on the `<Drag>` (or `<Draggable>`) to
  opt out, otherwise the card will look draggable but never start a drag.
  See `src/components/column/index.tsx` for the task-card case.
- `<DragDropContext onDragEnd>` is wired up in `src/pages/board.tsx` via
  `useDragEnd` (`src/utils/hooks/useDragEnd.ts`). Reorder mutations are
  optimistic — see `src/utils/optimisticUpdate/reorder.ts`.

## Task modal / URL state

- `TaskModal` treats `tasks === undefined` as "still loading" and only clears a
  stale `editingTaskId` from the URL after tasks resolve to a concrete array.
  Do not coerce the board page's tasks query to `[]` before passing it into
  `TaskModal`, or deep-linked edits will close immediately during load.

## Cursor Cloud specific instructions

- This is a Vite React SPA. Standard scripts live in `package.json`; `npm start`
  serves the app on port 3000.
- Browser E2E in Cursor Cloud should not depend on the default remote API:
  `https://jira-python-server.vercel.app` can return 403 from this environment,
  and the checked-in `__json_server_mock__` data is stale relative to the
  current `/api/v1` frontend contract. Use Playwright route mocks or an
  API-compatible local mock when exercising authenticated project and board
  flows.
- If changing `REACT_APP_API_URL`, restart Vite because `vite.config.ts` inlines
  the value into `process.env.REACT_APP_API_URL`.
- The full Jest suite may exceed the default Node heap or hang silently in this
  VM. Targeted Jest runs work; use `NODE_OPTIONS=--max-old-space-size=8192` for
  larger test selections while investigating full-suite behavior.
