import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import tailwindcssAnimate from "tailwindcss-animate";

import { accent, aurora, brand } from "./src/theme/tokens";
import {
    durationScale,
    easingScale,
    fontSizeScale,
    fontWeightScale,
    lineHeightScale,
    radiusScale,
    semanticColors,
    spacingScale
} from "./src/theme/tailwindBridge";

/*
 * Tailwind coexists with Ant Design during the migration. Two deliberate
 * choices keep the two from stepping on each other:
 *
 *   - Preflight is OFF. Tailwind's reset zeroes `border-width` on every
 *     element and strips element defaults, which erases AntD's own borders
 *     and control styling. Utilities work fine without it; re-enable once
 *     AntD is gone.
 *   - Colors and the non-color scales resolve to CSS variables, not baked
 *     literals. `brand` / `accent` / `aurora` come from `tokens.ts` as
 *     `var(--pulse-*, <fallback>)` strings and the glass / page surfaces
 *     read the `--glass-*` / `--pulse-bg-page` vars injected by
 *     `palettes/cssVars.ts`, so palette switching and glass intensity flip
 *     Tailwind utilities in lockstep with the rest of the app. The space /
 *     radius / type / motion scales point at the `--pulse-*` vars generated
 *     from the same tokens in `tailwindBridge.ts`.
 */
const config: Config = {
    darkMode: ["selector", '[data-color-scheme="dark"]'],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    corePlugins: {
        preflight: false
    },
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: brand.primary,
                    hover: brand.primaryHover,
                    active: brand.primaryActive,
                    bg: brand.primaryBg,
                    "bg-dark": brand.primaryBgDark
                },
                accent: {
                    DEFAULT: accent.start,
                    start: accent.start,
                    end: accent.end
                },
                aurora: {
                    deep: aurora.deep,
                    mid: aurora.mid,
                    light: aurora.light
                },
                page: {
                    DEFAULT: "var(--pulse-bg-page)",
                    text: "var(--pulse-text-base)"
                },
                glass: {
                    surface: "var(--glass-surface)",
                    "surface-strong": "var(--glass-surface-strong)",
                    "surface-subtle": "var(--glass-surface-subtle)",
                    border: "var(--glass-border)",
                    "border-strong": "var(--glass-border-strong)"
                },
                ...semanticColors
            },
            spacing: spacingScale,
            borderRadius: radiusScale,
            fontSize: fontSizeScale,
            fontWeight: fontWeightScale,
            lineHeight: lineHeightScale,
            transitionDuration: durationScale,
            transitionTimingFunction: easingScale
        }
    },
    plugins: [
        tailwindcssAnimate,
        plugin(({ addVariant }) => {
            addVariant("coarse", "@media (pointer: coarse)");
        })
    ]
};

export default config;
