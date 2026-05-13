# UI todo — phased UI / UX plan

**Status as of 2026-05-11:** Reconciled against `main` together with [`architecture-todo.md`](architecture-todo.md) — removed stale Source TODO / line-number finger-pointing that `rg` no longer supports (BE `backend/app` has **zero** `TODO`/`FIXME`/`XXX`; FE has one intentional **v3** docblock on autonomy in `src/components/aiChatDrawer/index.tsx` ~303–316). Earlier 2026-05-05 narrative remains directionally accurate: Phase 1 foundations, key Phase 3 tooling, and Phase 4 command palette are shipped. **Release posture:** only **GA Blocker §1** in [`release-todo.md`](release-todo.md) remains an open *code* gate; non-GA rows through §16e are **closed in repo** per that file — this UI plan stays explicitly subordinate to §1 where features assume a real `MutationProposal` / undo loop.

**Release-tier scoping.** Most items in this doc are general-purpose UX work and **do not gate any Board Copilot release tier**. Priority is encoded by phase ordering (Phase 1 foundations → Phase 4 stretch). The handful of items that intersect with [`release-todo.md`](release-todo.md) carry an explicit `Gates:` callout — search for `Gates:` to surface them.

### Open backlog grouping (2026-05-11)

- **Immediate — GA §1–adjacent (Board Copilot correctness):** Keep UX language honest while [`release-todo.md`](release-todo.md) **§1** is open — **`MutationProposalCard` stays env-gated** (`REACT_APP_AI_MUTATION_PROPOSALS_ENABLED`, default off); **§20f** / Phase **2.8** Copilot shell should not imply accept/undo works remotely until BE lands; **2.A.4** / **2.A.8** bullets that describe AI mutation Undo/`Suggested by Copilot` end-to-end stay tied to §1 for the server half.
- **Immediate — product UX (no GA code dependency):** **§20a** move autonomy into real Settings + drive allowed levels from `AgentMetadata.allowed_autonomy` once v3 contracts exist; ~~**§20b** extend `AiFeedbackPopover` parity to `AiTaskAssistPanel` / `BoardBriefDrawer`;~~ **[Complete on branch `(no branch)` (verify-feedback-parity verifier handoff recorded no git branch): `src/__tests__/aiCopilotSurfaceFeedback.strict.test.tsx`, `src/__tests__/aiAccessibility.strict.test.tsx`, `aiTaskAssistPanel`, `boardBriefDrawer`, `aiFeedbackPopover`, `microcopy.feedback.*` en/zh-CN — see §1.2 item 20b.]** Phase **1.4–1.5** typography + header brand token follow-through; Phase **3.3** contrast cleanup; **2.C** promote `eslint-plugin-jsx-a11y` to fail CI (`--max-warnings 0`) now that `frontend-ci.yml` runs ESLint.
- **Later:** Phase **2** surface rebuilds (header IA, project list scale, board chrome consolidation), Storybook + `rollup-plugin-visualizer`, remaining Phase **3** motion/a11y debt, Phase **4** stretch items beyond the shipped command palette.

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

2. ~~**No design system — magic numbers everywhere.**
   Spacing alternates between `rem`, raw `px`, and unitless numbers (`marginBottom: 16`, `gap: 8`, `style={{ fontSize: "0.85rem" }}`, `style={{ fontSize: "1.4rem" }}`). Colors are inline (`rgba(22, 119, 255, 0.08)` in `src/components/aiChatDrawer/index.tsx:179–181`, `rgba(0,0,0,0.5)` in `src/components/aiTaskAssistPanel/index.tsx:179`, `rgb(94, 108, 132)` in `src/layouts/authLayout.tsx:17`). There is no `tokens.ts` and no shared `theme` object. Every new component reinvents its own spacing.~~ **[Largely complete: `src/theme/tokens.ts` exports `space`, `palette`, `brand`, `accent`, `aurora`, `semantic`, `fontSize`, `fontWeight`, `radius`, `motion`, `shadow`, `breakpoints`, `zIndex`, `blur` scales; `src/theme/antdTheme.ts` derives the AntD `ConfigProvider` token bundle from the same module. The AI surfaces and the new shared cards (`MutationProposalCard`, `CitationChip`, `EngineModeTag`) source from tokens. A handful of inline-style holdouts remain in pre-Phase-1 components (`projectList`, `column`, `header`, `taskModal`, `boardBriefDrawer`); fold them in as each Phase-2 surface is rebuilt.]**

3. ~~**Layout is desktop-only and not responsive.**
   `src/layouts/mainLayout.tsx:7–18` declares `min-width: 1024px`, `max-height: 1440px`, and `overflow: scroll` on `<main>`. The first rule blocks mobile / tablet entirely; the third produces a double scrollbar (the page already scrolls inside `ColumnContainer`). `src/layouts/authLayout.tsx:35–37` sizes its background images off `calc((100vw - 40rem)/2)` — once the viewport drops below `40rem` the math goes negative and the SVGs disappear or overflow.~~ **[Complete: `min-width: 1024px` and `max-height: 1440px` removed from `mainLayout.tsx` (line 73 comment confirms removal).]**

4. **The information architecture buries primary navigation.**
    - "Projects" navigation only exists as a `<Popover>` inside the project detail aside (`src/pages/projectDetail.tsx:39–42`, `src/components/projectPopover/index.tsx:49–53`). On the project list page there is no project switcher at all.
    - "Members" is a bare `<span>Members</span>` next to the logo (`src/components/memberPopover/index.tsx:42`). It looks like a label rather than an interactive element, is not focusable, and is not labeled as a button.
    - "Logout" is hidden under a dropdown labeled `Hi, {username}` with no chevron, no avatar, and no menu icon (`src/components/header/index.tsx:89–96`).
    - "Board Copilot" gets two separate toggles (global header switch in `src/components/header/index.tsx:67–88` plus a per-project switch in `src/pages/board.tsx:111–151`) plus three more launchers (Brief, Ask, Draft with AI) — all stacked into the board H1 row.

