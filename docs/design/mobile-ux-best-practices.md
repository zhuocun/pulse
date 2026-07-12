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
  strategies, the engagement APIs — share, badging, shortcuts — the offline
  mutation queue, the Core Web Vitals thresholds, and the exhaustive
  red-flag lists). This doc sits **above** it: where a subsection needs a
  concrete technique or a "never do this" list, it **summarizes in one line
  and links down** rather than restating the catalog. The domains added in
  this revision — OS integration (§3), entry & auth (§4), long-press /
  pull-to-refresh / undo (§5), reorder without drag (§6), attachments (§7),
  push priming (§10), offline conflicts (§15), and tablet/foldable layout
  (§2) — follow the same contract. If you are hunting for the exact meta
  tags or the layout-shift red-flag list, go there.
- [`desktop-ux-best-practices.md`](desktop-ux-best-practices.md) is the
  **desktop sibling**. The two docs share the same section order for most
  shared domains (navigation, boards, tasks, notifications, collaboration,
  AI, the empty/loading/error triad, performance, accessibility); forms and
  search are adjacent but may swap order. Each doc describes only its
  platform delta. Where desktop and mobile diverge, this doc owns the phone
  answer and links across. Tablet widths are the meeting point: §2 says
  where the phone answer hands over to the desktop one.
- [`ai-ux-best-practices.md`](ai-ux-best-practices.md) is the **AI source of
  truth**. This doc defers *all* AI principles (trust, streaming, citations,
  agentic write safety) there and covers **only mobile placement** of the
  Board Copilot — see §12.
- [`modal-routing-policy.md`](modal-routing-policy.md) owns the **routed
  detail surface vs. ephemeral confirm** decision. Any surface that deserves
  a URL (task detail, inbox item, settings sheet) follows that policy; this
  doc links to it rather than restating the six reasons. The deep-link and
  share-target additions in §3–§4 lean on it: an OS share or a pasted URL
  can only land somewhere that is routed.
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

### Tablet, landscape & foldables

The stretch between phone and desktop is a third context, not an
interpolation. A tablet is coarse-pointer but wide; a landscape phone is
wide but starved for height; a foldable changes shape mid-session. The
principles:

- **Tablet earns back the second pane.** At tablet widths a routed detail
  surface can sit beside the board instead of over it — the shell shape
  follows the width, the route stays the same. Hand the multi-pane rules to
  the desktop sibling (`desktop-ux-best-practices.md §2.5`) once width and
  hover allow; do not stretch a phone column across an iPad.
- **Coarse pointer ≠ small screen.** The 44 px target lift keys off
  `pointer: coarse`, never off viewport width — a tablet keeps the touch
  ladder even in a desktop-shaped layout.
- **Landscape trades height, not legitimacy.** In landscape the keyboard
  plus sticky chrome can consume most of the viewport: collapse or shrink
  sticky bars, keep the focused field visible, and apply safe-area insets on
  all four edges — the notch sits on a *side* in landscape.
- **Foldables fold through your layout.** Keep critical controls off the
  hinge line; when the posture is book-like, the two segments are a natural
  two-pane split (board | detail), not one pane awkwardly bridging the
  crease. Feature-detect posture; degrade to the plain tablet layout.
- **Rotation and posture changes preserve state.** Rotating or unfolding
  must not lose scroll position, in-progress form input, or an open routed
  surface. The URL already carries the surface (§4); the layout re-shells
  around it.

> `Example (Pulse)`: the routed task detail keeps one URL across shells —
> the `Drawer` flips `placement="bottom"` on phones to `placement="right"`
> on tablets+ (see the phone-first shells note in
> [`modal-routing-policy.md`](modal-routing-policy.md)). Rotation re-shells;
> the route survives.

**Checklist**

- [ ] Tablet widths show board + routed detail side by side, not a stretched
      phone column.
- [ ] Touch-target and type lifts key off `pointer: coarse`, never width.
- [ ] Landscape collapses sticky chrome and applies safe-area insets on all
      four edges.
- [ ] No critical control sits on a foldable's hinge; book posture maps to a
      two-pane split where detectable.
- [ ] Rotation/unfolding preserves scroll, input, and open routed surfaces.

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

### OS integration — share target, app shortcuts, badging, widgets

