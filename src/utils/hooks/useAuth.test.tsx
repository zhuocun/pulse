import {
    act,
    fireEvent,
    render,
    renderHook,
    screen,
    waitFor
} from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

import useAuth from "./useAuth";
import { writeAuthToken } from "../tokenStorage";

const createThrowingStorage = (): Storage => ({
    get length(): number {
        throw new Error("storage blocked");
    },
    clear() {
        throw new Error("storage blocked");
    },
    getItem() {
        throw new Error("storage blocked");
    },
    key() {
        throw new Error("storage blocked");
    },
    removeItem() {
        throw new Error("storage blocked");
    },
    setItem() {
        throw new Error("storage blocked");
    }
});

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    jwt: "jwt-1",
    likedProjects: [],
    ...overrides
});

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                gcTime: Infinity,
                retry: false
            }
        }
    });

const createWrapper = (queryClient: QueryClient, initialEntries = ["/"]) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={initialEntries}>
                    {children}
                </MemoryRouter>
            </QueryClientProvider>
        );
    };

const AuthProbe = () => {
    const auth = useAuth();
    const location = useLocation();

    return (
        <div>
            <span data-testid="user">{auth.user?.username ?? "none"}</span>
            <span data-testid="token">{auth.token ?? "none"}</span>
            <span data-testid="path">{location.pathname}</span>
            <button type="button" onClick={auth.logout}>
                logout
            </button>
            <button type="button" onClick={auth.refreshUser}>
                refresh
            </button>
        </div>
    );
};

const renderAuthProbe = (queryClient: QueryClient, route = "/") =>
    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>
                <AuthProbe />
            </MemoryRouter>
        </QueryClientProvider>
    );

