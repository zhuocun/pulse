import qs from "qs";
import { useCallback } from "react";

import environment from "../../constants/env";

import extractErrorMessage from "../extractErrorMessage";
import { parseFetchBody } from "../parseFetchBody";
import { rewriteNetworkFetchError } from "../networkFetchError";

interface IConfig extends RequestInit {
    data?: object;
    /**
     * Opt out of in-flight de-duplication. By default identical
     * concurrent GET / HEAD calls coalesce onto a single fetch; pass
     * `dedup: false` to force a fresh round-trip even when another
     * caller's request is mid-flight (e.g. an explicit "refresh" button).
     * Non-idempotent methods (POST / PUT / DELETE / PATCH) are never
     * deduped — see comment on `isIdempotentRead` below.
     */
    dedup?: boolean;
    /**
     * Opt out of the sliding-window rate limiter. Identical calls
     * keyed on (method, endpoint, token, params) trip the limiter
     * when they exceed `RATE_LIMIT_THRESHOLD` within
     * `RATE_LIMIT_WINDOW_MS`. Pass `rateLimit: false` for known-hot
     * legitimate paths where this guard would be a footgun.
     */
    rateLimit?: boolean;
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
    data: object | undefined
): string =>
    // With cookie-based REST auth the session identity is on the
    // request implicitly (the browser attaches the HttpOnly ``Token``
    // cookie for every same-origin call). Login / logout each pivot
    // the URL into and out of the auth-required tree, which restarts
    // the React Query observers and reissues the dedup keys, so a
    // stale viewer-A response can no longer race in front of viewer
    // B without going through a route change first.
    `${method} ${endpoint} ${JSON.stringify(data ?? {})}`;

/**
 * Sliding-window rate limiter for the central `api()` helper.
 *
 * The dedup layer above collapses *concurrent* identical calls onto a
 * single fetch. That defends against render-burst duplicates but does
 * NOT defend against a real bug: a `useEffect` with the wrong deps, a
 * stuck `setInterval`, or an agent loop that re-fires the same call
 * after each response settles. Those issue serial calls that the
 * dedup map can't see (each one starts after the previous resolves).
 *
 * The limiter tracks call timestamps per dedup key over a rolling
 * window. Once a key crosses the threshold inside the window, every
 * further call rejects with `ApiRateLimitError` until enough
 * timestamps age out. It also `console.warn`s once per key per hot
 * episode so the underlying bug surfaces loudly during development.
 *
 * Tunables (intentionally module-private; tests override via the
 * `setApiRateLimitConfigForTests` helper):
 *   - WINDOW_MS: how long a timestamp counts toward the budget.
 *   - THRESHOLD: how many calls per key are allowed inside one window.
 */
let RATE_LIMIT_WINDOW_MS = 2000;
let RATE_LIMIT_THRESHOLD = 10;

const callTimestamps = new Map<string, number[]>();
const warnedKeys = new Set<string>();

export class ApiRateLimitError extends Error {
    readonly status = 429;

    constructor(
        readonly key: string,
        readonly callCount: number,
        readonly windowMs: number
    ) {
        super(
            `API rate limit exceeded: ${callCount} identical calls in ${windowMs}ms ` +
                `for ${key}. Likely a runaway loop — check effect dependency ` +
                `arrays at the call-site.`
        );
        this.name = "ApiRateLimitError";
    }
}

const recordCallAndCheckRateLimit = (
    key: string,
    now: number
): ApiRateLimitError | null => {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const entries = (callTimestamps.get(key) ?? []).filter((t) => t > cutoff);
    entries.push(now);

    if (entries.length > RATE_LIMIT_THRESHOLD) {
        callTimestamps.set(key, entries);
        if (!warnedKeys.has(key)) {
            warnedKeys.add(key);
            // eslint-disable-next-line no-console
            console.warn(
                `[api] Possible runaway loop: ${entries.length} identical calls to ` +
                    `\`${key}\` within ${RATE_LIMIT_WINDOW_MS}ms. Throttling further ` +
                    `calls until the burst subsides. Inspect the call-site's effect ` +
                    `dependency array, polling timer, or agent loop.`
            );
        }
        return new ApiRateLimitError(key, entries.length, RATE_LIMIT_WINDOW_MS);
    }

    // We're back below threshold — clear the "warned" flag so the next
    // time the same key crosses, we warn again rather than going silent.
    warnedKeys.delete(key);
    if (entries.length === 0) {
        callTimestamps.delete(key);
    } else {
        callTimestamps.set(key, entries);
    }
    return null;
};

