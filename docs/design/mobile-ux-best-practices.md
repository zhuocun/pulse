# Mobile & Responsive-Web UX: Best Practices

**Status:** general reference. Not a Pulse audit.
**Audience:** designers, frontend engineers, and PMs shipping the responsive
web surface of a PM / kanban / collaboration SaaS.
**Scope:** the principles and actionable checklists that govern how the app
behaves on phones and small tablets — from a browser tab up to an installed
PWA.

## How this doc relates to its siblings

This is the **principles layer**. It answers *what good looks like* on mobile
and hands you a checklist you can run against any screen. It deliberately
does **not** re-derive the underlying mechanics.

- [`mobile-native-best-practices.md`](mobile-native-best-practices.md) is the
  **mechanics + red-flag catalog** — the source of truth for *how* (viewport
  meta, `env(safe-area-inset-*)`, `inputmode`, service-worker cache
  strategies, the Core Web Vitals thresholds, and the exhaustive red-flag
  lists). This doc sits **above** it: where a subsection needs a concrete
  technique or a "never do this" list, it **summarizes in one line and links
  down** rather than restating the catalog. If you are hunting for the exact
  meta tags or the layout-shift red-flag list, go there.
- [`desktop-ux-best-practices.md`](desktop-ux-best-practices.md) is the
  **desktop sibling**. The two docs share the same section order for most
  shared domains (navigation, boards, tasks, notifications, collaboration,
  AI, the empty/loading/error triad, performance, accessibility); forms and
  search are adjacent but may swap order. Each doc describes only its
  platform delta. Where desktop and mobile diverge, this doc owns the phone
  answer and links across.
- [`ai-ux-best-practices.md`](ai-ux-best-practices.md) is the **AI source of
  truth**. This doc defers *all* AI principles (trust, streaming, citations,
  agentic write safety) there and covers **only mobile placement** of the
  Board Copilot — see §12.
- [`modal-routing-policy.md`](modal-routing-policy.md) owns the **routed
  detail surface vs. ephemeral confirm** decision. Any surface that deserves
  a URL (task detail, inbox item, settings sheet) follows that policy; this
  doc links to it rather than restating the six reasons.
- [`../design-tokens.md`](../design-tokens.md) owns the **spacing, type,
  motion, and color scales** plus the coarse-pointer lift. Reference token
  names (`space`, `fontSize`, `touchTargetCoarse`, `motion`); never hardcode
  values.

Guiding rule inherited from the shared spine: **summarize + link, do not
duplicate.**

**How to use it**

- [ ] Reading top-to-bottom gives you the mental model; each subsection ends
      with a checkbox list or a Do/Don't table you can run as a review gate.
- [ ] For the *implementation* of any technique, follow the link into
      `mobile-native-best-practices.md` — don't re-solve it from this doc.
- [ ] For anything AI, stop and read `ai-ux-best-practices.md §1` first.
- [ ] Treat the checklists as PR gates, not aspirations. A box that can't be
      ticked is a tracked gap, not a rounding error.

---

## 1. Purpose, audience & how to use

The mobile web surface is not "the desktop app, smaller." It is a distinct
context: one hand, one thumb, intermittent network, a keyboard that eats half
the screen, and a system that owns the back gesture. A collaboration SaaS
lives or dies on whether a teammate can triage a board from a phone between
meetings.

Three perceptions decide whether the app feels native (the full framing lives
in `mobile-native-best-practices.md`): it **opens fast and never blanks**, it
**responds within ~100 ms to every touch**, and it **respects the device**
(safe areas, dark mode, dynamic type, reduced motion, the keyboard). Every
principle below serves one of those three.

**Who owns what**

- **Design** owns layout, thumb-reach placement, motion feel, and the
  empty/loading/error triad copy.
- **Frontend** owns the mechanics — safe-area insets, viewport units,
  keyboard handling, service worker, view transitions.
- **PM** owns scope: which flows are phone-critical (triage, comment,
  status-change) vs. phone-tolerable (bulk edit, board configuration).

**Do / Don't**

| Do | Don't |
| --- | --- |
| Design the phone flow first for triage-critical paths. | Port a dense desktop layout and hope reflow saves it. |
| Link down to `mobile-native-best-practices.md` for mechanics. | Re-paste the red-flag lists into a review comment. |
| Keep the same section order as the desktop sibling. | Invent a new vocabulary for a shared concept. |

