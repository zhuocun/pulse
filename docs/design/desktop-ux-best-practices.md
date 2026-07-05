# Desktop Web UX Best Practices — Research Reference

A reference-grade guide for the desktop web surface of PM / kanban /
collaboration SaaS: how a wide, freely-resizable, keyboard-and-mouse
viewport should behave. It is a **general reference with actionable
checklists**, not an audit — Pulse (React 19 + Ant Design + Emotion)
appears only as clearly marked `Example (Pulse)` callouts.

This is the desktop half of a two-doc system. Its principles sibling is
[`mobile-ux-best-practices.md`](mobile-ux-best-practices.md); where a
domain lives in both, each doc states only its platform delta and links
across. Implementation mechanics and red flags for mobile live in
[`mobile-native-best-practices.md`](mobile-native-best-practices.md) —
summarize + link there for viewport meta, safe areas, virtual keyboard,
offline, and coarse-pointer density lift. Shared vocabulary, section order,
and sources are the alignment contract both principle docs follow.

Four foundation topics have canonical homes and are **summarized + linked,
never duplicated** here: AI copilot UX
([`ai-ux-best-practices.md`](ai-ux-best-practices.md)), the routed-surface
vs. confirm decision
([`modal-routing-policy.md`](modal-routing-policy.md)), the token scales
([`../design-tokens.md`](../design-tokens.md)), and the audit that motivated
this work
([`ui-ux-comprehensive-review-2026-05.md`](ui-ux-comprehensive-review-2026-05.md)).

---

## 1. Purpose, audience & how to use

### 1.1 Who this is for

This doc serves designers, front-end engineers, and PMs shipping desktop
web work-management features. Read it as a checklist for new surfaces and a
review lens for existing ones. Every subsection ends in either a checkbox
checklist (things to verify) or a Do/Don't table (a design decision with a
right and a wrong answer). Skim the checklists during design; run them
during review.

The scope is the **desktop viewport**: ≥ 1024 px wide, fine pointer, hover
available, physical keyboard assumed present. Anything narrower or
touch-first belongs to the mobile sibling. Domains that are desktop-only
here — keyboard shortcuts, hover/pointer affordances, multi-pane layout,
data tables, window resize, multi-select, DnD precision — have no mobile
counterpart and are owned in full below.

- [ ] Reader can tell within one screen whether a topic is owned here or deferred to the sibling.
- [ ] Every foundation claim links to its canonical doc rather than restating it.
- [ ] Pulse-specific content is marked `Example (Pulse)` and is never presented as a general rule.

### 1.2 How to use the checklists

Treat a checkbox list as a definition-of-done gate, not aspiration. If a box
can't be checked, either fix it or file it against the roadmap in
[`ui-ux-comprehensive-review-2026-05.md`](ui-ux-comprehensive-review-2026-05.md).
Do/Don't tables encode a single decision; when the "Don't" column matches
your current build, that is a defect, not a style preference.

| Do | Don't |
| --- | --- |
| Run the relevant section's checklist before merging a new surface. | Cherry-pick the checks that already pass and skip the rest. |
| Link a failing item to a tracked roadmap entry. | Leave an unchecked box with no owner. |
| Keep vocabulary aligned with the shared spine. | Introduce a synonym for Board / Column / Drawer / confirm. |

---

## 2. Foundations — layout, spacing, density, dark mode, i18n

### 2.1 Layout grid & spacing rhythm

Desktop layouts are built on a consistent spacing scale and a small number
of structural regions: persistent chrome (top bar + left nav), the primary
work canvas, and optional right-rail. Do not hardcode pixel gaps; consume
the `space` scale from [`../design-tokens.md`](../design-tokens.md) so
rhythm stays uniform and dark-mode / density changes flow from one source.
Content on ultra-wide monitors should cap the readable measure (prose
60–75ch) rather than stretching edge to edge; the canvas itself may fill,
but text columns should not.

- [ ] All gaps/paddings resolve to `space` tokens — no raw `px` in layout CSS.
- [ ] Prose measure is capped (60–75ch) even when the viewport is 2560 px wide.
- [ ] Structural regions (chrome, canvas, right-rail) have explicit, documented widths.
- [ ] Layout uses CSS grid/flex for reflow, not fixed absolute positioning.

### 2.2 Density modes

Distinguish the two density concepts the spine defines. **Product density
modes** are the user-chosen `comfortable` vs. `compact` setting that trades
whitespace for rows-on-screen. **Coarse-pointer density** is the automatic
one-step type/target lift applied under `@media (pointer: coarse)` and is
owned by the mobile sibling — desktop keeps the dense ladder. A dense
default is correct for power-user PM tools (Linear/Jira/Asana patterns), but
comfortable must remain a first-class, discoverable toggle.

| Do | Don't |
| --- | --- |
| Ship a dense default with a discoverable comfortable/compact toggle. | Force one density on everyone. |
| Keep the desktop dense ladder; let the coarse-pointer lift stay mobile-only. | Apply the coarse-pointer lift to a fine-pointer desktop. |
| Persist the chosen mode per user (see §15). | Reset density on every navigation. |

### 2.3 Dark mode

