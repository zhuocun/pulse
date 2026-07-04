# Pulse · Comprehensive UI/UX review · 2026-05

## At a glance

Pulse is a confident-looking React 19 + AntD + Emotion app with a calm orange-on-warm-white identity that survives dark mode, a token system that's 87% clean, and an AI stack of 19 Copilot components that, on paper, covers the whole agentic loop. The brand and the foundation are real. What's holding the app back is not its taste — it's six recurring structural problems: a kanban whose data model can't answer "what's due?", a Copilot that ships three competing entry points on the same header row, an auth/PWA shell that reads like 2018, a task editor that's a centered modal even on phones and silently discards in-flight edits, a project list whose primary CTA opens with the title "Edit project", and a global stylesheet that has detached `window.scrollY` from the document on every viewport. Fix the bugs this sprint, collapse the IA next month, and the foundation is good enough to host the ambitious moves (CopilotDock, bottom tab bar, routed task panel, passkey-first auth, AI ledger) that turn Pulse from "responsive web app" into "the AI-native PM tool on this phone."

| Metric | Value |
|---|---|
| Findings consolidated | 124 across 6 surface reports |
| Screenshots audited | 30 PNGs (5 viewports × light/dark × 8 surfaces) |
| Token coverage | 87% clean; 13% concentrated in 6 files |
| Critical / "ship-blocking" bugs | 7 |
| High-leverage ambitious redesigns | 8 |
| Quick-win fixes | 20 |
| Lines of AI-surface code reviewed | ~7,000 (19 components) |

---

## The five biggest things to fix or change

### 1. Routed inline task panel (kill `TaskModal`)

**What it is.** Replace the 630-LOC centered `TaskModal` with a route-driven detail panel: `/projects/:projectId/board/task/:taskId`. Phones get a bottom sheet, tablets a right-side drawer, desktops a docked 480 px right rail that re-flows the columns.

**Why it matters.** Today the task editor (a) silently discards unsaved edits when the underlying task disappears (`taskModal/index.tsx:248-259`), (b) breaks browser back, (c) caps body height with `calc(100dvh - 320px)` that ignores the iOS keyboard (`taskModal/index.tsx:422-424`), and (d) stacks Save → Cancel → **Delete** vertically on phones (`screenshots/board-task-detail__iphone13__light.png`). One move kills five bugs and unlocks swipe-between-tasks, deep links, and "open in new tab."

**1-2-3.** (1) Add the route and a `useBlocker` dirty-form guard. (2) Move `TaskModal`'s `<Form>` body into `<TaskDetailPanel>` with shell `AntD Drawer placement={isPhone ? "bottom" : "right"}`. (3) Delete the Redux `taskModal` slice and the footer-flip-on-mobile special case.

**Effort + risk.** **M-L**, ~1 week. Risk: dirty-state confirm needs `useBlocker` from React Router 7.

### 2. CopilotDock — one Copilot surface, four tabs

**What it is.** Collapse `AiChatDrawer` + `BoardBriefDrawer` + (future) Inbox + Settings into a single tabbed right-edge dock. One consent notice, one privacy popover, one engine-mode tag, one welcome banner. Phones get a full-height bottom sheet with the tabs as a segmented control.

**Why it matters.** Today the board header renders **three** AI entry points side-by-side: a `CopilotMenu` dropdown (`pages/board.tsx:636-682`), a duplicate `Space.Compact` Brief+Ask row (`:684-714` — already labeled `/* P1-A: Consolidate into CopilotMenu in next phase */`), and a Settings cog (`:717-781`). The two drawers can't be open simultaneously and each owns its own `EngineModeTag` (visible in 5 places). The unified dock trains users that Copilot is one product instead of five.

**1-2-3.** (1) Extract `<ChatTabBody>` and `<BriefTabBody>` as pure components. (2) Build `<CopilotDock>` as a tabbed shell that mounts both. (3) Delete the legacy `Space.Compact` and the duplicated `EngineModeTag`s; flag-gate the rollout for one release.

**Effort + risk.** **L**, ~3-5 days. Risk: mobile bottom-sheet + keyboard interaction is novel; phased rollout mitigates.

### 3. Bottom tab bar + demoted header

**What it is.** On `pointer: coarse`, demote the 511-LOC sticky header to brand-only, and add a `<nav aria-label="Primary">` at the bottom with four tabs: **Boards · Inbox · Copilot · Profile**. Account/theme/lang/AI-on-off move into `/settings`.

**Why it matters.** Reachability. Every settings interaction (theme, language, AI on/off, logout) currently lives in a 44 px account dropdown at the top-right corner — the worst spot for a thumb. The Redbooth case study cited in `mobile-native-best-practices.md` §B reports +65% DAU and +70% session length after moving primary destinations to a bottom bar. Pulse has the natural destinations but routes everything through `header/index.tsx:436-507`, and `mainLayout.tsx:88-98` has no bottom nav region at all.

**1-2-3.** (1) Build `<BottomTabBar>` (4 tabs, 56×56 hit target, `padding-bottom: env(safe-area-inset-bottom)`, hide on `visualViewport` resize). (2) Carve `/inbox` and `/settings` routes. (3) Trim the phone header from 511 LOC to ~150 LOC.

**Effort + risk.** **M**, ~2-3 days. Risk: tablet portrait is awkward — keep header-only at `min-width: ${breakpoints.md}px`.

### 4. ITask data-model expansion + dynamic cards

**What it is.** Extend `ITask` with `dueDate?: string | null; priority?: 0|1|2|3; labels?: string[]; updatedAt?: string`. Then bring the dead-flat task card and the static `ProjectCard` to life with that signal.

**Why it matters.** Pulse advertises an AI-assisted board, but the AI has nothing to triage against — no due date, no priority, no `updatedAt`. The current card renders title + Bug/Task tag + story points + AI strength + assignee (`column/index.tsx:481-581`). The same poverty propagates to `ProjectCard` (`projectCard/index.tsx:334-455`) — zero dynamic signal: no task count, no last-activity, no member presence. This is the single biggest reason the project list reads as a v1 directory rather than a daily index.

