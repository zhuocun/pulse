# Mobile Native-Feel: Best Practices and Red Flags

This document captures the research that informed the mobile responsive-design pass on this codebase (PRs #46 and #47). Treat it as a checklist for new work — every item below is either a pattern this app already uses, a red flag this app deliberately avoids, or a known gap with a tracked fix.

The mental model is simple. A web page feels "native" on mobile when three perceptions hold:

1. **It opens fast and never blanks out** — no white flash, no FOUT, no layout shift.
2. **It responds within ~100 ms to every touch** — taps, scrolls, drags, transitions.
3. **It respects the device** — safe areas, dark mode, dynamic type, reduced motion, system fonts, the keyboard, the home indicator.

It feels "web-y" the moment any of those break. Most red flags below trace back to one of the three.

---

## 1. Boilerplate (table stakes)

The single highest-leverage piece of work on a responsive page is its `<head>` and global stylesheet. The current `index.html` and `src/App.css` already set this up; if you're starting a sibling project, the snippet below is the minimum.

```html
<meta charset="utf-8" />
<meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
/>
<meta name="color-scheme" content="light dark" />
<meta
    name="theme-color"
    content="#ffffff"
    media="(prefers-color-scheme: light)"
/>
<meta
    name="theme-color"
    content="#0b0b0c"
    media="(prefers-color-scheme: dark)"
/>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta
    name="apple-mobile-web-app-status-bar-style"
    content="black-translucent"
/>
<meta name="apple-mobile-web-app-title" content="MyApp" />
<meta name="format-detection" content="telephone=no" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

```css
html {
    -webkit-text-size-adjust: 100%;
}
body {
    font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto,
        sans-serif;
    -webkit-font-smoothing: antialiased;
    min-height: 100dvh;
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
        env(safe-area-inset-bottom) env(safe-area-inset-left);
}
input,
select,
textarea {
    font-size: 16px;
} /* prevents iOS auto-zoom */
a,
button,
[role="button"] {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
}
```

In this repo:

- `index.html` carries every meta tag above.
- `public/manifest.webmanifest` describes the installable PWA shell. **Gap:** real PNG icons are not yet shipped — the manifest references paths that 404. Plan to generate via `pwa-asset-generator`.
- `src/App.css:79–127` owns the document-level reset, the `body` font stack, and `-webkit-text-size-adjust`.
- The 16 px input rule is scoped to `@media (pointer: coarse)` (`src/App.css:202–222`) so desktop keeps AntD's denser 14 px look while iOS does not auto-zoom on focus. This was the single highest-impact change in the audit.

---

## 2. Best practices by category

### A. PWA & installability

- Manifest must declare `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, `background_color`, plus 192 px and 512 px icons. Provide separate `purpose: "any"` and `purpose: "maskable"` entries — never `"any maskable"` on one icon (mis-pads on some platforms).
- Use `display_override: ["window-controls-overlay", "tabbed", "standalone"]` for graceful upgrades.
- Add `screenshots` with `form_factor: "narrow"` to upgrade Chromium's install dialog from a thin bar to a rich card.
- For custom install prompts, capture `beforeinstallprompt`, surface only after engagement, never on first paint, never blocking flows. iOS Safari has no `beforeinstallprompt` — show "Share → Add to Home Screen" instructions only on iOS Safari tabs.

In this repo: `public/manifest.webmanifest` covers the basics; install-prompt UI is intentionally not implemented.

### B. Layout & navigation

- **Bottom tab bar > hamburger** for 3-5 primary destinations. Real-world data (Redbooth) shows +65 % DAU and +70 % session length after switching.
- **Safe areas**: `viewport-fit=cover` + `env(safe-area-inset-*)` with `max()` so backgrounds bleed but text/buttons don't get clipped under notch / Dynamic Island / home indicator.
- **Viewport units (Baseline June 2025)**: `svh` for stable heroes, `dvh` for sticky overlays/sheets, `lvh` for intentional edge-to-edge. Never use bare `100vh` on mobile.
- **Native primitives**: `<dialog>` (focus trap + ESC) and the Popover API (Baseline Jan 2025). Animate with `@starting-style` + `transition-behavior: allow-discrete`.

In this repo:

- `src/components/header/index.tsx:30–60` and `src/components/pageContainer/index.tsx` apply `env(safe-area-inset-*)` with `max()`.
- `src/App.css:130–131` uses `min-height: 100vh; min-height: 100dvh;` (progressive enhancement).
- Three popovers/drawers cap height in `dvh` with `vh` fallback — see `src/components/commandPalette/index.tsx:36–42`, `src/components/memberPopover/index.tsx:18–25`, `src/components/projectPopover/index.tsx:18–25`.

### C. Touch, gestures, animation

- **Hit targets**: 44 × 44 pt (Apple HIG) / 48 dp (Material) / 24 × 24 minimum (WCAG 2.2 SC 2.5.8). Pad — don't scale — small icons. ≥ 8 px between targets.
- **Thumb zone**: primary actions in the bottom third; destructive actions never in the top corners on > 6" phones.
- **300 ms tap delay is solved** by the viewport meta tag alone since Safari 9.3. FastClick is obsolete; remove it. Belt-and-braces with `touch-action: manipulation`.
- **Gestures on Pointer Events** (not Touch Events): track `pointerId`, `setPointerCapture`, listen for `pointercancel`. Declare intent with `touch-action: pan-y` (horizontal swipe) or `none` (free 2D drag).
- **Animation rules**: animate only `transform` + `opacity`. 150-250 ms for micro-interactions, 250-400 ms for transitions. `will-change` only briefly (apply → animate → remove). `translate3d` GPU-hack is obsolete.
- **View Transitions API** (Baseline Newly Available Oct 2025; Firefox 144+; cross-document Chrome 126+/Safari 18.2+) — the default for SPA-feel page transitions. Benchmarks show 2-3× snappier on low-end devices vs JS animation libs.
- **Scroll-driven animations** (Baseline 2025) offload to compositor — battery-friendly, no JS jank.
- **Haptics**: `navigator.vibrate(10-50)` on key actions; iOS Web Vibration support is spotty so always pair with visual feedback. Keep buzzes 50-200 ms; never spam.

In this repo:

- `src/theme/antdTheme.ts:77–79` lifts AntD's `controlHeight` / `controlHeightLG` / `controlHeightSM` to 44 px on `pointer: coarse`, so even `size="small"` buttons hit Apple HIG on touch.
- `src/App.css:118–120` sets `-webkit-tap-highlight-color: transparent` and `text-size-adjust: 100%` at the body level.
- View Transitions are wired on every user-initiated navigation via React Router 7's `viewTransition` prop / `navigate(..., { viewTransition: true })`. The sticky header opts out via `view-transition-name: pulse-header` so it stays anchored across route changes — see `src/components/header/index.tsx:30–47` and `src/App.css:230–248`.
- The `motion` and `easing` token blocks at `src/theme/tokens.ts:147–158` standardize durations (60/120/200/320 ms) and curves so animations stay consistent.

### D. Forms (the highest-leverage area for mobile UX)

- **`inputmode`** picks the right virtual keyboard without `type="number"` quirks: `numeric`, `decimal`, `email`, `tel`, `url`, `search`.
- **Specific `autocomplete` tokens**: `given-name`, `cc-number`, `one-time-code` (enables SMS OTP autofill). Autofill cuts errors ~25 % and lifts mobile conversion ~20 %.
- **`enterkeyhint`**: `go`, `send`, `search`, `next`, `done` — relabels the return key.
- **Font-size ≥ 16 px** on inputs (iOS auto-zooms otherwise). Never `user-scalable=no` (WCAG violation).
- **Keyboard handling**: `interactive-widget=resizes-content` + `env(keyboard-inset-height)` for fixed footers above the keyboard. The VirtualKeyboard API (`navigator.virtualKeyboard.overlaysContent = true`) for chat composers.

In this repo: login/registration already had `inputMode` + `enterKeyHint`. The first audit added them to `taskCreator`, `columnCreator`, and `projectSearchPanel`. The mobile-optimization follow-up extended the same attributes to `projectModal`, `taskModal` (name / epic / note), `commandPalette`, `aiSearchInput`, and the `aiChatDrawer` composer (`enterKeyHint="send"` so the iOS return key reads "send"). Search inputs that don't already render their own clear affordance use `type="search"`; the palette and AI search keep AntD's `allowClear` prefix instead of stacking two clear buttons.

### E. Visual polish

- **Dark mode**: drive with CSS variables flipped via `prefers-color-scheme`. Inject a blocking script that reads the `Sec-CH-Prefers-Color-Scheme` client hint to prevent the flash on SSR.
- **System fonts**: `-apple-system, BlinkMacSystemFont, system-ui, …` mimics the platform shell.
- **Dynamic type / body size**: native iOS body copy reads ~16–17 px; a 14 px web base feels cramped on a phone. Lift the base type scale one step on `pointer: coarse` while keeping desktop dense, and never let body/label copy fall below the 14 px mobile floor.
- **Reduced motion**: default to no motion, gate animation inside `@media (prefers-reduced-motion: no-preference)`. The EU Accessibility Act (2026) effectively requires this.
- **Theme-color** with `media` queries swaps the URL bar / status bar color in dark mode.

In this repo:

- Dark mode is fully wired via `useColorScheme`, AntD `ConfigProvider`, and matching `theme-color` meta tags. Reduced motion has both a global guard (`src/App.css:230–242`) and a `useReducedMotion` hook for component opt-in.
- `buildAntdTheme` (`src/theme/antdTheme.ts`) lifts the AntD body type scale one step on `pointer: coarse` inside the same coarse branch that raises `controlHeight`: `fontSize` 14→16, `fontSizeSM` 13→14, `fontSizeLG` 16→18. Desktop keeps the dense 14 / 13 / 16 ladder; heading tokens (display/xxl/xl/lg) are unchanged because they already read large. The step reuses the existing `fontSize.*` tokens — no new literals.
- Body/label copy that hard-codes `fontSize.sm` (13 px) — the auth switch rows, terms agreement, password-strength hint, and auth hero fine print — reads through `bodyCopyCoarseFontCss` (`src/theme/tokens.ts`) so it lifts to `fontSize.base` (14 px) on coarse pointers and never renders sub-14 px next to the bumped 16 px base. Intentional micro-captions (badges, pills, chips, timestamps, meta rows) stay at their `fontSize.xs` / `fontSize.sm` literal on purpose.

### F. Offline & resilience

- **App shell** pre-cached on `install`; **NetworkFirst** for HTML, **CacheFirst** for hashed assets, **StaleWhileRevalidate** for icons/avatars.
- **Background Sync** queues mutations on Chromium; on iOS queue in IndexedDB and replay on foreground (no Background Sync support).
- **Optimistic UI**: React 19's `useOptimistic` is canonical. Always show rollbacks — silent reverts erode trust.

In this repo: optimistic updates exist via `useReactMutation` (`src/utils/hooks/useReactMutation.ts:40–47`) for create/update/delete flows including drag-and-drop. **Gap:** no service worker yet; that is the next big "feels native" win for return visits.

### G. Engagement APIs

- **Web Push on iOS 16.4+** works only for _installed_ PWAs and only from a transient user activation.
- **Web Share**: `navigator.share({ files })` opens the OS share sheet — feature-detect with `navigator.canShare`.
- **Badging**: `navigator.setAppBadge(n)` (iOS 16.4+, Chromium desktop).
- **App shortcuts** in manifest for long-press launcher actions (Android/desktop only).

In this repo: not implemented.

### H. Accessibility

- 65 % of sites misuse ARIA (WebAIM 2025). Prefer semantic HTML (`<button>`, `<nav>`, `<main>`) — they get correct roles for free.
- VoiceOver is strict; a broken accessibility tree is audible to users.
- Logical reading order matters more on mobile because swipe-navigation is the primary interaction for screen-reader users.

In this repo: icon-only buttons consistently carry `aria-label`; decorative icons are `aria-hidden`. The focus ring is thicker on `pointer: coarse` (`src/App.css:185–190`).

---

## 3. Red flags checklist

### Performance thresholds (75th-percentile mobile)

| Metric                           | Good     | Poor     |
| -------------------------------- | -------- | -------- |
| **LCP**                          | ≤ 2.5 s  | > 4.0 s  |
| **INP** (replaced FID, Mar 2024) | ≤ 200 ms | > 500 ms |
| **CLS**                          | ≤ 0.1    | > 0.25   |

Sub-100 ms INP feels truly native; 200-500 ms feels web-y. The 2025 Web Almanac found only 67 % of mobile pages hit good INP and 62 % hit good LCP — mobile is where the gap lives.

### Layout shift red flags

- Images / iframes / videos without explicit dimensions or `aspect-ratio` (62 % of mobile pages have at least one).
- Web fonts without `font-display: optional` or matched `size-adjust` / `ascent-override` fallback metrics.
- Late-injected ads, cookie banners, "install our app" interstitials without reserved slot height.
- Animating `top`/`width`/`height` instead of `transform`/`opacity`.

### Loading red flags

- Render-blocking `<head>` JS without `defer`/`async`.
- JS bundles > 300 KB (200 KB is the modern stricter target).
- Hero image with `loading="lazy"` (16 % of sites do this — it tanks LCP). Use `fetchpriority="high"`.
- Blank white screen instead of a skeleton (skeletons feel 9-12 % faster than spinners per NN/g).
- No service worker offline fallback.

### Interaction red flags

- Long tasks > 50 ms blocking the main thread — break work with `scheduler.yield()`, workers, `requestIdleCallback`.
- Non-passive `touchstart`/`wheel` listeners — declare `{ passive: true }`.
- Hover-only affordances (tooltips, dropdowns on `:hover`) — gate with `@media (hover: hover)`.
- Broken back button in SPAs (Baymard 2024: 59 % of sites violate back-button expectations). Use the History/Navigation API; close overlays on back. **In this repo:** `useTaskModal`, `useProjectModal`, `useAiDraftModal`, `useBoardBriefDrawer` all keep open/close state in URL search params for exactly this reason.
- Full page reloads between routes — use the View Transitions API.

### Visual / layout red flags

- Missing viewport meta → desktop-rendered shrunken page.
- `100vh` jump as the URL bar collapses — use `dvh`/`svh`/`lvh`.
- Content vanishing under the notch / Dynamic Island / home indicator (you set `viewport-fit=cover` but didn't apply `env()` insets).
- Browser chrome visible in installed PWA — declare `display: standalone` in manifest.
- Tiny default text, horizontal scroll, unstyled browser defaults.

### Form / input red flags

- Input `font-size < 16 px` on iOS → forced zoom on focus. **In this repo** the `@media (pointer: coarse)` rule in `src/App.css` lifts inputs to 16 px on touch devices specifically to prevent this.
- `type="number"` for things that aren't actually numbers (price, ZIP) — use `inputmode="decimal"` or `inputmode="numeric"`.
- Missing or wrong `autocomplete` tokens.
- No clear/cancel button — use `type="search"`.
- `autofocus` on page load — triggers viewport jumps on iOS.

### General "web-y" smells

- `alert()`, `confirm()`, `prompt()` — jarring system dialogs. **In this repo:** AntD `Modal.confirm` is used everywhere instead.
- Default tap-highlight gray flash without a custom `:active` state.
- No haptic / micro-feedback on tap.
- Jarring route transitions (no view transition).
- Reliance on user-tapped browser refresh to update data.
- Bottom nav placed without `safe-area-inset-bottom` padding.
- Install prompts / cookie banners covering primary CTA on first paint.
- Custom pull-to-refresh implemented poorly — usually better to either keep the platform default or fully disable with `overscroll-behavior: contain`.
- Standalone-mode link breakout: tapping any `<a>` with `target="_blank"` or different origin in iOS standalone PWA jumps the user back to Safari (intercept clicks; check `window.navigator.standalone`).

---

## 4. What ships in this repo today

Applied in the audit (PR #46), the View Transitions follow-up (PR #47), and the mobile-optimization review (this PR):

- iOS auto-zoom prevented (`@media (pointer: coarse)` 16 px input rule).
- Full PWA boilerplate in `index.html`; minimal `public/manifest.webmanifest`.
- All popover / drawer height caps use `dvh` with `vh` fallback.
- AntD `controlHeightSM` is 44 px on coarse pointers (Apple HIG).
- AntD body type scale lifts one step on coarse pointers — `fontSize` 14→16, `fontSizeSM` 13→14, `fontSizeLG` 16→18 (`src/theme/antdTheme.ts`) — so mobile body copy reads ~16 px like native, while desktop keeps the dense ladder and headings stay put. Body/label copy that hard-coded `fontSize.sm` (auth switch rows, terms agreement, password-strength hint, hero fine print) now routes through `bodyCopyCoarseFontCss` so it clears the 14 px floor on touch.
- `inputMode` + `enterKeyHint` on every text input — auth, creators, search panels, modals (`projectModal`, `taskModal`), `commandPalette`, `aiSearchInput`, and the AI chat composer (`enterKeyHint="send"`).
- `autoFocus` removed from modal text inputs so opening the dialog never triggers a viewport jump on iOS.
- `FilteredEmptyButton` (the "Reset filters" CTA in an empty filtered column) lifts to `min-height: 44 px` on coarse pointers.
- The Undo toast renders a real `<button>` instead of `<a role="button">` so Enter / Space activation comes for free and the focus ring is consistent with the rest of the app.
- Task-type badge `<img>` carries explicit `width` / `height` attributes so the card row doesn't shift while the SVG asset loads (CLS).
- `import isEqual from "lodash/isEqual"` instead of full lodash in `taskModal`.
- `reportWebVitals(console.log)` in dev so INP/LCP/CLS show in the console.
- Two new URL-driven hooks (`useAiDraftModal`, `useBoardBriefDrawer`) so the system back button dismisses overlays.
- View Transitions on every user-initiated navigation — including logout, the not-found CTAs in `routes/index.tsx` and `projectDetail.tsx` — with the sticky header anchored via `view-transition-name`.
- Route-level code splitting (`lazy()` per page) is in place at `src/routes/index.tsx:22–27`.

Already in place before the audit:

- Dark mode + `prefers-reduced-motion` + `prefers-contrast` + `forced-colors` support.
- `safe-area-inset-*` on header / page container / auth layout / board page.
- Optimistic mutations via `useReactMutation`.
- Skeleton loaders for routes / lists; spinners only for short waits.
- `Modal.confirm` in place of `window.confirm`.
- System font stack with Inter web font on top.
- Animations on `transform` / `opacity` only.

---

## 5. Known gaps (ranked by UX impact)

Tier 1 — every user, every session:

1. ~~**Service worker for repeat-visit caching.**~~ **Done.** `public/sw.js` implements NetworkFirst for HTML, CacheFirst for hashed assets, StaleWhileRevalidate for images and fonts. Registered in `src/index.tsx`.

Tier 2 — visible only at specific moments, but very visible when they happen:

2. ~~**Real PNG icons for the manifest.**~~ **Done.** SVG icons generated to `public/icons/` via `scripts/generate-icons.js`. Manifest updated to reference SVGs. For production, run `pwa-asset-generator` to produce PNG variants and iOS splash images.

Tier 3 — barely perceptible:

3. ~~**`100vw` in modal width formula**~~ **Done.** `modalWidthCss` in `src/theme/tokens.ts` already uses `100dvw`. Column components (`column/index.tsx`, `columnCreator/index.tsx`) updated from `100vw` to `100dvw`.

---

## 6. Real-world impact

Why this work matters in business terms:

- **Tinder PWA**: load time cut 61 % (11.91 s → 4.69 s); bundle 90 % smaller than native Android.
- **Pinterest PWA**: time-on-site +40 %, core engagement +44 %, weekly active users +103 %, signups +843 %.
- **Twitter Lite**: < 3 % the storage of native, 80 % more tweets sent, bounce rate -20 %.
- **Form haptics case study**: completion rates +27 %, time on page +18 %.
- **ARIA on interactive elements**: UX score +35 % for assistive-tech users (WebAIM 2025).

---

## 7. Sources

The full annotated source list lives in PR #46. A condensed cut by topic:

**Boilerplate, viewport, safe areas, iOS Safari quirks**

- [Designing Websites for iPhone X — WebKit](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- [The new viewport units — Ahmad Shadeed](https://ishadeed.com/article/new-viewport-units/)
- [The large, small, and dynamic viewport units — web.dev](https://web.dev/blog/viewport-units)
- [The Notch and CSS — CSS-Tricks](https://css-tricks.com/the-notch-and-css/)
- [16 px or Larger Text Prevents iOS Form Zoom — CSS-Tricks](https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/)
- [300 ms tap delay, gone away — Chrome](https://developer.chrome.com/blog/300ms-tap-delay-gone-away)
- [Chrome edge-to-edge migration guide](https://developer.chrome.com/docs/css-ui/edge-to-edge)

**PWA, manifest, install, offline, engagement**

- [Web App Manifest — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)
- [Making PWAs installable — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Customize install experience — web.dev](https://web.dev/articles/customize-install)
- [Web Push for Web Apps on iOS — WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Workbox caching strategies — Chrome](https://developer.chrome.com/docs/workbox/caching-strategies-overview)

**Touch, gestures, animation, View Transitions**

- [Apple Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Material Design Touch Targets](https://m2.material.io/develop/web/supporting/touch-target)
- [WCAG 2.5.8 Target Size (Minimum) — W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- [touch-action — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- [overscroll-behavior — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior)
- [View Transition API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
- [What's new in view transitions (2025) — Chrome](https://developer.chrome.com/blog/view-transitions-in-2025)
- [Spring physics intro — Josh W. Comeau](https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/)

**Forms & keyboard**

- [inputmode — MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode)
- [Touch Keyboard Types Cheat Sheet — Baymard](https://baymard.com/labs/touch-keyboard-types)
- [VirtualKeyboard API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [interactive-widget viewport — htmhell.dev](https://www.htmhell.dev/adventcalendar/2024/4/)

**Performance, Core Web Vitals, red flags**

- [Interaction to Next Paint (INP) — web.dev](https://web.dev/articles/inp)
- [Optimize INP — web.dev](https://web.dev/articles/optimize-inp)
- [Largest Contentful Paint — web.dev](https://web.dev/articles/lcp)
- [Optimize CLS — web.dev](https://web.dev/articles/optimize-cls)
- [Performance — 2025 Web Almanac](https://almanac.httparchive.org/en/2025/performance)
- [Skeleton Screens 101 — Nielsen Norman Group](https://www.nngroup.com/articles/skeleton-screens/)
- [Designing A Better Back Button UX — Smashing Magazine](https://www.smashingmagazine.com/2022/08/back-button-ux-design/)

**Accessibility**

- [Mobile accessibility — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/Mobile)
- [Mobile Web Accessibility With VoiceOver And TalkBack — Knowbility](https://knowbility.org/programs/accessu-2020/mobile-web-accessibility-with-voiceover-and-talkback)

**Case studies**

- [A Tinder PWA Performance Case Study — Addy Osmani](https://medium.com/@addyosmani/a-tinder-progressive-web-app-performance-case-study-78919d98ece0)
- [22 companies that developed PWA — RST Software](https://www.rst.software/blog/22-companies-that-developed-pwa-and-how-you-can-benefit-from-it)