/** Test-only: drop the rate-limit registry between cases. */
export const resetApiRateLimitForTests = (): void => {
    callTimestamps.clear();
    warnedKeys.clear();
};

/** Test-only: tweak the window / threshold so tests don't need to fire 11+ calls. */
export const setApiRateLimitConfigForTests = (
    config: Partial<{ windowMs: number; threshold: number }>
): void => {
    if (typeof config.windowMs === "number") {
        RATE_LIMIT_WINDOW_MS = config.windowMs;
    }
    if (typeof config.threshold === "number") {
        RATE_LIMIT_THRESHOLD = config.threshold;
    }
};

/** Test-only: restore the production tunables after a test override. */
export const restoreApiRateLimitDefaultsForTests = (): void => {
    RATE_LIMIT_WINDOW_MS = 2000;
    RATE_LIMIT_THRESHOLD = 10;
};

const performFetch = async (
    endpoint: string,
    { data, dedup: _dedup, rateLimit: _rateLimit, ...customConfig }: IConfig
): Promise<unknown> => {
    let apiEndpoint = endpoint;
    const headers: Record<string, string> = {};
    if (data) {
        headers["Content-Type"] = "application/json";
    }
    const config: RequestInit = {
        method: "GET",
        headers,
        // Same-origin in prod (Vercel rewrite) and dev (Vite proxy) so
        // the browser auto-attaches the HttpOnly ``Token`` session
        // cookie issued by ``POST /auth/login``. ``"include"`` is
        // belt-and-braces: explicit at the call site, and a no-op for
        // the same-origin path that the fetch default would have
        // covered anyway. Kept explicit so a future tweak that points
        // `apiBaseUrl` at an absolute URL (in a fork, a Storybook,
        // a preview-of-a-preview) does not silently drop the cookie.
        credentials: "include",
        ...customConfig
    };

    const method = (config.method ?? "GET").toString().toUpperCase();
    if (method === "GET" || method === "DELETE") {
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
    const key = buildDedupKey(endpoint, method, config.data);

    // Only idempotent reads coalesce. POST / PUT / DELETE / PATCH all
    // mutate server state, so a rapid double-tap on "Create" must hit
    // the backend twice — collapsing them would silently drop user
    // actions and confuse optimistic-update rollback.
    const isIdempotentRead = method === "GET" || method === "HEAD";
    const dedupEnabled = config.dedup !== false && isIdempotentRead;

    if (dedupEnabled) {
        const existing = inFlight.get(key);
        if (existing) {
            // A concurrent burst — share the in-flight promise. We
            // intentionally DO NOT count coalesced callers toward the
            // rate limit; only network round-trips matter, and the
            // burst is collapsing onto a single one.
            return existing;
        }
    }

    if (config.rateLimit !== false) {
        const rateLimitErr = recordCallAndCheckRateLimit(key, Date.now());
        if (rateLimitErr) {
            return Promise.reject(rateLimitErr);
        }
    }

    const promise = performFetch(endpoint, config);

    if (dedupEnabled) {
        inFlight.set(key, promise);
        // Self-cleaning registry. Attach the cleanup BEFORE returning
        // so the handler is registered first and runs before any
        // awaiter's continuation — the inFlight entry is gone by the
        // time the caller observes the result. Use a handler pair
        // (not `.finally`) so the cleanup branch never produces an
        // unhandled rejection on its own; the original promise's
        // rejection still propagates to the caller via the returned
        // reference.
        promise.then(
            () => {
                inFlight.delete(key);
            },
            () => {
                inFlight.delete(key);
            }
        );
    }

    return promise;
};

const useApi = () => {
    // No per-request auth wiring: the session cookie rides every
    // same-origin request automatically. Kept as a hook (vs. a plain
    // export of ``api``) so we can swap the transport in tests and so
    // call sites that compose other request-time concerns later have
    // a single seam to bolt onto.
    return useCallback(
        (...[endpoint, config]: Parameters<typeof api>) =>
            api(endpoint, config),
        []
    );
};

export default useApi;