Dark mode is `prefers-color-scheme` plus an explicit toggle, driven entirely
by semantic color tokens — never hardcoded hex. Every surface (cards,
tables, drawers, the right-rail) must be verified in both themes for
contrast, not just the happy-path light view. Elevation in dark mode comes
from lighter surface tokens, not heavier shadows.

- [ ] Colors resolve to semantic tokens; no raw hex in components.
- [ ] Toggle overrides `prefers-color-scheme` and persists per user.
- [ ] Both themes pass contrast (WCAG 2.2 SC 1.4.3) on text, borders, and status colors.
- [ ] Status/priority colors have distinct light and dark variants that both clear AA.

### 2.4 Internationalization & RTL

Copy expands in translation (German/Finnish run ~30–40% longer); wide
desktop layouts must let labels, buttons, and column headers grow without
truncation or overlap. Support bidi mirroring for RTL locales (nav flips,
board column order flips, chevrons mirror) and format dates/numbers per
locale. Never concatenate translated fragments; use whole-string
interpolation.

- [ ] No fixed-width containers that clip expanded translated copy.
- [ ] Layout mirrors correctly under `dir="rtl"` (nav, board axis, icons).
- [ ] Dates, numbers, and relative times use locale-aware formatting.
- [ ] Strings are whole-message with interpolation — no sentence assembly from fragments.

### 2.5 Multi-pane layout & window resize

Desktop PM tools routinely show three regions at once: persistent chrome, a
primary work canvas, and an optional right-rail (task detail, Copilot, or
inbox). Panes must reflow when the user resizes the window — never clip
content silently. Define minimum widths per pane and a collapse order (e.g.
right-rail hides first, then left nav collapses to a rail) so the board
remains usable down to the 1024 px floor. Each pane owns its scroll
container; only one pane should capture wheel events at a time.

Keyboard users need explicit pane focus: `F6` or `Ctrl+`` ` cycles chrome →
canvas → right-rail; `Escape` returns focus to the canvas. Resizable
splitters (where used) expose `role="separator"` with `aria-orientation` and
keyboard nudge keys. On ultra-wide viewports, cap the canvas width and let
margins breathe rather than stretching cards edge-to-edge.

| Do | Don't |
| --- | --- |
| Document min-widths and the pane-collapse order for each breakpoint. | Let panes overlap or clip without a collapse rule. |
| Keep the board canvas usable when the right-rail is open. | Force a modal when side-by-side layout would suffice. |
| Cycle pane focus with a discoverable shortcut. | Trap focus inside a rail with no escape path. |
| Re-measure pane heights on `resize` (not only `window.innerWidth`). | Assume a fixed viewport after first paint. |

- [ ] Three-region layout (chrome / canvas / optional right-rail) is documented with widths.
- [ ] Right-rail collapse is the first response below ~1280 px; left-nav rail is second.
- [ ] Each pane scrolls independently; no double-scroll traps.
- [ ] Pane-focus cycling works from keyboard alone.
- [ ] Window resize from 2560 px → 1024 px preserves board usability without horizontal page scroll.

---

## 3. IA & navigation

### 3.1 Persistent chrome & multi-level nav

Desktop affords persistent chrome: a top bar for global actions and account,
a left nav for spaces/projects. Unlike mobile's bottom-tabs-and-back-gesture
model, desktop keeps multiple navigation levels visible simultaneously.
Current location must be unambiguous (active nav state + breadcrumb or title)
so a user who tabs away and returns re-orients instantly. See the mobile
sibling for the bottom-tab equivalent.

- [ ] Persistent left nav and top bar remain visible across the primary work canvas.
- [ ] Active location is visually marked in the nav and reflected in the document title.
- [ ] Nav collapse state (expanded/rail) persists per user.
- [ ] Every nav destination is reachable by keyboard and exposes an accessible name.

### 3.2 URL as source of truth

Navigable state lives in the URL, not component state. Selected project,
open task detail surface, active filters, and search query should all be
deep-linkable and survive a refresh or a new-tab open. This is the same
principle the routing policy enforces for detail surfaces — see §9 and
[`modal-routing-policy.md`](modal-routing-policy.md).

| Do | Don't |
| --- | --- |
| Encode project, task, filters, and query in the URL. | Hold navigable state only in React state that dies on refresh. |
| Support open-in-new-tab for any resource a teammate might share. | Trap users in a single-tab, un-shareable session. |
| Restore full view state from a pasted URL. | Land a deep link on a generic dashboard. |

---

## 4. Boards & kanban

### 4.1 Column & swimlane layout

On desktop the **Board** shows multiple **Columns** side by side with
horizontal scroll, and **Swimlanes** (horizontal group-by cuts across all
columns) visible together — this is the desktop delta versus mobile's
one-column-in-focus model. A card sits at exactly one column × one swimlane.
Column headers stay sticky while the lane scrolls, and each header shows its
count and WIP limit if configured. Depth requirements for swimlanes and
saved views live in
[`../prd/work-management-depth.md`](../prd/work-management-depth.md).

- [ ] Multiple columns render side by side with smooth horizontal scroll.
- [ ] Swimlanes render together; each card maps to one column × one swimlane.
- [ ] Column headers are sticky and show count (and WIP limit where set).
- [ ] Empty columns show the empty state of the triad (§14), not blank space.

### 4.2 Card anatomy

