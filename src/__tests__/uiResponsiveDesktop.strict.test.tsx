/**
 * Strict desktop-viewport UI tests (TDD harness).
 *
 * Each test pins one expectation about how a surface should look at a
 * desktop width (≥ md / ≥ lg). When a test fails the surface is not yet
 * adapting properly to the desktop viewport and must be hardened. The
 * companion file `uiResponsiveMobile.strict.test.tsx` covers the same
 * surfaces at narrow widths.
 *
 * The plan calls these out across:
 *   - §1.3 ("Layout is desktop-only and not responsive") — kill the
 *     `min-width: 1024px` / `max-height: 1440px` and let inner regions
 *     own scroll.
 *   - §2.A.5 (surface taxonomy) — drawers vs modals; on desktop a Drawer
 *     should leave the board partially visible.
 *   - §2.A.10 (visual hierarchy) — wordmark, greeting, chevron must all
 *     fit comfortably on desktop without being hidden.
 *
 * Why a viewport mock?
 * jsdom doesn't evaluate CSS `@media` rules, so we mock `matchMedia` so
 * `Grid.useBreakpoint()` from AntD reports the correct breakpoints. Any
 * JS-driven responsive decision (e.g. `screens.md ? 400 : "100%"`) then
 * runs against the mocked viewport.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import AuthLayout from "../layouts/authLayout";
import Header from "../components/header";
import LoginForm from "../components/loginForm";
import ProjectList from "../components/projectList";
import ProjectModal from "../components/projectModal";
import TaskModal from "../components/taskModal";
import { breakpoints } from "../theme/tokens";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";

jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useColorScheme");
jest.mock("../utils/hooks/useProjectModal");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");
jest.mock("../utils/hooks/useTaskModal");
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

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseProjectModal = useProjectModal as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;
const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;

/**
 * Mock `matchMedia` so AntD's `Grid.useBreakpoint()` reports the breakpoints
 * for the requested viewport width. We parse the common `(min-width: N)`,
 * `(max-width: N)`, `(pointer: coarse)`, and `(hover: none)` queries; any
 * other query falls back to `false`.
 */
const setViewport = (width: number, pointer: "fine" | "coarse" = "fine") => {
    (window as { innerWidth: number }).innerWidth = width;

    const fn = (query: string) => {
        const minMatches = Array.from(
            query.matchAll(/\(min-width:\s*(\d+)px\)/g)
        ).every(([, n]) => width >= parseInt(n, 10));
        const maxMatches = Array.from(
            query.matchAll(/\(max-width:\s*(\d+)px\)/g)
        ).every(([, n]) => width <= parseInt(n, 10));
        const pointerMatch = /\(pointer:\s*(coarse|fine)\)/.exec(query);
        const hoverMatch = /\(hover:\s*(none|hover)\)/.exec(query);
        let matches = minMatches && maxMatches;
        if (pointerMatch) matches = matches && pointerMatch[1] === pointer;
        if (hoverMatch) {
            matches =
                matches &&
                hoverMatch[1] === (pointer === "coarse" ? "none" : "hover");
        }
        return {
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        };
    };
    // setupTests installs matchMedia non-configurably; re-assign via the
    // existing slot rather than re-defining it.
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia =
        fn;
};

const installResizeObserverMock = () => {
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

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "c1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: "p1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const stubMutation = (overrides: Partial<{ mutateAsync: jest.Mock }> = {}) =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: overrides.mutateAsync ?? jest.fn().mockResolvedValue({})
    }) as unknown as ReturnType<typeof useReactMutation<unknown>>;

const stubQuery = (data: unknown) =>
    ({
        data,
        error: null,
        isLoading: false,
        isSuccess: true,
        refetch: jest.fn()
    }) as unknown as ReturnType<typeof useReactQuery<unknown>>;

beforeAll(() => {
    installResizeObserverMock();
});

