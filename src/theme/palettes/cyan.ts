import type { Palette } from "./types";

/**
 * Deep cyan + arctic mist. Crisp, fresh, infrastructure-grade (think
 * observability dashboards). Cool blue-green, clearly apart from emerald.
 */
export const cyanPalette: Palette = {
    name: "cyan",
    brand: {
        primary: "#0891B2",
        primaryHover: "#0E7490",
        primaryActive: "#155E75",
        primaryBg: "#ECFEFF",
        primaryBgDark: "#083344",
        primaryDark: "#67E8F9"
    },
    accent: {
        start: "#0891B2",
        end: "#06B6D4",
        rgb: "8, 145, 178",
        rgbDark: "103, 232, 249"
    },
    aurora: {
        deep: "#0891B2",
        mid: "#06B6D4",
        light: "#67E8F9",
        cinematicBase: "#083344"
    },
    page: {
        bgLight: "#F8FDFE",
        bgDark: "#07111A",
        textLight: "rgba(15, 23, 42, 0.92)",
        textDark: "rgba(229, 231, 235, 0.92)"
    },
    avatarGradients: [
        "linear-gradient(135deg, #67E8F9 0%, #0891B2 100%)",
        "linear-gradient(135deg, #22D3EE 0%, #0E7490 100%)",
        "linear-gradient(135deg, #06B6D4 0%, #083344 100%)",
        "linear-gradient(135deg, #67E8F9 0%, #0E7490 100%)",
        "linear-gradient(135deg, #22D3EE 0%, #155E75 100%)",
        "linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)"
    ]
};