A card is scannable at a glance: title, key metadata (assignee, priority,
due, labels), and status affordances. Establish hierarchy with size, weight,
and spacing — not color alone (color is a redundant cue, per accessibility).
Reserve explicit dimensions for async assets (avatars, type-badge icons) so
the card row does not shift as they load (CLS — see §16).

| Do | Don't |
| --- | --- |
| Lead with the title; make metadata secondary and consistent across cards. | Give every field equal visual weight. |
| Reserve width/height for avatars and badge icons. | Let late-loading images reflow the card. |
| Encode status with icon + label, color as reinforcement. | Rely on color alone to convey priority/status. |

### 4.3 Reordering & drag precision (desktop)

Fine-pointer drag on desktop expects tight tolerances and instant feedback:
a clear drag handle or whole-card grab, a placeholder gap showing the drop
target, and auto-scroll near lane edges. Reorder mutations should be
optimistic with rollback on failure. Because the DnD library blocks drags
that start on native interactive elements (`<input>`, `<button>`,
`<textarea>`, `<select>`, `<option>`, `<optgroup>`, `<video>`, `<audio>`),
a card whose root is interactive must opt out explicitly or it will look
draggable but never start.

> `Example (Pulse)`: `@hello-pangea/dnd` powers reordering;
> `<DragDropContext onDragEnd>` is wired in `src/pages/board.tsx` via
> `useDragEnd`, reorder is optimistic (`src/utils/optimisticUpdate/reorder.ts`),
> and the task-card case passes `disableInteractiveElementBlocking` on the
> `<Drag>` (`src/components/column/index.tsx`).

- [ ] Drag shows a live placeholder at the drop position.
- [ ] Auto-scroll engages when dragging near a lane/viewport edge.
- [ ] Reorder is optimistic and rolls back visibly on server rejection.
- [ ] Cards with interactive roots opt out of interactive-element blocking.
- [ ] A keyboard-only user can reorder (space to lift, arrows to move, space to drop).

---

## 5. Tasks & detail surfaces

### 5.1 The routed task detail surface

The **Task detail surface** is the single-resource view for one task. It is
**routed by default**: it owns a URL
(`/projects/:projectId/board/task/:taskId`), the Board stays mounted
beneath it, and browser-back closes it. On desktop the visual shell is a
right `Drawer`, but the *route*, not open/close state, is the source of
truth. This is a direct application of the routing policy — see §9 and
[`modal-routing-policy.md`](modal-routing-policy.md). The legacy
`<TaskModal>` is the pre-routing artifact, not the target.

- [ ] Opening a task changes the URL and is deep-linkable / shareable.
- [ ] Browser-back and Escape both close the surface and return to the Board.
- [ ] The Board stays mounted (and scroll-positioned) beneath the drawer.
- [ ] Refreshing on a task URL re-opens the same task, not a blank board.

### 5.2 Detail lifecycle & triage

Desktop triage benefits from open-in-new-tab: a user can fan out several
tasks across tabs. Provide fast prev/next navigation between tasks in the
current filtered set without closing the surface. Unsaved edits are guarded
by a discard confirm (a Dialog, not a routed surface) wired to the route
blocker.

| Do | Don't |
| --- | --- |
| Support open-in-new-tab and in-surface prev/next across the filtered set. | Force a close→reopen round trip to view the next task. |
| Guard unsaved edits with a discard `Modal.confirm` on close/navigate. | Silently lose edits on back/close. |
| Keep the loading state until tasks resolve to a concrete array. | Treat "tasks not yet loaded" as "task not found" and auto-close. |

---

## 6. Data tables & list views

### 6.1 Table structure & column control

Dense tabular list views are a desktop-primary domain. Use real semantic
table/grid markup so screen readers announce row/column context (see §17).
Support user-resizable and reorderable columns, a pinned first column
(usually title/key), and horizontal scroll with a frozen header. Persist
column layout per user per view.

- [ ] Table uses semantic `role="grid"`/`<table>` structure with header association.
- [ ] Columns are resizable and reorderable; the key column can be pinned.
- [ ] Header row stays frozen during vertical scroll; first column can freeze on horizontal scroll.
- [ ] Column layout, sort, and width persist per user per saved view.

### 6.2 Sorting, density & large datasets

Sort indicators must be explicit (arrow + `aria-sort`). For large datasets,
virtualize rows so scroll stays at 60 fps and INP stays within budget (§16),
and paginate or lazily fetch rather than loading everything. Row density
follows the product density mode (§2.2). Inline edit within a table cell
follows §8.

| Do | Don't |
| --- | --- |
| Virtualize long lists and fetch incrementally. | Render 10k DOM rows and freeze the main thread. |
| Show sort state with an icon and `aria-sort`. | Sort silently with no visible indicator. |
| Keep row height tied to the density mode. | Ship a fixed row height that ignores compact mode. |

### 6.3 Board / list parity

A task's data is identical whether shown as a Board card or a table row;
only the layout differs. Actions, selection, and bulk operations should
behave the same across both surfaces so users can switch views without
relearning (Linear/Jira/Asana patterns). Filters and saved views apply
identically to both.

- [ ] The same task actions exist in both board and list views.
- [ ] Selection and bulk actions (§10) work identically across views.
- [ ] Filters and saved views produce the same result set in both.
- [ ] Switching view preserves the current filter/sort/selection where sensible.

---

## 7. Search, filter & command palette

