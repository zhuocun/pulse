/**
 * Platform detection utilities shared across the application.
 */

/**
 * Mac/iOS detection. Prefers the modern `userAgentData` API; falls back to
 * the legacy `navigator.platform` for browsers that haven't shipped it yet
 * (Firefox, Safari ≤16). Wrapped in a function so SSR / Jest envs without
 * `navigator` short-circuit to false.
 */
export const isMacLike = (): boolean => {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & {
        userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    return /Mac|iPod|iPhone|iPad/i.test(platform);
};