Installation is the entry ticket; *participation* in the OS is what makes
the app feel resident. Four surfaces, in descending order of leverage
(sending-side share, badging, and shortcuts mechanics live in
`mobile-native-best-practices.md §2.G`):

- **Share target turns the OS share sheet into an intake flow.** Registering
  as a share target means a link, text snippet, or screenshot shared *from
  another app* opens yours with a prefilled draft — the difference between
  "copy, switch, paste" and one tap. The receiving route must be a real
  routed surface, must handle unauthenticated arrivals (login, then resume
  with the shared payload intact), and must not transmit shared data
  anywhere before the user confirms the draft.
- **App shortcuts make long-press useful.** Three or four launcher shortcuts
  (new task, last board, the Copilot) — each a deep link into a routed
  surface (§4) that works from a cold start. More than four dilutes all of
  them.
- **Badging mirrors the inbox, never markets.** The icon badge shows the
  same count as the in-app inbox, obeys the same budget rules (§10 —
  dedup, expiry), and clears when items are read. A badge that can't be
  cleared by acting in the app trains users to ignore it.
- **Widgets are an enhancement, not a surface.** Home-screen/OS widgets are
  platform-gated and niche; if shipped, they are read-mostly glances that
  deep-link in — never a primary path, never a thing the app requires.

> `Example (Pulse)`: the 2026-05 PWA review's Web Share Target ambition is
> the target shape — share a Slack link or screenshot → Pulse opens with
> the task draft prefilled (`name=<title>`, note carrying text + URL), with
> a login-and-resume guard for unauthenticated shares.

**Checklist**

- [ ] Share-target arrivals land on a prefilled draft in a routed surface;
      unauthenticated shares survive login and resume.
- [ ] No shared payload leaves the device before the user confirms.
- [ ] Launcher shortcuts (3–4) deep-link to routed surfaces and work cold.
- [ ] Icon badge mirrors the inbox count and clears on read.
- [ ] Every OS-integration API is feature-detected and degrades to the
      in-app equivalent.

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

### Entry, auth & deep links

The front door is part of mobile navigation: typing an eight-character
password on a phone keyboard is the worst form the product ships, and a
deep link that dumps the user on a generic list wastes the one thing mobile
sharing is good at. Desktop session expiry, multi-tab broadcast, and
long-lived-tab behavior are owned by the desktop sibling — see
[`desktop-ux-best-practices.md §3.3`](desktop-ux-best-practices.md).

