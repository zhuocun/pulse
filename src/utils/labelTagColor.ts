import type { CSSProperties } from "react";

/**
 * Ant Design preset tag colours adapt with the theme; arbitrary hex values
 * render as opaque fills that stay light in dark mode. For hex labels, derive
 * a translucent fill + coloured text so chips read consistently in both themes.
 *
 * Dark ink uses `light-dark()` (honours `html { color-scheme }`) so mid/dark
 * label hues clear WCAG AA on near-black cards without a parallel token system.
 */
export function labelTagProps(color?: string | null): {
    color?: string;
    style?: CSSProperties;
} {
    if (!color) return {};
    if (!color.startsWith("#")) return { color };
    return {
        style: {
            backgroundColor: `light-dark(color-mix(in srgb, ${color} 18%, transparent), color-mix(in srgb, ${color} 32%, transparent))`,
            borderColor: `light-dark(color-mix(in srgb, ${color} 42%, transparent), color-mix(in srgb, ${color} 55%, transparent))`,
            color: `light-dark(${color}, color-mix(in srgb, ${color} 55%, white))`
        }
    };
}