### 7.1 Command palette

The **Command palette** is the `Ctrl/⌘-K` keyboard-first launcher for
navigation and actions — the power-user discovery path (Linear/Jira/Asana
patterns). It is height-capped in `dvh`, opens focused on its input, filters
as you type, is fully arrow-key navigable, and closes on Escape. It
complements — never replaces — visible controls; every palette action also
has a discoverable UI path.

- [ ] `Ctrl/⌘-K` opens the palette from anywhere; Escape closes it.
- [ ] Input is auto-focused; results filter incrementally and are arrow-navigable.
- [ ] Height is capped in `dvh` so it never exceeds the viewport.
- [ ] Every palette command is also reachable through visible UI.

### 7.2 Filtering & saved views

Provide an inline filter bar for the current surface (board or table) plus
saved views that capture filter + sort + grouping + column layout as a named,
shareable configuration. Applied filters are visible as removable chips, and
the URL reflects the active filter set so a filtered view is deep-linkable.
A filtered result with no matches shows the empty state of the triad with a
"Reset filters" action, not a dead end.

| Do | Don't |
| --- | --- |
| Surface active filters as removable chips and encode them in the URL. | Hide active filters behind a menu with no visible summary. |
| Let users save, name, and share views. | Make users rebuild the same filter set every session. |
| Show a filtered-empty state with a reset action. | Render a blank surface when filters match nothing. |

### 7.3 Search results & scope

Search is scoped and labeled (this project vs. workspace-wide). Results
render with enough context (project, type, status) to disambiguate, keep
keyboard navigation from the palette, and never block the UI while querying —
show a skeleton or delayed spinner (§14), not a frozen input.

- [ ] Search scope is explicit and switchable (project / workspace).
- [ ] Results carry enough metadata to disambiguate same-named items.
- [ ] Querying is async and non-blocking, with a loading affordance.
- [ ] Keyboard navigation carries through from palette to results.

---

## 8. Forms & inline editing

### 8.1 Form layout & keyboard flow

Desktop forms are dense (14 px base per the desktop ladder, §2.2) with a
logical tab order that matches visual order. Group related fields, label
every input (visible label, not placeholder-as-label), and keep the primary
action reachable without scrolling. Submit on `Enter` in single-line
contexts; use `Ctrl/⌘-Enter` for multi-line composers.

- [ ] Tab order matches reading order; no focus traps except intentional modal traps.
- [ ] Every field has a persistent visible label and programmatic association.
- [ ] Primary submit is reachable and its shortcut (`⌘-Enter` for multiline) documented.
- [ ] Focus moves to the first invalid field on failed submit.

### 8.2 Validation & error copy

Validate at the edge and surface errors inline, next to the offending field,
with specific, non-blaming copy ("Enter a due date" not "Invalid input").
Prefer on-blur / on-submit validation over per-keystroke nagging. Show a
summary for multi-error submits and move focus to it.

| Do | Don't |
| --- | --- |
| Show field-level errors inline with specific guidance. | Show one generic "Something went wrong" for a form. |
| Validate on blur/submit; confirm success quietly. | Flash red on every keystroke before the user finishes. |
| Associate errors with inputs via `aria-describedby`. | Rely on color alone to mark invalid fields. |

### 8.3 Inline editing

Inline edit (click a field to edit in place — title, status, assignee, cell
in a table) is a desktop staple. Make the affordance discoverable on hover
(§ hover/pointer below), commit on blur or Enter, cancel on Escape, and show
optimistic state with rollback on failure. Never lose an edit silently.

- [ ] Editable fields reveal an edit affordance on hover and focus.
- [ ] Enter commits, Escape cancels, blur commits (or prompts) predictably.
- [ ] Edits are optimistic with visible rollback on server error.
- [ ] The editable region is keyboard-focusable and announces its editable role.

### 8.4 Hover & pointer affordances (desktop)

Hover-reveal is a desktop-only affordance — row hover surfaces quick actions,
tooltips clarify icon-only controls, and cursor states signal draggable /
clickable / disabled. All of it must be gated behind `@media (hover: hover)`
so it never becomes an unreachable trap on coarse pointers (owned by the
mobile sibling). Every hover-revealed action must also be reachable by
keyboard focus and, where it is a primary action, not *only* on hover.

| Do | Don't |
| --- | --- |
| Gate hover-reveal behind `@media (hover: hover)`. | Ship hover-only actions that vanish on touch/keyboard. |
| Mirror hover reveal on keyboard focus (`:focus-within`). | Make an action reachable by mouse hover alone. |
| Use cursor states to signal draggable/clickable/disabled. | Leave the default cursor on custom interactive regions. |

---

## 9. Modals, drawers & confirms

### 9.1 The route-vs-confirm decision

[`modal-routing-policy.md`](modal-routing-policy.md) is the source of truth
and this section only summarizes it. The rule: any surface that addresses a
**single resource**, could be shared by URL, makes sense to open in a new
tab, or hosts its own scroll/keyboard/forms is **routed** (it owns a URL, the
page stays mounted, back closes it). A **Dialog / confirm** — an ephemeral,
non-deep-linkable yes/no interaction (delete, discard edits) — stays an AntD
`Modal.confirm`. If any of the first four decision-matrix questions is "yes,"
route it; never re-derive the reasons here.

