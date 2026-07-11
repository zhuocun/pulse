/**
 * Bridge between the design tokens in `./tokens.ts` and Tailwind's theme.
 *
 * The non-color scales (space, radius, fontSize, fontWeight, lineHeight,
 * motion durations, easing) live in `tokens.ts` as plain literals. This
 * module derives — from those SAME objects, never a hand-copied fork — a
 * table of `--pulse-*` CSS custom properties (`tokenVarsCss`, injected once
 * in `index.tsx`) plus matching `var(--pulse-*)` reference maps for
 * `tailwind.config.ts`. Because the config points at the vars and the vars
 * are generated from the tokens, a token edit flows to Tailwind utilities
 * automatically and the two can never drift.
 *
 * Palette-driven COLORS are NOT bridged here: `tokens.ts` already exposes
 * `brand` / `accent` / `aurora` as `var(--pulse-*, <fallback>)` strings and
 * the glass / page surfaces resolve straight off the `--glass-*` /
 * `--pulse-bg-page` vars that `palettes/cssVars.ts` injects — so palette
 * switching (`usePaletteTheme`) and glass intensity (`useGlassIntensity`)
 * keep flipping every Tailwind color for free. `tailwind.config.ts`
 * references those directly.
 */

import {
    easing,
    fontSize,
    fontWeight,
    lineHeight,
    motion,
    radius,
    semantic,
    space
} from "./tokens";

interface Bridged {
    css: string[];
    vars: Record<string, string>;
}

/**
 * Turn one token scale into its `--pulse-<prefix>-<key>` declarations and the
 * matching `{ key: "var(--pulse-<prefix>-<key>)" }` reference map. `format`
 * stamps the CSS unit (px / ms) or coerces a number to a bare string.
 */
const bridge = <T>(
    prefix: string,
    scale: Readonly<Record<string, T>>,
    format: (value: T) => string
): Bridged => {
    const css: string[] = [];
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(scale)) {
        const varName = `--pulse-${prefix}-${key}`;
        css.push(`    ${varName}: ${format(value)};`);
        vars[key] = `var(${varName})`;
    }
    return { css, vars };
};

const px = (value: number): string => `${value}px`;
const ms = (value: number): string => `${value}ms`;
const raw = (value: string | number): string => `${value}`;

const spaceBridge = bridge("space", space, px);
const radiusBridge = bridge("radius", radius, px);
const fontSizeBridge = bridge("font-size", fontSize, px);
const fontWeightBridge = bridge("font-weight", fontWeight, raw);
const lineHeightBridge = bridge("line-height", lineHeight, raw);
const durationBridge = bridge("duration", motion, ms);
const easingBridge = bridge("ease", easing, raw);
const semanticBridge = bridge("semantic", semantic, raw);

/**
 * `:root` block of every derived token var. Injected synchronously in
 * `index.tsx` (like the palette vars) so Tailwind utilities such as
 * `p-md` / `rounded-lg` / `duration-medium` resolve to the token value from
 * the first paint. Static — no runtime switching — so no resolver hook.
 */
export const tokenVarsCss = `:root {\n${[
    ...spaceBridge.css,
    ...radiusBridge.css,
    ...fontSizeBridge.css,
    ...fontWeightBridge.css,
    ...lineHeightBridge.css,
    ...durationBridge.css,
    ...easingBridge.css,
    ...semanticBridge.css
].join("\n")}\n}\n`;

export const spacingScale = spaceBridge.vars;
export const radiusScale = radiusBridge.vars;
export const fontSizeScale = fontSizeBridge.vars;
export const fontWeightScale = fontWeightBridge.vars;
export const lineHeightScale = lineHeightBridge.vars;
export const durationScale = durationBridge.vars;
export const easingScale = easingBridge.vars;
export const semanticColors = semanticBridge.vars;
