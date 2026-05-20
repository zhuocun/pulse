/**
 * Regression probe for the iPhone iOS 26.5 stuck-on-login race.
 *
 * `silent: true` suppresses the in-tab `subscribeAuthToken` notify, but
 * `useSyncExternalStore` still re-reads `readAuthToken()` on every render
 * of any `useAuth` consumer. If Ant Design's `message.success` (or any
 * ancestor re-render) runs after the token is persisted but before the
 * queued `location.assign` tears down the document, `LoginPage` /
 * `HomePage` can still commit `<Navigate replace />` and poison the
 * pending hard navigation.
 */
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import HomePage from "../../pages/home";
import LoginPage from "../../pages/login";
import useReactMutation from "../../utils/hooks/useReactMutation";
import nativeNavigate from "../../utils/nativeNavigate";
import { isMacLike } from "../../utils/platform";
import { resetLoginHardNavPendingForTests } from "../../utils/tokenStorage";

jest.mock("../../utils/hooks/useReactMutation");
jest.mock("../../utils/nativeNavigate");
jest.mock("../../utils/platform", () => ({
    isMacLike: jest.fn(() => true)
}));

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

const mutateAsync = jest.fn();

const user = (): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    jwt: "jwt-ios-race",
    likedProjects: [],
    username: "Alice"
});

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

describe("iOS login hard-nav race (real useAuth tree)", () => {
    let replaceStateSpy: jest.SpyInstance;

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        resetLoginHardNavPendingForTests();
        jest.clearAllMocks();
        mutateAsync.mockResolvedValue(user());
        mockedUseReactMutation.mockReturnValue({
            isLoading: false,
            mutateAsync
        } as unknown as ReturnType<typeof useReactMutation<IUser>>);
        window.history.pushState({}, "Login", "/login");
        replaceStateSpy = jest.spyOn(window.history, "replaceState");
    });

    afterEach(() => {
        replaceStateSpy.mockRestore();
    });

    const renderLoginTree = () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false }
            }
        });

        // Mirror `useReactMutation(..., setCache: true)` — onSuccess writes
        // the login payload into the users cache, which wakes every
        // `useCachedQueryData(["users"])` subscriber (including `useAuth`).
        mutateAsync.mockImplementation(async () => {
            const result = user();
            queryClient.setQueryData(["users"], result);
            return result;
        });

        return {
            queryClient,
            ...render(
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/login"]}>
                        <AntdApp>
                            <Routes>
                                <Route element={<HomePage />}>
                                    <Route
                                        element={<LoginPage />}
                                        path="login"
                                    />
                                </Route>
                            </Routes>
                        </AntdApp>
                    </MemoryRouter>
                </QueryClientProvider>
            )
        };
    };

    const fillAndSubmit = async () => {
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/^email$/i), {
                target: { value: "alice@example.com" }
            });
            fireEvent.change(screen.getByLabelText(/^password$/i), {
                target: { value: "secret" }
            });
            fireEvent.click(screen.getByRole("button", { name: /log in/i }));
        });
    };

    it("does not replaceState to /projects after queuing nativeNavigate", async () => {
        const { queryClient } = renderLoginTree();
        await fillAndSubmit();

        await waitFor(() => {
            expect(nativeNavigate).toHaveBeenCalledWith("/projects");
        });

        // Token must be persisted for the post-reload boot even though the
        // current tab should not SPA-navigate to /projects.
        expect(localStorage.getItem("Token")).toBe("jwt-ios-race");
        expect(queryClient.getQueryData<IUser>(["users"])?.jwt).toBe(
            "jwt-ios-race"
        );

        // Allow Ant Design message + React Query + mutation flush to run.
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        const projectsReplace = replaceStateSpy.mock.calls.find(
            ([, , url]) => typeof url === "string" && url.includes("/projects")
        );
        expect(projectsReplace).toBeUndefined();
        // Login form should still be mounted — hard nav was queued, not
        // completed in jsdom, and no SPA redirect should have fired.
        expect(
            screen.getByRole("heading", { name: /log in to your account/i })
        ).toBeInTheDocument();
        expect(isMacLike()).toBe(true);
    });

    it("keeps the login route mounted when an ancestor re-renders after hard-nav is marked", async () => {
        const { rerender, queryClient } = renderLoginTree();
        await fillAndSubmit();

        await waitFor(() => {
            expect(nativeNavigate).toHaveBeenCalledWith("/projects");
        });

        replaceStateSpy.mockClear();

        // Simulate an ancestor re-render after the iOS hard-nav path hid
        // the token from `readAuthToken()` until the document tears down.
        rerender(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/login"]}>
                    <AntdApp>
                        <Routes>
                            <Route element={<HomePage />}>
                                <Route element={<LoginPage />} path="login" />
                            </Route>
                        </Routes>
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        );

        await act(async () => {
            await Promise.resolve();
        });

        const projectsReplace = replaceStateSpy.mock.calls.find(
            ([, , url]) => typeof url === "string" && url.includes("/projects")
        );
        expect(projectsReplace).toBeUndefined();
        expect(window.location.pathname).toBe("/login");
        expect(
            screen.getByRole("heading", { name: /log in to your account/i })
        ).toBeInTheDocument();
        // Token remains persisted for the queued document load.
        expect(localStorage.getItem("Token")).toBe("jwt-ios-race");
    });
});