**1-2-3.** (1) Add the four fields server-side and to `ITask`. (2) Add a "facets row" between title and footer on the task card: priority dot + due chip + label dots. (3) Add open-task progress bar + last-activity timestamp + presence dots to `ProjectCard`.

**Effort + risk.** **L**, ~1-2 sprints (mostly backend). Risk: card height growth needs grid-breakpoint tuning at `sm`.

### 5. Ship today's bugs

**What it is.** A one-PR sprint that fixes the seven correctness/copy bugs ship today's build is leaking, before any redesign work: the "Create project" modal opens titled "Edit project" (cache collision); `html { overflow-x: hidden }` detaches the document scroller; `TaskModal` silently discards edits; `FilterChips.onClearAll` is unwired; `TaskCreator` posts canned defaults; `AuthErrorSummary` steals focus on every error update; `LoginForm` doesn't trim email. See the next section for file:line + fix sketch on each.

**Effort + risk.** **S**, all seven in one engineer-day. No risk if regression-tested.

---

## Critical bugs that ship today

The seven from above plus the broader set.

- **"Create project" modal opens titled "Edit project."** Cache-key collision in `useProjectModal` (`utils/hooks/useProjectModal.ts:45-52`) returns the page-level project list array as `editingProject`, so `isEditing = Boolean(editingProject)` flips true on the create CTA. Visible in `screenshots/projects-modal-create__desktop__light.png` and `..__iphone13__light.png`. Fix: gate the data return on `editingProjectId ? data : undefined`, or namespace the cache key. Severity: **High**.
- **`html { overflow-x: hidden }` detaches the document scroller.** `App.css:69-78`. Body becomes the scroller, `window.scrollY` permanently `0`. Sticky observers, `IntersectionObserver({root:null})`, scroll-restoration, `pageYOffset` animations, and Playwright `fullPage` all silently misbehave on every viewport. Fix: lift to `#root` only, or keep on body alone. Severity: **High** — foundational.
- **`TaskModal` discards unsaved edits silently.** `taskModal/index.tsx:248-259` — when `editingTask` flips from defined to undefined while the form is dirty, the modal closes and `form.resetFields()` runs. Fix: check `form.isFieldsTouched()` and surface a sticky banner instead of auto-close. Severity: **High** — data loss.
- **`FilterChips.onClearAll` never wired.** `filterChips/index.tsx:17-23` defines the prop, `:150-154` renders the CTA conditionally, but the only call site (`taskSearchPanel/index.tsx:299`) doesn't pass it. Fix: pass `onClearAll={resetParams}`. Severity: **Medium**.
- **`TaskCreator` writes a canned template under the user's chosen name.** `taskCreator/index.tsx:113-122` sends `type: "Task"`, `epic: "New Feature"`, `storyPoints: 1`, `note: "No note yet"`. Every follow-up edit is undoing defaults. Fix: send only user-supplied fields. Severity: **High**.
- **`AuthErrorSummary` focus thrash.** `authErrorSummary/index.tsx:80-84` — `useEffect` depends on `fieldErrors.length`, so mid-type validation re-focuses the summary container, dismissing the iOS keyboard. Fix: focus on `visible: false→true` transition only. Severity: **Medium-High** a11y.
- **`LoginForm` does not trim email.** `loginForm/index.tsx:64` vs `registerForm/index.tsx:54-55`. iOS Safari pastes trailing spaces. Fix: `email: input.email.trim().toLowerCase()`. Severity: **Medium**.
- **Chat composer textarea disables itself during streaming.** `aiChatDrawer/AiChatComposer.tsx:41` — `disabled={isLoading}`. Violates the team's own best-practices doc §2.1. Fix: drop `disabled`; gate `dispatch` instead. Severity: **High** for chat UX.
- **Composer Enter handler ignores IME composition.** `AiChatComposer.tsx:46-51`. Chinese/Japanese/Korean users have their first commit-Enter sent instead of selecting the candidate. Fix: add `!e.nativeEvent.isComposing`. Severity: **High** for affected locales.
- **Mutation proposal `onUndo` never wired in chat.** `mutationProposalCard/index.tsx:374-382` only renders post-commit Undo when `proposal.undoable && typeof onUndo === "function"`, but `aiChatDrawer/index.tsx:1874` never passes `onUndo`. Even `undoable: true` actions strip the escape hatch. Severity: **High** for reversibility.
- **Service Worker has no update message channel.** `public/sw.js:21-28` `skipWaiting`s only at install; `src/index.tsx:165-176` doesn't listen for `updatefound`/`controllerchange`. Deployed updates require a hard reload. Fix: drop `skipWaiting` from `install`, add a `message` listener, post `{ type: 'SKIP_WAITING' }` from a "New version available" toast. Severity: **High** — silent staleness.
- **`apple-touch-icon.svg` is SVG.** `index.html:33`. iOS ignores SVG `apple-touch-icon` and falls back to a blurry page screenshot on Add-to-Home-Screen. Fix: ship PNGs at 180/167/152/120. Severity: **High** — visible install regression.
- **`StatRail` blanket `aria-hidden={pLoading}`.** `pages/project.tsx:340`. Hides the entire stats region from AT during load. Fix: `aria-busy` + a single `role="status"` announcement. Severity: **Medium** a11y.
- **`MemberPopover` is an orphan, never mounted.** `src/components/memberPopover/index.tsx` is a complete 167-LOC component not imported anywhere on the board. Users have no in-board way to see the team. Severity: **Medium**.
- **Single-tab `Tabs` row on project detail.** `pages/projectDetail.tsx:166-175, 244`. 50 px of sticky chrome with one always-active link; a `useEffect` at `:206-211` force-redirects everything else into `/board`. Fix: delete until a real second tab exists. Severity: **Medium** chrome.
- **`aiSparkleIcon` default `aria-label="Board Copilot"` leaks into accessible names.** `aiSparkleIcon/index.tsx:99-106`. Decorative uses that forget `aria-hidden` produce SR output like "Board Copilot, Ask Board Copilot." Fix: discriminated-union props (either `aria-hidden: true` or explicit `aria-label`). Severity: **Medium** a11y.
- **`pages/home.tsx` wraps layouts in a dead `<div>` and double-redirects.** `home.tsx:23` + `authLayout.tsx:24-28`. Routes fire twice on cold load. Fix: delete `pages/home.tsx`; use `<RequireAuth>`/`<RequireGuest>` wrappers at the route level. Severity: **Medium**.

