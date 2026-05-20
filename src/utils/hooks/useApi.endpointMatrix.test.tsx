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

const baseHeaders = (token?: string | null) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json"
});

const lastFetchUrl = () => {
    const calls = fetchMock().mock.calls;
    return calls[calls.length - 1][0] as string;
};

const lastFetchInit = () => {
    const calls = fetchMock().mock.calls;
    return calls[calls.length - 1][1] as RequestInit;
};

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
 * Comprehensive matrix of every REST endpoint the FE talks to via the
 * `api()` helper (the wrapper underneath both `useReactQuery` and
 * `useReactMutation`). For each endpoint we assert:
 *
 *   - URL construction (path joined under `environment.apiBaseUrl`,
 *     query string for GET/DELETE, no query string for POST/PUT).
 *   - HTTP method (uppercased and preserved).
 *   - Request body (JSON-stringified for POST/PUT, absent for GET/DELETE).
 *   - Headers (`Content-Type` whenever data is supplied, `Authorization`
 *     when a token is present).
 *   - The fetch response surface (resolves with parsed JSON on `ok`).
 *
 * The matrix is intentionally exhaustive: every endpoint × method
 * combination called from a component, hook, or AI tool gets at least
 * one round-trip assertion. This guards against silent breakage of the
 * `api()` wire contract — a regression here would ripple into every
 * `useReactQuery` / `useReactMutation` consumer in the app.
 */
describe("FE API endpoint matrix — projects", () => {
    it("GET /projects with no params hits the projects collection without a query string", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("projects", { method: "GET" });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/projects`);
        expect(lastFetchInit().method).toBe("GET");
        expect(lastFetchInit().body).toBeUndefined();
    });

    it("GET /projects with filter params serializes them as a query string", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("projects", {
            method: "GET",
            data: { page: 0, projectName: "Roadmap", managerId: "u1" }
        });

        const url = lastFetchUrl();
        expect(url).toContain(`${environment.apiBaseUrl}/projects?`);
        expect(url).toContain("page=0");
        expect(url).toContain("projectName=Roadmap");
        expect(url).toContain("managerId=u1");
    });

    it("GET /projects with a single-project shape includes only projectId", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "p1" }));
        await api("projects", {
            method: "GET",
            data: { projectId: "p1" }
        });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/projects?projectId=p1`
        );
    });

    it("POST /projects sends the create payload in the JSON body", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "p1" }));
        const payload = {
            projectName: "Roadmap",
            organization: "Acme",
            managerId: "u1"
        };
        await api("projects", { method: "POST", data: payload, token: "tk" });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/projects`);
        expect(lastFetchInit()).toEqual({
            body: JSON.stringify(payload),
            headers: baseHeaders("tk"),
            method: "POST"
        });
    });

    it("PUT /projects forwards the edit payload as JSON body", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "p1" }));
        const payload = {
            _id: "p1",
            projectName: "Renamed",
            managerId: "u2",
            organization: "Acme"
        };
        await api("projects", { method: "PUT", data: payload });

        expect(lastFetchInit().method).toBe("PUT");
        expect(lastFetchInit().body).toBe(JSON.stringify(payload));
    });

    it("DELETE /projects sends the id in the query string, not the body", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("projects", {
            method: "DELETE",
            data: { projectId: "p1" }
        });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/projects?projectId=p1`
        );
        expect(lastFetchInit().method).toBe("DELETE");
        expect(lastFetchInit().body).toBeUndefined();
    });
});

