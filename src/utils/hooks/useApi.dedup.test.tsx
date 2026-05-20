import environment from "../../constants/env";

import { resetInFlightApiCallsForTests, api } from "./useApi";

const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    ({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    }) as unknown as Response;

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
});

afterAll(() => {
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch
    });
});

/**
 * In-flight de-duplication for the central `api()` helper.
 *
 * The FE fires the same READ request many times in a single render
 * burst (a board page mounts 3 components that each call
 * `useReactQuery("tasks", { projectId })`; the agent fan-out triggers
 * concurrent `listTasks` tool calls; etc.). The helper now coalesces
 * those onto a single fetch — but ONLY for idempotent reads
 * (GET / HEAD). Mutations (POST / PUT / DELETE / PATCH) always
 * round-trip so a double-click never silently merges two intentional
 * user actions.
 *
 * Coverage:
 *   - GET/HEAD: identical concurrent calls share one fetch.
 *   - GET/HEAD: distinct keys (endpoint, params, or token) do NOT share.
 *   - GET/HEAD: registry self-cleans on settle (fulfilled OR rejected).
 *   - GET/HEAD: rejection propagates to every coalesced caller.
 *   - POST / PUT / DELETE / PATCH: never coalesce, even with identical
 *     bodies — every call hits the wire.
 *   - `dedup: false`: explicit opt-out forces a fresh fetch.
 */