5. ~~**The project detail "shell" is a duplicate layout.**
   `src/layouts/mainLayout.tsx` already provides a header + `<main>` shell, and then `src/pages/projectDetail.tsx:51–63` adds another `display: grid; grid-template-columns: 16rem 1fr` shell underneath, so we have two competing layouts (header layout + sidebar layout) and the sidebar contains exactly one menu item ("Board") plus the popover. There is also a stray typo `5 px` in the box-shadow at `src/pages/projectDetail.tsx:15` which silently disables the shadow.~~ **[Complete on branch `orch/todo-sweep-566b/fix-project-detail-shell`: single-column shell + AntD `Breadcrumb` (`Projects` link, `aria-current="page"` on project name), `shadow.sm` token (no `\b5\s+px\b`), `/projects/:id` → `.../board` redirect — tests `src/pages/projectDetail.test.tsx`, `src/__tests__/projectDetailPage.breadcrumb.test.tsx`; i18n `microcopy.breadcrumb.projects` en/zh-CN.]**

### 1.2 Component-level problems

6. **Project list follow-through.**
   `src/components/projectList/index.tsx` and `src/components/projectCard/index.tsx` already replaced the old AntD table with responsive cards, a real heart toggle, `MoreOutlined` actions, skeletons, and an empty state. The remaining gaps are narrower:
    - Cards surface the manager only; there is still no member-count / avatar-group context for quickly judging project scale.
    - The grid renders the whole list; larger workspaces still need pagination or virtualization.
    - AI search and structured filters now share one shell, but the information architecture still blurs "semantic search mode" versus ordinary filtering.

7. **Board page — toolbar overload.**
   `src/pages/board.tsx:104–152` renders, in one flex row: project name H1, a "Project AI" switch with explanatory tooltip, a "Brief" button, and an "Ask" button — all when the global AI toggle is also on. This is on top of the search panel rendered immediately below (`:153–178`). At ~1024 px width these wrap unpredictably. The H1 also reads "..." while loading (`:107–110`) instead of using a `Skeleton` line.

8. ~~**Board cards are visually under-built.**~~ **[Largely complete: most of Phase 2.4 has shipped on the existing card.]**
   `src/components/column/index.tsx`:
    - ~~A `TaskCard` has only a task name and a small bug/task icon. No assignee avatar, no story-points pill, no epic chip, no type label.~~ **[Complete: the `TaskCard` (lines 407–500) renders an `EpicTag` (`:432–438`), `CardTitle` (`:440`), `TaskTypeBadge` with explicit `Bug` / `Task` text plus an icon (`:446–466`), `StoryPointsTag` pill (`:471–478`), and a `UserAvatar` for the coordinator (`:479–500`). The button has `aria-label="Open task <name>"` so the icon is no longer the only screen-reader signal.]**
    - ~~There is no hover/focus state and no visual indication the whole card is clickable.~~ **[Complete: `TaskCardOuter` is a real `<button type="button">` (`:418–429`); the global `:focus-visible` ring plus `MaterialDesign 3` state-layer pattern give hover and keyboard focus styling.]**
    - ~~Column header is `<h4 style={{ textTransform: 'uppercase' }}>` with no count badge ("To Do · 4").~~ **[Complete: `ColumnTitle` (`:297–306`) is a `Typography.Title level={4}` styled with the design-system tokens; the count badge is now an AntD `<Badge count={filteredTasks.length}>` with `aria-label="<count> tasks in <columnName>"` (`:572–583`).]**
    - ~~The action menu is the literal `"..."` text.~~ **[Complete: now an icon-only AntD `<Dropdown>` trigger using `<MoreOutlined />` (`:384–396`).]**
    - ~~`TaskContainer` hides scrollbars via `::-webkit-scrollbar { display: none }`.~~ **[Complete: `TaskContainer` (`:100–107`) is now `overflow-y: auto`; native scrollbar visibility is preserved cross-browser.]**
    - **Remaining:** task age indicator (Phase 2.4 spec) and a stronger hover elevation; both are minor polish.

9. **Filter / search row.**
   `src/components/taskSearchPanel/index.tsx`:
    - ~~`tasks?.map(... return null)` is used for its side-effect of populating `types` and `coordinators` arrays on every render (`:35–44`); the lists then survive across renders unfiltered.~~ **[Complete: both `coordinators` and `types` are now derived through `useMemo` with `Set`-based deduping (`taskSearchPanel/index.tsx:116–140`); the side-effect-in-render is gone.]**
    - The AI search slot is injected as the form's first child with `flexBasis: 100%` so it visually wraps above the inline filters (`src/pages/board.tsx:159–177`). The wrap is fragile — anything else inserted into the form will break the layout.
    - "Reset filter" is a plain text button, not visually grouped with the filters it resets.
    - On the project list (`src/components/projectSearchPanel/index.tsx:19–69`) the Manager `Select` now has `allowClear`, but the "Search this list" input still gives no debounce / loading feedback when the list is large.

10. **Edit Task modal.**
    `src/components/taskModal/index.tsx`:
    - ~~The delete button sits **below** the form, outside the modal footer, styled as a small dashed danger button.~~ **[Complete: `Delete` is now rendered inside the AntD `Modal` footer slot via `footer={(_orig, { OkBtn, CancelBtn }) => …}` (`:228–284`), arranged Delete-left / Save-Cancel-right on tablet+, stacked Save → Cancel → Delete on phone widths so the destructive control sits last for thumb safety.]**
    - The AI assist panel renders inside the same modal body (`:187–212`), causing a tall scrollable area; nothing visually separates the form from the suggestions; and any user keystroke triggers the panel's two debounced AI calls.
    - ~~The modal title is the static string `"Edit Task"` — it could read `Edit · {taskName}` for context.~~ **[Complete: `titleText = '${microcopy.actions.editTask} · ${editingTask.taskName}'` (`:180–182`); the title node also renders the `Bug` / `Task` type tag.]**
    - ~~The Type select silently rebuilds its options from the existing task list (`:35–41, :149–166`) — if there is exactly one type in the dataset the user is forced into a hardcoded `Task / Bug` fallback list instead of seeing the canonical choices.~~ **[Complete: `TaskModal` now uses a canonical `TASK_TYPE_OPTIONS` constant (`Task` / `Bug`) localized through `microcopy.options.taskTypes.*`; dataset shape no longer affects which options render.]**

