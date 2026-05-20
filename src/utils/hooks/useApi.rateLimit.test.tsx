import {
    ApiRateLimitError,
    api,
    resetApiRateLimitForTests,
    resetInFlightApiCallsForTests,
    restoreApiRateLimitDefaultsForTests,
    setApiRateLimitConfigForTests
} from "./useApi";

const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    ({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    }) as unknown as Response;

let warnSpy: jest.SpyInstance;

beforeAll(() => {
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: jest.fn()
    });
});

beforeEach(() => {
    fetchMock().mockReset();
    resetInFlightApiCallsForTests();
    resetApiRateLimitForTests();
    // Tighten the limiter so tests don't need to fire 11 calls — 3 is
    // enough to demonstrate the trip semantics.
    setApiRateLimitConfigForTests({ windowMs: 2000, threshold: 3 });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    warnSpy.mockRestore();
    restoreApiRateLimitDefaultsForTests();
});

afterAll(() => {
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch
    });
});

/**
 * Sliding-window rate limiter for the `api()` helper.
 *
 * Layered on top of in-flight dedup. The dedup map only catches
 * *concurrent* duplicates (a render burst, a parallel agent fan-out).
 * The limiter catches *serial* duplicates — the bug pattern where the
 * same call keeps firing after each previous one settles, e.g. a
 * `useEffect` with a missing dependency, a stuck `setInterval`, or
 * an agent loop that re-issues the same tool call indefinitely.
 *
 * Defaults (tunable via test helpers):
 *   - window: 2000 ms
 *   - threshold: 10 calls per key per window
 *
 * In these tests we lower the threshold to 3 for compactness.
 */

describe("ApiRateLimitError shape", () => {
    it("carries the key, count, window, and status=429", () => {
        const err = new ApiRateLimitError("GET projects ", 11, 2000);
        expect(err.name).toBe("ApiRateLimitError");
        expect(err.key).toBe("GET projects ");
        expect(err.callCount).toBe(11);
        expect(err.windowMs).toBe(2000);
        expect(err.status).toBe(429);
        expect(err.message).toMatch(/11 identical calls in 2000ms/);
        expect(err.message).toMatch(/runaway loop/i);
    });
});

describe("api() rate limiter — basic trip semantics", () => {
    it("allows up to THRESHOLD identical sequential calls", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        // Threshold is 3 — three sequential identical GETs must all succeed.
        for (let i = 0; i < 3; i++) {
            await api("projects", { method: "GET" });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });

    it("rejects the (THRESHOLD + 1)-th identical sequential call", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        for (let i = 0; i < 3; i++) {
            await api("projects", { method: "GET" });
        }
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );

        // The rejected call never reached the wire.
        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });

    it("emits a console.warn exactly once when the key first trips", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        for (let i = 0; i < 3; i++) {
            await api("projects", { method: "GET" });
        }
        await api("projects", { method: "GET" }).catch(() => undefined);
        await api("projects", { method: "GET" }).catch(() => undefined);
        await api("projects", { method: "GET" }).catch(() => undefined);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/runaway loop/i);
        expect(warnSpy.mock.calls[0][0]).toMatch(/GET projects/);
    });

    it("the rejection error includes a useful diagnostic message", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        for (let i = 0; i < 3; i++) {
            await api("tasks", { method: "GET", data: { projectId: "p1" } });
        }
        try {
            await api("tasks", { method: "GET", data: { projectId: "p1" } });
            throw new Error("should have rejected");
        } catch (err) {
            expect(err).toBeInstanceOf(ApiRateLimitError);
            const rl = err as ApiRateLimitError;
            expect(rl.key).toContain("tasks");
            expect(rl.key).toContain('"projectId":"p1"');
            expect(rl.callCount).toBe(4);
            expect(rl.status).toBe(429);
        }
    });
});

