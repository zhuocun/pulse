/**
 * Strict mobile-viewport UI tests (TDD harness).
 *
 * Each test pins one expectation about how a surface should behave at a
 * narrow viewport (xs / sm — anything below 768 px). When a test fails the
 * surface still ships its desktop layout on phones, breaking touch
 * affordances or pushing primary CTAs off-screen.
 *
 * The plan calls these out across:
 *   - §1.3 ("Layout is desktop-only and not responsive") — `min-width:
 *     1024px` historically blocked mobile entirely.
 *   - §2.A.2 (touch & mobile) — bottom-sheet drawer variants on xs/sm so
 *     the on-screen keyboard does not push the form off-screen.
 *   - §2.A.5 (surface taxonomy) — drawers vs. modals; on phone a Drawer
 *     should fill the viewport.
 *   - §3.4 (WCAG 2.5.5 / 2.5.8) — touch targets ≥ 44 × 44 on coarse
 *     pointers (companion file `uiTouchTargets.strict.test.tsx`).
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

import AiChatDrawer from "../components/aiChatDrawer";
import BoardBriefDrawer from "../components/boardBriefDrawer";
import Header from "../components/header";
import LoginForm from "../components/loginForm";
import ProjectList from "../components/projectList";
import ProjectModal from "../components/projectModal";
import TaskModal from "../components/taskModal";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAiChat from "../utils/hooks/useAiChat";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";

jest.mock("../utils/hooks/useAiChat");
jest.mock("../utils/hooks/useAiEnabled", () => ({
    __esModule: true,
    default: jest.fn(),
    useAutonomyLevel: jest.fn(() => ({ level: "plan", setLevel: jest.fn() }))
}));
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

const mockedUseAiChat = useAiChat as jest.MockedFunction<typeof useAiChat>;
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
const setViewport = (width: number, pointer: "fine" | "coarse" = "coarse") => {
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

// iPhone SE — 375 × 667 — is the working "smallest modern phone" target
// across the plan. Set every test to that width so AntD reports xs only.
const IPHONE_SE_WIDTH = 375;
// AntD's `Grid.useBreakpoint()` follows Bootstrap-style breakpoints
// (sm = 576 / md = 768 / lg = 992 …), independent of our styled-component
// breakpoint constants. Pick a width inside [576, 768) so AntD reports
// `screens.sm = true` and `screens.md = false`.
const SMALL_TABLET_WIDTH = 600;

beforeEach(() => {
    setViewport(IPHONE_SE_WIDTH, "coarse");
    jest.clearAllMocks();

    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: user()
    });
    mockedUseAiEnabled.mockReturnValue({
        available: true,
        enabled: true,
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
    mockedUseAiChat.mockReturnValue({
        abort: jest.fn(),
        dismissError: jest.fn(),
        error: null,
        isLoading: false,
        messages: [],
        reset: jest.fn(),
        send: jest.fn().mockResolvedValue(undefined),
        streamingText: ""
    } as unknown as ReturnType<typeof useAiChat>);
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
/* 1. Header — wordmark hidden on tiny, account trigger has aria-label        */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header on mobile (iPhone SE)", () => {
    /**
     * The "Pulse" wordmark, the "Hi, {username}" greeting, and the down
     * chevron should all be hidden via CSS at narrow widths so the
     * header chrome stays compact and the right-cluster controls don't
     * push off-screen. The test asserts the trigger still exposes a
     * descriptive accessible name (the dropdown trigger is the only
     * affordance left for users to reach Logout / Theme / AI settings).
     */
    it("Header still exposes a labeled account-menu trigger on narrow viewports", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        // The pill trigger holds the avatar + greeting; greeting is hidden
        // via styled-component, but the aria-label must always carry the
        // username so the trigger remains accessible.
        const trigger = screen.getByRole("button", {
            name: /account menu for alice/i
        });
        expect(trigger).toBeInTheDocument();
    });

    it("Header brand link target is reachable on narrow viewports (labeled 'Pulse home')", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const brand = screen.getByRole("button", { name: /pulse home/i });
        expect(brand).toBeInTheDocument();
    });

    /**
     * Right-cluster controls (the inline theme toggle + the avatar) must
     * always be visible so the user can change theme without opening the
     * dropdown. The icon-only theme toggle is the most-tappable entry on
     * narrow widths.
     */
    it("Header keeps the dark-mode toggle visible and labeled at narrow viewports", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const toggle = screen.getByRole("button", {
            name: /switch to (dark|light) mode/i
        });
        expect(toggle).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Modals — confirm + cancel buttons stack full-width on mobile            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectModal on mobile", () => {
    /**
     * On phone widths the OK / Cancel buttons must be full-width via the
     * AntD `block` prop so a thumb has a generous tap target. AntD adds
     * the class `ant-btn-block` when `block: true` is set on the button,
     * so we assert that class lands on the visible Create button.
     */
    it("ProjectModal Create button is block (full-width) on mobile", async () => {
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
        const createBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find((btn) => /create project/i.test(btn.textContent ?? ""));
        expect(createBtn).toBeTruthy();
        if (createBtn) {
            expect(createBtn.className).toMatch(/ant-btn-block/);
        }
    });

    it("ProjectModal Cancel button is block (full-width) on mobile", async () => {
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
        const cancelBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) => (btn.textContent ?? "").trim().toLowerCase() === "cancel"
        );
        expect(cancelBtn).toBeTruthy();
        if (cancelBtn) {
            expect(cancelBtn.className).toMatch(/ant-btn-block/);
        }
    });
});

