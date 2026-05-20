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

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    ...overrides
});

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { gcTime: Infinity, retry: false }
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
            <span data-testid="auth">
                {auth.isAuthenticated ? "yes" : "no"}
            </span>
            <span data-testid="path">{location.pathname}</span>
            <button type="button" onClick={auth.logout}>
                logout
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

describe("useAuth (cookie-session model)", () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;

    beforeAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: fetchMock
        });
    });

    afterAll(() => {
        Object.defineProperty(global, "fetch", {
            configurable: true,
            writable: true,
            value: originalFetch
        });
    });

    beforeEach(() => {
        sessionStorage.clear();
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    });

    it("reports unauthenticated when there is no cached user", () => {
        const queryClient = createQueryClient();
        const { result } = renderHook(() => useAuth(), {
            wrapper: createWrapper(queryClient)
        });
        expect(result.current.isAuthenticated).toBe(false);
        expect(result.current.user).toBeUndefined();
    });

    it("reports authenticated once the /users cache holds a user with an _id", () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());

        renderAuthProbe(queryClient);

        expect(screen.getByTestId("user")).toHaveTextContent("Alice");
        expect(screen.getByTestId("auth")).toHaveTextContent("yes");
    });

    it("flips to authenticated when the cache is written after mount", () => {
        const queryClient = createQueryClient();
        renderAuthProbe(queryClient);

        expect(screen.getByTestId("auth")).toHaveTextContent("no");

        act(() => {
            queryClient.setQueryData(["users"], user());
        });

        expect(screen.getByTestId("auth")).toHaveTextContent("yes");
    });

    it("clears the React Query cache, asks the backend to clear the cookie, and navigates to /login on logout", async () => {
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());
        sessionStorage.setItem("AiProxyJwt", "ai-1");

        renderAuthProbe(queryClient);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "logout" }));
            await Promise.resolve();
        });

        await waitFor(() =>
            expect(queryClient.getQueryData(["users"])).toBeUndefined()
        );
        expect(sessionStorage.getItem("AiProxyJwt")).toBeNull();
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/v1/auth/logout",
            expect.objectContaining({
                method: "POST",
                credentials: "include"
            })
        );
        await waitFor(() =>
            expect(screen.getByTestId("path")).toHaveTextContent("/login")
        );
    });

    it("still clears local state and navigates when the backend logout call fails", async () => {
        fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
        const queryClient = createQueryClient();
        queryClient.setQueryData(["users"], user());

        renderAuthProbe(queryClient);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "logout" }));
            await Promise.resolve();
        });

        await waitFor(() =>
            expect(queryClient.getQueryData(["users"])).toBeUndefined()
        );
        await waitFor(() =>
            expect(screen.getByTestId("path")).toHaveTextContent("/login")
        );
    });
});
