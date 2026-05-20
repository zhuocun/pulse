import { renderHook } from "@testing-library/react";

import * as useApiModule from "./useApi";

const { api } = useApiModule;
const useApi = useApiModule.default;
const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    Promise.resolve({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    } as unknown as Response);

describe("api", () => {
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

    it("serializes GET params and rides the session cookie via credentials: include", async () => {
        // Bearer auth is gone -- the REST JWT lives in an HttpOnly
        // cookie set by ``POST /auth/login`` that the browser attaches
        // automatically on every same-origin call. ``credentials:
        // "include"`` is what tells fetch to participate.
        fetchMock().mockResolvedValue(jsonResponse([{ _id: "p1" }]));

        await expect(
            api("projects", {
                data: { page: 0, projectName: "Roadmap" },
                method: "GET"
            })
        ).resolves.toEqual([{ _id: "p1" }]);

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.stringContaining(
                "/api/v1/projects?page=0&projectName=Roadmap"
            ),
            expect.objectContaining({
                headers: { "Content-Type": "application/json" },
                method: "GET",
                credentials: "include"
            })
        );
    });

    it("serializes DELETE params in the query string", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        await api("projects", {
            data: { projectId: "p1" },
            method: "DELETE"
        });

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.stringContaining("/api/v1/projects?projectId=p1"),
            expect.objectContaining({
                headers: { "Content-Type": "application/json" },
                method: "DELETE",
                credentials: "include"
            })
        );
    });

    it("serializes non-GET data into a JSON body", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "p1" }));

        await api("projects", {
            data: { projectName: "Roadmap" },
            method: "POST"
        });

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.stringContaining("/api/v1/projects"),
            expect.objectContaining({
                body: JSON.stringify({ projectName: "Roadmap" }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                credentials: "include"
            })
        );
    });

    it("rejects string API errors", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse({ error: "Board failed" }, false, 500)
        );

        await expect(api("boards")).rejects.toThrow("Board failed");
    });

    it("rejects Error API payloads by preserving their message", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse(new Error("Exploded"), false, 500)
        );

        await expect(api("boards")).rejects.toThrow("Exploded");
    });

    it("rejects validation-shaped API errors", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse({ error: [{ msg: "Name is required" }] }, false, 400)
        );

        await expect(api("projects")).rejects.toThrow("Name is required");
    });

    it("rejects raw response data when no error field exists", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse("Server failed", false, 500)
        );

        await expect(api("projects")).rejects.toThrow("Server failed");
    });

    it("rejects message-shaped API errors without object stringification", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse({ message: "Unauthorized" }, false, 401)
        );

        await expect(api("projects")).rejects.toThrow("Unauthorized");
    });

    it("rejects empty API errors with a stable fallback message", async () => {
        fetchMock().mockResolvedValue(jsonResponse({}, false, 500));

        await expect(api("projects")).rejects.toThrow("Operation failed");
    });

    it("attaches the HTTP status to rejected errors so callers can detect 401", async () => {
        // The backend's 401 body is `{"error": "empty JWT"}` — the
        // message-based regex check missed it, so refreshUser couldn't
        // tell a real auth failure from a transient network error and
        // bounced the user back to /login after a successful Safari
        // Mobile login.
        fetchMock().mockResolvedValue(
            jsonResponse({ error: "empty JWT" }, false, 401)
        );

        await expect(api("users")).rejects.toMatchObject({
            message: "empty JWT",
            status: 401
        });
    });

    it("attaches the HTTP status to 5xx rejections", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse({ error: "boom" }, false, 503)
        );

        await expect(api("users")).rejects.toMatchObject({
            message: "boom",
            status: 503
        });
    });

    it("converts a fetch network failure into a friendly error message", async () => {
        fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(api("projects")).rejects.toThrow(/unable to connect/i);
    });

    it("rethrows non-network errors from fetch unchanged", async () => {
        const otherError = new Error("Boom");
        fetchMock().mockRejectedValue(otherError);

        await expect(api("projects")).rejects.toBe(otherError);
    });

    it("never attaches an Authorization header -- the HttpOnly cookie is the auth", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));

        const { result } = renderHook(() => useApi());

        await result.current("users", { method: "GET" });

        const config = fetchMock().mock.calls[0]?.[1] as
            | (RequestInit & {
                  headers?: Record<string, string>;
              })
            | undefined;
        expect(config?.headers?.Authorization).toBeUndefined();
        expect(config?.credentials).toBe("include");
    });
});