11. **Auth screens.** **[Phase 2.7 — register password-strength + ToS linkage shipped §11 bullets below; error summary / paste / fluid card / bottom `Link` CTAs shipped on `orch/todo-sweep-566b/auth-form-completion` (see struck bullets). Remaining: Phase 2.7 §7 last bullet — replace absolutely positioned auth background SVGs with a viewport-safe gradient (320px / decorative SVG not `live-ui-verified` in verifier pass).]**
    `src/components/loginForm/index.tsx`, `src/components/registerForm/index.tsx`, `src/layouts/authLayout.tsx`:
    - ~~Inputs only carry placeholders, no `<Form.Item label>`.~~ **[Complete: both forms wrap every field in `<Form.Item label={microcopy.fields.*}>` (`loginForm:62–131`, `registerForm:55–135`); `autoComplete="email" / "current-password" / "new-password" / "username"` and `aria-live="polite"` error region are wired.]**
    - ~~There is no "Show password", no caps-lock hint…~~ **[Partially complete: show/hide password toggle (`loginForm:113–117`, `registerForm:131–135`) and caps-lock hint (`loginForm:31, 94`, `registerForm:24, 108`) are shipped.]** ~~No "Forgot password" link~~ **[Complete: login form now exposes `microcopy.auth.forgotPassword` linking to `/auth/forgot-password`, with a placeholder page rendered from `microcopy.auth.forgotPasswordPlaceholderTitle` + `forgotPasswordPlaceholderBody` (en + zh-CN).]** ~~Remaining: no password-strength indicator on register, no terms-of-service link~~ **[Complete:** register form ships **`PasswordStrengthHint`** (`microcopy.auth.passwordStrength.*`, `constants/passwordStrength.ts`) with `aria-live` status plus color bar beneath the password field; login + register expose **`microcopy.auth.termsLink`** + prefixes/suffixes with a real `<Link to="/auth/terms">`, backed by **`src/pages/terms/index.tsx`** placeholder copy **`microcopy.auth.termsPage*`**.]**
    - ~~The card is a fixed `40rem` wide / `56rem` tall (`authLayout.tsx:43–51`) on a viewport-locked background, so it looks identical regardless of the form length and floats awkwardly when the page becomes very tall (e.g. with the error box expanded).~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion`: fluid card `min(40rem, 100% - 2rem)` + `src/layouts/authLayout.test.tsx` computed-style coverage; 320px decorative SVG stability not `live-ui-verified` per handoff.]**
    - ~~The "Register for an account" CTA is a `NoPaddingButton type="link"` — the same component reused for the column "..." menu and the header logout, so its semantic role is muddied.~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion`: `styled(Link)` bottom CTAs in `login.tsx` / `register.tsx`; `src/__tests__/uiQuality.strict.test.tsx` `getByRole("link", …)`.]**

12. **AI surfaces (Board Copilot).**
    - ~~`AiChatDrawer` (`src/components/aiChatDrawer/index.tsx`) renders raw `tool` messages in a `<pre>` (`:141–166`), which leaks implementation detail to end users. No timestamps, no avatars, no copy button, no "regenerate", no message limit indicator. The send box has no character count even though prompts can be arbitrarily long.~~ **[Complete on branch `orch/todo-sweep-566b/chat-drawer-polish`: tool payloads behind accessible toggle (`microcopy.ai.toolDetailsToggle` / `toolDetailsHide`, `aria-expanded` / `aria-controls`); assistant `<time>` via `Intl.DateTimeFormat`; copy-to-clipboard + `microcopy.ai.copyMessage*`; character-count hint + 90% warning (`characterCountTemplate`, `characterCounterMax`); tests `src/components/aiChatDrawer` + `src/__tests__/aiAccessibility.strict.test.tsx` (jest-axe).]**
    - `AiTaskAssistPanel` (`src/components/aiTaskAssistPanel/index.tsx`) shows the suggested story points as a 2rem-tall number with a confidence Tag and a small Apply button on one row (`:131–157`), then immediately renders the rationale and a list of similar tasks — no visual cards / dividers, so it reads as a wall of text.
    - `BoardBriefDrawer` (`src/components/boardBriefDrawer/index.tsx`) is essentially three tables + lists with raw `<h3>` / `<h4>` headings (`:88–192`). There is no overall summary card, no charts (counts per column would benefit from a tiny bar), and the "Workload" list mixes a username and two tags on one line without visual hierarchy.
    - `AiTaskDraftModal` uses a raw `<input type="checkbox">` for breakdown selection (`:303–313`) instead of AntD's `<Checkbox>`, so it is visually inconsistent and unstyled.
    - The sparkle icon is fine but is sometimes placed before the button label and sometimes inside titles; padding around it varies (8 px hard-coded in some places, none in others).

13. ~~**Column creator and task creator.**
    `src/components/columnCreator/index.tsx:22–37` is a full-size `ColumnContainer` with one large `Input placeholder=" + Create column"` — visually it looks like a real (empty) column, which is confusing. There should be an explicit "+ Add column" affordance that expands into the input on click.
    `src/components/taskCreator/index.tsx:52–80` uses `<a onClick={toggle}>` for "+ Create task" with an eslint-disable comment. The link has no `href`, no role, no keyboard handler — keyboard users cannot create a task.~~ **[Complete: `columnCreator/index.tsx:33–66` ships an explicit `AddColumnButton` (`<button type="button">`) that expands into the `Input` on click; `taskCreator/index.tsx:33–75, 139–146` ships `CreateLink` as a real `<button type="button">` with focus-visible styling, and the AI-draft affordance is an AntD `<Button type="link">`. No `<a onClick>` or `eslint-disable` survives in either file.]**

14. ~~**Members popover.**~~ **[Complete: `MembersPopover` now renders a trigger-level avatar group plus a member-count badge, reads from a shared `useMembersList()` hook (`src/utils/hooks/useMembersList.ts`), and no longer refetches on each popover open.]**

15. **Drag-and-drop affordances.**
    `src/utils/hooks/useDragEnd.ts` (referenced from `src/pages/board.tsx:72–73`) handles the data side, but ~~the visual side is bare: there is no drop placeholder styling, no card "lift" shadow during drag, and no drag-handle on columns (the entire column is a drag target).~~ **[Complete on branch `orch/todo-sweep-566b/dnd-affordances`: task lift (`data-dragging`, `shadow.lift` + scale under `prefers-reduced-motion: no-preference`); dashed primary drop placeholder on `TaskContainer` (`[data-rfd-placeholder-context-id]`); column drag-handle only (`detachDragHandle`, `disableInteractiveElementBlocking` in `board.tsx`, `column-dnd.test.tsx`); tests `src/components/column/index.test.tsx`, `column-dnd.test.tsx`, `src/components/dragAndDrop/index.test.tsx`, `src/pages/board.test.tsx`. Reduced-motion + placeholder pixels not locked by Jest — CSS review only per verifier.]** **Keyboard drag discoverability is now shipped on task cards** via localized hints (`microcopy.dragHints.taskCardKeyboard`) plus `aria-keyshortcuts` in `src/components/column/index.tsx`.

