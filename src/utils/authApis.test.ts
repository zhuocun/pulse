import environment from "../constants/env";

import { login, register } from "./authApis";
import * as tokenStorage from "./tokenStorage";

const originalFetch = global.fetch;

const fetchMock = () => global.fetch as jest.MockedFunction<typeof fetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500) =>
    Promise.resolve({
        ok,
        status,
        json: jest.fn().mockResolvedValue(body)
    } as unknown as Response);

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ai_jwt: "ai-1",
    ...overrides
});

describe("auth API helpers", () => {
    beforeAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: jest.fn()
        });
    });

    beforeEach(() => {
        fetchMock().mockReset();
        sessionStorage.clear();
    });

    afterAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch
        });
    });

    it("posts login credentials with cookie credentials and stores only the AI proxy token", async () => {
        // The REST JWT now lives in an HttpOnly cookie the backend set
        // on this response. ``credentials: "include"`` is what tells
        // the browser to (a) accept that cookie and (b) attach it on
        // every subsequent same-origin call. The narrow-scope
        // ``ai_jwt`` still rides JSON because AI endpoints may live
        // on a different origin from the cookie's host.
        const returnedUser = user({ ai_jwt: "ai-token" });
        fetchMock().mockResolvedValue(jsonResponse(returnedUser));

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).resolves.toEqual(returnedUser);

        expect(fetchMock()).toHaveBeenCalledWith(
            `${environment.apiBaseUrl}/auth/login`,
            expect.objectContaining({
                body: JSON.stringify({
                    email: "alice@example.com",
                    password: "secret"
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                credentials: "include"
            })
        );
        expect(tokenStorage.readAiProxyToken()).toBe("ai-token");
    });

    it("does not fail when the login response omits ai_jwt", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse(user({ ai_jwt: undefined }))
        );

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).resolves.toBeTruthy();
        expect(tokenStorage.readAiProxyToken()).toBeNull();
    });

    it("maps a login 404 to a connection failure", async () => {
        fetchMock().mockResolvedValue(jsonResponse("missing", false, 404));

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).rejects.toThrow("Failed to connect");

        expect(tokenStorage.readAiProxyToken()).toBeNull();
    });

    it("rejects other login failures with the response JSON message", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse("Invalid credentials", false, 401)
        );

        await expect(
            login({ email: "alice@example.com", password: "wrong" })
        ).rejects.toThrow("Invalid credentials");
    });

    it("posts register data with cookie credentials and returns the response JSON", async () => {
        const response = { ok: true };
        fetchMock().mockResolvedValue(jsonResponse(response));

        await expect(
            register({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            })
        ).resolves.toEqual(response);

        expect(fetchMock()).toHaveBeenCalledWith(
            `${environment.apiBaseUrl}/auth/register`,
            expect.objectContaining({
                body: JSON.stringify({
                    email: "alice@example.com",
                    password: "secret",
                    username: "Alice"
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
                credentials: "include"
            })
        );
    });

    it("maps a register 404 to a connection failure", async () => {
        fetchMock().mockResolvedValue(jsonResponse("missing", false, 404));

        await expect(
            register({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            })
        ).rejects.toThrow("Failed to connect");
    });

    it("maps register validation errors to the first validation message", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse(
                { error: [{ msg: "Email has already been taken" }] },
                false,
                400
            )
        );

        await expect(
            register({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            })
        ).rejects.toThrow("Email has already been taken");
    });

    it("rejects other register failures with the response JSON message", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse("Registration failed", false, 500)
        );

        await expect(
            register({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            })
        ).rejects.toThrow("Registration failed");
    });

    it("converts a login network failure into a friendly error message", async () => {
        fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).rejects.toThrow(/unable to connect/i);
        expect(tokenStorage.readAiProxyToken()).toBeNull();
    });

    it("converts a register network failure into a friendly error message", async () => {
        fetchMock().mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(
            register({
                email: "alice@example.com",
                password: "secret",
                username: "Alice"
            })
        ).rejects.toThrow(/unable to connect/i);
    });
});
