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
 * `"auto"` ladder (highest priority first):
 *
 *   1. `prefers-reduced-transparency: reduce` is set at the OS level →
 *      `"solid"`. Belt-and-suspenders — `cssVars.ts` ALSO emits a
 *      media-query override that forces the var to `none`, but the
 *      data attribute keeps the global override rule in App.css active
 *      so any GlassPanel prop-driven blur is also wiped.
 *   2. `pointer: coarse` (the existing `usePointerCoarse` predicate
 *      consumed by `appProviders`) → `"solid"`. Mobile GPUs pay a
 *      noticeable cost for `backdrop-filter`; the product
 *      recommendation in the Wave 2 proposal is to default-off glass
 *      on coarse-pointer surfaces. Users on tablets with a stylus or
 *      magic-mouse setup can opt back in with an explicit `"clear"` /
 *      `"regular"` choice.
 *   3. Otherwise → `"regular"`.
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

const isBrowser = (): boolean => typeof window !== "undefined";

const queryMatches = (query: string): boolean => {
    if (!isBrowser() || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
};

/**
 * Picks an effective intensity from a stored preference plus the two
 * runtime media-query signals. Exposed (and exported) so the resolver
 * can be unit-tested without mounting a hook tree.
 */
export const resolveGlassIntensity = (
    preference: GlassIntensityPreference,
    reducedTransparency: boolean,
    pointerCoarse: boolean
): GlassIntensity => {
    // Explicit user choice wins — the toggle is the user's deliberate
    // override of the per-device default. "auto" is the only preference
    // that triggers the ladder.
    if (preference !== "auto") return preference;
    // OS-level reduced-transparency is an accessibility signal; respect
    // it even on desktop fine-pointer surfaces.
    if (reducedTransparency) return "solid";
    // Coarse pointer ≈ mobile / touch tablet; the GPU budget for
    // backdrop-filter is tight enough that the product recommendation
    // is to ship "solid" by default.
    if (pointerCoarse) return "solid";
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
        const onReduced = (event: MediaQueryListEvent) =>
            setReducedTransparency(event.matches);
        const onCoarse = (event: MediaQueryListEvent) =>
            setPointerCoarse(event.matches);
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
        addReduced();
        addCoarse();
        return () => {
            removeReduced();
            removeCoarse();
        };
    }, []);

    const effective = resolveGlassIntensity(
        preference,
        reducedTransparency,
        pointerCoarse
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
