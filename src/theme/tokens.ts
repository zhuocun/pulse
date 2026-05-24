/**
 * Single source of truth for spacing, color, typography, radius, motion, and
 * z-index across the app. Components MUST import from this module instead of
 * hand-rolling rems or hex literals so a future theme change is one edit.
 *
 * Color tokens (`brand`, `accent`, `aurora`, `avatarGradients`) are derived
 * from the active palette in `./palettes` — to change the palette, edit
 * one import line in `palettes/index.ts`. Non-color tokens (space, radius,
 * fontSize, motion) live here as plain literals.
 *
 * The numeric values are in CSS pixels (the project intentionally drops the
 * old `html { font-size: 62.5% }` hack — see docs/ui-ux-optimization-plan.md
 * §1.1.1 and §Phase 1.1).
 */

import { palette } from "./palettes";

export const space = {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64
} as const;

export const radius = {
    xs: 4,
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    pill: 999
} as const;

export const fontSize = {
    xs: 12,
    sm: 13,
    base: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 36
} as const;

export const fontWeight = {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700
} as const;

export const lineHeight = {
    tight: 1.25,
    snug: 1.4,
    normal: 1.5,
    relaxed: 1.65
} as const;

export const letterSpacing = {
    tight: "-0.02em",
    normal: "0",
    wide: "0.04em",
    wider: "0.08em"
} as const;

/**
 * Brand surfaces — derived from the active palette. AA contrast on white
 * is enforced at the palette level, not here. To change the palette, edit
 * `palettes/index.ts` (one line); these tokens follow automatically.
 */
export const brand = {
    primary: palette.brand.primary,
    primaryHover: palette.brand.primaryHover,
    primaryActive: palette.brand.primaryActive,
    primaryBg: palette.brand.primaryBg,
    primaryBgDark: palette.brand.primaryBgDark
} as const;

/**
 * Accent gradient stops for AI surfaces (sparkle icon, badges, highlights).
 * The translucent `bg*` / `border` / `glow` variants are computed from the
 * palette's `rgb` triplet so a palette swap moves them all in one shot.
 */
export const accent = {
    start: palette.accent.start,
    end: palette.accent.end,
    glow: `rgba(${palette.accent.rgb}, 0.22)`,
    bgSubtle: `rgba(${palette.accent.rgb}, 0.04)`,
    bgSoft: `rgba(${palette.accent.rgb}, 0.08)`,
    bgMedium: `rgba(${palette.accent.rgb}, 0.16)`,
    bgStrong: `rgba(${palette.accent.rgb}, 0.32)`,
    border: `rgba(${palette.accent.rgb}, 0.22)`,
    secondaryStrong: `rgba(${palette.accent.rgb}, 0.32)`,
    selectionBg: `rgba(${palette.accent.rgb}, 0.20)`
} as const;

/**
 * Aurora gradient layers — single-hue, derived from the active palette.
 * `cinematicBase` is the deepest step, used as the dark backdrop on the
 * auth hero rail. `gradLine` is the linear sweep used by the sparkle icon
 * and other single-stripe gradient surfaces.
 */
export const aurora = {
    deep: palette.aurora.deep,
    mid: palette.aurora.mid,
    light: palette.aurora.light,
    surface: palette.brand.primaryBg,
    deepSoft: `rgba(${palette.accent.rgb}, 0.10)`,
    midSoft: `rgba(${palette.accent.rgb}, 0.12)`,
    cinematicBase: palette.aurora.cinematicBase,
    gradLine: `linear-gradient(135deg, ${palette.aurora.deep} 0%, ${palette.aurora.mid} 100%)`,
    gradLineSoft: `linear-gradient(135deg, rgba(${palette.accent.rgb}, 0.10) 0%, rgba(${palette.accent.rgb}, 0.06) 100%)`
} as const;

/**
 * Helper: produce an `rgba(...)` string from the active palette's accent
 * triplet at the requested opacity. Centralises the "any new tint token
 * must derive from `palette.accent.rgb`" rule so a palette swap re-tints
 * every Liquid Glass surface in one shot. Use `accentAtDark` for the
 * dark-mode-paired triplet (lighter, AA-safe on dark backgrounds).
 *
 * Don't use this for specular highlights — specular rims model an
 * achromatic light source and stay neutral white/black on purpose.
 */
export const accentAt = (opacity: number): string =>
    `rgba(${palette.accent.rgb}, ${opacity})`;
export const accentAtDark = (opacity: number): string =>
    `rgba(${palette.accent.rgbDark}, ${opacity})`;

