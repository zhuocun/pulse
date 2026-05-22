# 02 — Board + project detail review

## TL;DR

The board is solid on mobile boilerplate (snap-scroll, dvh, safe-areas, 16 px input rule, drag-handle 44 px) and has a clean optimistic-update pipeline. The product surface, however, is showing the architectural seams: the task model is poverty-flat (no due date, priority, status semantics, tags, attachments), the column has a card design that under-utilizes the available vertical space, the AI header sprouts **three** overlapping CTAs that ship today, the filter chips have a "Clear all" affordance that is never wired up, the project-detail shell renders a Tabs control with **one** static tab, and the task editor opens as a heavy AntD `Modal` even though the modal state is no longer in the URL (back button broken) — phones get a 320-px-of-chrome dialog when a bottom sheet would be native-feeling and faster. The board has no virtualization, no grouping/swimlanes, no sort, no keyboard nav between cards, no "Today" lens, no inline-edit, no due-date concept at all, and no offline/error-overlay differentiation. There is a real opportunity here: a small redesign of the card + filter rail + task-open surface — plus collapsing the duplicate AI cluster — would lift the board from "Trello clone" to something genuinely faster and more useful than what Linear/Trello ship on the same form factor.

## Surfaces audited

- `src/pages/board.tsx` (988 LOC — board page shell, DnD context, AI/Brief/Ask cluster, swipe hint, filter-status live region, triage agent wiring, copilot menu)
- `src/pages/projectDetail.tsx` (289 LOC — sticky frosted top bar with breadcrumb + tabs, Outlet, project-loading & not-found)
- `src/components/column/index.tsx` (755 LOC — column shell, card composition, drag handle, status dot, filtered-empty state, delete dropdown)
- `src/components/dragAndDrop/index.tsx` (118 LOC — thin wrapper over `@hello-pangea/dnd` with `DetachedDragHandleContext`)
- `src/components/filterChips/index.tsx` (159 LOC — chip row + optional Clear all)
- `src/components/taskCreator/index.tsx` (196 LOC — "Create task" / "Draft with AI" affordance row)
- `src/components/columnCreator/index.tsx` (155 LOC — "Add column" button → inline Input)
- `src/components/status/index.tsx` (56 LOC — full-page spinner / error helpers, only used at route level)
- `src/components/row/index.tsx` (37 LOC — generic flex row used by header + ColumnHeader)
- `src/components/taskModal/index.tsx` (630 LOC — interaction patterns reviewed; modal-internal markup delegated)
- `src/components/memberPopover/index.tsx` (167 LOC — team-roster popover; not actually mounted on the board today — see Finding 9)

Supporting hooks/utilities skimmed for context: `useTaskModal`, `useDragEnd`, `useUrl`, `useBoardBriefDrawer`, `useAiChatDrawer`, `_createOverlayHook`, `useReactMutation` (optimistic plumbing), `optimisticClientId`, `taskSearchPanel`.

---

## Findings — ranked

### F1 — Two AI entry points + a settings cog stacked in the header (visual & accessibility regression)

- **Surface:** Board header (`src/pages/board.tsx:631-783`)
- **Severity:** High
- **Type:** Visual regression + duplicate affordance + likely a11y violation
- **Evidence:** `src/pages/board.tsx:636-682` renders a "Copilot" `Dropdown` button with "Ask Copilot" + "Board brief" items. Immediately after, `src/pages/board.tsx:683-714` renders `Space.Compact` containing **the same two actions again** ("Brief", "Ask") as standalone buttons. A code comment at `src/pages/board.tsx:683` literally says `P1-A: Consolidate into CopilotMenu in next phase`. The settings cog (`src/pages/board.tsx:717-781`) is a third icon sitting beside the duplicated cluster.
- **Why:** When AI is on, the user sees three discrete affordances (Copilot, Brief, Ask) that all open one of two drawers. On a phone, `BoardActions` (`src/pages/board.tsx:303-333`) wraps the row to full width below the title — that cluster currently consumes ~280 px tall × 100 % width of chrome before any content. AntD doesn't auto-collapse `Dropdown` + `Space.Compact` so screen-reader users hear "Copilot dropdown button… Brief button… Ask button…" — same destinations, three labels.
- **Fix:** Ship the work the comment promises. Delete the `Space.Compact` block (board.tsx:683-714). Move "Settings" into the `CopilotMenu` dropdown as a third item. Resulting header has a single brand-tinted Copilot button + the AntD project-settings cog (or fold the cog into a Project menu in the breadcrumb chrome). Saves ~120 LOC and ~64 px of vertical chrome on mobile.

