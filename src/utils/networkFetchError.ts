import { microcopy } from "../constants/microcopy";

/**
 * `fetch()` rejects with `TypeError("Failed to fetch")` on offline / DNS /
 * CORS failures. Shared with `useApi` and direct `fetch` call sites (AI)
 * so user-visible errors stay consistent.
 */
export const isNetworkFetchFailure = (err: unknown): boolean =>
    err instanceof TypeError && err.message.toLowerCase().includes("fetch");

export const rewriteNetworkFetchError = (err: unknown): Error | null => {
    if (isNetworkFetchFailure(err)) {
        return new Error(microcopy.feedback.networkError, { cause: err });
    }
    return null;
};