---

## 2. Responsive foundations

A responsive surface collapses gracefully from a wide multi-pane layout to a
single thumb-reachable column. The collapse points and the viewport plumbing
are mechanical — see `mobile-native-best-practices.md §1` (boilerplate) and
`§2.B` (layout & navigation) — but the *principles* are:

- **Single-column below the phone breakpoint.** Multi-pane layouts (board +
  right-rail + detail) exist only where width allows. On a phone, one surface
  is in focus at a time; the rest is one navigation away, not squeezed
  alongside.
- **Fluid, not fixed.** Content reflows to the viewport; horizontal page
  scroll is a bug. The one sanctioned horizontal scroll is the board's
  column axis (§6), and it snaps.
- **Correct viewport units.** `dvh` for sticky overlays/sheets, `svh` for
  stable heroes, `lvh` for intentional edge-to-edge — never bare `100vh`.
  Rationale and the URL-bar-collapse red flag live in
  `mobile-native-best-practices.md §2.B`.
- **Safe areas everywhere the finger or eye reaches.** `viewport-fit=cover`
  plus `env(safe-area-inset-*)` wrapped in `max()` so backgrounds bleed but
  controls never hide under the notch, Dynamic Island, or home indicator.
- **Density is automatic, not a mode.** The one-step type/target lift under
  `@media (pointer: coarse)` is applied by the theme, not chosen by the user.
  Keep the user-chosen comfortable/compact product setting separate from the
  automatic coarse-pointer lift (see `../design-tokens.md`).

**Checklist**

- [ ] Layout collapses to a single column below the phone breakpoint; no
      horizontal page scroll anywhere except the snapping board axis.
- [ ] All full-height overlays/sheets size in `dvh` with a `vh` fallback.
- [ ] Every top-level surface applies `env(safe-area-inset-*)` with `max()`.
- [ ] The coarse-pointer type/target lift comes from tokens, not per-component
      literals.
- [ ] No content sits below the 14 px mobile body-copy floor.

---

## 3. PWA & installability

*(Platform-only section — slots in after Purpose per the shared spine.)*

The app should be installable and, once installed, indistinguishable from a
native shell. The manifest fields, icon `purpose` rules, `display_override`,
and the `beforeinstallprompt` mechanics are catalogued in
`mobile-native-best-practices.md §2.A`; the principles that govern *when and
how* you surface installability are:

- **Installability is table stakes, install *nagging* is not.** Ship a valid
  manifest and icons so the browser's native install path works. A *custom*
  prompt appears only after genuine engagement — never on first paint, never
  covering a primary CTA.
- **iOS is a separate path.** iOS Safari has no `beforeinstallprompt`; the
  only route is "Share → Add to Home Screen," and instructions for it should
  show *only* on an iOS Safari tab, never on Android or desktop.
- **Installed ≠ tab.** In `display: standalone` there is no URL bar and no
  browser back button, so the app's own back affordance and the system back
  gesture carry the entire navigation contract (see §4). Test both states.
- **Standalone link breakout is a trap.** In an iOS standalone PWA, a plain
  external/`target="_blank"` link can eject the user to Safari — intercept
  and handle it (red flag detailed in `mobile-native-best-practices.md §3`).
- **Engagement APIs are earned, not assumed.** Web Push on iOS works only for
  *installed* PWAs from a user gesture; badging and app shortcuts are
  platform-gated. Feature-detect; degrade silently.

**Checklist**

- [ ] Valid manifest (name, `short_name`, `start_url`, `scope`,
      `display: standalone`, theme/background color, 192 px + 512 px icons
      with separate `any` / `maskable` entries).
- [ ] Custom install prompt (if any) fires post-engagement, never on first
      paint, never blocking a flow.
- [ ] iOS "Add to Home Screen" hint shows only on iOS Safari.
- [ ] App is navigable in `standalone` with no browser chrome (back affordance
      + system back both work).
- [ ] External links do not break the user out of standalone unexpectedly.
- [ ] Push / badge / share features are feature-detected and degrade cleanly.

---

## 4. Navigation

Mobile navigation is one-level-deep-at-a-time and thumb-anchored. The desktop
sibling leans on persistent chrome and a command-palette-primary model; the
mobile delta is **bottom tabs + system back**.

