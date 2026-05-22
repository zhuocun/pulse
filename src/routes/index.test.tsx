import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactElement } from "react";
import { BrowserRouter } from "react-router-dom";

import App from "../App";

import routes, {
    PublicAuthShell,
    RequireAuth,
    RequireGuest,
    RootRedirect
} from ".";

jest.mock("../pages/login", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/register", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/forgotPassword", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/terms", () => ({
    __esModule: true,
    default: () => <div data-testid="terms-content">Terms content</div>
}));
jest.mock("../pages/project", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/projectDetail", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/board", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/share", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/inbox", () => ({
    __esModule: true,
    default: () => <div data-testid="inbox-content">Inbox Route</div>
}));
jest.mock("../pages/copilotLanding", () => ({
    __esModule: true,
    default: () => (
        <div data-testid="copilot-landing-content">Copilot Route</div>
    )
}));
jest.mock("../pages/settings", () => ({
    __esModule: true,
    default: () => <div data-testid="settings-content">Settings Route</div>
}));
// Stub the auth layout to a thin shell that just renders the Outlet so
// the routed terms page surfaces in the test DOM without dragging in
// the brand chrome.
jest.mock("../layouts/authLayout", () => {
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
jest.mock("../layouts/mainLayout", () => {
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

const element = <Props,>(route: { element?: unknown }) =>
    route.element as ReactElement<Props>;

describe("routes", () => {
    it("wraps the app in a Suspense shell with an auth-aware index redirect", () => {
        const root = routes[0];
        expect(root.path).toBe("/");
        // The root element wraps an Outlet in a Suspense boundary so the
        // lazily-loaded page chunks can suspend without blanking the page.
        expect(element(root).type).toBeInstanceOf(Function);

        const indexRedirect = root.children?.[0];
        expect(
            indexRedirect && "index" in indexRedirect && indexRedirect.index
        ).toBe(true);
        // The index renders <RootRedirect/>, which decides at runtime whether
        // to send the visitor to /login or /projects.
        expect(element(indexRedirect as { element?: unknown }).type).toBe(
            RootRedirect
        );
    });

    it("guards auth-only pages with <RequireGuest />, mounts terms on a public <PublicAuthShell />, and protects app pages with <RequireAuth /> (QW-4 + Bug 1)", () => {
        // Layer 0: SuspenseShell. Layer 1 children are:
        //   [0] index → RootRedirect
        //   [1] RequireGuest wrapper for login / register / forgot
        //   [2] PublicAuthShell wrapper for auth/terms (Bug 1 — reachable
        //       to both guests and authenticated users so the in-form
        //       "Terms" link doesn't dead-end)
        //   [3] RequireAuth wrapper for projects / projects/:projectId
        //   [4] "*" catch-all
        const guestBranch = routes[0].children?.[1];
        expect(element(guestBranch as { element?: unknown }).type).toBe(
            RequireGuest
        );
        expect(guestBranch?.children?.map((route) => route.path)).toEqual([
            "register",
            "login",
            "auth/forgot-password"
        ]);

        const publicAuthBranch = routes[0].children?.[2];
        expect(element(publicAuthBranch as { element?: unknown }).type).toBe(
            PublicAuthShell
        );
        expect(publicAuthBranch?.children?.map((route) => route.path)).toEqual([
            "auth/terms"
        ]);

        const protectedBranch = routes[0].children?.[3];
        expect(element(protectedBranch as { element?: unknown }).type).toBe(
            RequireAuth
        );
        // The trailing entries are:
        //   - "share" (Phase 3 A4) — Web Share Target landing page
        //   - "inbox", "copilot", "settings" (Phase 3 A3) — bottom tab
        //     destinations carved off the header dropdown
        // All appended at the tail of the protected branch so the
        // existing /projects routes are unaffected.
        expect(protectedBranch?.children?.map((route) => route.path)).toEqual([
            "projects",
            "projects/:projectId",
            "share",
            "inbox",
            "copilot",
            "settings"
        ]);

        const catchAll = routes[0].children?.[4];
        expect(catchAll && "path" in catchAll ? catchAll.path : undefined).toBe(
            "*"
        );
    });

    it("nests an index redirect and the board route below project detail", () => {
        const protectedBranch = routes[0].children?.[3];
        const projectDetailRoute = protectedBranch?.children?.find(
            (route) => route.path === "projects/:projectId"
        );

        // Bare `/projects/:projectId` is handled by a declarative `index`
        // redirect (Navigate to "board"). The previous `useEffect`
        // force-redirect inside `ProjectDetailPage` was removed in QW-11.
        const children = projectDetailRoute?.children ?? [];
        expect(children[0] && "index" in children[0] && children[0].index).toBe(
            true
        );
        expect(children.slice(1).map((route) => route.path)).toEqual(["board"]);
    });
});

/**
 * Bug 1 integration coverage — `auth/terms` must resolve to the terms
 * page for both guests and authenticated users. The legacy structure
 * nested terms under `<RequireGuest />`, which silently rewrote any
 * authenticated visit into `/projects` and made the in-form Terms link
 * unreachable once the user signed in.
 */
describe("auth/terms reachability (Bug 1)", () => {
    const renderAt = (path: string, authedUser?: IUser) => {
        window.history.pushState({}, "App", path);
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        if (authedUser) {
            queryClient.setQueryData(["users"], authedUser);
        }
        render(
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    const authedUser: IUser = {
        _id: "u1",
        email: "alice@example.com",
        likedProjects: [],
        username: "Alice"
    };

    beforeEach(() => {
        window.localStorage.clear();
    });

    it("renders the terms content for an unauthenticated visitor", async () => {
        renderAt("/auth/terms");

        expect(await screen.findByTestId("terms-content")).toBeInTheDocument();
        // Visual chrome is the branded AuthLayout (not the app shell).
        expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
        await waitFor(() => {
            expect(window.location.pathname).toBe("/auth/terms");
        });
    });

    it("ALSO renders the terms content for an authenticated visitor (no redirect to /projects)", async () => {
        renderAt("/auth/terms", authedUser);

        expect(await screen.findByTestId("terms-content")).toBeInTheDocument();
        // Same branded shell — an authenticated reader sees the same
        // surface a guest does, just without the redirect.
        expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
        expect(window.location.pathname).toBe("/auth/terms");
    });
});

/**
 * Phase 3 A3 — bottom-tab destinations. The three new routes mount
 * under `<RequireAuth />` so they MUST require a session; an
 * unauthenticated visit redirects to /login like every other protected
 * page. With a session, each route surfaces its routed page through
 * the main layout's Outlet.
 */
describe("bottom-tab routes (Phase 3 A3)", () => {
    const renderAt = (path: string, authedUser?: IUser) => {
        window.history.pushState({}, "App", path);
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        if (authedUser) {
            queryClient.setQueryData(["users"], authedUser);
        }
        render(
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    const authedUser: IUser = {
        _id: "u1",
        email: "alice@example.com",
        likedProjects: [],
        username: "Alice"
    };

    beforeEach(() => {
        window.localStorage.clear();
    });

    it.each([
        ["/inbox", "inbox-content"],
        ["/copilot", "copilot-landing-content"],
        ["/settings", "settings-content"]
    ])(
        "renders %s through MainLayout for an authenticated visitor",
        async (path, testid) => {
            renderAt(path, authedUser);
            expect(
                await screen.findByTestId("main-layout")
            ).toBeInTheDocument();
            expect(await screen.findByTestId(testid)).toBeInTheDocument();
        }
    );

    it.each(["/inbox", "/copilot", "/settings"])(
        "redirects %s to /login for an unauthenticated visitor",
        async (path) => {
            renderAt(path);
            await waitFor(() => {
                expect(window.location.pathname).toBe("/login");
            });
        }
    );
});
