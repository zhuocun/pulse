# 06 — Visual / Playwright screenshot audit

> **Point-in-time snapshot (2026-05).** This is a frozen per-surface source report behind [`ui-ux-comprehensive-review-2026-05.md`](../ui-ux-comprehensive-review-2026-05.md); component names and `file:line` references are correct as of the 2026-05 audit and are preserved as history, not a live task list. For current status see [`../../todo/ui-todo.md`](../../todo/ui-todo.md).

## TL;DR

The look is calm, premium, and brand-consistent across light/dark and every viewport — the orange-on-warm-white palette, the rounded card system, and the Inter typography all land. There is one foundational rendering bug that affects every viewport (the page scroller is `body`, not `html`, so `window.scrollY` is permanently `0`); one mobile-blocking layout problem (the projects list and the AI chat drawer leak large empty regions because they don't fill the now-detached body scroller); a copy/state bug in the project modal that says **"Edit project"** when the user clicked **"Create project"**; and a cluster of mobile-only polish issues (truncated stat labels, wrapping drawer titles, sparse mobile chat). The board is in great shape on every viewport; the auth pages look excellent in both themes. Total cost-to-fix on the top issues looks small.

## Capture matrix (routes × viewports × states actually captured)

30 screenshots, `docs/design/_review-2026-05/screenshots/`. Naming: `<route-slug>__<viewport>__<scheme>.png`.

| Surface                        | iPhone SE | iPhone 13 (light) | iPhone 13 (dark) | Pixel 7 | iPad portrait | iPad landscape | Desktop (light) | Desktop (dark) | Wide |
| ------------------------------ | --------- | ----------------- | ---------------- | ------- | ------------- | -------------- | --------------- | -------------- | ---- |
| /login                         | yes       | yes               | yes              | —       | —             | —              | yes             | —              | —    |
| /register                      | —         | yes               | —                | —       | —             | —              | yes             | —              | —    |
| /auth/forgot-password          | —         | yes               | —                | —       | —             | —              | —               | —              | —    |
| /projects (list)               | yes       | yes               | yes              | yes     | yes           | yes            | yes             | yes            | yes  |
| Project modal (create flow)    | —         | yes               | —                | —       | —             | —              | yes             | —              | —    |
| /projects/:id/board            | —         | yes               | —                | —       | yes           | —              | yes             | yes            | yes  |
| Task modal (board)             | —         | yes               | —                | —       | —             | —              | yes             | —              | —    |
| Board brief drawer             | —         | —                 | —                | —       | —             | —              | yes             | —              | —    |
| Command palette (Cmd+K)        | —         | —                 | —                | —       | —             | —              | yes             | —              | —    |
| AI chat drawer (Ask)           | —         | yes               | —                | —       | —             | —              | yes             | —              | —    |
| 404 NotFound                   | —         | —                 | —                | —       | —             | —              | yes             | —              | —    |

All authed captures cleared the spinner; mocks fulfilled `/api/v1/users`, `/users/members`, `/projects`, `/boards`, `/tasks`, and a default 200 fallback for AI/agents. Mocking lives in `docs/design/_review-2026-05/_capture/capture.mjs`.

## Findings — ranked

### 1. The page is not scrollable via the document scroller (every viewport, every route)

- **Surface + viewport**: all surfaces; most visible on iPhone 13 / iPhone SE / Pixel 7 because the body content actually overflows there. Cross-checked at 1280×800 too.
- **Severity**: critical (foundational)
- **Screenshots**: `screenshots/projects__iphone13__light.png` (no scrollbar despite 5 cards), `screenshots/projects__iphoneSE__light.png` (same), and the symptom is visible everywhere as below-the-fold content invisible without my workaround.
- **Evidence (probed live with `page.evaluate`)**: at viewport 390×844 on `/projects`, `document.documentElement.scrollHeight === 844`, `document.body.scrollHeight === 1445`, `#root.scrollHeight === 1445`. `window.scrollTo(0, 5000)` leaves `window.scrollY === 0`; mouse-wheel and touch-drag scroll happen on `document.body` (`body.scrollTop` becomes non-zero) but the document scroller never moves. Same shape at 1280×800: `doc.sh=800`, `body.sh=831`, `body.scrollTop` moves on wheel, `window.scrollY` stays 0.
- **Root cause**: `src/App.css:69-78` sets `overflow-x: hidden` on **both** `html` and `body`. Per CSS overflow spec the implicit `overflow-y: visible` is promoted to `overflow-y: auto`, which establishes a scroll container on **html and body simultaneously**. Body becomes the document scroller (height pinned to viewport, content overflows internally), html is locked to viewport height, and `window.scrollY` no longer reflects the user's actual scroll position. Sticky observers, `IntersectionObserver({root: null})`, scroll-restoration on `react-router` navigation, `pageYOffset`-based animations, and Playwright `fullPage` screenshots all silently misbehave.
- **Proposed fix**: lift `overflow-x: hidden` off `html` and keep it only on `body` *or* move it onto a single inner wrapper (e.g. `#root` or `body > .app`). Audit any component that reads `window.scrollY` / `window.pageYOffset` — they're all sampling a phantom value today.

### 2. Project list and AI chat drawer leak large empty regions on mobile

- **Surface + viewport**: `/projects` on iPhone SE / iPhone 13 / Pixel 7; AI chat drawer on iPhone 13.
- **Severity**: high
- **Screenshots**: `screenshots/projects__iphone13__light.png`, `screenshots/projects__iphoneSE__light.png`, `screenshots/ai-chat-drawer__iphone13__light.png`.
- **Evidence**: with the workaround in place we now render all 5 project cards on phone — but compare with iPad portrait (`screenshots/projects__ipadPortrait__light.png`) where the grid still has comfortable density. On phone the search panel + filters stack into ~340 px of toolchain before the first card; the cards themselves are reasonable, but the AI chat drawer (also on phone) is the most striking case: between the "Sessions are not saved" line and the input pinned at the bottom there is ~900 px of empty space.
- **Proposed fix**: the chat drawer should use `flex: 1` content (suggestions/messages) with the input as a sticky bottom rail — today the input is bottom-pinned but the suggestion area sits at the top of a fixed-height block. The same idea on `/projects`: collapse the stat rail to a single row at < 480 px (it's already a 3-col grid, but the icon+label stack adds vertical bulk for very little signal).

### 3. "Create project" CTA opens a modal titled "Edit project"

- **Surface + viewport**: `/projects` (both phone and desktop) when the user clicks the primary "Create project" button.
- **Severity**: high (copy/state mismatch — exact heuristic this project's own AI-UX doc calls out: "honest capability framing")
- **Screenshots**: `screenshots/projects-modal-create__desktop__light.png`, `screenshots/projects-modal-create__iphone13__light.png`.
- **Evidence**: the modal header reads **"Edit project"** and the subtitle reads **"Update project details and assignment."** Submit button reads **"Save"** (the editing variant), not **"Create project"** (the creating variant).
- **Root cause**: `src/components/projectModal/index.tsx:24` derives `isEditing = Boolean(editingProject)`. `editingProject` comes from `useReactQuery<IProject>("projects", { projectId: editingProjectId })` (see `src/utils/hooks/useProjectModal.ts:45-52`). The `enabled` flag is `Boolean(editingProjectId)`, so the network call is skipped when no project is being edited — **but the hook still returns data from the cache under the key `["projects", filterRequest({projectId: null})]`**, which `filterRequest` collapses to roughly `["projects", {}]`. That key collides with the page-level list query `useReactQuery<IProject[]>("projects", { projectName, managerId })` which under empty filters stores the full list at the same `["projects", {}]` key. The hook reads an array back from the cache, `Boolean(array)` is `true`, and the modal flips to edit mode.
- **Proposed fix**: gate the data return on the same boolean: `const editingProject = editingProjectId ? data : undefined;` — or use a parametric cache key only when the id is defined, e.g. add `specialQueryKey = ["editingProject", editingProjectId]`. The fix is one-line either way, but it deserves a regression test (`isEditing` should be false when the create CTA opens the modal in a session that already loaded the list).

### 4. AI chat drawer title wraps on phone — uneven suggestion chip styling

- **Surface + viewport**: AI chat drawer at iPhone 13.
- **Severity**: medium
- **Screenshot**: `screenshots/ai-chat-drawer__iphone13__light.png`.
- **Evidence**: the drawer header reads "Ask Board / Copilot" on two lines because the icon + title + engine-mode `Select` + info icon + plus icon eat the entire 390 px row. The first suggestion ("What's at risk on this board?") renders as a pill chip; the other two ("Who has the most open tasks?", "Summarize this board") render as plain plaintext links — inconsistent with the pill above and with the spec ("each suggestion is a chip the user can tap").
- **Proposed fix**: drop the engine-mode `Select` from the header on phone (move to the kebab in the corner, or to settings), reserve a single line for "Ask Copilot". Render all three suggestion items with the same chip styling — currently only the active/keyboard-highlighted item gets the chip background.

### 5. Stat-card label truncation on phone-class viewports

- **Surface + viewport**: `/projects` on iPhone SE (375 px) and iPhone 13 (390 px).
- **Severity**: medium
- **Screenshots**: `screenshots/projects__iphoneSE__light.png`, `screenshots/projects__iphone13__light.png`.
- **Evidence**: the centre "ORGANIZATIONS" label ellipses to "ORGANIZATI…" on iPhone SE, and to "ORGANIZATIO…" on iPhone 13. There's a clamp at `src/pages/project.tsx:218-225` for narrow viewports, but it isn't kicking in (the label still ellipses). The label-stacking logic for "TEAM MEMBERS" works, so this is specifically the single-token wrap rule failing for "ORGANIZATIONS".
- **Proposed fix**: lower the breakpoint or accept a smaller font size at ≤ 392 px so the longest single-token label fits. Alternative: shorten the label to "ORGS" on phone (matches the compactness of the icon-stacked treatment) and pair it with an `aria-label` on the card that reads the full word.

### 6. Header "Members" cluster reads as visual noise on every viewport

- **Surface + viewport**: header on every viewport.
- **Severity**: low (perception, not function)
- **Screenshots**: `screenshots/projects__desktop__light.png`, `screenshots/projects__iphone13__light.png`, `screenshots/board__wide__light.png`.
- **Evidence**: the header's left cluster after the brandmark reads `Members  AC BP CD  5  ▾`. The `AC BP CD` are three overlapping avatar initials, then a `5` pill, then a chevron. The grouping is unclear at first glance — it looks like the avatars *are* the menu and the `5` is decorative, but the whole thing is a single popover trigger. On mobile the chevron is even smaller and the icon-only icon on the left of `AC BP CD` is unlabeled (it appears to be a people-group icon, but it crashes into the avatar group with no whitespace).
- **Proposed fix**: keep one of {label, icon, avatar-stack, count} and drop the rest. The mature pattern is "icon + count" or "avatar-stack + count" — both, plus the standalone label, is over-specified.

### 7. Board brief drawer pushes board content under it instead of next to it (desktop)

- **Surface + viewport**: board brief drawer at desktop (1280 × 800).
- **Severity**: low — but worth a redesign pass
- **Screenshot**: `screenshots/board-brief-drawer__desktop__light.png`.
- **Evidence**: when the brief drawer slides in from the right at 1280 px, the board columns reflow into the remaining ~700 px but the "Code review" and "Done" columns are cut off mid-card with no horizontal scroll indicator. The drawer is also wider than necessary for what's mostly summary text + a single CTA-less suggestion card.
- **Proposed fix**: cap the brief drawer at ~360 px on desktop (it's pure prose, not a workspace), and make the board kanban respect "the drawer ate 360 px" by keeping its horizontal scroll affordance visible. Or pin the brief drawer as a dismissable side panel at < 1440 px and overlay-only at < 1024 px.

### 8. Task modal on phone — destructive "Delete" sits below "Cancel"

- **Surface + viewport**: task detail modal at iPhone 13.
- **Severity**: low (real misclick risk for the kind of user who thumbs-up the bottom-right of a modal)
- **Screenshot**: `screenshots/board-task-detail__iphone13__light.png`.
- **Evidence**: the modal stacks Save (primary, orange) → Cancel (neutral) → **Delete (red)** vertically. Putting a destructive verb directly below the dismiss button — without a confirmation step — invites accidental destructive taps after a "Cancel" mis-tap. The desktop version (`board-task-detail__desktop__light.png`) puts Delete on the far left, separated from Cancel/Save, which is the correct pattern.
- **Proposed fix**: on phone, either move Delete to a kebab/overflow menu in the header, or keep it at the bottom but require a long-press or a confirmation alert.

### 9. Board copilot welcome banner takes 130 px of vertical real estate on phone

- **Surface + viewport**: `/projects/:id/board` at iPhone 13.
- **Severity**: low
- **Screenshot**: `screenshots/board__iphone13__light.png`.
- **Evidence**: the "Board Copilot is ready" banner with two CTAs ("Try: Summarize this board" + "Dismiss") consumes the top quarter of the viewport before the board title and filters even appear. The same banner is far less intrusive on desktop (one row).
- **Proposed fix**: collapse to a single-line nudge with a sparkle icon + "Try Copilot" link on phone; keep the descriptive copy for desktop only.

### 10. The "Swipe to see more columns" hint stays visible after first scroll

- **Surface + viewport**: `/projects/:id/board` at iPhone 13.
- **Severity**: low
- **Screenshot**: `screenshots/board__iphone13__light.png` (visible in the middle of the kanban area).
- **Evidence**: the hint is a fixed pill at the top of the columns container. After the user has swiped once and seen another column, the hint should fade — today it persists.
- **Proposed fix**: hide on first horizontal scroll (sessionStorage flag), or run a one-shot intro tooltip.

## Patterns / themes

- **Brand identity is on point** in every theme and viewport. The orange-on-warm-white palette is calm; the dark mode keeps warm contrast; the auth marketing column has personality without screaming.
- **The mobile experience is 90% there but the last 10% is the part the user will hit first.** Every blocker above is on the small viewport (chat drawer empty space, stat label truncation, banner footprint, swipe hint persistence, modal-action ordering). All of them are quick fixes; none require a redesign.
- **The "ant" CSS variable wiring is correctly cascading dark mode** to the entire chrome (header, modals, drawers, cards). Easy to take for granted, easy to break — worth a snapshot test.
- **Animations and reduced-motion respect appear intact** — captures with `animations: "disabled"` showed no half-rendered transitions or stuck modal openings.
- **Several screens have small "info" / "?" icons in headers** (board, AI brief, chat drawer). On mobile they take valuable real estate; consider folding them into the kebab.

## Things that look great (worth keeping)

- The login marketing column on desktop (`login__desktop__light.png`) — a strong "calm focus" frame, three concrete value props, no buzzwords.
- The board on every viewport ≥ 1024 px — columns are well-balanced, the kanban breathes, header chips ("Copilot", "Brief", "Ask") read as a coherent AI tier.
- The dark mode of the board (`board__desktop__dark.png`) — backgrounds are warm-dark rather than slate-cold, which keeps brand identity through theme switch.
- The 404 / not-found page is tasteful and short. Don't change it.
- The command palette (`command-palette__desktop__light.png`) — clean two-line layout per row, hover state on the first project is visible, sections (PROJECTS / MEMBERS) are clearly typeset.
- The auth-error styling and the form field focus rings (visible on the task-name input in `board-task-detail__desktop__light.png` and password input in `login__iphone13__dark.png`) are consistent across the app.

## What couldn't be captured (note any flaky routes / broken auth / missing mocks)

- **Hover / focus / drag-active states on board cards** — Playwright can `hover()` but the project's main hover affordance is the kebab menu opening and the avatar tooltip, which need explicit interaction; captured the task-edit modal instead, which is a richer signal.
- **Drag-and-drop in flight** — `@hello-pangea/dnd` requires a real pointer drag sequence and a measurable settle time; out of scope for this pass.
- **Empty list / loading skeleton on `/projects`** — would have required toggling the mock to delay or return `[]`; I prioritized populated states because the layout bugs only surface with data. The empty state file lives at `src/i18n/locales/en.ts:354-358` (`"No projects yet"` + cta).
- **Error states on the projects page** — the page renders an `<Alert>` above the grid when fetch fails; not captured because the mock layer is deterministic 200s.
- **Real-device PWA experience** (status-bar tint, safe-area insets, home-indicator clearance) — Playwright emulation is enough to verify CSS but not safe-area inset behavior; would need iOS Simulator.
- **Forgot-password desktop view** — single capture on iPhone 13 only; the layout is centred and likely fine on desktop but not formally verified.
- **The mobile project list initially captured at viewport height only** (clipping issue described in finding #1). I worked around it by resizing the Playwright viewport to body.scrollHeight before each shot; the underlying scroll bug is the real issue, not the capture method.
