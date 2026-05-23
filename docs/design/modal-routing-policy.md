# Modal-routing policy

Status: adopted, Phase 3.
Owners: design + frontend.
Scope: every new "detail surface" the app ships from now on.

## The rule

**New detail surfaces are routed by default.** A "detail surface" is any
view that shows a single addressable resource (a task, a board brief,
an inbox item, a project settings sheet) and lives _over_ the page that
launched it. These get a URL.

AntD `Modal` (and `Modal.confirm`) is reserved for **ephemeral,
non-deep-linkable interactions**: confirms, transient prompts,
discard-edits dialogs, delete confirms, "are you sure" UI. Anything
where the answer is _yes/no/cancel_ and there's no resource for the
user to come back to later.

If you're tempted to reach for a `Modal` for a detail surface, route
it instead.

## Why

Routing the surface buys six things that AntD `Modal` gives up:

1. **Browser back closes it.** On every platform. The iOS swipe-back
   gesture, the Android system back button, the desktop back arrow —
   all of these already mean "dismiss the topmost thing." Routed
   surfaces honor that contract for free; modals fight it.
2. **Deep links work.** A task URL pastes into Slack, opens to the
   task. A 404 page can land you on the right `EmptyState` instead of
   the project list. A bug report can include the URL.
3. **Open-in-new-tab works.** Cmd/Ctrl-click on any link to the
   surface opens a fresh tab on it. Triage workflows where you scan
   ten cards while keeping the board behind become real.
4. **Screen readers announce the route change.** Modals depend on
   `role="dialog"` + focus trap + `aria-labelledby` plumbing the
   author has to get right. Route changes are an inherent context
   shift the AT already handles.
5. **`viewTransition: true` works.** React Router 7 wraps any
   navigation marked `viewTransition` in `document.startViewTransition()`,
   which we already lean on (see the view-transition rules block in
   `src/App.css:329-358` and the per-component `view-transition-name:
   pulse-header` / `pulse-tabbar` opt-outs). Modal mount/unmount is
   invisible to that pipeline.
6. **It scales to swipe-between.** Once a surface is keyed off
   `/.../task/:taskId`, "next task" is just another `navigate(...)` —
   no portal teardown, no Redux replay, no `useEffect` race.

The pattern also pays back a long-standing regression: PR #226 moved
overlay state to Redux to fix an iOS Safari bug, but the cost was that
back-gesture and deep-links broke for every modal. Routing is how we
pay that bill back.

## Examples in the codebase

### Routed (do this)

- **Routed task panel (A2)** — `src/routes/index.tsx:163-203` mounts
  `<BoardRouteShell />` as a layout route, the board page renders
  underneath, and the `task/:taskId` child mounts
  `<TaskDetailPanel />` over it. The board never unmounts when a task
  opens; the URL is the source of truth. See `useTaskPanelNavigation`
  in `src/utils/hooks/useTaskPanelNavigation.ts` for the navigation
  hook.
- **CopilotDock (A1, in-flight)** — chat / brief / inbox / settings
  surfaces collapse into a routed dock at `/copilot` (and project-
  scoped sub-paths). Body components (`<ChatTabBody>`, `<BriefTabBody>`)
  are extracted so they can be mounted by both the routed shell and
  the existing drawers behind a feature flag during rollout.
- **Auth flows** — `/login`, `/register`, `/auth/forgot-password`,
  `/auth/terms` (`src/routes/index.tsx:219-243`). Each is routed; each
  is deep-linkable.
- **404 / not-found** — `src/routes/index.tsx:123-142`. The `EmptyState`
  with `tone="notFound"` is _the page_ at the unknown route, not a
  modal that pops over wherever the user happened to be.

### Confirms (keep AntD `Modal.confirm`)

- **Delete column** — `src/components/column/index.tsx:425`.
- **Delete project** — `src/components/projectList/index.tsx:201`.
- **Delete task** — `src/components/taskModal/index.tsx:227`
  (and the equivalent `src/components/taskDetailPanel/index.tsx:367`).
  The dialog is transient; there is no `/are-you-sure-delete-task-foo`
  URL worth sharing.
- **Discard unsaved edits.** Today this only fires from the routed
  `<TaskDetailPanel />` — see the `<Modal>` at
  `src/components/taskDetailPanel/index.tsx:888-941`, driven by the
  `useBlocker`-based dirty-form guard (around line 276). The legacy
  `<TaskModal>` doesn't have a discard-edits dialog yet; its "Discard
  edits" affordance (`src/components/taskModal/index.tsx:493`) is a
  Button on the "removed by others" alert that closes the modal
  directly. When `<TaskModal>` gains an inline-edits dirty guard, it
  should reuse the same `<Modal>` shape rather than reaching for a
  `Modal.confirm`.

These should stay `Modal.confirm` (or a plain `<Modal>` for the
discard-edits case — same answer-and-go shape, just rendered with the
declarative API so we can wire `useBlocker` into the open state).

## Decision matrix