### F2 — `FilterChips.onClearAll` is supported by the component but never wired (dead affordance)

- **Surface:** Filter rail (`src/components/taskSearchPanel/index.tsx:299`)
- **Severity:** Medium
- **Type:** Dead code / unrealised UX
- **Evidence:** `src/components/filterChips/index.tsx:17-23` declares optional `onClearAll`; `src/components/filterChips/index.tsx:150-154` renders a Clear all CTA only when `onClearAll && chips.length >= 2`. The single call site at `src/components/taskSearchPanel/index.tsx:299` does **not** pass `onClearAll`, so the affordance is impossible to reach. Users must click each chip's tiny ✕ individually. A separate "Reset filters" button does exist (`taskSearchPanel/index.tsx:289-298`), but it lives outside the chip row, after the inputs, hiding off-screen on phones once chips wrap to a second line.
- **Why:** Power-users with 3-4 active filters cannot one-tap reset from where their eye lives.
- **Fix:** Pass `onClearAll={resetParams}` and `clearAllLabel={microcopy.actions.resetFilters}` at the chip-row call site. Then make the standalone Reset button only appear in tablet+ layouts to avoid duplication.

### F3 — Task modal back-button regression (overlay state left URL, AntD modal is huge on phones)

- **Surface:** Task open interaction (`src/utils/hooks/useTaskModal.ts:10-14`, `src/components/taskModal/index.tsx:322-429`)
- **Severity:** High
- **Type:** Mobile-native regression + form ergonomics
- **Evidence:** `useTaskModal` was migrated to Redux (`src/utils/hooks/_createOverlayHook.ts:12-30` documents the move). The doc says "Trade-off accepted: deep links to `?modal=on` and the back-button gesture no longer auto-open overlays" — but the back-button-dismiss gesture is also gone. Tapping a card now opens a full-screen AntD `Modal` (`taskModal/index.tsx:322`). On a phone the body is capped at `calc(100dvh - 320px)` (taskModal/index.tsx:424) because the title spans two lines and the footer stacks **three** full-width buttons (Save / Cancel / Delete, taskModal/index.tsx:365-378). Delete is visually equidistant from a thumb's primary-action zone — sloppy taps will land it.
- **Why:** The `mobile-native-best-practices.md` red-flag list explicitly calls out "Broken back button in SPAs (Baymard 2024: 59 % of sites violate)". The board's other overlays (`useAiDraftModal`, `useBoardBriefDrawer`) keep state in URL specifically to fix this; `useTaskModal` regressed to Redux. The iOS swipe-back gesture no longer dismisses the task editor — users hit hardware/system back and exit the project route instead of closing the modal.
- **Fix:** Two-tier redesign. (a) Restore back-button dismissal by either keeping the URL hook variant for `useTaskModal` or wiring a `popstate` push on overlay open (the Redux path can still dispatch from the listener). (b) On phones, replace the AntD `Modal` with an AntD `Drawer placement="bottom"` (a bottom sheet); on tablet+, switch to a right-side drawer (route-based, `/projects/:id/board/task/:taskId`). This frees the user to keep scrolling the board column behind, and turns the "swipe to next task" pattern (R3) into a 30-LOC follow-up. Bonus: drawer hosts longer notes without the 320-px-of-chrome ceiling.

### F4 — Card design under-uses vertical space + omits high-signal fields

