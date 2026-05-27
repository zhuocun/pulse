import type { Palette } from "./types";

/**
 * Classic primary blue + cool porcelain. The ubiquitous "default" web/app
 * accent (Tailwind blue-600) — the royal blue that anchors countless SaaS
 * dashboards, Material, and design systems. Distinct from the warmer orange
 * default and the green emerald; reads as calm, trustworthy, and familiar.
 *
 * Brightness vs. AA contrast trade-off:
 *   - `primary` (#2563EB, blue-600) hits 5.17:1 on white — clears AA for
 *     normal text and gives crisp white-on-blue CTA fills, icons, focus rings.
 *   - `primaryHover` (#1D4ED8, blue-700) hits 6.70:1 on white — AA for normal
 *     text. AntD's `colorLink` overrides to this so links never fail AA.
 *   - `primaryDark` (#93C5FD, blue-300) is the dark-mode brand for AA on dark.
 */
export const bluePalette: Palette = {
    name: "blue",
    brand: {
        primary: "#2563EB",
        primaryHover: "#1D4ED8",
        primaryActive: "#1E40AF",
        primaryBg: "#EFF6FF",
        primaryBgDark: "#172554",
        primaryDark: "#93C5FD"
    },
    accent: {
        start: "#2563EB",
        end: "#3B82F6",
        rgb: "37, 99, 235",
        rgbDark: "147, 197, 253"
    },
    aurora: {
        deep: "#2563EB",
        mid: "#3B82F6",
        light: "#93C5FD",
        cinematicBase: "#172554"
    },
    page: {
        bgLight: "#F8FAFE",
        bgDark: "#080C18",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #93C5FD 0%, #2563EB 100%)",
        "linear-gradient(135deg, #60A5FA 0%, #1D4ED8 100%)",
        "linear-gradient(135deg, #3B82F6 0%, #172554 100%)",
        "linear-gradient(135deg, #93C5FD 0%, #1D4ED8 100%)",
        "linear-gradient(135deg, #60A5FA 0%, #1E40AF 100%)",
        "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)"
    ]
};