/**
 * Glass surface tokens. Surfaces stay neutral white-tinted (the elegance
 * comes from the surface itself, not from the accent leaking into every
 * pane); only the strong borders and the new refraction tint pick up the
 * brand accent. NEVER apply glass without the
 * `prefers-reduced-transparency` fallback wired up in App.css. Modals
 * deliberately do NOT use these tokens — they render as solid surfaces
 * per product direction.
 *
 * Phase 5 "Liquid Glass" additions (Wave 1 T1):
 *
 *   - `specularTop` / `specularBottom`: top-leading rim highlight and
 *     bottom-trailing companion shadow, painted as `::before` gradient
 *     backgrounds by Wave 2 to model a tilted light catching the glass
 *     edge. Achromatic (white/black) because the light source itself is
 *     uncolored — only the refracted body picks up hue.
 *   - `refractionTint`: a faint accent wash overlay applied across the
 *     full glass surface, modelling the body of the material absorbing
 *     a sliver of the brand hue. Derived from `palette.accent.rgb` via
 *     `accentAt` so a palette swap re-tints in one shot.
 *   - `shadowOnText` / `shadowOnSolid`: content-aware drop shadows that
 *     change density depending on what the glass is floating over.
 *     Stronger over text-heavy / dark content (more visual separation
 *     needed), softer over solid / light content (less needed).
 *   - `rimSubtle` / `rim` / `rimStrong`: 1px hairline border colours for
 *     the rim ring. Three steps so consumers can pick the right amount
 *     of edge definition for hover / active / resting states.
 *   - `intensityClear` / `intensityRegular` / `intensitySolid`: three
 *     discrete intensity presets, switched by Wave 2's user-intensity
 *     toggle (Clear / Regular / Solid). `intensitySolid` is the
 *     accessibility opt-out — `blur: 0` and an opaque surface so the
 *     glass disappears entirely when a user picks it. Bias toward
 *     higher opacity rather than lower — Apple's iOS 26 beta walked back
 *     from too-translucent glass after legibility complaints.
 */