- **Surface:** Task card (`src/components/column/index.tsx:481-581`)
- **Severity:** High
- **Type:** Information density
- **Evidence:** `TaskCard` renders, in this order: an optional `EpicTag` (column/index.tsx:508-515), a 2-line title (`CardTitle` line-clamp 2 at column/index.tsx:262), and a single footer row with Task/Bug badge, story-points pill, AI strength badge, and assignee avatar (column/index.tsx:517-577). There is **no due date** (`ITask` in `src/interfaces/task.d.ts:1-12` has no `dueDate` / `priority` / `status` / `labels` field), no priority indicator, no progress bar, no comment count, no "blocked" state, no last-update timestamp, no per-column ordering hint.
- **Why:** Pulse advertises an AI-assisted board ("triage agent", "Brief", "Ask"), but the AI has nothing to triage against — no due date means no "due today" or "overdue" lens; no priority means no `P0` red-edge accent; no status flag means a task stuck in QA looks identical to one untouched for 30 days. Compared to Linear's card (id chip, priority dot, due chip, assignee, sub-issue count) the Pulse card is competitive on title typography only.
- **Fix:** Three steps. (a) Extend `ITask` with `dueDate?: string | null; priority?: 0|1|2|3; labels?: string[]; updatedAt?: string` (server-managed; the brief drawer already infers some of this). (b) Add a compact "facets row" between title and footer: priority dot (`semantic.error` / `warning` / `success`), due-date chip (overdue → `errorBg`, today → `warningBg`, this week → `infoBg`, else hidden), label dots. (c) Provide a "Compact" density toggle in the project settings cog: collapses to a single-line list view (title + assignee + due chip) — the kanban becomes legible at ~12 cards per column on a 13" laptop instead of ~6.

### F5 — `project_detail` Tabs row is a one-tab decoration

- **Surface:** Project detail shell (`src/pages/projectDetail.tsx:166-175, 244`)
- **Severity:** Medium
- **Type:** Visual chrome with no navigation value
- **Evidence:** `tabItems` at `projectDetail.tsx:166-175` declares one entry, `"board"`. The frosted-glass `TopBar` (projectDetail.tsx:33-95) renders the Breadcrumb + a sticky AntD `Tabs` strip with a single "Board" link, always active. The `useEffect` at projectDetail.tsx:206-211 force-redirects every other URL into `/board`, so the Tabs control will never have a sibling.
- **Why:** ~50 px of sticky chrome that does nothing on mobile (where vertical pixels are scarce); on desktop the orange ink-bar implies more views exist when they don't. The chrome also doubles the visible padding above the kanban (header → frosted bar → search panel → swipe hint → columns = five layered surfaces before the first card). Users see four horizontal lines before the actual product.
- **Fix:** Until there is a real second tab (Insights / Backlog / Roadmap / Timeline), delete the Tabs. Replace the TopBar with a slim 36-px breadcrumb-only strip on tablet+ and merge the breadcrumb into the BoardHeader on phones. Adds vertical breathing room on every form factor.

### F6 — Drag-and-drop is desktop-only in spirit (no autoscroll affordance, no long-press hint, no keyboard a11y, filters block drag silently)

- **Surface:** DnD wiring (`src/pages/board.tsx:387-389`, `src/components/column/index.tsx:693-723`)
- **Severity:** High
- **Type:** Mobile + accessibility
- **Evidence:** `useDragEnd` (`src/utils/hooks/useDragEnd.ts`) drives both column and task drags. `@hello-pangea/dnd` supports keyboard DnD natively, and the card carries `aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"` (column/index.tsx:500) plus a `title={microcopy.dragHints.taskCardKeyboard}` tooltip — but **the card itself receives no visible "drag-lift" cue** beyond the existing scale(1.02) + shadow.lift on `[data-dragging="true"]` (column/index.tsx:139-148). On a phone there is no long-press hint on the card, no autoscroll-near-edge gesture for cross-column drags, no haptic on lift (the `useReducedMotion` infra exists but no `navigator.vibrate(10)` call), no drag-to-archive zone. Worse, when filters are active the board silently disables row drag (`taskDragDisabled || hasActiveFilters` at board.tsx:929-931) — users dragging a filtered card get **no visual feedback** about why their drag isn't firing. The disabled-state is invisible.
- **Fix:** (a) Add a subtle drag-handle dot or `cursor: grab` on the card edge on hover so the affordance is discoverable. (b) When `hasActiveFilters` is true, lower opacity on cards to ~0.92 and add a banner above the columns ("Drag disabled while filters active — Clear filters to reorder"). (c) On `dragStart`, fire `navigator.vibrate(10)` behind `useReducedMotion()`. (d) Surface keyboard-DnD support visually — a "Press Space to lift" microcopy beneath the title when the card is focused.