- **Passkey/biometric first for returning users.** A registered passkey
  turns sign-in into Face ID / fingerprint — surfaced conditionally when
  the user taps the identifier field, so the first paint shows no form wall
  and pops no keyboard. Password is the collapsed fallback ("Sign in with
  password instead"), not the default posture.
- **Credential autofill is declared, never fought.** `autocomplete` tokens
  for username, password, and one-time codes let the OS password manager
  and SMS OTP autofill do the typing (token mechanics:
  `mobile-native-best-practices.md §2.D`). Never make a user hand-copy a
  six-digit code the OS could paste.
- **Magic links are the no-passkey fallback — plan the context switch.** The
  email link opens in the default browser, which may not be the installed
  PWA or even the browser that requested it. Respond to the request
  immediately ("check your email"), and offer a short-code entry path so
  the session can land back in the context the user started in.
- **Every shareable resource deep-links.** A pasted task URL opens the
  routed task detail (per [`modal-routing-policy.md`](modal-routing-policy.md))
  with the board mounted beneath — not the project list, not a login
  dead-end. Push notifications, OS shares (§3), and inbox items all reuse
  this same contract.
- **Auth-gated deep links preserve their destination.** Hitting a protected
  URL while signed out routes through login and then *resumes to the
  original destination*. Losing the destination is losing the share.
- **Unknown routes recover.** A dead deep link lands on a not-found state
  with a next action (§13), never a blank page or a silent redirect.

> `Example (Pulse)`: the routed task detail at
> `/projects/:projectId/board/task/:taskId` is the deep-link target for
> board shares; the 2026-05 auth review names passkey-first with
> magic-link fallback (and password collapsed beneath) as the ranked
> direction for the phone entry flow.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Offer passkey/biometric first; collapse password behind a fallback link. | Lead with an email+password wall and a keyboard pop on first paint. |
| Declare autofill tokens so the OS fills credentials and OTP codes. | Force manual transcription of codes the OS could paste. |
| Preserve a deep link's destination through the login flow. | Drop an authenticated user on a generic list after login. |
| Offer a code-entry fallback for magic links. | Assume the magic link opens in the context that requested it. |

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

### Long-press & pull-to-refresh

Two gestures the platform half-owns; both reward restraint.

- **Long-press is touch's right-click.** It opens a contextual shortcut menu
  (move, archive, assign) the same way hover/right-click does on desktop —
  and like every gesture, it is never the only path: everything on a
  long-press menu also lives in a visible menu or the detail surface.
- **Long-press must not fight the platform.** On the web it collides with
  text selection and the OS callout/context menu. A surface that claims it
  must suppress those on the pressed element *only*, hold a deliberate
  ~500 ms threshold, and give immediate feedback on trigger (lift, menu, or
  haptic) so the user knows the press landed.
- **Long-press is the honest drag starter.** A deliberate press-to-drag (or
  a drag handle) is how reorder coexists with scroll — the board case is
  §6's problem; the gesture contract is here.
- **A live product should not need pull-to-refresh.** Data arrives through
  the real-time layer; relying on a manual refresh to see teammates' changes
  is a red flag (`mobile-native-best-practices.md §3`). Where a surface does
  offer refresh, keep the *platform's* pull-to-refresh — or fully disable
  overscroll on inner scroll containers so a scroll bounce never triggers a
  full SPA reload and drops board state. A half-custom pull-to-refresh is
  worse than either choice.

**Checklist**

- [ ] Everything reachable by long-press has a visible tappable path too.
- [ ] Long-press suppresses selection/callout only on the pressed element
      and gives immediate feedback at the ~500 ms threshold.
- [ ] Inner scroll containers contain overscroll; a bounce never reloads the
      app.
- [ ] Pull-to-refresh (if present) is the platform default, not a hybrid.
- [ ] Fresh data arrives via the real-time layer; refresh is a fallback.

### Undo-first destructive actions

On touch, mis-taps are routine — and a confirm dialog taxes every correct
tap to guard against the rare wrong one. Flip the default:

- **Act immediately, offer undo.** For reversible actions (archive,
  complete, move, dismiss), commit at once and surface an undo window. The
  interaction cost lands only on the user who actually erred.
- **The undo affordance is real.** A toast with an actual button that meets
  the 44 px bar, a window long enough to read and react (≥ 5 s), a countdown
  that pauses on interaction, and a live-region announcement so screen-reader
  users get the same escape hatch.
- **Confirms are reserved for the irreversible.** Delete-project and
  delete-task stay ephemeral confirm dialogs per
  [`modal-routing-policy.md`](modal-routing-policy.md) — and in a stacked
  phone footer the destructive verb never sits adjacent to Save/Cancel.
- **Swipes follow the same rule.** Swipe-to-archive commits with undo; a
  swipe should never land the user in a confirm dialog.
- **AI writes inherit the contract.** Approval and undo behavior for
  agent-applied mutations is owned by
  [`ai-ux-best-practices.md`](ai-ux-best-practices.md) — same posture,
  defined there.

> `Example (Pulse)`: the Undo toast renders a real `<button>` (not
> `<a role="button">`) so Enter/Space activation and the focus ring come
> for free — the shape every undo affordance here should match.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Commit reversible actions immediately and offer undo. | Interrupt every archive with "Are you sure?" |
| Give undo a 44 px button, a ≥ 5 s window, and a live-region announcement. | Ship a 2-second toast no thumb can catch. |
| Reserve confirm dialogs for costly, irreversible deletes. | Confirm-dialog everything and train users to click through. |
| Separate destructive verbs from dismiss in stacked footers. | Stack Delete directly under Save/Cancel. |

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

### Reorder without drag

Drag-and-drop excludes people: screen-reader and switch-access users, users
with tremor, and anyone whose drag keeps losing to the scroll gesture on a
crowded phone board. Drag is the fast path — it is never the only path.

- **Every drag outcome has a menu equivalent.** "Move to…" in the card's
  overflow menu opens a column picker (a sheet with 44 px rows); moving
  between swimlanes and reassigning follow the same shape.
- **Within-column order is editable without drag.** Move up / move down /
  move to top actions on the card menu — or an explicit position control in
  the detail surface — cover precise reordering.
- **The detail surface is the universal fallback.** Column/status is a field
  on the routed task detail (§7); any move a drag can make, an edit there
  can make too.
- **The non-drag path is the AT path.** It must be discoverable and operable
  with VoiceOver/TalkBack end-to-end; parity here is a release gate, not
  polish.
- **Both paths share one mutation.** Optimistic apply and visible rollback
  (§15) behave identically whether the move came from a drag or a menu.

> `Example (Pulse)`: task-card drags start from a deliberate press
> (`disableInteractiveElementBlocking` on the `<Drag>` — see AGENTS.md's
> drag-and-drop note), and reorder flows through the shared optimistic
> mutation in `src/utils/optimisticUpdate/reorder.ts` — the same mutation a
> menu-driven move should call.

**Checklist**

- [ ] Every drag outcome (move column, reorder, reassign) has a menu/sheet
      path with 44 px rows.
- [ ] Column/status is editable from the routed detail surface.
- [ ] The non-drag path works end-to-end with VoiceOver/TalkBack.
- [ ] Drag and non-drag moves share the same optimistic mutation and
      rollback UX.

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

### Attachments & camera capture

The phone is the only device that is *at the scene*: the whiteboard photo,
the broken build on a colleague's screen, the screenshot of the bug. Capture
is a mobile superpower, and the detail surface is where it lands.

- **One tap into the OS-native picker.** Attaching offers camera, photo
  library, and files through the platform's own picker — not a desktop
  dropzone squeezed onto a phone. The camera path matters most: it is the
  reason the attachment exists at all.
- **Upload UX is progressive.** Pick → immediate thumbnail with progress →
  retry on failure. The composer or form stays usable while uploads run;
  a photo never blocks the comment it illustrates.
- **Right-size before the network.** Camera output is multi-MB and the
  network is cellular; downscale/compress client-side before upload, and
  keep the original only when the user asks for it.
- **Reserve thumbnail dimensions.** Arriving attachments must not shift the
  layout (CLS) — same rule as card media (§6).
- **Offline capture queues visibly.** An attachment taken offline joins the
  mutation queue (§15) with a pending state and survives reconnect; a failed
  upload never silently loses the photo.

> `Example (Pulse)`: attachments are a tracked gap — the 2026-05 review
> defers the upload surface to the routed task panel as its host, which is
> the right call: the routed detail sheet (not the legacy modal) is where
> capture belongs when it lands.

**Checklist**

- [ ] Attach opens the OS-native picker with camera, library, and files as
      sources.
- [ ] Uploads show thumbnail + progress + retry; the surface stays usable
      meanwhile.
- [ ] Images are downscaled client-side before cellular upload.
- [ ] Thumbnails have reserved dimensions; no layout shift on arrival.
- [ ] Offline attachments queue visibly and survive reconnect (§15).

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
- **Search inputs get a clear affordance.** `type="search"` on the shadcn
  `Input` gives the native browser clear button — never stack a second custom
  clear control on top of it.

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

### Push-permission priming & quiet hours

The browser permission prompt is a one-shot resource: a denial is
near-permanent, recoverable only through buried browser/OS settings. Treat
it accordingly.

- **Prime before you prompt.** The real permission dialog fires only after
  the user says yes to an *in-product* ask tied to a concrete moment —
  "Alice mentioned you. Want a push next time?" with explicit yes/not-now.
  A cold prompt converts a curious user into a permanent denial.
- **"Not now" is an answer.** Record the soft decline; re-ask only after
  another genuine value moment, and cap the number of re-asks. A user who
  declines twice has answered.
- **Permission is not preference.** Granting push subscribes the user to the
  category they were primed for (mentions), not everything. Per-category
  toggles (mentions, nudges, digests) live in settings, and the notification
  budget above applies per category.
- **Quiet hours are respected server-side.** Non-urgent pushes hold during
  the user's configured quiet window and arrive as a digest after it ends.
  Delivery-time logic lives on the server — a queued buzz at 3 a.m. is the
  product's fault, not the OS's.
- **The badge survives the silence.** During quiet hours the inbox badge
  (§3) still updates; the user who opens the app sees everything without
  having been buzzed.

**Do / Don't**

| Do | Don't |
| --- | --- |
| Prime with an in-product ask at a mention/value moment. | Fire the browser permission prompt cold on first run. |
| Remember "not now" and cap re-asks. | Re-prompt every session until the user relents. |
| Subscribe only the primed category; expose per-category toggles. | Treat one grant as consent to every notification type. |
| Hold non-urgent pushes in quiet hours and digest them after. | Buzz overnight for a low-priority nudge. |

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
  shell (strategy-per-asset mapping:
  `mobile-native-best-practices.md §2.F`) so return visits open instantly and
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

### Offline queue & conflict UX

Queue-and-replay mechanics (Background Sync on Chromium, IndexedDB with
foreground replay on iOS) live in `mobile-native-best-practices.md §2.F`;
desktop graceful degradation (connectivity indicator, queue-where-safe)
is owned by the desktop sibling — see
[`desktop-ux-best-practices.md §11.3`](desktop-ux-best-practices.md).
What the mechanics doc can't decide is how the queue *feels*. Principles:

- **The queue is visible, not magic.** A mutation made offline shows a
  pending state (a subtle sync glyph on the card, "Saving…" on the form),
  and an unobtrusive connection indicator explains why. Silent queues make
  the eventual conflicts inexplicable.
- **Replay is ordered and idempotent.** Queued mutations replay in the order
  they were made; the runtime's idempotency gate ensures a retried replay
  never double-applies. Partial replay failures surface per-item, not as
  one opaque "sync failed."
- **Conflicts get UX, not silent policy.** Last-write-wins is acceptable
  only for trivially re-editable single fields (status, assignee). For
  content edits (comments, descriptions), a write that collides with a
  teammate's offline-window change surfaces a resolution choice — "Alice
  edited this while you were offline: keep mine / take theirs" — and the
  user's text is never destroyed without a copy to recover.
- **Stale entries expire honestly.** A queued mutation that outlives its
  usefulness fails *visibly* with a re-apply affordance; it never just
  vanishes from the queue.
- **Reads degrade with a timestamp.** Cached board views render offline
  marked with data age ("as of 09:14"); queued-but-unsynced edits are
  visually distinct from synced state.

> `Example (Pulse)`: optimistic mutations are wired via `useReactMutation`;
> a persisted offline queue is not yet implemented — when it lands (per
> `mobile-native-best-practices.md §2.F`), the conflict and visibility
> rules here are its acceptance criteria.

**Checklist**

- [ ] Queued mutations show a pending state; connection status is
      discoverable at a glance.
- [ ] Replay is ordered and idempotent; per-item failures surface
      individually.
- [ ] Conflicting content edits offer keep-mine / take-theirs; no user text
      is destroyed without recovery.
- [ ] Expired queue entries fail visibly with a retry path.
- [ ] Offline reads show data age; unsynced edits are visually distinct.

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
| **WCAG 2.2** | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — esp. [SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), SC 2.4.11 Focus Appearance, SC 2.3.3 Motion from Interactions | Target size, focus visibility, reduced motion, drag alternatives (§6). |
| **W3C ARIA** | [WAI-ARIA — Live Regions](https://www.w3.org/TR/wai-aria/#aria-live) | Accessible live regions for streamed/async content. |
| **Material 3** | [Material Design 3](https://m3.material.io/) ([M2 touch-target](https://m2.material.io/develop/web/supporting/touch-target)) | 48 dp touch target, density guidance, adaptive/large-screen layout (§2). |
| **Apple HIG** | [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 44 pt hit target, thumb reach, safe areas, undo conventions (§5). |
| **Atlassian Design System** | [Atlassian Design System](https://atlassian.design/) | Kanban/board patterns, issue-detail conventions, empty states. |
| **Linear / Jira / Asana patterns** | [Linear](https://linear.app/features), Jira, Asana | Command palette, board/list parity, saved views. |
| **web.dev / Core Web Vitals** | [web.dev](https://web.dev/) — [INP](https://web.dev/articles/inp), [LCP](https://web.dev/articles/lcp), [CLS](https://web.dev/articles/optimize-cls), [2025 Web Almanac](https://almanac.httparchive.org/en/2025/performance) | Mobile performance budgets and thresholds; push-permission UX patterns (§10); PWA OS-integration guidance (§3). |
| **FIDO / passkeys** | [FIDO Alliance UX guidelines](https://fidoalliance.org/ux-guidelines/), [web.dev — Passkeys](https://web.dev/articles/passkey-registration) | Passkey-first entry, conditional UI, fallback ordering (§4). |

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