describe("useAuth", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        for (const part of document.cookie.split(";")) {
            const name = part.split("=")[0]?.trim();
            if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
        }
    });

    it("re-renders when the cached user is written after mount", () => {
        const queryClient = createQueryClient();
        renderAuthProbe(queryClient);

        expect(screen.getByTestId("user")).toHaveTextContent("none");

        act(() => {
            queryClient.setQueryData(["users"], user());
        });

        expect(screen.getByTestId("user")).toHaveTextContent("Alice");
    });

    it("re-renders when the stored token is written after mount", () => {
        const queryClient = createQueryClient();
        localStorage.clear();
        renderAuthProbe(queryClient);

        expect(screen.getByTestId("token")).toHaveTextContent("none");

        act(() => {
            writeAuthToken("late-token");
        });

        expect(screen.getByTestId("token")).toHaveTextContent("late-token");
    });

    it("reads the cached user from React Query and token from localStorage", () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());
        localStorage.setItem("Token", "stored-token");

        renderAuthProbe(queryClient);

        expect(screen.getByTestId("user")).toHaveTextContent("Alice");
        expect(screen.getByTestId("token")).toHaveTextContent("stored-token");
    });

    it("falls back to no token when storage access throws during render", () => {
        const original = window.localStorage;
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            value: createThrowingStorage()
        });
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());

        try {
            renderAuthProbe(queryClient);
            expect(screen.getByTestId("user")).toHaveTextContent("Alice");
            expect(screen.getByTestId("token")).toHaveTextContent("none");
        } finally {
            Object.defineProperty(window, "localStorage", {
                configurable: true,
                value: original
            });
        }
    });

    it("clears cached auth state and navigates to login on logout", async () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());
        localStorage.setItem("Token", "stored-token");

        renderAuthProbe(queryClient);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "logout" }));
            await Promise.resolve();
        });

        await waitFor(() => expect(localStorage.getItem("Token")).toBeNull());
        expect(queryClient.getQueryData(["users"])).toBeUndefined();
        await waitFor(() =>
            expect(screen.getByTestId("path")).toHaveTextContent("/login")
        );
    });

    it("does not refetch users when there is no token", () => {
        const queryClient = createQueryClient();
        const refetchSpy = jest.spyOn(queryClient, "refetchQueries");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        act(() => {
            result.current.refreshUser();
        });

        expect(refetchSpy).not.toHaveBeenCalled();
    });

    it("does not refetch users when a matching user is already cached", () => {
        const queryClient = createQueryClient();
        const refetchSpy = jest.spyOn(queryClient, "refetchQueries");
        queryClient.setQueryData(["users"], user({ jwt: "stored-token" }));
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        act(() => {
            result.current.refreshUser();
        });

        expect(refetchSpy).not.toHaveBeenCalled();
    });

    it("refetches users when the cached user JWT differs from the stored token", async () => {
        const queryClient = createQueryClient();
        const serverUser = user({ jwt: "server-jwt" });
        const refetchSpy = jest
            .spyOn(queryClient, "refetchQueries")
            .mockImplementation(() => {
                queryClient.setQueryData(["users"], serverUser);
                return Promise.resolve();
            });
        queryClient.setQueryData(["users"], user({ jwt: "stale-jwt" }));
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        act(() => {
            result.current.refreshUser();
        });

        await waitFor(() =>
            expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["users"] })
        );
        await waitFor(() =>
            expect(queryClient.getQueryData(["users"])).toEqual({
                ...serverUser,
                jwt: "stored-token"
            })
        );
    });

    it("refetches users when a token exists without cached user data and restores the stored JWT", async () => {
        const queryClient = createQueryClient();
        const serverUser = user({ jwt: "server-jwt" });
        const refetchSpy = jest
            .spyOn(queryClient, "refetchQueries")
            .mockImplementation(() => {
                queryClient.setQueryData(["users"], serverUser);
                return Promise.resolve();
            });
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        act(() => {
            result.current.refreshUser();
        });

        await waitFor(() =>
            expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["users"] })
        );
        await waitFor(() =>
            expect(queryClient.getQueryData(["users"])).toEqual({
                ...serverUser,
                jwt: "stored-token"
            })
        );
    });

    it("logs out when refreshUser sees an explicit 401 from the user fetch", async () => {
        const queryClient = createQueryClient();
        const unauthorized = Object.assign(new Error("empty JWT"), {
            status: 401
        });
        const refetchSpy = jest
            .spyOn(queryClient, "refetchQueries")
            .mockImplementation(() => Promise.resolve());
        jest.spyOn(queryClient, "getQueryState").mockReturnValue({
            data: undefined,
            dataUpdateCount: 0,
            dataUpdatedAt: 0,
            error: unauthorized,
            errorUpdateCount: 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: 1,
            fetchFailureReason: unauthorized,
            fetchMeta: null,
            isInvalidated: false,
            status: "error",
            fetchStatus: "idle"
        });
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        await act(async () => {
            await result.current.refreshUser();
        });

        await waitFor(() =>
            expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["users"] })
        );
        await waitFor(() => expect(localStorage.getItem("Token")).toBeNull());
    });

    it("keeps the session on a transient refetch failure even without a cached user (Safari Mobile bug)", async () => {
        const queryClient = createQueryClient();
        // Safari Mobile rejects fetch with TypeError("Load failed") on
        // flaky cellular and during Vercel cold-starts. With no cached
        // user (the steady state right after `nativeNavigate("/projects")`
        // does a full reload and wipes the in-memory cache), the previous
        // code dropped the token and redirected to /login — losing the
        // session the user just successfully created.
        const transient = new TypeError("Load failed");
        const refetchSpy = jest
            .spyOn(queryClient, "refetchQueries")
            .mockImplementation(() => Promise.resolve());
        jest.spyOn(queryClient, "getQueryState").mockReturnValue({
            data: undefined,
            dataUpdateCount: 0,
            dataUpdatedAt: 0,
            error: transient,
            errorUpdateCount: 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: 1,
            fetchFailureReason: transient,
            fetchMeta: null,
            isInvalidated: false,
            status: "error",
            fetchStatus: "idle"
        });
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        await act(async () => {
            await result.current.refreshUser();
        });

        await waitFor(() =>
            expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ["users"] })
        );
        // Token MUST survive a transient network failure.
        expect(localStorage.getItem("Token")).toBe("stored-token");
        // No cached user to patch; cache stays empty until the next retry.
        expect(queryClient.getQueryData(["users"])).toBeUndefined();
    });

    it("keeps the session on a server 5xx failure even without a cached user", async () => {
        const queryClient = createQueryClient();
        const serverErr = Object.assign(new Error("Operation failed"), {
            status: 503
        });
        jest.spyOn(queryClient, "refetchQueries").mockImplementation(() =>
            Promise.resolve()
        );
        jest.spyOn(queryClient, "getQueryState").mockReturnValue({
            data: undefined,
            dataUpdateCount: 0,
            dataUpdatedAt: 0,
            error: serverErr,
            errorUpdateCount: 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: 1,
            fetchFailureReason: serverErr,
            fetchMeta: null,
            isInvalidated: false,
            status: "error",
            fetchStatus: "idle"
        });
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        await act(async () => {
            await result.current.refreshUser();
        });

        expect(localStorage.getItem("Token")).toBe("stored-token");
    });

    it("keeps the session when refreshUser fails transiently but profile data is cached", async () => {
        const queryClient = createQueryClient();
        const cached = user({ jwt: "stale-jwt" });
        queryClient.setQueryData(["users"], cached);
        jest.spyOn(queryClient, "refetchQueries").mockImplementation(() =>
            Promise.resolve()
        );
        jest.spyOn(queryClient, "getQueryState").mockReturnValue({
            data: cached,
            dataUpdateCount: 1,
            dataUpdatedAt: Date.now(),
            error: new Error("Network request failed"),
            errorUpdateCount: 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: 1,
            fetchFailureReason: new Error("Network request failed"),
            fetchMeta: null,
            isInvalidated: false,
            status: "error",
            fetchStatus: "idle"
        });
        localStorage.setItem("Token", "stored-token");

        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });

        await act(async () => {
            await result.current.refreshUser();
        });

        expect(localStorage.getItem("Token")).toBe("stored-token");
        expect(queryClient.getQueryData(["users"])).toEqual({
            ...cached,
            jwt: "stored-token"
        });
    });
});
