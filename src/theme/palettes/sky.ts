import type { Palette } from "./types";

/**
 * Bright sky blue + cool porcelain. A true azure (Tailwind sky-600) — the
 * crisp, optimistic "clear sky" blue, distinct from indigo's violet lean
 * and cyan's teal lean.
 *
 * Brightness vs. AA contrast trade-off:
 *   - `primary` (#0284C7, sky-600) hits 4.10:1 on white — passes AA-large
 *     and UI components; used for CTA fills (white text on blue) and for
 *     icons / focus rings.
 *   - `primaryHover` (#0369A1, sky-700) hits 5.93:1 on white — AA for
 *     normal text. AntD's `colorLink` overrides to this so links on white
 *     never fail AA.
 *   - `primaryDark` (#7DD3FC, sky-300) is the dark-mode brand for AA on dark.
 */
export const skyPalette: Palette = {
    name: "sky",
    brand: {
        primary: "#0284C7",
        primaryHover: "#0369A1",
        primaryActive: "#075985",
        primaryBg: "#F0F9FF",
        primaryBgDark: "#082F49",
        primaryDark: "#7DD3FC"
    },
    accent: {
        start: "#0284C7",
        end: "#0EA5E9",
        rgb: "2, 132, 199",
        rgbDark: "125, 211, 252"
    },
    aurora: {
        deep: "#0284C7",
        mid: "#0EA5E9",
        light: "#7DD3FC",
        cinematicBase: "#082F49"
    },
    page: {
        bgLight: "#F7FBFE",
        bgDark: "#07121B",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #7DD3FC 0%, #0284C7 100%)",
        "linear-gradient(135deg, #38BDF8 0%, #0369A1 100%)",
        "linear-gradient(135deg, #0EA5E9 0%, #082F49 100%)",
        "linear-gradient(135deg, #7DD3FC 0%, #0369A1 100%)",
        "linear-gradient(135deg, #38BDF8 0%, #075985 100%)",
        "linear-gradient(135deg, #0EA5E9 0%, #0369A1 100%)"
    ]
};
