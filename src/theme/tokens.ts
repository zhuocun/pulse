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
 * Glass surface tokens. Surfaces stay neutral white-tinted (the elegance
 * comes from the surface itself, not from the accent leaking into every
 * pane); only the strong borders pick up the brand accent. NEVER apply
 * glass without the `prefers-reduced-transparency` fallback wired up in
 * App.css. Modals deliberately do NOT use these tokens — they render as
 * solid surfaces per product direction.
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
    shineInsetDark: "inset 0 1px 0 rgba(255, 255, 255, 0.06)"
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
 */
export const motion = {
    instant: 60,
    short: 120,
    medium: 200,
    long: 320
} as const;

export const easing = {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1)",
    decelerate: "cubic-bezier(0, 0, 0, 1)"
} as const;

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
    toast: 1200
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