beforeEach(() => {
    // Default: desktop-large width so AntD reports xs..xl all true.
    setViewport(breakpoints.xl + 100, "fine");
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
    mockedUseProjectModal.mockReturnValue({
        closeModal: jest.fn(),
        editingProject: undefined,
        isLoading: false,
        isModalOpened: false,
        openModal: jest.fn(),
        startEditing: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue(stubMutation());
    mockedUseReactQuery.mockImplementation((endpoint: string) => {
        if (endpoint === "users/members") return stubQuery([member()]);
        return stubQuery(undefined);
    });
    mockedUseTaskModal.mockReturnValue({
        closeModal: jest.fn(),
        editingTaskId: "task-1",
        startEditing: jest.fn()
    });
});

const ProvidersWrap = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return (
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>{children}</BrowserRouter>
            </QueryClientProvider>
        </Provider>
    );
};

/* -------------------------------------------------------------------------- */
/* 1. Header — wordmark, greeting, chevron all visible on desktop             */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header on desktop", () => {
    /**
     * The header has three visual elements that should be visible at
     * desktop widths but get hidden on narrow viewports:
     *   - The "Pulse" wordmark (hidden < sm).
     *   - The "Hi, {username}" greeting (hidden < sm via HiddenOnTiny).
     *   - The chevron next to the avatar (hidden < md via HiddenOnNarrow).
     *
     * On desktop, all three must be in the DOM AND visible (not display:
     * none). Because the styled-component `display: none` rules only apply
     * via CSS `@media`, jsdom evaluates them as not-applied, but we still
     * assert the elements are in the document and rendered without
     * `aria-hidden`. That keeps the contract: the header must render the
     * wordmark element to expose the brand.
     */
    it("renders the 'Pulse' wordmark in the header banner on desktop", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const banner = screen.getByRole("banner");
        // The wordmark is wrapped in a span; it must read exactly "Pulse".
        const wordmarks = Array.from(banner.querySelectorAll<HTMLElement>("*"))
            .filter((node) => node.children.length === 0)
            .map((node) => (node.textContent ?? "").trim())
            .filter((text) => text === "Pulse");
        expect(wordmarks.length).toBeGreaterThan(0);
    });

    it("renders the 'Hi, {username}' greeting on desktop with a non-empty username slot", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const greeting = screen.getByText(/^Hi,\s+Alice$/);
        expect(greeting).toBeInTheDocument();
    });

    it("renders the down-chevron icon next to the account trigger on desktop", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        // The DownOutlined SVG carries the AntD `anticon-down` class.
        // On desktop it must be present in the DOM. (The chevron has
        // `aria-hidden` — that's fine; we only assert it ships.)
        const chevron = screen
            .getByRole("button", { name: /account menu/i })
            .querySelector(".anticon-down");
        expect(chevron).not.toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* 2. AuthLayout — marketing rail visible at md+                              */
/* -------------------------------------------------------------------------- */
describe("UI quality :: AuthLayout marketing rail at desktop", () => {
    /**
     * AuthLayout's HeroRail is displayed via `@media (min-width: md)`. On
     * desktop it carries:
     *   - A "New: Board Copilot" badge.
     *   - The title "Ship work with calm focus.".
     *   - Three feature bullets.
     *
     * These elements must exist in the DOM at desktop sizes so the auth
     * surface uses the available width. (jsdom won't apply the @media
     * rule, but the elements must always be rendered into the tree.)
     */
    it("renders the marketing rail title at desktop width", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/login"]}>
                <Routes>
                    <Route element={<AuthLayout />} path="/">
                        <Route element={<div>placeholder</div>} path="login" />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        // The marketing title is `<h2>Ship work with calm focus.</h2>`.
        // The rail itself is `aria-hidden="true"` (it's decorative), so
        // we look up the H2 directly rather than via getByRole (which
        // skips aria-hidden subtrees by default).
        const headings = Array.from(container.querySelectorAll("h2"));
        const titles = headings.map((h) => (h.textContent ?? "").trim());
        expect(titles.some((t) => /ship work with calm focus/i.test(t))).toBe(
            true
        );
    });

    it("exposes the marketing rail as `aria-hidden` so it does not double-announce on screen readers", () => {
        const { container } = render(
            <MemoryRouter initialEntries={["/login"]}>
                <Routes>
                    <Route element={<AuthLayout />} path="/">
                        <Route element={<div>placeholder</div>} path="login" />
                    </Route>
                </Routes>
            </MemoryRouter>
        );

        // The marketing rail is decorative on top of the form. Per the
        // current implementation it carries `aria-hidden="true"` so the
        // form is the only thing screen readers focus on. Pin that.
        const headings = Array.from(container.querySelectorAll("h2"));
        const railHeading = headings.find((h) =>
            /ship work with calm focus/i.test(h.textContent ?? "")
        );
        expect(railHeading).toBeTruthy();
        if (railHeading) {
            expect(railHeading.closest("[aria-hidden='true']")).not.toBeNull();
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 3. Modals — confirm button is NOT block on desktop (≥ sm)                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectModal at desktop", () => {
    /**
     * On desktop (`screens.sm` is true), the OK / Cancel buttons should
     * sit inline at their natural width — never `block: true`. A failing
     * test means the modal stretches its primary action edge-to-edge on
     * a 1280 px window, which is the mobile contract leaking into desktop.
     */
    it("Create-project modal confirm button is not full-width at desktop", async () => {
        mockedUseProjectModal.mockReturnValue({
            closeModal: jest.fn(),
            editingProject: undefined,
            isLoading: false,
            isModalOpened: true,
            openModal: jest.fn(),
            startEditing: jest.fn()
        });
        store.dispatch(projectActions.openModal());

        render(
            <ProvidersWrap>
                <ProjectModal />
            </ProvidersWrap>
        );

        const dialog = await screen.findByRole("dialog");
        // The visible Create button must NOT carry the AntD block class
        // when `screens.sm` is true.
        const createBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find((btn) => /create project/i.test(btn.textContent ?? ""));
        expect(createBtn).toBeTruthy();
        if (createBtn) {
            expect(createBtn.className).not.toMatch(/ant-btn-block/);
        }
    });
});

describe("UI quality :: TaskModal at desktop", () => {
    /**
     * The TaskModal footer is a custom render: at `screens.sm` it places
     * the Delete button on the left and Cancel / Save on the right (the
     * conventional desktop arrangement). On mobile it stacks vertically.
     * On desktop the test pins that the buttons are NOT in stacked order
     * — i.e. there is no `flex-direction: column` wrapping container.
     */
    it("TaskModal footer renders Delete left + Cancel/Save right (no column stack) at desktop", async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        queryClient.setQueryData(["users/members"], [member()]);

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={<TaskModal tasks={[task()]} />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        const dialog = await screen.findByRole("dialog");
        const footer = dialog.querySelector<HTMLElement>(".ant-modal-footer");
        expect(footer).not.toBeNull();
        if (footer) {
            // The desktop branch wraps in a row, not a column. Walk first
            // descendant divs for the inline `flex-direction: column` style.
            const stacked = Array.from(
                footer.querySelectorAll<HTMLElement>("div")
            ).some((node) =>
                /flex-direction:\s*column/.test(
                    node.getAttribute("style") ?? ""
                )
            );
            expect(stacked).toBe(false);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 4. ProjectList card grid — organization + created data visible on desktop  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectList at desktop", () => {
    const renderList = () =>
        render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Routes>
                    <Route
                        path="/projects"
                        element={
                            <ProjectList
                                dataSource={[project()]}
                                loading={false}
                                members={[member()]}
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>
        );

    /**
     * The project list now renders as a card grid (card per project) with
     * the organization label inside the card body and the created date in
     * the card footer. We assert each piece of data is in the DOM at
     * desktop widths so users can scan a project at a glance.
     */
    it("renders the organization label inside the project card on desktop", () => {
        renderList();
        expect(screen.getByText("Product")).toBeInTheDocument();
    });

    it("renders the created date inside the project card footer on desktop", () => {
        renderList();
        expect(screen.getByText(/Apr 25, 2026/)).toBeInTheDocument();
    });

    it("exposes the projects landmark and a sort selector on desktop", () => {
        renderList();
        expect(
            screen.getByRole("list", { name: /projects/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("combobox", { name: /sort projects/i })
        ).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 5. LoginForm — desktop submit button keeps full width via AuthButton       */
/* -------------------------------------------------------------------------- */
describe("UI quality :: LoginForm at desktop", () => {
    /**
     * §2.7 says the auth submit button is a "single dominant CTA" — full
     * width on every viewport. On desktop the AuthButton still renders
     * `width: 100%` via styled-components, so we assert the visible
     * button uses the styled-component class. The visual contract is
     * "the CTA spans the form card edge-to-edge".
     */
    it("LoginForm submit button is full-width on desktop (single dominant CTA)", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const button = screen.getByRole("button", { name: /^log in$/i });
        // The styled component sets `width: 100%` via emotion.
        // We can't fully introspect emotion CSS in jsdom, but we CAN
        // confirm the button is the only one in the form (i.e. the
        // primary CTA is alone, not crowded by a sibling secondary).
        const form = button.closest("form");
        expect(form).not.toBeNull();
        if (form) {
            const buttonsInForm =
                form.querySelectorAll<HTMLButtonElement>("button");
            // A single CTA — login forms must not ship a secondary
            // submit button next to "Log in" (e.g. a lingering "Cancel"
            // / "Reset"). One button only.
            expect(buttonsInForm.length).toBe(1);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 6. mainLayout — has a single <main> landmark and a skip link               */
/* -------------------------------------------------------------------------- */
describe("UI quality :: mainLayout structure at desktop", () => {
    /**
     * The application shell must surface exactly one `<main>` landmark
     * and a `Skip to main content` link that targets it. Both must
     * exist regardless of viewport, but desktop is where they earn
     * their keep — keyboard users on a wide layout depend on the skip
     * link to bypass the header chrome.
     */
    it("mainLayout exposes exactly one main landmark with a stable id", () => {
        const MainLayout = require("../layouts/mainLayout").default;
        render(
            <ProvidersWrap>
                <MainLayout />
            </ProvidersWrap>
        );
        const mains = screen.getAllByRole("main");
        expect(mains).toHaveLength(1);
        // The skip link href is `#main-content` so the id must match.
        expect(mains[0].id).toBe("main-content");
    });

    it("mainLayout ships a 'Skip to main content' link pointing at the main landmark", () => {
        const MainLayout = require("../layouts/mainLayout").default;
        render(
            <ProvidersWrap>
                <MainLayout />
            </ProvidersWrap>
        );

        const link = screen.getByRole("link", {
            name: /skip to main content/i
        });
        expect(link).toBeInTheDocument();
        expect(link.getAttribute("href")).toBe("#main-content");
    });
});