- [ ] Single-resource, shareable, new-tab-able, or form-hosting surfaces are routed, not modal.
- [ ] Ephemeral yes/no interactions use `Modal.confirm`, not a routed surface.
- [ ] The decision was checked against the policy's matrix, not guessed.

### 9.2 Drawer & dialog mechanics

A **Drawer** is a shell shape only (a panel sliding from an edge) — naming
something a drawer says nothing about whether it is routed. On desktop
drawers slide from the right. Any modal or drawer traps focus while open,
restores focus to the trigger on close, closes on Escape, and renders a
scrim that closes on outside click only when there are no unsaved edits.

| Do | Don't |
| --- | --- |
| Trap focus inside an open overlay; restore to trigger on close. | Let Tab escape into the page behind the scrim. |
| Close on Escape and scrim-click (guarding unsaved edits). | Require hunting for a tiny close button. |
| Use a right `Drawer` shell for the routed detail surface. | Call a `Modal.confirm` a "drawer" or vice versa. |

---

## 10. Selection & bulk actions

### 10.1 Multi-select mechanics (desktop)

Multi-select is desktop-primary: click selects one, `Shift-click` selects a
range, `⌘/Ctrl-click` toggles individual items, and `⌘/Ctrl-A` selects all in
scope. Selection state is visible (checkbox + row highlight) and its count is
always shown. Selection is keyboard-operable (Space toggles the focused row).

- [ ] Click, Shift-click range, and ⌘/Ctrl-click toggle all work.
- [ ] Selected count is always visible while a selection exists.
- [ ] Space toggles selection on the focused row/card.
- [ ] Escape or an explicit "Clear" deselects everything.

### 10.2 Bulk action toolbar & undo

When a selection exists, a contextual bulk toolbar appears (move, assign,
label, delete) without covering the primary content. Destructive bulk
actions confirm first (a Dialog) and, wherever feasible, are undoable via a
toast with a real `<button>` Undo. Show progress for long-running bulk
operations and report partial failures per item.

| Do | Don't |
| --- | --- |
| Show a bulk toolbar scoped to the current selection. | Leave bulk actions buried in a per-item menu. |
| Confirm destructive bulk ops and offer bulk undo. | Delete N items with no confirm and no recovery. |
| Report per-item partial failure after a bulk op. | Report "done" when half the items failed. |

---

## 11. Notifications, feedback & collaboration

This section merges the spine's "Notifications & collaboration" domain; both
are stated with their desktop delta.

### 11.1 Notification inbox & feedback

Desktop surfaces notifications in a right-rail inbox with hover previews
(the mobile delta is a bottom-sheet inbox + push). Transient feedback uses
non-blocking toasts, positioned consistently, dismissible, and never
stacking into an unreadable pile. Success is confirmed quietly; errors state
the cause and offer recovery. Depth requirements live in
[`../prd/collaboration-notifications.md`](../prd/collaboration-notifications.md).

- [ ] Notifications live in a consistent right-rail inbox with unread state.
- [ ] Toasts are non-blocking, dismissible, and capped (no infinite stack).
- [ ] Error toasts state cause and offer a recovery action, not just "failed".
- [ ] Toast actions (Undo) are real focusable buttons, keyboard-activatable.

### 11.2 Presence & real-time collaboration

Desktop has room to show presence side by side: avatars of who is viewing /
editing, live cursors or field-level "editing now" indicators, and hover
avatars for identity. Concurrent edits must reconcile predictably (last-write
or field-level merge) and never silently clobber another user's change.
Mentions and comment threads are keyboard-operable. See
[`../prd/core-collaboration.md`](../prd/core-collaboration.md) and
[`../prd/collaboration-notifications.md`](../prd/collaboration-notifications.md).

| Do | Don't |
| --- | --- |
| Show live presence/editing indicators on shared surfaces. | Let two users overwrite each other with no signal. |
| Reconcile concurrent edits at field granularity where possible. | Blindly apply last-write and drop the other edit. |
| Make mentions and comments fully keyboard-operable. | Require a mouse to add or resolve a comment. |

---

## 12. AI Board Copilot — desktop placement

[`ai-ux-best-practices.md`](ai-ux-best-practices.md) is the source of truth
for all AI copilot UX — principles, streaming, trust/citations, error
taxonomy, agentic write safety, and AI-specific sources. This section covers
**desktop placement only**; for anything about how the AI behaves, link
there. Requirements live in [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md) and
[`../prd/v2.1-agent.md`](../prd/v2.1-agent.md).

### 12.1 Right-rail Copilot shell

On desktop the Copilot is a **persistent right-rail dock** (the mobile delta
is a routed `/copilot` bottom sheet). It anchors a single primary AI entry
with tabbed sub-surfaces (Chat / Brief / Activity / Settings) rather than
scattering AI affordances across the app — see
[`ai-ux-best-practices.md §10`](ai-ux-best-practices.md). The rail is
resizable and collapsible, and its state persists per user. Contextual inline
AI (estimate inside a task, draft from a creator) is fine alongside the rail;
the rail is the discovery anchor, inline AI is augmentation.

- [ ] A single persistent right-rail dock is the primary AI entry point.
- [ ] The rail is collapsible/resizable and its state persists.
- [ ] AI-applied changes are reviewable in an Activity tab and are undoable.
- [ ] Inline contextual AI reuses the same attribution/affordances as the rail.

