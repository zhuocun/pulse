/**
 * Platform detection utilities shared across the application.
 */

/**
 * Mac/iOS detection. Prefers the modern `userAgentData` API; falls back to
 * the legacy `navigator.platform` for browsers that haven't shipped it yet
 * (Firefox, Safari ≤16); finally falls back to scanning `navigator.userAgent`.
 * The UA fallback covers post-iOS-17 / 18+ builds where `navigator.platform`
 * has been observed to come back as an empty string on iPhone — the previous
 * platform-only check would then mis-classify iPhone as non-Mac-like. Wrapped
 * in a function so SSR / Jest envs without `navigator` short-circuit to false.
 */
export const isMacLike = (): boolean => {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & {
        userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    if (/Mac|iPod|iPhone|iPad/i.test(platform)) return true;
    const ua = nav.userAgent ?? "";
    return /iPhone|iPad|iPod/i.test(ua);
};