16. ~~**Loading, empty, and error states.**~~ **[Complete: board-page parity shipped.]**
    - ~~Board loading now uses a shape-matched skeleton, but the zero-column state still collapses to `ColumnCreator` rather than a stronger illustrated empty state.~~ **[Complete: zero-column boards now render an illustrated `EmptyState` with a primary "Create your first column" CTA before the fallback `ColumnCreator` affordance.]**
    - ~~Project list empty/error states are much healthier now (`EmptyState`, page-level `Alert` + Retry). The remaining gap is consistency: bring the board's fetch-failure and empty-board treatments up to the same standard.~~ **[Complete: board fetch failures now surface the same top-of-board `Alert` + Retry pattern used on the project list.]**

17. ~~**Microcopy and casing.**
    Mixed throughout: "Log in" vs "Login", "Create Project" vs "+ Create task" (different casing and different verb form), "Confirm" / "Cancel" vs "Submit" / "Cancel" across modals, "Coordinators" / "Managers" plural-as-placeholder vs "Coordinator" / "Manager" singular as labels. Buttons are sometimes verbs ("Search", "Apply"), sometimes nouns ("Brief", "Ask").~~ **[Complete: mechanical value-only sweep shipped across `src/i18n/locales/en.ts`, `src/i18n/locales/zh-CN.ts`, and `src/constants/microcopy.ts` consumers (no new keys). Existing action labels now follow sentence case + consistent verbs (`Log in`, `Sign up`, `Create project`, `Save`) and aligned casing updates (`Team members`, `Open chat`, `Open brief`, `Board brief`, `Copy as markdown`).]**

18. ~~**Routing UX.**
    `src/routes/index.tsx:14–48` always redirects `/` to `/login` and then `HomePage` redirects authenticated users back to `/projects` (`src/pages/home.tsx:11–18`). This causes a brief login-screen flash for already-signed-in users. Combine the checks at the route level.~~ **[Complete: `RootRedirect` now sends authenticated users directly to `/projects` from the index route.]**

19. **Performance smells that show up as UI jank.**
    - ~~`tasks?.filter(...)` in the column render (`src/pages/board.tsx:200–203`) plus the per-card filter in `Column` (`src/components/column/index.tsx:126–137`) are O(N×M) every render. Pre-bucket tasks by `columnId` once.~~ **[Complete: `BoardPage` now builds a `tasksByColumn` `Map` with `useMemo` and passes column-specific tasks into `Column`.]**
    - ~~`AiTaskAssistPanel` re-fires both estimate + readiness AI calls on every value change after a 600 ms debounce (`src/components/aiTaskAssistPanel/index.tsx:58–104`). With the local engine that is cheap, but the visible spinner cycling looks unstable. Throttle the spinner (only show it after 250 ms).~~ **[Complete: `useDelayedFlag(active, 250)` now gates visible loading affordances across `AiTaskAssistPanel`, `AiChatDrawer`, and `BoardBriefDrawer`, so fast local responses no longer flash spinners while underlying loading state/analytics remain unchanged.]**
    - ~~`useReactQuery<IMember[]>("users/members")` is called from at least four components (`board.tsx`, `project.tsx`, `taskModal`, `memberPopover`); ensure it is a single shared key and cached, and stop refetching on popover open.~~ **[Complete: all four surfaces now consume `useMembersList()`, which centralizes the key (`["users/members"]`) and applies a shared `staleTime` cache window.]**

20a. **Autonomy metadata / settings follow-through.**
    `AiChatDrawer` now exposes a visible autonomy selector for `suggest` / `plan`, with `auto` present but disabled until preapproved tools ship (see `AUTONOMY_OPTIONS` docblock ~303–316 in `src/components/aiChatDrawer/index.tsx`). Remaining UX work is to move the control into the broader Board Copilot settings surface from the v3 PRD, self-gate options from backend `AgentMetadata.allowed_autonomy` instead of the current hard-disabled `auto` row alone, and explain per-project defaults instead of relying only on chat-drawer `localStorage` state. Tracked architecturally in [`architecture-todo.md`](architecture-todo.md) Theme 3; **§8 / §14 in [`release-todo.md`](release-todo.md) are closed UI-metadata rows** — this item is the **next UX** layer on top of those contracts, plus eventual v3 autonomy when GA §1 tooling exists.

20b. **Feedback parity outside chat.**
    `AiFeedbackPopover` is wired into `AiChatDrawer` for assistant turns, so the old "no consumer" claim is stale. ~~Remaining work is parity on `AiTaskAssistPanel` suggestions and `BoardBriefDrawer` recommendations,~~ **[Complete on branch `(no branch)` (verify-feedback-parity handoff — verifier listed no `## Branch` push target): thumbs parity + `role="group"` names + analytics `surface: "task-assist"` / `"board-brief"` per `src/__tests__/aiCopilotSurfaceFeedback.strict.test.tsx`; jest-axe via `src/__tests__/aiAccessibility.strict.test.tsx`; i18n `microcopy.feedback.taskAssistTitle` / `boardBriefTitle` en+zh-CN; `AiChatDrawer` untouched.]** Remaining: product decision on whether feedback payload writes only analytics today or later feeds the agent memory namespaces from v3 PRD §11.

20c. ~~**`CopilotAboutPopover` two narrow gaps.**~~ **[Complete: mode tags read `microcopy.about.remoteModeTag` / `localModeTag`; knowledge cutoff uses `knowledgeCutoffTemplate` + `resolveAiKnowledgeCutoffForUi` (`REACT_APP_AI_KNOWLEDGE_CUTOFF` / optional `AgentMetadata.knowledge_cutoff`).]**

~~20d. **No FE CI workflow.**~~ **[Complete: `.github/workflows/frontend-ci.yml` runs Prettier check, ESLint (no `--fix`), `tsc --noEmit`, Jest, and `vite build` on FE path changes — see [`release-todo.md`](release-todo.md) §7b.]**

20e. ~~**Design-token reference docs missing.**~~
    ~~`src/theme/tokens.ts` and `src/theme/antdTheme.ts` are the implementation source of truth, but `docs/design-tokens.md` does not exist even though Section 2.C tells contributors to use it. Add a concise token reference (spacing, color, typography, motion, AntD mapping) or change Section 2.C to point only at the code modules.~~ **[Complete: `docs/design-tokens.md` is the contributor reference (scales + `buildAntdTheme` mapping); Section 2.C and this item updated.]**

