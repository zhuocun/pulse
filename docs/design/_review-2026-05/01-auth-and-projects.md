# 01 — Auth + Projects review

## TL;DR

- **The auth surfaces are technically careful but conceptually 2018.** `inputMode`/`enterKeyHint`/`autoComplete`/caps-lock/strength-meter are all in place, but the actual flow is still "email + 8-char password + Forgot/Register switch + canned hero copy" — no passkey, no magic-link, no social SSO, no progressive disclosure. The hero rail is brand-correct on tablet+, but on mobile the form is dropped onto an `AntD Card` with `padding: 48px` and no on-page brand chrome other than a 36 px wordmark, which makes the most important screen in the app feel like a CMS login.
- **The auth layout silently lacks the skip-link** that `MainLayout` provides (`mainLayout.tsx:49-75`), so keyboard / SR users on `/login` cannot bypass anything (the `aria-hidden="true"` hero rail is invisible to AT, but the brand mark + AuthTitle still sit between Tab and the email field). Combined with `AuthErrorSummary` calling `ref.current?.focus()` on every render where errors change (`authErrorSummary/index.tsx:80-84`), the focus model on auth is fragile.
- **`pages/home.tsx` is a dangling shim.** With the route table in `routes/index.tsx` already mounting `<HomePage />` as the *parent* of every login/register/projects branch, `HomePage` does its own `Navigate` to `/login` or `/projects` based on the URL — *and* then wraps either `<AuthLayout />` or `<MainLayout />` in a bare `<div>` (`home.tsx:23`). That extra `<div>` breaks the `grid` that `AuthLayout`'s `<Page>` and `MainLayout`'s `<Container>` rely on, so the auth layout grid actually never fires its `min-height: 100dvh` against the viewport — only against the content of that wrapper `<div>`. The hero rail still works because the inner `<Page>` is its own grid, but `<Canvas>` on a 320 × 568 SE never centers vertically and the form ends up jammed under the brand mark on iOS Safari with the URL bar visible.
- **Login form does not `.trim()` the email** before posting (`loginForm/index.tsx:64`) — RegisterForm does (`registerForm/index.tsx:54-55`). Users who autofill with a trailing space (common on iOS Safari long-press paste) get rejected with a generic "invalid credentials" while their `users` table row sits one space away.
- **Projects page is solid but plays its biggest card too small.** The `StatRail` (Total / Organizations / Team members) takes a full row of vertical chrome under the page heading for three context-free numbers; the `Create project` CTA is a flat secondary-ish primary in the top-right; and `ProjectCard` doesn't surface a single dynamic signal (open tasks, last activity, member presence, AI brief) — so the list reads as a directory rather than a board roster. A passive directory of static cards is what a project list page in v1 looks like; nothing here moves Pulse beyond that v1.

## Surfaces audited

| File | Surface | One-liner |
|---|---|---|
| `src/layouts/authLayout.tsx` | Auth shell | Tablet+ hero rail + glass form card; `<main>` landmark; missing skip-link. |
| `src/pages/login.tsx` | Login page | 47 LOC stub; renders title/subtitle + `LoginForm` + register switch. |
| `src/components/loginForm/index.tsx` | Login form | AntD `Form`, email/password, caps-lock hint, post-login `/users` re-verify. |
| `src/pages/register.tsx` | Register page | 46 LOC; mirrors login. |
| `src/components/registerForm/index.tsx` | Register form | + username + password strength meter; navigates to `/login` on success. |
| `src/pages/forgotPassword/index.tsx` | Forgot-password | 21 LOC placeholder — pure copy, no form, no contact form. |
| `src/pages/terms/index.tsx` | Terms of Service | 17 LOC placeholder — same shape as `/forgot-password`. |
| `src/pages/home.tsx` | Root redirector | Decides AuthLayout vs MainLayout from auth state + path. |
| `src/pages/project.tsx` | Projects page | Heading + stat rail + search panel + grid; AI chat drawer. |
| `src/components/projectList/index.tsx` | Project grid | Sort, skeletons, empty state, optimistic-like, delete confirm. |
| `src/components/projectCard/index.tsx` | Card | Avatar, org, title, manager, date, like, more menu. |
| `src/components/projectModal/index.tsx` | Project create/edit | AntD Modal; 3 fields; phone-stack footer. |
| `src/components/projectSearchPanel/index.tsx` | Filters | Name search + manager Select + chips + AI search slot. |
| `src/components/projectPopover/index.tsx` | Project switcher | Used inside project detail breadcrumb. |
| `src/components/emptyIllustration/index.tsx` | Branded SVG | Variants for tasks / projects / search / members. |
| `src/components/emptyState/index.tsx` | Empty container | Title + description + CTA + halo-framed illustration. |
| `src/components/authErrorSummary/index.tsx` | Error summary | `role="alert"`, anchor links to fields, auto-focuses on update. |

## Findings — ranked

### F-01 — `pages/home.tsx` wraps layouts in an extra `<div>` that breaks `min-height: 100dvh` and the canvas grid

- **Surface:** `src/pages/home.tsx:23`
- **Severity:** High
- **Type:** bug / mobile / desktop
- **Evidence:**
  ```tsx
  // src/pages/home.tsx:23
  return <div>{isAuthenticated ? <MainLayout /> : <AuthLayout />}</div>;
  ```
  vs. `src/layouts/authLayout.tsx:24-28` which expects the layout `<Page>` to be a grid descendant of the routed outlet directly:
  ```css
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;
  min-height: 100dvh;
  ```
- **Why it matters:** The wrapper `<div>` has no styled `display`, so it's `block` with `height: auto`. The grandchild `min-height: 100dvh` resolves against the viewport (`%-resolved against the initial containing block`), so the *grid* still claims the full viewport — but only because `100dvh` is a viewport-relative unit, not the parent. The actual breakage is more subtle: `<HomePage>` is itself routed as an *element* on the route definition `routes/index.tsx:85` and its children (`/login`, `/register`, etc.) are routed *inside* its `<Outlet />`. But `HomePage` here renders `<AuthLayout />` — and `AuthLayout` also renders `<Outlet />` (`authLayout.tsx:366`). Net effect: every auth route renders `<HomePage>` (one render) → `<div>` wrapper → `<AuthLayout>` (which itself renders an `<Outlet>` that resolves to `<LoginPage>`). The wrapper `<div>` is dead chrome, *and* the second `Navigate` inside `HomePage` (`home.tsx:15-21`) duplicates the routing decision already made by `RootRedirect` in `routes/index.tsx:38-45`. Routing fires twice on every cold page load; the wrapping `<div>` is a memo / focus-trap landmine.
- **Proposed fix:** Delete `pages/home.tsx` entirely. Move `AuthLayout` and `MainLayout` to be sibling route elements directly in `routes/index.tsx`, gated on `isAuthenticated` via tiny `<RequireAuth>` / `<RequireGuest>` wrappers around the children. This removes 27 LOC, one render pass, one redirect, and a `<div>` that breaks AuthLayout's design contract.