---

## Cross-cutting patterns

Themes that surface across multiple reports — fix one, fix many.

1. **Five doors into AI on a single viewport.** Board header has CopilotMenu + duplicate `Space.Compact` + Settings cog (`board.tsx:631-782`); plus `aiSearchInput`'s sparkle prefix, the `"/"` palette mode, two standalone drawers. Reports 02·F1, 04·F13/F14/F16, 06·#4. → CopilotDock (Ambition A1).

2. **Modal-as-default vs routed inline panel.** `TaskModal`, `ProjectModal`, `AiTaskDraftModal` are all centered modals even on phones, where they pin Save/Cancel/Delete in a stack with the destructive verb adjacent to the dismissal. Reports 02·F3, 03·F1/F4/F9, 06·#8. → Routed task panel (A2); bottom sheets elsewhere.

3. **URL-state vs Redux-state regression.** PR #226 moved overlay state to Redux to fix an iOS Safari bug, but the back gesture, deep links, and share-this-task URLs all paid the bill and the bill was never refunded (`_createOverlayHook.ts:12-30`). → Routed task panel (A2) re-pays it.

4. **aria-live regions copy-pasted with drift.** Six surfaces own a hand-rolled `clip: rect(0 0 0 0)` sr-only live region. Two import the helper, four don't. → A single `<SrOnlyLive>` primitive (Quick win 13).

5. **Token coverage drift in six files.** `column/index.tsx` 8-color status palette + bug/task hex (`:281-292, :393-401`); `filterChips:80` raw `rgba(234, 88, 12, 0.18)`; `emptyState:53` same; `projectCard:59` raw shadow; `brandMark:69` raw white inset; `userAvatar:67` raw `#ffffff`. Palette swap leaves them stranded. → Extend `palette` to carry `statusDotColors` + `tag.bug`/`tag.task`; export `shadow.cardHover` + `accent.bgStrong`.

6. **Keyboard-height math missing on all phone modals.** `taskModal:422-424`, `projectModal:146-148`, `aiTaskDraftModal:461` all hard-code `calc(100dvh - 220px|320px)` and never subtract `env(keyboard-inset-height)`. When the keyboard opens, the footer is below the fold. → Add the env subtraction now; convert to bottom sheets (A2) eventually.

7. **No bottom navigation anywhere.** `mainLayout.tsx` has no `<nav>` region; only landmark is `<main>`. Mobile reachability is entirely top-edge. → Bottom tab bar (A3).

8. **`EngineModeTag` repeats in 5 drawer headers.** All show the same global flag; trains users to ignore. → Surface once in app chrome (Phase 2 cleanup).

9. **Three places redirect the same auth predicate.** `RootRedirect` in `routes/index.tsx:38-45`, `HomePage` in `home.tsx:15-21`, `LoginPage` in `login.tsx:28-30`. → Centralise in `<RequireAuth>`/`<RequireGuest>` wrappers.

10. **Three frosted/translucent layers stack on top of each other on mobile.** Page header + project-detail TopBar (`projectDetail.tsx:52-54`) + BoardHeader + search panel = four horizontal rails before the first card (`screenshots/board__iphone13__light.png`). → Kill the single-tab TopBar; merge breadcrumb into BoardHeader on phones.

---

## Per-surface highlights

### Auth — `01-auth-and-projects.md`

Auth is technically careful but conceptually 2018: email + 8-char password + a `Forgot password` link to a 21-LOC dead-end (`forgotPassword/index.tsx:5-20`). No passkey, no magic-link, no SSO. The `pages/home.tsx` shim wraps every routed layout in a stray `<div>` that breaks `min-height: 100dvh` (`home.tsx:23`). `AuthErrorSummary` steals focus on every render where `fieldErrors.length` changes (`authErrorSummary/index.tsx:80-84`). `LoginForm` doesn't `.trim()` the email (`loginForm/index.tsx:64`) but `RegisterForm` does. `AuthLayout` has no skip-link (`authLayout.tsx:325-371`) even though `MainLayout` ships one. Document titles read bare "Log in" instead of "Log in · Pulse". The hero copy is the only differentiated chrome between Pulse and any AntD-templated competitor — but on mobile the hero rail disappears entirely (`authLayout.tsx:62-65`), leaving an AntD card with a 36 px wordmark (`screenshots/login__iphone13__light.png`). Ambitious move: Passkey-first auth (A5).

### Projects list — `01` §F14-F30

A solid baseline that plays its biggest card too small. `StatRail` takes a full row of vertical chrome for three context-free numbers; on iPhone SE the centre label ellipses to "ORGANIZATI…" (`screenshots/projects__iphoneSE__light.png`). `ProjectCard` shows zero dynamic signal — no task count, no last-activity, no member presence (`projectCard/index.tsx:334-455`). The Like affordance has no functional effect beyond a sort key. Sort is a borderless `<Select>` that reads as a label rather than a control (`projectList/index.tsx:282-297`). The "More" dropdown wraps a `<button>` inside `MenuProps.items[].label` (`projectCard/index.tsx:282-331`) — three `stopPropagation` calls papering over the bad AT tree. `AiChatDrawer` mounts unconditionally on every projects page paint (`pages/project.tsx:434-445`). Ambitious move: Sectioned daily index — Pinned → Recent activity → All (A6).

### Board — `02-board-and-project-detail.md`