describe("api() rate limiter — keys are partitioned by all four facets", () => {
    it("does NOT count distinct endpoints against each other", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // Two calls each to four different endpoints = 8 calls but each
        // key has only 2 timestamps — well below the threshold of 3.
        for (let i = 0; i < 2; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" });
            // eslint-disable-next-line no-await-in-loop
            await api("boards", { method: "GET" });
            // eslint-disable-next-line no-await-in-loop
            await api("tasks", { method: "GET" });
            // eslint-disable-next-line no-await-in-loop
            await api("users/members", { method: "GET" });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(8);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does NOT count distinct params against each other", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // 10 distinct projectIds — each is its own key, none trips.
        for (let i = 0; i < 10; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("tasks", {
                method: "GET",
                data: { projectId: `p${i}` }
            });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(10);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("treats three serial GETs with no per-call auth as one key under the limit", async () => {
        // Pre-cookie this test used four distinct bearer tokens to
        // verify per-viewer keying. With cookie auth the FE no longer
        // sees the token at all, so the key collapses to (method,
        // endpoint, data). The test-mode threshold is 3, so three
        // calls is the highest "fine" count before the limiter trips.
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));

        for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await api("users", { method: "GET" });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(3);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("counts identical (endpoint, method, params, token) tuples together", async () => {
        fetchMock().mockResolvedValue(jsonResponse({}));

        // Different methods on the same endpoint are distinct keys.
        await api("tasks", { method: "GET", data: { _id: "t1" } });
        await api("tasks", { method: "GET", data: { _id: "t1" } });
        await api("tasks", { method: "GET", data: { _id: "t1" } });

        // Threshold for the GET key reached, next GET trips.
        await expect(
            api("tasks", { method: "GET", data: { _id: "t1" } })
        ).rejects.toBeInstanceOf(ApiRateLimitError);

        // But a PUT with the same body has a different key and is fine.
        await expect(
            api("tasks", { method: "PUT", data: { _id: "t1" } })
        ).resolves.toBeDefined();
    });
});

describe("api() rate limiter — applies to mutations too", () => {
    it("trips on a stuck PUT loop with identical body", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("tasks", {
                method: "PUT",
                data: { _id: "t1", projectId: "p1", storyPoints: 5 }
            });
        }
        await expect(
            api("tasks", {
                method: "PUT",
                data: { _id: "t1", projectId: "p1", storyPoints: 5 }
            })
        ).rejects.toBeInstanceOf(ApiRateLimitError);
    });

    it("does NOT trip on a rapid mutation burst with varying bodies", async () => {
        fetchMock().mockResolvedValue(jsonResponse({}));

        // A user genuinely creates 20 tasks in a row — distinct names
        // produce distinct keys, the limiter never engages.
        for (let i = 0; i < 20; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("tasks", {
                method: "POST",
                data: { taskName: `Task ${i}`, projectId: "p1" }
            });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(20);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe("api() rate limiter — opt-out via rateLimit: false", () => {
    it("never trips when rateLimit: false is set", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        for (let i = 0; i < 20; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET", rateLimit: false });
        }

        expect(fetchMock()).toHaveBeenCalledTimes(20);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("the opt-out call doesn't consume budget against future limited calls", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // 100 unrated calls — same key but rateLimit: false.
        for (let i = 0; i < 100; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET", rateLimit: false });
        }

        // A subsequent rate-limited call should still see a clean budget.
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" });
        }
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );

        // Only the 3 budgeted calls counted; opt-out calls didn't.
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});

describe("api() rate limiter — window pruning", () => {
    it("recovers after timestamps age out of the window", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // Use a tiny window for this test so we can mock Date.now.
        setApiRateLimitConfigForTests({ windowMs: 100, threshold: 3 });
        const nowSpy = jest.spyOn(Date, "now");

        nowSpy.mockReturnValue(1_000);
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" });

        // Trip the limit at T=1000.
        nowSpy.mockReturnValue(1_001);
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );

        // Advance past the window — all four prior timestamps age out.
        nowSpy.mockReturnValue(1_500);
        await expect(api("projects", { method: "GET" })).resolves.toBeDefined();

        nowSpy.mockRestore();
    });

    it("warns again after a key has recovered and re-trips", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        setApiRateLimitConfigForTests({ windowMs: 100, threshold: 2 });
        const nowSpy = jest.spyOn(Date, "now");

        // First hot burst.
        nowSpy.mockReturnValue(1_000);
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" }).catch(() => undefined);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        // Window passes, key cools off.
        nowSpy.mockReturnValue(2_000);
        await api("projects", { method: "GET" });

        // Second hot burst — warning fires again.
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" }).catch(() => undefined);
        expect(warnSpy).toHaveBeenCalledTimes(2);

        nowSpy.mockRestore();
    });
});

describe("api() rate limiter — interaction with dedup", () => {
    it("a concurrent burst that coalesces consumes only ONE budget slot", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // 50 simultaneous identical GETs. Dedup collapses them onto a
        // single fetch — and onto a single rate-limit timestamp.
        await Promise.all(
            Array.from({ length: 50 }, () => api("projects", { method: "GET" }))
        );

        // One fetch, one timestamp consumed — limiter not tripped.
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();

        // The next two sequential calls still fit in the budget (1 + 2 = 3
        // at threshold), but the 4th must trip.
        await api("projects", { method: "GET" });
        await api("projects", { method: "GET" });
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );
    });

    it("serial bursts on the same key DO trip even though each burst dedups", async () => {
        // Simulates the runaway-loop scenario: each fetch resolves
        // synchronously, then the next render fires the same call again.
        // Dedup can't help because there's no in-flight overlap.
        fetchMock().mockResolvedValue(jsonResponse([]));

        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" });
        }
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );
        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });
});

