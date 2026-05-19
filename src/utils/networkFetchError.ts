import { microcopy } from "../constants/microcopy";

/**
 * `fetch()` rejects with a `TypeError` on offline / DNS / CORS failures,
 * but the message differs by engine — Chrome / Firefox surface
 * "Failed to fetch" / "NetworkError when attempting to fetch", whereas
 * Safari (desktop and mobile WebKit) raises "Load failed" or
 * "The network connection was lost." with no "fetch" substring. Recognise
 * the Safari shapes too so the user sees the friendly network microcopy
 * on iOS Safari instead of a raw `TypeError`. Shared with `useApi` and
 * direct `fetch` call sites (AI) so user-visible errors stay consistent.
 */
const NETWORK_FAILURE_PATTERNS = [
    "fetch",
    "load failed",
    "network connection",
    "networkerror"
];

export const isNetworkFetchFailure = (err: unknown): boolean => {
    if (!(err instanceof TypeError)) return false;
    const message = err.message.toLowerCase();
    return NETWORK_FAILURE_PATTERNS.some((pattern) =>
        message.includes(pattern)
    );
};

export const rewriteNetworkFetchError = (err: unknown): Error | null => {
    if (isNetworkFetchFailure(err)) {
        return new Error(microcopy.feedback.networkError, { cause: err });
    }
    return null;
};
