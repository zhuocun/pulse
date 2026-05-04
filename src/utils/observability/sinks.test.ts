/**
 * Tests for the production observability sinks (Fix 5).
 */
import {
    devMemorySink,
    httpAnalyticsSink,
    httpErrorSink,
    reportError,
    setErrorSink
} from "./sinks";

describe("httpAnalyticsSink", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
            ok: true,
            status: 200
        } as Response);
        jest.useFakeTimers();
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        jest.useRealTimers();
    });

    it("flushes when batchSize is reached", async () => {
        const sink = httpAnalyticsSink({
            endpoint: "https://analytics.example/ingest",
            batchSize: 2,
            flushIntervalMs: 60000,
            engineMode: "local"
        });

        sink("agent.turn.started");
        sink("agent.turn.completed");

        // Allow promises to flush.
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).toHaveBeenCalledWith(
            "https://analytics.example/ingest",
            expect.objectContaining({
                method: "POST",
                keepalive: true
            })
        );

        const body = JSON.parse(
            (fetchSpy.mock.calls[0][1] as { body: string }).body
        ) as { events: unknown[] };
        expect(body.events).toHaveLength(2);
        // Each event should carry engineMode
        expect((body.events[0] as { engineMode?: string }).engineMode).toBe(
            "local"
        );
    });

    it("flushes on timer interval", async () => {
        const sink = httpAnalyticsSink({
            endpoint: "https://analytics.example/ingest",
            batchSize: 100,
            flushIntervalMs: 1000,
            engineMode: "remote"
        });

        sink("agent.turn.started", { agent: "board-coach" });

        expect(fetchSpy).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("drops events silently after two fetch failures", async () => {
        fetchSpy.mockRejectedValue(new Error("Network error"));

        const sink = httpAnalyticsSink({
            endpoint: "https://analytics.example/ingest",
            batchSize: 1,
            flushIntervalMs: 60000,
            engineMode: "local"
        });

        // Should not throw.
        expect(() => {
            sink("agent.turn.started");
        }).not.toThrow();

        // Wait for retry logic to complete.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Fetch was called (at least once, up to twice on retry), but no
        // error propagated.
        expect(fetchSpy).toHaveBeenCalled();
    });

    it("includes engineMode=remote on every event", async () => {
        const sink = httpAnalyticsSink({
            endpoint: "https://analytics.example/ingest",
            batchSize: 1,
            flushIntervalMs: 60000,
            engineMode: "remote"
        });

        sink("copilot.chat.send", { agent: "chat" });

        await Promise.resolve();
        await Promise.resolve();

        const body = JSON.parse(
            (fetchSpy.mock.calls[0][1] as { body: string }).body
        ) as { events: unknown[] };
        expect((body.events[0] as { engineMode?: string }).engineMode).toBe(
            "remote"
        );
    });
});

describe("httpErrorSink", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
            ok: true,
            status: 200
        } as Response);
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it("POSTs an error event to the configured endpoint", async () => {
        const sink = httpErrorSink({ endpoint: "https://errors.example" });

        sink({
            message: "Something broke",
            stack: "Error: Something broke\n  at ...",
            componentStack: "at Component",
            url: "https://app.example/board",
            userAgent: "Mozilla/5.0",
            ts: 1000
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).toHaveBeenCalledWith(
            "https://errors.example",
            expect.objectContaining({
                method: "POST",
                keepalive: true
            })
        );
        const body = JSON.parse(
            (fetchSpy.mock.calls[0][1] as { body: string }).body
        ) as { message?: string };
        expect(body.message).toBe("Something broke");
    });

    it("retries once on failure and then drops", async () => {
        fetchSpy.mockRejectedValue(new Error("net error"));

        const sink = httpErrorSink({ endpoint: "https://errors.example" });
        expect(() =>
            sink({
                message: "err",
                url: "",
                userAgent: "",
                ts: 0
            })
        ).not.toThrow();

        // Wait for retry chain.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchSpy).toHaveBeenCalled();
    });
});

describe("devMemorySink", () => {
    it("stores events in window.__copilotEvents__", () => {
        const sink = devMemorySink();
        sink("agent.turn.started", { foo: "bar" });

        // eslint-disable-next-line no-underscore-dangle
        const stored = window.__copilotEvents__;
        expect(Array.isArray(stored)).toBe(true);
        expect(stored).toHaveLength(1);
    });
});

describe("reportError", () => {
    afterEach(() => {
        setErrorSink(null);
    });

    it("calls the registered error sink with url and userAgent", () => {
        const mockSink = jest.fn();
        setErrorSink(mockSink);

        reportError({ message: "Render failed", stack: "Error: ..." });

        expect(mockSink).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "Render failed",
                stack: "Error: ...",
                url: expect.any(String),
                userAgent: expect.any(String),
                ts: expect.any(Number)
            })
        );
    });

    it("is a no-op when no sink is registered", () => {
        setErrorSink(null);
        // Should not throw.
        expect(() => reportError({ message: "err" })).not.toThrow();
    });
});