### F7 — No virtualization on tasks-per-column; re-render hotspots in card grid

- **Surface:** Column body (`src/components/column/index.tsx:685-724`, `src/pages/board.tsx:391-402`)
- **Severity:** Medium → High at scale
- **Type:** Performance
- **Evidence:** `filteredTasks.map(...)` at column/index.tsx:685 renders every task in a column unconditionally. `tasksByColumn` at board.tsx:391-402 is `useMemo`d on `visibleTasks`, which is `tasks ?? []` — every time the React Query cache invalidates (every drag end, every task update, every poll), the entire `visibleTasks` array reference changes, `tasksByColumn` rebuilds, and **every** `Column` re-renders. There is no `React.memo` on `Column` or `TaskCard`. On a board with 4 columns × 50 tasks (= 200 cards), a single title edit re-runs the title + filter list + avatar lookup + AI strength getter (`getAiSearchStrength` at column/index.tsx:491) for all 200 cards.
- **Why:** The board is sold as a triage surface — boards with 100+ tasks per column are realistic. Cards take ~60 ms apiece to first paint on low-end phones (Inter web font + AntD avatar + Tag); re-painting 200 cards on every drag-end will torpedo INP.
- **Fix:** Three steps. (a) `React.memo` `TaskCard` with a custom comparator on `(task._id, task.taskName, task.coordinatorId, task.type, task.epic, task.storyPoints)` so unchanged cards short-circuit. (b) Wrap `Column` in `React.memo`; pass a stable members lookup map instead of the full array. (c) Once card count exceeds ~30 per column on coarse pointers, switch the column body to `react-window` virtualization (DnD lib supports it through the same Droppable). Verify with React Profiler.

### F8 — `MemberPopover` is built but not mounted on the board (orphan component)

- **Surface:** Members surface
- **Severity:** Medium
- **Type:** Missing affordance / dead surface
- **Evidence:** `src/components/memberPopover/index.tsx` is a complete component (167 LOC) with avatar preview, count badge, scrollable roster, empty state, dvh height cap, coarse-pointer hit target. It is **not imported** by `src/pages/board.tsx` or `src/pages/projectDetail.tsx`. `useMembersList` is hit at board.tsx:369 but the result only feeds `aiProjectContext`, `TaskSearchPanel` (for the coordinator filter), and `TaskModal`. Users have no in-board way to see the project team — they can only learn members by opening the coordinator filter dropdown.
- **Fix:** Mount `MemberPopover` in the board header beside the Copilot button — same row that already has Copilot + Settings. Once mounted, expose a "Filter by me" quick action inside the popover (one click sets `coordinatorId = currentUser._id`).

### F9 — Empty state has a CTA that requires a brittle DOM query

- **Surface:** Empty board state (`src/pages/board.tsx:411-418, 850-866`)
- **Severity:** Low → Medium
- **Type:** Brittle imperative DOM
- **Evidence:** `handleCreateFirstColumn` at board.tsx:411-418 selects `emptyColumnCreatorRef.current?.querySelector("button")` and calls `.click()` + `.focus()` on the first button it finds. This works only because `ColumnCreator` renders exactly one `<button>` in its collapsed state. Any future change to `ColumnCreator` (e.g. adding a sample-content "Try templates" button beside the primary CTA) silently breaks the empty-state flow.
- **Fix:** Lift the open/close state out of `ColumnCreator` (or expose an imperative ref via `useImperativeHandle` returning `open(): void`), then the empty CTA calls `creatorRef.current?.open()` directly with no DOM probing.

### F10 — No sort, no group, no swimlanes, no "Today" lens, no save-as-view

- **Surface:** Filter/sort UX overall (`src/pages/board.tsx`, `src/components/taskSearchPanel/index.tsx`)
- **Severity:** Medium (product gap)
- **Type:** Missing capability
- **Evidence:** Only filterable dimensions are `taskName`, `coordinatorId`, `type`, `semanticIds` (board.tsx:344-349). No sort control; cards are ordered by `task.index` (the drag-and-drop ordering only). No "Group by assignee" / "Group by epic" / "Group by priority". No "Today" or "This week" preset that crosses columns and surfaces overdue cards. No "Save filter as view" — users who triage daily must rebuild their filter every visit.
- **Fix:** See Ambition R2 below (Lenses & Swimlanes).

