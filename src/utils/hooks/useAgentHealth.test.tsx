import { renderHook, waitFor } from "@testing-library/react";

import { ANALYTICS_EVENTS, setAnalyticsSink } from "../../constants/analytics";
import useAgentHealth, {
    activeAgentHealthPollerCountForTests,
    agentHealthSubscriberCountForTests,
    resetAgentHealthForTests
} from "./useAgentHealth";

const okResponse = (data: unknown) =>
    ({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(data),
        text: jest.fn().mockResolvedValue(JSON.stringify(data)),
        headers: { get: () => null, has: () => false }
    }) as unknown as Response;

describe("useAgentHealth", () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch");
        // The poller is module-singleton; reset between tests so leftover
        // state from a previous case can't bleed into the next.
        resetAgentHealthForTests();
    });

    afterEach(() => {
        fetchSpy.mockRestore();
        jest.useRealTimers();
        resetAgentHealthForTests();
    });

    it("reports offline when baseUrl is omitted (does not fetch)", () => {
        const { result } = renderHook(() => useAgentHealth());
        expect(result.current.status).toBe("offline");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports offline when baseUrl is empty (does not fetch)", () => {
        const { result } = renderHook(() => useAgentHealth(""));
        expect(result.current.status).toBe("offline");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports ok after a successful health probe", async () => {
        fetchSpy.mockResolvedValue(
            okResponse({ ok: true, agentsLoaded: 1, latencyMs: 50 })
        );
        const { result } = renderHook(() =>
            useAgentHealth("https://agents.example", { intervalMs: 60_000 })
        );
        await waitFor(() => {
            expect(result.current.status).toBe("ok");
        });
        expect(result.current.latencyMs).toBeLessThanOrEqual(1500);
        expect(result.current.lastChecked).not.toBeNull();
    });

    it("shares one poller across consumers with the same baseUrl + interval", async () => {
        fetchSpy.mockResolvedValue(okResponse({ ok: true, latencyMs: 50 }));
        // Mount the hook twice — header + chat drawer pattern in the app.
        const header = renderHook(() =>
            useAgentHealth("https://agents.example", {
                intervalMs: 60_000,
                agentName: "header"
            })
        );
        const drawer = renderHook(() =>
            useAgentHealth("https://agents.example", {
                intervalMs: 60_000,
                agentName: "chat-agent"
            })
        );
        await waitFor(() => {
            expect(header.result.current.status).toBe("ok");
            expect(drawer.result.current.status).toBe("ok");
        });
        // Both consumers should observe the same probe — at most one fetch.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(activeAgentHealthPollerCountForTests()).toBe(1);
        expect(
            agentHealthSubscriberCountForTests("https://agents.example", 60_000)
        ).toBe(2);

        // Unmounting one consumer must NOT tear the poller down — the other
        // is still subscribed.
        drawer.unmount();
        expect(activeAgentHealthPollerCountForTests()).toBe(1);
        expect(
            agentHealthSubscriberCountForTests("https://agents.example", 60_000)
        ).toBe(1);

        // The last unmount tears the singleton down so a future mount
        // starts from a clean slate.
        header.unmount();
        expect(activeAgentHealthPollerCountForTests()).toBe(0);
    });

    it("reports offline on a network error", async () => {
        fetchSpy.mockRejectedValue(new TypeError("net down"));
        const { result } = renderHook(() =>
            useAgentHealth("https://agents.example", { intervalMs: 60_000 })
        );
        await waitFor(() => {
            expect(result.current.status).toBe("offline");
        });
    });

    describe("AGENT_HEALTH_DEGRADED analytics", () => {
        afterEach(() => {
            // Restore the analytics sink after each analytics test so other
            // tests aren't affected.
        });

        it("fires AGENT_HEALTH_DEGRADED once when status transitions to degraded", async () => {
            // Simulate a slow (degraded) response.
            fetchSpy.mockResolvedValue(
                okResponse({ ok: true, latencyMs: 2000 })
            );
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            try {
                const { result } = renderHook(() =>
                    useAgentHealth("https://agents.example", {
                        intervalMs: 60_000,
                        agentName: "board-coach"
                    })
                );
                await waitFor(() => {
                    expect(result.current.status).toBe("degraded");
                });
                // Wait for the analytics useEffect to fire after state settles.
                await waitFor(() => {
                    expect(
                        tracked.filter(
                            ([e]) =>
                                e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
                        )
                    ).toHaveLength(1);
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const degradedCalls = tracked.filter(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
            );
            expect(degradedCalls[0][1]).toEqual({
                status: "degraded",
                agentName: "board-coach"
            });
        });

        it("fires AGENT_HEALTH_DEGRADED once when status transitions to offline", async () => {
            fetchSpy.mockRejectedValue(new TypeError("net down"));
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            try {
                const { result } = renderHook(() =>
                    useAgentHealth("https://agents.example", {
                        intervalMs: 60_000,
                        agentName: "board-coach"
                    })
                );
                await waitFor(() => {
                    expect(result.current.status).toBe("offline");
                });
                await waitFor(() => {
                    expect(
                        tracked.filter(
                            ([e]) =>
                                e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
                        )
                    ).toHaveLength(1);
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const degradedCalls = tracked.filter(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
            );
            expect(degradedCalls[0][1]).toMatchObject({
                status: "offline",
                agentName: "board-coach"
            });
        });

        it("does NOT fire AGENT_HEALTH_DEGRADED when status is ok", async () => {
            fetchSpy.mockResolvedValue(okResponse({ ok: true, latencyMs: 50 }));
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            try {
                const { result } = renderHook(() =>
                    useAgentHealth("https://agents.example", {
                        intervalMs: 60_000,
                        agentName: "board-coach"
                    })
                );
                // Wait for status to stabilise at "ok".
                await waitFor(() => {
                    expect(result.current.status).toBe("ok");
                });
                // Give effects time to settle — no AGENT_HEALTH_DEGRADED should fire.
                await waitFor(() => {
                    expect(result.current.lastChecked).not.toBeNull();
                });
            } finally {
                setAnalyticsSink(previous);
            }

            const degradedCalls = tracked.filter(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
            );
            expect(degradedCalls).toHaveLength(0);
        });

        it("does NOT fire AGENT_HEALTH_DEGRADED again when degraded status stays degraded", async () => {
            // Both fetches return slow (degraded).
            fetchSpy.mockResolvedValue(
                okResponse({ ok: true, latencyMs: 2000 })
            );
            const tracked: Array<
                [string, Record<string, unknown> | undefined]
            > = [];
            const previous = setAnalyticsSink((event, payload) => {
                tracked.push([event, payload]);
            });
            try {
                jest.useFakeTimers();
                const { result } = renderHook(() =>
                    useAgentHealth("https://agents.example", {
                        intervalMs: 5_000,
                        agentName: "board-coach"
                    })
                );
                // Wait for first degraded status and event.
                await waitFor(() => {
                    expect(result.current.status).toBe("degraded");
                });
                await waitFor(() => {
                    expect(
                        tracked.filter(
                            ([e]) =>
                                e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
                        )
                    ).toHaveLength(1);
                });
                // Tick to trigger a second poll that also returns degraded.
                jest.advanceTimersByTime(5_000);
                await waitFor(() => {
                    expect(fetchSpy).toHaveBeenCalledTimes(2);
                });
            } finally {
                setAnalyticsSink(previous);
                jest.useRealTimers();
            }

            const degradedCalls = tracked.filter(
                ([e]) => e === ANALYTICS_EVENTS.AGENT_HEALTH_DEGRADED
            );
            // Should only fire once for the first transition, not again when
            // consecutive polls keep returning degraded.
            expect(degradedCalls).toHaveLength(1);
        });
    });
});
