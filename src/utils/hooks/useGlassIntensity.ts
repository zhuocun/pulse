import { useEffect, useLayoutEffect, useState } from "react";
import { useSelector } from "react-redux";

import type { RootState } from "../../store";
import type { GlassIntensityPreference } from "../../store/reducers/userPreferencesSlice";

/**
 * Phase 5 "Liquid Glass" Wave 2 T4 — the runtime resolver that turns the
 * user's stored choice into the effective glass intensity and writes it
 * to `<html data-glass-intensity="…">` so the corresponding CSS-var
 * override in `cssVars.ts` flips every glass surface in one shot.
 *
 * Resolved intensity values are the three discrete CSS-keyed states:
 *
 *   - `"clear"`   → most translucent (low surface opacity, modest blur)
 *   - `"regular"` → default (balanced legibility / show-through)
 *   - `"solid"`   → opaque opt-out (blur disabled, glass disappears)
 *
 * The slice value (`GlassIntensityPreference`) carries one extra option:
 *
 *   - `"auto"` → defer to the runtime ladder below
 *
 * Phase 6 Wave 1 — the resolver ladder was tightened in two ways from
 * the Phase 5 Wave 2 T4 baseline:
 *
 *   1. The coarse-pointer "auto" default flipped from `"solid"` to
 *      `"regular"`. iOS 26 chrome upgrades are invisible on mobile when
 *      the default is solid; flipping to regular makes the Liquid Glass
 *      treatment the default mobile experience. Existing users keep
 *      Solid via a one-shot migration in `userPreferencesSlice` keyed
 *      on `glassIntensityVersion`, so nobody is surprised by the flip.
 *   2. `forced-colors: active` (Windows high-contrast) and
 *      `prefers-reduced-transparency: reduce` now step down EXPLICIT
 *      user picks (`"clear"` / `"regular"`) to `"solid"`, not just the
 *      `"auto"` ladder. Accessibility signals from the OS must win
 *      regardless of the user's stored choice — a user who picked
 *      `"clear"` for desktop and then switched to a high-contrast
 *      profile should not be stranded with translucent chrome.
 *
 * Resolution priority (highest first):
 *
 *   1. `forced-colors: active` → `"solid"` (regardless of preference).
 *      Previously a CSS-only fallback at `glassPanel/index.tsx:194` —
 *      now centralized in the resolver so every consumer of
 *      `useGlassIntensity` sees the same value.
 *   2. `prefers-reduced-transparency: reduce` → `"solid"` (regardless of
 *      preference). Belt-and-suspenders with the media-query override
 *      in `cssVars.ts` that pins the chrome CSS-var to `none`.
 *   3. User explicit pick (`"clear"` | `"regular"` | `"solid"`) → that
 *      value. The toggle is the user's deliberate per-session override.
 *   4. `"auto"` + `(pointer: coarse)` → `"regular"`. Phase 6 default;
 *      iOS 26 chrome is the default mobile experience.
 *   5. `"auto"` + fine pointer (desktop) → `"regular"`.
 *
 * The hook uses `useLayoutEffect` to write the data attribute before
 * the browser paints — without it, the first frame would render at the
 * default `"regular"` intensity even when the user (or the device
 * cues) demanded `"solid"`. The cleanup path restores `"regular"` so
 * a mid-session hook unmount can't strand the document at the previous
 * resolved value.
 *
 * The returned value is the EFFECTIVE intensity (one of the three
 * resolved states), not the raw preference, so callers that need to
 * branch on what's actually on the page (analytics, screenshot tests,
 * fallback logic) get the answer directly.
 */
export type GlassIntensity = "clear" | "regular" | "solid";

const REDUCED_TRANSPARENCY_QUERY = "(prefers-reduced-transparency: reduce)";
const POINTER_COARSE_QUERY = "(pointer: coarse)";
const FORCED_COLORS_QUERY = "(forced-colors: active)";

const isBrowser = (): boolean => typeof window !== "undefined";