describe("api() in-flight dedup — GET / HEAD coalescing", () => {
    it("collapses N parallel identical GETs onto a single fetch", async () => {
        const N = 10;
        const d = deferred<Response>();
        fetchMock().mockReturnValueOnce(d.promise);

        const calls = Array.from({ length: N }, () =>
            api("projects", { method: "GET", data: { projectId: "p1" } })
        );

        // One fetch only. The other (N - 1) callers are riding the
        // same in-flight promise — no parallel network traffic.
        expect(fetchMock()).toHaveBeenCalledTimes(1);

        d.resolve(jsonResponse([{ _id: "p1" }]));
        const results = await Promise.all(calls);
        results.forEach((r) => expect(r).toEqual([{ _id: "p1" }]));
    });

    it("uses the URL exactly once across the burst", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ _id: "p1" }]));

        await Promise.all(
            Array.from({ length: 8 }, () =>
                api("projects", { method: "GET", data: { projectId: "p1" } })
            )
        );

        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(fetchMock().mock.calls[0][0]).toBe(
            `${environment.apiBaseUrl}/projects?projectId=p1`
        );
    });

    it("does NOT coalesce when query params differ", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        await Promise.all([
            api("projects", { method: "GET", data: { projectId: "p1" } }),
            api("projects", { method: "GET", data: { projectId: "p2" } })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it("does NOT coalesce when the endpoint differs", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        await Promise.all([
            api("projects", { method: "GET" }),
            api("boards", { method: "GET" }),
            api("tasks", { method: "GET" })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });

    it("coalesces identical GETs even though we no longer key on a bearer token", async () => {
        // The session identity moved from a JS-readable token (which
        // we used to fold into the dedup key) to an HttpOnly cookie
        // attached by ``credentials: "include"``. The browser carries
        // the same cookie for every concurrent request fired from one
        // tab, so two identical fetches racing in the same window are
        // always for the same viewer -- coalescing is safe.
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u" }));

        await Promise.all([
            api("users", { method: "GET" }),
            api("users", { method: "GET" }),
            api("users", { method: "GET" })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it("coalesces HEAD requests too", async () => {
        fetchMock().mockResolvedValue(jsonResponse({}));

        await Promise.all(
            Array.from({ length: 5 }, () =>
                api("agents/mutations/record", { method: "HEAD" })
            )
        );

        expect(fetchMock()).toHaveBeenCalledTimes(1);
    });
});

describe("api() in-flight dedup — registry self-cleans on settle", () => {
    it("fires a fresh fetch after the previous identical call resolves", async () => {
        fetchMock().mockResolvedValueOnce(jsonResponse([{ i: 0 }]));
        fetchMock().mockResolvedValueOnce(jsonResponse([{ i: 1 }]));

        const first = await api("projects", { method: "GET" });
        const second = await api("projects", { method: "GET" });

        expect(first).toEqual([{ i: 0 }]);
        expect(second).toEqual([{ i: 1 }]);
        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it("fires a fresh fetch after the previous identical call rejects", async () => {
        fetchMock().mockResolvedValueOnce(
            jsonResponse({ error: "boom" }, false, 500)
        );
        fetchMock().mockResolvedValueOnce(jsonResponse([{ i: 1 }]));

        await expect(api("projects", { method: "GET" })).rejects.toThrow(
            "boom"
        );
        const next = await api("projects", { method: "GET" });

        expect(next).toEqual([{ i: 1 }]);
        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it("propagates the underlying rejection to every coalesced caller", async () => {
        const N = 6;
        const d = deferred<Response>();
        fetchMock().mockReturnValueOnce(d.promise);

        const calls = Array.from({ length: N }, () =>
            api("projects", { method: "GET" })
        );
        expect(fetchMock()).toHaveBeenCalledTimes(1);

        d.resolve(jsonResponse({ error: "shared boom" }, false, 502));
        const settled = await Promise.allSettled(calls);
        settled.forEach((r) => {
            expect(r.status).toBe("rejected");
            const reason = (r as PromiseRejectedResult).reason as Error & {
                status?: number;
            };
            expect(reason.message).toBe("shared boom");
            expect(reason.status).toBe(502);
        });
    });

    it("propagates a network TypeError to every coalesced caller as the friendly message", async () => {
        const N = 4;
        fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

        const settled = await Promise.allSettled(
            Array.from({ length: N }, () => api("projects", { method: "GET" }))
        );
        expect(fetchMock()).toHaveBeenCalledTimes(1);
        settled.forEach((r) => {
            expect(r.status).toBe("rejected");
            expect(
                ((r as PromiseRejectedResult).reason as Error).message
            ).toMatch(/unable to connect/i);
        });
    });
});

describe("api() in-flight dedup — non-idempotent methods are NEVER coalesced", () => {
    it.each(["POST", "PUT", "DELETE", "PATCH"])(
        "fires every %s call to the wire, even with identical payloads",
        async (method) => {
            fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    api("tasks", {
                        method,
                        data: { _id: "t1", projectId: "p1" }
                    })
                )
            );

            expect(fetchMock()).toHaveBeenCalledTimes(5);
        }
    );

    it("does not dedup POST tasks even though the body is identical", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "t" }));

        const payload = { taskName: "Fix", projectId: "p1" };
        await Promise.all([
            api("tasks", { method: "POST", data: payload }),
            api("tasks", { method: "POST", data: payload })
        ]);

        // A user who double-taps Create wants two tasks, not one.
        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });
});

describe("api() in-flight dedup — opt-out via dedup: false", () => {
    it("forces a fresh fetch when dedup: false is supplied", async () => {
        const d1 = deferred<Response>();
        const d2 = deferred<Response>();
        fetchMock().mockReturnValueOnce(d1.promise);
        fetchMock().mockReturnValueOnce(d2.promise);

        const p1 = api("projects", { method: "GET" });
        const p2 = api("projects", { method: "GET", dedup: false });

        // The opt-out skips the in-flight registry and lands on its own
        // fetch, even though the first call is still pending.
        expect(fetchMock()).toHaveBeenCalledTimes(2);

        d1.resolve(jsonResponse([{ i: 1 }]));
        d2.resolve(jsonResponse([{ i: 2 }]));
        expect(await p1).toEqual([{ i: 1 }]);
        expect(await p2).toEqual([{ i: 2 }]);
    });

    it("explicit dedup: true is the same as the default for GETs", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        await Promise.all([
            api("projects", { method: "GET", dedup: true }),
            api("projects", { method: "GET", dedup: true })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it("explicit dedup: true on a POST is still ignored (mutations never coalesce)", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        await Promise.all([
            api("tasks", {
                method: "POST",
                data: { taskName: "x" },
                dedup: true
            }),
            api("tasks", {
                method: "POST",
                data: { taskName: "x" },
                dedup: true
            })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });
});

describe("api() in-flight dedup — realistic FE bursts", () => {
    it("collapses the 3-component board-page mount burst onto one /tasks fetch", async () => {
        // Simulates the board page where useDragEnd + TaskModal + BoardBriefDrawer
        // each independently call useReactQuery("tasks", { projectId }).
        fetchMock().mockResolvedValue(
            jsonResponse([{ _id: "t1", projectId: "p1" }])
        );

        await Promise.all([
            api("tasks", { method: "GET", data: { projectId: "p1" } }),
            api("tasks", { method: "GET", data: { projectId: "p1" } }),
            api("tasks", { method: "GET", data: { projectId: "p1" } })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(1);
        expect(fetchMock().mock.calls[0][0]).toContain("/tasks?projectId=p1");
    });

    it("collapses the agent-tool fan-out (listBoard + listTasks + listMembers across a turn)", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        // Two parallel listTasks calls for the same project (e.g. one
        // from the user's chat message + one from the cache warmer)
        // should collapse. listBoard for the same project also dedups.
        // listMembers (no data) on a separate endpoint is a third fetch.
        await Promise.all([
            api("tasks", { method: "GET", data: { projectId: "p1" } }),
            api("tasks", { method: "GET", data: { projectId: "p1" } }),
            api("boards", { method: "GET", data: { projectId: "p1" } }),
            api("boards", { method: "GET", data: { projectId: "p1" } }),
            api("users/members", { method: "GET" }),
            api("users/members", { method: "GET" })
        ]);

        // 3 unique tuples → 3 fetches, no matter how many subscribers.
        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });

    it("does NOT collapse a board page that loads tasks for two different projects", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        await Promise.all([
            api("tasks", { method: "GET", data: { projectId: "p1" } }),
            api("tasks", { method: "GET", data: { projectId: "p2" } })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(2);
    });

    it("does NOT collapse two reads separated by a mutation (cache-busting semantics intact)", async () => {
        fetchMock().mockResolvedValueOnce(jsonResponse([{ i: 0 }]));
        fetchMock().mockResolvedValueOnce(jsonResponse({ ok: true }));
        fetchMock().mockResolvedValueOnce(jsonResponse([{ i: 1 }]));

        const first = await api("projects", { method: "GET" });
        // A mutation lands between the two reads — it must not be
        // suppressed even if it shares the endpoint prefix.
        const mut = await api("projects", {
            method: "POST",
            data: { projectName: "X" }
        });
        const second = await api("projects", { method: "GET" });

        expect(first).toEqual([{ i: 0 }]);
        expect(mut).toEqual({ ok: true });
        expect(second).toEqual([{ i: 1 }]);
        expect(fetchMock()).toHaveBeenCalledTimes(3);
    });
});

describe("api() in-flight dedup — defaults treat missing method as GET", () => {
    it("dedups when method is omitted (default GET)", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ ok: true }]));

        await Promise.all([
            api("users/members"),
            api("users/members"),
            api("users/members")
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(1);
    });

    it("dedups across mixed-case method strings", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));

        await Promise.all([
            api("projects", { method: "get" }),
            api("projects", { method: "GET" }),
            api("projects", { method: "Get" })
        ]);

        expect(fetchMock()).toHaveBeenCalledTimes(1);
    });
});

describe("api() in-flight dedup — resetInFlightApiCallsForTests test helper", () => {
    it("drops every pending entry so the next call hits the wire", async () => {
        const d = deferred<Response>();
        fetchMock().mockReturnValueOnce(d.promise);
        fetchMock().mockResolvedValueOnce(jsonResponse([{ next: true }]));

        // First call is hanging on a pending deferred.
        const hanging = api("projects", { method: "GET" });

        resetInFlightApiCallsForTests();

        // After clearing, an identical call must issue a fresh fetch
        // rather than reuse the dead entry.
        const fresh = await api("projects", { method: "GET" });
        expect(fresh).toEqual([{ next: true }]);

        // Tidy up the hanging promise so we don't leak it across tests.
        d.resolve(jsonResponse([{ stale: true }]));
        await hanging;
    });
});
