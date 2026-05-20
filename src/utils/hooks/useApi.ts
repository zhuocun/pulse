import qs from "qs";
import { useCallback } from "react";

import environment from "../../constants/env";

import extractErrorMessage from "../extractErrorMessage";
import { parseFetchBody } from "../parseFetchBody";
import { rewriteNetworkFetchError } from "../networkFetchError";

import useAuth from "./useAuth";

interface IConfig extends RequestInit {
    data?: object;
    token?: string | null;
    /**
     * Opt out of in-flight de-duplication. By default identical
     * concurrent GET / HEAD calls coalesce onto a single fetch; pass
     * `dedup: false` to force a fresh round-trip even when another
     * caller's request is mid-flight (e.g. an explicit "refresh" button).
     * Non-idempotent methods (POST / PUT / DELETE / PATCH) are never
     * deduped — see comment on `isIdempotentRead` below.
     */
    dedup?: boolean;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Test-only: drop every pending in-flight entry. Production code must
 * not call this — the registry is self-cleaning when a promise settles.
 */
export const resetInFlightApiCallsForTests = (): void => {
    inFlight.clear();
};

const buildDedupKey = (
    endpoint: string,
    method: string,
    data: object | undefined,
    token: string | null | undefined
): string =>
    // Token is part of the identity: a logout / login mid-burst MUST
    // start a new fetch rather than handing viewer A's response to
    // viewer B. JSON.stringify is stable for plain data objects sent
    // by FE call-sites; the helper never receives Maps/Sets/Dates here.
    `${method} ${endpoint} ${token ?? ""} ${JSON.stringify(data ?? {})}`;

const performFetch = async (
    endpoint: string,
    { data, token, dedup: _dedup, ...customConfig }: IConfig
): Promise<unknown> => {
    let apiEndpoint = endpoint;
    const headers: Record<string, string> = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (data) {
        headers["Content-Type"] = "application/json";
    }
    const config = {
        method: "GET",
        headers,
        ...customConfig
    };

    if (
        config.method.toUpperCase() === "GET" ||
        config.method.toUpperCase() === "DELETE"
    ) {
        const qsString = qs.stringify(data ?? {});
        if (qsString) {
            apiEndpoint += `?${qsString}`;
        }
    } else {
        config.body = JSON.stringify(data);
    }

    let res: Response;
    try {
        res = await fetch(`${environment.apiBaseUrl}/${apiEndpoint}`, config);
    } catch (err) {
        const rewritten = rewriteNetworkFetchError(err);
        if (rewritten) {
            return Promise.reject(rewritten);
        }
        throw err;
    }
    const resData = await parseFetchBody(res);
    if (res.ok) {
        return resData;
    }
    const error = new Error(
        extractErrorMessage(resData) ?? "Operation failed"
    ) as Error & { status?: number };
    // Surface the HTTP status so callers (notably `useAuth.refreshUser`) can
    // tell a real 401 from a transient network / 5xx failure. The fallback
    // message text alone is unreliable — the backend's 401 body is
    // `{"error": "empty JWT"}` etc., which the message extractor surfaces
    // as "empty JWT" and the previous regex-on-message check missed.
    error.status = res.status;
    return Promise.reject(error);
};

export const api = (
    endpoint: string,
    config: IConfig = {}
): Promise<unknown> => {
    const method = (config.method ?? "GET").toString().toUpperCase();
    // Only idempotent reads coalesce. POST / PUT / DELETE / PATCH all
    // mutate server state, so a rapid double-tap on "Create" must hit
    // the backend twice — collapsing them would silently drop user
    // actions and confuse optimistic-update rollback.
    const isIdempotentRead = method === "GET" || method === "HEAD";
    const dedupEnabled = config.dedup !== false && isIdempotentRead;
    if (!dedupEnabled) {
        return performFetch(endpoint, config);
    }
    const key = buildDedupKey(endpoint, method, config.data, config.token);
    const existing = inFlight.get(key);
    if (existing) {
        return existing;
    }
    const promise = performFetch(endpoint, config);
    inFlight.set(key, promise);
    // Self-cleaning registry. Attach the cleanup BEFORE returning so
    // the handler is registered first and runs before any awaiter's
    // continuation — the inFlight entry is gone by the time the
    // caller observes the result. Use a handler pair (not `.finally`)
    // so the cleanup branch never produces an unhandled rejection on
    // its own; the original promise's rejection still propagates to
    // the caller via the returned reference.
    promise.then(
        () => {
            inFlight.delete(key);
        },
        () => {
            inFlight.delete(key);
        }
    );
    return promise;
};

const useApi = () => {
    const { user, token } = useAuth();
    return useCallback(
        (...[endpoint, config]: Parameters<typeof api>) =>
            api(endpoint, {
                ...config,
                token: user?.jwt ?? token
            }),
        [token, user?.jwt]
    );
};

export default useApi;