describe("FE API endpoint matrix — boards", () => {
    it("GET /boards scoped by projectId for board page load", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("boards", { method: "GET", data: { projectId: "p1" } });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/boards?projectId=p1`
        );
    });

    it("POST /boards sends columnName + projectId for column creation", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "c1" }));
        await api("boards", {
            method: "POST",
            data: { columnName: "Todo", projectId: "p1" }
        });

        expect(lastFetchInit().body).toBe(
            JSON.stringify({ columnName: "Todo", projectId: "p1" })
        );
    });

    it("DELETE /boards sends columnId for column removal", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("boards", {
            method: "DELETE",
            data: { columnId: "c1" }
        });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/boards?columnId=c1`
        );
    });

    it("PUT /boards/orders sends the column reorder triple", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("boards/orders", {
            method: "PUT",
            data: {
                fromId: "c1",
                referenceId: "c3",
                type: "after"
            }
        });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/boards/orders`);
        expect(JSON.parse(lastFetchInit().body as string)).toEqual({
            fromId: "c1",
            referenceId: "c3",
            type: "after"
        });
    });
});

describe("FE API endpoint matrix — tasks", () => {
    it("GET /tasks scoped by projectId for board page", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("tasks", { method: "GET", data: { projectId: "p1" } });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/tasks?projectId=p1`
        );
    });

    it("POST /tasks creates a task with the full board payload", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "t1" }));
        const payload = {
            taskName: "Fix login",
            projectId: "p1",
            columnId: "c1",
            coordinatorId: "u1",
            type: "Task",
            epic: "New Feature",
            storyPoints: 1,
            note: "No note yet"
        };
        await api("tasks", { method: "POST", data: payload, token: "tk" });

        expect(lastFetchInit().method).toBe("POST");
        expect(JSON.parse(lastFetchInit().body as string)).toEqual(payload);
        expect(lastFetchInit().headers).toEqual(baseHeaders("tk"));
    });

    it("PUT /tasks updates a task in place", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "t1" }));
        const payload = {
            _id: "t1",
            projectId: "p1",
            storyPoints: 5
        };
        await api("tasks", { method: "PUT", data: payload });

        expect(JSON.parse(lastFetchInit().body as string)).toEqual(payload);
    });

    it("DELETE /tasks targets a task id via the query string", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("tasks", { method: "DELETE", data: { taskId: "t1" } });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/tasks?taskId=t1`
        );
        expect(lastFetchInit().method).toBe("DELETE");
    });

    it("PUT /tasks/orders reorders within a column (same-column after)", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("tasks/orders", {
            method: "PUT",
            data: {
                fromId: "t1",
                referenceId: "t2",
                fromColumnId: "c1",
                referenceColumnId: "c1",
                type: "after"
            }
        });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/tasks/orders`);
        expect(JSON.parse(lastFetchInit().body as string)).toEqual({
            fromId: "t1",
            referenceId: "t2",
            fromColumnId: "c1",
            referenceColumnId: "c1",
            type: "after"
        });
    });

    it("PUT /tasks/orders supports cross-column drops without a referenceId", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("tasks/orders", {
            method: "PUT",
            data: {
                fromId: "t1",
                fromColumnId: "c1",
                referenceColumnId: "c3",
                type: "before"
            }
        });

        const body = JSON.parse(lastFetchInit().body as string);
        expect(body).not.toHaveProperty("referenceId");
        expect(body).toEqual({
            fromId: "t1",
            fromColumnId: "c1",
            referenceColumnId: "c3",
            type: "before"
        });
    });
});

describe("FE API endpoint matrix — users", () => {
    it("GET /users fetches the authenticated viewer record", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));
        await api("users", { method: "GET", token: "tk" });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/users`);
        expect(lastFetchInit().headers).toEqual({ Authorization: "Bearer tk" });
    });

    it("GET /users/members returns the org member directory", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ _id: "m1" }]));
        await api("users/members", { method: "GET" });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/users/members`);
        expect(lastFetchInit().method).toBe("GET");
    });

    it("PUT /users/likes toggles a project like and returns the refreshed user", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));
        await api("users/likes", {
            method: "PUT",
            data: { projectId: "p1" },
            token: "tk"
        });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/users/likes`);
        expect(JSON.parse(lastFetchInit().body as string)).toEqual({
            projectId: "p1"
        });
        expect(lastFetchInit().headers).toEqual(baseHeaders("tk"));
    });
});

describe("FE API endpoint matrix — agent mutations", () => {
    it("POST /agents/mutations/record records undo metadata", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        const payload = {
            proposal_id: "prop-1",
            project_id: "p1",
            undo: {
                task_updates: [
                    {
                        task_id: "t1",
                        field: "storyPoints",
                        from: 3,
                        to: 5
                    }
                ]
            }
        };
        await api("agents/mutations/record", {
            method: "POST",
            data: payload,
            token: "tk"
        });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/agents/mutations/record`
        );
        expect(JSON.parse(lastFetchInit().body as string)).toEqual(payload);
    });

    it("POST /agents/mutations/undo reverses a recorded proposal", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("agents/mutations/undo", {
            method: "POST",
            data: { proposal_id: "prop-1", project_id: "p1" }
        });

        expect(lastFetchUrl()).toBe(
            `${environment.apiBaseUrl}/agents/mutations/undo`
        );
        expect(JSON.parse(lastFetchInit().body as string)).toEqual({
            proposal_id: "prop-1",
            project_id: "p1"
        });
    });
});

