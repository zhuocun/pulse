import type { Palette } from "./types";

/**
 * Compose a `backdrop-filter` value string from an intensity preset's
 * `{ blur, saturation }` fields. `blur === 0` shorts to `none` so the
 * Solid preset emits the property-cancelling value rather than
 * `blur(0px) saturate(180%)` — both are pixel-equivalent at the GPU,
 * but the literal `none` lets every consumer (including
 * `-webkit-backdrop-filter` polyfills) opt the property out entirely.
 *
 * The intensity values that feed this helper are mirrored from
 * `glass.intensityClear/Regular/Solid` in `../tokens.ts`. The two
 * declarations must stay in sync; the cssVars test suite pins parity
 * (see "derives the override values from glass.intensity tokens"
 * — also asserts the structural match against the token literal).
 * We deliberately do NOT `import { glass } from "../tokens"` here
 * because the import chain `tokens → palettes/index → cssVars` would
 * loop back through the palette re-export and partially-initialise
 * the `palette` const at module-load time (silent breakage in every
 * downstream consumer). The mirrored constants below keep this file
 * cycle-free.
 */
const composeBackdropFilter = (preset: {
    blur: number;
    saturation: number;
}): string =>
    preset.blur === 0
        ? "none"
        : `blur(${preset.blur}px) saturate(${preset.saturation}%)`;

/*
 * Mirrors of `glass.intensityClear/Regular/Solid` `{blur, saturation}`
 * fields from `../tokens.ts`. Kept here as a tiny in-file constants
 * table so the file stays cycle-free; the cssVars test suite
 * enforces parity with the token source (see the "intensity
 * constants stay in sync with glass.intensity tokens" assertion in
 * cssVars.test.ts).
 *
 * Phase 5 Wave 2 integration: extended with per-surface-tier ladders.
 * The chrome ships three blur tiers — subtle (column header sticky
 * over scrolling tasks; ~12px), regular (header / tab bar / TopBar;
 * 20px), strong (auth FormCard showpiece; 28px). The user-facing
 * intensity toggle scales all three tiers in concert: Clear softens
 * every tier, Solid wipes every tier to none. Without per-tier vars
 * the chrome that used to ship 12px or 28px would have been forced
 * to the uniform 20px at default intensity (pixel-parity regression).
 */
const INTENSITY_CLEAR = { blur: 14, saturation: 170 } as const;
const INTENSITY_REGULAR = { blur: 20, saturation: 180 } as const;
const INTENSITY_SOLID = { blur: 0, saturation: 180 } as const;

const INTENSITY_SUBTLE_CLEAR = { blur: 8, saturation: 170 } as const;
const INTENSITY_SUBTLE_REGULAR = { blur: 12, saturation: 180 } as const;

const INTENSITY_STRONG_CLEAR = { blur: 20, saturation: 180 } as const;
const INTENSITY_STRONG_REGULAR = { blur: 28, saturation: 180 } as const;