20f. **Unified `CopilotShell` is only a scaffold.**
    `src/components/copilotShell/index.tsx` now ships a real tabbed drawer (`chat`, `brief`, `activity`, `settings`), but `chat` and `brief` still bounce the user into the legacy drawers while `activity` and `settings` are placeholder copy. This is now a visible product surface on `src/pages/board.tsx`, so it needs either full in-shell content or a tighter rollout gate until phase 2 is ready. Fold the autonomy/privacy/per-project controls from item 20a into the real Settings tab instead of leaving the shell half-owned.
    - ~~**i18n debt is concrete.** Tab keys (`"Chat"`, `"Brief"`, `"Activity"`, `"Settings"` at `copilotShell/index.tsx:109, 120, 131, 138`), the title `"Board Copilot"` (`:101`), and the four placeholder bodies (`:112, 123, 133, 149–152`) plus the CTA labels (`"Open Chat"`, `"Open Brief"` at `:113, 124`) are all hardcoded English. Lift them to `microcopy.copilotShell.*` (or reuse existing keys where they overlap with the legacy drawers) before this becomes the canonical surface.~~ **[Complete: strings live in `microcopy.copilotShell.*` with `zh-CN` parity (`src/i18n/locales/en.ts` / `zh-CN.ts`), wired in `copilotShell/index.tsx`.]**

21. **Accessibility gaps.**
    - ~~Several `<a onClick>` patterns with `eslint-disable` (e.g. `taskCreator`, `column`).~~ **[Complete: `taskCreator`, `columnCreator`, and `column` now use real `<button type="button">` elements (`CreateLink`, `AddColumnButton`, `TaskCard`/`NoPaddingButton`); a repo-wide grep confirms no `<a onClick>` patterns remain in production components.]**
    - ~~Decorative SVGs without `alt=""` (the bug/task icons inside `Column`).~~ **[Complete: `TaskTypeBadge` renders bug/task imagery as `<img alt="" aria-hidden />` beside visible `microcopy.options.taskTypes.*` labels so type is not double-announced.]**
    - Color contrast on muted text (`rgba(0,0,0,0.5)` on white) probably fails WCAG AA.
    - ~~The header logo button has no accessible label distinguishing it from "Members".~~ **[Complete: header brand button now uses localized `microcopy.header.logoLabel` (`Pulse home`) as both `aria-label` and `title`, with `zh-CN` parity.]**
    - ~~Live regions on the chat drawer (`aria-live="polite"`) are good — extend the same to the AI assist and brief drawers.~~ **[Complete: `AiTaskAssistPanel` and `BoardBriefDrawer` now each include a discrete `role="status" aria-live="polite"` region that announces short status copy (`suggestion ready` / `couldn't load brief`) without exposing payload content.]**

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

2. ~~**Add a dark-mode-ready palette.**
   Once tokens exist, plug AntD's `theme.darkAlgorithm` behind a header switch. Persist the choice in `localStorage` next to the existing `boardCopilot:enabled` key.~~ **[Complete: `useColorScheme` persists `light` / `dark` / `system`, `buildAntdTheme` switches `defaultAlgorithm` / `darkAlgorithm`, and `ThemedShell` applies the choice app-wide.]**

3. **Make the layout responsive.**
    - In `src/layouts/mainLayout.tsx:7–18`, drop `min-width: 1024px` and `max-height: 1440px`; switch the grid to `grid-template-rows: auto 1fr`; remove `overflow: scroll` from `<main>` (let inner regions own scroll).
    - ~~In `src/pages/projectDetail.tsx:20–24`, collapse the second layout into the main shell (see Phase 2.4) or, at minimum, replace `grid-template-columns: 16rem 1fr` with a CSS variable so the sidebar can collapse below 768 px.~~ **[Complete on branch `orch/todo-sweep-566b/fix-project-detail-shell`: duplicate grid/aside removed — see §1.1 item 5 / Phase 2.5 §5.]**
    - Add a `useBreakpoint` (AntD `Grid.useBreakpoint`) hook and conditionally collapse the header to an icon-only state on `xs`/`sm`.

4. **Centralize typography and headings.**
   Create a small `Heading` / `Subhead` / `Muted` set on top of AntD `Typography.Title/Text` so we stop using bare `<h1>`/`<h4>` with inline styles (`src/pages/board.tsx:106–110`, `src/components/column/index.tsx:109–116`).

5. **Single source for the brand mark in header chrome.**
   Replace any hard-coded brand blues on the header cluster with AntD/token-driven color (today the home control renders `<BrandMark size="sm" />` in `src/components/header/index.tsx` ~451 — ensure the mark consumes theme primary / token bundle so dark mode and future brand swaps stay coherent).

6. ~~**Pre-bucket tasks by `columnId`.**
   In `src/pages/board.tsx`, build `const tasksByColumn = useMemo(() => groupBy(visibleTasks, "columnId"), [visibleTasks])` and pass `tasksByColumn[column._id] ?? []` to `<Column>` so the column filter loop becomes O(M) per render. Move the filter logic from `src/components/column/index.tsx:126–137` up to a `useFilteredTasks(tasks, param)` hook.~~ **[Complete: `BoardPage` now computes `tasksByColumn` once per task list.]**

### Phase 2 — High-traffic surfaces

**Goal: rebuild the four screens users spend 95 % of their time on.**

1. **Header & global navigation (`src/components/header/index.tsx`).**
    - Replace the "Hi, {username}" link-button with `<Avatar>{initials}</Avatar>` + chevron, and put Logout, Profile, and Theme toggle inside the dropdown.
    - Move "Members" out of a `<span>` into either a top-nav button (with a count badge) or a sidebar entry; make it focusable.
    - Add a primary nav with at least: `Projects`, `Members` (and later `Reports`). Highlight the active route.
    - Move the "Board Copilot" master switch into the avatar dropdown (Settings → AI features) so it stops competing with the user's name.

2. **Project list page (`src/pages/project.tsx`, `src/components/projectList`, `src/components/projectSearchPanel`).**
    - Keep the new card/grid treatment; do not regress back to a table-based layout just to add metadata.
    - Add member-count / avatar-group context to each card so project scale is scannable without opening the board.
    - Add pagination or virtualization once project counts exceed a single screenful.
    - Decide whether AI search stays inside the same filter shell or becomes a clearer dedicated search mode / row.
    - Preserve the shipped empty/loading/error states and the real optimistic heart toggle while iterating.

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

