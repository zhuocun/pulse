import { useLayoutEffect } from "react";
import { useSelector } from "react-redux";

import type { RootState } from "../../store";
import type { ColorThemePreference } from "../../store/reducers/userPreferencesSlice";
import {
    defaultPaletteName,
    getPalette,
    paletteToCss,
    type Palette
} from "../../theme/palettes";

/**
 * Runtime colour-theme resolver. Reads the user's stored
 * `colorTheme` (palette name) from the slice, resolves it to the matching
 * `Palette` object, and re-renders that palette's CSS custom properties
 * into the `#pulse-theme-vars` style element `index.tsx` seeded with the
 * orange default before first paint. Returns the resolved palette for any
 * caller that needs the concrete `Palette` object (the styled-component
 * tokens read the `--pulse-*` vars this renders).
 *
 * Mirrors `useGlassIntensity` but without the media-query ladder: a
 * colour theme is a pure user choice with no OS-level signal that should
 * override it, so there's nothing to subscribe to — just the slice value.
 *
 * `useLayoutEffect` (not `useEffect`) so the var swap lands BEFORE the
 * browser paints. Without it the first frame after a switch would show
 * the previous palette's vars for one tick — a visible colour flash on
 * every chrome surface that reads a `--pulse-*` var.
 *
 * Cleanup restores the orange default rather than deleting the element:
 * the `#pulse-theme-vars` block is load-bearing for the whole app's
 * colour identity, so dropping it on a mid-session unmount (a future
 * hot-reload boundary, a test teardown) would strand every styled
 * component at its bare `var()` fallback. Restoring the default keeps the
 * app coherently themed.
 */
const STYLE_ELEMENT_ID = "pulse-theme-vars";

const usePaletteTheme = (): Palette => {
    const name = useSelector<RootState, ColorThemePreference>(
        (state) => state.userPreferences.colorTheme
    );
    const selected = getPalette(name);

    useLayoutEffect(() => {
        if (typeof document === "undefined") return;
        const css = paletteToCss(selected);
        let el = document.getElementById(
            STYLE_ELEMENT_ID
        ) as HTMLStyleElement | null;
        if (el) {
            el.textContent = css;
        } else {
            // Defensive: index.tsx seeds this element synchronously before
            // React mounts, so it should always be present. Re-create it
            // (rather than no-op) so a host that mounts this hook into a
            // DOM without the seed — a unit test, a detached render root —
            // still gets a themed surface.
            el = document.createElement("style");
            el.id = STYLE_ELEMENT_ID;
            el.textContent = css;
            document.head.appendChild(el);
        }
        return () => {
            const node = document.getElementById(
                STYLE_ELEMENT_ID
            ) as HTMLStyleElement | null;
            if (node) {
                node.textContent = paletteToCss(getPalette(defaultPaletteName));
            }
        };
    }, [selected]);

    return selected;
};

export default usePaletteTheme;