- **Bottom tab bar for 3–5 primary destinations.** Bottom tabs beat a
  hamburger for reach and discoverability. Pad the bar with
  `safe-area-inset-bottom`; keep labels visible and at a consistent small
  size. (Mechanics and the label-sizing gotcha: `mobile-native-best-practices.md
  §2.B` and its bottom-tab-bar note.)
- **The system back gesture is sacred.** Swipe-back (iOS) and the Android
  back button mean "dismiss the topmost thing." Overlays, sheets, and detail
  surfaces must close on back. The durable way to guarantee this is to
  **route** the surface so browser/gesture back is free — see
  [`modal-routing-policy.md`](modal-routing-policy.md). Overlay open/close
  state kept only in component state will fight the gesture.
- **One focus at a time.** Drilling into a task, a project, or search replaces
  the current focus rather than stacking panes. Depth is expressed through
  the route stack, not through nested visible panels.
- **Thumb zone rules placement.** Primary and frequent actions live in the
  bottom third; destructive actions never sit in the top corners on large
  phones.
- **Command palette is secondary on mobile.** It exists (height-capped in
  `dvh`) but is a power-user path, not the primary launcher it is on desktop.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Route detail surfaces so back closes them for free. | Trap open/close state where the back gesture can't reach it. |
| Put a bottom tab bar with 3–5 destinations. | Bury primary nav in a top-left hamburger. |
| Pad the tab bar with `safe-area-inset-bottom`. | Let the home indicator overlap tab targets. |
| Place primary actions in the thumb zone. | Park destructive actions in the top corners. |

---

## 5. Touch, gestures & motion

Touch is imprecise and motion is expensive on low-end phones. The exact
target sizes, `touch-action` declarations, Pointer-Event handling, animation
duration bands, View-Transition baseline, and haptics rules are catalogued in
`mobile-native-best-practices.md §2.C`. The principles:

- **Targets are 44 px on coarse pointers.** WCAG 2.2 **SC 2.5.8** sets a 24 px
  floor; the product bar is 44 pt (Apple HIG) / 48 dp (Material). The
  AGENTS.md accessibility rule and `../design-tokens.md` `touchTargetCoarse`
  make this automatic under `@media (pointer: coarse)`. **Pad** small icons —
  never scale them — and keep ≥ 8 px between targets.
- **Declare gesture intent.** Horizontal card/column swipe uses
  `touch-action: pan-y`; free 2D drag uses `none`. Build on Pointer Events
  (`pointerId`, `setPointerCapture`, `pointercancel`), not legacy Touch
  Events.
- **Gestures are shortcuts, never the only path.** A swipe-to-archive or
  swipe-to-complete must have a visible, tappable equivalent. Hidden gestures
  are undiscoverable and inaccessible.
- **Animate only `transform` and `opacity`.** Micro-interactions 150–250 ms,
  transitions 250–400 ms. Route transitions use the View Transitions API for
  SPA-feel; full page reloads between routes are a red flag.
- **Reduced motion is the default posture.** Gate animation inside
  `@media (prefers-reduced-motion: no-preference)`; skeleton shimmer respects
  it too.
- **Haptics reinforce, never replace.** `navigator.vibrate` on key actions,
  paired with visual feedback (iOS support is spotty); never spam.

**Checklist**

- [ ] Every interactive control is ≥ 44 px on coarse pointers (via tokens),
      with ≥ 8 px spacing; small icons are padded, not scaled.
- [ ] Swipe/drag surfaces declare the right `touch-action` and use Pointer
      Events with a `pointercancel` path.
- [ ] Every gesture has a visible tappable equivalent.
- [ ] Animations touch only `transform`/`opacity` and respect
      `prefers-reduced-motion`.
- [ ] Route changes use view transitions; no full reloads.
- [ ] Haptics (where used) are paired with visual feedback and never spammed.

---

## 6. Boards & kanban on small screens

*(Shared domain — desktop shows multiple columns and swimlanes together;
the mobile delta is one column/swimlane in focus with horizontal snap.)*
Depth requirements live in
[`../prd/work-management-depth.md`](../prd/work-management-depth.md).

