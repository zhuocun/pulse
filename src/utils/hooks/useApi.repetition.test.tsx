import environment from "../../constants/env";

import { api } from "./useApi";

const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    Promise.resolve({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    } as unknown as Response);

beforeAll(() => {
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: jest.fn()
    });
});

beforeEach(() => {
    fetchMock().mockReset();
});

afterAll(() => {
    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch
    });
});

/**
 * Repetition / concurrency stress coverage for the central `api()` helper.
 *
 * The FE fires the same endpoint dozens of times per session — board page
 * polls, optimistic mutation retries, drag-and-drop re-orderings, AI tool
 * calls. None of those should leak state across invocations or interfere
 * with one another.
 *
 * The tests below pound the helper with high counts (sequential and
 * parallel) and verify:
 *
 *   - Every call lands on `fetch` with the expected URL/method/body.
 *   - No headers, tokens, or payloads bleed from one call into the next.
 *   - Promise ordering matches mock ordering (FIFO, no implicit dedup).
 *   - Mixed success / failure responses each propagate to the matching
 *     caller without cross-contamination.
 */
const REPEAT = 50;

describe("api() repetition — sequential GETs", () => {
    it("dispatches every call exactly once with the right URL", async () => {
        const responses = Array.from({ length: REPEAT }, (_, i) => [{ i }]);
        responses.forEach((body) =>
            fetchMock().mockResolvedValueOnce(jsonResponse(body))
        );

        const results: unknown[] = [];
        for (let i = 0; i < REPEAT; i++) {
            results.push(
                await api("projects", {
                    method: "GET",
                    data: { page: i }
                })
            );
        }

        expect(fetchMock()).toHaveBeenCalledTimes(REPEAT);
        results.forEach((r, i) => expect(r).toEqual([{ i }]));
        fetchMock().mock.calls.forEach((call, i) => {
            expect(call[0]).toContain(
                `${environment.apiBaseUrl}/projects?page=${i}`
            );
        });
    });

    it("does not leak headers between successive calls", async () => {
        // Two GETs with no body and one POST with a body. Auth is on
        // the cookie now -- no Authorization header is ever
        // constructed -- so headers come down to the JSON content
        // type, present only when there is a body to send.
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        await api("users", { method: "GET" });
        await api("users", { method: "GET" });
        await api("tasks", {
            method: "POST",
            data: { taskName: "x" }
        });

        const headers1 = fetchMock().mock.calls[0][1]?.headers;
        const headers2 = fetchMock().mock.calls[1][1]?.headers;
        const headers3 = fetchMock().mock.calls[2][1]?.headers;

        expect(headers1).toEqual({});
        expect(headers2).toEqual({});
        expect(headers3).toEqual({ "Content-Type": "application/json" });
    });
});

describe("api() repetition — parallel mutations", () => {
    it("fires N parallel POSTs and resolves each with its own payload", async () => {
        const N = 25;
        for (let i = 0; i < N; i++) {
            fetchMock().mockResolvedValueOnce(jsonResponse({ index: i }));
        }

        const calls = Array.from({ length: N }, (_, i) =>
            api("tasks", {
                method: "POST",
                data: {
                    taskName: `Task ${i}`,
                    projectId: "p1",
                    columnId: "c1",
                    coordinatorId: "u1",
                    type: "Task",
                    epic: "Epic",
                    storyPoints: 1,
                    note: `Note ${i}`
                }
            })
        );

        const results = await Promise.all(calls);

        expect(fetchMock()).toHaveBeenCalledTimes(N);
        // Promises resolve in mock-order (mockResolvedValueOnce queue is FIFO),
        // and the parallel call dispatch follows code order, so the indices
        // line up.
        results.forEach((r, i) => expect(r).toEqual({ index: i }));
        // Each call carried a distinct `taskName` in its body.
        const bodies = fetchMock().mock.calls.map((c) =>
            JSON.parse((c[1] as RequestInit).body as string)
        );
        const names = bodies.map((b) => b.taskName).sort();
        expect(names).toEqual(
            Array.from({ length: N }, (_, i) => `Task ${i}`).sort()
        );
    });

    it("propagates mixed success/failure to the matching caller", async () => {
        // Pattern: success, failure, success, failure ...
        const pattern = Array.from({ length: 10 }, (_, i) => i % 2 === 0);
        pattern.forEach((ok, i) =>
            fetchMock().mockResolvedValueOnce(
                jsonResponse(
                    ok ? { i } : { error: `boom-${i}` },
                    ok,
                    ok ? 200 : 500
                )
            )
        );

        const results = await Promise.allSettled(
            pattern.map((_, i) =>
                api("tasks", {
                    method: "PUT",
                    data: { _id: `t${i}`, projectId: "p1" }
                })
            )
        );

        results.forEach((r, i) => {
            if (i % 2 === 0) {
                expect(r.status).toBe("fulfilled");
                expect((r as PromiseFulfilledResult<unknown>).value).toEqual({
                    i
                });
            } else {
                expect(r.status).toBe("rejected");
                expect(
                    ((r as PromiseRejectedResult).reason as Error).message
                ).toBe(`boom-${i}`);
            }
        });
    });
});