| Question                                                    | Route it          | Modal             |
| ----------------------------------------------------------- | ----------------- | ----------------- |
| Does the surface address a single resource (task, project)? | Yes               | No                |
| Should a teammate be able to share a URL to it?             | Yes               | No                |
| Does swipe-back / browser-back make sense as "close"?       | Yes               | No                |
| Could the user reasonably want to "open in new tab"?        | Yes               | No                |
| Does it appear, take a yes/no answer, and disappear?        | No                | Yes               |
| Is the underlying page meaningful once the surface closes?  | Yes (keep it mounted) | Yes (it's still there) |
| Will the surface ever host its own scroll / keyboard / forms? | Yes             | Avoid             |

If any of the first four answers are "yes," route it. If all of the
first four are "no" and the surface is a yes/no confirmation, use
`Modal.confirm`.

## Implementation pattern

The canonical pattern is a layout route + `<Outlet />`. The parent
stays mounted, the child route mounts the overlay on top. Reference
implementation: A2 routed task panel.

```tsx
// src/routes/index.tsx (paraphrased)
const BoardRouteShell = () => (
    <>
        <BoardPage />
        <Outlet />
    </>
);

const routes = [
    {
        path: "projects/:projectId",
        children: [
            {
                path: "board",
                element: <BoardRouteShell />,
                children: [
                    { index: true, element: null },
                    {
                        path: "task/:taskId",
                        element: <TaskDetailPanelRoute />
                    }
                ]
            }
        ]
    }
];
```

Three properties to preserve:

1. **The parent layout never unmounts** when a child route opens.
   `<BoardRouteShell />` always renders `<BoardPage />`, so the
   board's React tree, query cache, and scroll position survive the
   task panel opening and closing.
2. **A route-level adapter reads params and hands them to a pure
   panel.** `TaskDetailPanelRoute` in `src/routes/index.tsx:177-203`
   reads `projectId` / `taskId` from `useParams`, wires AI gating,
   then renders `<TaskDetailPanel projectId={...} taskId={...} />`.
   The panel itself stays propful and testable without routing
   infrastructure.
3. **Close is a `navigate` to the parent route.** See
   `useTaskPanelNavigation.closeTask` — it navigates to
   `/projects/:projectId/board`, which unmounts the outlet child and
   leaves the layout in place. Deep-link visitors with one history
   entry land on `/projects` as a safe default.

### Phone-first shells

The panel itself is an AntD `Drawer` (`placement="bottom"` on phones,
`right` on tablets+) — the _shape_ is still a sheet, but the route is
the source of truth, not the open/close state. The shell respects
`env(keyboard-inset-height, 0px)` and ships a `useBlocker`-based
dirty-form guard.

### Dirty-form guards

When a routed surface owns a `<Form>`, use React Router 7's
`useBlocker` to intercept the navigation and surface a Discard /
Cancel `Modal.confirm`. This is the one place a `Modal.confirm` lives
inside a routed flow — the confirm is the ephemeral yes/no, the route
change is the persistent state shift.

## Migration plan

- **Phase 3, in-flight.**
  - **A1 — CopilotDock.** Extract `<ChatTabBody>` / `<BriefTabBody>`
    as pure components, mount them inside a routed `<CopilotDock />`
    shell, gate behind `REACT_APP_COPILOT_DOCK`. Delete the legacy
    `<AiChatDrawer />` / `<BoardBriefDrawer />` once the flag flips on
    production. Owner: A1 agent.
  - **A2 — Task panel.** Shipped behind `environment.taskPanelRouted`;
    flag flips on after the regression window. See A2 in
    `docs/design/ui-ux-comprehensive-review-2026-05.md`.
- **Phase 4.**
  - **A8 — Inbox item detail.** Each inbox entry gets
    `/inbox/:itemId`. The list stays mounted (layout route), the item
    detail mounts in the outlet. Same shape as A2.
  - **Project settings sheet.** Today it's an AntD `Modal`; migrate to
    `/projects/:projectId/settings` so it's deep-linkable from team
    docs and Slack.

We are **not** retroactively migrating `<TaskCreator>` or
`<ProjectModal>` create flows in this pass — those are creation
flows, not detail surfaces, and the resource doesn't exist yet to
have a URL. Re-evaluate after the first detail-surface migrations
land.

## Counter-examples — what stays a modal

- **Delete confirms** (`Modal.confirm` with `okType: "danger"`).
- **Discard unsaved edits.**
- **Logout confirm**, if we add one.
- **One-off prompts** ("Name this view," "Save as template")
  that take a single string and dismiss. These could be a popover or
  an inline input row — but if they need a focus trap and a backdrop,
  they're a modal, not a route.

## What this policy doesn't change

- **AntD `Drawer`** is fine as the _shell_ for a routed surface. It's
  the _state_ that needs to live in the URL, not the visual shape.
- **`Popover`, `Tooltip`, `Dropdown`** are not modals; this policy
  doesn't apply. They're hover/tap affordances and stay where they
  are.
- **Toasts** (`notification.*`, `message.*`) are not modals; same.

## Open questions

- **AntD `Modal.confirm` accessibility.** The current AntD `confirm`
  uses `role="alertdialog"`. We rely on that; this policy doesn't
  re-evaluate it.
- **Animation parity.** Routed surfaces use the View Transitions API;
  modal mounts use AntD's built-in CSS transition. The two look
  similar enough today but we should audit when CopilotDock lands.

## See also

- `docs/design/ui-ux-comprehensive-review-2026-05.md` §A2 — routed
  inline task panel rationale.
- `docs/design/mobile-native-best-practices.md` — bottom-sheet shells
  and the Baymard "broken back button" finding.
- `src/routes/index.tsx` — the canonical layout-route + outlet pattern.
- `src/utils/hooks/useTaskPanelNavigation.ts` — the canonical open/
  close hook for a routed panel.