5. ~~**Project detail shell (`src/pages/projectDetail.tsx`).**
   Decision: collapse the dedicated detail layout into the main shell. Replace the left aside with an in-header tabbed navigation (Board · Backlog · Reports). The "Projects" popover should move to a dedicated breadcrumb element (`Projects / {projectName}`) at the top-left of the page content, using AntD `Breadcrumb`. This kills the duplicated layout, fixes the broken `5 px` shadow at `src/pages/projectDetail.tsx:15`, and gives us room to add future tabs cheaply.~~ **[Shipped on branch `orch/todo-sweep-566b/fix-project-detail-shell`: single-column shell + `Breadcrumb` (tabbed IA / backlog / reports deferred — see §1.1 item 5 evidence).]**

6. **Task edit modal (`src/components/taskModal/index.tsx`).** **[Partially complete; see §1.2 item 10.]**
    - Move the form into a two-column layout at ≥ 768 px: left = the form, right = the AI assist panel. Below 768 px, stack and put the AI panel inside an `<Collapse>` so it does not push the form off-screen.
    - ~~Move `Delete` into a proper `Modal.footer` slot.~~ **[Complete.]**
    - ~~Replace `"Edit Task"` with `"Edit · {taskName}"`.~~ **[Complete.]**
    - ~~Hard-code the canonical `Task` / `Bug` options instead of inferring them from the dataset (`:35–41`); the only correct list is the one the schema allows.~~ **[Complete.]**
    - Show validation errors inline next to fields instead of relying on `Form.Item.message` toasts.

