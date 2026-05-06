# UI / UX Optimization Plan

**Status as of 2026-05-05:** Phase 1 foundations (rem-hack removal, ConfigProvider/AntD token wiring, responsive layout) and key Phase 3 tooling items (jest-axe, code splitting, service worker) are complete. Phase 4 command palette is shipped. Storybook scaffolding and rollup-plugin-visualizer remain open. For AI-specific UX issues, see `AI_UX_OPTIMIZATION_PLAN.md` in repo root.

This document is a critical review of the current `pulse` interface and a phased plan to bring it up to a polished, modern Jira-like product. Each section starts with a concrete observation (what is in the code today) and ends with a recommendation. File references use `path:line` so each finding can be traced.

The plan is intentionally pragmatic: Phase 1 ("Foundations") removes the worst structural debt that everything else inherits, Phase 2 ("Surfaces") rebuilds the high-traffic screens, Phase 3 ("Polish & Accessibility") hardens the experience, and Phase 4 ("Stretch") adds nice-to-have UX.

Every recommendation in this plan is anchored to one or more of these external rubrics so it can be defended in review. Section 7 maps individual items back to the rubric.

- **Nielsen's 10 usability heuristics** — visibility of system status, match with the real world, user control & freedom, consistency & standards, error prevention, recognition over recall, flexibility & efficiency, aesthetic & minimalist design, helping users recover from errors, help & documentation.
- **WCAG 2.2 AA** — with explicit attention to the new 2.2 criteria: 2.4.11 Focus Not Obscured (Minimum), 2.4.12 Focus Not Obscured (Enhanced), 2.4.13 Focus Appearance, 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication (Minimum).
- **Inclusive Components / GOV.UK Design System patterns** for forms, error summaries, and "one thing per page" decomposition.
- **Material Design 3 motion & state-layer guidance** for hover/pressed/focused states and motion durations.
- **Refactoring UI / Practical Typography** for spacing scale, type scale, and visual hierarchy.
- **OS-level preferences**: `prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`, `forced-colors`.

---

## 1. Audit summary — what hurts today

### 1.1 Foundational problems that radiate through every screen

1. ~~**The 62.5% rem hack collides with Ant Design v6 tokens.**
   `src/App.css:1` sets `html { font-size: 62.5%; }` so `1rem = 10px`. The codebase then sprinkles values like `1.4rem`, `2rem`, `0.5rem`, `3.2rem` everywhere (`src/components/header/index.tsx:14`, `src/components/column/index.tsx:17`, `src/components/projectModal/index.tsx:11`), but Ant Design v6 components are designed against px-based design tokens and a 14px base font. The result is that AntD's own internal padding/typography is not aligned with the app's spacing scale, the default body text reads as 10 px until a component overrides it, and any future migration to AntD's theme tokens will have to undo this hack first. There is also no `<ConfigProvider theme={…}>` anywhere in `src/utils/appProviders.tsx:10–22`, so brand color (`rgb(38, 132, 255)` hard-coded in `src/components/header/index.tsx:62`) is never registered as a token.~~ **[Complete: rem hack removed; `ConfigProvider` wired in `src/utils/appProviders.tsx` ~line 72.]**

2. **No design system — magic numbers everywhere.**
   Spacing alternates between `rem`, raw `px`, and unitless numbers (`marginBottom: 16`, `gap: 8`, `style={{ fontSize: "0.85rem" }}`, `style={{ fontSize: "1.4rem" }}`). Colors are inline (`rgba(22, 119, 255, 0.08)` in `src/components/aiChatDrawer/index.tsx:179–181`, `rgba(0,0,0,0.5)` in `src/components/aiTaskAssistPanel/index.tsx:179`, `rgb(94, 108, 132)` in `src/layouts/authLayout.tsx:17`). There is no `tokens.ts` and no shared `theme` object. Every new component reinvents its own spacing.

3. ~~**Layout is desktop-only and not responsive.**
   `src/layouts/mainLayout.tsx:7–18` declares `min-width: 1024px`, `max-height: 1440px`, and `overflow: scroll` on `<main>`. The first rule blocks mobile / tablet entirely; the third produces a double scrollbar (the page already scrolls inside `ColumnContainer`). `src/layouts/authLayout.tsx:35–37` sizes its background images off `calc((100vw - 40rem)/2)` — once the viewport drops below `40rem` the math goes negative and the SVGs disappear or overflow.~~ **[Complete: `min-width: 1024px` and `max-height: 1440px` removed from `mainLayout.tsx` (line 73 comment confirms removal).]**

4. **The information architecture buries primary navigation.**
    - "Projects" navigation only exists as a `<Popover>` inside the project detail aside (`src/pages/projectDetail.tsx:39–42`, `src/components/projectPopover/index.tsx:49–53`). On the project list page there is no project switcher at all.
    - "Members" is a bare `<span>Members</span>` next to the logo (`src/components/memberPopover/index.tsx:42`). It looks like a label rather than an interactive element, is not focusable, and is not labeled as a button.
    - "Logout" is hidden under a dropdown labeled `Hi, {username}` with no chevron, no avatar, and no menu icon (`src/components/header/index.tsx:89–96`).
    - "Board Copilot" gets two separate toggles (global header switch in `src/components/header/index.tsx:67–88` plus a per-project switch in `src/pages/board.tsx:111–151`) plus three more launchers (Brief, Ask, Draft with AI) — all stacked into the board H1 row.

5. **The project detail "shell" is a duplicate layout.**
   `src/layouts/mainLayout.tsx` already provides a header + `<main>` shell, and then `src/pages/projectDetail.tsx:51–63` adds another `display: grid; grid-template-columns: 16rem 1fr` shell underneath, so we have two competing layouts (header layout + sidebar layout) and the sidebar contains exactly one menu item ("Board") plus the popover. There is also a stray typo `5 px` in the box-shadow at `src/pages/projectDetail.tsx:15` which silently disables the shadow.

### 1.2 Component-level problems