export const glass = {
    surface: "rgba(255, 255, 255, 0.68)",
    surfaceStrong: "rgba(255, 255, 255, 0.82)",
    surfaceSubtle: "rgba(255, 255, 255, 0.50)",
    surfaceDark: "rgba(10, 12, 8, 0.55)",
    surfaceStrongDark: "rgba(10, 12, 8, 0.74)",
    surfaceSubtleDark: "rgba(10, 12, 8, 0.35)",
    border: "rgba(15, 23, 42, 0.06)",
    borderDark: "rgba(255, 255, 255, 0.08)",
    borderStrong: `rgba(${palette.accent.rgb}, 0.22)`,
    borderStrongDark: `rgba(${palette.accent.rgbDark}, 0.30)`,
    shineInset: "inset 0 1px 0 rgba(255, 255, 255, 0.55)",
    shineInsetDark: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
    /*
     * Specular rim highlights. Painted as a `::before` overlay by
     * `<GlassPanel>` (Wave 1 T2 / consumed by Wave 2). The 135deg axis
     * models a light source at the top-leading corner — the highlight
     * sits on the top-leading edge, the soft shadow on the bottom-
     * trailing. White at 0.30 catches the eye without dominating the
     * surface; the transparent-at-40% stop keeps the highlight pinned
     * to the rim rather than washing the centre.
     */
    specularTop:
        "linear-gradient(135deg, rgba(255, 255, 255, 0.30), transparent 40%)",
    specularBottom:
        "linear-gradient(315deg, rgba(0, 0, 0, 0.12), transparent 40%)",
    /*
     * Dark-mode specular variants. The highlight is cooler and lower
     * amplitude (0.18 vs. 0.30) because a bright rim on a dark surface
     * reads as much hotter than the same value on a light surface —
     * physics tells us the same, since the contrast ratio is what the
     * eye picks up. The companion shadow drops to 0.18 because the
     * surface itself is already dark; we just want a faint trough.
     */
    specularTopDark:
        "linear-gradient(135deg, rgba(220, 235, 255, 0.18), transparent 40%)",
    specularBottomDark:
        "linear-gradient(315deg, rgba(0, 0, 0, 0.28), transparent 40%)",
    /*
     * Refraction tint — the faint accent body wash absorbed by the
     * "liquid" of the glass. Derived via `accentAt` so a palette swap
     * re-tints in one shot. 0.05 in light and 0.08 in dark — the dark
     * variant gets a touch more amplitude because the surface is denser
     * and tints read more subtle on it.
     */
    refractionTint: accentAt(0.05),
    refractionTintDark: accentAtDark(0.08),
    /*
     * Content-aware drop shadows. The `OnText` variant is denser (two
     * stacked shadows) to lift glass above text-heavy / dark content
     * where the eye needs help finding the edge. The `OnSolid` variant
     * is softer for floating over light / solid backgrounds where less
     * separation reads cleaner.
     */
    shadowOnText:
        "0 8px 24px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.12)",
    shadowOnSolid:
        "0 4px 16px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06)",
    /*
     * Rim hairlines. `rimSubtle` for resting state, `rim` for the default
     * 1px ring, `rimStrong` for hover / active where the edge should
     * read as engaged. Both modes use white-at-varying-opacity — the rim
     * models an achromatic specular highlight that catches the same way
     * on light and dark surfaces. Dark-mode opacities are lower so the
     * highlight reads as a glint, not a halo, against the dim ground.
     */
    rimSubtle: "rgba(255, 255, 255, 0.18)",
    rim: "rgba(255, 255, 255, 0.32)",
    rimStrong: "rgba(255, 255, 255, 0.48)",
    rimSubtleDark: "rgba(255, 255, 255, 0.06)",
    rimDark: "rgba(255, 255, 255, 0.12)",
    rimStrongDark: "rgba(255, 255, 255, 0.20)",
    /*
     * Intensity presets — three discrete configs Wave 2's user-intensity
     * toggle picks from. Components consume them via the
     * `--ant-backdrop-filter-glass` CSS var; Wave 2 will swap the var
     * value globally so every glass surface flips in one shot.
     *
     * `clear`    — most translucent (lowest surface opacity, modest blur)
     *              for "Clear" mode users who want maximum show-through.
     * `regular`  — current default, balanced legibility / show-through.
     * `solid`    — accessibility opt-out: `blur: 0` and opaque surface.
     *              The glass effectively disappears, which is what users
     *              with reduced-transparency / cognitive accessibility
     *              needs depend on.
     */
    intensityClear: {
        surface: "rgba(255, 255, 255, 0.42)",
        blur: 14,
        /*
         * Wave 2 T4 — `saturation` is the AntD `backdrop-filter` ladder
         * value that pairs with `blur`. Clear gets 170% (a notch below
         * the regular 180%) so the show-through reads as crisp rather
         * than oversaturated when paired with the lower surface
         * opacity. The cssVars renderer composes
         * `blur(${blur}px) saturate(${saturation}%)` for the
         * `--ant-backdrop-filter-glass` var override at this intensity.
         */
        saturation: 170,
        border: "rgba(15, 23, 42, 0.04)",
        specular:
            "linear-gradient(135deg, rgba(255, 255, 255, 0.22), transparent 40%)"
    },
    intensityRegular: {
        surface: "rgba(255, 255, 255, 0.68)",
        blur: 20,
        saturation: 180,
        border: "rgba(15, 23, 42, 0.06)",
        specular:
            "linear-gradient(135deg, rgba(255, 255, 255, 0.30), transparent 40%)"
    },
    intensitySolid: {
        surface: "rgba(255, 255, 255, 1)",
        blur: 0,
        // Solid intensity opts OUT of backdrop-filter entirely (the
        // var override at this intensity emits `none`), so the
        // saturation value is academic — kept at the regular 180%
        // so the token shape stays uniform for consumers that
        // iterate the three intensities.
        saturation: 180,
        border: "rgba(15, 23, 42, 0.08)",
        specular: "none"
    }
} as const;

/**
 * Backdrop-filter blur ladder (CSS px). Used as
 * `backdrop-filter: saturate(180%) blur(${blur.md}px)`. Higher values are
 * GPU-expensive — keep `lg` and `xl` to ≤2 simultaneously visible surfaces.
 */
export const blur = {
    xs: 8,
    sm: 12,
    md: 20,
    lg: 28,
    xl: 40
} as const;

/**
 * Semantic palette aligned with the new brand. We expose explicit hexes here
 * because AntD's defaults (e.g. red-5 = #ff4d4f) are too saturated for the
 * refined neutral surface treatment. Components reading `--ant-color-*`
 * still pick up AntD's auto-derived variants.
 */
export const semantic = {
    success: "#10B981",
    successBg: "#ECFDF5",
    warning: "#F59E0B",
    warningBg: "#FFFBEB",
    error: "#EF4444",
    errorBg: "#FEF2F2",
    info: "#3B82F6",
    infoBg: "#EFF6FF",
    favorite: "#F43F5E"
} as const;

/**
 * Tag color tokens. Used to keep "Bug" / "Task" / story-points / epic chips
 * visually consistent across cards, brief drawer, draft modal.
 */
