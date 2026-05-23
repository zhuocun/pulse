/* eslint-disable global-require */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { store } from "./store";

/*
 * The legacy `pages/home.tsx` wrapper was removed in QW-4; the routes file
 * now wraps each branch in `<RequireAuth />` / `<RequireGuest />` which
 * render `<MainLayout />` / `<AuthLayout />` directly. Both layouts are
 * stubbed below so the routed pages still mount through an Outlet.
 */
jest.mock("./layouts/mainLayout", () => {
    const React = require("react");
    const { Outlet: RouterOutlet } = require("react-router");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "section",
                { "data-testid": "main-layout" },
                React.createElement(RouterOutlet)
            )
    };
});
jest.mock("./layouts/authLayout", () => {
    const React = require("react");
    const { Outlet: RouterOutlet } = require("react-router");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "section",
                { "data-testid": "auth-layout" },
                React.createElement(RouterOutlet)
            )
    };
});
jest.mock("./pages/login", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Login Route")
    };
});
jest.mock("./pages/register", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Register Route")
    };
});
jest.mock("./pages/project", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Projects Route")
    };
});
jest.mock("./pages/projectDetail", () => {
    const React = require("react");
    const { Outlet: RouterOutlet } = require("react-router");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "section",
                { "data-testid": "project-detail-route" },
                React.createElement(RouterOutlet)
            )
    };
});
jest.mock("./pages/board", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () => React.createElement("div", null, "Board Route")
    };
});

const renderAppAt = (path: string, authedUser?: IUser) => {
    window.history.pushState({}, "App", path);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    if (authedUser) {
        queryClient.setQueryData(["users"], authedUser);
    }

    render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </QueryClientProvider>
        </Provider>
    );
};

const authedUser = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

beforeEach(() => {
    localStorage.clear();
});

describe("App", () => {
    it("redirects the root route to login when unauthenticated", async () => {
        renderAppAt("/");

        await waitFor(() => {
            expect(window.location.pathname).toBe("/login");
        });
        expect(await screen.findByTestId("auth-layout")).toBeInTheDocument();
        expect(await screen.findByText("Login Route")).toBeInTheDocument();
    });

    it("renders a known guest route through the AuthLayout shell", async () => {
        renderAppAt("/register");

        expect(await screen.findByTestId("auth-layout")).toBeInTheDocument();
        expect(await screen.findByText("Register Route")).toBeInTheDocument();
    });

    it("renders nested project board routes through the MainLayout shell when authenticated", async () => {
        renderAppAt("/projects/p1/board", authedUser());

        expect(await screen.findByTestId("main-layout")).toBeInTheDocument();
        expect(
            await screen.findByTestId("project-detail-route")
        ).toBeInTheDocument();
        expect(await screen.findByText("Board Route")).toBeInTheDocument();
    });

    it("bounces an authenticated visitor from /login to /projects via RequireGuest", async () => {
        renderAppAt("/login", authedUser());

        await waitFor(() => {
            expect(window.location.pathname).toBe("/projects");
        });
        expect(await screen.findByTestId("main-layout")).toBeInTheDocument();
        expect(await screen.findByText("Projects Route")).toBeInTheDocument();
    });
});