describe("UI quality :: TaskModal on mobile", () => {
    /**
     * On phone widths the TaskModal renders its custom footer in a column
     * stack — the visual order is Save → Cancel → Delete (destructive
     * last) so users do not accidentally tap Delete with a thumb reaching
     * for Save.
     */
    it("TaskModal footer is a column stack on mobile (no horizontal row)", async () => {
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
            const stacked = Array.from(
                footer.querySelectorAll<HTMLElement>("div")
            ).some((node) =>
                /flex-direction:\s*column/.test(
                    node.getAttribute("style") ?? ""
                )
            );
            expect(stacked).toBe(true);
        }
    });

    it("TaskModal Save button is full-width (block) on mobile", async () => {
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
        const saveBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find(
            (btn) => (btn.textContent ?? "").trim().toLowerCase() === "save"
        );
        expect(saveBtn).toBeTruthy();
        if (saveBtn) {
            expect(saveBtn.className).toMatch(/ant-btn-block/);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 3. Drawers — full viewport width on phone widths                            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: AiChatDrawer on mobile", () => {
    /**
     * The chat drawer must fill the viewport on phone widths. The drawer
     * width logic is `screens.md ? 400 : "100%"`. We assert the AntD
     * drawer wrapper renders the drawer at full width on iPhone SE.
     */
    it("AiChatDrawer fills the viewport on mobile (no fixed 400px width)", () => {
        const { baseElement } = render(
            <AiChatDrawer
                columns={[]}
                knownProjectIds={["p1"]}
                members={[member()]}
                onClose={jest.fn()}
                open
                project={project()}
                tasks={[]}
            />
        );

        // The AntD Drawer paints into a portal as `.ant-drawer-content-wrapper`
        // whose width style reflects the `size` prop. On mobile we expect
        // `width: 100%` (or absence of a px value).
        const wrapper = baseElement.querySelector<HTMLElement>(
            ".ant-drawer-content-wrapper"
        );
        // The drawer must mount somewhere in the tree.
        expect(wrapper).not.toBeNull();
        if (wrapper) {
            const inlineWidth = (
                wrapper.getAttribute("style") ?? ""
            ).toLowerCase();
            // The wrapper should not advertise a 400 px width on phone.
            expect(inlineWidth).not.toMatch(/width:\s*400px/);
        }
    });
});

describe("UI quality :: BoardBriefDrawer on mobile", () => {
    /**
     * Same contract as AiChatDrawer: the brief drawer is a 420 px side
     * panel on tablet+ and full viewport on phone. Pinning the contract
     * here means a future regression that hard-codes a px width is caught
     * at this single test.
     */
    it("BoardBriefDrawer fills the viewport on mobile (no fixed 420px width)", () => {
        const { baseElement } = render(
            <ProvidersWrap>
                <BoardBriefDrawer
                    columns={[]}
                    members={[member()]}
                    onClose={jest.fn()}
                    open
                    project={project()}
                    tasks={[]}
                />
            </ProvidersWrap>
        );

        const wrapper = baseElement.querySelector<HTMLElement>(
            ".ant-drawer-content-wrapper"
        );
        expect(wrapper).not.toBeNull();
        if (wrapper) {
            const inlineWidth = (
                wrapper.getAttribute("style") ?? ""
            ).toLowerCase();
            expect(inlineWidth).not.toMatch(/width:\s*420px/);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 4. ProjectList — mobile-friendly column count (no horizontal scroll)       */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectList on mobile", () => {
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
     * The project list now renders as a responsive card grid (one column on
     * mobile via `auto-fill, minmax(min(100%, 16rem), 1fr)`). Each card
     * shows the organization label and the created date inline in the body
     * / footer instead of inside hidden table cells, so the underlying
     * data stays in the DOM at every viewport.
     */
    it("ProjectList card on mobile keeps the organization + created labels in the DOM", () => {
        renderList();
        // Organization is rendered as a small uppercase label in the card
        // body; the date is rendered in the card footer.
        expect(screen.getByText("Product")).toBeInTheDocument();
        expect(screen.getByText(/Apr 25, 2026/)).toBeInTheDocument();
    });

    it("ProjectList exposes a list landmark on mobile (no nested horizontal scroll)", () => {
        renderList();
        expect(
            screen.getByRole("list", { name: /projects/i })
        ).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 5. LoginForm — full-width CTA, large input height                          */
/* -------------------------------------------------------------------------- */
describe("UI quality :: LoginForm on mobile", () => {
    /**
     * On mobile the login form must:
     *   - render a single primary action.
     *   - use AntD `size="large"` inputs so the touch target is honest
     *     (≥ 40 px height by default before our coarse-pointer lift).
     *   - keep the email field's `inputMode="email"` so the soft keyboard
     *     surfaces the @ key.
     */
    it("LoginForm email input declares inputMode='email' for the soft keyboard", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const email = screen.getByLabelText(/^email$/i);
        expect(email).toHaveAttribute("inputmode", "email");
    });

    it("LoginForm email input declares enterKeyHint so the soft keyboard shows 'next'", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const email = screen.getByLabelText(/^email$/i);
        // enterkeyhint="next" tells the soft keyboard to surface a "Next"
        // button so the user can advance to the password field.
        expect(email).toHaveAttribute("enterkeyhint", "next");
    });

    it("LoginForm password input declares enterKeyHint='go' so the keyboard shows a 'Go' button", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const password = screen.getByLabelText(/^password$/i);
        expect(password).toHaveAttribute("enterkeyhint", "go");
    });

    it("LoginForm renders a single primary CTA on mobile (no crowded button row)", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const form = screen
            .getByRole("button", {
                name: /^log in$/i
            })
            .closest("form");
        expect(form).not.toBeNull();
        if (form) {
            const buttons = form.querySelectorAll<HTMLButtonElement>("button");
            expect(buttons.length).toBe(1);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 6. Tablet (sm) — the breakpoint between mobile and desktop                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: tablet-edge (sm) behavior", () => {
    /**
     * Above sm but below md, the brand wordmark should reappear in the
     * header (it's hidden via `@media (max-width: ${breakpoints.sm - 1}px)`
     * — i.e. only hidden on the very narrowest viewports). At sm the
     * wordmark is back and the chevron is still hidden (chevron only
     * shows from md+).
     *
     * jsdom does not apply `@media`, so we instead pin the JS-driven
     * pieces: the trigger's accessible name, the brand button, and the
     * dark-mode toggle must all be rendered.
     */
    it("Header still exposes brand + dark-mode + account trigger at the sm breakpoint", () => {
        setViewport(SMALL_TABLET_WIDTH, "coarse");
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        expect(
            screen.getByRole("button", { name: /pulse home/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /switch to (dark|light) mode/i })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /account menu/i })
        ).toBeInTheDocument();
    });

    /**
     * At sm, AntD `Grid.useBreakpoint()` reports `screens.sm = true` but
     * `screens.md = false`. The ProjectModal should already be using
     * inline (non-block) buttons.
     */
    it("ProjectModal uses inline buttons at the sm breakpoint (sm = true, md = false)", async () => {
        setViewport(SMALL_TABLET_WIDTH, "coarse");
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
        const createBtn = Array.from(
            dialog.querySelectorAll<HTMLButtonElement>("button")
        ).find((btn) => /create project/i.test(btn.textContent ?? ""));
        expect(createBtn).toBeTruthy();
        if (createBtn) {
            expect(createBtn.className).not.toMatch(/ant-btn-block/);
        }
    });
});
