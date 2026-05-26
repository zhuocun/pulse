import type { Palette } from "./types";

/**
 * Saturated violet + lilac haze. The "AI copilot" hue — Stripe-adjacent,
 * premium, creative. Reads as intelligent and slightly futuristic.
 */
export const violetPalette: Palette = {
    name: "violet",
    brand: {
        primary: "#7C3AED",
        primaryHover: "#6D28D9",
        primaryActive: "#5B21B6",
        primaryBg: "#F5F3FF",
        primaryBgDark: "#2E1065",
        primaryDark: "#C4B5FD"
    },
    accent: {
        start: "#7C3AED",
        end: "#8B5CF6",
        rgb: "124, 58, 237",
        rgbDark: "196, 181, 253"
    },
    aurora: {
        deep: "#7C3AED",
        mid: "#8B5CF6",
        light: "#C4B5FD",
        cinematicBase: "#2E1065"
    },
    page: {
        bgLight: "#FCFAFF",
        bgDark: "#100A1F",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #C4B5FD 0%, #7C3AED 100%)",
        "linear-gradient(135deg, #A78BFA 0%, #6D28D9 100%)",
        "linear-gradient(135deg, #8B5CF6 0%, #2E1065 100%)",
        "linear-gradient(135deg, #C4B5FD 0%, #6D28D9 100%)",
        "linear-gradient(135deg, #A78BFA 0%, #5B21B6 100%)",
        "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)"
    ]
};
