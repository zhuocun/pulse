import type { CSSProperties } from "react";

/**
 * Ant Design preset tag colours adapt with the theme; arbitrary hex values
 * render as opaque fills that stay light in dark mode. For hex labels, derive
 * a translucent fill + coloured text so chips read consistently in both themes.
 */
export function labelTagProps(color?: string | null): {
    color?: string;
    style?: CSSProperties;
} {
    if (!color) return {};
    if (!color.startsWith("#")) return { color };
    return {
        style: {
            backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
            borderColor: `color-mix(in srgb, ${color} 42%, transparent)`,
            color
        }
    };
}