export const tag = {
    task: "geekblue",
    bug: "magenta",
    epic: "purple",
    points: "default"
} as const;

/**
 * Layered shadow tokens. The old single-flat shadow looked dated; modern
 * cards use two stacked shadows (a tight ambient one and a softer cast) to
 * read as floating without being heavy.
 */
export const shadow = {
    xs: "0 1px 2px rgba(15, 23, 42, 0.05)",
    sm: "0 1px 2px rgba(15, 23, 42, 0.05), 0 1px 3px rgba(15, 23, 42, 0.06)",
    md: "0 2px 4px rgba(15, 23, 42, 0.05), 0 4px 12px rgba(15, 23, 42, 0.06)",
    lg: "0 8px 16px rgba(15, 23, 42, 0.06), 0 16px 32px rgba(15, 23, 42, 0.08)",
    xl: "0 16px 32px rgba(15, 23, 42, 0.10), 0 32px 64px rgba(15, 23, 42, 0.12)",
    focus: `0 0 0 3px rgba(${palette.accent.rgb}, 0.22)`,
    inset: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
    /* Single brand-accent glow + soft aurora drop. Derived from the active
     * palette so a palette swap re-tints both in one shot. */
    glowAccent: `0 0 24px rgba(${palette.accent.rgb}, 0.28)`,
    glowAurora: `0 12px 40px -8px rgba(${palette.accent.rgb}, 0.24), 0 0 0 1px rgba(${palette.accent.rgb}, 0.10)`,
    /** Drag-lift: slightly above resting card shadow without the full `lg` stack. */
    lift: "0 6px 16px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(15, 23, 42, 0.06)"
} as const;

/**
 * Motion durations in ms. Long, medium, short follow Material 3 buckets so
 * `prefers-reduced-motion` can cut all of them to zero in one place.
 *
 * Phase 5 "Liquid Glass" additions (Wave 1 T1):
 *
 *   - `morph` (450ms): glass surface state morphing — e.g. a panel that
 *     reshapes when its content swaps. Slow enough to read as a fluid
 *     transformation rather than a snap.
 *   - `gelFlex` (220ms): press / tap gel-flex micro-animation — the
 *     glass surface yields slightly under finger pressure then springs
 *     back. Sits between `medium` and `long` so the press feels
 *     immediate but the recovery is noticeable.
 */
export const motion = {
    instant: 60,
    short: 120,
    medium: 200,
    long: 320,
    morph: 450,
    gelFlex: 220
} as const;

/**
 * Easing curves. The `standard` / `emphasized` / `decelerate` curves cover
 * the M3 "expressive easing" set; the two `spring*` curves are Wave 1 T1
 * additions for Liquid Glass.
 *
 *   - `springSoft`: pronounced overshoot for "materialize" moments
 *     (popover appearing, panel snapping into place). Goes past the
 *     final value before settling, which reads as a buoyant, liquid
 *     feel.
 *   - `springSnap`: gentle overshoot for the gel-flex press recovery.
 *     Less overshoot than `springSoft` because a button press should
 *     spring back tight, not loose.
 */
export const easing = {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1)",
    decelerate: "cubic-bezier(0, 0, 0, 1)",
    springSoft: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    springSnap: "cubic-bezier(0.16, 1.05, 0.36, 1)"
} as const;

/**
 * View Transitions name registry. This is the CANONICAL source for every
 * `view-transition-name` value used in the app — recording new entries
 * here prevents two components from accidentally registering the same
 * name (which would cause the browser to morph one into the other
 * mid-route-change). Wave 5 adopts every entry below; Wave 2 adopts
 * `topbar` for the project-detail breadcrumb chrome.
 *
 * Adding a new entry: declare here first, then reference via
 * `viewTransition.<key>` in the component's `view-transition-name`
 * declaration (so a grep for the literal string lands here).
 */
export const viewTransition = {
    /** Sticky page header — already in use at src/components/header/index.tsx. */
    header: "pulse-header",
    /** Phone-chassis bottom tab bar — already in use at src/components/bottomTabBar/index.tsx. */
    tabbar: "pulse-tabbar",
    /** Project-detail breadcrumb / top bar — Wave 2 will adopt. */
    topbar: "pulse-topbar",
    /** Board column header — kept stable across column re-order / filter swaps. */
    columnHeader: "pulse-column-header",
    /** Global Cmd-K command palette — kept stable across route changes. */
    commandPalette: "pulse-command-palette",
    /** Right-edge Copilot dock — kept stable so the dock pins through navigations. */
    copilotDock: "pulse-copilot-dock",
    /** Lens (filter) chip — for chip-to-detail morphing. */
    lensChip: "pulse-lens-chip",
    /** Copilot suggestion chip — for chip-to-message morphing. */
    copilotChip: "pulse-copilot-chip",
    /** Phone-chassis tab-bar accessory slot — pinned across navigations. */
    tabAccessory: "pulse-tab-accessory"
} as const;

