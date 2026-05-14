import { microcopy } from "../constants/microcopy";

import {
    isNetworkFetchFailure,
    rewriteNetworkFetchError
} from "./networkFetchError";

describe("isNetworkFetchFailure", () => {
    it("matches TypeError with a 'failed to fetch' message", () => {
        expect(isNetworkFetchFailure(new TypeError("Failed to fetch"))).toBe(
            true
        );
        expect(
            isNetworkFetchFailure(
                new TypeError("NetworkError when attempting to fetch resource.")
            )
        ).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(isNetworkFetchFailure(new TypeError("FAILED TO FETCH"))).toBe(
            true
        );
    });

    it("rejects non-TypeError values", () => {
        expect(isNetworkFetchFailure(new Error("Failed to fetch"))).toBe(false);
        expect(isNetworkFetchFailure(null)).toBe(false);
        expect(isNetworkFetchFailure(undefined)).toBe(false);
        expect(isNetworkFetchFailure("Failed to fetch")).toBe(false);
        expect(isNetworkFetchFailure({})).toBe(false);
    });

    it("rejects TypeError whose message does not mention fetch", () => {
        expect(isNetworkFetchFailure(new TypeError("oops"))).toBe(false);
    });
});

describe("rewriteNetworkFetchError", () => {
    it("returns a new Error with the microcopy networkError message when input is a fetch failure", () => {
        const cause = new TypeError("Failed to fetch");
        const rewritten = rewriteNetworkFetchError(cause);
        expect(rewritten).toBeInstanceOf(Error);
        expect(rewritten?.message).toBe(microcopy.feedback.networkError);
        expect((rewritten as Error & { cause?: unknown }).cause).toBe(cause);
    });

    it("returns null for non-network errors", () => {
        expect(rewriteNetworkFetchError(new Error("HTTP 500"))).toBeNull();
        expect(rewriteNetworkFetchError(null)).toBeNull();
        expect(rewriteNetworkFetchError(undefined)).toBeNull();
        expect(rewriteNetworkFetchError("nope")).toBeNull();
    });
});