/**
 * Render the runtime CSS custom properties for a palette. The output is a
 * complete CSS string with `:root` / `html[data-color-scheme="light"]` and
 * `html[data-color-scheme="dark"]` blocks. Mounted synchronously in
 * `index.tsx` BEFORE React renders so styled-components see the vars from
 * the very first paint — no flash of the previous palette.
 *
 * Vars defined here are consumed across the codebase:
 *   - `--pulse-bg-page` / `--pulse-text-base` — body background + text
 *   - `--color-copilot-*` — AI gradient stops, badge, pulse animation
 *   - `--glass-*` — frosted-glass surface, border, shine inset
 *   - `--aurora-blob` / `--aurora-blob-strong` — subtle body wash + AI
 *     panel wash; named so a single tint flip propagates everywhere
 *
 * Phase 5 "Liquid Glass" additions (Wave 1 T1) — every new var ships in
 * BOTH the light and dark blocks with mode-appropriate values:
 *   - `--glass-specular-top` / `--glass-specular-bottom` — rim highlight
 *     gradients (achromatic; cooler / lower amplitude in dark mode)
 *   - `--glass-refraction-tint` — accent body wash (derived from
 *     `accent.rgb` / `accent.rgbDark` so a palette swap re-tints)
 *   - `--glass-shadow-on-text` / `--glass-shadow-on-solid` — content-
 *     aware drop shadows
 *   - `--glass-rim-subtle` / `--glass-rim` / `--glass-rim-strong` —
 *     three-step rim hairline border colours
 *   - `--motion-morph` / `--motion-gel-flex` — additional durations
 *     for surface morph and press recovery
 *   - `--easing-spring-soft` / `--easing-spring-snap` — overshoot
 *     curves for materialize and gel-flex
 *   - `--ant-backdrop-filter-glass` — the global intensity lever.
 *     Default `blur(20px) saturate(180%)` (regular preset). Wave 2 T4
 *     adds `html[data-glass-intensity="clear" | "solid"]` overrides
 *     that swap the value globally — the user's chosen intensity
 *     re-tunes every chrome surface that consumes
 *     `var(--ant-backdrop-filter-glass)`. The `--ant-` prefix is
 *     intentional: it lives in the AntD CSS-var namespace so AntD-
 *     overriding selectors in App.css can pick it up uniformly.
 *
 * Phase 5 Wave 2 T4 additions — the user-facing glass-intensity toggle:
 *   - `html[data-glass-intensity="clear"]` block — overrides
 *     `--ant-backdrop-filter-glass` to the Clear preset's recipe.
 *   - `html[data-glass-intensity="solid"]` block — overrides the var
 *     to `none` (the Solid preset wipes blur entirely).
 *   - `@media (prefers-reduced-transparency: reduce)` block — pins
 *     the var to `none` regardless of the user's stored preference
 *     because the OS-level signal must always win (belt-and-
 *     suspenders pairing with the App.css opt-out rule).
 *
 * Note: `data-glass-intensity="regular"` inherits the `:root` default,
 * so no override block is needed for it — keeps the rendered CSS lean.
 *
 * Phase 6 Wave 1 additions — foundation tokens for the iOS-26 mobile
 * adoption. These are geometry / timing values (not light/dark-dependent),
 * but ship in BOTH palette blocks for symmetry with the rest of the
 * surface — keeps the contract "every var defined for one mode is defined
 * for both" simple to enforce in tests.
 *   - `--ant-chrome-inset-mobile` — outset for floating mobile chrome
 *     (BottomTabBar, Sheet). 16 px = iOS 26 ~21pt mapped to web density.
 *   - `--ant-detent-peek` / `--ant-detent-medium` / `--ant-detent-large`
 *     — Wave 3 Sheet primitive's snap-detent ladder (px peek above safe
 *     area, dvh for medium and large so iOS URL-bar collapse doesn't
 *     mid-gesture snap).
 *   - `--ant-motion-detent-snap` / `--ant-motion-tab-bar-minimize` —
 *     durations for Wave 3 sheet snapping and Wave 2 tab-bar minimize.
 *   - `--ant-easing-detent` — the iOS sheet curve (slow in/out, no
 *     overshoot). Pairs with `--ant-motion-detent-snap` for Wave 3.
 *
 * Runtime palette switch addition — the brand / accent / aurora /
 * avatar-gradient vars. These let the styled-component / inline-style
 * surfaces that read the matching `var(--pulse-…, <orange fallback>)`
 * tokens in `tokens.ts` re-color live when the user picks a different
 * colour theme (the resolver hook `usePaletteTheme` re-renders this CSS
 * into the `#pulse-theme-vars` style element). Unlike the copilot / glass
 * vars these are mode-AGNOSTIC brand hexes — emitted identically in both
 * the light and dark blocks so the "every var defined for one mode is
 * defined for both" contract holds without forcing a per-mode value:
 *   - `--pulse-brand-*` — primary / hover / active / bg / bgDark / dark
 *   - `--pulse-accent-start` / `--pulse-accent-end` — gradient stops
 *   - `--pulse-accent-bg-*` / `--pulse-accent-border` — the exact rgba
 *     opacities consumed by static styled-components (0.32 / 0.22 / 0.16
 *     / 0.04); kept pre-composed so a styled-component can drop the var
 *     straight into `background` / `border` without recomputing rgba.
 *   - `--pulse-aurora-*` — deep / mid / light / cinematicBase
 *   - `--pulse-avatar-grad-0..5` — the six monogram gradient strings
 *
 * Phase 6 Wave 2 lift addition — `--ant-shadow-glass-lifted`.
 *   - In LIGHT mode the page is `#fffaf5`; a near-white translucent
 *     glass surface (`--glass-surface` rgba(255, 255, 255, 0.68)) with
 *     only the `shadow.lg` token (six-percent inks) was visually
 *     indistinguishable from the page chrome — the floating capsule
 *     read as invisible. We need a stronger, higher-contrast shadow
 *     in light to outline the capsule edge against the warm-cream
 *     background.
 *   - In DARK mode the rgba(10, 12, 8, 0.55) glass surface already
 *     pops against the dark page, so a stronger shadow would over-
 *     blacken the surround. We keep the value close to the existing
 *     `shadow.lg` recipe.
 *   - Consumers: BottomTabBar (Phase 6 Wave 2 floating capsule). Any
 *     future floating glass surface that needs to feel detached from
 *     the page should adopt this var so a single token tweak retunes
 *     every lifted glass chrome together.
 */