describe("api() rate limiter — failure modes", () => {
    it("counts failed fetches toward the budget (a 500-spamming loop is also a bug)", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse({ error: "boom" }, false, 500)
        );

        // Three identical failing GETs eat the budget — the fourth trips.
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" }).catch(() => undefined);
        }
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );
    });

    it("counts network failures toward the budget", async () => {
        fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" }).catch(() => undefined);
        }
        await expect(api("projects", { method: "GET" })).rejects.toBeInstanceOf(
            ApiRateLimitError
        );
    });

    it("rate-limited rejections never hit the wire", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            await api("projects", { method: "GET" });
        }

        const callsBefore = fetchMock().mock.calls.length;
        await api("projects", { method: "GET" }).catch(() => undefined);
        await api("projects", { method: "GET" }).catch(() => undefined);
        await api("projects", { method: "GET" }).catch(() => undefined);

        expect(fetchMock().mock.calls.length).toBe(callsBefore);
    });
});

describe("api() rate limiter — production-shaped runaway scenarios", () => {
    it("blocks a 100-iteration synchronous loop after THRESHOLD passes through", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        let succeeded = 0;
        let rateLimited = 0;
        let otherErrors = 0;

        for (let i = 0; i < 100; i++) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await api("tasks", {
                    method: "GET",
                    data: { projectId: "p1" }
                });
                succeeded += 1;
            } catch (err) {
                if (err instanceof ApiRateLimitError) rateLimited += 1;
                else otherErrors += 1;
            }
        }

        expect(succeeded).toBe(3); // threshold from beforeEach
        expect(rateLimited).toBe(97);
        expect(otherErrors).toBe(0);
        // Only the 3 budgeted calls hit the wire — the rest were
        // rejected before they could leave the FE.
        expect(fetchMock()).toHaveBeenCalledTimes(3);
        // One warning for the entire hot episode (not 97).
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("the agent-loop pattern (await-then-fire-again) is bounded after THRESHOLD", async () => {
        // Simulates an AI agent that, on every result, re-fires the same
        // tool call. Each iteration awaits the previous, so dedup
        // doesn't catch it — but the rate limiter does.
        fetchMock().mockResolvedValue(jsonResponse([{ _id: "t1" }]));

        const ITERATIONS = 50;
        let networkCalls = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await api("tasks", {
                    method: "GET",
                    data: { projectId: "p1" }
                });
                networkCalls += 1;
            } catch {
                // Rate limited — stop after the agent sees an error.
                break;
            }
        }

        // The agent gets through `threshold` calls before the limiter
        // throws and breaks the loop.
        expect(networkCalls).toBe(3);
        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });
});
