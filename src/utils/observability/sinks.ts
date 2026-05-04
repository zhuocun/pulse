/**
 * Production-ready analytics and error reporting sinks (PRD v3 §10, X-R15).
 *
 * Two concrete sinks are exported here:
 *
 * - `httpAnalyticsSink` — batches analytics events and POSTs to a
 *   configurable endpoint with `keepalive: true`. Includes `engineMode`
 *   on every event so the metrics pipeline can segment local vs. remote
 *   AI usage without each call site needing to know.
 *
 * - `httpErrorSink` — POSTs single error events for production error
 *   reporting. Can be wired to Sentry, PostHog, or an in-house endpoint
 *   without any SDK dependency.
 *
 * Neither sink throws — failures are swallowed after one retry, keeping the
 * product UX unaffected if the observability endpoint is unreachable.
 *
 * No third-party SDKs (posthog-js, @sentry/react, etc.) are required.
 * The endpoint is configured via VITE_ANALYTICS_ENDPOINT /
 * VITE_ERROR_REPORT_ENDPOINT at deploy time.
 */

import type { AnalyticsEvent, AnalyticsSink } from "../../constants/analytics";

// ---------------------------------------------------------------------------
// Analytics sink
// ---------------------------------------------------------------------------

interface BatchedEvent {
    event: AnalyticsEvent;
    payload?: Record<string, unknown>;
    ts: number;
}

interface HttpAnalyticsSinkOptions {
    /** Full URL to POST batches to, e.g. "https://t.example.com/ingest". */
    endpoint: string;
    /** Maximum events per batch POST. Defaults to 20. */
    batchSize?: number;
    /** How often to flush the buffer in ms. Defaults to 5000. */
    flushIntervalMs?: number;
    /** Injected at call time — mirrors `environment.aiUseLocalEngine`. */
    engineMode: "local" | "remote";
}

const tryUnref = (timer: ReturnType<typeof setInterval>): void => {
    if (timer && typeof timer === "object" && "unref" in (timer as object)) {
        (timer as unknown as { unref: () => void }).unref();
    }
};

/**
 * Build a batching analytics sink that POSTs `{events: [...]}` to the
 * given endpoint. Events are held in an in-memory buffer; the buffer flushes
 * when it reaches `batchSize` or after `flushIntervalMs`, whichever comes
 * first. The browser `keepalive` flag ensures the last batch fires even
 * during page unload.
 */
export const httpAnalyticsSink = ({
    endpoint,
    batchSize = 20,
    flushIntervalMs = 5000,
    engineMode
}: HttpAnalyticsSinkOptions): AnalyticsSink => {
    const buffer: BatchedEvent[] = [];

    const flush = async () => {
        if (buffer.length === 0) return;
        const batch = buffer.splice(0, buffer.length);
        const tryPost = async (attempt: number): Promise<void> => {
            try {
                const enriched = batch.map((e) => ({
                    ...e,
                    engineMode
                }));
                await fetch(endpoint, {
                    body: JSON.stringify({ events: enriched }),
                    headers: { "Content-Type": "application/json" },
                    keepalive: true,
                    method: "POST"
                });
            } catch {
                if (attempt < 1) {
                    // One retry before dropping.
                    await tryPost(attempt + 1);
                }
                // Drop on second failure — never throw from a sink.
            }
        };
        void tryPost(0);
    };

    if (typeof setInterval !== "undefined") {
        const timer = setInterval(() => {
            void flush();
        }, flushIntervalMs);
        // Allow the timer to be GC'd if the module is hot-replaced in tests.
        tryUnref(timer);
    }

    return (event, payload) => {
        buffer.push({ event, payload, ts: Date.now() });
        if (buffer.length >= batchSize) {
            void flush();
        }
    };
};

// ---------------------------------------------------------------------------
// Error sink
// ---------------------------------------------------------------------------

interface HttpErrorSinkOptions {
    /** Full URL to POST error events to. */
    endpoint: string;
}

export interface ErrorEvent {
    message: string;
    stack?: string;
    componentStack?: string;
    url: string;
    userAgent: string;
    ts: number;
}

export type ErrorSink = (event: ErrorEvent) => void;

/**
 * Build an error-reporting sink that POSTs a single `ErrorEvent` JSON object
 * to the given endpoint. One retry on failure; drops silently after that.
 */
export const httpErrorSink = ({
    endpoint
}: HttpErrorSinkOptions): ErrorSink => {
    const tryPost = async (
        event: ErrorEvent,
        attempt: number
    ): Promise<void> => {
        try {
            await fetch(endpoint, {
                body: JSON.stringify(event),
                headers: { "Content-Type": "application/json" },
                keepalive: true,
                method: "POST"
            });
        } catch {
            if (attempt < 1) {
                await tryPost(event, attempt + 1);
            }
            // Drop on second failure.
        }
    };

    return (event) => {
        void tryPost(event, 0);
    };
};

// ---------------------------------------------------------------------------
// In-memory dev sink (window.__copilotEvents__)
// ---------------------------------------------------------------------------

type DevEventRecord = {
    event: AnalyticsEvent;
    payload?: Record<string, unknown>;
    ts: number;
};

declare global {
    interface Window {
        // eslint-disable-next-line no-underscore-dangle
        __copilotEvents__?: DevEventRecord[];
    }
}

/**
 * A no-op analytics sink that also stores events in
 * `window.__copilotEvents__` when running in a DEV build. QA can inspect
 * `window.__copilotEvents__` in the browser console to verify event
 * instrumentation without a real backend.
 */
export const devMemorySink = (): AnalyticsSink => {
    const events: DevEventRecord[] = [];
    if (typeof window !== "undefined") {
        // eslint-disable-next-line no-underscore-dangle
        window.__copilotEvents__ = events;
    }
    return (event, payload) => {
        events.push({ event, payload, ts: Date.now() });
    };
};

/** Active error sink (module-level so index.tsx can call `setErrorSink`). */
let activeErrorSink: ErrorSink | null = null;

export const setErrorSink = (sink: ErrorSink | null): void => {
    activeErrorSink = sink;
};

export const reportError = (
    event: Omit<ErrorEvent, "url" | "userAgent" | "ts">
): void => {
    if (!activeErrorSink) return;
    try {
        activeErrorSink({
            ...event,
            url: typeof window !== "undefined" ? window.location.href : "",
            userAgent:
                typeof navigator !== "undefined" ? navigator.userAgent : "",
            ts: Date.now()
        });
    } catch {
        // Error sinks must never propagate.
    }
};