### F11 — Swipe hint is one-shot but tied to localStorage key — multi-device users re-acknowledge

- **Surface:** Mobile swipe hint (`src/pages/board.tsx:335, 539-556`)
- **Severity:** Low
- **Type:** Cross-device consistency
- **Evidence:** `SWIPE_HINT_DISMISSED_KEY = "board.swipeHintDismissed"` (board.tsx:335) lives in `localStorage`. Acknowledging on phone A still nags on phone B.
- **Fix:** Persist to user-level preferences (server side or `localStorage` keyed by `user._id`). Lower-cost variant: hide the hint after the first horizontal scroll gesture on the board, regardless of LS state — the user has self-served the affordance.

### F12 — Filter status is announced to screen readers but visible task count is not surfaced visually

- **Surface:** Filter status (`src/pages/board.tsx:567-592, 833-847`)
- **Severity:** Low
- **Type:** A11y / visual asymmetry
- **Evidence:** `filterStatusMessage` (board.tsx:587-592) is computed and dropped into a visually hidden `aria-live="polite"` span (board.tsx:833-847). Sighted users with active filters see no aggregate count — they have to mentally sum the per-column badges.
- **Fix:** Render a small "Showing N of M tasks" pill next to the FilterChips row when `hasActiveFilters`. Reuse the same string.

### F13 — Three frosted/translucent layers stack on top of each other on mobile

- **Surface:** Page chrome (`src/components/header`, `src/pages/projectDetail.tsx:33-95`)
- **Severity:** Low
- **Type:** Visual rhythm
- **Evidence:** From top to bottom on a phone: page header (glass), project detail TopBar (glass-surface-subtle blur 20 + saturate 180, projectDetail.tsx:52-54), then the BoardHeader uses the page background again (transparent). The TopBar's `box-shadow: shadow.sm` (projectDetail.tsx:94) prints a faint line below it, then 12 px later the search panel's white card prints another bordered rectangle. The eye reads three horizontal rails in the first 200 px of viewport before any task content.
- **Fix:** Drop the TopBar (see F5). If kept, remove the box-shadow on tablet+ and merge the breadcrumb directly into the BoardHeader on phones (single chrome layer).

### F14 — Triage-agent run gates on "drawer opened first time per session" which is unintuitive

- **Surface:** Triage agent wiring (`src/pages/board.tsx:471-495`)
- **Severity:** Low → Medium
- **Type:** AI integration timing
- **Evidence:** `triagedProjectsRef` (board.tsx:471) gates the triage-agent run on chat drawer first open. The drawer only opens when the user actively clicks "Ask" — so a user who never opens chat never sees a nudge, even if a card is stuck in "In review" for 14 days. The board has all the data needed to run triage at mount.
- **Fix:** Move the triage start into a mount effect (gated on `boardAiOn && tasks?.length > 0`). Surface results as a soft, dismissible nudge banner above the columns ("3 cards may be stuck — Review") that opens the chat drawer with the nudge selected. Doc §3 (AI integration) — be proactive, not reactive.

### F15 — `Row` component primitive uses `margin-right` for gap (`src/components/row/index.tsx`)