const queryMatches = (query: string): boolean => {
    if (!isBrowser() || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
};

/**
 * Picks an effective intensity from a stored preference plus the three
 * runtime media-query signals. Exposed (and exported) so the resolver
 * can be unit-tested without mounting a hook tree.
 *
 * Phase 6 Wave 1 ladder (highest priority first):
 *
 *   1. `forced-colors: active` → `"solid"` (regardless of preference).
 *      Windows high-contrast mode replaces every author colour with
 *      system tokens; translucent surfaces paint the system Canvas
 *      through them and become invisible. Centralizes the CSS-only
 *      fallback that previously lived only in `glassPanel`.
 *   2. `prefers-reduced-transparency: reduce` → `"solid"` (regardless
 *      of preference). Belt-and-suspenders with the media-query
 *      override in `cssVars.ts`. A user who picked `"clear"` for
 *      desktop and switched into a reduced-transparency profile must
 *      not be stranded with translucent chrome.
 *   3. User explicit pick (`"clear"` | `"regular"` | `"solid"`) → that
 *      value. The toggle is the user's deliberate per-session
 *      override of the heuristic auto ladder.
 *   4. `"auto"` + `(pointer: coarse)` → `"regular"`. Phase 6 default
 *      flip; iOS-26 chrome is the default mobile experience. Existing
 *      users keep Solid via the `glassIntensityVersion` migration in
 *      `userPreferencesSlice`.
 *   5. `"auto"` + fine pointer (desktop) → `"regular"`.
 *
 * `forcedColors` is the fourth parameter and defaults to `false` so
 * existing call-sites that pass only three arguments (legacy code,
 * analytics, screenshot harnesses) keep working unchanged.
 */
export const resolveGlassIntensity = (
    preference: GlassIntensityPreference,
    reducedTransparency: boolean,
    pointerCoarse: boolean,
    forcedColors: boolean = false
): GlassIntensity => {
    // Forced-colors mode (Windows high-contrast) replaces every author
    // colour with system tokens; a translucent surface paints the
    // system Canvas through it and becomes invisible. Step down to
    // solid regardless of the user's stored pick — the OS signal wins.
    if (forcedColors) return "solid";
    // OS-level reduced-transparency is an accessibility signal that
    // must beat the user's explicit choice. A user who picked "clear"
    // for desktop and then switched into a reduced-transparency
    // profile (cognitive accessibility, motion sensitivity) should
    // not be left with translucent chrome.
    if (reducedTransparency) return "solid";
    // Explicit user choice wins over the heuristic auto ladder.
    // "auto" is the only preference that triggers the pointer/density
    // branch below.
    if (preference !== "auto") return preference;
    // Coarse pointer ≈ mobile / touch tablet. Phase 6 Wave 1 flipped
    // this from "solid" to "regular": iOS-26 chrome upgrades were
    // invisible on mobile under the old default. Existing users keep
    // Solid via the glassIntensityVersion migration in the slice, so
    // nobody is surprised by the flip.
    if (pointerCoarse) return "regular";
    return "regular";
};

/**
 * Reads the user's chosen intensity from the slice, watches the two
 * relevant media queries, writes the resolved value to
 * `html[data-glass-intensity="…"]`, and returns the resolved value.
 */
const useGlassIntensity = (): GlassIntensity => {
    const preference = useSelector<RootState, GlassIntensityPreference>(
        (state) => state.userPreferences.glassIntensity
    );

    const [reducedTransparency, setReducedTransparency] = useState<boolean>(
        () => queryMatches(REDUCED_TRANSPARENCY_QUERY)
    );
    const [pointerCoarse, setPointerCoarse] = useState<boolean>(() =>
        queryMatches(POINTER_COARSE_QUERY)
    );
    const [forcedColors, setForcedColors] = useState<boolean>(() =>
        queryMatches(FORCED_COLORS_QUERY)
    );

    // Subscribe to live media-query changes so flipping a system
    // preference (or rotating a 2-in-1 between touch and trackpad)
    // re-resolves the intensity without a full reload. We deliberately
    // use `useEffect` (not `useLayoutEffect`) for the subscription —
    // the listener fires on the next event loop tick, not on first
    // paint, so a passive effect is enough.
    useEffect(() => {
        if (!isBrowser() || typeof window.matchMedia !== "function") return;
        const reducedMedia = window.matchMedia(REDUCED_TRANSPARENCY_QUERY);
        const coarseMedia = window.matchMedia(POINTER_COARSE_QUERY);
        const forcedColorsMedia = window.matchMedia(FORCED_COLORS_QUERY);
        const onReduced = (event: MediaQueryListEvent) =>
            setReducedTransparency(event.matches);
        const onCoarse = (event: MediaQueryListEvent) =>
            setPointerCoarse(event.matches);
        const onForced = (event: MediaQueryListEvent) =>
            setForcedColors(event.matches);
        const addReduced =
            typeof reducedMedia.addEventListener === "function"
                ? () => reducedMedia.addEventListener("change", onReduced)
                : () => reducedMedia.addListener(onReduced);
        const removeReduced =
            typeof reducedMedia.removeEventListener === "function"
                ? () => reducedMedia.removeEventListener("change", onReduced)
                : () => reducedMedia.removeListener(onReduced);
        const addCoarse =
            typeof coarseMedia.addEventListener === "function"
                ? () => coarseMedia.addEventListener("change", onCoarse)
                : () => coarseMedia.addListener(onCoarse);
        const removeCoarse =
            typeof coarseMedia.removeEventListener === "function"
                ? () => coarseMedia.removeEventListener("change", onCoarse)
                : () => coarseMedia.removeListener(onCoarse);
        const addForced =
            typeof forcedColorsMedia.addEventListener === "function"
                ? () => forcedColorsMedia.addEventListener("change", onForced)
                : () => forcedColorsMedia.addListener(onForced);
        const removeForced =
            typeof forcedColorsMedia.removeEventListener === "function"
                ? () =>
                      forcedColorsMedia.removeEventListener("change", onForced)
                : () => forcedColorsMedia.removeListener(onForced);
        addReduced();
        addCoarse();
        addForced();
        return () => {
            removeReduced();
            removeCoarse();
            removeForced();
        };
    }, []);

    const effective = resolveGlassIntensity(
        preference,
        reducedTransparency,
        pointerCoarse,
        forcedColors
    );

    // useLayoutEffect so the attribute is in place BEFORE the browser
    // paints. Without it the first frame would render at the default
    // "regular" var value even when the user picked "solid", causing
    // a one-frame flash of the wrong glass.
    useLayoutEffect(() => {
        if (typeof document === "undefined") return;
        document.documentElement.dataset.glassIntensity = effective;
        // Clean up on unmount so a host that mounts and unmounts this
        // hook (tests, a future hot-reload boundary) can't strand the
        // attribute at the last resolved value. The default ("regular")
        // matches the :root CSS-var fallback.
        return () => {
            if (typeof document === "undefined") return;
            delete document.documentElement.dataset.glassIntensity;
        };
    }, [effective]);

    return effective;
};

export default useGlassIntensity;
