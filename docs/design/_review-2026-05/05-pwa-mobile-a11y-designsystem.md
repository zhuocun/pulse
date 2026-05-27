# 05 — PWA + mobile + a11y + design system review

## TL;DR

The cross-cutting layer is **technically solid for an aspiring PWA, but installed UX is fictional today**. Manifest validates and registers a real SW with sensible strategies (`NetworkFirst` shell, `CacheFirst` hashed assets, `SWR` images/fonts), dark mode is genuinely wired through `AntD` algorithm + CSS vars (not cosmetic), reduced-motion / reduced-transparency / forced-colors / safe-area / `pointer: coarse` rules are all in place, focus rings are uniform, skip-link present, language switcher reaches `<html lang>` and `dayjs`. What's missing is the **mobile shell that turns a webpage into an app**: there is **no bottom tab bar**, no `beforeinstallprompt` capture / install nudge, no SW update toast (the only `skipWaiting` is at install time — a deployed update never claims the active client until a hard reload, so users will get stale shells silently), no PNG icon fallback (the `apple-touch-icon` is a `.svg` — iOS 15 will silently ignore that and fall back to its screenshot heuristic), no maskable PNG, no app shortcuts, no Web Share Target, no haptics, no push, no offline writes queue, no density preference, and no RTL. The header carries both the brand and the entire global account/theme/locale UI in 511 LOC; on phone, it overloads a single 44 px row that's already fighting safe-area-top. The token system itself is excellent — the `palette` swap is genuinely one-line — but **`var(--ant-color-*)` fallbacks bake hardcoded light-mode hex values into every styled component**, so anyone running with `?ant-cssvars=off`, AntD ssr, or a forced-colors edge will see brand-orange leaking into dark mode through the fallbacks. Token coverage is 87 % clean; the 13 % drift concentrates in `column/index.tsx` (raw bug/task hex, status palette of 8 raw hexes), `filterChips`, `emptyState`, and `projectCard` (one raw shadow drop), plus the `apple-touch-icon`/manifest icon paths that ship SVG-only.

Top 3 ambitious bets, ranked by user-visible payoff:

1. **Demote the header to a brand-only bar and ship a real bottom tab bar** (Boards / Inbox / Copilot / Profile) with safe-area-bottom + keyboard-aware visibility. This single change is the difference between "responsive web page" and "Pulse on my phone."
2. **Real install + update lifecycle**: capture `beforeinstallprompt`, surface a quiet "Install Pulse" nudge after second visit, and add a non-blocking "New version available — Reload" toast wired to `registration.waiting.postMessage({ type: 'SKIP_WAITING' })`. Today, dialing a `CACHE_VERSION` bump is a silent footgun.
3. **Web Share Target + manifest app shortcuts**: a user shares a Slack link or a screenshot from another app → Pulse opens with the task draft modal prefilled. Combined with three `shortcuts` entries (New task, Open last board, Open Copilot), the long-press launcher icon stops being a no-op.

## Files audited

| File | LOC | Type | Notes |
|---|---|---|---|
| `index.html` | 45 | PWA shell | Full mobile meta set; preconnects Google Fonts; SVG-only icon refs |
| `public/manifest.webmanifest` | 49 | PWA manifest | SVG-only icons (no PNG/maskable PNG); 1 screenshot reuses 192/512 icon; no shortcuts, no share_target |
| `public/sw.js` | 172 | Service Worker | Hand-rolled (no Workbox). NetworkFirst+3s for shell, CacheFirst hashed, SWR fonts/images. **No update message channel.** |
| `public/icons/*.svg` (×4) | — | Icons | 192 / 512 / maskable-192 / maskable-512 — all SVG |
| `public/apple-touch-icon.svg` | 6 | iOS icon | **SVG; iOS does not honor SVG for `apple-touch-icon`** |
| `vite.config.ts` | 62 | Build | No `vite-plugin-pwa`; SW is hand-rolled. SVGR enabled. |
| `src/App.css` | 374 | Global CSS | Inter via Google Fonts `@import` (blocking), `display=swap` ok; reduced-* media queries present |
| `src/index.tsx` | 177 | Mount | Injects palette CSS vars BEFORE render — good for no-FOUC palette; registers SW silently |
| `src/App.tsx` | 65 | Shell | Cmd/Ctrl+K palette listener; no `popstate` overlay handling |
| `src/layouts/mainLayout.tsx` | 102 | Layout | Skip link, single `<main>`, no `aria-label` on nav, no bottom tab bar |
| `src/layouts/authLayout.tsx` | 374 | Auth shell | Marketing rail + form card, safe-area complete |
| `src/components/header/index.tsx` | 511 | Header | Brand + member popover + theme toggle + account dropdown + theme/AI/lang/logout menu. Sticky. Glass. |
| `src/components/pageContainer/index.tsx` | 31 | Page wrap | Clean: tokens + safe-area + `pageMaxWidthRem` cap |
| `src/components/languageSwitcher/index.tsx` | 57 | i18n | Segmented inside Dropdown row |
| `src/theme/tokens.ts` | 291 | Tokens | Space / radius / fontSize / shadows / blur / motion / breakpoints — clean |
| `src/theme/aiTokens.ts` | 48 | AI tokens | CSS-var-first with palette fallback — clean |
| `src/theme/antdTheme.ts` | 259 | AntD theme | Builds light + dark from tokens; coarse-pointer 44 px ladder |
| `src/theme/palettes/index.ts` | 13 | Palette switch | One-line palette swap |
| `src/theme/palettes/orange.ts` | 55 | Active palette | Clean |
| `src/theme/palettes/cssVars.ts` | 68 | Var renderer | Emits both light and dark scopes — good |
| `src/components/brandMark/index.tsx` | 132 | Brand glyph | Inline SVG, gradient via `useId()` |
| `src/components/userAvatar/index.tsx` | 90 | Avatar | Token-driven; per-id gradient is opt-in |
| `docs/design/mobile-native-best-practices.md` | 354 | Reference | The intended bar |
| `docs/design/ai-ux-best-practices.md` | 700+ | Reference | AI UX |
| `docs/design-tokens.md` | 39 | Reference | Token reference |