### 12.2 Command-palette & keyboard AI entry

AI actions are reachable from the command palette (§7.1) and via a keyboard
shortcut that focuses the Copilot composer — power users should never need
the mouse to ask the AI. Streamed output announces through a `polite`
live region (§17); errors degrade to the non-AI path.

| Do | Don't |
| --- | --- |
| Expose "Ask Copilot" in the palette and via a focus shortcut. | Make the AI reachable only by clicking the rail. |
| Announce streamed AI output via a `polite` live region. | Stream text with no screen-reader announcement. |
| Degrade to the manual path when AI is unavailable. | Dead-end the user when the AI call fails. |

---

## 13. Keyboard & shortcuts

### 13.1 Accelerator map & discoverability

A physical keyboard is assumed on desktop, so a coherent accelerator map is
table stakes (Linear/Jira/Asana patterns). Shortcuts are grouped
(navigation, creation, selection, view) and follow platform conventions
(`⌘` on macOS, `Ctrl` on Windows/Linux). A `?` shortcut opens a discoverable
cheat sheet, and tooltips on controls show their accelerator.

- [ ] `?` opens a searchable shortcut cheat sheet.
- [ ] Shortcuts respect `⌘`/`Ctrl` per platform and don't hijack browser defaults destructively.
- [ ] Control tooltips display the associated accelerator.
- [ ] Shortcuts are suspended while typing in an input/textarea (no accidental triggers).

### 13.2 Focus management & tab order

Focus is always visible (never `outline: none` without a replacement) and
meets WCAG 2.2 SC 2.4.11 Focus Appearance. Tab order follows visual order;
composite widgets (board, grid, palette, menus) implement roving tabindex or
arrow-key navigation per the WAI-ARIA APG so they are one tab stop, not
dozens. Focus returns to the triggering control when an overlay closes.

| Do | Don't |
| --- | --- |
| Keep a visible focus ring meeting SC 2.4.11 on every interactive element. | `outline: none` with no visible replacement. |
| Use roving tabindex / arrow keys inside grids, boards, menus. | Make every card/cell its own tab stop. |
| Restore focus to the trigger when a drawer/dialog closes. | Drop focus to `<body>` after closing an overlay. |

---

## 14. Empty, loading & error states

The spine treats these three as one design obligation — **the triad** —
every data surface must define together. On desktop, skeletons are sized to
the wide layout. The mobile sibling covers single-column sizing and
white-flash avoidance.

### 14.1 Empty state

An empty surface offers the next action, never a dead end (NN/g). Distinguish
"no data yet" (offer creation / onboarding) from "no results for this filter"
(offer reset). Empty columns, empty boards, empty tables, and empty search
each get a purpose-built empty state.

- [ ] Every data surface defines a first-run empty state with a clear next action.
- [ ] "No filter matches" is distinct from "nothing exists yet" and offers reset.
- [ ] Empty states never render as blank whitespace.

### 14.2 Loading state

Use a **Skeleton** that mirrors the eventual content's shape for perceived
speed (skeletons feel ~9–12% faster than spinners per NN/g), sized to the
desktop layout. Reserve space so content does not shift in on load (CLS,
§16). Use a delayed spinner (not a skeleton) only for short, indeterminate
waits, and never show a skeleton and spinner on the same surface at once.
Shimmer respects `prefers-reduced-motion`.

| Do | Don't |
| --- | --- |
| Show a shape-matched skeleton for content loads. | Show a blank white panel while fetching. |
| Reserve final dimensions so nothing shifts in. | Let loaded content jump the layout (CLS). |
| Use a delayed spinner only for short indeterminate waits. | Stack a spinner on top of a skeleton. |

### 14.3 Error state

An error state names the cause, offers recovery (retry / go back), and
degrades gracefully — for AI surfaces it falls back to the non-AI path (see
[`ai-ux-best-practices.md §5`](ai-ux-best-practices.md)). Distinguish
transient (retry) from permanent (fix input / permissions) errors. Critical
errors announce via an `assertive` live region (§17).

- [ ] Error copy states the cause in plain, non-blaming language.
- [ ] A recovery action (retry / back / contact) is always present.
- [ ] Transient vs. permanent errors are visually and behaviorally distinct.
- [ ] Critical errors announce assertively to assistive tech.

---

## 15. Onboarding, settings & preferences

### 15.1 First-run & progressive disclosure

Desktop onboarding favors contextual tooltips and inline hints over
full-screen takeovers (the mobile delta is first-run sheets). Reveal
complexity progressively: show core actions first, surface power features
(saved views, shortcuts, bulk actions) as the user demonstrates readiness.
Never block the whole app behind a mandatory multi-step tour.

- [ ] First-run guidance is contextual and skippable, not a blocking takeover.
- [ ] Advanced features are progressively disclosed, not dumped at once.
- [ ] Onboarding state persists so completed steps don't reappear.
- [ ] Empty states (§14) double as onboarding entry points.

### 15.2 Feature discoverability

Surface the command palette and keyboard shortcuts as discovery paths — a
palette hint in the top bar, accelerators in tooltips, and a `?` cheat sheet
(§13). New features get a subtle, dismissible callout tied to the relevant
surface, not a global interruptive modal. Account/org onboarding requirements
live in
[`../prd/accounts-organizations.md`](../prd/accounts-organizations.md).