describe("api() repetition — interleaved endpoints", () => {
    it("preserves per-call endpoint identity across a mixed burst", async () => {
        const endpoints = [
            { endpoint: "projects", method: "GET" },
            { endpoint: "boards", method: "GET", data: { projectId: "p1" } },
            { endpoint: "tasks", method: "GET", data: { projectId: "p1" } },
            { endpoint: "users", method: "GET" },
            { endpoint: "users/members", method: "GET" },
            {
                endpoint: "users/likes",
                method: "PUT",
                data: { projectId: "p1" }
            },
            {
                endpoint: "projects",
                method: "POST",
                data: { projectName: "X" }
            },
            {
                endpoint: "projects",
                method: "DELETE",
                data: { projectId: "p" }
            },
            {
                endpoint: "boards",
                method: "POST",
                data: { columnName: "C", projectId: "p1" }
            },
            { endpoint: "boards", method: "DELETE", data: { columnId: "c1" } },
            {
                endpoint: "boards/orders",
                method: "PUT",
                data: { fromId: "c1", referenceId: "c2", type: "after" }
            },
            { endpoint: "tasks", method: "POST", data: { taskName: "t" } },
            { endpoint: "tasks", method: "PUT", data: { _id: "t" } },
            { endpoint: "tasks", method: "DELETE", data: { taskId: "t1" } },
            {
                endpoint: "tasks/orders",
                method: "PUT",
                data: {
                    fromId: "t1",
                    fromColumnId: "c1",
                    referenceColumnId: "c2",
                    type: "before"
                }
            },
            {
                endpoint: "agents/mutations/record",
                method: "POST",
                data: { proposal_id: "p", project_id: "p1" }
            },
            {
                endpoint: "agents/mutations/undo",
                method: "POST",
                data: { proposal_id: "p", project_id: "p1" }
            }
        ];

        endpoints.forEach(() =>
            fetchMock().mockResolvedValueOnce(jsonResponse({ ok: true }))
        );

        await Promise.all(
            endpoints.map((c) =>
                api(c.endpoint, {
                    method: c.method,
                    data: c.data
                })
            )
        );

        expect(fetchMock()).toHaveBeenCalledTimes(endpoints.length);
        endpoints.forEach((c, i) => {
            const call = fetchMock().mock.calls[i];
            const url = call[0] as string;
            const init = call[1] as RequestInit;
            expect(url).toContain(`${environment.apiBaseUrl}/${c.endpoint}`);
            expect(init.method).toBe(c.method);
            const isGetOrDelete = c.method === "GET" || c.method === "DELETE";
            if (isGetOrDelete) {
                expect(init.body).toBeUndefined();
            } else if (c.data !== undefined) {
                expect(JSON.parse(init.body as string)).toEqual(c.data);
            }
        });
    });
});

describe("api() repetition — Authorization header is never constructed", () => {
    it("does not attach an Authorization header on any repeated call", async () => {
        // The REST session moved to an HttpOnly cookie that the
        // browser carries automatically; the FE no longer has a
        // bearer token to write into the header.
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await api("users", { method: "GET" });
        }

        fetchMock().mock.calls.forEach((call) => {
            const init = call[1] as RequestInit;
            const headers = init.headers as Record<string, string>;
            expect(headers.Authorization).toBeUndefined();
            expect(init.credentials).toBe("include");
        });
    });
});

describe("api() repetition — error stability under load", () => {
    it("rejects all N callers when every response is a 500", async () => {
        const N = 20;
        for (let i = 0; i < N; i++) {
            fetchMock().mockResolvedValueOnce(
                jsonResponse({ error: `fail-${i}` }, false, 500)
            );
        }

        const results = await Promise.allSettled(
            Array.from({ length: N }, (_, i) =>
                api("tasks", {
                    method: "PUT",
                    data: { _id: `t${i}` }
                })
            )
        );

        results.forEach((r, i) => {
            expect(r.status).toBe("rejected");
            const reason = (r as PromiseRejectedResult).reason as Error & {
                status?: number;
            };
            expect(reason.message).toBe(`fail-${i}`);
            expect(reason.status).toBe(500);
        });
    });

    it("rejects every caller with status 401 when the backend rejects an expired JWT batch", async () => {
        const N = 10;
        for (let i = 0; i < N; i++) {
            fetchMock().mockResolvedValueOnce(
                jsonResponse({ error: "empty JWT" }, false, 401)
            );
        }

        const results = await Promise.allSettled(
            Array.from({ length: N }, () => api("users", { method: "GET" }))
        );

        results.forEach((r) => {
            expect(r.status).toBe("rejected");
            const reason = (r as PromiseRejectedResult).reason as Error & {
                status?: number;
            };
            expect(reason.status).toBe(401);
            expect(reason.message).toBe("empty JWT");
        });
    });
});

describe("api() repetition — network failure batches", () => {
    it("rewrites every fetch TypeError to the friendly offline message", async () => {
        const N = 12;
        for (let i = 0; i < N; i++) {
            fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));
        }

        const results = await Promise.allSettled(
            Array.from({ length: N }, () => api("projects", { method: "GET" }))
        );

        results.forEach((r) => {
            expect(r.status).toBe("rejected");
            expect(
                ((r as PromiseRejectedResult).reason as Error).message
            ).toMatch(/unable to connect/i);
        });
    });
});