Strong mobile boilerplate (snap-scroll, dvh, safe-areas, 16 px input, 44 px drag-handle). But the product surface is showing the seams: three AI buttons stacked in the header (F1), `FilterChips.onClearAll` built but not wired (F2), one-tab `Tabs` row (F5), no virtualization on tasks-per-column (F7), `MemberPopover` is an orphan (F8), filters silently disable drag with no visual feedback (F6), and a swipe hint that persists after first scroll (F11, visible in `screenshots/board__iphone13__light.png`). The card itself is information-poor (F4). Ambitious moves: Lenses + swimlanes + save-as-view (A7); routed task panel (A2).

### Modals + forms — `03-modals-and-forms.md`

Solid input ergonomics (`inputMode`/`enterKeyHint`/`autoComplete` everywhere; 16 px on coarse pointers). But every detail/edit surface is a centered AntD `Modal` even on phones. Top hits: `TaskModal` discards in-flight edits (#1), `TaskCreator` posts a hard-coded template (#2), no browser-back-to-close on any modal (#4), `ProjectModal` keeps stale state between create/edit cycles (#5), `formTick` ref where `Form.useWatch` belongs (#6), `ProjectModal` has no Delete on mobile (#7), validation timing asymmetric across forms (#8), modal viewport math ignores `env(keyboard-inset-height)` (#9). Ambitious move: routed task panel (A2).

### AI / Copilot — `04-ai-copilot.md`

19 components covering the full agentic loop; reads as five competing AI surfaces rather than one Copilot. Top trust/correctness issues: composer disables textarea during streaming (F1), mutation `onUndo` never wired (F2), `aria-live` drift across 6 surfaces (F3), `aiSparkleIcon` default aria-label leakage (F4), no-source caveat fires on chit-chat turns (F5), citation chip flag trapped inside hover tooltip (F6), composer ignores IME composition (F7), `role="alertdialog"` on inline-rendered card (F9), `EngineModeTag` repeated 5x (F16), welcome banner CTA opens brief instead of chat (F11). Ambitious moves: CopilotDock (A1) + AI Inbox + activity ledger (A8).

### PWA / mobile / a11y / design system — `05-pwa-mobile-a11y-designsystem.md`

Aspiring PWA whose installed UX is fictional. SW has no update message channel (#1) — deployed updates require hard reload. `apple-touch-icon.svg` is SVG which iOS ignores (#2). Header is 511 LOC of mobile-shell responsibility crammed into sticky chrome (#4). SW falls through to `staleWhileRevalidate` for unclassified same-origin requests (#5). Inter loaded via blocking `@import` in `App.css:8` (#7). No `beforeinstallprompt` capture (#8). No bottom tab bar (#9). No `<nav>` landmark (#11). The token system itself is excellent — palette swap is one line — but `var(--ant-color-*)` fallbacks bake light-mode hex into every styled component (#17). Ambitious moves: bottom tab bar (A3), PWA install + update lifecycle (A4).

### Screenshot audit — `06-screenshot-audit.md`

The look is calm, premium, and brand-consistent across light/dark and every viewport — the auth marketing column (`login__desktop__light.png`), the warm dark board (`board__desktop__dark.png`), and the command palette all land beautifully. The blockers are mobile-only and small: detached document scroller (foundational), "Create project" → "Edit project" copy bug, large empty regions in chat drawer on phone (`ai-chat-drawer__iphone13__light.png`), "ORGANIZATIONS" stat label truncation (`projects__iphoneSE__light.png`), task modal phone footer order (`board-task-detail__iphone13__light.png`), Copilot welcome banner 130 px footprint (`board__iphone13__light.png`), swipe hint persists after first scroll. All quick fixes; none require a redesign.

---

## Ambitious redesigns (the big swings)

### A1 — CopilotDock: one Copilot, four tabs

**Status quo.** Five doors into AI on one viewport: `CopilotMenu` (`board.tsx:636-682`), duplicate `Space.Compact` "Brief / Ask" cluster (`:684-714`, flagged in-code as `/* P1-A: Consolidate into CopilotMenu in next phase */`), Settings cog (`:717-781`), `aiSparkleIcon` prefix inside `AiSearchInput`, and the `"/"` palette mode. Plus two right-edge drawers (`AiChatDrawer` 2115 LOC, `BoardBriefDrawer` 952 LOC) that cannot be open simultaneously. Each owns its own consent notice, privacy popover, engine-mode tag, welcome banner.

**Proposed direction.** A single `<CopilotDock>` with an AntD `Tabs` row — **Chat · Brief · Inbox · Settings**. Hosts existing chat + brief content as `<ChatTabBody>`/`<BriefTabBody>` (refactor — don't duplicate). Desktop: 420 px persistent right shelf, collapsible to a 48 px icon rail at `<lg`. Mobile: full-height bottom sheet with the tabs as a segmented control. The board header shows **one** sparkle launcher with an unread badge for Inbox nudges. Welcome banner becomes the dock's first-open hero — kills the 130 px banner footprint in `screenshots/board__iphone13__light.png`.

**Why it pays off.** Removes the five-doors problem in one move. Lets users keep brief visible while asking chat questions about it. Unblocks Inbox as a destination (A8), the activity ledger, and readiness pills. Trims ~120 LOC of board-header chrome.

**Risk + tradeoffs.** Big refactor — touches both drawers' test suites (~10 files). Mobile bottom-sheet + keyboard interaction is novel. Mitigation: extract pure body components first; mount in parallel inside both the new dock and the old drawers for one release behind a flag; delete the old drawers after rollout.

**Effort.** **L** — 3-5 dev-days; phased rollout over two releases.

**Sequencing.** Unlocks A8 (Inbox + ledger). Ship after Phase 2 AI cleanup.

### A2 — Routed inline task panel (replace `TaskModal`)

**Status quo.** Every card open punches into a centered AntD `Modal` (`taskModal/index.tsx:322-429`), 630 LOC. Phone footer stacks Save / Cancel / **Delete** vertically. Body capped at `calc(100dvh - 320px)` without `env(keyboard-inset-height)` (`:424`). URL doesn't change on open; browser back exits the route. iOS swipe-back navigates away with unsaved edits. If the editing task disappears mid-edit, the modal closes and edits are discarded (`:248-259`). PR #226 (Redux migration) accepted the "back gesture and deep links break" trade-off but never paid back.

**Proposed direction.** Move state into the URL: `<Route path="/projects/:projectId/board/task/:taskId" element={<TaskDetailPanel />} />`. Desktop ≥ `lg`: 480 px right rail next to the board (columns re-flow). `md` to `lg`: 90vw drawer from the right. Phones: AntD `Drawer placement="bottom"`. Board stays mounted as a layout route. Footer respects `env(keyboard-inset-height, 0px)`. Dirty-form guard via `useBlocker` from React Router 7. `autoFocus` only on tablet+. Swipe-to-next threads `nextTaskId` / `prevTaskId` through URL state.

**Why it pays off.** Browser back closes the panel. Deep links work. Body is keyboard-aware naturally. Long notes scroll independently. Triage of 30 cards becomes one continuous flow (swipe-between). Kills 5 of the 12 modal findings in `03` plus the data-loss bug. Removes the portal mount cost on every board paint.

**Risk + tradeoffs.** AntD `Drawer` `forceRender` semantics differ from `Modal`. Phone bottom-sheet snap points need iOS testing. Mitigation: phone-first behind a flag; desktop rail follow-up.

**Effort.** **M-L** — 1 week. Form body is reusable as-is.

**Sequencing.** After Phase-1 bugs, before A8.

### A3 — Bottom tab bar + demoted header

**Status quo.** Sticky header is 511 LOC carrying brand + `MemberPopover` + theme toggle + account dropdown (theme + AI on/off + language + logout). Phone reachability is entirely top-edge. No `<nav aria-label>` landmark anywhere. `mainLayout.tsx` has no nav region. `MemberPopover` is a 167-LOC orphan.

**Proposed direction.** On `pointer: coarse`, demote header to brand + 1 settings icon (~150 LOC), and add a fixed-bottom `<nav aria-label="Primary">` with 4 tabs at 56×56 px: **Boards** (`/projects`), **Inbox** (`/inbox` — aggregates `useNudgeInbox` + future @-mentions, unread badge), **Copilot** (opens CopilotDock; until A1 ships, `AiChatDrawer`), **Profile** (`/settings`). Bar uses `position: fixed; padding-bottom: env(safe-area-inset-bottom)`, hides on `visualViewport` resize (keyboard open), backdrop-blur with `prefers-reduced-transparency` fallback. Mount the orphan `MemberPopover` in the top-right brand cluster.

**Why it pays off.** Reachability. +65% DAU and +70% session length (Redbooth, cited in `mobile-native-best-practices.md` §B). Closes the `<nav>` landmark gap. Trims the phone header from 511 LOC to ~150.

**Risk + tradeoffs.** Tablet portrait (768-1023 px) is awkward — keep header-only at `min-width: ${breakpoints.md}px`. Carving `/inbox` and `/settings` is the bigger lift than the bar itself. Mitigation: ship with three tabs (Boards / Copilot / Profile) first, add Inbox after A8 lands.

**Effort.** **M** — 2-3 days for the bar; 1-2 days for `/inbox` and `/settings`.

**Sequencing.** Independent. Pairs with A1.

### A4 — PWA install + update lifecycle

**Status quo.** SW silently activates on next full reload (`sw.js:21-28` `skipWaiting`s only at install; `src/index.tsx:165-176` never listens for updates). `apple-touch-icon` is `.svg` (`index.html:33`) — iOS Add-to-Home-Screen falls back to a blurry page screenshot. No `beforeinstallprompt` capture. No `share_target`. No `shortcuts`. No maskable PNG. Manifest screenshots reuse the icon SVG. No OLED `theme-color` variant.

**Proposed direction.** Three pieces:

1. **Update lifecycle.** Remove `skipWaiting` from `sw.js:install`; add a `message` listener that calls `self.skipWaiting()` on `{ type: 'SKIP_WAITING' }`. In `index.tsx`, attach `registration.addEventListener('updatefound', …)` → on `installed`, fire AntD `notification.info` with action "Reload" that posts the message, listens for `controllerchange`, then reloads. Gate on idle.
2. **Install nudge.** Capture `beforeinstallprompt`; render `<InstallNudge>` (same shape as `copilotWelcomeBanner`) after ≥ 2 sessions, not in standalone. iOS Safari gets a "Share → Add to Home Screen" variant. Real PNG icons (180/167/152/120 for apple-touch-icon; 192/512 for `any` and `maskable`) via `pwa-asset-generator`.
3. **App shortcuts** in manifest (`New task`, `Open Copilot`, `My boards`). Two PNG screenshots (`form_factor: narrow` + `wide`). Third `theme-color` media query for `(dynamic-range: high)` → `#000000`.

**Why it pays off.** Stops the silent-stale bug — users sit on yesterday's bundle unbounded duration. Doubles install rate per web.dev benchmarks. Long-press Android launcher actions make Pulse feel installed.

**Risk + tradeoffs.** Update toast can annoy mid-edit; mitigate with idle gating. Install nudge fatigue mitigated by ≥ 2 sessions threshold.

**Effort.** **M** — ~1.5 days.

**Sequencing.** Independent. Phase 2.

### A5 — Passkey-first auth (with magic-link, SSO, password as fallback)

**Status quo.** Email + 8-char password + caps-lock hint + a "Forgot password" link to a 21-LOC dead-end (`forgotPassword/index.tsx:5-20`). No SSO, no passkey, no magic-link. Mobile hero rail disappears at `<md` (`authLayout.tsx:62-65`) — what's left is an AntD card with a 36 px wordmark (`screenshots/login__iphone13__light.png`).

**Proposed direction.** Ranked priorities: (1) **Passkey-first.** On page load, `navigator.credentials.get({ mediation: "conditional" })` so users with a registered passkey see fingerprint/face-id when they tap the email field. (2) **Magic-link** as the no-passkey fallback — single email input + Continue, server returns 202 immediately. Kills the "Forgot password" dead-end. (3) **SSO** buttons (Google / Microsoft / Apple) above the email field. (4) **Password** collapsed under "Sign in with password instead." Mobile auth landing: brand mark + tagline + 3 buttons. Zero fields visible on first paint, no keyboard pop.

**Why it pays off.** 60-80% of returning users tap face-id and skip the form. Magic-link removes the forgot-password dead-end. Mobile sign-in lands without keyboard pop — the biggest "feels native" win for first-time users.

**Risk + tradeoffs.** Backend lift: passkey + magic-link endpoints (~2-week feature). Magic-link requires email deliverability (SPF/DKIM/DMARC). iOS Safari conditional UI requires a registered passkey — fallback must work flawlessly for first-timers.

**Effort.** **XL** — 2-3 sprints, mostly backend.

**Sequencing.** Phase 4. Independent.

### A6 — Sectioned daily index for projects

**Status quo.** `ProjectList` renders a single `Grid` of all projects, sortable by name/created. No frequency-of-use signal, no "things changed since you last looked" signal. The Like affordance is vestigial. `ProjectCard` surfaces zero dynamic signal beyond an AI match strength badge that only appears when AI search is active (`projectCard/index.tsx:334-455`).

**Proposed direction.** Three sections on `/projects`: **Pinned** (top, using existing `likedProjects`; rebrand heart→pushpin everywhere), **Recent activity (last 7 days)** (server-driven `GET /projects?since=…` with activity-delta blob — caps at 5 entries), and **All projects** with sort + view-mode + group-by-organization toolbar. Each card carries three live signals: open-task progress bar, last-activity timestamp ("Updated 2h ago by Alice"), and presence dots (up to 4 stacked avatars, then `+N`). Optional AI brief on hover.

**Why it pays off.** Daily UX: the user's eye goes to "Recent activity" first, with one-glance deltas. 90% of session opens have a "something changed since I last looked" answer. Pinned makes the favorite affordance functional. The "All" section becomes navigational, not the default experience. Pulse's AI differentiation surfaces on the index page instead of being buried inside each board.

**Risk + tradeoffs.** Server work: `?since=` query parameter + activity-summary endpoint (~3-5 days backend). Presence requires WebSocket lift — gate behind a feature flag.

**Effort.** **L** — 1-2 sprints.

**Sequencing.** Pairs with ITask data-model expansion (move #4).

### A7 — Lenses + swimlanes + save-as-view

**Status quo.** Only filterable dimensions are `taskName`, `coordinatorId`, `type`, `semanticIds` (`board.tsx:344-349`). No sort, no group, no swimlanes, no "Today" lens, no save-as-view. Cards order by `task.index` only. The triage agent has data but no proactive UX hook (`board.tsx:471-495` — gated on chat-drawer first open).

**Proposed direction.** Three layers:

1. **Lens chips** above the filter rail: "Today", "This week", "Mine", "Bugs only", "Stuck >3d", "AI: Show what's at risk". URL-driven presets. The AI lens consults `useAgent("triage-agent")` and pre-fills `?semanticIds=`. The triage agent runs proactively on board mount and surfaces a dismissible "3 cards may be stuck — Review" banner.
2. **Group-by control** ("Column · Assignee · Epic · Priority · Due window"). When grouping by non-Column, each column becomes a swimlane row. Drop on lane = re-assign / re-prioritise.
3. **Save as view** — localStorage-backed named combos rendered as chip clusters. Tap = apply; long-press = delete. AI suggests views from board content.

**Why it pays off.** "Today" lens reframes the kanban as a daily-stand-up surface in one tap. Swimlanes by assignee turn the board into a workload view without leaving the page. "AI: Show what's at risk" makes the AI brief *actionable*. The proactive banner kills the "AI exists only when you open chat" gap (`02`·F14).

**Risk + tradeoffs.** Swimlanes complicate the DnD model. Group-by needs `priority` + `dueDate` on `ITask`. Strategy: ship Lenses + save-as-view first; defer Group-by + swimlanes until the data model lands.

**Effort.** **L** — Lenses alone: 3 days; full Group-by + swimlanes: 1-2 weeks.

**Sequencing.** Lenses-only depends on nothing. Full version waits on ITask.

### A8 — AI Inbox + activity ledger

**Status quo.** `nudgeCard` renders only inside `AiChatDrawer` (`:1884-1899`) — invisible until the user opens chat. `useUndoToast` lives in `AiTaskAssistPanel` and `AiTaskDraftModal`. `MutationProposalCard` has its own 10 s countdown. No persistent history. `onUndo` is never wired to `MutationProposalCard` from chat (`aiChatDrawer:1874` — `04`·F2) so even "undoable: true" actions strip the post-commit Undo.

**Proposed direction.** Two paired pieces inside CopilotDock (A1):

1. **Inbox tab.** Active nudges (max 5, aggregated per type) from `useTriageAgent`. Unread badge on the dock launcher = `nudges.length - dismissed.size`. Each card has primary CTA + Dismiss + "Why is this here?" (citation popover) + "Don't show this kind for 24h" snooze. Unread count also appears on the bottom-tab "Inbox" entry (A3).
2. **Activity ledger** (`src/components/aiActivityLog/index.tsx`). Persistent pill at the bottom of the dock: "3 AI changes this session • Show" → scrollable list with one-click Revert. Toasts continue for ~5 s for in-context feedback; the ledger is source of truth. `AiTaskAssistPanel`, `AiTaskDraftModal`, `MutationProposalCard` all wire through `useAiLedger().record({ description, surface, undo })`.

**Why it pays off.** Inbox aligns Pulse with Linear's Triage UX (the lesson PRD v3-ai-ux explicitly names). Today Copilot cannot initiate a useful interaction; Inbox is the missing piece. The ledger makes the "undoable but no undo wired" footgun structurally impossible — every mutation goes through `useAiLedger`, every record has an undo. The audit trail builds trust.

**Risk + tradeoffs.** Notification fatigue — hard-cap nudges; decay per PRD §7.2. Cross-session persistence depends on a BE journal endpoint (v2.1 §6.2); ship "session-only" first.

**Effort.** **M** — Inbox: 2-3 days; ledger: 3 days. Together: ~1 week.

**Sequencing.** Depends on A1. Pairs with A3.

---

## Quick-wins kanban

20 changes that each ship in a single day-PR. Ordered by leverage.

| ID | Finding | Surface | File:line | Effort |
|---|---|---|---|---|
| QW-01 | Fix "Edit project" title on Create CTA (cache collision) | Project modal | `useProjectModal.ts:45-52` | XS |
| QW-02 | Lift `overflow-x: hidden` off `html` (detached scroller) | Global CSS | `App.css:69-78` | XS |
| QW-03 | Stop discarding `TaskModal` edits when task disappears | Task modal | `taskModal/index.tsx:248-259` | S |
| QW-04 | Wire `onClearAll` on the chip row | Board filter | `taskSearchPanel/index.tsx:299` | XS |
| QW-05 | Strip canned defaults from `TaskCreator` payload | Board | `taskCreator/index.tsx:113-122` | XS |
| QW-06 | `AuthErrorSummary`: focus only on visible 0→1 transition | Auth | `authErrorSummary/index.tsx:80-84` | XS |
| QW-07 | `LoginForm`: trim + lowercase email at form boundary | Auth | `loginForm/index.tsx:64` | XS |
| QW-08 | Drop `disabled={isLoading}` from chat textarea | AI chat | `AiChatComposer.tsx:41` | XS |
| QW-09 | Add `!e.nativeEvent.isComposing` to IME-safe Enter | AI chat | `AiChatComposer.tsx:46-51` | XS |
| QW-10 | Delete the legacy `Space.Compact` Brief/Ask cluster | Board header | `pages/board.tsx:684-714` | XS |
| QW-11 | Delete the single-tab `Tabs` row on project detail | Project detail | `projectDetail.tsx:166-175, 244` | XS |
| QW-12 | Mount `MemberPopover` in the board header | Board | new mount in `pages/board.tsx` | S |
| QW-13 | Promote `srOnlyLiveRegionStyle` to `<SrOnlyLive>` | A11y | new `utils/a11y/SrOnlyLive.tsx` | S |
| QW-14 | Use `aria-busy`, not `aria-hidden`, on `StatRail` | Projects | `pages/project.tsx:340` | XS |
| QW-15 | Remove default `aria-label` in sparkle icon | A11y | `aiSparkleIcon/index.tsx:99-106` | S |
| QW-16 | SW update channel + reload toast | PWA | `sw.js:21-28` + `index.tsx:165-176` | M |
| QW-17 | Ship real PNG `apple-touch-icon` + maskable PNG entries | PWA | `index.html:33`, `manifest.webmanifest:24-34` | S |
| QW-18 | Subtract `env(keyboard-inset-height)` from modal max-heights | Modal math | `taskModal:422`, `projectModal:146`, `aiTaskDraftModal:461` | XS |
| QW-19 | Swap phone footer order: destructive last, primary in thumb zone | Modal | `taskModal:336-405`, `projectModal:128-143` | XS |
| QW-20 | Brand suffix on `document.title` across auth pages | Auth | `useTitle` helper + 4 auth pages | XS |

---

## Suggested 4-phase roadmap

### Phase 1 — This week (bug-fix sprint)

A single engineer-day plus a PR train. Clear the deck of correctness bugs and screenshot embarrassments before any redesign.

- QW-01 to QW-11 inclusive (the 11 highest-leverage Phase 1 quick wins)
- QW-14, QW-18, QW-19 (a11y, keyboard math, footer ordering)
- `ProjectCard` "More" menu rewiring (`projectCard/index.tsx:282-331`)
- `aiSparkleIcon` orange fallback removal (visual flash bug)
- `AiSuggestedBadge` drop `"focus"` trigger (`aiSuggestedBadge/index.tsx:71`)

Outcome: a build that doesn't ship "Edit project" on Create, doesn't lose edits, doesn't trap auth focus, doesn't broadcast "Board Copilot" through every sparkle.

### Phase 2 — Next 2 weeks (IA + PWA lifecycle)

Collapse the IA fragmentation and ship the install/update story.

- QW-12, QW-13, QW-15, QW-16, QW-17, QW-20
- Manifest screenshots (PNG narrow + wide) + `shortcuts` entries
- `EngineModeTag` deduplication — surface once in app chrome, drop from 5 drawer headers
- Welcome banner CTA rewrite (open chat with "Summarize this board" prompt)
- Contextual follow-up chips in chat (read `messages[lastUserIndex]`)
- Wire `onUndo` for `MutationProposalCard` in chat (`aiChatDrawer:1874`)
- Move `Modal.confirm` for delete project into a URL-state modal (or Undo toast)
- Move triage-agent run into a board-mount effect with a dismissible nudge banner
- `formTick` → `Form.useWatch` in `TaskModal`
- Standardise `validateTrigger={["onBlur", "onSubmit"]}` on required fields
- Token-coverage closeout (the six files in `05` audit)

Outcome: app updates cleanly, installs cleanly, narrates state cleanly, has one Copilot launcher, has 100% palette coverage.

### Phase 3 — This quarter (the big ambitions)

The structural moves.

- **A1 — CopilotDock.** Phased rollout behind a feature flag.
- **A2 — Routed inline task panel.** Phone-first; desktop right rail in a follow-up.
- **A3 — Bottom tab bar + demoted header.** Plus `/settings` and `/inbox` routes.
- **A4 — PWA install + update lifecycle** finishes with Web Share Target.
- Lenses-only slice of A7 (Today / This week / Mine / AI: at risk).
- Modal-system policy memo: new detail surfaces route by default.

Outcome: three doors into AI collapse to one. The phone gets a real navigation chassis. The board gets daily-useful filters. Task open is a route, not a modal.

### Phase 4 — Next quarter (architectural bets)

- **A5 — Passkey-first auth.** Backend WebAuthn + magic-link.
- **ITask data-model expansion** — `dueDate`, `priority`, `labels`, `updatedAt`.
- **A6 — Sectioned daily index for projects.**
- **A7 full** — Group-by + swimlanes once ITask expansion ships.
- **A8 — AI Inbox + activity ledger.**
- Smart column states (auto-collapse Done, drag-to-archive).
- Density preference + dynamic type accessibility.

Outcome: the differentiated AI-PM product the README implies, on a data model that can answer "what's due?" and a Copilot that proactively triages.

---

## What we'd defer

Things the subagents flagged that we'd consciously *not* do this year.

- **Onboarding tour (3-step "what's where")** from `05` Ambition E. The CopilotDock first-open hero (A1) already covers the most critical step.
- **Inline ghost-text in task descriptions** (`04` Ambition 2). Privacy story for note bodies is non-trivial; sub-300 ms inference budget unproven on local engine. Defer until A8 (ledger) lands.
- **`react-window` virtualization on columns** (`02`·F7). Not needed until real boards exceed 30 cards/column. Apply `React.memo` (free) now.
- **Attachments in `TaskModal`** (`03`·#16). Real gap but bundle/backend cost is meaningful. Routed task panel (A2) is the cleaner host for a dropzone.
- **Self-hosted Inter** (`05`·#15). Real perf win but not the user complaint seen in `screenshots/`. Quick win 17 (preload over @import) covers the bulk.
- **Web Share Target full implementation** (`05` Ambition C). Depends on file-upload backend. Manifest scaffolding lands in Phase 2; `/share-target` route is Phase 4.
- **Lexical/ProseMirror editor for notes**. Bundle cost ~80 KB; `<TextArea>` is sufficient. Revisit when @-mentions ship.
- **Per-card AI brief on hover** (`01` Ambition A3 optional). Cost-per-hover for a remote brief is unbounded. Gate behind explicit opt-in; revisit when local-engine briefs are reliable.

---

## Open questions for the team

- **Is the team OK adding `dueDate`, `priority`, `labels` to `ITask` server-side?** Unlocks half the Phase 4 ambitions.
- **Bottom tab bar — yes or no on phone?** Adopting it commits to the destinations Boards / Inbox / Copilot / Profile. If "Inbox" isn't going to be a thing, four-tab shape doesn't work.
- **Do we collapse the three AI surfaces into one CopilotDock?** Equivalent to: is AI one product or five? The PRD says one; the implementation says five.
- **Magic-link / passkey-first — does backend support this?** Backend WebAuthn is ~2 weeks; email deliverability adds another week.
- **Are we OK shipping a real dark mode now?** `var(--ant-color-*)` is wiring it through AntD (visible in `screenshots/board__desktop__dark.png` et al.), but the focus ring is dim on the cinematic auth rail (`05`·#13), and OLED users see warm-brown chrome instead of pure black (`05`·#6). 1 hour of work.
- **Is the project Like button dead weight or actually a Pin?** Today it's a heart that only feeds a sort key. Pin → rebrand + Pinned section (A6). Vestigial → remove.
- **Keep the auth hero rail invisible on mobile, or redesign as a 3-button SSO landing (A5 partner)?**
- **`useNudgeInbox` exists but has no destination. Are we shipping `/inbox` or always inline in CopilotDock?** Affects whether the bottom tab bar gets 3 or 4 tabs.
- **Local engine vs remote: keep both indefinitely, or is local transitional?** The 5× repeated `EngineModeTag` assumes both are first-class.
- **Density preference — comfortable / compact / system. Ship as a setting, or accept the implicit `pointer: coarse` heuristic?**

---

## Appendix

### Subagent reports

- `docs/design/_review-2026-05/01-auth-and-projects.md` — 34 findings + 4 ambitions
- `docs/design/_review-2026-05/02-board-and-project-detail.md` — 20 findings + 5 ambitions
- `docs/design/_review-2026-05/03-modals-and-forms.md` — 17 findings + 4 ambitions
- `docs/design/_review-2026-05/04-ai-copilot.md` — 27 findings + 6 ambitions
- `docs/design/_review-2026-05/05-pwa-mobile-a11y-designsystem.md` — 20 findings + 5 ambitions + token-coverage audit
- `docs/design/_review-2026-05/06-screenshot-audit.md` — 10 findings across 30 screenshots

### Screenshots, by surface

Path prefix: `docs/design/_review-2026-05/screenshots/`

- **Auth.** `login__desktop__light.png`, `login__iphone13__{light,dark}.png`, `login__iphoneSE__light.png`, `register__desktop__light.png`, `register__iphone13__light.png`, `forgot-password__iphone13__light.png`.
- **Projects list.** `projects__desktop__{light,dark}.png`, `projects__iphone13__{light,dark}.png`, `projects__iphoneSE__light.png`, `projects__pixel7__light.png`, `projects__ipad{Portrait,Landscape}__light.png`, `projects__wide__light.png`, `projects-modal-create__{desktop,iphone13}__light.png`.
- **Board + project detail.** `board__desktop__{light,dark}.png`, `board__iphone13__light.png`, `board__ipadPortrait__light.png`, `board__wide__light.png`, `board-task-detail__{desktop,iphone13}__light.png`, `board-brief-drawer__desktop__light.png`.
- **AI.** `ai-chat-drawer__{desktop,iphone13}__light.png`, `command-palette__desktop__light.png`.
- **Other.** `not-found__desktop__light.png`.

### Reference standards

- `docs/design/mobile-native-best-practices.md` — boilerplate, PWA, bottom-tab guidance, safe-area + viewport units, keyboard handling, drag/touch + 44 px targets, dynamic type, dark mode + reduced motion + reduced transparency, the Baymard 2024 broken-back-button citation.
- `docs/design/ai-ux-best-practices.md` — five core axioms (calibrated transparency, user agency, reversibility, honest framing, privacy by default), prompt input design, streaming, follow-up chips, conversational vs structured output, source attribution, autonomy + consent, AI Inbox pattern, mutation proposal contract.
- `src/theme/tokens.ts` — design tokens. Palette swap is one line in `src/theme/palettes/index.ts`.
