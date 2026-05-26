import type { Palette } from "./types";

/**
 * Vivid rose + blush porcelain. Warm, energetic, editorial — distinct from the
 * orange default by leaning crimson/magenta. Feels bold and human.
 */
export const rosePalette: Palette = {
    name: "rose",
    brand: {
        primary: "#E11D48",
        primaryHover: "#BE123C",
        primaryActive: "#9F1239",
        primaryBg: "#FFF1F2",
        primaryBgDark: "#4C0519",
        primaryDark: "#FDA4AF"
    },
    accent: {
        start: "#E11D48",
        end: "#F43F5E",
        rgb: "225, 29, 72",
        rgbDark: "253, 164, 175"
    },
    aurora: {
        deep: "#E11D48",
        mid: "#F43F5E",
        light: "#FDA4AF",
        cinematicBase: "#4C0519"
    },
    page: {
        bgLight: "#FFFAFB",
        bgDark: "#1A0A0E",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #FDA4AF 0%, #E11D48 100%)",
        "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)",
        "linear-gradient(135deg, #F43F5E 0%, #4C0519 100%)",
        "linear-gradient(135deg, #FDA4AF 0%, #BE123C 100%)",
        "linear-gradient(135deg, #FB7185 0%, #9F1239 100%)",
        "linear-gradient(135deg, #F43F5E 0%, #BE123C 100%)"
    ]
};
