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
    jwt: "jwt-1",
    likedProjects: [],
    username: "Alice",
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
        localStorage.clear();
    });

    afterAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch
        });
    });

    it("posts login credentials, stores the returned JWT, and returns the user", async () => {
        const returnedUser = user();
        fetchMock().mockResolvedValue(jsonResponse(returnedUser));

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).resolves.toEqual(returnedUser);

        expect(fetchMock()).toHaveBeenCalledWith(
            `${environment.apiBaseUrl}/auth/login`,
            {
                body: JSON.stringify({
                    email: "alice@example.com",
                    password: "secret"
                }),
                headers: {
                    "Content-Type": "application/json"
                },
                method: "POST"
            }
        );
        expect(tokenStorage.readAuthToken()).toBe("jwt-1");
    });

    it("maps a login 404 to a connection failure", async () => {
        fetchMock().mockResolvedValue(jsonResponse("missing", false, 404));

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).rejects.toThrow("Failed to connect");

        expect(tokenStorage.readAuthToken()).toBeNull();
    });

    it("rejects other login failures with the response JSON message", async () => {
        fetchMock().mockResolvedValue(
            jsonResponse("Invalid credentials", false, 401)
        );

        await expect(
            login({ email: "alice@example.com", password: "wrong" })
        ).rejects.toThrow("Invalid credentials");
    });

    it("posts register data and returns the response JSON", async () => {
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
            {
                body: JSON.stringify({
                    email: "alice@example.com",
                    password: "secret",
                    username: "Alice"
                }),
                headers: {
                    "Content-Type": "application/json"
                },
                method: "POST"
            }
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
        expect(tokenStorage.readAuthToken()).toBeNull();
    });

    it("rejects login when the JWT cannot be persisted to storage", async () => {
        fetchMock().mockResolvedValue(jsonResponse(user()));
        const spy = jest
            .spyOn(tokenStorage, "writeAuthToken")
            .mockReturnValue(false);

        await expect(
            login({ email: "alice@example.com", password: "secret" })
        ).rejects.toThrow(/private browsing|allow site data/i);

        expect(tokenStorage.readAuthToken()).toBeNull();
        spy.mockRestore();
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