/*
 * Stacking ladder. Sticky page chrome (header, projectDetail TopBar) sits at
 * `sticky: 10`. AntD overlays (Drawer / Modal) and our toasts ride well
 * above. The @hello-pangea/dnd drag clone is mounted on `document.body`
 * via React's createPortal and gets an inline `z-index: 5000` (verified
 * in `node_modules/@hello-pangea/dnd/dist/dnd.esm.js` `zIndexOptions`),
 * which paints above every authored tier in this ladder including
 * `toast` (1200). That ordering is intentional: a card in flight should
 * always be visible to the user, even if a transient toast fires
 * mid-drag.
 *
 * Stacking-context audit (2026-05-23): traced every ancestor of the
 * sticky `<header>` and `<TopBar>` in the mainLayout → routes chain.
 * Neither `<html>`, `<body>`, `#root`, the layout `<Container>` nor any
 * intermediate wrapper applies `transform`, `will-change: transform`,
 * `filter`, `perspective`, `contain: layout|paint|strict`, or
 * `backdrop-filter`. The sticky header's own `backdrop-filter` /
 * `view-transition-name` creates a stacking context on the header
 * element itself but cannot trap a sibling-of-`<body>` portal. Result:
 * the DnD clone is free to paint over the sticky chrome on every
 * platform, including iOS Safari. Revisit this comment if a future
 * change wraps the layout in a transformed/filtered ancestor.
 */
export const zIndex = {
    sticky: 10,
    /*
     * Bottom-tab bar (phone chassis). Sits above page content and
     * above the sticky tier but BELOW AntD's Drawer + Modal mask
     * (both 1000) and Modal content (1010) so an open overlay fully
     * obscures the chrome without the bar painting on top of its
     * dimmer. The previous value (1010) painted over both surfaces
     * and trapped touch users behind the bar.
     */
    navBar: 15,
    dropdown: 1050,
    drawer: 1000,
    modal: 1100,
    toast: 1200,
    /**
     * Reference value (NOT applied as a CSS prop) — the inline z-index
     * `@hello-pangea/dnd` puts on the drag clone via its body portal.
     * Documented here so the ladder assertions in `tokens.test.ts` can
     * verify our chrome stays well below the drag layer. If the library
     * bumps this value, the test will fail and force a conscious review.
     */
    dndDragClone: 5000
} as const;

/**
 * Touch target minimum (CSS px). 24 px satisfies WCAG 2.5.8 (AA); we lift to
 * 44 px on `pointer: coarse` viewports via the AntD `controlHeight` token.
 */
export const touchTargetMin = 24;
export const touchTargetCoarse = 44;

/**
 * Maximum readable line length for body copy (in `ch`). Applied to chat
 * messages, brief descriptions, modal notes.
 */
export const maxLineLengthCh = 75;

/**
 * Standard board column width (in rem). Reused by the board page skeleton so
 * the loading layout matches the real columns.
 */
export const columnMinWidthRem = 18;

/**
 * Maximum width (in rem) for routed pages so content doesn't sprawl on
 * ultra-wide monitors. The board page opts out and lets columns scroll.
 */
export const pageMaxWidthRem = 88;

/**
 * Standard "modal-on-mobile" formula. AntD's Modal reserves ~16 px breathing
 * room on each side of the viewport on phones; we centralize that math so
 * every modal lands at the same width and we don't sprinkle `32` literals
 * through component code.
 */
export const modalGutterPx = space.md * 2; // 16 px each side
export const modalWidthCss = (max: number) =>
    `min(${max}px, calc(100dvw - ${modalGutterPx}px))`;

/**
 * Monochromatic gradient palette for user / project avatars — derived from
 * the active palette. Six lightness variations so every distinct id reads
 * as a unique monogram while staying inside the single-color identity.
 */
export const avatarGradients = palette.avatarGradients;

/**
 * Modern sans-serif stack. We load Inter from Google Fonts; the rest is a
 * progressive-enhancement fallback that matches each major OS's UI font.
 */
export const fontFamily = {
    sans: '"Inter", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
} as const;

/**
 * Breakpoints (CSS px). Keep this list short — anything more granular should
 * be a one-off in the affected component.
 */
export const breakpoints = {
    sm: 480,
    md: 768,
    lg: 1024,
    xl: 1280
} as const;
