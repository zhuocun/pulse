/**
 * Shape of a swappable palette. The whole color identity of the app is
 * derived from a single Palette object — switch the active palette at
 * `palettes/index.ts` and the rest follows automatically:
 *
 *   - `tokens.ts` reads `brand`, `accent`, `aurora`, `avatarGradients` from
 *     the active palette
 *   - `index.tsx` injects `paletteToCss(palette)` synchronously before
 *     React renders, so the runtime CSS vars (`--color-copilot-*`,
 *     `--glass-*`, `--pulse-*`, `--aurora-*`) all flip in one shot
 *
 * Adding a new palette: copy `palettes/orange.ts`, change values, then
 * change one import line in `palettes/index.ts`.
 */
export interface Palette {
    /** Human-readable identifier, useful for debugging and analytics. */
    name: string;
    /**
     * Brand surfaces. `primary` is the dominant accent (CTAs, links, focus
     * rings). `primaryBg` is the very-light tinted background used on
     * primary-typed alerts / hover surfaces; `primaryBgDark` is the deepest
     * step used as the cinematic hero base in dark mode.
     */
    brand: {
        primary: string;
        primaryHover: string;
        primaryActive: string;
        primaryBg: string;
        primaryBgDark: string;
        /** Lighter brand step for dark-mode link/text colors (>4.5:1 on dark). */
        primaryDark: string;
    };
    /**
     * Accent gradient stops for AI surfaces. `start` typically equals
     * `brand.primary`; `end` is a brighter step in the same hue. The `rgb`
     * triplet is reused for `rgba(...)` computations (subtle bg tints,
     * focus shadow, glass border). `rgbDark` is the lighter dark-mode rgb.
     */
    accent: {
        start: string;
        end: string;
        rgb: string;
        rgbDark: string;
    };
    /**
     * Mesh / gradient layer colors. `deep` and `mid` carry the gradient
     * weight; `light` is the brightest stop used on dark surfaces and
     * indicator dots. `cinematicBase` is the deepest step used as the
     * dark backdrop for the auth hero rail.
     */
    aurora: {
        deep: string;
        mid: string;
        light: string;
        cinematicBase: string;
    };
    /**
     * Page chrome surfaces. `bgLight` / `bgDark` are the flat fallbacks
     * behind the body gradient; text colors are kept as `rgba()` so they
     * compose cleanly with any backdrop.
     */
    page: {
        bgLight: string;
        bgDark: string;
        textLight: string;
        textDark: string;
    };
    /**
     * Six monochromatic gradients used for user / project monogram avatars.
     * Each is a `linear-gradient(135deg, … 0%, … 100%)` string so consumers
     * can drop them into `background:` directly without recomputing.
     */
    avatarGradients: readonly [string, string, string, string, string, string];
}
