/**
 * Strict semantic structure tests (TDD harness).
 *
 * Each test pins one expectation about how the page is structured for
 * assistive tech (landmarks, heading hierarchy, accessible names) and for
 * search-engine / browser tooling (document title, page-level metadata).
 *
 * The plan calls these out across §3.4 (WCAG 2.4.x focus + landmarks),
 * §2.A.11 (information architecture), and §3.4 / §6 (a11y acceptance
 * criteria). A failing test means the surface omits a landmark, jumps a
 * heading level, or hand-rolls a name that should come from microcopy.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import type React from "react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import EmptyState from "../components/emptyState";
import Header from "../components/header";
import LoginPage from "../pages/login";
import RegisterPage from "../pages/register";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useReactMutation from "../utils/hooks/useReactMutation";

jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useColorScheme");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../assets/logo-software.svg?react", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: Record<string, unknown>) =>
            React.createElement("svg", { "data-testid": "logo", ...props })
    };
});
jest.mock("../components/memberPopover", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "button",
                { type: "button", "aria-label": "Members" },
                "Members"
            )
    };
});

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

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

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: user()
    });
    mockedUseAiEnabled.mockReturnValue({
        available: false,
        enabled: false,
        setEnabled: jest.fn()
    });
    mockedUseColorScheme.mockReturnValue({
        preference: "light",
        scheme: "light",
        setPreference: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue({
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn()
    } as unknown as ReturnType<typeof useReactMutation<unknown>>);
});

const ProvidersWrap = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return (
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <Routes>
                        <Route path="*" element={<>{children}</>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

/* -------------------------------------------------------------------------- */
/* 1. Heading hierarchy on auth pages                                         */
/* -------------------------------------------------------------------------- */
describe("UI quality :: auth pages heading hierarchy", () => {
    /**
     * Each top-level page must have exactly one h1 — the AuthLayout
     * supplies a brand wordmark but the *page* heading is what screen
     * readers announce as the page identity.
     */
    it("LoginPage renders exactly one h1", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        render(
            <BrowserRouter>
                <LoginPage />
            </BrowserRouter>
        );

        const h1s = screen.getAllByRole("heading", { level: 1 });
        expect(h1s).toHaveLength(1);
    });

    it("LoginPage h1 announces 'Log in' or 'Sign in', never the literal 'Login'", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        render(
            <BrowserRouter>
                <LoginPage />
            </BrowserRouter>
        );

        const h1 = screen.getByRole("heading", { level: 1 });
        // "Login" is on the §3.1 banned list. The heading must use the
        // verb form "Log in" instead.
        expect(h1.textContent ?? "").not.toMatch(/^\s*Login\b/i);
        expect(h1.textContent ?? "").toMatch(/log in|sign in/i);
    });

    it("RegisterPage renders exactly one h1", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        render(
            <BrowserRouter>
                <RegisterPage />
            </BrowserRouter>
        );

        const h1s = screen.getAllByRole("heading", { level: 1 });
        expect(h1s).toHaveLength(1);
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Header landmarks                                                          */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header landmarks and labels", () => {
    /**
     * The visible app header should expose a single `banner` landmark.
     * We render the Header in isolation (no MainLayout) so the test
     * does not depend on the parent shell.
     */
    it("Header surfaces a banner landmark", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        // banner = the top-level header element.
        const banners = screen.getAllByRole("banner");
        expect(banners.length).toBeGreaterThanOrEqual(1);
    });

    it("Header brand link has an accessible name distinct from nearby controls", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const link = screen.getByRole("button", { name: /pulse home/i });
        expect(link).toBeInTheDocument();
    });

    it("Header dark-mode icon button has an accessible name describing the action", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        // Either "Switch to dark mode" or "Switch to light mode" must be
        // present as the button's accessible name. Sentence case applies.
        const btn = screen.getByRole("button", {
            name: /switch to (dark|light) mode/i
        });
        expect(btn).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 3. Document title — pages should set a page-specific <title>                */
/* -------------------------------------------------------------------------- */
describe("UI quality :: document title per page", () => {
    /**
     * §2.A.11 says every page has a unique `<title>`. LoginPage and
     * RegisterPage today don't call `useTitle`, so the document keeps
     * whatever the previous page set. We assert the side effect: the
     * title must include the page name.
     */
    it("LoginPage updates the document title to identify the page", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        // Reset the title to something we can detect a change against.
        document.title = "Pulse";

        render(
            <BrowserRouter>
                <LoginPage />
            </BrowserRouter>
        );

        // After the page mounts, the title should mention "Log in" or
        // the page identity — never stay at the bare brand name.
        expect(document.title).toMatch(/log in|sign in/i);
    });

    it("RegisterPage updates the document title to identify the page", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        document.title = "Pulse";

        render(
            <BrowserRouter>
                <RegisterPage />
            </BrowserRouter>
        );

        expect(document.title).toMatch(/sign up|register/i);
    });
});

/* -------------------------------------------------------------------------- */
/* 4. EmptyState heading levels                                                 */
/* -------------------------------------------------------------------------- */
describe("UI quality :: EmptyState heading hierarchy", () => {
    /**
     * EmptyState forces its title to `Typography.Title level={5}`. That
     * jumps levels on a page whose page-heading is h1 (h1 → h5). The
     * component should accept a `headingLevel` prop so callers can keep
     * the outline contiguous (h1 → h2 on the project list, h2 → h3
     * inside a column).
     */
    it("EmptyState supports a configurable headingLevel so callers don't jump levels", () => {
        // The contract: passing headingLevel={2} renders an h2.
        // The prop does not exist today; we cast through `unknown` so the
        // test compiles regardless. The runtime assertion fails until
        // EmptyState is extended to accept the prop.
        const ExtendedEmptyState = EmptyState as unknown as React.FC<
            React.ComponentProps<typeof EmptyState> & { headingLevel?: number }
        >;
        render(
            <ProvidersWrap>
                <ExtendedEmptyState
                    description="…"
                    headingLevel={2}
                    title="No projects yet"
                />
            </ProvidersWrap>
        );

        const h2 = screen.queryByRole("heading", {
            level: 2,
            name: /no projects yet/i
        });
        expect(h2).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 5. Auth pages — main landmark + skip-link availability                      */
/* -------------------------------------------------------------------------- */
describe("UI quality :: auth pages landmarks", () => {
    /**
     * Every routed page should sit inside a `main` landmark so the
     * assistive-tech "jump to main content" pattern works. The auth
     * layout currently lacks `<main>` — `Canvas` is a styled `div`,
     * so the page floats with no landmark. Until the layout adds one,
     * this assertion fails.
     */
    it("LoginPage exposes a main landmark when rendered as a page", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        // Render the page exactly as the router would — wrap the page
        // in its `AuthLayout` outlet so we test the integrated route
        // tree, since landmarks belong to the layout (and are shared
        // across login + register), not to each page.
        const AuthLayout = require("../layouts/authLayout").default;
        const { container } = render(
            <MemoryRouter initialEntries={["/login"]}>
                <Routes>
                    <Route element={<AuthLayout />} path="/">
                        <Route element={<LoginPage />} path="login" />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        const main = container.querySelector("main, [role='main']");
        expect(main).not.toBeNull();
    });
});