describe("FE API endpoint matrix — payload edge cases", () => {
    it("preserves array filter params using qs's repeating-key encoding", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("projects", {
            method: "GET",
            data: { tags: ["alpha", "beta"] }
        });

        // qs default encoding for arrays appends [] (or repeats keys);
        // either way the array values must round-trip.
        const url = lastFetchUrl();
        expect(url).toContain("alpha");
        expect(url).toContain("beta");
    });

    it("preserves nested object filter params", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("tasks", {
            method: "GET",
            data: { filter: { type: "Bug", projectId: "p1" } }
        });

        const url = lastFetchUrl();
        expect(url).toContain("type");
        expect(url).toContain("Bug");
        expect(url).toContain("projectId");
        expect(url).toContain("p1");
    });

    it("URL-encodes special characters in GET params", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("projects", {
            method: "GET",
            data: { projectName: "A & B" }
        });

        const url = lastFetchUrl();
        // The space and ampersand must be encoded so the server doesn't
        // misinterpret them as a parameter separator.
        expect(url).toMatch(/projectName=A%20%26%20B|projectName=A\+%26\+B/);
    });

    it("omits the body entirely when GET is invoked with an empty data object", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("projects", { method: "GET", data: {} });

        expect(lastFetchUrl()).toBe(`${environment.apiBaseUrl}/projects`);
        expect(lastFetchInit().body).toBeUndefined();
    });

    it("treats data as a JSON-stringified body for unknown methods (PATCH)", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("tasks", {
            method: "PATCH",
            data: { foo: "bar" }
        });

        // The helper only special-cases GET / DELETE for querystrings; any
        // other method should serialize through the JSON body so the
        // contract stays predictable.
        expect(lastFetchInit().method).toBe("PATCH");
        expect(JSON.parse(lastFetchInit().body as string)).toEqual({
            foo: "bar"
        });
    });

    it("defaults to GET when no method is supplied", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("users/members");

        expect(lastFetchInit().method).toBe("GET");
    });

    it("does NOT attach a Content-Type header when no data is supplied", async () => {
        fetchMock().mockResolvedValue(jsonResponse([]));
        await api("users/members", { method: "GET" });

        const headers = (lastFetchInit().headers ?? {}) as Record<
            string,
            string
        >;
        expect(headers["Content-Type"]).toBeUndefined();
    });

    it("attaches both Authorization and Content-Type when token + data are supplied", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
        await api("tasks", {
            method: "POST",
            data: { taskName: "x" },
            token: "tk"
        });

        expect(lastFetchInit().headers).toEqual({
            Authorization: "Bearer tk",
            "Content-Type": "application/json"
        });
    });

    it("attaches only Authorization (no Content-Type) when token is present but no data", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));
        await api("users", { method: "GET", token: "tk" });

        expect(lastFetchInit().headers).toEqual({
            Authorization: "Bearer tk"
        });
    });
});

describe("FE API endpoint matrix — method case normalization", () => {
    it.each(["get", "Get", "GET"])(
        "treats method %s as a query-string-bearing GET",
        async (method) => {
            fetchMock().mockResolvedValue(jsonResponse([]));
            await api("projects", {
                method,
                data: { projectId: "p1" }
            });
            expect(lastFetchUrl()).toContain("projectId=p1");
            expect(lastFetchInit().body).toBeUndefined();
        }
    );

    it.each(["delete", "Delete", "DELETE"])(
        "treats method %s as a query-string-bearing DELETE",
        async (method) => {
            fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
            await api("tasks", {
                method,
                data: { taskId: "t1" }
            });
            expect(lastFetchUrl()).toContain("taskId=t1");
            expect(lastFetchInit().body).toBeUndefined();
        }
    );

    it.each(["post", "Post", "POST", "put", "Put", "PUT"])(
        "treats method %s as a body-bearing request",
        async (method) => {
            fetchMock().mockResolvedValue(jsonResponse({ ok: true }));
            await api("tasks", {
                method,
                data: { taskName: "x" }
            });
            expect(lastFetchInit().method).toBe(method);
            expect(JSON.parse(lastFetchInit().body as string)).toEqual({
                taskName: "x"
            });
        }
    );
});

describe("FE API endpoint matrix — response shape pass-through", () => {
    it.each([
        ["projects", "GET", [{ _id: "p1" }, { _id: "p2" }]],
        ["projects", "POST", { _id: "p3", projectName: "New" }],
        ["projects", "PUT", { _id: "p3", projectName: "Edit" }],
        ["projects", "DELETE", { ok: true }],
        ["boards", "GET", [{ _id: "c1", columnName: "Todo" }]],
        ["boards", "POST", { _id: "c2", columnName: "Done" }],
        ["boards", "DELETE", { ok: true }],
        ["boards/orders", "PUT", { ok: true }],
        ["tasks", "GET", [{ _id: "t1" }]],
        ["tasks", "POST", { _id: "t2" }],
        ["tasks", "PUT", { _id: "t2" }],
        ["tasks", "DELETE", { ok: true }],
        ["tasks/orders", "PUT", { ok: true }],
        ["users", "GET", { _id: "u1", jwt: "j" }],
        ["users/members", "GET", [{ _id: "m1" }]],
        ["users/likes", "PUT", { _id: "u1" }],
        ["agents/mutations/record", "POST", { ok: true }],
        ["agents/mutations/undo", "POST", { ok: true }]
    ])(
        "resolves the parsed JSON body for %s %s",
        async (endpoint, method, body) => {
            fetchMock().mockResolvedValue(jsonResponse(body));
            await expect(
                api(endpoint, { method, data: { x: 1 } })
            ).resolves.toEqual(body);
        }
    );
});
