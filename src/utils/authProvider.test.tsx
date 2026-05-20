import { act, render, screen, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AuthProvider from "./authProvider";
import useApi from "./hooks/useApi";

jest.mock("./hooks/useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const user = (): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice"
});

const createClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: Infinity }
        }
    });

const Wrapper =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );

describe("AuthProvider", () => {
    it("shows the page spinner while the initial /users probe is in flight", async () => {
        let resolveUsers: (value: IUser) => void = () => {};
        const apiFn = jest.fn(
            () =>
                new Promise<IUser>((resolve) => {
                    resolveUsers = resolve;
                })
        );
        mockedUseApi.mockReturnValue(apiFn);

        const queryClient = createClient();
        const { container } = render(
            <AuthProvider>
                <div>Routed content</div>
            </AuthProvider>,
            { wrapper: Wrapper(queryClient) }
        );

        expect(container.querySelector(".ant-spin")).toBeInTheDocument();
        expect(screen.queryByText("Routed content")).not.toBeInTheDocument();

        await act(async () => {
            resolveUsers(user());
            await Promise.resolve();
        });

        await waitFor(() =>
            expect(screen.getByText("Routed content")).toBeInTheDocument()
        );
        expect(apiFn).toHaveBeenCalledWith("users");
    });

    it("renders children once the /users probe resolves with a user", async () => {
        const apiFn = jest.fn().mockResolvedValue(user());
        mockedUseApi.mockReturnValue(apiFn);

        const queryClient = createClient();
        render(
            <AuthProvider>
                <div>Routed content</div>
            </AuthProvider>,
            { wrapper: Wrapper(queryClient) }
        );

        await waitFor(() =>
            expect(screen.getByText("Routed content")).toBeInTheDocument()
        );
        // Cache populated -- ``useAuth.isAuthenticated`` reads off this.
        expect(queryClient.getQueryData(["users"])).toEqual(user());
    });

    it("renders children when the /users probe rejects (route guards take over)", async () => {
        const apiFn = jest
            .fn()
            .mockRejectedValue(
                Object.assign(new Error("empty JWT"), { status: 401 })
            );
        mockedUseApi.mockReturnValue(apiFn);

        const queryClient = createClient();
        render(
            <AuthProvider>
                <div>Routed content</div>
            </AuthProvider>,
            { wrapper: Wrapper(queryClient) }
        );

        await waitFor(() =>
            expect(screen.getByText("Routed content")).toBeInTheDocument()
        );
        // No cached user -- ``useAuth.isAuthenticated`` is false and the
        // route guard (HomePage / RootRedirect) bounces to /login.
        expect(queryClient.getQueryData(["users"])).toBeUndefined();
    });

    it("does not show the spinner when the cache is already populated", () => {
        const apiFn = jest.fn().mockResolvedValue(user());
        mockedUseApi.mockReturnValue(apiFn);

        const queryClient = createClient();
        queryClient.setQueryData(["users"], user());

        const { container } = render(
            <AuthProvider>
                <div>Routed content</div>
            </AuthProvider>,
            { wrapper: Wrapper(queryClient) }
        );

        // Pre-populated cache means no first-paint spinner even while
        // the probe may still be in flight (it won't be due to staleTime
        // = Infinity, but the assertion holds either way).
        expect(container.querySelector(".ant-spin")).not.toBeInTheDocument();
        expect(screen.getByText("Routed content")).toBeInTheDocument();
    });
});