- **One column in focus, snap between them.** The board's column axis is the
  single sanctioned horizontal scroll and it **snaps** so a column lands
  centered. A peek of the neighbor's edge signals there's more.
- **One swimlane at a time.** Swimlanes (the horizontal group-by axis) are
  desktop-primary; on a phone, show one swimlane and let the user switch,
  rather than rendering a grid that requires two-axis scrolling.
- **Card anatomy is ruthless.** A phone card shows title, status/priority,
  assignee, and at most one or two meta chips. Everything else lives in the
  task detail surface (§7). Reserve image/badge dimensions so cards don't
  shift as assets load (CLS).
- **Reordering must not fight scroll.** Drag-to-reorder competes with the
  scroll gesture; require a deliberate press (or a drag handle) to start a
  drag, keep reorder mutations optimistic, and always show rollback on
  failure (§15).
- **Column actions are reachable.** Add-card and column menus sit within
  thumb reach, not only at a scrolled-off top.

**Checklist**

- [ ] Column axis scrolls horizontally with snap; a neighbor edge peeks.
- [ ] One swimlane shown at a time with an explicit switcher; no two-axis grid.
- [ ] Cards show only triage-critical fields; media/badges have reserved
      dimensions.
- [ ] Drag-to-reorder needs a deliberate start and doesn't hijack vertical
      scroll; mutations are optimistic with visible rollback.
- [ ] Add-card / column actions are thumb-reachable.

---

## 7. Tasks & detail surfaces

*(Shared domain — desktop opens detail as a right `Drawer`; the mobile delta
is a bottom sheet that back closes.)*

- **The task detail surface is routed.** It owns a URL
  (`/projects/:projectId/board/task/:taskId`); the board stays mounted
  beneath; browser/swipe-back closes it. The visual shell is a bottom-sheet
  `Drawer` on phones, but the **route** is the source of truth, not open/close
  state. This is non-negotiable per
  [`modal-routing-policy.md`](modal-routing-policy.md) — don't reach for a
  `Modal` for a detail surface.
- **Confirms stay ephemeral.** Delete-task and discard-unsaved-edits are
  yes/no/cancel interactions — `Modal.confirm` (or a `<Modal>` wired to
  `useBlocker` for the dirty-form guard), never a routed surface. The
  decision matrix lives in the routing policy.
- **The sheet respects the keyboard.** A bottom sheet hosting a form must sit
  above the virtual keyboard via `env(keyboard-inset-height)` (§8), so the
  focused field and its actions stay visible.
- **Progressive disclosure over a wall of fields.** Lead with the fields a
  user changes on a phone (status, assignee, comment); collapse the long tail
  (description history, custom fields) behind sections.
- **Swipe-between scales from the route.** Once keyed off `:taskId`, "next
  task" is another `navigate(...)` — no teardown, no state replay.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Route the task detail; let back close it. | Use a stateful modal that fights the back gesture. |
| Keep delete / discard as `Modal.confirm`. | Give a yes/no confirm its own URL. |
| Float the sheet above the keyboard. | Let the keyboard cover the focused field or Save. |
| Lead with phone-critical fields. | Dump every field into one long scroll. |

---

## 8. Forms & virtual keyboard

*(Shared domain — desktop uses dense 14 px inputs and keyboard tab-order;
the mobile delta is 16 px inputs, keyboard-type hints, and keyboard insets.)*
Forms are the highest-leverage area for mobile UX. The attribute-level
mechanics (`inputmode`, `enterkeyhint`, `autocomplete` tokens, the 16 px
rule, `interactive-widget=resizes-content`, the VirtualKeyboard API) are
catalogued in `mobile-native-best-practices.md §2.D`. Principles:

- **Never trigger auto-zoom.** Inputs are ≥ 16 px on coarse pointers so iOS
  doesn't zoom on focus. Never `user-scalable=no` (a WCAG violation).
- **Summon the right keyboard.** `inputmode` picks the keyboard
  (`numeric`, `decimal`, `email`, `url`, `search`) without `type="number"`
  quirks; `enterkeyhint` relabels the return key (`send`, `search`, `next`,
  `done`); `autocomplete` tokens unlock autofill and OTP.
- **Keep actions above the keyboard.** Fixed footers and the focused field
  float above the keyboard using the keyboard inset; the Save/Send control is
  never hidden behind it.
