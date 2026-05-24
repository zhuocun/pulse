import type { Palette } from "./types";

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
 *     Default `blur(20px) saturate(180%)`. Wave 2's user-intensity
 *     toggle overrides this to `none` for the Solid preset. The
 *     `--ant-` prefix is intentional: it lives in the AntD CSS-var
 *     namespace so AntD-overriding selectors in App.css can pick it
 *     up uniformly.
 */
export const paletteToCss = (p: Palette): string => `
:root,
html[data-color-scheme="light"] {
    --pulse-bg-page: ${p.page.bgLight};
    --pulse-text-base: ${p.page.textLight};

    --color-copilot-grad-start: ${p.aurora.deep};
    --color-copilot-grad-mid: ${p.aurora.mid};
    --color-copilot-grad-end: ${p.aurora.light};
    --color-copilot-bg-subtle: rgba(${p.accent.rgb}, 0.04);
    --color-copilot-bg-medium: rgba(${p.accent.rgb}, 0.14);
    --color-copilot-badge: ${p.brand.primary};
    --color-copilot-badge-bg: rgba(${p.accent.rgb}, 0.12);
    --color-copilot-pulse: rgba(${p.accent.rgb}, 0.45);

    --glass-surface: rgba(255, 255, 255, 0.68);
    --glass-surface-strong: rgba(255, 255, 255, 0.82);
    --glass-surface-subtle: rgba(255, 255, 255, 0.50);
    --glass-border: rgba(15, 23, 42, 0.06);
    --glass-border-strong: rgba(${p.accent.rgb}, 0.22);
    --glass-shine: inset 0 1px 0 rgba(255, 255, 255, 0.55);

    --glass-specular-top: linear-gradient(135deg, rgba(255, 255, 255, 0.30), transparent 40%);
    --glass-specular-bottom: linear-gradient(315deg, rgba(0, 0, 0, 0.12), transparent 40%);
    --glass-refraction-tint: rgba(${p.accent.rgb}, 0.05);
    --glass-shadow-on-text: 0 8px 24px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.12);
    --glass-shadow-on-solid: 0 4px 16px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06);
    --glass-rim-subtle: rgba(255, 255, 255, 0.18);
    --glass-rim: rgba(255, 255, 255, 0.32);
    --glass-rim-strong: rgba(255, 255, 255, 0.48);

    --motion-morph: 450ms;
    --motion-gel-flex: 220ms;

    --easing-spring-soft: cubic-bezier(0.34, 1.56, 0.64, 1);
    --easing-spring-snap: cubic-bezier(0.16, 1.05, 0.36, 1);

    --ant-backdrop-filter-glass: blur(20px) saturate(180%);

    --aurora-blob: rgba(${p.accent.rgb}, 0.10);
    --aurora-blob-strong: rgba(${p.accent.rgb}, 0.20);
    --aurora-blob-faint: rgba(${p.accent.rgb}, 0.06);
}

html[data-color-scheme="dark"] {
    --pulse-bg-page: ${p.page.bgDark};
    --pulse-text-base: ${p.page.textDark};

    --color-copilot-grad-start: ${p.brand.primaryDark};
    --color-copilot-grad-mid: ${p.aurora.light};
    --color-copilot-grad-end: ${p.aurora.mid};
    --color-copilot-bg-subtle: rgba(${p.accent.rgbDark}, 0.08);
    --color-copilot-bg-medium: rgba(${p.accent.rgbDark}, 0.18);
    --color-copilot-badge: ${p.brand.primaryDark};
    --color-copilot-badge-bg: rgba(${p.accent.rgbDark}, 0.16);
    --color-copilot-pulse: rgba(${p.accent.rgbDark}, 0.5);

    --glass-surface: rgba(10, 12, 8, 0.55);
    --glass-surface-strong: rgba(10, 12, 8, 0.74);
    --glass-surface-subtle: rgba(10, 12, 8, 0.35);
    --glass-border: rgba(255, 255, 255, 0.08);
    --glass-border-strong: rgba(${p.accent.rgbDark}, 0.30);
    --glass-shine: inset 0 1px 0 rgba(255, 255, 255, 0.06);

    --glass-specular-top: linear-gradient(135deg, rgba(220, 235, 255, 0.18), transparent 40%);
    --glass-specular-bottom: linear-gradient(315deg, rgba(0, 0, 0, 0.28), transparent 40%);
    --glass-refraction-tint: rgba(${p.accent.rgbDark}, 0.08);
    --glass-shadow-on-text: 0 8px 24px rgba(0, 0, 0, 0.50), 0 2px 6px rgba(0, 0, 0, 0.30);
    --glass-shadow-on-solid: 0 4px 16px rgba(0, 0, 0, 0.32), 0 1px 3px rgba(0, 0, 0, 0.18);
    --glass-rim-subtle: rgba(255, 255, 255, 0.06);
    --glass-rim: rgba(255, 255, 255, 0.12);
    --glass-rim-strong: rgba(255, 255, 255, 0.20);

    --motion-morph: 450ms;
    --motion-gel-flex: 220ms;

    --easing-spring-soft: cubic-bezier(0.34, 1.56, 0.64, 1);
    --easing-spring-snap: cubic-bezier(0.16, 1.05, 0.36, 1);

    --ant-backdrop-filter-glass: blur(20px) saturate(180%);

    --aurora-blob: rgba(${p.accent.rgbDark}, 0.14);
    --aurora-blob-strong: rgba(${p.accent.rgbDark}, 0.24);
    --aurora-blob-faint: rgba(${p.accent.rgbDark}, 0.08);
}
`;