- **Surface:** Layout primitive (`src/components/row/index.tsx:26-34`)
- **Severity:** Low
- **Type:** CSS hygiene
- **Evidence:** `Row` applies gap via `> * { margin-right }` rather than `gap`. This works visually but is RTL-hostile (Pulse honors `dir="ltr"`-only today, but the project is i18n'd via `microcopy.proxy`). All other surfaces use `gap` from theme tokens.
- **Fix:** Replace with `gap: ${(p) => …}`. Same API, no inline-margin manipulation, RTL-safe.

### F16 — Column status dot is deterministic hash-of-id, not semantic

- **Surface:** Column dot (`src/components/column/index.tsx:392-409`)
- **Severity:** Low
- **Type:** Visual semantics
- **Evidence:** `dotForColumn(column._id)` hashes the column id into one of 8 colors. The same column always gets the same color — but two adjacent columns named "To do" and "Backlog" can land on visually similar shades (e.g. `#0EA5E9` cyan + `#3B82F6` blue). Users can't infer status from color (which is the entire point of a status dot).
- **Fix:** Either drop the dot (the column heading text already labels the lane) or make it semantic: let users pick a status color on column creation and persist on `IColumn`. Tier the palette: 1 brand orange ("Doing") + neutral grays ("Backlog") + green ("Done") + red ("Blocked") + amber ("In review"). The AI brief drawer already infers status — that signal could drive the color automatically.

### F17 — Card hover lift on touch overrides on `@media (hover: none)` but `transform` + `scale` is still applied when dragging — risk of jank on first drag

- **Surface:** Drag interaction (`src/components/column/index.tsx:132-149`, `:240-251`)
- **Severity:** Low
- **Type:** Performance polish
- **Evidence:** `TaskRowDragShell[data-dragging="true"] .task-card-lift-surface { transform: scale(1.02); }` (column/index.tsx:142-144). Even though the `@media (hover: none)` clause kills the static hover lift, the dragging transform still fires on phones. `will-change` is not set; on first drag, the browser doesn't know to promote the card to its own layer, causing a paint-storm on the column's `overflow-y: auto` container.
- **Fix:** Add `.task-card-lift-surface { will-change: transform; }` only while `[data-dragging="true"]`. Or scale to `1.01` on coarse pointers to soften the cost.

### F18 — Optimistic placeholder cards are visible but `aria-busy` is not set, so screen readers announce them as real tasks

- **Surface:** Card during optimistic create (`src/components/column/index.tsx:707-722`)
- **Severity:** Low
- **Type:** A11y
- **Evidence:** `isMock={!hasPersistedTaskId}` (column/index.tsx:709) disables the click handler and dims the card via `:disabled { opacity: 0.7 }` (column/index.tsx:235-238). The button still has the usual `aria-label` and shows up in screen-reader navigation as a real task — no `aria-busy` / `aria-disabled` hint, no "creating…" suffix.
- **Fix:** Add `aria-busy={isMock}` and append " (creating)" to the aria-label while optimistic. Same for column placeholders.

### F19 — `disableInteractiveElementBlocking` is set on both column and task drags, suggesting the lib's safety mechanism is muted

- **Surface:** DnD wiring (`src/pages/board.tsx:900`, `src/components/column/index.tsx:704`)
- **Severity:** Low
- **Type:** DnD edge cases
- **Evidence:** Both `Drag` calls pass `disableInteractiveElementBlocking` — required because the card is a `<button>` and `@hello-pangea/dnd` refuses to drag from interactive elements by default. The library prints this warning specifically because a nested click handler (e.g. the assignee avatar's `Tooltip` trigger, or a dropdown menu inside a card) will steal the gesture and never call `onDragEnd`. As more interactive content is added to the card (priority menu, due-date picker, inline assignee swap — see F4 / R3) the chance of swallowed drags rises.
- **Fix:** When the card grows interactive elements, restructure the card so the drag handle is a separate top-bar grab strip (like the column handle pattern in `column/index.tsx:644-654`) and remove `disableInteractiveElementBlocking`. The whole-card-as-button pattern is incompatible with rich card content.

### F20 — Filter inputs lack a "saved views" or "remember" affordance, despite filter state being URL-driven

- **Surface:** Filters (`src/pages/board.tsx:344-349, 559-562`)
- **Severity:** Low (product gap)
- **Type:** Missing capability
- **Evidence:** Filter state lives in URL (board.tsx:344-349) so the back button and bookmarks work. But there is no "Save as view" affordance — users who triage daily must paste the URL or re-create the filter each visit. The current "Reset filters" button is the only filter-state CTA.
- **Fix:** Local-storage backed "Save as view" with a name input; surface as a chip cluster above the column list ("My triage", "Bugs this week", "John's work"). Each chip is one tap to apply, long-press to delete. AI can suggest views from board content (see Ambition R4).

---

## Ambitious redesign proposals

### R1 — Task open as a bottom sheet on phones, side drawer on tablet+, modal nowhere

- **Current state:** AntD `Modal` with stacked 3-button footer, capped at `calc(100dvh - 320px)` on phones, breaks back button (see F3).
- **Direction:** Replace `TaskModal`'s `Modal` shell with the existing AntD `Drawer` — `placement="bottom"` for phones (snap-points: 60 % default, drag-up to 100 %), `placement="right"` width 480 px for tablet+. Move open/close state back into the URL (`/projects/:id/board/task/:taskId`). The 988-LOC board page stays mounted behind the drawer, scrolling unaffected. Save / Cancel / Delete become a footer rail that respects `env(keyboard-inset-height)` so the keyboard never covers them. The first input is `taskName` and uses `autoFocus` only on tablet+ (per `mobile-native-best-practices` §F).
- **Payoff:** (1) Back button works — single biggest "feels web-y → feels native" delta. (2) Bottom sheet is the form factor Linear/Notion/Things have converged on. (3) Long notes scroll independently of the board; the modal's `maxHeight: calc(100dvh - 320px)` workaround can be deleted. (4) Drawer is a stepping stone to swipe-between-tasks (R3).
- **Risk:** AntD `Drawer` ships with `closable={true}` overlay click — we need to gate that for unsaved edits (currently the modal's confirm-cancel flow is implicit because `onCancel` resets the form). Need an "are you sure" toast on accidental dismissal with dirty form. Also: drawer animations through `view-transition-name` work, but the existing `forceRender` (`taskModal/index.tsx:325`) prop has no AntD Drawer equivalent — initial mount may be slower.
- **Effort:** **M** — ~2-3 days. Most of the form logic is reusable; mostly a shell swap + URL plumbing + dirty-state guard.

### R2 — Lenses + Swimlanes (Group by, Today/Week filter, AI-suggested chips)

- **Current state:** Static kanban with 3 filter dimensions; no sort/group/lens (see F10).
- **Direction:** Three composable layers atop the existing column model.
  1. **Lens chips** above the filter rail: "Today", "This week", "Mine", "Bugs only", "Stuck >3d", "AI: Show what's at risk". Tapping a lens sets a *filter preset* (URL-driven) and optionally swaps the grouping. The "AI: at risk" lens consults the existing `useAgent("triage-agent")` and pre-fills `?semanticIds=` (the infrastructure exists already, board.tsx:461-464).
  2. **Group-by control** in the filter shell ("Group by: Column · Assignee · Epic · Priority · Due window"). When grouping by something other than Column, each column becomes a swimlane row; tasks render in column-color-coded chips inside the lane. Drag-and-drop semantics swap (drop on lane = re-assign).
  3. **Save as view** (see F20).
- **Payoff:** (1) "Today" lens reframes the kanban as a daily-stand-up surface in one tap. (2) Swimlanes by assignee turn the board into a workload view without leaving the page. (3) AI chip "Show what's at risk" demonstrates that the AI brief is actionable, not just an explainer.
- **Risk:** Swimlane mode complicates the DnD model (`useDragEnd` currently maps `droppableId === columnId`; swimlanes would change the semantic). Two routes: ship lenses first (low-risk, additive), defer Group-by to a v2 once we add `priority` + `dueDate` to ITask (see F4).
- **Effort:** **L** — Lenses alone: ~3 days; full Group-by + swimlanes: ~1-2 weeks because of the data-model expansion and DnD remap.

### R3 — Inline-edit cards (no modal for the 90 % case) + swipe-between-tasks

- **Current state:** Every card open punches into a modal. Even rename takes 4 taps (click card → Modal opens → field gets focus → type → Save).
- **Direction:** Two parts.
  - **Inline rename / quick edit**: double-tap (or long-press on touch) the card title to enter an inline `Input` that commits on Enter / blur. Same for story-points (long-press the pill → cycle 1, 2, 3, 5, 8). Assignee: tap the avatar → tiny popover with the project roster (the existing `MemberPopover` markup can be reused).
  - **Swipe-between-tasks**: once R1 ships, add `←` / `→` (or horizontal swipe in the drawer) to step through tasks in the *current filtered order*. The board already has `tasksByColumn`; threading a `nextTaskId` / `prevTaskId` through the drawer is trivial.
- **Payoff:** (1) The kanban becomes a real "edit-in-place" workspace. Triage of 30 cards no longer requires 30 modal opens. (2) Swipe-between turns review sessions into one continuous flow — the pattern users learned from Mail / Slack / iOS Photos.
- **Risk:** Inline edit + DnD compete for the same gestures on touch — double-tap to edit collides with the system zoom gesture (mitigated by `touch-action: manipulation` already in App.css:227-233, but worth testing on real devices). Need clear "Esc to cancel" + dirty-state preservation when the user opens a different card mid-edit.
- **Effort:** **M-L** — Inline rename + quick edit: ~3 days. Swipe-between depends on R1. Together: ~1 week.

### R4 — "Focus mode" — auto-hide everything but your in-progress, my-due-this-week, and blockers

- **Current state:** No "personal" view of the board. Even with all filters set to me, columns still show every "Done" card from 6 months ago.
- **Direction:** A single header toggle ("Focus") that:
  - Filters to `coordinatorId == me` (or `participants`, once that field exists).
  - Hides all "Done" columns by default (auto-collapse to a thin header strip; tap to expand).
  - Shows only cards `dueDate <= +7d || status == 'in_progress'` (once those fields land).
  - Disables animation on column reorder (focus mode is for triage, not curation).
  - Surfaces a quiet AI suggestion chip: "Resume yesterday's work on `<task>`" — uses `lastViewedTaskId` from local storage.
- **Payoff:** A second-axis on the board: kanban as planning surface vs. focus as execution surface. Both share the same data. This is the differentiator Linear's "My Issues" view delivers.
- **Risk:** Needs the data-model expansion (F4 / R2 part 2). Half-shipping it (without `dueDate`) gives a watered-down experience.
- **Effort:** **L** — Tied to F4 data work. After F4 lands: ~3 days.

### R5 — Smart column states (collapsed Done, archive-on-age, drag-to-archive)

- **Current state:** "Done" columns sit beside "Doing" forever. A 200-card "Done" column dominates horizontal scroll real estate, especially on mobile.
- **Direction:**
  - "Done" / terminal columns auto-collapse to a 64-px-wide vertical sliver showing column name + count after 2 weeks of inactivity. Tap to expand.
  - A drag-to-archive zone appears at the bottom-right of the viewport during a drag — drop a card there to remove from active board without deleting (archive flag on ITask).
  - Inactive columns (no card movement in 30+ days) surface a "Archive column" suggestion via a toast.
- **Payoff:** (1) Long-running boards stop drowning in completed work. (2) Archive becomes a first-class destination, distinct from delete (which has confirmation friction).
- **Risk:** Needs a per-column "kind" classification (Done columns vs Doing columns). Either inferred (last column in order) or explicit on `IColumn`. Auto-collapse is reversible, so risk is mostly UX-surprise-on-load.
- **Effort:** **S** for collapsed Done columns alone; **M** for the full drag-to-archive + auto-suggestions.

---

## Quick wins

These are the highest-ROI fixes that don't touch the data model and ship in < 1 day each.

1. **Delete the duplicated Space.Compact AI cluster** (F1). Single Copilot dropdown. ~120 LOC + ~64 px of mobile chrome saved.
2. **Wire `onClearAll` on `FilterChips`** (F2). One prop change in `taskSearchPanel/index.tsx:299`.
3. **Delete the single-tab Tabs control** on project detail (F5). ~30 LOC; collapses 3 chrome layers into 2.
4. **Mount `MemberPopover` in the board header** (F8). Plus expose a "Filter by me" inside it.
5. **Add "Showing N of M tasks" pill** when filters active (F12). Reuse `filterStatusMessage`.
6. **`React.memo` `TaskCard` with custom comparator** (F7). Single highest INP win.
7. **Disable drag visibly when filters are active** (F6 part b). Banner + opacity 0.92 on cards.
8. **`aria-busy` + " (creating)" suffix** on optimistic cards (F18).
9. **Replace `Row` `margin-right` gap with `gap`** (F15). One-line CSS change, RTL-safe.
10. **Use `useImperativeHandle` on `ColumnCreator`** instead of `querySelector("button")` in the empty CTA (F9).