| Do | Don't |
| --- | --- |
| Hint at the palette and shortcuts where users already look. | Bury power features with zero discovery affordance. |
| Announce new features with a dismissible, contextual callout. | Interrupt every user with a global "What's new" modal. |
| Persist dismissal so a callout appears once. | Re-show the same tip every session. |

### 15.3 Settings structure & scope

Desktop settings use a multi-pane layout (category nav on the left, content
on the right) and each pane is a routed target so settings are deep-linkable
(the mobile delta is a full-screen sectioned settings sheet). Separate scopes
clearly: personal preferences vs. project settings vs. org/account settings,
with permissions gating what a user can change. See
[`../prd/accounts-organizations.md`](../prd/accounts-organizations.md).

- [ ] Settings categories use a multi-pane layout with a deep-linkable route per pane.
- [ ] Personal, project, and org scopes are visually and structurally separated.
- [ ] Permission-gated settings are hidden or clearly disabled with a reason.
- [ ] Changes save with explicit confirmation (or clearly-labeled auto-save).

### 15.4 Preference persistence

Preferences set elsewhere in the app — density mode (§2.2), theme (§2.3), nav
collapse, column layouts (§6), Copilot rail state (§12) — are the same
settings surfaced here and persist per user across sessions and devices.
There is one source of truth per preference; the settings pane and the
in-context toggle read and write the same value.

| Do | Don't |
| --- | --- |
| Persist preferences per user across sessions/devices. | Reset preferences on logout or new device. |
| Keep one source of truth per preference. | Let a settings pane and an in-context toggle diverge. |
| Reflect in-context changes (theme, density) in the settings pane. | Show a stale value in settings after an inline change. |

---

## 16. Performance

### 16.1 Budgets & metrics

Desktop runs on capable hardware, but the Core Web Vitals gate still applies
(web.dev / Core Web Vitals): **LCP ≤ 2.5 s**, **INP ≤ 200 ms**, **CLS ≤
0.1**. Keep the interaction budget tight — dense boards and tables are
interaction-heavy, so INP is the metric that bites. The mobile sibling gates
on 75th-percentile mobile CWV; desktop is the capable-hardware budget, not an
excuse to ship bloat.

| Metric | Good | Poor |
| --- | --- | --- |
| **LCP** | ≤ 2.5 s | > 4.0 s |
| **INP** | ≤ 200 ms | > 500 ms |
| **CLS** | ≤ 0.1 | > 0.25 |

- [ ] LCP / INP / CLS measured on the real board and table views, not just the landing route.
- [ ] Interaction handlers stay under the INP budget on the densest realistic dataset.
- [ ] Layout shift is eliminated by reserving space for async content (§4.2, §14.2).

### 16.2 Rendering & bundle discipline

Virtualize long boards/tables (§6), code-split per route, and avoid silent
N² render patterns. Break long tasks (> 50 ms) off the main thread. Keep
bundle chunks within the project's guardrail and lazy-load heavy,
rarely-used surfaces. Memoize only the genuinely expensive computation —
premature memoization is clutter.

| Do | Don't |
| --- | --- |
| Virtualize long lists and code-split per route. | Ship one giant bundle and render 10k rows. |
| Break work > 50 ms with yielding/workers. | Block the main thread during interaction. |
| Memoize the expensive computation only. | Wrap every value in `useMemo` reflexively. |

---

## 17. Accessibility

Accessibility is a floor, not a feature. This section pins the desktop
obligations; the mobile sibling covers VoiceOver/TalkBack reading order and
coarse focus rings.

### 17.1 Semantics & keyboard operability

Every interactive control uses the right semantic element/role and is fully
keyboard-operable (WCAG 2.2, WAI-ARIA APG). Boards, grids, menus, and the
palette follow their APG keyboard patterns. Focus is always visible and meets
SC 2.4.11. Color is never the sole carrier of meaning (SC 1.4.1). Icon-only
controls carry an accessible name.

- [ ] All interactive elements are reachable and operable by keyboard alone.
- [ ] Composite widgets follow their WAI-ARIA APG keyboard pattern.
- [ ] Focus is always visible and meets SC 2.4.11 Focus Appearance.
- [ ] Icon-only controls have an accessible name (`aria-label` / visually-hidden text).
- [ ] No information is conveyed by color alone (SC 1.4.1 / 1.4.3 contrast).

### 17.2 Live regions & async announcement

Async content announces through an `aria-live` region: `polite` for streamed
AI output and non-urgent updates, `assertive` only for errors and critical
state (W3C ARIA). Loading and error transitions in the triad (§14) announce
so a screen-reader user learns of state changes without a visual cue.

| Do | Don't |
| --- | --- |
| Announce streamed/async updates via a `polite` live region. | Update the DOM silently for assistive tech. |
| Reserve `assertive` for errors/critical state only. | Fire `assertive` on every minor update. |
| Announce loading→loaded→error transitions. | Change state with no accessible signal. |

### 17.3 Target size, motion & the repo's a11y gate

