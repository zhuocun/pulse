import { renderHook } from "@testing-library/react";

import * as useApiModule from "./useApi";
import useAuth from "./useAuth";

jest.mock("./useAuth");

const { api } = useApiModule;
const useApi = useApiModule.default;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    Promise.resolve({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    } as unknown as Response);

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    jwt: "user-jwt",
    likedProjects: [],
    ...overrides
});

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
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: null,
            user: undefined
        });
    });

    afterAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch
        });
    });

    it("serializes GET params and sends a bearer token when one is supplied", async () => {
        fetchMock().mockResolvedValue(jsonResponse([{ _id: "p1" }]));

        await expect(
            api("projects", {
                data: { page: 0, projectName: "Roadmap" },
                method: "GET",
                token: "token-1"
            })
        ).resolves.toEqual([{ _id: "p1" }]);

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.stringContaining(
                "/api/v1/projects?page=0&projectName=Roadmap"
            ),
            {
                headers: {
                    Authorization: "Bearer token-1",
                    "Content-Type": "application/json"
                },
                method: "GET"
            }
        );
    });

    it("serializes DELETE params in the query string", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ ok: true }));

        await api("projects", {
            data: { projectId: "p1" },
            method: "DELETE",
            token: "token-1"
        });

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.stringContaining("/api/v1/projects?projectId=p1"),
            {
                headers: {
                    Authorization: "Bearer token-1",
                    "Content-Type": "application/json"
                },
                method: "DELETE"
            }
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
            {
                body: JSON.stringify({ projectName: "Roadmap" }),
                headers: {
                    "Content-Type": "application/json"
                },
                method: "POST"
            }
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

    it("uses the authenticated user's JWT before the localStorage token fallback", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: "stored-token",
            user: user({ jwt: "fresh-user-jwt" })
        });

        const { result } = renderHook(() => useApi());

        await result.current("users", { method: "GET" });

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer fresh-user-jwt"
                })
            })
        );
    });

    it("uses the stored token when no user is cached", async () => {
        fetchMock().mockResolvedValue(jsonResponse({ _id: "u1" }));
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            refreshUser: jest.fn(),
            token: "stored-token",
            user: undefined
        });

        const { result } = renderHook(() => useApi());

        await result.current("users", { method: "GET" });

        expect(fetchMock()).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer stored-token"
                })
            })
        );
    });
});