export const paletteToCss = (p: Palette): string => `
:root,
html[data-color-scheme="light"] {
    --pulse-bg-page: ${p.page.bgLight};
    --pulse-text-base: ${p.page.textLight};

    /*
     * AA-safe amber for the high-priority badge glyph + label. The
     * brand warning seed (#F59E0B) reads at ~2.2:1 on the white card
     * surface — below WCAG 1.4.3 for the ~12px footer label — so light
     * mode steps down to amber-700 (#B45309, ~5:1 on white) while dark
     * keeps the brighter seed (AA against the near-black card). Mode-
     * agnostic across palettes, like the mobile foundation tokens.
     */
    --pulse-priority-high: #b45309;

    --pulse-brand-primary: ${p.brand.primary};
    --pulse-brand-primary-hover: ${p.brand.primaryHover};
    --pulse-brand-primary-active: ${p.brand.primaryActive};
    --pulse-brand-primary-bg: ${p.brand.primaryBg};
    --pulse-brand-primary-bg-dark: ${p.brand.primaryBgDark};
    --pulse-brand-primary-dark: ${p.brand.primaryDark};

    /*
     * Link colour pair. antdTheme.ts sets colorLink / colorLinkHover
     * from the same palette steps for every mode, which is AA on the
     * light page but fails on the dark page — the dark block below
     * overrides both. The light values here mirror antdTheme's output
     * exactly (no visual change) so the "every var defined for one
     * mode is defined for both" contract holds.
     */
    --ant-color-link: ${p.brand.primaryHover};
    --ant-color-link-hover: ${p.brand.primaryActive};

    --pulse-accent-start: ${p.accent.start};
    --pulse-accent-end: ${p.accent.end};
    --pulse-accent-bg-strong: rgba(${p.accent.rgb}, 0.32);
    --pulse-accent-border: rgba(${p.accent.rgb}, 0.22);
    --pulse-accent-bg-medium: rgba(${p.accent.rgb}, 0.16);
    --pulse-accent-bg-subtle: rgba(${p.accent.rgb}, 0.04);
    --pulse-accent-bg-hover: rgba(${p.accent.rgb}, 0.18);

    /*
     * App-owned equivalents of AntD's --ant-color-* semantic surface
     * tokens (text ramp, neutral fills, borders, solid surfaces, text-
     * button overlays). The text/fill/border/bg tokens in tokens.ts
     * reference these. Light values are the slate-900 ink the page
     * already uses; the dark block flips fills/overlays to a light ink so
     * they stay visible on the dark page. Opacities mirror AntD's
     * light/dark algorithm output so a page repointed off --ant-color-*
     * lands pixel-for-pixel. Palette-independent (the neutral ink is the
     * same across every brand palette).
     */
    --pulse-text-secondary: rgba(15, 23, 42, 0.65);
    --pulse-text-tertiary: rgba(15, 23, 42, 0.45);
    --pulse-fill: rgba(15, 23, 42, 0.15);
    --pulse-fill-secondary: rgba(15, 23, 42, 0.06);
    --pulse-fill-tertiary: rgba(15, 23, 42, 0.04);
    --pulse-fill-quaternary: rgba(15, 23, 42, 0.02);
    --pulse-border: rgba(15, 23, 42, 0.12);
    --pulse-border-secondary: rgba(15, 23, 42, 0.06);
    --pulse-bg-container: #ffffff;
    --pulse-bg-elevated: #ffffff;
    --pulse-bg-text-hover: rgba(15, 23, 42, 0.06);
    --pulse-bg-text-active: rgba(15, 23, 42, 0.15);

    /*
     * Link + status colours, app-owned equivalents of --ant-color-link /
     * --ant-color-error / --ant-color-warning. Link tracks the palette
     * (primaryHover is AA on the light page); the dark block flips it to
     * primaryDark. Status seeds match AntD's light algorithm; the dark
     * block steps them to AntD's dark output.
     */
    --pulse-link: ${p.brand.primaryHover};
    --pulse-error: #EF4444;
    --pulse-warning: #F59E0B;

    --pulse-aurora-deep: ${p.aurora.deep};
    --pulse-aurora-mid: ${p.aurora.mid};
    --pulse-aurora-light: ${p.aurora.light};
    --pulse-aurora-cinematic-base: ${p.aurora.cinematicBase};

    --pulse-avatar-grad-0: ${p.avatarGradients[0]};
    --pulse-avatar-grad-1: ${p.avatarGradients[1]};
    --pulse-avatar-grad-2: ${p.avatarGradients[2]};
    --pulse-avatar-grad-3: ${p.avatarGradients[3]};
    --pulse-avatar-grad-4: ${p.avatarGradients[4]};
    --pulse-avatar-grad-5: ${p.avatarGradients[5]};

    --color-copilot-grad-start: ${p.aurora.deep};
    --color-copilot-grad-mid: ${p.aurora.mid};
    --color-copilot-grad-end: ${p.aurora.light};
    --color-copilot-bg-subtle: rgba(${p.accent.rgb}, 0.04);
    --color-copilot-bg-medium: rgba(${p.accent.rgb}, 0.14);
    --color-copilot-badge: ${p.brand.primary};
    --color-copilot-badge-bg: rgba(${p.accent.rgb}, 0.12);
    --color-copilot-pulse: rgba(${p.accent.rgb}, 0.45);

    --glass-surface: rgba(255, 255, 255, 0.68);
    --glass-surface-strong: rgba(255, 255, 255, 0.96);
    --glass-surface-subtle: rgba(255, 255, 255, 0.50);
    --glass-border: rgba(15, 23, 42, 0.06);
    --glass-border-strong: rgba(${p.accent.rgb}, 0.22);
    --glass-shine: inset 0 1px 0 rgba(255, 255, 255, 0.55);

    --glass-specular-top: linear-gradient(135deg, rgba(255, 255, 255, 0.30), transparent 40%);
    --glass-specular-bottom: linear-gradient(315deg, rgba(0, 0, 0, 0.12), transparent 40%);
    --glass-refraction-tint: rgba(${p.accent.rgb}, 0.05);
    --glass-shadow-on-text: 0 8px 24px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.12);
    --glass-shadow-on-solid: 0 4px 16px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06);
    /*
     * Light-mode lift for floating glass chrome (BottomTabBar capsule).
     * Higher-opacity inks than the achromatic shadow.lg token because
     * the cream page (#fffaf5) drowns out the lighter 6% ink the rest
     * of the card chrome ships. See the cssVars docblock above.
     */
    --ant-shadow-glass-lifted:
        0 8px 24px -4px rgba(15, 23, 42, 0.18),
        0 2px 6px rgba(15, 23, 42, 0.08);
    --glass-rim-subtle: rgba(255, 255, 255, 0.18);
    --glass-rim: rgba(255, 255, 255, 0.32);
    --glass-rim-strong: rgba(255, 255, 255, 0.48);

    --motion-morph: 450ms;
    --motion-gel-flex: 220ms;
    --ant-motion-detent-snap: 360ms;
    --ant-motion-tab-bar-minimize: 280ms;

    --easing-spring-soft: cubic-bezier(0.34, 1.56, 0.64, 1);
    --easing-spring-snap: cubic-bezier(0.16, 1.05, 0.36, 1);
    --ant-easing-detent: cubic-bezier(0.32, 0.72, 0, 1);

    --ant-backdrop-filter-glass: ${composeBackdropFilter(INTENSITY_REGULAR)};
    --ant-backdrop-filter-glass-subtle: ${composeBackdropFilter(INTENSITY_SUBTLE_REGULAR)};
    --ant-backdrop-filter-glass-strong: ${composeBackdropFilter(INTENSITY_STRONG_REGULAR)};

    --ant-chrome-inset-mobile: 16px;
    --ant-detent-peek: 96px;
    --ant-detent-medium: 50dvh;
    --ant-detent-large: 92dvh;

    --aurora-blob: rgba(${p.accent.rgb}, 0.10);
    --aurora-blob-strong: rgba(${p.accent.rgb}, 0.20);
    --aurora-blob-faint: rgba(${p.accent.rgb}, 0.06);
}

html[data-color-scheme="dark"] {
    --pulse-bg-page: ${p.page.bgDark};
    --pulse-text-base: ${p.page.textDark};

    /*
     * High-priority amber, dark counterpart. The near-black card
     * surface lets the brighter brand seed (#F59E0B, ~7:1 on dark)
     * carry the same escalation cue without dimming to the light-mode
     * amber-700 step (which would muddy against the dark card).
     */
    --pulse-priority-high: #f59e0b;

    /*
     * Brand / accent / aurora / avatar-gradient vars are mode-agnostic
     * brand hexes — emitted identically to the light block so the
     * "every var defined for one mode is defined for both" contract
     * holds. The light/dark divergence for AI + glass surfaces lives in
     * the --color-copilot-* / --glass-* vars below, which DO swap per
     * mode (e.g. accent.rgbDark for dark-mode tints).
     */
    --pulse-brand-primary: ${p.brand.primary};
    --pulse-brand-primary-hover: ${p.brand.primaryHover};
    --pulse-brand-primary-active: ${p.brand.primaryActive};
    --pulse-brand-primary-bg: ${p.brand.primaryBg};
    --pulse-brand-primary-bg-dark: ${p.brand.primaryBgDark};
    --pulse-brand-primary-dark: ${p.brand.primaryDark};

    /*
     * Dark-mode link pair. antdTheme.ts pins colorLink to primaryHover
     * for BOTH modes — AA on the light page but ~3:1 on the dark page,
     * so auth links (Forgot password, Terms) failed contrast. Override
     * to the bright dark-mode brand step (primaryDark — the same step
     * the prefers-contrast block uses). Hover steps to the mid brand
     * shade (aurora.mid) rather than primaryActive: primaryActive is
     * the DARKEST brand step and reads ≤2.6:1 on the dark page, which
     * would re-introduce the failure on hover. aurora.mid stays AA
     * (≥5:1 on each palette's bgDark) across all three palettes.
     */
    --ant-color-link: ${p.brand.primaryDark};
    --ant-color-link-hover: ${p.aurora.mid};

    --pulse-accent-start: ${p.accent.start};
    --pulse-accent-end: ${p.accent.end};
    --pulse-accent-bg-strong: rgba(${p.accent.rgb}, 0.32);
    --pulse-accent-border: rgba(${p.accent.rgb}, 0.22);
    --pulse-accent-bg-medium: rgba(${p.accent.rgb}, 0.16);
    --pulse-accent-bg-subtle: rgba(${p.accent.rgb}, 0.04);
    --pulse-accent-bg-hover: rgba(${p.accent.rgb}, 0.18);

    /*
     * Dark-mode counterpart of the AntD --ant-color-* equivalents. The
     * text ramp keeps the gray-200 ink --pulse-text-base uses in dark;
     * fills, overlays and borders flip to a white ink so they read on the
     * dark page. Opacities and the solid-surface hexes mirror AntD's dark
     * algorithm output.
     */
    --pulse-text-secondary: rgba(229, 231, 235, 0.65);
    --pulse-text-tertiary: rgba(229, 231, 235, 0.45);
    --pulse-fill: rgba(255, 255, 255, 0.18);
    --pulse-fill-secondary: rgba(255, 255, 255, 0.12);
    --pulse-fill-tertiary: rgba(255, 255, 255, 0.08);
    --pulse-fill-quaternary: rgba(255, 255, 255, 0.04);
    --pulse-border: rgba(255, 255, 255, 0.14);
    --pulse-border-secondary: rgba(255, 255, 255, 0.08);
    --pulse-bg-container: #141414;
    --pulse-bg-elevated: #1f1f1f;
    --pulse-bg-text-hover: rgba(255, 255, 255, 0.12);
    --pulse-bg-text-active: rgba(255, 255, 255, 0.18);

    --pulse-link: ${p.brand.primaryDark};
    --pulse-error: #CE3D3D;
    --pulse-warning: #D3890C;

    --pulse-aurora-deep: ${p.aurora.deep};
    --pulse-aurora-mid: ${p.aurora.mid};
    --pulse-aurora-light: ${p.aurora.light};
    --pulse-aurora-cinematic-base: ${p.aurora.cinematicBase};

    --pulse-avatar-grad-0: ${p.avatarGradients[0]};
    --pulse-avatar-grad-1: ${p.avatarGradients[1]};
    --pulse-avatar-grad-2: ${p.avatarGradients[2]};
    --pulse-avatar-grad-3: ${p.avatarGradients[3]};
    --pulse-avatar-grad-4: ${p.avatarGradients[4]};
    --pulse-avatar-grad-5: ${p.avatarGradients[5]};

    --color-copilot-grad-start: ${p.brand.primaryDark};
    --color-copilot-grad-mid: ${p.aurora.light};
    --color-copilot-grad-end: ${p.aurora.mid};
    --color-copilot-bg-subtle: rgba(${p.accent.rgbDark}, 0.08);
    --color-copilot-bg-medium: rgba(${p.accent.rgbDark}, 0.18);
    --color-copilot-badge: ${p.brand.primaryDark};
    --color-copilot-badge-bg: rgba(${p.accent.rgbDark}, 0.16);
    --color-copilot-pulse: rgba(${p.accent.rgbDark}, 0.5);

    --glass-surface: rgba(10, 12, 8, 0.55);
    --glass-surface-strong: rgba(10, 12, 8, 0.88);
    --glass-surface-subtle: rgba(10, 12, 8, 0.35);
    --glass-border: rgba(255, 255, 255, 0.08);
    --glass-border-strong: rgba(${p.accent.rgbDark}, 0.30);
    --glass-shine: inset 0 1px 0 rgba(255, 255, 255, 0.06);

    --glass-specular-top: linear-gradient(135deg, rgba(220, 235, 255, 0.18), transparent 40%);
    --glass-specular-bottom: linear-gradient(315deg, rgba(0, 0, 0, 0.28), transparent 40%);
    --glass-refraction-tint: rgba(${p.accent.rgbDark}, 0.08);
    --glass-shadow-on-text: 0 8px 24px rgba(0, 0, 0, 0.50), 0 2px 6px rgba(0, 0, 0, 0.30);
    --glass-shadow-on-solid: 0 4px 16px rgba(0, 0, 0, 0.32), 0 1px 3px rgba(0, 0, 0, 0.18);
    /*
     * Dark-mode lift for floating glass chrome. The dark glass
     * already pops against the dark page so the shadow stays at the
     * existing two-stack recipe; pushing it higher would over-
     * blacken the surround.
     */
    --ant-shadow-glass-lifted:
        0 8px 16px rgba(0, 0, 0, 0.32),
        0 16px 32px rgba(0, 0, 0, 0.38);
    --glass-rim-subtle: rgba(255, 255, 255, 0.06);
    --glass-rim: rgba(255, 255, 255, 0.12);
    --glass-rim-strong: rgba(255, 255, 255, 0.20);

    --motion-morph: 450ms;
    --motion-gel-flex: 220ms;
    --ant-motion-detent-snap: 360ms;
    --ant-motion-tab-bar-minimize: 280ms;

    --easing-spring-soft: cubic-bezier(0.34, 1.56, 0.64, 1);
    --easing-spring-snap: cubic-bezier(0.16, 1.05, 0.36, 1);
    --ant-easing-detent: cubic-bezier(0.32, 0.72, 0, 1);

    --ant-backdrop-filter-glass: ${composeBackdropFilter(INTENSITY_REGULAR)};
    --ant-backdrop-filter-glass-subtle: ${composeBackdropFilter(INTENSITY_SUBTLE_REGULAR)};
    --ant-backdrop-filter-glass-strong: ${composeBackdropFilter(INTENSITY_STRONG_REGULAR)};

    --ant-chrome-inset-mobile: 16px;
    --ant-detent-peek: 96px;
    --ant-detent-medium: 50dvh;
    --ant-detent-large: 92dvh;

    --aurora-blob: rgba(${p.accent.rgbDark}, 0.14);
    --aurora-blob-strong: rgba(${p.accent.rgbDark}, 0.24);
    --aurora-blob-faint: rgba(${p.accent.rgbDark}, 0.08);
}

/*
 * Phase 5 Wave 2 T4 — user-facing glass intensity toggle. The
 * useGlassIntensity hook writes the resolved intensity to
 * html[data-glass-intensity="…"]; these selectors override
 * --ant-backdrop-filter-glass so every chrome surface that consumes
 * the var flips in one shot. "regular" inherits the :root default
 * above — no override needed.
 *
 * Light + dark blocks both honour the user's choice; the data
 * attribute lives on <html> which is the same ancestor for both
 * data-color-scheme="light" and data-color-scheme="dark". AntD's
 * cssVar scoping (:where(.ant)) doesn't apply here — we're writing
 * the var on the html selector itself, which has higher specificity
 * than :where() ever produces.
 */
html[data-glass-intensity="clear"] {
    --ant-backdrop-filter-glass: ${composeBackdropFilter(INTENSITY_CLEAR)};
    --ant-backdrop-filter-glass-subtle: ${composeBackdropFilter(INTENSITY_SUBTLE_CLEAR)};
    --ant-backdrop-filter-glass-strong: ${composeBackdropFilter(INTENSITY_STRONG_CLEAR)};
}

html[data-glass-intensity="solid"] {
    --ant-backdrop-filter-glass: ${composeBackdropFilter(INTENSITY_SOLID)};
    --ant-backdrop-filter-glass-subtle: ${composeBackdropFilter(INTENSITY_SOLID)};
    --ant-backdrop-filter-glass-strong: ${composeBackdropFilter(INTENSITY_SOLID)};
}

/*
 * Belt-and-suspenders: the OS-level reduced-transparency signal always
 * wins, regardless of the user's stored choice. Pins the var to the
 * Solid preset (which composes to "none") so even a user who
 * deliberately picked "clear" gets the opt-out treatment when the OS
 * tells us their accessibility needs differ. App.css ships the
 * matching [data-glass-context="true"] override that wipes
 * GlassPanel's prop-driven blur on the same media query — that's the
 * Wave 2 T4 "deliberate accessibility choice" contract.
 */
@media (prefers-reduced-transparency: reduce) {
    :root,
    html[data-color-scheme="light"],
    html[data-color-scheme="dark"] {
        --ant-backdrop-filter-glass: ${composeBackdropFilter(INTENSITY_SOLID)};
        --ant-backdrop-filter-glass-subtle: ${composeBackdropFilter(INTENSITY_SOLID)};
        --ant-backdrop-filter-glass-strong: ${composeBackdropFilter(INTENSITY_SOLID)};
    }
}

/*
 * Honor user contrast preference (Apple "Increase Contrast" / WCAG
 * 1.4.11). At default opacity the glass border and rim hairlines never
 * meet a 3:1 non-text boundary and the orange primary fails AA for link
 * text, so this query thickens the hairlines, pushes glass surfaces
 * toward opaque (so text over the surface keeps its contrast), and steps
 * the link/text colour to the darker brand step (primaryActive light /
 * primaryDark on dark). Writing on the html[data-color-scheme] selectors
 * outbeats AntD's :where()-scoped colour vars without !important. App.css
 * ships the matching [data-glass-context="true"] override for GlassPanel
 * surfaces on the same query.
 */
@media (prefers-contrast: more) {
    :root,
    html[data-color-scheme="light"] {
        --glass-surface: rgba(255, 255, 255, 0.95);
        --glass-surface-strong: rgba(255, 255, 255, 0.98);
        --glass-surface-subtle: rgba(255, 255, 255, 0.92);
        --glass-border: rgba(15, 23, 42, 0.30);
        --glass-rim-subtle: rgba(255, 255, 255, 0.55);
        --glass-rim: rgba(255, 255, 255, 0.70);
        --glass-rim-strong: rgba(255, 255, 255, 0.85);

        --ant-color-link: ${p.brand.primaryActive};
        --ant-color-primary: ${p.brand.primaryActive};
    }

    html[data-color-scheme="dark"] {
        --glass-surface: rgba(10, 12, 8, 0.96);
        --glass-surface-strong: rgba(10, 12, 8, 0.99);
        --glass-surface-subtle: rgba(10, 12, 8, 0.92);
        --glass-border: rgba(255, 255, 255, 0.45);
        --glass-rim-subtle: rgba(255, 255, 255, 0.30);
        --glass-rim: rgba(255, 255, 255, 0.45);
        --glass-rim-strong: rgba(255, 255, 255, 0.60);

        --ant-color-link: ${p.brand.primaryDark};
        --ant-color-primary: ${p.brand.primaryDark};
    }
}
`;