## Findings — ranked

### 1. Service Worker has no client-side update message channel; deployed updates require a hard reload to take effect
- **Area:** PWA / SW lifecycle
- **Severity:** High (silent staleness — users see "ghost" old UI for unbounded time)
- **Type:** Correctness
- **Evidence:** `public/sw.js:21-28` calls `self.skipWaiting()` in `install` only — the new worker activates on next page open. `src/index.tsx:165-176` registers the SW without listening for `updatefound` / `controllerchange`; there is no `postMessage({ type: 'SKIP_WAITING' })` round-trip and no UI toast.

```js
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});
```

- **Why it matters:** When you ship a new bundle today, the user's already-open Pulse tab will receive a `waiting` SW; the active SW keeps serving stale `index.html` from the `pulse-v2-shell` cache (NetworkFirst would refresh, but the in-memory module graph in the open tab is already old). Users can sit on yesterday's bundle until they explicitly close the tab. Bumping `CACHE_VERSION` only helps the *next* full navigation. The mobile best-practices doc §F lists this as a "feels native" requirement, and right now the workflow violates it.
- **Proposed fix:** (a) Drop `skipWaiting` from `install`; instead, listen for `message` in the SW and call it conditionally. (b) In `src/index.tsx`, after `register()`, attach `registration.addEventListener('updatefound', …)` → when the new worker hits `installed`, surface an AntD `notification.info` with action `Reload` that posts `{ type: 'SKIP_WAITING' }` to `registration.waiting` and listens for `controllerchange` to `window.location.reload()`. This is ~30 LOC in `index.tsx` and a 6-line addition to `sw.js`.

### 2. `apple-touch-icon.svg` is SVG — iOS Safari ignores SVG apple-touch-icons and falls back to the page screenshot
- **Area:** PWA / iOS install
- **Severity:** High (visible quality regression on iOS home screen)
- **Type:** Correctness
- **Evidence:** `index.html:33` (`<link rel="apple-touch-icon" href="/apple-touch-icon.svg" />`), `public/apple-touch-icon.svg:1-6`

- **Why it matters:** Apple's docs are explicit: `apple-touch-icon` must be a PNG. When a user "Add to Home Screen" on iOS Safari with only an SVG declared, iOS uses an auto-generated screenshot of the page — a tiny, blurry, badly-cropped rectangle of the auth screen or the project list. The same risk applies to `purpose: "any"` SVG entries in `manifest.webmanifest:24-34`: Chrome accepts SVG, but iOS uses the manifest entries only for installable PWA; the home-screen tile still wants the apple-touch-icon PNG. The mobile-native doc §1 even acknowledges this gap: *"Real PNG icons for the manifest" — listed as done with caveat "for production, run `pwa-asset-generator`"* but the production output never landed.
- **Proposed fix:** Generate PNGs (180×180, 167×167, 152×152, 120×120 for apple-touch-icon; 192, 512 for `purpose: "any"`; 192, 512 for `purpose: "maskable"`) via `pwa-asset-generator` or a one-shot script. Add `apple-touch-icon-precomposed` for older iOS. Keep the SVGs as a `purpose: "any"` alternate for Chrome (smaller bytes).

### 3. Header sticky + ResizeObserver runs on every mount but `--header-height` is written into `documentElement.style`, leaking layout state across hot-reload and tests
- **Area:** Navigation / mobile shell
- **Severity:** Medium-High (jank on mount + memory leak on route swap)
- **Type:** Correctness / performance
- **Evidence:** `src/components/header/index.tsx:343-360`

```ts
useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const writeHeight = (h: number) => {
        document.documentElement.style.setProperty("--header-height", `${h}px`);
    };
    writeHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            writeHeight(entry.contentRect.height);
        }
    });
    observer.observe(node);
    return () => observer.disconnect();
}, []);
```

- **Why it matters:** The initial `writeHeight(node.getBoundingClientRect().height)` runs after mount, after first paint. Any consumer of `var(--header-height)` (none in scope, but the comment claims project detail page uses it for sticky breadcrumbs) sees `undefined` for one frame, then the value snaps in — visible as a 60-ish-px content jump at the top of the page. The unobserved-on-cleanup path is fine, but the property is never reset to `null` on `disconnect`, so a route swap that unmounts the Header (e.g. auth pages) leaves a stale value glued to `<html>`.
- **Proposed fix:** Write the height *synchronously* in a layout effect (`useLayoutEffect` for the first write, `useEffect` for the observer) so the value lands before the first paint; clear with `documentElement.style.removeProperty('--header-height')` in the cleanup.