6. **Project list table.**
   `src/components/projectList/index.tsx`:
    - The "Like" column uses `<Rate count={1} />` (`src/components/projectList/index.tsx:86–102`) — a 1-star rating control is a confusing proxy for a like/favorite. A heart toggle (or AntD's `StarFilled` icon button) would communicate the action immediately.
    - Optimistic state is faked with `currentProjectId` plus three nested ternaries in the render (`:91–98`); the visual flips to "off" while the mutation is in flight, then snaps back when it completes. This is the inverse of a real optimistic update.
    - The actions menu trigger is the literal string `"..."` rendered as text inside a `link`-typed button (`:170–172`). It should be `<MoreOutlined />` inside an icon button.
    - There is no pagination, no row hover state, no empty state ("Create your first project"), and no avatar/initials for the manager (`:120–129`). When the manager id is missing the cell shows the literal word `unknown`.

7. **Board page — toolbar overload.**
   `src/pages/board.tsx:104–152` renders, in one flex row: project name H1, a "Project AI" switch with explanatory tooltip, a "Brief" button, and an "Ask" button — all when the global AI toggle is also on. This is on top of the search panel rendered immediately below (`:153–178`). At ~1024 px width these wrap unpredictably. The H1 also reads "..." while loading (`:107–110`) instead of using a `Skeleton` line.

8. **Board cards are visually under-built.**
   `src/components/column/index.tsx:42–46, :155–172`:
    - A `TaskCard` has only a task name and a small bug/task icon. No assignee avatar, no story-points pill, no epic chip, no type label (the icon is the only signal for Task vs Bug, with no text fallback for screen readers — its `alt` is the generic `"Type icon"`).
    - There is no hover/focus state and no visual indication the whole card is clickable.
    - Column header is `<h4 style={{ textTransform: 'uppercase', paddingLeft: '1rem' }}>` with no count badge ("To Do · 4").
    - The action menu is again the literal `"..."` text (`:86`).
    - `TaskContainer` hides scrollbars via `::-webkit-scrollbar { display: none }` (`:31–33`) which prevents Firefox/Edge users from knowing the column has overflow.

9. **Filter / search row.**
   `src/components/taskSearchPanel/index.tsx`:
    - `tasks?.map(... return null)` is used for its side-effect of populating `types` and `coordinators` arrays on every render (`:35–44`); the lists then survive across renders unfiltered. This both leaks memory if the dataset changes and breaks deduping.
    - The AI search slot is injected as the form's first child with `flexBasis: 100%` so it visually wraps above the inline filters (`src/pages/board.tsx:159–177`). The wrap is fragile — anything else inserted into the form will break the layout.
    - "Reset filter" is a plain text button, not visually grouped with the filters it resets.
    - On the project list (`src/components/projectSearchPanel/index.tsx:19–69`) the "Search this list" input has no debounce indicator and the Manager `Select` has no clear button.

10. **Edit Task modal.**
    `src/components/taskModal/index.tsx`:
    - The delete button sits **below** the form, outside the modal footer, styled as a small dashed danger button (`:213–230`). Destructive actions belong in the footer (e.g. left-aligned secondary `Delete`, right-aligned `Cancel` / `Submit`).
    - The AI assist panel renders inside the same modal body (`:187–212`), causing a tall scrollable area; nothing visually separates the form from the suggestions; and any user keystroke triggers the panel's two debounced AI calls.
    - The modal title is the static string `"Edit Task"` — it could read `Edit · {taskName}` for context.
    - The Type select silently rebuilds its options from the existing task list (`:35–41, :149–166`) — if there is exactly one type in the dataset the user is forced into a hardcoded `Task / Bug` fallback list instead of seeing the canonical choices.

11. **Auth screens.**
    `src/components/loginForm/index.tsx`, `src/components/registerForm/index.tsx`, `src/layouts/authLayout.tsx`:
    - Inputs only carry placeholders, no `<Form.Item label>`. AntD will still render the field but screen readers and password managers lose the label association. The hand-set `id="email"` / `id="password"` on the inner `<Input>` may not match what AntD attaches to its own label slot.
    - There is no "Show password", no caps-lock hint, no "Forgot password" link, no password-strength indicator on register, no terms-of-service link.
    - The card is a fixed `40rem` wide / `56rem` tall (`authLayout.tsx:43–51`) on a viewport-locked background, so it looks identical regardless of the form length and floats awkwardly when the page becomes very tall (e.g. with the error box expanded).
    - The "Register for an account" CTA is a `NoPaddingButton type="link"` — the same component reused for the column "..." menu and the header logout, so its semantic role is muddied.

12. **AI surfaces (Board Copilot).**
    - `AiChatDrawer` (`src/components/aiChatDrawer/index.tsx`) renders raw `tool` messages in a `<pre>` (`:141–166`), which leaks implementation detail to end users. No timestamps, no avatars, no copy button, no "regenerate", no message limit indicator. The send box has no character count even though prompts can be arbitrarily long.
    - `AiTaskAssistPanel` (`src/components/aiTaskAssistPanel/index.tsx`) shows the suggested story points as a 2rem-tall number with a confidence Tag and a small Apply button on one row (`:131–157`), then immediately renders the rationale and a list of similar tasks — no visual cards / dividers, so it reads as a wall of text.
    - `BoardBriefDrawer` (`src/components/boardBriefDrawer/index.tsx`) is essentially three tables + lists with raw `<h3>` / `<h4>` headings (`:88–192`). There is no overall summary card, no charts (counts per column would benefit from a tiny bar), and the "Workload" list mixes a username and two tags on one line without visual hierarchy.
    - `AiTaskDraftModal` uses a raw `<input type="checkbox">` for breakdown selection (`:303–313`) instead of AntD's `<Checkbox>`, so it is visually inconsistent and unstyled.
    - The sparkle icon is fine but is sometimes placed before the button label and sometimes inside titles; padding around it varies (8 px hard-coded in some places, none in others).

13. **Column creator and task creator.**
    `src/components/columnCreator/index.tsx:22–37` is a full-size `ColumnContainer` with one large `Input placeholder=" + Create column"` — visually it looks like a real (empty) column, which is confusing. There should be an explicit "+ Add column" affordance that expands into the input on click.
    `src/components/taskCreator/index.tsx:52–80` uses `<a onClick={toggle}>` for "+ Create task" with an eslint-disable comment. The link has no `href`, no role, no keyboard handler — keyboard users cannot create a task.

14. **Members popover.**
    `src/components/memberPopover/index.tsx:18–45` re-fetches the full members list every time the popover opens (`onOpenChange={() => refetch()}`), with no rate limit. The list shows usernames only — no avatars, no role, no count. There is also no search field for organizations with many members.

15. **Drag-and-drop affordances.**
    `src/utils/hooks/useDragEnd.ts` (referenced from `src/pages/board.tsx:72–73`) handles the data side, but the visual side is bare: there is no drop placeholder styling, no card "lift" shadow during drag, no drag-handle on columns (the entire column is a drag target), and no keyboard alternative for moving cards.

16. **Loading, empty, and error states.**
    - `BoardSpin` uses hand-calculated margins (`margin-left: calc(0.5 * (100vw - 16rem - 26.4rem))`) at `src/pages/board.tsx:32–36` — fragile and breaks at any other viewport.
    - Empty board state: zero columns shows just `ColumnCreator`. Should be an illustrated empty state.
    - Empty project list: AntD `<Table>` falls back to "No data" text only; no CTA.
    - Network error on the project list shows a single red sentence (`src/pages/project.tsx:90–94`); on the board it does not show at all.

17. **Microcopy and casing.**
    Mixed throughout: "Log in" vs "Login", "Create Project" vs "+ Create task" (different casing and different verb form), "Confirm" / "Cancel" vs "Submit" / "Cancel" across modals, "Coordinators" / "Managers" plural-as-placeholder vs "Coordinator" / "Manager" singular as labels. Buttons are sometimes verbs ("Search", "Apply"), sometimes nouns ("Brief", "Ask").

18. **Routing UX.**
    `src/routes/index.tsx:14–48` always redirects `/` to `/login` and then `HomePage` redirects authenticated users back to `/projects` (`src/pages/home.tsx:11–18`). This causes a brief login-screen flash for already-signed-in users. Combine the checks at the route level.

19. **Performance smells that show up as UI jank.**
    - `tasks?.filter(...)` in the column render (`src/pages/board.tsx:200–203`) plus the per-card filter in `Column` (`src/components/column/index.tsx:126–137`) are O(N×M) every render. Pre-bucket tasks by `columnId` once.
    - `AiTaskAssistPanel` re-fires both estimate + readiness AI calls on every value change after a 600 ms debounce (`src/components/aiTaskAssistPanel/index.tsx:58–104`). With the local engine that is cheap, but the visible spinner cycling looks unstable. Throttle the spinner (only show it after 250 ms).
    - `useReactQuery<IMember[]>("users/members")` is called from at least four components (`board.tsx`, `project.tsx`, `taskModal`, `memberPopover`); ensure it is a single shared key and cached, and stop refetching on popover open.

20. **Accessibility gaps.**
    - Several `<a onClick>` patterns with `eslint-disable` (e.g. `taskCreator`, `column`).
    - Decorative SVGs without `alt=""` (the bug/task icons inside `Column`).
    - Color contrast on muted text (`rgba(0,0,0,0.5)` on white) probably fails WCAG AA.
    - The header logo button has no accessible label distinguishing it from "Members".
    - Live regions on the chat drawer (`aria-live="polite"`) are good — extend the same to the AI assist and brief drawers.

---

## 2. Optimization plan

The plan is split into four phases. Phases are ordered by dependency (Phase 1 unblocks Phase 2 etc.), not by urgency — every phase contains items that can ship independently behind the existing tests.

### Phase 1 — Foundations (no visible regressions, large downstream payoff)

**Goal: stop fighting AntD, give every component a single source of truth for spacing/colors/typography.**

1. **Remove the 62.5% rem hack and adopt AntD theme tokens.**
    - Delete `html { font-size: 62.5%; }` from `src/App.css:1`.
    - Wrap the tree in `<ConfigProvider theme={{ token: {…}, components: {…} }}>` inside `src/utils/appProviders.tsx:10–22`.
    - Define a `src/theme/tokens.ts` exporting `colorPrimary` (the brand `#2684FF`), `borderRadius`, `fontFamily`, `fontSize`, and a numeric `space` scale (4, 8, 12, 16, 24, 32). Re-export named constants so styled components use `${space.md}` instead of magic rems.
    - Mass-replace `1.4rem`, `1.6rem`, `2rem`, `3.2rem`, etc. with the equivalent token / px value. The replacement is mostly mechanical and preserves visual sizes (1 rem = 10 px today maps cleanly to multiples of 8 px after the switch).

2. **Add a dark-mode-ready palette.**
   Once tokens exist, plug AntD's `theme.darkAlgorithm` behind a header switch. Persist the choice in `localStorage` next to the existing `boardCopilot:enabled` key.

3. **Make the layout responsive.**
    - In `src/layouts/mainLayout.tsx:7–18`, drop `min-width: 1024px` and `max-height: 1440px`; switch the grid to `grid-template-rows: auto 1fr`; remove `overflow: scroll` from `<main>` (let inner regions own scroll).
    - In `src/pages/projectDetail.tsx:20–24`, collapse the second layout into the main shell (see Phase 2.4) or, at minimum, replace `grid-template-columns: 16rem 1fr` with a CSS variable so the sidebar can collapse below 768 px.
    - Add a `useBreakpoint` (AntD `Grid.useBreakpoint`) hook and conditionally collapse the header to an icon-only state on `xs`/`sm`.

4. **Centralize typography and headings.**
   Create a small `Heading` / `Subhead` / `Muted` set on top of AntD `Typography.Title/Text` so we stop using bare `<h1>`/`<h4>` with inline styles (`src/pages/board.tsx:106–110`, `src/components/column/index.tsx:109–116`).

5. **Single source for the brand logo color.**
   Replace `<Logo color="rgb(38, 132, 255)" />` (`src/components/header/index.tsx:62`) with `<Logo color={token.colorPrimary} />` so a theme change re-skins the logo automatically.

6. **Pre-bucket tasks by `columnId`.**
   In `src/pages/board.tsx`, build `const tasksByColumn = useMemo(() => groupBy(visibleTasks, "columnId"), [visibleTasks])` and pass `tasksByColumn[column._id] ?? []` to `<Column>` so the column filter loop becomes O(M) per render. Move the filter logic from `src/components/column/index.tsx:126–137` up to a `useFilteredTasks(tasks, param)` hook.

### Phase 2 — High-traffic surfaces

**Goal: rebuild the four screens users spend 95 % of their time on.**

1. **Header & global navigation (`src/components/header/index.tsx`).**
    - Replace the "Hi, {username}" link-button with `<Avatar>{initials}</Avatar>` + chevron, and put Logout, Profile, and Theme toggle inside the dropdown.
    - Move "Members" out of a `<span>` into either a top-nav button (with a count badge) or a sidebar entry; make it focusable.
    - Add a primary nav with at least: `Projects`, `Members` (and later `Reports`). Highlight the active route.
    - Move the "Board Copilot" master switch into the avatar dropdown (Settings → AI features) so it stops competing with the user's name.

2. **Project list page (`src/pages/project.tsx`, `src/components/projectList`, `src/components/projectSearchPanel`).**
    - Replace the abused `Rate count={1}` with a `HeartFilled` / `HeartOutlined` toggle button and make the optimistic update real (flip the cache, not a transient `currentProjectId` flag).
    - Replace the `...` text trigger with `<Button type="text" icon={<MoreOutlined />} />`.
    - Add an avatar + name cell for the manager (`Avatar` + initials + name) and a "Members" avatar group column (using `Avatar.Group`).
    - Add pagination + a sensible default sort (Liked desc, then `Created At` desc).
    - Add an empty state with an illustration and a "Create your first project" primary button.
    - Move the AI search input out of the inline form and into its own row above the filter form (it is logically a different mode of search). A small `RobotOutlined` toggle on the regular search input is another option.
    - Add a global "+ New project" primary button next to the page title; demote the existing "Create Project" link.

3. **Board page (`src/pages/board.tsx`).**
    - Split the H1 row into a two-tier header: top tier = project name + breadcrumb + "Project AI" switch (only when needed); bottom tier = filters + AI buttons.
    - Group the AI controls into a single `Dropdown.Button` labeled `Copilot` with menu entries `Brief`, `Ask`, and a divider before `Project AI off`.
    - Replace `BoardSpin`'s hand-tuned offsets with AntD `Skeleton` placeholders matching the column shape.
    - Add column-level affordances: sticky column header, count badge, WIP-limit slot, and a real "+ Add column" button at the right edge that expands into `ColumnCreator` (today the empty column input is always visible — it pollutes the canvas).
    - Add a visible horizontal scroll affordance (gradient fade left/right) instead of relying on the native scrollbar; keep the native scrollbar enabled for non-WebKit browsers (delete the `display: none` rule in `src/components/column/index.tsx:31–33`).

4. **Task card (`src/components/column/index.tsx`).**
   Redesign as:
    - First row: epic chip (small colored tag) + type icon with `aria-label`.
    - Title (truncated to 2 lines with ellipsis).
    - Footer row: assignee avatar, story-points pill, optional age indicator.
    - Hover state: 1 px primary border + slight elevation; cursor pointer; focus ring for keyboard users.
    - Make the card a `<button>` (or `role="button" tabIndex={0}` with keyboard handlers) so it is accessible.

5. **Project detail shell (`src/pages/projectDetail.tsx`).**
   Decision: collapse the dedicated detail layout into the main shell. Replace the left aside with an in-header tabbed navigation (Board · Backlog · Reports). The "Projects" popover should move to a dedicated breadcrumb element (`Projects / {projectName}`) at the top-left of the page content, using AntD `Breadcrumb`. This kills the duplicated layout, fixes the broken `5 px` shadow at `src/pages/projectDetail.tsx:15`, and gives us room to add future tabs cheaply.

6. **Task edit modal (`src/components/taskModal/index.tsx`).**
    - Move the form into a two-column layout at ≥ 768 px: left = the form, right = the AI assist panel. Below 768 px, stack and put the AI panel inside an `<Collapse>` so it does not push the form off-screen.
    - Move `Delete` into a proper `Modal.footer` slot (left-aligned, `danger`) and keep `Cancel` / `Submit` on the right.
    - Replace `"Edit Task"` with `"Edit · {taskName}"`.
    - Hard-code the canonical `Task` / `Bug` options instead of inferring them from the dataset (`:35–41`); the only correct list is the one the schema allows.
    - Show validation errors inline next to fields instead of relying on `Form.Item.message` toasts.

7. **Auth screens (`src/layouts/authLayout.tsx`, `loginForm`, `registerForm`).**
    - Add real `<Form.Item label>` to every field. Keep placeholders as helper text only.
    - Set `autocomplete` properly: `username` + `email` on the email field, `current-password` on login, `new-password` on register, `name` on the register username field. Set `inputMode="email"` on email inputs and `enterKeyHint="go"` on the submit-row inputs.
    - Add a "Show password" toggle (icon-only `Button` with `aria-pressed`), a caps-lock hint that appears under the password field while the key is on, and a "Forgot password" link (route can be a TODO page).
    - On register: password-strength meter (zxcvbn-equivalent or a deterministic length+class heuristic to avoid the dependency), minimum-length hint inline, plus a "Match" indicator if a confirm-password field is added.
    - Render a top-of-form **error summary** (`role="alert"`) whenever the API returns an error, with anchor links to fields that failed; this satisfies WCAG 3.3.1 / 3.3.3 (see 2.A.1).
    - Do not block paste (`onPaste`) on password fields (WCAG 3.3.8).
    - Replace the "Register for an account" `NoPaddingButton` with a regular AntD `Link` and add the inverse on the register page.
    - Make the card width adapt to viewport (`max-width: 40rem; width: min(40rem, 100% - 2rem)`).
    - Replace the absolutely positioned background SVGs with a single subtle gradient or blurred shape that scales with the viewport — the current `calc()` math collapses on small screens.

### Phase 3 — Polish, accessibility, microcopy

1. **Establish a microcopy style guide.**
   Adopt sentence case for every button and title, and standardize action verbs. Concretely: `Log in` / `Sign up` (not `Login` / `Register`), `Create project` (not `Create Project`), `Save` (not `Submit`) for forms that mutate existing records, `Create` for forms that create new ones, `Delete` (not `Confirm`) on destructive confirmation modals, `Cancel` everywhere as the secondary action.

2. **Fix every `<a onClick>` to be a real button.**
   Touch points: `src/components/taskCreator/index.tsx:55–56`, `src/components/aiTaskAssistPanel/index.tsx:170–176`. Use AntD `Button type="link"` or `<button>` with proper styling.

3. **Audit color contrast.**
   Replace ad-hoc `rgba(0,0,0,0.5)` muted text with `Typography.Text type="secondary"` (which respects the theme algorithm). Verify contrast at AA for: muted body text, the brand-tinted message bubbles in `aiChatDrawer`, the warning Alerts.

4. **Accessibility pass — WCAG 2.2 AA, line by line.**
    - **2.4.3 Focus Order / 2.4.7 Focus Visible / 2.4.13 Focus Appearance.** Add a global focus ring using `:focus-visible` (2 px outline in `colorPrimary`, 2 px offset). Audit drawers and modals with `tab` / `shift+tab`; make sure focus is trapped while open and returned to the invoking control on close (today `TaskModal`, `BoardBriefDrawer`, `AiChatDrawer`, `ProjectModal` rely on AntD defaults — verify and add `triggerRef` patterns where AntD does not handle it).
    - **2.4.11 / 2.4.12 Focus Not Obscured.** Sticky elements (the new top-tier header and column headers from Phase 2.3) must not occlude focused controls; add `scroll-padding-top` on the page container equal to the header height.
    - **2.5.5 / 2.5.8 Target Size.** Every interactive element must be at least 24 × 24 CSS px (AA) and ideally 44 × 44 (AAA / mobile guidance). The "..." dropdown trigger in `projectList` and `column` is currently smaller than 24 px — fix when the icon swap happens in Phase 2.2.
    - **2.5.7 Dragging Movements.** Drag-and-drop on the board must have a non-drag alternative. Wire `@hello-pangea/dnd`'s keyboard sensor (Space to lift, arrows to move, Space to drop, Esc to cancel) and surface those keystrokes in a tooltip on the card and in the help dialog from Phase 4.
    - **3.3.1 / 3.3.3 Error Identification & Suggestion.** Replace single-line error toasts with a per-form **error summary** at the top of the form linking to the offending field (GOV.UK pattern). Reuse `<ErrorBox>` as the summary container and add `aria-describedby` from each field to its inline error.
    - **3.3.7 Redundant Entry.** When a user creates a task immediately after creating a column, prefill `coordinatorId` to the current user (already does) and `epic` to the most recently used value in this project. The login form's email should be `autocomplete="username"` so the password manager remembers it.
    - **3.3.8 Accessible Authentication (Minimum).** No CAPTCHA; ensure password fields accept paste (do not block `onPaste`); `autocomplete="current-password"` on login and `autocomplete="new-password"` on register. The "Show password" toggle (Phase 2.7) is required for users who cannot reliably type long passwords.
    - **1.4.3 Contrast (Minimum) / 1.4.11 Non-text Contrast.** Replace ad-hoc `rgba(0,0,0,0.5)` and `rgba(0,0,0,0.6)` with `Typography.Text type="secondary"`; verify ≥ 4.5 : 1 for body text, ≥ 3 : 1 for UI components (focus rings, input borders).
    - **1.4.1 Use of Color (color-blind safety).** The bug/task icon is currently the only signal of type, and the breakdown modal uses red Tag for `Bug` and blue Tag for `Task` (`src/components/aiTaskDraftModal/index.tsx:316–318`). Add a text label inside every Tag (`Bug` / `Task`) and prefer shape (icon outline vs. filled) over hue. Status alerts must not rely on color alone — keep AntD's icon prefix.
    - **1.4.10 Reflow / 1.4.4 Resize Text.** Phase 1.1 (kill the rem hack) and Phase 1.3 (responsive layout) together satisfy 1.4.10; manually verify reflow at 320 CSS px width and 200 % zoom.
    - **1.4.12 Text Spacing.** No CSS rule may break when users override `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, `paragraph-spacing: 2em`. Test once per surface.
    - **4.1.3 Status Messages.** Add `aria-live="polite"` to: filter result counts ("12 tasks match"), optimistic mutation feedback ("Task created"), AI suggestion arrival, and the chat drawer (already present at `aiChatDrawer:124–133`).
    - **`forced-colors` / Windows High Contrast.** Replace background-image-based affordances (drop hints, gradient scroll fade) with `border` and `background-color` so they survive forced-colors mode; use `forced-color-adjust: none` only where unavoidable (the brand logo).
    - **`prefers-reduced-motion`.** Wrap every motion (drag lift, modal slide, skeleton-to-content cross-fade, toast slide) in `@media (prefers-reduced-motion: no-preference) { … }` or use AntD's `motion` token set to none when the media query matches.
    - **Decorative SVGs.** Set `alt=""` (or `aria-hidden="true"` on inline SVG) on `bug.svg`, `task.svg`, the auth `left.svg` / `right.svg` decorations, and the brand sparkle when next to a visible label.
    - **Tooling.** Add `jest-axe` to the test suite and assert zero violations on every page render in `App.test.tsx`, `board.test.tsx`, `project.test.tsx`, `taskModal/index.test.tsx`, `aiChatDrawer/index.test.tsx`. Add `eslint-plugin-jsx-a11y` to `eslint.config.mjs` so regressions are caught at lint time.

5. **Loading states.**
    - Replace bare `<Spin>` blocks with `<Skeleton.Input>` / `<Skeleton.Avatar>` / `<Skeleton.Paragraph>` matching the eventual layout for: project list rows, board columns, task cards, brief drawer sections, chat drawer initial load, AI assist panel.
    - Add throttled spinners (only render after 250 ms) so fast local-engine responses do not flash a spinner at all.

6. **Empty states.**
   Build a reusable `<EmptyState illustration="…" title="…" description="…" cta={…} />` component and use it on:
    - Project list with no projects.
    - Board with no columns.
    - Brief drawer when there are no unowned/unstarted tasks (replace the current `<p>` strings).
    - Members popover when the team is empty.
    - Chat drawer initial state (replace the muted-text paragraph at `aiChatDrawer:134–139` with sample-prompt chips users can click).

7. **Error states.**
    - Wrap the routed pages with an `<ErrorBoundary>` showing a friendly message + "Reload" button.
    - On the board, replace the silent failure on `useReactQuery("boards" / "tasks")` with a top-of-board `<Alert>` and a "Retry" button (mirrors the existing project-list error path at `src/pages/project.tsx:90–94`).

8. **Microinteraction polish.**
    - Card lift on drag start (`box-shadow` + slight `scale`).
    - Drop placeholder with dashed border + tinted background.
    - Optimistic-create animation: new card slides in from the input and lands in the column.
    - Subtle skeleton-to-content cross-fade when AI suggestions resolve.

### Phase 4 — Stretch

1. **Command palette (`Cmd/Ctrl+K`).** **[Shipped: `src/components/commandPalette/index.tsx`.]**
   A single search box that can: jump to a project, open a task by name, run any AI action (Brief, Ask, Draft), toggle Board Copilot. Reuses the existing `semanticSearch` engine.

2. **Per-user preferences.**
    - Default sort and filter on the project list.
    - Saved filter presets on the board (e.g. "My open bugs").
    - Density toggle (Comfortable / Compact) for the board.

3. **Activity / notifications drawer.**
   A shared `useActivityFeed` hook, surfaced as a bell icon in the header. Initially fed by local optimistic-update events so it can ship before any backend.

4. **In-app onboarding.**
   First-login tour that points at: Create project → Open board → Create task → Open Board Copilot. Two tooltips per screen, persisted as `dismissed` in `localStorage`.

5. **Inline-edit on task cards.**
   Click on the title to rename without opening the modal; press Esc to revert. Reuses the same mutation as the modal.

6. **Sticky columns + horizontal mini-map.**
   For boards with many columns, a thin overview strip at the top showing the user's current viewport — a known Jira-board affordance.

7. **Reporting page (placeholder route).**
   Once the project detail tabs exist (Phase 2.5), reserve `/projects/:id/reports` for a future velocity / burndown chart.

---

## 2.A Cross-cutting best-practice rules

Each rule below is a contract every component must satisfy after the relevant phase ships. They are extracted out of the per-screen sections so we can audit them globally.

### 2.A.1 Forms

Every input must declare:

- A `<label>` (`<Form.Item label>`), never label-by-placeholder.
- `autocomplete` (e.g. `username`, `current-password`, `new-password`, `email`, `name`, `organization`) so password managers and OS autofill work.
- `inputMode` for soft-keyboard hint (`email`, `numeric`, `search`, `text`).
- `enterKeyHint` (`go`, `search`, `send`, `done`) so mobile keyboards show the right action.
- `required` (real attribute, not just rule) and `aria-invalid` when in error.
- `aria-describedby` linking to inline help text and inline errors.

Form-level rules:

- One field per row on `xs`/`sm`, two columns on `md+` only when fields are logically grouped (e.g. first/last name).
- Submit button label must match the action verb ("Create project", "Save changes", "Log in"), never "Submit" or "OK".
- Disable the submit button only when the form is busy, not when invalid (let the click trigger validation so users discover what is wrong).
- Show an **error summary** at the top with anchor links to fields, in addition to inline errors (GOV.UK pattern, also satisfies WCAG 3.3.1 / 3.3.3).
- Trap focus inside the form's modal/drawer and restore it on close.
- Confirm before discarding unsaved changes (`useUnsavedChangesGuard` hook reading from `Form.isFieldsTouched()`); applies to `TaskModal`, `ProjectModal`, `AiTaskDraftModal`.

### 2.A.2 Touch & mobile

- Minimum hit target: 44 × 44 CSS px on touch viewports (use `min-block-size: 44px` on `Button` via the AntD theme `controlHeight` token; raise from 32 to 44 only on `pointer: coarse`).
- Honor `env(safe-area-inset-*)` on the header and fixed footer so the UI clears the iOS notch and gesture bar.
- The board's horizontal scroll must work with touch swipe; do not intercept `touchstart` for drag-and-drop (`@hello-pangea/dnd` handles this — verify with a real device after Phase 2.3).
- Long-press to enter drag mode on touch (this is `hello-pangea/dnd` default; document it).
- Bottom-sheet variant of `AiChatDrawer` and `TaskModal` on `xs`/`sm` so the keyboard does not push the form off-screen.

### 2.A.3 Motion, color-scheme, and contrast preferences

- Wrap every motion in `@media (prefers-reduced-motion: no-preference)` or set AntD's `motion` token to `false` when the media query matches.
- Read `prefers-color-scheme` on first paint and pick AntD's `defaultAlgorithm` vs `darkAlgorithm` accordingly; the user's explicit choice (Phase 1.2) overrides the OS.
- Read `prefers-contrast: more` and switch to a higher-contrast token bundle (thicker borders, ≥ 7 : 1 text contrast).
- All motion durations: short interactions (focus ring, hover) = 100 ms ease-out; medium (toasts, skeleton fades) = 200 ms ease-out; large (drawer slide) = 300 ms ease-in-out.

### 2.A.4 Feedback & destructive actions

- **Toasts (`message` / `notification`)** for non-blocking outcomes ("Task created", "Couldn't save — retry"). Place top-right, auto-dismiss after 4 s, persist on hover. Each destructive toast carries an **Undo** action for at least 5 s; on click, replay the inverse mutation against the React Query cache (covers create, update, delete on tasks/columns/projects).
- **Modal.confirm** only for irreversible operations that cannot be undone (e.g. permanent project deletion). For reversible ones (delete column with no tasks, archive task), use a toast with Undo instead — far better than the current `Modal.confirm` everywhere pattern at `src/components/projectList/index.tsx:71–81`, `src/components/column/index.tsx:57–67`, `src/components/taskModal/index.tsx:62–72`.
- **Inline alerts** for state that persists with the surface (e.g. "Board Copilot disabled for this project"); never blocks input.
- **Optimistic updates** must show an immediate visual change, a quiet inline spinner (only after 250 ms), and roll back with a toast on failure.

### 2.A.5 Surface taxonomy (drawer vs. modal vs. popover vs. inline)

Right now, the AI features mix all four. Adopt one rule per intent:

| Intent                                            | Surface                                             | Examples                                     |
| ------------------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Focused edit / required confirmation              | **Modal** (centered, focus-trapped)                 | Edit task, Create project, delete-confirm    |
| Side panel that augments the main view            | **Drawer** (right, dismissible, non-modal on `md+`) | Board brief, Ask Copilot chat, Activity feed |
| Quick lookup / picker, dismissed on outside click | **Popover**                                         | Members, Projects switcher, avatar menu      |
| Suggestion or status that lives inside the form   | **Inline panel/Card**                               | AI assist on task modal                      |

Apply: move `AiTaskDraftModal` to a drawer (it is augmentation, not blocking confirmation) **only if** breakdown selection still fits; otherwise document why it stays a modal. Keep `BoardBriefDrawer` and `AiChatDrawer` as drawers. Keep `TaskModal` and `ProjectModal` as modals.

### 2.A.6 Internationalization readiness

We will not ship i18n yet, but every change in this plan must keep the door open:

- No string concatenation in JSX (`Edit · {taskName}` is fine because it is a template, but `"Hi, " + user.username` would not be). Use ICU placeholders.
- Avoid hard-coded plurals ("1 tasks") — wrap counts in a `<Plural value={n} one="task" other="tasks" />` helper, even if the implementation is a stub today.
- Avoid baked-in date/number formats — use `Intl.DateTimeFormat` / `Intl.NumberFormat` instead of `dayjs(...).format("YYYY-MM-DD")` (e.g. `src/components/projectList/index.tsx:135–139`).
- Logical CSS properties only: `margin-inline-start` instead of `margin-left`, `padding-block` instead of `padding-top`/`bottom`, so an RTL flip is one `dir="rtl"` away.
- Do not embed text inside SVGs that would need to be translated (the auth `left.svg`/`right.svg` decorations are safe; future illustrations must follow the same rule).

### 2.A.7 Performance UX

The point of these is that they are _felt_ by the user even if no benchmark moves.

- **Route-level code splitting.** Convert `src/routes/index.tsx` to use `React.lazy(() => import(...))` per page; wrap each lazy boundary in a route-shaped `Suspense fallback={<Skeleton …/>}`.
- **Prefetch on hover.** When a user hovers a row in `ProjectList`, prefetch `["boards", { projectId }]` and `["tasks", { projectId }]` via `queryClient.prefetchQuery`. Same for the project switcher popover.
- **Throttled spinners.** Use a `useDelayedFlag(loading, 250)` hook so spinners only render after 250 ms; this kills the chat/AI panel "flash of spinner" on the local engine.
- **`React.memo` for cards and rows.** `Column` and the project list `<Avatar>` cell re-render every keystroke today; memoize after the bucket-by-column refactor (Phase 1.6).
- **Image lazy loading.** All `<img>` and `<Avatar src>` get `loading="lazy"` and explicit width/height to avoid CLS.
- **Skeleton shape match.** Skeletons must match the final element's bounding box to avoid layout shift on resolve. Quantify: target Cumulative Layout Shift (CLS) < 0.1, Interaction to Next Paint (INP) < 200 ms, Largest Contentful Paint (LCP) < 2.5 s on a 4× CPU-throttled run.
- **Bundle budget.** Keep the initial JS bundle below 200 KB gzipped after Phase 1; add `rollup-plugin-visualizer` to `vite.config.ts` so regressions are visible in PRs.

### 2.A.8 AI provenance, transparency, and undo

The PRD already enforces validation; the UI should make the provenance obvious.

- After a user clicks **Apply** on an AI suggestion, mark the affected field with a small `Suggested by Copilot` badge until the user edits it. This satisfies "match between system and the real world" and gives users a hook to retract.
- Every AI write must be undoable via the same toast/Undo pattern (see 2.A.4). Tasks created by Draft with AI carry a hidden `meta.source = "ai"` for analytics and easy bulk-rollback.
- The chat drawer must hide raw tool-call payloads from end users (`src/components/aiChatDrawer/index.tsx:141–166`) and surface them only behind a "Show details" toggle. This is both a UX concern (clutter) and a safety concern (do not paint internal ids in front of users).
- Confidence percentages must be paired with a plain-language band ("Low / Moderate / High") so users without a probability intuition can act.
- Provide a "Why?" affordance on every AI suggestion that opens a popover with the same `rationale` text already returned by the engine — this turns "magic" into "machine following these rules".

### 2.A.9 Keyboard shortcut catalog (single source)

Define every shortcut once in `src/constants/shortcuts.ts` and surface them in a help dialog (Phase 4 onboarding). Initial set:

| Shortcut               | Where             | Action                                        |
| ---------------------- | ----------------- | --------------------------------------------- |
| `Cmd/Ctrl+K`           | Global            | Open command palette                          |
| `?`                    | Global            | Open shortcut help                            |
| `g p`                  | Global            | Go to projects                                |
| `g b`                  | Project page      | Go to board                                   |
| `c`                    | Board             | Create task in focused column                 |
| `Esc`                  | Modal/Drawer      | Close (with unsaved-change guard)             |
| `e`                    | Focused task card | Open edit modal                               |
| `Space / arrows / Esc` | Focused task card | Drag with keyboard (delegated to dnd library) |

Use a single `useShortcut(combo, handler)` hook so the catalog cannot drift from the implementation.

### 2.A.10 Visual hierarchy & typography

- 4-step type scale anchored at the body size (12 / 14 / 16 / 20 / 24 / 32 px) — never invent a new size at use site.
- Maximum two type weights per surface (regular + semibold).
- Maximum one accent color per surface; status uses AntD's semantic palette (`success`, `warning`, `error`, `info`) plus icons, never raw hex.
- Line length capped at 75 ch for body copy (chat messages, brief descriptions, modal notes).
- Use AntD's `Typography.Title level={1..5}` instead of bare `<h1>`/`<h4>` so font-size, line-height, and margin come from a single token bundle.

### 2.A.11 Information architecture & navigation

- Every page has a unique `<title>` (`useTitle` hook already exists in `src/utils/hooks/useTitle.ts` — extend it to set `<meta name="description">` per page).
- Every nested page shows a breadcrumb (Phase 2.5).
- Active route gets an accessible "current page" treatment (`aria-current="page"`).
- Browser back never loses scroll position on the project list or board (use `react-router`'s `ScrollRestoration`).
- URLs are the source of truth for filter state (already true via `useUrl`); never duplicate state into Redux for filters.

---

## 2.B Heuristics map — Nielsen × this plan

This table demonstrates that no heuristic is left unaddressed.

| Heuristic                               | Plan items                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Visibility of system status             | Phase 2.3 (header tier with Copilot status), 2.A.4 (toasts), 2.A.7 (throttled spinners), 3.5 (skeletons), 3.4 (`aria-live`) |
| Match between system & real world       | Phase 3.1 (microcopy), 2.A.8 ("Suggested by Copilot" badge), 2.A.6 (locale-aware dates)                                     |
| User control & freedom                  | 2.A.4 (Undo), 2.A.1 (unsaved-changes guard), 2.A.9 (`Esc` everywhere)                                                       |
| Consistency & standards                 | 1.1, 1.4 (tokens + typography), 2.A.5 (surface taxonomy), 3.1 (microcopy), 2.A.10 (type scale)                              |
| Error prevention                        | 2.A.1 (real labels + autocomplete), 2.A.4 (replace blocking confirms with undoable toasts), 2.7 (caps-lock hint)            |
| Recognition rather than recall          | 2.A.2 (visible touch affordances), 2.A.9 (shortcut help dialog), 2.4 (assignee/points/epic on cards)                        |
| Flexibility & efficiency                | Phase 4.1 (command palette), 2.A.9 (shortcuts), 4.5 (inline edit), 2.A.7 (prefetch on hover)                                |
| Aesthetic & minimalist design           | Phase 2.3 (board H1 declutter), 2.A.10 (one accent per surface), 2.A.8 ("Show details" hides tool calls)                    |
| Help users recognize, diagnose, recover | 2.A.4 (toast with Undo), 3.4 (3.3.1/3.3.3 inline errors + summary), 3.7 (error boundary + Retry)                            |
| Help & documentation                    | 2.A.9 (shortcut help dialog), Phase 4.4 (in-app onboarding), 2.A.8 ("Why?" rationale popover)                               |

---

## 2.C Tooling & governance

To keep the design from drifting after these phases ship:

- **Storybook** for every component in `src/components/**`. Each story documents `default`, `loading`, `empty`, `error`, `disabled`, and `with content overflow` states.
- **Visual regression** via `@storybook/test-runner` + Playwright snapshots, run in CI on every PR.
- **`jest-axe`** assertion in every page and modal test (`App.test.tsx`, `board.test.tsx`, `project.test.tsx`, `taskModal/index.test.tsx`, `aiChatDrawer/index.test.tsx`, `aiTaskDraftModal/index.test.tsx`, etc.). The `jira-react-test-development` skill already targets 100 % coverage; the same gate enforces zero a11y violations. **[In place: 31 axe tests in `src/__tests__/aiAccessibility.strict.test.tsx` covering AiChatDrawer, AiTaskAssistPanel, BoardBriefDrawer, AiTaskDraftModal, AiSearchInput, NudgeCard, MutationProposalCard, CommandPalette, EngineModeTag, CitationChip, AiMatchStrengthBadge.]**
- **`eslint-plugin-jsx-a11y`** added to `eslint.config.mjs`; failures block CI.
- **Design tokens documented** at `docs/design-tokens.md` (single source for spacing, color, type, motion). Storybook reads from the same module.
- **Component contribution checklist** in `CONTRIBUTING.md`: passes a11y, ships story, supports keyboard, supports `prefers-reduced-motion`, has loading/empty/error states, ships tests.
- **Analytics hooks (privacy-respecting).** Wrap mutations in a `track(event, payload)` no-op today (no third-party endpoint), so the AI surfaces and the new toasts have a single instrumentation point we can wire up later.
- **Dependency hygiene.** `lodash` is currently imported in full at `src/components/taskModal/index.tsx:3`; after Phase 1, replace with `lodash-es` named imports or native equivalents to keep the bundle budget honest.

---

## 3. Suggested execution order

The order below batches changes that share files so we do not churn the same area twice. Cross-cutting rules (Section 2.A) and the heuristics map (Section 2.B) are applied within each Phase, not as a separate pass.

1. **Tooling first.** Add `eslint-plugin-jsx-a11y`, `jest-axe`, `rollup-plugin-visualizer`, and the design-tokens doc skeleton (Section 2.C). Ship Storybook scaffolding so all subsequent components land with stories from day one. **[Partially complete: `jest-axe` in place (31 tests in `src/__tests__/aiAccessibility.strict.test.tsx`); code splitting via `lazy()` shipped (`src/routes/index.tsx`); service worker shipped (`public/sw.js`). Storybook scaffolding and `rollup-plugin-visualizer` remain open.]**
2. Phase 1.1, 1.2, 1.4, 1.5 — theme tokens + ConfigProvider + remove the rem hack + `prefers-color-scheme` wiring (2.A.3). Ship behind the existing visual tests; expect a thin pass of pixel adjustments.
3. Phase 1.3, 1.6 — responsive layout + tasks-by-column grouping. Land 2.A.2 (touch targets, safe-area-inset) at the same time.
4. Phase 2.1, 2.5 — header + project detail shell collapse (both touch the global chrome). Land 2.A.11 (breadcrumbs, `aria-current`, `ScrollRestoration`) here.
5. Phase 2.2 — project list redesign + 2.A.7 (route-level code splitting + prefetch on hover) since both touch the same files.
6. Phase 2.3, 2.4 — board page + task card redesign (single thread because they share `Column`). Land 2.A.4 (toast + Undo for column/task deletes), 2.A.9 (board shortcuts), and the 2.5.7 keyboard drag-and-drop.
7. Phase 2.6 — task modal split-pane + 2.A.8 ("Suggested by Copilot" badge, "Why?" affordance) + 2.A.1 (unsaved-changes guard, error summary).
8. Phase 2.7 — auth screens with the full 2.A.1 / WCAG 3.3.7 / 3.3.8 contract.
9. Phase 3 — polish, accessibility, microcopy in one pass per surface; this is also when `jest-axe` assertions and visual regression baselines get added per component.
10. Phase 4 — pick the highest-leverage stretch item (likely the command palette, since it reuses Board Copilot infrastructure and shortcut catalog from 2.A.9).

---

## 4. Risks and dependencies

- **AntD v6 token migration.** Removing the 62.5 % hack and inlining tokens will cause one round of pixel-level visual diffs. Tests that snapshot DOM are fine; tests that assert pixel sizes will need updating.
- **Test coverage.** The repo carries a `jira-react-test-development` skill aiming for 100 % coverage. Each phase needs to keep the existing tests green and add tests for the new affordances (e.g. keyboard handlers on the new task card, `<Avatar>` rendering in the project list).
- **Board Copilot contract.** Phase 2.3's `Dropdown.Button` consolidation must not break the existing `aria-label` strings the AI tests rely on (`src/components/aiChatDrawer/index.tsx:96–106`, `src/components/aiTaskDraftModal/index.tsx:172–189`, `src/pages/board.tsx:111–151`). Keep the labels stable.
- **Drag-and-drop keyboard support.** `@hello-pangea/dnd` already supports keyboard, but we have not wired any user-facing instructions; that is part of Phase 3.4 and should land alongside accessible task-card focus styles.
- **Routing flash.** Phase 2.5 (project detail collapse) must preserve the existing `/projects/:projectId/board` URL — the navigation hook in `src/pages/projectDetail.tsx:45–49` redirects to `board`; the new tabbed shell needs to keep that redirect or the AI tests that mount the board route will fail.

---

## 5. Out of scope for this plan

- Backend changes (the json-server mock + the optional `REACT_APP_AI_BASE_URL` proxy stay as-is).
- New AI capabilities — Phase 4 only repackages existing Board Copilot features into a command palette.
- A full i18n release. We commit to **i18n readiness** (Section 2.A.6: ICU placeholders, `Intl.*` formatters, logical CSS properties, no string concatenation in JSX), but leaving the actual translation pipeline (`react-intl` / `i18next`, message-id extraction, locale switcher) out of scope.

---

## 6. Acceptance criteria — how we know the plan worked

Each criterion below is testable. Tie-break ties to user-impact, not engineer-impact.

- **Lighthouse (mobile profile, throttled).** Performance ≥ 90, Accessibility = 100, Best Practices ≥ 95 on `/login`, `/projects`, `/projects/:id/board`.
- **Axe (`jest-axe`).** Zero violations on every page test and every modal/drawer test.
- **Core Web Vitals (4× CPU throttling, simulated 4G).** LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on the same three routes.
- **Bundle.** Initial JS ≤ 200 KB gzipped after Phase 1; ≤ 250 KB after Phase 2 even with Storybook in dev mode.
- **Touch.** Every interactive element ≥ 44 × 44 CSS px on `pointer: coarse` viewports; verified via a Playwright spec that walks every `button, a, [role="button"], input, select, textarea`.
- **Keyboard.** Every flow that the mouse can complete is completable from the keyboard alone, including drag-and-drop. Verified by a Playwright keyboard-only spec covering: log in, create project, open board, create task, drag task to next column, edit task, apply AI suggestion, delete task with Undo.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, no element animates duration > 0.01 ms (asserted by Playwright reading `animationDuration`/`transitionDuration` on transitioning elements).
- **High contrast / forced colors.** `forced-colors: active` Playwright spec verifies all interactive controls remain visible and labeled.
- **Color-blind safety.** Manual review with the Chromium `vision-deficiency` emulation flag for `protanopia`, `deuteranopia`, `tritanopia` on the board and the AI breakdown modal; every type signal must be readable without color.
- **Microcopy lint.** A `scripts/lint-microcopy.ts` checker grep-fails on banned strings (`Submit`, `OK`, `Login`, `Register`, ALL-CAPS button labels, `Are you sure?` without an Undo).
- **Heuristics review.** Each PR description maps the change back to Section 2.B (heuristics map) and Section 2.A (cross-cutting rules) by name. Reviewers reject PRs that fail to do so.

---

## 7. Plan ↔ external rubric mapping

This is the explicit answer to "does the plan embody UI/UX best practice?". Each row demonstrates that an external rubric line is covered.

| External rubric                                      | Plan section(s)                             |
| ---------------------------------------------------- | ------------------------------------------- |
| Nielsen 1 — Visibility of system status              | 2.A.4, 2.A.7, 3.5, 3.7                      |
| Nielsen 2 — Match real world                         | 2.A.6, 2.A.8, 3.1                           |
| Nielsen 3 — User control & freedom                   | 2.A.1, 2.A.4, 2.A.9                         |
| Nielsen 4 — Consistency & standards                  | 1.1, 2.A.5, 2.A.10, 3.1                     |
| Nielsen 5 — Error prevention                         | 2.A.1, 2.A.4, 2.7                           |
| Nielsen 6 — Recognition over recall                  | 2.4, 2.A.2, 2.A.9                           |
| Nielsen 7 — Flexibility & efficiency                 | 4.1, 4.5, 2.A.7, 2.A.9                      |
| Nielsen 8 — Aesthetic & minimalist                   | 2.3, 2.A.10, 2.A.8                          |
| Nielsen 9 — Recover from errors                      | 2.A.4, 3.4, 3.7                             |
| Nielsen 10 — Help & documentation                    | 2.A.9, 4.4, 2.A.8                           |
| WCAG 1.4.3 / 1.4.11 Contrast                         | 3.3, 3.4                                    |
| WCAG 1.4.1 Use of Color                              | 3.4, 2.A.8                                  |
| WCAG 1.4.10 Reflow / 1.4.4 Resize                    | 1.1, 1.3                                    |
| WCAG 1.4.12 Text Spacing                             | 3.4                                         |
| WCAG 2.1.1 Keyboard                                  | 2.4, 3.2, 3.4, 2.A.9                        |
| WCAG 2.4.3 / .7 / .11 / .12 / .13 Focus              | 3.4                                         |
| WCAG 2.5.5 / 2.5.8 Target size                       | 2.A.2, 3.4                                  |
| WCAG 2.5.7 Dragging movements                        | 2.3, 3.4                                    |
| WCAG 3.2.6 Consistent help                           | 2.A.9, 4.4                                  |
| WCAG 3.3.1 / 3.3.3 Error identification & suggestion | 2.A.1, 3.4, 2.7                             |
| WCAG 3.3.7 Redundant entry                           | 2.7, 3.4                                    |
| WCAG 3.3.8 Accessible authentication                 | 2.7                                         |
| WCAG 4.1.3 Status messages                           | 3.4, 2.A.4                                  |
| `prefers-reduced-motion`                             | 2.A.3, 3.8                                  |
| `prefers-color-scheme`                               | 1.2, 2.A.3                                  |
| `prefers-contrast`                                   | 2.A.3                                       |
| `forced-colors`                                      | 3.4                                         |
| GOV.UK error summary pattern                         | 2.A.1, 2.7, 3.4                             |
| Material 3 state layers                              | 2.4 (hover/focused/pressed states on cards) |
| Refactoring UI / type & spacing scale                | 1.1, 2.A.10                                 |
| Inclusive Components — accessible drag-and-drop      | 3.4, 2.A.9                                  |
| Core Web Vitals (LCP / INP / CLS)                    | 2.A.7, 6                                    |
| Storybook + visual regression governance             | 2.C                                         |
