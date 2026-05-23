import { useEffect, useState } from "react";

/**
 * Source of truth for "should this surface show the phone chassis?"
 *
 * Single predicate consumed by both `Header` (to demote the right-cluster
 * account / theme / AI controls) and `MainLayout` (to mount the
 * `<BottomTabBar />` and reserve body padding-bottom for it). Aligning
 * these two surfaces on one predicate fixes a pair of mismatches present
 * before this hook landed:
 *
 *   - Touchscreen laptop / Surface (>= md width, coarse pointer):
 *     header right-cluster was hidden by `@media (pointer: coarse)` while
 *     the bar gate (`Grid.useBreakpoint().md === false`) refused to mount
 *     the bar. Result: logout / theme / AI controls were unreachable.
 *   - Small narrow-window non-touch laptop (md=false, fine pointer):
 *     the bar mounted (width-only check) while the header right-cluster
 *     remained visible (coarse-only check). Result: duplicated controls.
 *
 * `pointer: coarse` is the primary signal because it tracks the user's
 * actual input modality. Width-only checks misclassify both touchscreen
 * laptops (where the bar is the right call) and narrow desktop windows
 * (where the header dropdown is the right call). We intentionally accept
 * the consequence that a phone in landscape orientation > 768 px wide
 * still gets the phone chrome — that's the correct call for the chassis,
 * since the user is still tapping with a thumb.
 *
 * Server-side and jsdom render paths return `false` (the desktop chrome)
 * so the test default is the legacy layout; tests that exercise the
 * coarse branch mock `window.matchMedia` to return `matches: true`.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

const readCoarsePointer = (): boolean => {
    if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
    )
        return false;
    return window.matchMedia(COARSE_POINTER_QUERY).matches;
};

const useIsPhoneChrome = (): boolean => {
    const [isCoarse, setIsCoarse] = useState<boolean>(() =>
        readCoarsePointer()
    );

    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const media = window.matchMedia(COARSE_POINTER_QUERY);
        const handler = (event: MediaQueryListEvent) => {
            setIsCoarse(event.matches);
        };
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        // Safari < 14 / older WebKit: legacy addListener / removeListener.
        media.addListener(handler);
        return () => media.removeListener(handler);
    }, []);

    return isCoarse;
};

export default useIsPhoneChrome;