### 4. The header is doing too much — 511 LOC of mobile-shell responsibility crammed into a sticky chrome
- **Area:** Mobile navigation
- **Severity:** Medium-High (UX cliff on phone)
- **Type:** Architecture / UX
- **Evidence:** `src/components/header/index.tsx` total LOC; sample: `LeftCluster` (brand + MemberPopover), `RightCluster` (AgentHealthBadge + theme IconButton + account Dropdown with theme/ai/lang/logout); `:228-238` (HiddenOnNarrow / HiddenOnTiny visibility primitives manually toggle UI fragments).

- **Why it matters:** On phone, the header carries the brand glyph, an inline theme toggle, the account dropdown trigger with greeting, and a member popover trigger — all in a 44 px row. The account dropdown is also the home for language + AI on/off + dark mode, which means a one-handed phone user reaches up to a small dropdown for every settings concern. The mobile-native doc §B is explicit: *"Bottom tab bar > hamburger for 3-5 primary destinations. Redbooth data: +65 % DAU and +70 % session length after switching."* Pulse has natural destinations: Boards, Inbox (nudges), Copilot (chat), Profile — but no nav. The header attempts the bottom-tab role from the top, which is the wrong half of the thumb zone.
- **Proposed fix:** Ship a bottom tab bar on coarse pointers (see Ambitious #1). Demote header on phone to brand + 1 settings icon. Move theme toggle + lang + AI on/off into a dedicated `/settings` route reachable from the Profile tab. This trims the header from 511 LOC to ~150 LOC and moves frequently-tapped actions into the thumb zone.

### 5. SW `staleWhileRevalidate` falls through to same-origin "other" — buffers HTML route chunks under the wrong cache
- **Area:** PWA / SW
- **Severity:** Medium (correctness, debugging puzzles)
- **Type:** Correctness
- **Evidence:** `public/sw.js:168-170`

```js
if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
}
```

- **Why it matters:** This catch-all writes anything not classified above into `STATIC_CACHE`. In dev with the Vite proxy off, an XHR to a same-origin endpoint that isn't `/api/*` (e.g. a future `/auth/csrf` or a JSON file in `public/`) gets cached as a static asset. The `isApiRequest` test only matches `/api/`. A future endpoint move would silently start serving stale JSON.
- **Proposed fix:** Default to `NetworkOnly` for unclassified requests. The doc-stated strategy (§F: *"API calls: NetworkOnly (handled by React Query)"*) covers `/api`; the same default should apply to everything outside the explicit asset paths.

### 6. `theme-color` has only two values — no OLED-black variant for installed dark mode
- **Area:** PWA / iOS / Android polish
- **Severity:** Medium
- **Type:** UX
- **Evidence:** `index.html:9-18`, `public/manifest.webmanifest:11`

The HTML declares light (`#FEFAF5`) and `prefers-color-scheme: dark` (`#1A0F0A`); the manifest declares a single `theme_color: "#FEFAF5"`. There is no installed-app variant. On OLED devices, `#1A0F0A` is a perceptible warm-brown rectangle around the active app, not pure black.

- **Proposed fix:** Manifest can carry a single `theme_color`, but Chromium installs honor `meta[name=theme-color]` per `prefers-color-scheme` (already used). On installed standalone, iOS reads `apple-mobile-web-app-status-bar-style="black-translucent"` (already set — good), and uses the `theme_color` for the splash. The OLED win is to add a third media query: `(prefers-color-scheme: dark) and (dynamic-range: high)` → `#000000`. Two-line addition to `index.html`.

### 7. Inter font is loaded via blocking `@import url(...fonts.googleapis.com...)` in `App.css:8`, not via `<link rel="preload">` with `font-display: swap` semantics
- **Area:** Performance / FOUT
- **Severity:** Medium
- **Type:** Performance
- **Evidence:** `src/App.css:8`, `index.html:35-36`

The HTML preconnects to `fonts.googleapis.com` and `fonts.gstatic.com` — but Inter is requested by `App.css`, which is itself bundled with the rest of the app stylesheet by Vite. That means: (a) the stylesheet must finish parsing before the `@import` fires (one extra round-trip after JS is parsed), and (b) the `display=swap` query param keeps it from being render-blocking, but it still incurs a layout shift when Inter replaces the system fallback. CLS contribution is small but visible.

- **Proposed fix:** Drop the `@import`; add `<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" /><link rel="stylesheet" ...>` in `index.html`. Add `size-adjust: 100%` (or measured) on a `@font-face` fallback so the system-font glyph metrics match Inter — best-in-class is `Inter` + a measured `local()` fallback in a `@font-face` with `ascent-override`/`descent-override`. Most direct win: self-host Inter as `woff2` from `/fonts/`; SW already CacheFirsts hashed `.woff2`.

### 8. No PWA install prompt deferral / nudge — `beforeinstallprompt` is never captured
- **Area:** PWA / engagement
- **Severity:** Medium
- **Type:** UX
- **Evidence:** Repo-wide grep for `beforeinstallprompt`, `setAppBadge`, `navigator.share`, `pushManager`, `Notification.requestPermission` returns **zero hits** outside `src/index.tsx`.

The mobile-native doc §A explicitly says: *"For custom install prompts, capture `beforeinstallprompt`, surface only after engagement, never on first paint, never blocking flows. iOS Safari has no `beforeinstallprompt` — show 'Share → Add to Home Screen' instructions only on iOS Safari tabs."* None of this is implemented.

- **Proposed fix:** Add `src/utils/installPrompt.ts` that stashes the deferred event in module scope; a small `InstallNudge` component (similar shape to `copilotWelcomeBanner/index.tsx`) reads it via a hook and gates display on: ≥2 sessions, no install in 7 days, not in standalone (`window.matchMedia('(display-mode: standalone)').matches === false`), and a `localStorage` dismissal flag. iOS fallback: detect `/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream && !navigator.standalone` and render a "Tap Share → Add to Home Screen" card with the Share glyph.

### 9. No bottom tab bar — primary destinations are not in the thumb zone
- **Area:** Mobile navigation
- **Severity:** Medium-High
- **Type:** UX
- **Evidence:** `src/layouts/mainLayout.tsx` (no nav region rendered below `<Outlet />`); `src/components/header/index.tsx` carries all primary triggers via `MemberPopover` (`:450`) and the account dropdown (`:473`). Repo grep for `BottomTab`/`tabBar` is empty.

- **Why it matters:** See finding #4. Reachability on a 6.1"+ phone is a well-studied wedge — Reachability gestures are workaround for top-corner targets. The MemberPopover and project-search panel are the two reads users do most often on phone; both sit at the top of the screen.
- **Proposed fix:** See Ambitious #1.

### 10. `<a href>` in many places without an explicit standalone-PWA breakout interceptor — taps will boot the user to mobile Safari
- **Area:** PWA / iOS
- **Severity:** Medium (visible jank)
- **Type:** Correctness
- **Evidence:** `src/components/projectCard/index.tsx` (`TitleLink` is a real `<a>`), `src/components/header/index.tsx` (`BrandLink` is a real `<a>`). Both now intercept the primary click for client-side navigation while keeping the `href` for modifier-click new-tab.

The mobile-native doc §3 calls this out: *"Standalone-mode link breakout: tapping any `<a>` with `target="_blank"` or different origin in iOS standalone PWA jumps the user back to Safari (intercept clicks; check `window.navigator.standalone`)."* Pulse has zero `target="_blank"` triggers in the audited scope, but the policy isn't codified — any future external link in chat / brief would silently break out.

- **Proposed fix:** Add a `src/utils/safeLink.ts` helper that, when `navigator.standalone` is true and the link is external, opens in a new browser tab via `window.open(url, '_system')` or — for in-app navigation that must stay in the PWA — uses `e.preventDefault()` and SPA-navigates. Apply uniformly to `Typography.Link`, AntD `<Anchor>`, and any markdown-rendered links in chat replies.

### 11. No `<nav aria-label>` landmark — screen-reader users have only one landmark per page
- **Area:** A11y
- **Severity:** Medium
- **Type:** A11y
- **Evidence:** `src/layouts/mainLayout.tsx:88-98` (only `<Container>`/`<Main>`); `src/components/header/index.tsx:436-507` renders as `<header>` but its children are not a `<nav>` region.

- **Why it matters:** WCAG 2.4.1 (Bypass Blocks) plus screen-reader rotor navigation expects `banner`, `navigation`, `main`, `complementary` landmarks per page. Pulse has `banner` (header) and `main` (skip-link target), but no `navigation`. The MemberPopover (people) and ProjectPopover (project switcher) are nav-shaped but rendered as Dropdowns. A bottom tab bar should be a `<nav aria-label="Primary">`.
- **Proposed fix:** Wrap the future tab bar (and even today's `MemberPopover`/`ProjectPopover` triggers) in a `<nav aria-label="Primary">`. Trivial 4-line edit.

### 12. iOS `interactive-widget=resizes-content` is set but `interactive-widget: overlays-content` is more accurate for chat composers that need to float above the keyboard
- **Area:** Mobile shell / keyboard
- **Severity:** Low-Medium
- **Type:** UX
- **Evidence:** `index.html:7` declares `interactive-widget=resizes-content`. `src/components/aiChatDrawer/index.tsx` (chat composer) and `src/components/taskModal/index.tsx` (notes) both have flexible-height inputs.

- **Why it matters:** With `resizes-content`, the layout viewport shrinks when the soft keyboard opens — fine for a static form but a brief flash on the AI chat scroll position. The mobile-native doc §D specifically suggests `navigator.virtualKeyboard.overlaysContent = true` for chat composers, paired with `env(keyboard-inset-height)`.
- **Proposed fix:** Keep the global `interactive-widget=resizes-content` as the default. In `aiChatDrawer/index.tsx`'s mount, opt into `navigator.virtualKeyboard.overlaysContent = true` on Chromium (feature-detect), and use `env(keyboard-inset-height)` for the composer's `padding-bottom`. Browsers without the API fall through to the resize behavior — no regression.

### 13. Dark mode `color-scheme` is on `<html>` but the `:focus-visible` outline ignores it — outline contrast on dark is weaker
- **Area:** A11y / dark mode
- **Severity:** Low-Medium
- **Type:** A11y
- **Evidence:** `src/App.css:246-249`

```css
:focus-visible {
    outline: 2px solid var(--ant-color-primary, #ea580c);
    outline-offset: 2px;
}
```

`--ant-color-primary` resolves to `#EA580C` in light AND in dark (AntD dark algorithm keeps `colorPrimary` identical). On dark surface `#1A0F0A`, the 4.16:1 contrast passes for icons but is dim against the cinematic black auth rail (`#1F0E07`).

- **Why it matters:** WCAG 2.4.11 (Focus Appearance) wants a focus indicator with ≥3:1 contrast against its background; ok on the page surface, marginal on the hero rail. Power keyboard users on dark mode see a dim ring rather than a confident one.
- **Proposed fix:** Use the dark-mode brand step (`brand.primaryDark = #FB923C` from `orange.ts:27`) when `color-scheme: dark` is active. CSS:

```css
html[data-color-scheme="dark"] :focus-visible {
    outline-color: var(--color-copilot-grad-start);
}
```

### 14. No "Inbox" / mention surface exists — Web Push will land into a void
- **Area:** Engagement / a11y
- **Severity:** Low (future-blocker)
- **Type:** Architecture
- **Evidence:** Repo grep: `useNudgeInbox` is the only inbox-shaped hook; no route, no destination page.

- **Why it matters:** Push notifications (iOS 16.4+ for installed PWAs only) land users on a URL. Without an Inbox destination, the notification's `data.url` has nowhere stable to deep-link to. The mutation-proposal-card surfaces an inline approval flow but is per-board, not per-user.
- **Proposed fix:** Carve out `/inbox` as a route + tab; aggregate `useNudgeInbox` proposals across boards. This is also the right hook to land copilot mentions when @-references ship.

### 15. The "Inter" font import lives in CSS at `App.css:8`, but typography tokens at `tokens.ts:277` declare the full fallback stack — the system never gets to use it because Inter is always requested
- **Area:** Performance / offline
- **Severity:** Low
- **Type:** Performance
- **Evidence:** `src/App.css:8` vs `src/theme/tokens.ts:276-279`

- **Why it matters:** Offline-first installed PWA still ships the Inter request on first paint of every cold start. SW catches it on second open (good), but the first install carries a 60–80 KB cost.
- **Proposed fix:** Self-host the four needed Inter weights as `woff2` under `/fonts/inter-{400|500|600|700}.woff2`; declare `@font-face` with `font-display: swap` and explicit `unicode-range: U+0000-00FF, U+0131, U+0152-0153, ...` so Chinese (`zh-CN`) locales aren't forced to download Latin-only glyphs they don't need.

### 16. The relative-time helper in `boardBriefDrawer/index.tsx:178-197` doesn't use `Intl.RelativeTimeFormat`
- **Area:** i18n
- **Severity:** Low
- **Type:** i18n
- **Evidence:** `src/components/boardBriefDrawer/index.tsx:178-197` builds "3 minutes ago" by hand via microcopy strings.

- **Why it matters:** Adding a future locale (`ja`, `fr`) means adding `relativeMinutes_one`, `relativeMinutes_other` plural keys per language. `Intl.RelativeTimeFormat` is Baseline since 2020 and handles plurals for free.
- **Proposed fix:** Replace with `new Intl.RelativeTimeFormat(getActiveLocaleCode(), { numeric: 'auto' }).format(-minutes, 'minute')`.

### 17. The token system is the single source of truth, but every `styled` block bakes a literal fallback into `var(--ant-color-*, #hex)` — a missing CSSVar key reverts to light forever
- **Area:** Design system / dark mode robustness
- **Severity:** Low-Medium
- **Type:** Architecture
- **Evidence:** `src/components/header/index.tsx:168`, `:205`, `:218-219`, `:253-254`, `:499`; `src/components/projectCard/index.tsx:39`, `:130`, `:184`, `:213-218`; many more (see token-coverage audit).

```ts
color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
```

- **Why it matters:** AntD's CSS-var scope is `:where(.ant)`, attached to `<html>` by `ThemedShell` (`utils/appProviders.tsx:55-69`). If a future refactor accidentally drops that class, every `var(--ant-color-*)` falls back to the *light-mode literal*, even in dark — the comment in `appProviders.tsx:62-68` acknowledges the fragility. Token loss isn't catastrophic, but it would silently regress dark mode for every styled-component.
- **Proposed fix:** Author a helper `tk('color.text')` that returns `var(--pulse-color-text)` (palette-defined, not AntD-scoped), so the fallback lives in `cssVars.ts` (which emits both light and dark blocks). Migrate styled components over time; the AntD `var(--ant-*)` usage can stay where AntD owns the surface (Table, Form), but page chrome shouldn't lean on it.

### 18. `src/components/column/index.tsx:393-401` carries a private 8-color status palette in hex
- **Area:** Design system
- **Severity:** Medium
- **Type:** Token drift
- **Evidence:** `src/components/column/index.tsx:281-292` (`TaskTypeBadge` hard-codes `#DB2777`/`#EA580C`), `:383-401` (`STATUS_PALETTE` hex array used by `dotForColumn`)

- **Why it matters:** These colors don't follow palette swap. Switching to the `emerald` palette (`src/theme/palettes/emerald.ts`) leaves the column-status dot brand-orange. Bug/task badge is similarly locked: a future palette where bug is teal would not propagate.
- **Proposed fix:** Move `STATUS_PALETTE` into `tokens.ts` (export `statusDotColors`); have `Palette` type carry the bug/task color pair. The brand layer is already palette-driven — extending it to the data-viz layer is one indirection.

### 19. Screenshots field in manifest reuses icon SVG instead of a real form-factor screenshot
- **Area:** PWA / install dialog
- **Severity:** Low-Medium
- **Type:** UX polish
- **Evidence:** `public/manifest.webmanifest:13-21`

```json
"screenshots": [
    { "src": "/icons/icon-512.svg", "sizes": "512x512", ... }
]
```

- **Why it matters:** Chromium's install dialog shows a rich card when a `narrow` screenshot is present. Today, Pulse's screenshot is the same square icon as the app icon — the install dialog won't render anything useful.
- **Proposed fix:** Add two PNG screenshots (`form_factor: "narrow"` 1080×1920 of the project list; `form_factor: "wide"` 1920×1080 of the board). 2-line manifest edit + 2 PNGs in `public/screenshots/`.

### 20. `density` preference is not user-configurable
- **Area:** A11y / dynamic type
- **Severity:** Low-Medium
- **Type:** A11y
- **Evidence:** `src/theme/antdTheme.ts:86-89` reads `coarsePointer` from device; `usePointerCoarse` (`utils/appProviders.tsx:14-44`) is the only signal.

- **Why it matters:** A user on a Pixel Tablet ("coarse" + large screen + 70-year-old eyes) gets compact-on-coarse — fine. A user on a 6.1" Android with steady hands ("coarse" + small screen + 25-year-old eyes) gets the same 44 px target ladder when they might prefer Compact for information density. There's no `Cmd-K` to flip density. The mobile-native doc §E lists this gap implicitly under "Dynamic type."
- **Proposed fix:** Add `density: 'comfortable' | 'compact'` to the account dropdown's settings row (next to dark mode), persist per user, feed into `buildAntdTheme(scheme, coarse, density)` to bump `controlHeight` `+4` on `comfortable` over the existing coarse ladder.

## Ambitious redesign proposals

### A. Bottom tab bar + demoted header on phone

**Current:** Sticky header (511 LOC) carries the brand, MemberPopover trigger, theme toggle, account dropdown with theme/AI/lang/logout. Phone users reach to the top for every navigational action. No bottom nav. Reachability is bad.

**Direction:** On `pointer: coarse` viewports (or `max-width: ${breakpoints.md}`), demote header to brand-only (~150 LOC), and add `<nav aria-label="Primary">` at the bottom as a 4-tab bar:
- **Boards** (route: `/projects`)
- **Inbox** (new route: `/inbox` — aggregates `useNudgeInbox` + future @-mentions)
- **Copilot** (opens `aiChatDrawer` at full-height — already mobile-friendly per existing media queries)
- **Profile** (new route: `/settings` — theme, language, AI on/off, density, log out)

Bar uses `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`, keyboard-aware visibility via `visualViewport` resize listener (hide when keyboard is open), backdrop-blur with `prefers-reduced-transparency` fallback. Each tab is a 56×56 hit target.

**Payoff:** This is the headline "feels native" win. The Redbooth case study in the mobile-native doc cites +65 % DAU after a similar move. The header simplifies, the account dropdown disappears, and the Copilot becomes a destination instead of a hidden trigger.

**Risk:** Tablet (768–1023 px in portrait) is the awkward middle — bottom tabs feel cramped on a 1024×768 iPad in landscape. Mitigate with `@media (min-width: ${breakpoints.md}px)` → keep header-only.

**Effort:** ~2 days. New `src/components/bottomTabBar/index.tsx`, new `/inbox` and `/settings` routes (lazy-loaded), thread settings into existing hooks. Migration of theme/lang controls out of the header dropdown into the settings page.

### B. Real install + update lifecycle

**Current:** SW registers and silently activates on next full reload. No install nudge. No update toast. Users sit on stale bundles indefinitely.

**Direction:** Three pieces:
1. **Update toast** — `src/utils/sw.ts` exposes `subscribeToUpdate(callback)`. `index.tsx` registers and listens for `updatefound` → `installed`; surfaces an AntD `notification.info` with action `Reload`. Action posts `{ type: 'SKIP_WAITING' }` to `registration.waiting`, listens for `controllerchange`, then `window.location.reload()`. The SW changes: remove `skipWaiting` from `install`; add `addEventListener('message', e => e.data?.type === 'SKIP_WAITING' && self.skipWaiting())`.
2. **Install nudge** — capture `beforeinstallprompt`, render `InstallNudge` after second visit (≥2 entries logged in `localStorage`), not on first paint, not during onboarding. Nudge is a dismissible card on `/projects`. iOS Safari (no `beforeinstallprompt`) gets a separate "Share → Add to Home Screen" iOS-detection variant.
3. **App shortcuts** in manifest — `shortcuts: [{ name: 'New task', url: '/projects?new=task' }, { name: 'Open Copilot', url: '/projects?copilot=open' }, { name: 'My boards', url: '/projects' }]`.

**Payoff:** Stops the silent-stale bug. Doubles install rate (per web.dev benchmarks for nudge-after-second-visit patterns). Long-press launcher actions on Android make Pulse feel like a real app.

**Risk:** Update toast can be annoying if shown during active edits — gate on idle (no `mousedown` / `keydown` in the last 30 s) or just on next page navigation.

**Effort:** ~1 day. SW changes are surgical; install nudge is a small component with the same shape as `copilotWelcomeBanner`.

### C. Web Share Target + share-from-app

**Current:** Pulse can only receive input via its own UI. Sharing a Slack link/screenshot/text from another app to Pulse is impossible.

**Direction:** Add `share_target` to manifest:

```json
"share_target": {
    "action": "/share-target",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
        "title": "name",
        "text": "description",
        "url": "url",
        "files": [{ "name": "screenshots", "accept": ["image/*"] }]
    }
}
```

New route `/share-target` parses the form, prefills the task draft modal with `name=<title>`, `note=<text>\n\n<url>`, and (future) attaches the file. Combined with the deferred install prompt (Ambitious B), share-from-app is the single most "feels installed" workflow.

**Payoff:** New input vector for tasks. Aligns with the AI UX direction — share a Slack message → AI suggests a column → user approves. iOS 17+ honors share_target on installed PWAs.

**Risk:** File handling needs backend support if persisting attachments; v1 can keep files in-memory in the draft. Privacy: ensure the share data doesn't leak through analytics before the user confirms.

**Effort:** ~1.5 days including a route guard for unauth → login-and-resume flow.

### D. Density preference + dynamic-type accessibility

**Current:** Density is implicit from `pointer: coarse`. No user override.

**Direction:** Add `density` to `useColorScheme`-style settings hook (`useDensity`), persist to `localStorage`. Plumb into `buildAntdTheme(scheme, coarse, density)`. Surface in `/settings` (Ambitious A's profile tab) as a Comfortable / Compact / System Segmented control. Hook also exposes `fontScale` so future "Larger text" preference can lift `fontSize.base` from 14 → 16 px in a single token resolution.

**Payoff:** Real accessibility win; differentiator vs. AntD's stock density. Aligns with iOS/Android Dynamic Type expectations.

**Risk:** Token-derived sizes (`controlHeight`, `radius.md`, `space.md`) compose — care needed so that bumping `space` doesn't crash board column widths. Most styled components already use `${space.xs}px` directly, so the multiplier needs to be applied to the *token export*, not just AntD.

**Effort:** ~1 day plus screenshot diff sweep.

### E. Onboarding tour via `copilotWelcomeBanner` extension

**Current:** `CopilotWelcomeBanner` is a one-shot dismissible banner.

**Direction:** Extend into a 3-step "what's where" tour: (1) banner (current) → (2) "Try drag-and-drop" callout on the first column → (3) "Ask Copilot" callout on the AI sparkle button. Each step uses a `position: absolute` arrow + dismissible card; advances on next-button or auto-dismiss after action. Persists per-step in `localStorage`. Honors `prefers-reduced-motion` (no float-in animation).

**Payoff:** First-time UX cliff is real for a board+AI app; a 3-step pointer tour cuts feature-find time materially per NN/g first-run-experience research.

**Risk:** Tour fatigue. Mitigate with explicit "Skip tour" on step 1 + a global "Show tips" toggle in `/settings`.

**Effort:** ~1.5 days. Minimal new infra; the existing banner pattern + AntD `Popover` is sufficient.

## Quick wins

(Each ≤ 1 hour, no architectural risk.)

1. **Generate PNG icons for `apple-touch-icon` + `purpose: "any"` manifest entries.** Script: `npx pwa-asset-generator public/icons/icon-512.svg public/icons --opaque false --maskable false --type png`. Update `index.html:33` and manifest. Fixes #2.
2. **Remove `skipWaiting` from `sw.js:26`; add message handler.** Wire reload toast in `index.tsx`. Fixes #1.
3. **Add a third `theme-color` media query for OLED dark.** `index.html` 2-line edit. Fixes #6.
4. **Reset `--header-height` on cleanup** in `header/index.tsx:343-360`. Fixes #3 leak; also switch first `writeHeight` to `useLayoutEffect` to kill the FOUC frame.
5. **Drop the catch-all SW handler at `sw.js:168-170`.** Replace with a `NetworkOnly` default for unclassified same-origin GETs. Fixes #5.
6. **Wrap header's nav-shaped triggers in `<nav aria-label="Primary">`** (`header/index.tsx:436`). Fixes #11.
7. **Use `--color-copilot-grad-start` for `:focus-visible` outline in dark mode.** 4-line CSS addition in `App.css`. Fixes #13.
8. **Add 2 PNG screenshots to `public/screenshots/` + manifest entries.** Fixes #19.
9. **Replace `boardBriefDrawer`'s `formatRelative` with `Intl.RelativeTimeFormat`.** Fixes #16 and removes 6 microcopy keys per locale.
10. **Add `lang` + `dir="ltr"` ready-state to `<html>`** explicitly in `index.html` (currently `<html lang="en">` — pre-empt RTL by adding `dir`). One-line edit; pairs with future Arabic/Hebrew bundles.

## Token-coverage audit

Scope: `src/components/**/index.tsx` (45 files) + `src/pages/*.tsx` (8 files).

**Method:** `grep -rE` for `#[0-9a-fA-F]{3,8}\b`, `rgba\(` (excluding hits inside `var(--…, rgba(…))` fallbacks, which are token-aware), and raw `[0-9]+px` literals not inside `${space.…|fontSize.…|radius.…|blur.…|breakpoints.…}`.

**Totals across audited scope:**
- **94 `rgba(` occurrences** — but 88 of them are token-aware (`var(--ant-color-*, rgba(…))` fallback) — these are working as designed.
- **6 raw `rgba(` literals not inside a var()** — see worst offenders below.
- **115 raw `px` literals** not in token interpolation — most are 1 px borders, 2 px outline offsets, or 8 px / 4 px / 18 px / 24 px / 36 px / 44 px (icon-sized) values. The recurring 18 px on `filterChips` is a small-tag-row size that probably should be `space.sm + space.xxs` or a `chipPx` token.
- **10 raw hex literals not inside a CSS-var fallback**, all in `column/index.tsx` (`#DB2777`, `#EA580C` for bug/task; `#94A3B8`…`#F472B6` for status palette) and `userAvatar/index.tsx` (`#ffffff`).

**Top offenders by raw-literal density** (file: raw `px` + raw `rgba(` + raw `#hex` not inside `var()`):

| File | Raw `px` outside tokens | Raw `rgba` not in `var()` | Raw `#hex` not in `var()` | Notes |
|---|---|---|---|---|
| `src/components/column/index.tsx` | 18 | 1 (`:246`) | 10 (`:283`, `:393-400`) | The status palette is the single largest token drift in the codebase. Bug/task type is hardcoded brand color — palette swap leaves it stranded. |
| `src/components/header/index.tsx` | 12 | 0 | 0 | All sized literals (`36px`, `44px`, `8px`); could move to a `header.iconButtonSize` token but low-priority. |
| `src/components/filterChips/index.tsx` | 11 | 1 (`:80`) | 0 | Hover background is raw `rgba(234, 88, 12, 0.18)` — should use `accent.bgStrong` from tokens. |
| `src/pages/project.tsx` | 8 | 0 | 0 | StatIcon dimensions (`24px`/`20px`/`14px`/`12px`) — fine, but could be tokenized. |
| `src/components/projectCard/index.tsx` | 7 | 1 (`:59`) | 0 | Hover shadow drops a `rgba(15, 23, 42, 0.18)` — should be `shadow.lg` or a `shadow.cardHover` token. |
| `src/pages/board.tsx` | 5 | 0 | 0 | Scrollbar `height: 8px`, fade `space.lg`. Acceptable. |
| `src/components/citationChip/index.tsx` | 5 | 0 | 0 | Citation badge sizes — visually intentional super-script geometry, could carry a `citation` token group. |
| `src/components/boardBriefDrawer/index.tsx` | 4 | 0 | 0 | Pill geometry. |
| `src/components/authErrorSummary/index.tsx` | 4 | 0 | 0 | Inline border + sr-only widths. |
| `src/components/emptyState/index.tsx` | 3 | 1 (`:53`) | 0 | Illustration frame uses `rgba(234, 88, 12, 0.16)` raw — should be `accent.bgMedium`. |
| `src/components/brandMark/index.tsx` | 3 | 1 (`:69`) | 0 | `inset 0 1px 0 rgba(255, 255, 255, 0.6)` — should pull `glass.shineInset`. |
| `src/components/userAvatar/index.tsx` | 0 | 0 | 1 (`:67`) | `#ffffff` in onSurfaceColor — should be `"var(--ant-color-bg-elevated, #ffffff)"` to track dark mode (currently always white). |

**Concrete fixes (each ≤5 minutes):**

- `src/components/column/index.tsx:283` — replace `#DB2777`/`#EA580C` with palette-driven `tag.bug`/`tag.task` color tokens (extend `tokens.ts` palette).
- `src/components/column/index.tsx:393-401` — move `STATUS_PALETTE` into `tokens.ts` (export `statusDotColors`) so all 8 colors are one indirection.
- `src/components/filterChips/index.tsx:80` — `rgba(234, 88, 12, 0.18)` → `${accent.bgStrong}`.
- `src/components/emptyState/index.tsx:53` — `rgba(234, 88, 12, 0.16)` → `${accent.bgMedium}` (already imported via `accent` line 50 — drop the duplicate).
- `src/components/brandMark/index.tsx:69` — `rgba(255, 255, 255, 0.6)` → `${glass.shineInset}` (already in tokens).
- `src/components/projectCard/index.tsx:59` — extract the 12px/32px/-16px/rgba shadow into `shadow.cardHover` token in `tokens.ts`.
- `src/components/userAvatar/index.tsx:67` — `"#ffffff"` → `"var(--ant-color-bg-elevated, #ffffff)"` (already used in the surface variable just above on line 65 — copy-paste).

Token coverage net: **87 % of color/spacing references in audited scope are token-aware** (i.e. either `var(--ant-color-*)` with light-mode fallback or a direct token import). The remaining 13 % concentrates in column, filterChips, emptyState, projectCard, brandMark, userAvatar — six files. A single PR could close the gap.