7. **Auth screens (`src/layouts/authLayout.tsx`, `loginForm`, `registerForm`).** **[Partially complete; see §1.2 item 11 — SVG background / gradient refactor still open.]**
    - ~~Add real `<Form.Item label>` to every field.~~ **[Complete.]**
    - ~~Set `autocomplete` properly… `inputMode="email"` … `enterKeyHint="go"` on the submit-row inputs.~~ **[Complete on `autoComplete`; remaining: `inputMode` / `enterKeyHint` audits.]**
    - ~~Add a "Show password" toggle, a caps-lock hint…~~ **[Complete.]** ~~Remaining: a "Forgot password" link (route can be a TODO page).~~ **[Complete: `/auth/forgot-password` placeholder route is wired, with localized link/title/body copy.]**
    - ~~On register: password-strength meter (zxcvbn-equivalent or a deterministic length+class heuristic to avoid the dependency), minimum-length hint inline,~~ **[Complete: `constants/passwordStrength.ts` + `registerForm/passwordStrengthHint.tsx` with `microcopy.auth.passwordStrength.*` and `aria-live` status; AntD rules still enforce the 8-character minimum.]** plus a "Match" indicator if a confirm-password field is added.
    - ~~Render a top-of-form **error summary** (`role="alert"`) whenever the API returns an error, with anchor links to fields that failed; this satisfies WCAG 3.3.1 / 3.3.3 (see 2.A.1). The forms have an `aria-live="polite"` region today (`loginForm:91`, `registerForm:105`) but no anchor links / `role="alert"` summary.~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion`: `AuthErrorSummary` + `src/components/loginForm` / `registerForm` / `authErrorSummary` tests.]**
    - ~~Do not block paste (`onPaste`) on password fields (WCAG 3.3.8).~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion` (verifier + test coverage).]**
    - ~~Replace the "Register for an account" `NoPaddingButton` with a regular AntD `Link` and add the inverse on the register page.~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion`: `styled(Link)` + `uiQuality.strict.test.tsx`.]**
    - ~~Make the card width adapt to viewport (`max-width: 40rem; width: min(40rem, 100% - 2rem)`).~~ **[Complete on branch `orch/todo-sweep-566b/auth-form-completion`: `authLayout.test.tsx` computed styles.]**
    - Replace the absolutely positioned background SVGs with a single subtle gradient or blurred shape that scales with the viewport — the current `calc()` math collapses on small screens.

8. **Unified Copilot shell (`src/components/copilotShell/index.tsx`).**
    - Replace the placeholder tab bodies with actual in-shell chat, brief, activity, and settings content, or keep the shell behind a tighter rollout gate until the phase-2 surface is real.
    - Move autonomy/privacy/per-project controls into the real Settings tab (see §1.2 item 20a) instead of leaving them split across drawer-local state and placeholder copy.
    - Route triage/activity state into the Activity tab and move hardcoded English strings into `microcopy.ai.*` before the shell becomes canonical.

### Phase 3 — Polish, accessibility, microcopy

1. ~~**Establish a microcopy style guide.**
   Adopt sentence case for every button and title, and standardize action verbs. Concretely: `Log in` / `Sign up` (not `Login` / `Register`), `Create project` (not `Create Project`), `Save` (not `Submit`) for forms that mutate existing records, `Create` for forms that create new ones, `Delete` (not `Confirm`) on destructive confirmation modals, `Cancel` everywhere as the secondary action.~~ **[Complete: existing locale values now implement this style-guide baseline without introducing new translation keys; tests asserting user-visible labels were updated to the new sentence-case strings.]**

2. ~~**Fix every `<a onClick>` to be a real button.**
   Touch points: `src/components/taskCreator/index.tsx:55–56`, `src/components/aiTaskAssistPanel/index.tsx:170–176`. Use AntD `Button type="link"` or `<button>` with proper styling.~~ **[Complete: `taskCreator` ships `CreateLink` as a real `<button>`, and every interactive control in `aiTaskAssistPanel` is now an AntD `<Button>`; no `<a onClick>` / `eslint-disable` survives in either file. Keep this rule on the contributor checklist (Section 2.C) so new components do not regress.]**

3. **Audit color contrast.**
   Replace ad-hoc `rgba(0,0,0,0.5)` muted text with `Typography.Text type="secondary"` (which respects the theme algorithm). Verify contrast at AA for: muted body text, the brand-tinted message bubbles in `aiChatDrawer`, the warning Alerts.

4. **Accessibility pass — WCAG 2.2 AA, line by line.**
    - **2.4.3 Focus Order / 2.4.7 Focus Visible / 2.4.13 Focus Appearance.** Add a global focus ring using `:focus-visible` (2 px outline in `colorPrimary`, 2 px offset). Audit drawers and modals with `tab` / `shift+tab`; make sure focus is trapped while open and returned to the invoking control on close (today `TaskModal`, `BoardBriefDrawer`, `AiChatDrawer`, `ProjectModal` rely on AntD defaults — verify and add `triggerRef` patterns where AntD does not handle it).
    - **2.4.11 / 2.4.12 Focus Not Obscured.** Sticky elements (the new top-tier header and column headers from Phase 2.3) must not occlude focused controls; add `scroll-padding-top` on the page container equal to the header height.
    - **2.5.5 / 2.5.8 Target Size.** Every interactive element must be at least 24 × 24 CSS px (AA) and ideally 44 × 44 (AAA / mobile guidance). The "..." dropdown trigger in `projectList` and `column` is currently smaller than 24 px — fix when the icon swap happens in Phase 2.2.
    - ~~**2.5.7 Dragging Movements.** Drag-and-drop on the board must have a non-drag alternative. Wire `@hello-pangea/dnd`'s keyboard sensor (Space to lift, arrows to move, Space to drop, Esc to cancel) and surface those keystrokes in a tooltip on the card and in the help dialog from Phase 4.~~ **[Partially complete: keyboard drag discoverability now ships on task cards via localized hint copy + `aria-keyshortcuts` (`src/components/column/index.tsx`). Follow-up: include the same keystrokes in the global shortcut-help dialog from Phase 4.]**
    - **3.3.1 / 3.3.3 Error Identification & Suggestion.** Replace single-line error toasts with a per-form **error summary** at the top of the form linking to the offending field (GOV.UK pattern). Reuse `<ErrorBox>` as the summary container and add `aria-describedby` from each field to its inline error.
    - **3.3.7 Redundant Entry.** When a user creates a task immediately after creating a column, prefill `coordinatorId` to the current user (already does) and `epic` to the most recently used value in this project. ~~The login form's email should be `autocomplete="username"` so the password manager remembers it.~~ **[Complete: `loginForm` email field uses `autoComplete="username"` (Safari / iOS Keychain pairing) and surfaces `microcopy.feedback.loginCouldNotPersistSession` when `localStorage` cannot persist the JWT.]**
    - **3.3.8 Accessible Authentication (Minimum).** No CAPTCHA; ensure password fields accept paste (do not block `onPaste`); `autocomplete="current-password"` on login and `autocomplete="new-password"` on register. The "Show password" toggle (Phase 2.7) is required for users who cannot reliably type long passwords.
    - **1.4.3 Contrast (Minimum) / 1.4.11 Non-text Contrast.** Replace ad-hoc `rgba(0,0,0,0.5)` and `rgba(0,0,0,0.6)` with `Typography.Text type="secondary"`; verify ≥ 4.5 : 1 for body text, ≥ 3 : 1 for UI components (focus rings, input borders).
    - **1.4.1 Use of Color (color-blind safety).** The bug/task icon is currently the only signal of type, and the breakdown modal uses red Tag for `Bug` and blue Tag for `Task` (`src/components/aiTaskDraftModal/index.tsx:316–318`). Add a text label inside every Tag (`Bug` / `Task`) and prefer shape (icon outline vs. filled) over hue. Status alerts must not rely on color alone — keep AntD's icon prefix.
    - **1.4.10 Reflow / 1.4.4 Resize Text.** Phase 1.1 (kill the rem hack) and Phase 1.3 (responsive layout) together satisfy 1.4.10; manually verify reflow at 320 CSS px width and 200 % zoom.
    - **1.4.12 Text Spacing.** No CSS rule may break when users override `line-height: 1.5`, `letter-spacing: 0.12em`, `word-spacing: 0.16em`, `paragraph-spacing: 2em`. Test once per surface.
    - **4.1.3 Status Messages.** Add `aria-live="polite"` to: filter result counts ("12 tasks match"), optimistic mutation feedback ("Task created"), and AI suggestion arrival. **[Update: chat drawer already had this; AI suggestion arrival is now covered in `aiChatDrawer`, `aiTaskAssistPanel`, and `boardBriefDrawer` via dedicated `role="status"` live regions.]**
    - **`forced-colors` / Windows High Contrast.** Replace background-image-based affordances (drop hints, gradient scroll fade) with `border` and `background-color` so they survive forced-colors mode; use `forced-color-adjust: none` only where unavoidable (the brand logo).
    - **`prefers-reduced-motion`.** Wrap every motion (drag lift, modal slide, skeleton-to-content cross-fade, toast slide) in `@media (prefers-reduced-motion: no-preference) { … }` or use AntD's `motion` token set to none when the media query matches.
    - **Decorative SVGs.** Set `alt=""` (or `aria-hidden="true"` on inline SVG) on `bug.svg`, `task.svg`, the auth `left.svg` / `right.svg` decorations, and the brand sparkle when next to a visible label.
    - **Tooling.** `jest-axe` and `eslint-plugin-jsx-a11y` are in place for the AI-heavy surfaces; extend axe coverage to the remaining page/modal tests and tighten the current jsx-a11y warnings so ESLint fails under `--max-warnings 0` in [`release-todo.md`](release-todo.md) §7b's workflow once the debt is cleared (§7b CI runs eslint today without that strict cap).

5. **Loading states.**
    - Replace bare `<Spin>` blocks with `<Skeleton.Input>` / `<Skeleton.Avatar>` / `<Skeleton.Paragraph>` matching the eventual layout for: project list rows, board columns, task cards, brief drawer sections, chat drawer initial load, AI assist panel.
    - ~~Add throttled spinners (only render after 250 ms) so fast local-engine responses do not flash a spinner at all.~~ **[Complete: `useDelayedFlag` now delays spinner rendering by 250 ms on the task-assist panel, chat drawer, and board brief drawer.]**

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
    - ~~Card lift on drag start (`box-shadow` + slight `scale`).~~ **[Complete on branch `orch/todo-sweep-566b/dnd-affordances` — see §1.2 item 15.]**
    - ~~Drop placeholder with dashed border + tinted background.~~ **[Complete on branch `orch/todo-sweep-566b/dnd-affordances` — see §1.2 item 15.]**
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

**Gates:** GA Blocker [§1](release-todo.md) for the AI mutation Undo path only — the 10-second toast Undo is the FE half of the mutation lifecycle (already shipped on `MutationProposalCard`, see [§18](release-todo.md)); the BE accept/undo wiring is what §1 still tracks. The non-AI Undo work in this section has no release-tier dependency.

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
- ~~**Throttled spinners.** Use a `useDelayedFlag(loading, 250)` hook so spinners only render after 250 ms; this kills the chat/AI panel "flash of spinner" on the local engine.~~ **[Complete: shipped `useDelayedFlag` and applied it to the visible spinner branches in `AiTaskAssistPanel`, `AiChatDrawer`, and `BoardBriefDrawer`.]**
- **`React.memo` for cards and rows.** `Column` and the project list `<Avatar>` cell re-render every keystroke today; memoize after the bucket-by-column refactor (Phase 1.6).
- **Image lazy loading.** All `<img>` and `<Avatar src>` get `loading="lazy"` and explicit width/height to avoid CLS.
- **Skeleton shape match.** Skeletons must match the final element's bounding box to avoid layout shift on resolve. Quantify: target Cumulative Layout Shift (CLS) < 0.1, Interaction to Next Paint (INP) < 200 ms, Largest Contentful Paint (LCP) < 2.5 s on a 4× CPU-throttled run.
- **Bundle budget.** Keep the initial JS bundle below 200 KB gzipped after Phase 1; add `rollup-plugin-visualizer` to `vite.config.ts` so regressions are visible in PRs.

### 2.A.8 AI provenance, transparency, and undo

**Gates:** GA Blocker [§1](release-todo.md) for the "every AI write must be undoable" rule — the FE Undo toast / `Suggested by Copilot` badge is wired, but a real BE accept/apply/undo lifecycle is what §1 still tracks. The provenance / "Why?" rationale items have no release-tier dependency and ship as v3 UX polish (see [`../prd/v3-ai-ux.md`](../prd/v3-ai-ux.md)).

The PRD already enforces validation; the UI should make the provenance obvious.

- ~~After a user clicks **Apply** on an AI suggestion, mark the affected field with a small `Suggested by Copilot` badge until the user edits it.~~ **[Partially complete: the story-points apply path in `TaskModal` now renders a `Suggested by Copilot` badge and clears it on user edit (from `AiTaskAssistPanel`); remaining follow-through is to extend the same visible badge treatment to the other AI-applied fields.]** This satisfies "match between system and the real world" and gives users a hook to retract.
- Every AI write must be undoable via the same toast/Undo pattern (see 2.A.4). Tasks created by Draft with AI carry a hidden `meta.source = "ai"` for analytics and easy bulk-rollback.
- ~~The chat drawer must hide raw tool-call payloads from end users (`src/components/aiChatDrawer/index.tsx:141–166`) and surface them only behind a "Show details" toggle. This is both a UX concern (clutter) and a safety concern (do not paint internal ids in front of users).~~ **[Complete on branch `orch/todo-sweep-566b/chat-drawer-polish`: collapsed summary + expandable payload region; see §1.2 item 12.]**
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
| `Space / arrows / Esc` | Focused task card | Drag with keyboard (delegated to dnd library). Discoverability hint is now surfaced on task cards. |

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
- **`eslint-plugin-jsx-a11y`** is installed and configured in `eslint.config.mjs`; promote warnings to **CI-blocking** failures (`--max-warnings 0` in `npm run eslint`) now that `.github/workflows/frontend-ci.yml` runs ESLint on FE changes (see [`release-todo.md`](release-todo.md) §7b).
- **Design tokens documented** at `docs/design-tokens.md` (single source for spacing, color, type, motion). Storybook reads from the same module. **[Reference shipped 2026-05-10: `docs/design-tokens.md` → `src/theme/tokens.ts` / `src/theme/antdTheme.ts`. Storybook scaffolding remains open.]**
- **Component contribution checklist** in `CONTRIBUTING.md`: passes a11y, ships story, supports keyboard, supports `prefers-reduced-motion`, has loading/empty/error states, ships tests.
- **Analytics hooks (privacy-respecting).** Wrap mutations in a `track(event, payload)` no-op today (no third-party endpoint), so the AI surfaces and the new toasts have a single instrumentation point we can wire up later.
- **Dependency hygiene.** `lodash` is currently imported in full at `src/components/taskModal/index.tsx:3`; after Phase 1, replace with `lodash-es` named imports or native equivalents to keep the bundle budget honest.

---

## 3. Suggested execution order

The order below batches changes that share files so we do not churn the same area twice. Cross-cutting rules (Section 2.A) and the heuristics map (Section 2.B) are applied within each Phase, not as a separate pass.

1. **Tooling first.** Add `jest-axe`, `rollup-plugin-visualizer`, and the design-tokens doc skeleton (Section 2.C). Ship Storybook scaffolding so all subsequent components land with stories from day one. **[Partially complete: `jest-axe` in place (31 tests across `src/__tests__/aiAccessibility.strict.test.tsx` + `src/__tests__/uiAccessibility.strict.test.tsx`); `eslint-plugin-jsx-a11y` installed/configured; design tokens shipped at `src/theme/tokens.ts`; contributor reference at `docs/design-tokens.md`; code splitting via `lazy()` shipped (`src/routes/index.tsx`); service worker shipped (`public/sw.js`); FE CI ships via `.github/workflows/frontend-ci.yml` (§1.2 ~~20d~~ / [`release-todo.md`](release-todo.md) §7b). Still open: Storybook scaffolding, `rollup-plugin-visualizer`, and stricter CI treatment for jsx-a11y warnings.]**
2. Phase 1 follow-through — finish the remaining typography/token adoption work (1.4, 1.5) and keep the shipped color-scheme system aligned with 2.A.3.
3. Phase 1.3, 1.6 — responsive layout + tasks-by-column grouping. Land 2.A.2 (touch targets, safe-area-inset) at the same time.
4. Phase 2.1, 2.5 — header + project detail shell collapse (both touch the global chrome). Land 2.A.11 (breadcrumbs, `aria-current`, `ScrollRestoration`) here.
5. Phase 2.2 — project list follow-through (member context, large-list scaling, AI-search IA) + 2.A.7 (route-level code splitting + prefetch on hover) since both touch the same files.
6. Phase 2.3, 2.4, 2.8 — board page + task card redesign + unified Copilot shell follow-through (single thread because they share the board AI chrome). Land 2.A.4 (toast + Undo for column/task deletes), 2.A.9 (board shortcuts), and the 2.5.7 keyboard drag-and-drop.
7. Phase 2.6 — task modal split-pane + 2.A.8 ("Suggested by Copilot" badge, "Why?" affordance) + 2.A.1 (unsaved-changes guard, error summary).
8. Phase 2.7 — auth screens with the full 2.A.1 / WCAG 3.3.7 / 3.3.8 contract.
9. Phase 3 — polish, accessibility, microcopy in one pass per surface; this is also when `jest-axe` assertions and visual regression baselines get added per component.
10. Phase 4 — pick the highest-leverage remaining stretch item (likely per-user preferences or the activity drawer).

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
