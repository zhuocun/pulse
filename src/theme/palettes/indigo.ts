import type { Palette } from "./types";

/**
 * Electric indigo + cool porcelain. The Linear / Vercel "default modern SaaS"
 * accent — confident, technical, calm. Indigo-600 anchors CTAs and AI surfaces.
 */
export const indigoPalette: Palette = {
    name: "indigo",
    brand: {
        primary: "#4F46E5",
        primaryHover: "#4338CA",
        primaryActive: "#3730A3",
        primaryBg: "#EEF2FF",
        primaryBgDark: "#1E1B4B",
        primaryDark: "#A5B4FC"
    },
    accent: {
        start: "#4F46E5",
        end: "#6366F1",
        rgb: "79, 70, 229",
        rgbDark: "165, 180, 252"
    },
    aurora: {
        deep: "#4F46E5",
        mid: "#6366F1",
        light: "#A5B4FC",
        cinematicBase: "#1E1B4B"
    },
    page: {
        bgLight: "#FAFAFE",
        bgDark: "#0C0D1A",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #A5B4FC 0%, #4F46E5 100%)",
        "linear-gradient(135deg, #818CF8 0%, #4338CA 100%)",
        "linear-gradient(135deg, #6366F1 0%, #1E1B4B 100%)",
        "linear-gradient(135deg, #A5B4FC 0%, #4338CA 100%)",
        "linear-gradient(135deg, #818CF8 0%, #3730A3 100%)",
        "linear-gradient(135deg, #6366F1 0%, #4338CA 100%)"
    ]
};
