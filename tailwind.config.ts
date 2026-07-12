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
 * Ant Design is fully removed, so Tailwind owns the base layer:
 *
 *   - Preflight is ON (the Tailwind default). The shadcn/ui primitives are
 *     authored against Tailwind's reset — bare `border` utilities assume the
 *     `border-width: 0` baseline, headings/lists ship without UA margins, and
 *     `button` inherits font + resets its native chrome. `App.css` layers its
 *     own resets (box-sizing, page background, focus ring, a11y fallbacks) on
 *     top. It used to be OFF only so Tailwind's reset wouldn't erase AntD's
 *     control borders; with AntD gone that constraint no longer applies.
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
    theme: {
        extend: {
            colors: {
                /*
                 * shadcn/ui semantic surface tokens. Stored as HSL channel
                 * triples in `--ui-*` vars (see the `@layer base` block in
                 * `App.css`) with a light/dark pair so Tailwind's
                 * `<alpha-value>` opacity modifiers (`bg-primary/90`,
                 * `bg-muted/50`) resolve and dark mode flips via the
                 * `[data-color-scheme="dark"]` selector. Namespaced `--ui-`
                 * so they never collide with the `--pulse-*` runtime
                 * palette vars the page chrome reads.
                 */
                background: "hsl(var(--ui-background) / <alpha-value>)",
                foreground: "hsl(var(--ui-foreground) / <alpha-value>)",
                card: {
                    DEFAULT: "hsl(var(--ui-card) / <alpha-value>)",
                    foreground: "hsl(var(--ui-card-foreground) / <alpha-value>)"
                },
                popover: {
                    DEFAULT: "hsl(var(--ui-popover) / <alpha-value>)",
                    foreground:
                        "hsl(var(--ui-popover-foreground) / <alpha-value>)"
                },
                primary: {
                    DEFAULT: "hsl(var(--ui-primary) / <alpha-value>)",
                    foreground:
                        "hsl(var(--ui-primary-foreground) / <alpha-value>)"
                },
                secondary: {
                    DEFAULT: "hsl(var(--ui-secondary) / <alpha-value>)",
                    foreground:
                        "hsl(var(--ui-secondary-foreground) / <alpha-value>)"
                },
                muted: {
                    DEFAULT: "hsl(var(--ui-muted) / <alpha-value>)",
                    foreground:
                        "hsl(var(--ui-muted-foreground) / <alpha-value>)"
                },
                destructive: {
                    DEFAULT: "hsl(var(--ui-destructive) / <alpha-value>)",
                    foreground:
                        "hsl(var(--ui-destructive-foreground) / <alpha-value>)"
                },
                border: "hsl(var(--ui-border) / <alpha-value>)",
                input: "hsl(var(--ui-input) / <alpha-value>)",
                ring: "hsl(var(--ui-ring) / <alpha-value>)",
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