- **No `autofocus` on load.** Auto-focusing on mount triggers a viewport jump
  on iOS; let the user tap in.
- **Validate inline, recover gracefully.** Errors appear next to the field,
  not only in a top summary; the keyboard type and error copy must match the
  expected input (don't demand a number in a text keyboard).
- **Search inputs get a clear affordance.** `type="search"` or the framework's
  `allowClear` — never both stacked.

**Checklist**

- [ ] All inputs are ≥ 16 px on coarse pointers; `user-scalable=no` is never
      set.
- [ ] Every text input declares an appropriate `inputmode`, `enterkeyhint`,
      and `autocomplete`.
- [ ] Focused field and submit action float above the virtual keyboard.
- [ ] No `autofocus` on page/modal load.
- [ ] Validation is inline and field-adjacent; error copy matches the input
      type.
- [ ] Search fields expose exactly one clear affordance.

---

## 9. Search & filter

*(Shared domain — desktop uses a palette plus an inline filter bar with saved
views; the mobile delta is a full-screen search sheet and condensed
filters.)* Saved-view depth lives in
[`../prd/work-management-depth.md`](../prd/work-management-depth.md).

- **Search opens full-screen.** Tapping search gives the query the whole
  viewport and immediate keyboard focus (the one sanctioned focus-on-open,
  since the user initiated it) with `inputmode="search"` and
  `enterkeyhint="search"`.
- **Filters condense, then expand.** Show the active filter count as a chip;
  open the full filter set in a sheet. Never render a desktop filter bar's
  worth of controls inline on a phone.
- **Results are the same objects, everywhere.** A search result card and a
  board card are the same anatomy so the user isn't re-learning the object.
  Tapping a result routes to the same detail surface (§7).
- **Saved views are first-class.** Applying and switching saved views works on
  a phone; creating/editing complex views may defer to desktop, but the phone
  must not be a dead end.
- **Empty and no-result states offer the next action** (§13) — a "clear
  filters" control that itself meets the 44 px target.

**Checklist**

- [ ] Search opens full-screen with immediate, user-initiated keyboard focus
      and the search keyboard type.
- [ ] Filters collapse to a count chip + sheet; no inline desktop filter bar.
- [ ] Result cards match board-card anatomy and route to the same detail
      surface.
- [ ] Saved views can be applied/switched on a phone with no dead end.
- [ ] No-result state offers a 44 px "clear filters" recovery action.

---

## 10. Notifications

*(Shared domain — desktop uses a right-rail inbox with hover previews; the
mobile delta is a bottom-sheet inbox and push for installed PWAs.)* Presence,
mentions, and inbox depth live in
[`../prd/collaboration-notifications.md`](../prd/collaboration-notifications.md).

- **Inbox is a bottom sheet or routed surface.** Per
  [`modal-routing-policy.md`](modal-routing-policy.md), an inbox *item* that
  deserves a URL is routed (`/inbox/:itemId`); the list stays mounted beneath.
- **Push is opt-in and earned.** Web Push works only for installed PWAs from a
  user gesture (§3). Ask *after* the user has felt the app's value, tie the
  ask to a concrete moment (a mention), and never on first run.
- **Respect a notification budget.** Batch, dedup, and expire nudges rather
  than firing one buzz per event; align with the product's inbox rules
  (max-count, dedup key, expiry, prune) rather than inventing per-surface
  behavior.
- **In-app cues over interruptions.** Prefer a badge on the inbox tab and a
  quiet in-app toast to an OS-level interruption for low-urgency events.
- **Every notification deep-links.** Tapping a push or inbox item lands on the
  exact resource (routed detail surface), not a generic list.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Route inbox items so back returns to the list. | Stack a modal-over-modal inbox. |
| Ask for push after a value moment. | Prompt for push on first launch. |
| Batch/dedup/expire nudges. | Buzz once per raw event. |
| Deep-link every notification to its resource. | Drop the user on a generic inbox. |

---

## 11. Collaboration

*(Shared domain — desktop shows side-by-side presence and hover avatars; the
mobile delta is compact presence and tap-to-reveal.)* Core collaboration
requirements live in
[`../prd/core-collaboration.md`](../prd/core-collaboration.md) and
[`../prd/collaboration-notifications.md`](../prd/collaboration-notifications.md).

- **Presence is compact.** Show a small avatar stack with an overflow count;
  detail (who, doing what) is revealed on **tap**, since there is no hover on
  coarse pointers.
- **Mentions are thumb-friendly.** The @-mention picker opens above the
  keyboard, is scrollable, and its rows meet the 44 px target.
- **Comment composer respects the keyboard.** The composer floats above the
  virtual keyboard (§8), uses `enterkeyhint="send"`, and keeps Send visible.
- **Real-time updates arrive without yanking scroll.** New activity appears
  without repositioning the user's current read position; surface a
  non-intrusive "new activity" affordance instead of auto-scrolling.
- **Optimistic, with honest rollback.** A comment or status change shows
  immediately and rolls back visibly on failure — silent reverts erode trust
  (§15).

**Checklist**

- [ ] Presence is a compact avatar stack + overflow; detail on tap, not hover.
- [ ] @-mention picker opens above the keyboard with 44 px rows.
- [ ] Comment composer floats above the keyboard with a visible Send.
- [ ] Incoming activity doesn't hijack the user's scroll position.
- [ ] Collaborative actions are optimistic with visible rollback on failure.

---

## 12. AI Board Copilot — mobile placement

*(Shared domain — this section covers **placement only**. All AI principles —
trust calibration, streaming, citations, agentic write safety, error taxonomy
— defer to [`ai-ux-best-practices.md §1`](ai-ux-best-practices.md).)*
Requirements: [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md) and
[`../prd/v2.1-agent.md`](../prd/v2.1-agent.md).

The desktop Copilot is a **persistent right-rail dock**
(`ai-ux-best-practices.md §10.2`). There is no right rail on a phone, so the
mobile delta is:

- **Routed `/copilot` dock as a bottom sheet / tab.** The Copilot becomes a
  routed surface (chat / brief / activity / settings tabs) opened from a
  primary AI entry point, following
  [`modal-routing-policy.md`](modal-routing-policy.md) so back closes it and
  it's deep-linkable. It is not a right rail squeezed into a phone.
- **Single primary AI entry, plus contextual inline AI.** One "Copilot"
  anchor for discovery (`ai-ux-best-practices.md §10.1`); contextual inline
  AI (e.g. estimate inside the task sheet) stays where the work is.
- **Streaming lives in a `polite` live region** so VoiceOver/TalkBack announce
  incrementally (§16); the composer floats above the keyboard (§8) with
  `enterkeyhint="send"`.
- **Write actions still require explicit approval on a phone** — the smaller
  screen never becomes an excuse to auto-apply mutations. Approval and undo
  behavior are owned by `ai-ux-best-practices.md`.
- **Degrade to the non-AI path.** When AI is unavailable, the mobile surface
  falls back to the manual flow (search, manual edit) — never a dead end.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Make Copilot a routed bottom-sheet/tab dock. | Cram the desktop right rail onto a phone. |
| Keep one primary AI entry + contextual inline AI. | Scatter AI buttons across every surface. |
| Defer AI principles to `ai-ux-best-practices.md`. | Re-derive trust/streaming rules here. |
| Require explicit approval for AI writes. | Auto-apply mutations because the screen is small. |

---

## 13. Empty, loading & error states

*(Shared domain — the empty/loading/error **triad** is one design obligation.
Desktop sizes skeletons to a wide layout; the mobile delta is single-column
skeletons and no white flash.)*

Treat the three as a set for every data surface:

- **Empty** — no data offers the *next action*, never a dead end. A blank
  board offers "add a column / card"; an empty filtered column offers a 44 px
  "reset filters" control.
- **Loading** — a **skeleton** that mirrors the eventual content's
  single-column shape, or a *delayed* spinner for short waits. Never a blank
  white screen (skeletons feel measurably faster — see
  `mobile-native-best-practices.md §3`). Never a skeleton and spinner on the
  same surface at once. Skeleton shimmer respects `prefers-reduced-motion`.
- **Error** — states the cause, offers recovery, and degrades to the non-AI /
  manual path. On mobile, avoid jarring system dialogs; use in-app error
  surfaces and toasts.

Reserve layout so the transition from skeleton → content doesn't shift
(CLS); the single-column skeleton must match the real content's dimensions.

**Checklist**

- [ ] Every data surface defines all three states together.
- [ ] Empty states offer a next action; recovery controls meet 44 px.
- [ ] Loading uses a single-column skeleton (or delayed spinner), never a
      blank white screen, never both at once; shimmer respects reduced motion.
- [ ] Errors state the cause, offer recovery, and degrade to the manual path.
- [ ] Skeleton → content causes no layout shift.

---

## 14. Onboarding

*(Shared domain — desktop uses contextual tooltips and palette hints; the
mobile delta is first-run sheets and a post-engagement install nudge.)* Auth
and org model: [`../prd/accounts-organizations.md`](../prd/accounts-organizations.md).

- **First-run is a sheet, not a tour.** A short, skippable bottom sheet beats a
  multi-step overlay tour that fights the back gesture. Anything worth
  deep-linking (a walkthrough step) is routed.
- **Progressive disclosure.** Teach the next action at the moment it's
  relevant, not all upfront. The empty states (§13) *are* onboarding for the
  first board/task.
- **Install nudge comes after value.** The PWA install prompt (§3) is an
  onboarding *outcome*, not an opener — surface it after the user has created
  or triaged something.
- **Respect skip and reduced motion.** Onboarding is skippable, resumable, and
  never blocks the primary flow; animated coach-marks respect
  `prefers-reduced-motion`.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Use a short, skippable first-run sheet. | Force a multi-step tour that traps back. |
| Teach at the point of relevance via empty states. | Front-load every feature on first launch. |
| Surface the install nudge after a value moment. | Prompt to install on first paint. |

---

## 15. Performance & resilience

*(Shared domain — desktop budgets for capable hardware; the mobile delta is
that 75th-percentile mobile Core Web Vitals are the gate.)* Thresholds,
layout-shift / loading / interaction red flags, and cache strategies are
catalogued in `mobile-native-best-practices.md §3` and `§2.F`; the shared
registry pins LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.

- **Mobile CWV is the merge gate.** The 75th-percentile mobile field metrics
  decide pass/fail, not desktop lab numbers. Sub-100 ms INP is the "feels
  native" bar.
- **Ship less to the phone.** Route-level code splitting, right-sized images
  with explicit dimensions, and no render-blocking head JS. The bundle and
  layout-shift red-flag lists live in the mechanics doc — don't restate them.
- **Offline is a feature, not a fallback.** A service worker precaches the app
  shell (NetworkFirst for HTML, CacheFirst for hashed assets,
  StaleWhileRevalidate for icons/avatars) so return visits open instantly and
  a flaky network doesn't blank the app.
- **Optimistic UI with honest rollback.** Mutations (create/edit/reorder,
  comments, status changes) apply immediately and **visibly** roll back on
  failure. A silent revert is worse than a spinner. Queue mutations when
  offline and replay on reconnect.
- **Every async call is cancelable.** Respect `AbortController` / unmount so a
  back-navigation mid-request doesn't land stale data or leak work.

**Checklist**

- [ ] 75th-pct mobile LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
- [ ] Route-level code splitting; images carry explicit dimensions; no
      render-blocking head JS.
- [ ] Service worker precaches the app shell and serves a sensible offline
      fallback.
- [ ] Mutations are optimistic with visible rollback; offline mutations queue
      and replay.
- [ ] Async work respects `AbortController` / unmount.

---

## 16. Accessibility

*(Shared domain — desktop is keyboard + focus-visible primary; the mobile
delta is VoiceOver/TalkBack reading order and a thicker coarse-pointer focus
ring.)* Mobile a11y mechanics live in `mobile-native-best-practices.md §2.H`.

- **Target size is enforced, not aspirational.** WCAG 2.2 **SC 2.5.8**
  (24 px floor) with the product's 44 px coarse-pointer bar, applied
  automatically via `@media (pointer: coarse)` and `../design-tokens.md`
  `touchTargetCoarse`. This is the AGENTS.md accessibility rule and is pinned
  by the `declares a touch-target height` tests in the component suites —
  every new interactive control must satisfy it.
- **Semantic HTML first.** Prefer `<button>`, `<nav>`, `<main>` over ARIA
  bolted onto `<div>`s; correct roles come for free. VoiceOver is strict — a
  broken accessibility tree is *audible*.
- **Reading order matters more on mobile** because swipe-navigation is the
  primary screen-reader interaction. The DOM order must match the visual
  order.
- **Live regions for async content.** Streamed AI output and incoming
  collaboration updates announce via `aria-live="polite"`; reserve
  `assertive` for errors/critical state.
- **Every surface passes axe-core clean.** Top-level surfaces are gated by the
  strict axe-core suite (`src/__tests__/uiAccessibility.strict.test.tsx`);
  icon-only buttons carry `aria-label`, decorative icons are `aria-hidden`,
  and the focus ring is thicker on coarse pointers.
- **Labels flow through microcopy.** Button text comes from the shared
  microcopy source; the ESLint rule blocks raw `Submit`/`OK`/`Login` etc. as
  button children.

**Checklist**

- [ ] Every interactive control meets SC 2.5.8 / the 44 px coarse bar via
      tokens (AGENTS.md rule).
- [ ] Semantic HTML is used before ARIA; icon-only controls have `aria-label`,
      decorative icons `aria-hidden`.
- [ ] DOM/reading order matches visual order for swipe navigation.
- [ ] Async content announces via `aria-live` (`polite` default, `assertive`
      for errors only).
- [ ] Top-level surfaces pass axe-core clean; focus ring is thicker on coarse
      pointers.
- [ ] Button labels come from shared microcopy, not raw literals.

---

## 17. Sources

Cited from the shared external source registry (see the UX spine). Labels
match the desktop sibling and `mobile-native-best-practices.md` so the two
read as one system.

| Label | Source | Primary use here |
| --- | --- | --- |
| **NN/g** | [Nielsen Norman Group](https://www.nngroup.com/) — incl. [Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/), the 10 usability heuristics | Empty states, skeleton-vs-spinner, mental models, the triad. |
| **WCAG 2.2** | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — esp. [SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), SC 2.4.11 Focus Appearance, SC 2.3.3 Motion from Interactions | Target size, focus visibility, reduced motion. |
| **W3C ARIA** | [WAI-ARIA — Live Regions](https://www.w3.org/TR/wai-aria/#aria-live) | Accessible live regions for streamed/async content. |
| **Material 3** | [Material Design 3](https://m3.material.io/) ([M2 touch-target](https://m2.material.io/develop/web/supporting/touch-target)) | 48 dp touch target, density guidance. |
| **Apple HIG** | [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 44 pt hit target, thumb reach, safe areas. |
| **Atlassian Design System** | [Atlassian Design System](https://atlassian.design/) | Kanban/board patterns, issue-detail conventions, empty states. |
| **Linear / Jira / Asana patterns** | [Linear](https://linear.app/features), Jira, Asana | Command palette, board/list parity, saved views. |
| **web.dev / Core Web Vitals** | [web.dev](https://web.dev/) — [INP](https://web.dev/articles/inp), [LCP](https://web.dev/articles/lcp), [CLS](https://web.dev/articles/optimize-cls), [2025 Web Almanac](https://almanac.httparchive.org/en/2025/performance) | Mobile performance budgets and thresholds. |

The AI-specific source stack (Google PAIR, Microsoft HAX, NIST AI RMF, IBM
Design for AI, Anthropic, Apple ML Privacy) is **not** duplicated here — it
lives in [`ai-ux-best-practices.md §14`](ai-ux-best-practices.md). Mobile PWA /
gesture / viewport implementation sources are in
[`mobile-native-best-practices.md §7`](mobile-native-best-practices.md); this
doc summarizes and links rather than re-listing them.

### Cross-links

- [`mobile-native-best-practices.md`](mobile-native-best-practices.md) — the
  mechanics + red-flag catalog this doc sits above.
- [`desktop-ux-best-practices.md`](desktop-ux-best-practices.md) — the desktop
  sibling; same shared section order, stating its desktop delta.
- [`ai-ux-best-practices.md`](ai-ux-best-practices.md) — AI UX source of truth.
- [`modal-routing-policy.md`](modal-routing-policy.md) — routed detail surface
  vs. ephemeral confirm.
- [`../design-tokens.md`](../design-tokens.md) — spacing/type/motion/color
  scales and the coarse-pointer lift.
- [`ui-ux-comprehensive-review-2026-05.md`](ui-ux-comprehensive-review-2026-05.md)
  — the audit that motivated this work.