### F-02 — `AuthLayout` is missing a skip-link

- **Surface:** `src/layouts/authLayout.tsx:325-371`
- **Severity:** Medium (a11y)
- **Type:** a11y
- **Evidence:** `MainLayout` ships a fully-styled `SkipLink` (`mainLayout.tsx:48-75, 89-91`) targeting `#main-content`. `AuthLayout` declares `<Canvas>` as `<main>` but never gives it an `id`, and the auth tree has no skip link at all.
- **Why it matters:** On `/login`, a keyboard user lands on the `BrandMark` (`<a href="/">`-shaped, since it's the wordmark/logo link in `BrandHeader`), tabs to the email field, but if a screen-reader user wants the form fast on `/auth/forgot-password` (which is mostly placeholder copy with no form) they have no bypass. The pattern is established in MainLayout — auth should match.
- **Proposed fix:** Lift `SkipLink` out of `mainLayout.tsx` into `src/components/skipLink/index.tsx`, give `<Canvas>` an `id="auth-main"`, render the same `SkipLink href="#auth-main"` from `AuthLayout`. The hero rail is already `aria-hidden="true"` (`authLayout.tsx:328`), so AT users do not need to skip *over* it — but they still need a way to skip the brand mark.

### F-03 — `AuthErrorSummary` calls `ref.current?.focus()` whenever `fieldErrors.length` changes — focus thrash on AsyncValidator re-runs

- **Surface:** `src/components/authErrorSummary/index.tsx:77-98`
- **Severity:** Medium (a11y)
- **Type:** a11y / bug
- **Evidence:**
  ```tsx
  // src/components/authErrorSummary/index.tsx:80-84
  useEffect(() => {
      if (visible) {
          ref.current?.focus();
      }
  }, [visible, apiMessage, fieldErrors.length]);
  ```
  `fieldErrors` is recomputed every render via `form.getFieldError(meta.name)` inside `Form.Item shouldUpdate` (line 143), so this effect fires on each AntD re-render where the count of errors changes — including the case where the user *fixes* one field, leaving two errors, and AntD re-runs the validator on the remaining ones.
- **Why it matters:** WCAG 3.3.1 says focus *should* move to the error summary when validation finishes. It should NOT yank focus repeatedly. Real-world impact on mobile: every keystroke that triggers a debounced AntD validator on a still-erroring field can re-steal focus and dismiss the iOS keyboard. The Caps Lock slot and the strength meter under the password trigger this loop on register.
- **Proposed fix:** Focus only on the *transition* from `visible: false → true`, OR explicitly on form submit (`onFinishFailed`). Track previous `visible` in a ref; do not depend on `fieldErrors.length`.

### F-04 — LoginForm does not trim the email before submit; RegisterForm does

- **Surface:** `src/components/loginForm/index.tsx:64`
- **Severity:** Medium
- **Type:** bug
- **Evidence:**
  ```tsx
  // src/components/loginForm/index.tsx:60-65
  const handleSubmit = async (input: { email: string; password: string }) => {
      setSubmitAttempted(false);
      let res: IUser;
      try {
          res = await mutateAsync(input);  // <-- raw, untrimmed
  ```
  vs.
  ```tsx
  // src/components/registerForm/index.tsx:52-56
  await mutateAsync({
      ...input,
      email: input.email.trim(),
      username: input.username.trim()
  });
  ```
- **Why it matters:** iOS Safari and many password managers paste with a trailing space. The user sees their email visually correct, gets "invalid credentials," and there's no UI affordance suggesting the typo is whitespace. Also a server-side leak that needs to assume client trims.
- **Proposed fix:** Trim email at the form boundary in `handleSubmit`. Belt-and-braces: also `email.normalize("NFC").trim().toLowerCase()` so accented inputs match the canonical stored form. Apply the same to `useApi`-level outbound payloads if you don't want to scatter trims.

### F-05 — Page-level redirect lives in both `routes/index.tsx` *and* `pages/login.tsx` / `pages/register.tsx`

- **Surface:** `src/pages/login.tsx:28-30`, `src/pages/register.tsx:28-30`, `src/pages/home.tsx:15-21`, `src/routes/index.tsx:38-45`
- **Severity:** Medium
- **Type:** bug
- **Evidence:** `RootRedirect` already redirects authenticated → `/projects` and unauthenticated → `/login` at the route root. `HomePage` then redirects again (`home.tsx:15-21`), and `LoginPage` does a third pass: `if (isAuthenticated) return <Navigate to="/projects" replace />` (`login.tsx:28-30`).
- **Why it matters:** Three places that need to agree on the same predicate. If a future maintainer changes the post-login destination (`/projects` → `/inbox`), it has to be patched in three files. Today, if you hand-type `/login` while authenticated, you get a brief AuthLayout flash because `HomePage` mounts first, then redirects.
- **Proposed fix:** Centralize the redirect predicate in one place (`<RequireGuest>` wrapper at the route level). Delete the `Navigate` blocks from `LoginPage` / `RegisterPage` / `HomePage`.

### F-06 — `pages/forgotPassword/index.tsx` is a 21-LOC dead end — no email field, no contact CTA

- **Surface:** `src/pages/forgotPassword/index.tsx:5-20`
- **Severity:** High (UX)
- **Type:** ambition / bug
- **Evidence:** The route renders:
  ```
  Reset your password
  Password reset is coming soon. Please contact your workspace admin if you need immediate access.
  ```
  No mailto, no admin contact field, no `mailto:` link, no link back to login.
- **Why it matters:** Users who tap "Forgot password?" on the login form (`loginForm/index.tsx:190-192`) get dropped into a black hole. There is no way back except the browser back button, and no actionable next step. This is also a known SR pain — a user lands here, hears two paragraphs, no form, no actionable controls; classic "navigation to nowhere."
- **Proposed fix:** At minimum, add a `Back to login` link and surface the admin contact (if known per-tenant, query `/users/admin-contact`; if not, link `mailto:[email protected]`). Better: ship a real reset-request form that POSTs to a future backend stub and returns "If your email is registered, you'll receive a reset link" — even before the backend exists, the email-shaped form is the right UX placeholder.

### F-07 — Auth pages have no brand title in `document.title` — bare "Log in"

- **Surface:** `src/pages/login.tsx:24` / `src/pages/register.tsx:24` / `src/pages/forgotPassword/index.tsx:6` / `src/pages/terms/index.tsx:6`
- **Severity:** Low (polish, SEO)
- **Type:** polish
- **Evidence:** `useTitle(microcopy.actions.logIn)` — the tab shows `Log in` (or `Sign up`, `Reset your password`, `Terms of Service`). Compare `pages/board.tsx` (off-scope, but it does `useTitle(\`${project.projectName} board\`)`).
- **Why it matters:** Tab-bar identity, browser history "previously visited" lookups, and OS-level home-screen icon labels on PWA install all read `document.title`. Multi-tab Pulse users see a string of indistinguishable `Log in` tabs.
- **Proposed fix:** Standard pattern: `Log in · Pulse`, `Sign up · Pulse`, etc. Add a `pageTitle(parts: string[])` helper to `useTitle.ts` so the suffix is consistent.

### F-08 — `AuthLayout` `Page` background uses `rem`-units in the radial gradient (`60rem 50rem`) but tokens are CSS-px-based

- **Surface:** `src/layouts/authLayout.tsx:33-40`, `:67-77`
- **Severity:** Low
- **Type:** desktop / polish
- **Evidence:**
  ```css
  background:
      radial-gradient(
          60rem 50rem at 50% 30%,
          var(--aurora-blob) 0%,
          transparent 70%
      ),
      var(--pulse-bg-page);
  ```
- **Why it matters:** The codebase deliberately drops the legacy `html { font-size: 62.5% }` hack (per `tokens.ts:14`), so `1rem = 16px`. The intent of the radial gradient is a fixed 960 × 800 wash, but if a user has zoomed root font-size (browser accessibility setting, e.g. Chrome's "Customize fonts" → 20 px), the gradient inflates 25% and the brand "warmth" pool shifts. Spacing in the rest of the file is in `px`-based tokens. Pick one and stick to it — for a hero gradient, `rem` is the wrong unit because the gradient is decorative, not text-scaled.
- **Proposed fix:** `radial-gradient(60vmin 50vmin at 50% 30%, …)` — both responsive to viewport and immune to root-font-size changes.

### F-09 — `LoginForm` calls `onError(null)` on every keystroke — clearing the API error before the user can read it

- **Surface:** `src/components/loginForm/index.tsx:137`, `:178`
- **Severity:** Medium (UX)
- **Type:** bug
- **Evidence:**
  ```tsx
  // src/components/loginForm/index.tsx:137 (email Input)
  onChange={() => onError(null)}
  ```
- **Why it matters:** User submits, gets `Invalid credentials`. They re-type the password (one keystroke), the `AuthErrorSummary` collapses (and steals focus, F-03), and the error is gone from the page. Mobile keyboard users in particular cannot recover the error message without re-submitting. The "clear on edit" pattern is fine for *field-level* errors; it's wrong for the API-level summary.
- **Proposed fix:** Clear the API error only when *the field that the error implicates* changes, OR keep the summary visible until next submit. Cleanest: keep the summary mounted; remove the `onChange={() => onError(null)}` wiring.

### F-10 — `LoginForm` re-validates the user via `api("users", { dedup: false, rateLimit: false })` post-login but the `isVerifyingSession` flag uses a *separate* spinner — the user sees two distinct loading states for one action

- **Surface:** `src/components/loginForm/index.tsx:69-92, 197-203`
- **Severity:** Low
- **Type:** UX / polish
- **Evidence:** The button label flips `Logging in…` while the mutation runs (`isLoading`), then again while the cookie-roundtrip re-fetch runs (`isVerifyingSession`), but the message is the same string. The button never says "Verifying session…" — so on a slow proxy, "Logging in…" can linger for 2 s while the user wonders what's stuck.
- **Why it matters:** Mid-flow loading clarity. The justification (in the comment at `:74-79`) is real — the cookie roundtrip is a separate concern from the mutation — but the UI lies that they're one action.
- **Proposed fix:** Show `Verifying session…` (new microcopy entry) when `isVerifyingSession` is true. Or, more aggressive: skip the re-fetch and trust the `Set-Cookie` since the next page render will fail-fast if the cookie is missing. The 2024-vintage caution about iOS Safari and third-party cookies has eased — for first-party `SameSite=Lax`, the roundtrip is paranoia.

### F-11 — `AuthSubtitle` and `AuthTitle` are exported from `authLayout.tsx` but the consumers (`login.tsx`, `register.tsx`, `forgotPassword/index.tsx`, `terms/index.tsx`) all paste 14 lines of identical wrapper logic — `<AuthTitle>{x}</AuthTitle><AuthSubtitle>{y}</AuthSubtitle>` plus a `useTitle` call

- **Surface:** all 4 auth pages
- **Severity:** Low
- **Type:** desktop / polish
- **Evidence:** Compare `login.tsx:32-44` with `register.tsx:31-43` — the JSX shape is identical down to whitespace.
- **Why it matters:** Today, four pages, four chances to drift. The terms/forgotPassword pages already drifted: they don't render an `AuthSwitch` row but they sit in the same shell as login/register, so when a user lands on `/auth/terms` from the register form's terms link, they cannot get *back* to register without the browser back button — the page has no link to `/register`.
- **Proposed fix:** Either (a) introduce an `<AuthScreen title, subtitle, children, switchTo, footer>` composable component; or (b) make terms / forgotPassword carry an explicit "Back to sign up" / "Back to log in" affordance. Both are 30 min of work.

### F-12 — `AuthTermsAgreement` is rendered above the submit button on every auth page, eating ~80 px of vertical space on a 568 px iPhone SE — competing with the fold

- **Surface:** `src/components/registerForm/termsAgreement.tsx:8-13`, used at `loginForm/index.tsx:194` and `registerForm/index.tsx:190`
- **Severity:** Medium (mobile)
- **Type:** mobile
- **Evidence:** The shell of TermsAgreement is `font-size: ${fontSize.sm}; line-height: 1.5; margin: 0 0 ${space.md}px;` (`termsAgreement.tsx:8-13`) — about three lines on a 320-px-wide viewport because the prefix + link + suffix wrap.
- **Why it matters:** On a 568 px-tall iPhone SE with the iOS keyboard open (~270 px), the available height for the form drops to ~290 px. The brand mark + AuthTitle + AuthSubtitle + 2 fields + caps-lock slot + ForgotPasswordRow + terms paragraph + submit button does not fit. The user has to scroll the form *inside* the FormCard, but FormCard has no internal scrolling — the whole page scrolls, and the position of the submit button vs the keyboard is unpredictable.
- **Proposed fix:** Demote terms agreement to a checkbox-style "I agree to the Terms" only on register (legally meaningful affirmative consent), OR move the terms paragraph *under* the submit button, where it's still legally findable but doesn't compete with the primary CTA. Industry standard: terms link sits beneath the CTA in a `Typography.Text type="secondary"` line, exactly one line tall, font-size 12.

### F-13 — Login + register hero copy is generic and never updates — same string for a returning user with 17 projects as for a fresh signup

- **Surface:** `src/i18n/locales/en.ts:683-691`, rendered in `authLayout.tsx:332-358`
- **Severity:** Low (ambition)
- **Type:** ambition
- **Evidence:** `heroTitle: "Ship work with calm focus."`, `heroSubtitle: "A focused project board…"`, three static feature bullets (AI / drag-drop / dark mode). No personalization, no demo, no live signal.
- **Why it matters:** The hero rail is the *only* differentiated chrome between Pulse and any AntD-templated competitor. With AI being the headline value prop, an animated demo of an AI prompt resolving on a tiny embedded board would be a 30 × payoff over three static feature bullets.
- **Proposed fix:** See *Ambitious redesign proposals* §1.

### F-14 — `ProjectPage` always renders an `AiChatDrawer` when `aiEnabled` even if it is closed — `<AiChatDrawer columns={[]} initialPrompt={…} project={null} tasks={[]} … open={false}>`

- **Surface:** `src/pages/project.tsx:434-445`
- **Severity:** Low
- **Type:** desktop / polish
- **Evidence:** The drawer is unconditionally rendered when AI is on. The drawer's internals (chat history fetch, autosize textarea, etc.) mount on every projects-page paint.
- **Why it matters:** Cold-page LCP cost. The drawer is one of the heaviest non-board components in the codebase. With route-level code splitting in place, the chunk for the drawer is in the projects page chunk regardless, but its first render fires even when `open: false` — which means hook initializers, query subscriptions, and CSS for the drawer all warm up.
- **Proposed fix:** `{aiEnabled && chatOpen && <AiChatDrawer … />}`. The first user click on "Ask" is the moment to incur the mount cost.

### F-15 — `StatRail` renders three placeholder em-dashes during load — but with `aria-hidden={pLoading}` the *entire stat rail disappears from AT* on load and reappears later

- **Surface:** `src/pages/project.tsx:340`
- **Severity:** Medium (a11y)
- **Type:** a11y
- **Evidence:**
  ```tsx
  <StatRail aria-hidden={pLoading}>
  ```
- **Why it matters:** A blanket `aria-hidden` while loading is the wrong tool. Screen readers won't announce "Total projects: 7" appearing after the page finishes loading because they already moved past the (invisible) rail. The visual `—` placeholder is fine; the AT contract isn't. Also, `aria-hidden={true}` on a region that contains text is a "you're lying to AT" red flag.
- **Proposed fix:** Drop `aria-hidden={pLoading}`. Use `aria-busy={pLoading}` on the rail. Each `StatValue` carries an `aria-live="polite"` once loaded, OR the rail uses a single `role="status" aria-live="polite"` announcement that fires once with `Total: 7 · Organizations: 3 · Members: 12.` Don't make AT users miss the stats they came to read.

### F-16 — `ProjectPage`'s `Toolbar` packs `Ask Copilot` and `Create project` side by side at desktop, but on `< sm` flexes both to `flex: 1 1 0` — `Create project` (primary) gets the same visual weight as `Ask Copilot` (secondary), inverting the visual hierarchy

- **Surface:** `src/pages/project.tsx:88-94`
- **Severity:** Low
- **Type:** mobile
- **Evidence:**
  ```css
  @media (max-width: ${breakpoints.sm - 1}px) {
      flex-basis: 100%;
      > .ant-btn {
          flex: 1 1 0;
      }
  }
  ```
- **Why it matters:** Primary CTAs should dominate by default in the thumb zone. Mobile mat-design rule: the primary action either spans full width or sits at the right at >= 1.5x the secondary action's footprint. Here both buttons get 50% width, and on a 320 px viewport the `Create project` text wraps to two lines (because "Create project" + 16 px icon + 16 px padding hits 152 px width).
- **Proposed fix:** On `< sm`, render `Create project` as a full-width primary button and demote `Ask Copilot` to a 44 × 44 px icon-only button to the right. Or move both into a sticky bottom action bar (see *Ambitious redesign proposals* §3).

### F-17 — `ProjectSearchPanel` passes `value={managerName}` to AntD `<Select>` whose `options` use `_id` as `value` — a value/option mismatch that "happens to render right"

- **Surface:** `src/components/projectSearchPanel/index.tsx:188`
- **Severity:** Medium (bug / fragility)
- **Type:** bug
- **Evidence:**
  ```tsx
  // index.tsx:181-188
  options={[
      { label: microcopy.placeholders.managers, value: "" },
      ...members.map((user) => ({ label: user.username, value: user._id }))
  ]}
  value={loading ? undefined : (managerName ?? undefined)}
  ```
  Selected `value` is `managerName` (a username string), but options are keyed by `_id`. AntD falls back to rendering the value as-is, so the trigger displays the right text — but the dropdown highlights *no* selected option (it can't match `"alice"` to `_id: "abc123"`), and any test that filters dropdown items by `aria-selected` will fail silently.
- **Why it matters:** Two users with the same display name will both be "highlighted" or neither. Anyone refactoring this to add `optionFilterProp="label"` + `showSearch` (which the projectModal manager Select *does* have — `projectModal/index.tsx:227-228`) will discover the bug the hard way.
- **Proposed fix:**
  ```tsx
  value={loading ? undefined : (param.managerId || undefined)}
  ```
  Then the trigger displays the matching option's label automatically.

### F-18 — `ProjectSearchPanel` manager Select has no `showSearch` — picking from a 100-member workspace is a click-and-scroll

- **Surface:** `src/components/projectSearchPanel/index.tsx:166-189`
- **Severity:** Medium
- **Type:** desktop / mobile
- **Evidence:** Same component. The projectModal Select (`projectModal/index.tsx:221-229`) does have `showSearch optionFilterProp="label"`; the search panel Select does not.
- **Why it matters:** Inconsistency. Also, typeahead in this Select is how a workspace admin filters projects by sub-team lead.
- **Proposed fix:** Mirror the projectModal Select API: `showSearch optionFilterProp="label"`. Also add `<UserAvatar size="small">` next to each manager name in the option (`optionRender`) so the dropdown looks like a member picker, not a list of strings.

### F-19 — Sort affordance ("SORT BY [Name ↑]") is an underloaded `<Select variant="borderless">` that reads as a label rather than a control on mobile

- **Surface:** `src/components/projectList/index.tsx:282-297`
- **Severity:** Low (polish)
- **Type:** desktop / mobile
- **Evidence:** A borderless 152-px Select after a 13-px upcased "SORT" caption. On `pointer: coarse` the Select grows to 44 px tall via the AntD theme override, but it still reads as "uppercase label : selected option" rather than as a button.
- **Why it matters:** Discoverability. A user reading the page top-to-bottom often does not notice the sort dropdown until they want to reorder; on mobile, the small chevron is easy to miss.
- **Proposed fix:** Group sort + view-mode (grid/list — see §F-29) into a single icon-button toolbar to the right of the "X projects" counter. The button label is the icon ("⇅"), tooltip "Sort and view options," the surface inside is a small popover.

### F-20 — Skeleton key prefix is `"__skeleton__"`, but `Grid` is rendered with `role="list"` and `aria-label={microcopy.a11y.loadingProjects}` while skeleton items have `className="ant-skeleton"` and `role="listitem"` — a real AT user hears "List, 6 items, loading projects, list item, list item, list item, list item, list item, list item"

- **Surface:** `src/components/projectList/index.tsx:229-242`
- **Severity:** Low
- **Type:** a11y / polish
- **Evidence:**
  ```tsx
  <Grid role="list" aria-label={microcopy.a11y.loadingProjects}>
      {Array.from({ length: SKELETON_COUNT }, (_, idx) => (
          <div key={`${SKELETON_KEY_PREFIX}${idx}`} role="listitem" className="ant-skeleton">
              <ProjectCardSkeleton />
          </div>
      ))}
  </Grid>
  ```
- **Why it matters:** AT users hear six empty list items announced. `aria-busy` on the parent + a single `role="status" aria-live="polite"` "Loading projects" announcement would communicate the state cleanly.
- **Proposed fix:** Drop `role="list"` + 6×`role="listitem"` on the skeleton tree; render a single `<span role="status" aria-live="polite" className="sr-only">Loading projects</span>` plus the visual skeletons as plain `<div aria-hidden>`.

### F-21 — `Modal.confirm` for delete project is *imperative* — it bypasses the URL-state pattern the rest of the modals follow, so swipe-back / native iOS back does not close it

- **Surface:** `src/components/projectList/index.tsx:200-220`
- **Severity:** Low
- **Type:** mobile
- **Evidence:** Imperative `Modal.confirm({ … })` call. The codebase elsewhere prefers URL-state-driven overlays (see comment in `useProjectModal.ts:13-17`).
- **Why it matters:** On iOS Safari, the system back gesture closes the imperative dialog (because AntD listens to popstate), but the URL doesn't carry the dialog state — so a refresh or share-link doesn't restore the confirm. Bigger: the dialog can stack *above* a focused `ProjectModal` if the user opens delete while edit is open.
- **Proposed fix:** Move delete confirm into a dedicated URL-state modal (`?confirm=delete-project-XYZ`) so it matches the rest of the app. Or, for reversible deletes with optimistic UI, drop the confirm entirely and lean on the existing Undo toast pattern (`mobile-native-best-practices.md` §3 cites this).

### F-22 — `ProjectCard` has a "card-as-link" pattern via `&::after` overlay anchoring the whole card to the project URL, but the `MetaRow` action cluster's `position: relative; z-index: 3` partially escapes — the avatar in `Identity` is *under* the overlay and not separately clickable

- **Surface:** `src/components/projectCard/index.tsx:144-156, 224-246`
- **Severity:** Low
- **Type:** desktop / polish
- **Evidence:** The `TitleLink`'s `&::after { inset: 0; z-index: 1 }` (`:148-156`) covers the card; `MetaRow` has `z-index: 2` (`:194`); `ActionsCluster` has `z-index: 3` (`:232`). The manager avatar/name inside `Identity` (`:196-211`) has no z-index promotion, so it sits *under* the title-link overlay. Clicking the manager's avatar takes you to the project, not the manager. This is the more-likely-intended-but-undocumented behavior; the comment at `:142-147` is the rationale.
- **Why it matters:** Either intentional (no member detail page in Pulse, so clicking a manager avatar to-the-project is the next best) or a missed feature. If the latter, surface "View {manager}'s projects" via a popover on avatar hover.
- **Proposed fix:** Document intent in the comment; if you intend the avatar to be clickable separately, add `position: relative; z-index: 3` to the avatar element. If not, mark it `pointer-events: none` to clarify.

### F-23 — `ProjectCard` "More" dropdown items wrap a `<button>` inside `MenuProps.items[].label` — this stacks a button inside AntD's menu item (which is itself a `<li role="menuitem">`), confusing AT and double-instrumenting tap targets

- **Surface:** `src/components/projectCard/index.tsx:282-331`
- **Severity:** Medium (a11y)
- **Type:** a11y
- **Evidence:**
  ```tsx
  const items: MenuProps["items"] = [
      { key: "edit", label: (<button … onClick={…}>{microcopy.actions.edit}</button>) },
      ...
  ]
  ```
- **Why it matters:** AntD's `Menu` already wires `onClick={(info) => …}` per menu item. Wrapping `<button>` inside `label` produces an `<li role="menuitem"><button>Edit</button></li>` tree. VoiceOver announces "Edit, menu item" *and* the focusable button. Tab order is unpredictable. The "Edit" button is also why `stopPropagation()` is plastered onto every click handler — it's papering over the parent menu's own click handler.
- **Proposed fix:**
  ```tsx
  const items: MenuProps["items"] = [
      { key: "edit", label: microcopy.actions.edit },
      { key: "delete", label: microcopy.actions.delete, danger: true }
  ];
  <Dropdown menu={{ items, onClick: ({ key }) => key === 'edit' ? onEdit() : onDelete() }}>
  ```
  Then `stopPropagation` (`projectCard.tsx:287, 314, 432, 448`) and the inline `<button>` styling can all go.

### F-24 — `ProjectCard` title link forced a full document navigation that dropped SPA state, but the more menu items use AntD's normal click handler — RESOLVED

- **Surface:** `src/components/projectCard/index.tsx`
- **Severity:** Low (carried-over scar)
- **Type:** bug / mobile
- **Resolution:** The title link now navigates client-side via `navigate(\`/projects/${id}\`, { viewTransition: true })`; the modifier-click guard keeps the anchor `href` so Cmd/Ctrl/Shift/middle-click still open the project in a new tab. The full-document-navigation helper and the "context-propagation failure" workaround it embodied have been removed entirely — the dependency tree has a single deduped `react-router` pair, so plain client-side navigation works.
- **Why it had mattered:** A full document reload lost the React Query cache, remounted the entire app shell, and was the slowest possible mobile path for the highest-frequency action on this page (clicking a project to open its board). View Transitions now apply.

### F-25 — `EmptyState` Container is `role="status"`, which is an ARIA live region — its CTA buttons get announced as part of the status update

- **Surface:** `src/components/emptyState/index.tsx:98`
- **Severity:** Low
- **Type:** a11y
- **Evidence:**
  ```tsx
  <Container data-testid={testId} role="status">
  ```
- **Why it matters:** When the project list resolves to empty, AT users hear "No projects yet. Create your first project to start tracking work… Create project, button." That's tolerable on first paint, but if the list re-resolves to empty after a filter clear (e.g. you had filtered, now you reset filters, and there really are no projects), `role="status"` re-announces the entire region including the CTA. AT users get a CTA "spoken" instead of being able to tab to it.
- **Proposed fix:** Move `role="status"` to a wrapper that contains only the title + description (the *status* content). Render the CTA outside the live region. Or use `aria-live="polite"` on the inner Title element only.

### F-26 — `ProjectModal` keeps `destroyOnHidden={false}` and `forceRender` while wiring `setFieldsValue(editingProject)` to a `useEffect` — the form is always mounted, so when the modal opens to *create* a new project after editing, the form starts with the prior project's values until the `useEffect` clears them

- **Surface:** `src/components/projectModal/index.tsx:88-90, 106-107`
- **Severity:** Low
- **Type:** bug
- **Evidence:** `editingProject` is `undefined` for create. `form.setFieldsValue(undefined)` is a no-op. The form is only reset by `onClose`'s `form.resetFields()`. So the flow `Edit A → Close → Open (Create)` works *because* `onClose` reset, but `Edit A → Open (Create)` (without close, e.g. via a future URL switch) leaves A's values briefly visible.
- **Why it matters:** Today the bug is unreachable because openModal vs startEditing always closes between calls. But it's a footgun — a future Redux dispatch that switches from edit to create without going through `closeModal` will leak.
- **Proposed fix:** `form.setFieldsValue(editingProject ?? {})` — or, cleaner, render the modal with `destroyOnHidden` and a `key={editingProject?._id ?? 'create'}` so AntD remounts the form on intent change.

### F-27 — `ProjectModal` puts a `ErrorBox` between the description text and the first form field — the error message slot is `min-height: 1.5em` even when empty, claiming vertical space below the description with no visible content

- **Surface:** `src/components/projectModal/index.tsx:171`, `src/components/errorBox/index.tsx:36-47`
- **Severity:** Low (polish)
- **Type:** desktop / polish
- **Evidence:**
  ```tsx
  <div … style={{ minHeight: "1.5em" }} … />
  ```
- **Why it matters:** ~24 px of dead vertical space lives between description and the first field, even when there is no error. The dead slot is *intentional* (to prevent layout shift when an error appears) — but the description copy is already `marginBottom: space.md` (16 px), so the combined gap is ~40 px between description and the first label.
- **Proposed fix:** Either drop the `min-height` and accept a 24 px CLS on first error, OR move the ErrorBox above the description (where the existing margin acts as the gap), OR collapse the ErrorBox to zero height when empty and animate it open with `@starting-style` (no CLS, no dead slot).

### F-28 — `ProjectModal` uses `block: !screens.sm` on both Cancel and OK and renders a stacked column footer on phones — but the *OK button is on top* and the Cancel button is below

- **Surface:** `src/components/projectModal/index.tsx:128-143`
- **Severity:** Low
- **Type:** mobile
- **Evidence:**
  ```tsx
  <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
      <OkBtn />
      <CancelBtn />
  </div>
  ```
- **Why it matters:** On a phone, the user's thumb sits at the bottom of the viewport. Material/HIG guidance is that the destructive/secondary action sits *above* the primary — when stacked vertically, the *primary* should be lowest. Today, the primary "Create project" floats at the top of the stack and Cancel is in the thumb zone. The user has to reach upward for the primary action — the opposite of what mobile expects.
- **Proposed fix:** Swap the order on mobile: `<CancelBtn />` then `<OkBtn />`. Confirm against iOS Mail / Calendar / Settings — they all bottom-anchor the primary action.

### F-29 — `ProjectList` has exactly one view (grid) and one sort axis (name/created) — no list mode, no group-by-organization, no pinned-projects section

- **Surface:** `src/components/projectList/index.tsx:90-99, 104-149`
- **Severity:** Medium (ambition)
- **Type:** ambition
- **Evidence:** Single `Grid` with auto-fill `minmax(18rem, 1fr)`. Single `<Select>` over four sort orders.
- **Why it matters:** The data already supports the upgrade. Users who like ≥ 1 project have a "favorites" intent. The `manager` field implies "my projects" vs "all" filtering. The `organization` field implies grouping. None of these are surfaced. The page reads as a flat directory.
- **Proposed fix:** See *Ambitious redesign proposals* §2.

### F-30 — `ProjectCard` shows zero dynamic signal — no task count, no last-activity date, no member presence dots, no AI-summary preview

- **Surface:** `src/components/projectCard/index.tsx:334-455`
- **Severity:** High (ambition)
- **Type:** ambition
- **Evidence:** A card surfaces: organization (tertiary text), title, manager, created-at, AI match-strength badge (only when an AI search is active). That's it. Nothing about the project's *current state* (open tasks, blocked tasks, last updated, who's online).
- **Why it matters:** The project list is the user's daily index. Without dynamic signals, the answer to "which project should I look at first today?" requires opening each card. A 2-second scan should answer it.
- **Proposed fix:** See *Ambitious redesign proposals* §3.

### F-31 — `LoginForm` and `RegisterForm` share a 14-line `CapsLockSlot` plus the `onKeyUp` caps-lock detector — duplicated verbatim across both components

- **Surface:** `src/components/loginForm/index.tsx:27-31, 144-152, 163-188`, `src/components/registerForm/index.tsx:18-22, 137-150, 163-187`
- **Severity:** Low
- **Type:** polish / desktop
- **Evidence:** Identical caps-lock handling.
- **Why it matters:** Today, two places to keep in sync. If you ever want to add a "Num Lock is off" hint (rare but it has happened for SaaS apps with numeric-PIN passcodes), you'd add it twice.
- **Proposed fix:** Extract `<PasswordField onCapsLock={…} />` that wraps `<Input.Password>` + slot + onKeyUp. The hook `useCapsLock()` could be event-driven on the form element instead of per-input.

### F-32 — `forgotPassword` and `terms` pages share the `Auth*` shell but render *no* call to navigate back — the AuthLayout's brand mark is the only way to leave (back to "/")

- **Surface:** `src/pages/forgotPassword/index.tsx`, `src/pages/terms/index.tsx`
- **Severity:** Medium
- **Type:** mobile / desktop
- **Evidence:** No link back. The brand mark in `BrandHeader` (`authLayout.tsx:362-364`) renders a `<BrandMark size="md" />` — let me verify it's a link.
- **Why it matters:** A user lands at `/auth/terms` from the register page (`termsAgreement.tsx:36`), reads the content, has no UI affordance to go back to `/register`. Browser back works, but mobile users often miss it (especially in installed PWAs where browser chrome is absent).
- **Proposed fix:** Add a "Back to {prior page}" link at the top of the terms / forgot-password pages. Track the referrer in router state so the link knows whether to go to `/login` or `/register`.

### F-33 — `ProjectModal` description text reads like a tooltip, not a help text — and is the same height as an `AuthSubtitle`, competing with the form

- **Surface:** `src/components/projectModal/index.tsx:157-169`
- **Severity:** Low
- **Type:** polish / desktop
- **Evidence:**
  ```tsx
  <Typography.Text style={{ display: "block", fontSize: fontSize.sm, lineHeight: lineHeight.normal, marginBottom: space.md }} type="secondary">
      {isEditing ? microcopy.projectModal.editDescription : microcopy.projectModal.createDescription}
  </Typography.Text>
  ```
  The create copy is `"Set a name, organization, and a manager to start tracking work."` That's repeating what the fields will ask anyway.
- **Why it matters:** The description is doing nothing the labels can't say better. It eats 24 px on a phone modal that's already short.
- **Proposed fix:** Drop the description on create. Keep it on edit only if there's a non-obvious side-effect to surface ("Changes apply to all members instantly"). Better: replace the description with an *inline AI suggestion* on create — "Pulse can draft a starter board for {organization}. Generate." That's a content opportunity, not just chrome.

### F-34 — `ProjectModal` `Spin` wraps the whole form on `isLoading`, but `isLoading` is true only during the *editing-project hydration* — so on create, the spinner never fires, and the user's mental model of "loading" is asymmetric

- **Surface:** `src/components/projectModal/index.tsx:152-156`
- **Severity:** Low
- **Type:** polish
- **Evidence:**
  ```tsx
  const { isModalOpened, closeModal, editingProject, isLoading } = useProjectModal();
  …
  <Spin aria-label={microcopy.a11y.loadingProject} spinning={isLoading}>
  ```
  `isLoading` here is `useReactQuery`'s loading flag from the `editingProjectId` query (`useProjectModal.ts:45-52`). On create, no query fires, so the modal mounts with form blank, no spinner.
- **Why it matters:** Edit-then-open has a measurable spinner; create-then-open does not, even though under slow renders both spend ~50-200 ms initializing the form library and the members dropdown. Inconsistent perceived performance.
- **Proposed fix:** Either remove the Spin entirely (the form is empty during hydration anyway — there's nothing visually misleading), OR wire a `useDelayedFlag(isLoading || membersLoading, 250)` so both paths get the same spinner threshold.

## Ambitious redesign proposals

### A-1 — Make auth feel like 2026: passkey-first sign-in, magic-link fallback, password as escape hatch

**Current state.** The login form is email + password + caps-lock hint + a forgot-password link to a dead-end. There is no SSO, no passkey, no magic-link, no remember-me. The most "modern" thing is `autoComplete="username"` paired with `current-password` for iOS Keychain (loginForm/index.tsx:130-134, 164).

**Proposed direction.** Re-architect the login surface around the following ranked priorities:

1. **Passkey-first.** On page load, call `navigator.credentials.get({ publicKey: …, mediation: "conditional" })` so iOS / Android / Chrome users with a registered passkey see their fingerprint/face-id prompt the moment they tap the email field. The email field then becomes a fallback rather than a starting point.
2. **Magic-link as the no-passkey fallback.** A second tab/section "Email a sign-in link" with one input (email) and one button. Backend posts to `/auth/magic-link`, returns 202 immediately ("Check your email"). For B2B Pulse, this is the right shape — most users will sign in once per device and never see this surface again.
3. **Password as the third option.** Collapsed by default ("Sign in with password instead"). Only expanded by user choice. The existing form moves into this collapsed section.
4. **SSO buttons** (Google / Microsoft / Apple) above the email field, behind a feature flag — the spec is mature enough (`@simplewebauthn/browser`, `react-oauth/google`, MSAL) that this is shippable.

**Payoff.**

- 60-80 % of returning users tap a face-id prompt and skip the form entirely (Apple's iOS 17 conditional UI lands automatically once registered).
- Magic-link removes the "forgot password" dead-end entirely — passwords stop being the recovery vector.
- The page feels current. Today's design reads like a 2018 SaaS sign-in.

**Risk.**

- Backend lift: `/auth/passkey/register`, `/auth/passkey/authenticate`, `/auth/magic-link` need to exist. The browser API is shippable today; the server side is a 2-week feature.
- iOS Safari conditional UI requires HTTPS *and* a registered passkey — first-time users will not see it. Must degrade cleanly to a normal email input with `autocomplete="username webauthn"`.
- Magic-link UX requires email deliverability (SPF/DKIM/DMARC) — not optional, and not cheap to do well.

**Effort.** **XL** (2-3 sprints, mostly backend).

### A-2 — Replace `ProjectList`'s flat directory with a sectioned daily-index ("Pinned" → "Recent activity" → "All")

**Current state.** A single `Grid` of all projects, sortable by name / created date. Empty state when zero. No way to surface frequency-of-use, no way to surface "things changed since you last looked." The user's mental cost of "which project should I open first?" scales linearly with project count.

**Proposed direction.**

```
Pinned
  [Card A] [Card B]
  +Pin a project
Recent activity (last 7 days)
  [Card C — 4 new tasks since you visited]
  [Card D — task X moved to "Blocked" by you 2h ago]
All projects (12)
  [sort/filter/view-mode toolbar]
  [auto-fill grid as today]
```

The "Pinned" section uses the existing `likedProjects` array on the user (already wired through `onLike` in `projectList/index.tsx:183-198`). Re-brand "Like" as "Pin" everywhere (auth/copy work + heart-icon → pushpin-icon). The "Recent activity" section is server-driven (`GET /projects?since=…` returning projects with `changedSince=true`, plus an activity-delta blob). The "All" section is today's grid.

**Payoff.**

- Daily UX: the user's eye goes to "Recent activity" first, with one-glance deltas. 90 % of session opens have a "something changed since I last looked" answer.
- Pinned section makes the favorite affordance functional, not vestigial. Today, the heart icon's only effect is sorting (and even that requires re-sorting manually — it's not a sort key).
- The "All" section becomes a *navigational* surface for first-time-this-week or admin scans, not the default user experience.

**Risk.**

- Server work: needs a `?since=` query parameter on `/projects` and an activity-summary endpoint. ~3-5 days backend work.
- Empty-state nuance: a brand-new workspace has nothing pinned, no recent activity, just "All" with one project. Need clean transition rules.
- "Recent activity" can dominate visually for power users with 30 projects all changing daily; cap the section at 5 entries.

**Effort.** **L** (1-2 sprints, backend + frontend).

### A-3 — Bring `ProjectCard` to life: open-task count, last-activity sparkline, member presence

**Current state.** A static card with title, organization, manager, created-at, like/edit/delete. The card answers "what is this project's name?" — not "what is its state?"

**Proposed direction.** Add three live signals to the card body, each gated on data already in the system or one extra endpoint:

1. **Open-task / blocked count.** Tiny progress bar: `[████████░░░░] 12 of 16 open` with a red dot if any task is blocked. Pulse already has tasks; the API already returns `tasks` per project on `projects/:id/board`. Pre-fetch per-card task counts on `ProjectPage` mount via `/projects?include=task_counts`.
2. **Last-activity timestamp.** "Updated 2 hours ago by Alice" — using the existing `updatedAt` on the project plus a per-project `lastActor`. If `lastActor === user`, render "You updated this 2h ago" in italic. This is the daily "what's new" signal F-30 / A-2 leans on.
3. **Member presence dots.** On the bottom-right, render up to 4 stacked `<UserAvatar size={20}>` for members currently online (presence via WebSocket; you already have a Redux store, this is an additive overlay). If `> 4`, render `+N` chip.

Optional: **AI brief on hover.** On `(hover: hover)` devices, hover for 250 ms triggers a small popover with the latest AI-generated brief (already exists in `boardBriefDrawer` → cache the last brief per project). Mobile gets a long-press equivalent.

**Payoff.**

- The list becomes a dashboard. The user scans for high open-count + recent activity + presence to pick a project.
- Pulse's AI differentiation surfaces *on the index page* instead of being buried inside each board.
- Existing UX patterns (live signals on cards) match enterprise norm (Linear, Height, Notion).

**Risk.**

- Card height grows; the current ~100 px collapses card has to absorb +24-36 px of signals. Will need to tune sort/grid breakpoint at `breakpoints.sm`.
- AI brief popover is the riskiest — caching, freshness, cost-per-hover. Gate behind a "show AI brief on hover" preference and start with `prefetch on hover` only.
- Presence requires WebSocket lift — there is no WS today.

**Effort.** **M** (1 sprint, fronted-heavy with backend support).

### A-4 — Drop the "auth shell as split-hero" idea on mobile entirely and make the focus a single-column "what we're about" + form

**Current state.** Below `md` (`< 768 px`), the hero rail disappears (`authLayout.tsx:62-65`). The form gets the full viewport, but the brand mark is the only chrome — a tiny 36 px wordmark with no taglines, no marketing, no app context. The auth page on mobile is the form, period.

**Proposed direction.** Build a mobile-first auth landing that takes the hero copy *out* of the desktop rail and into a one-screen marketing-then-form composition:

```
[brand mark]
Ship work with calm focus.
A focused project board that turns work into momentum.
─────────────────────────
[Continue with passkey] (if supported, conditional)
[Continue with Google]
[Continue with email]
─────────────────────────
By signing in you agree to our Terms.
```

The single CTA list replaces the email/password form on first load. Tapping "Continue with email" reveals the form (animated expand). Tapping "Continue with passkey" jumps straight to the conditional UI. The result: zero fields visible on first paint, three buttons, no keyboard pop on focus. Then the marketing rail does double duty as the landing hero on mobile.

**Payoff.**

- The mobile sign-in lands without an immediate keyboard pop. This is the single biggest "feels native" win for first-time users.
- The hero copy now does what hero copy is supposed to do — sell the product — instead of disappearing on the 92 % of sessions that come from mobile.
- Passkey / SSO get to be primary instead of buried inside the email form.
- Visual brand on mobile no longer reduces to "AntD card on white."

**Risk.**

- The classic email/password flow becomes 1 tap deeper. For returning users this is a regression — mitigate by auto-expanding the email form if `cookieEmail` is set (a non-HttpOnly hint cookie that just remembers "last sign-in method").
- Existing auth tests assume the form is visible on mount; the test suite needs an `expand=email` URL param to keep test setup honest.
- Existing AntD `Form` plumbing has to coexist with the new SSO/passkey button row.

**Effort.** **L** (1-2 sprints, frontend-heavy).

## Quick wins

A bundle of small high-leverage changes that could each ship in a single PR:

1. **Trim email in LoginForm** (F-04). One-line patch: `email: input.email.trim().toLowerCase()` at `loginForm/index.tsx:64`.
2. **Add a skip-link to AuthLayout** (F-02). Lift `SkipLink` from `mainLayout.tsx` into a shared component; mount on both shells.
3. **Replace `value={managerName}` in projectSearchPanel** (F-17) with `value={param.managerId || undefined}`. One-line fix, removes a fragility, no regression possible.
4. **Page titles get a brand suffix** (F-07). Helper in `useTitle.ts`: `pageTitle(['Log in'])` → `Log in · Pulse`. Apply to all auth pages.
5. **Conditionally mount AiChatDrawer** on the projects page (F-14). Wrap with `{aiEnabled && chatOpen && <…>}`. Frees ~30 KB of warm-up work on first paint.
6. **Remove `aria-hidden={pLoading}` from StatRail** (F-15). Replace with `aria-busy={pLoading}` + a single live announcement.
7. **Stop clearing the API error on every keystroke** (F-09). Delete the `onChange={() => onError(null)}` lines or scope them to "this field's keystroke clears this field's API error."
8. **Swap stacked footer order on phone-width project modal** (F-28). Render Cancel above OK so the primary is in the thumb zone.
9. **Add a `Back to log in` link to `forgotPassword` and `terms` pages** (F-32). One link each.
10. **Demote the "More" menu inside `ProjectCard` to plain `MenuProps.items` strings** (F-23) and move `onClick` to the parent `<Dropdown menu={{onClick}}>`. Removes 24 LOC and three `stopPropagation` calls.
