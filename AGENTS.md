# Agent notes

Short, durable gotchas for anyone (human or AI) editing this repo. Add an entry
when a fix is non-obvious from the code alone.

## v2.1 agent surface (`useAgent`)

- Both `useAi` (v1 JSON) and `useAgent` (v2.1 SSE) commonly mount unconditionally
  in components that switch on `environment.aiUseLocalEngine`. This is required —
  conditionally calling either hook breaks React's hook-ordering rule. See
  `AiChatDrawer` and `BoardBriefDrawer` for the canonical pattern.
- Migration progress for the six structured routes lives in
  `docs/status/product-done.md`. As of 2026-05-05, all six are on the
  v2.1 SSE surface in remote builds (each component dual-mounts `useAgent`
  alongside `useAi` and switches on `environment.aiUseLocalEngine`). `useAi`
  remains the local-engine fallback path.
- Triage nudges are subject to PRD AC-V14 inbox rules in `useAgent.ts`:
  `NUDGE_INBOX_MAX = 5`, dedup by `(kind, project_id)`, `NUDGE_EXPIRY_MS = 4h`,
  60-second prune sweep, plus an explicit `dismissNudge(nudge_id)` API. The
  pure `reduceNudgeInbox` reducer is exported for unit tests.
- The FastAPI backend wraps typed AI errors as `{"error": {"code", "message"}}`
  rather than returning `code`/`message` at the top level. Keep
  `src/utils/ai/mapErrorResponse.ts` compatible with both shapes, because older
  tests/docs still refer to the flat envelope while the live FE-BE contract is
  nested.
- Tests that render `BoardPage` or `AiChatDrawer` and partial-mock
  `../utils/hooks/useAiEnabled` MUST also mock `useAutonomyLevel: () => ({level:
"plan", setLevel: jest.fn()})`. Otherwise `useAgent` crashes destructuring
  `{level}` from `undefined`. See the four `src/__tests__/*.strict.test.tsx`
  suites for examples.
- Components that trigger `remoteAgent.start()` from an effect must not depend on
  the whole `useAgent()` return object. `useAgent` returns a memoized object
  whose identity still changes on streaming state updates (`isStreaming`,
  `lastSuggestion`, `error`), which can restart the same agent request in a
  loop. Destructure the specific stable methods/data you need and depend on
  those instead. See `src/components/aiTaskAssistPanel/index.tsx`.

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

## Deployment

For required env vars, CDN cache-purge guidance, FE smoke tests after
deploy, and the BE companion-server prerequisites, see
[`docs/operations/deployment.md`](docs/operations/deployment.md). Per-tier
GA blockers and ship sequence live in
[`docs/status/release-todo.md`](docs/status/release-todo.md).

## Cursor Cloud

VM-specific gotchas (mongod `--fork` workaround, NVM bootstrap, Jest
heap bump, vendored `cursor-sdk` / `orchestrate` skills) live in
[`docs/operations/cursor-cloud.md`](docs/operations/cursor-cloud.md).