Per this repo's AGENTS.md a11y minimums: every interactive control declares a
≥ 44 px touch target under `@media (pointer: coarse)` (WCAG 2.2 SC 2.5.8;
Material 3 / Apple HIG), pinned by the `declares a touch-target height` tests;
every top-level surface passes `axe-core` clean
(`uiAccessibility.strict.test.tsx`); button labels flow through the microcopy
constants (raw `Submit`/`OK`/`Login` as button children are ESLint-blocked).
Motion respects `prefers-reduced-motion` (SC 2.3.3) — shimmer and transitions
degrade to static.

- [ ] Interactive controls declare ≥ 44 px target under `@media (pointer: coarse)` (SC 2.5.8).
- [ ] Every top-level surface passes `axe-core` clean (strict suite).
- [ ] Button labels route through the microcopy source of truth, not raw literals.
- [ ] All motion respects `prefers-reduced-motion` (SC 2.3.3).
- [ ] The relevant `declares a touch-target height` test exists for new interactive components.

---

## 18. Sources

Cited from the shared spine registry using its labels; desktop-specific
additions are marked `desktop add` and should be mirrored into the shared
registry so the two sibling docs stay in sync. The AI-specific source stack
(Google PAIR, Microsoft HAX, NIST AI RMF, IBM, Anthropic, Apple ML Privacy)
is **not** duplicated here — it lives in
[`ai-ux-best-practices.md §14`](ai-ux-best-practices.md); link there for AI
claims.

| Label | Source | Primary use in this doc |
| --- | --- | --- |
| **NN/g** | [Nielsen Norman Group](https://www.nngroup.com/) — incl. [Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/), the 10 usability heuristics | Empty states, skeleton-vs-spinner, mental models, discoverability. |
| **WCAG 2.2** | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — SC 2.5.8 Target Size, [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), SC 2.4.11 Focus Appearance, SC 2.3.3 Motion, SC 1.4.1/1.4.3 | Target size, focus visibility, reduced motion, contrast, color-independence. |
| **W3C ARIA** | [WAI-ARIA — Live Regions](https://www.w3.org/TR/wai-aria/#aria-live) | Accessible live regions for streamed/async content. |
| **WAI-ARIA APG** *(desktop add)* | [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/) | Keyboard patterns for grid, listbox, menu, dialog, and roving tabindex. |
| **Material 3** | [Material Design 3](https://m3.material.io/) (touch targets: [M2 touch-target](https://m2.material.io/develop/web/supporting/touch-target)) | Touch-target sizing, density guidance. |
| **Apple HIG** | [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) | 44 pt hit target, platform feel. |
| **Atlassian Design System** | [Atlassian Design System](https://atlassian.design/) | Board/kanban patterns, issue-detail conventions, empty states. |
| **Linear / Jira / Asana patterns** | Linear ([features](https://linear.app/features)), Jira, Asana | Command palette, keyboard-first flows, board/list parity, saved views, bulk actions. |
| **web.dev / Core Web Vitals** | [web.dev](https://web.dev/) — [INP](https://web.dev/articles/inp), [LCP](https://web.dev/articles/lcp), [CLS](https://web.dev/articles/optimize-cls) | Performance budgets (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1). |
| **MDN — pointer & hover media** *(desktop add)* | [MDN `hover`/`pointer` media features](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover), [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | Gating hover-reveal affordances; fine-pointer drag precision. |

### Cross-links

| Target | Path (from `docs/design/`) | What it owns |
| --- | --- | --- |
| AI UX best practices | [`ai-ux-best-practices.md`](ai-ux-best-practices.md) | Board Copilot UX: principles, streaming, trust/citations, AI errors, agentic safety, AI sources. This doc covers desktop placement only. |
| Mobile native-feel (sibling) | [`mobile-native-best-practices.md`](mobile-native-best-practices.md) | Mobile mechanics: PWA, safe areas, touch/gesture, virtual keyboard, offline, coarse-pointer density. This doc's expanded sibling. |
| Modal routing policy | [`modal-routing-policy.md`](modal-routing-policy.md) | Routed detail surface vs. `Modal.confirm`. §5 and §9 summarize its decision matrix. |
| Design tokens | [`../design-tokens.md`](../design-tokens.md) | Spacing/type/motion/color scales and the coarse-pointer lift. Reference token names, never hardcode values. |
| UI/UX comprehensive review 2026-05 | [`ui-ux-comprehensive-review-2026-05.md`](ui-ux-comprehensive-review-2026-05.md) | The audit that motivated this work (A2 routed task panel, per-surface highlights, roadmap). |
| PRD — AI UX (v3) | [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md) | Board Copilot v3 requirements. |
| PRD — Agentic (v2.1) | [`../prd/v2.1-agent.md`](../prd/v2.1-agent.md) | Agent surface, autonomy levels, nudges, redaction. |
| PRD — Work-management depth | [`../prd/work-management-depth.md`](../prd/work-management-depth.md) | Boards, tasks, swimlanes, saved views depth. |
| PRD — Core collaboration | [`../prd/core-collaboration.md`](../prd/core-collaboration.md) | Core collaboration & work-management requirements. |
| PRD — Collaboration & notifications | [`../prd/collaboration-notifications.md`](../prd/collaboration-notifications.md) | Presence, mentions, inbox, notification depth. |
| PRD — Accounts & organizations | [`../prd/accounts-organizations.md`](../prd/accounts-organizations.md) | Auth, org, access model. |
