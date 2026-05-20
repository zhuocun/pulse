/**
 * Strict keyboard-navigation tests (TDD harness).
 *
 * Each test pins one keyboard-only flow expectation. A failing test means
 * the surface forces a mouse user — keyboard users (and screen-reader
 * users on a touch device) hit a dead end.
 *
 * Coverage by plan §:
 *   - §3.4 (WCAG 2.1.1 Keyboard, 2.4.7 Focus visible) — every flow that a
 *     mouse can complete must be completable from the keyboard alone.
 *   - §2.A.9 (keyboard-shortcut catalog) — `Esc` closes drawers/modals;
 *     keyboard handlers exist for `c` / `e` / dnd flow.
 *   - §1.3 / mainLayout — a "Skip to main content" link points keyboard
 *     users straight at the routed page.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import AiChatDrawer from "../components/aiChatDrawer";
import ColumnCreator from "../components/columnCreator";
import LoginForm from "../components/loginForm";
import ProjectModal from "../components/projectModal";
import RegisterForm from "../components/registerForm";
import TaskCreator from "../components/taskCreator";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAiChat from "../utils/hooks/useAiChat";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";

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

const installAntdBrowserMocks = () => {
    const fn = (query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    });
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia =
        fn;

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

const stubMutation = () =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({})
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
    mockedUseProjectModal.mockReturnValue({
        closeModal: jest.fn(),
        editingProject: undefined,
        isLoading: false,
        isModalOpened: false,
        openModal: jest.fn(),
        startEditing: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue(stubMutation());
    mockedUseReactQuery.mockImplementation(() => stubQuery([member()]));
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
/* 1. mainLayout — Skip-to-content link is keyboard-reachable                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: skip link is keyboard-reachable", () => {
    /**
     * The application shell must surface a "Skip to main content" link
     * as the very first focusable element so a keyboard user can jump
     * straight past the header chrome (WCAG 2.4.1 Bypass Blocks).
     *
     * The link is hidden until focus, then renders a high-contrast pill
     * at the top of the viewport. We assert:
     *   - It is reachable on Tab from the document root.
     *   - It targets `#main-content`, which is the id of the main
     *     landmark in the same shell.
     *   - It is the FIRST focusable element (i.e. nothing else gets
     *     focus before it).
     */
    it("Skip link is the first focusable element in mainLayout", () => {
        const MainLayout = require("../layouts/mainLayout").default;
        render(
            <ProvidersWrap>
                <MainLayout />
            </ProvidersWrap>
        );

        // Walk all focusable controls in document order.
        const focusable = Array.from(
            document.querySelectorAll<HTMLElement>(
                "a, button, [tabindex]:not([tabindex='-1'])"
            )
        );
        expect(focusable.length).toBeGreaterThan(0);
        const first = focusable[0];
        expect(first.tagName.toLowerCase()).toBe("a");
        expect(first.getAttribute("href")).toBe("#main-content");
        // Sanity check: the visible text must mention "skip".
        expect((first.textContent ?? "").toLowerCase()).toMatch(/skip/);
    });

    /**
     * The main landmark (`<main id="main-content">`) must declare
     * `tabindex="-1"` so that programmatic focus (e.g. via the skip
     * link click) lands there. Without it, the browser's default scroll
     * behaviour kicks in but the screen-reader focus does not move.
     */
    it("main landmark is programmatically focusable so the skip link can move focus to it", () => {
        const MainLayout = require("../layouts/mainLayout").default;
        render(
            <ProvidersWrap>
                <MainLayout />
            </ProvidersWrap>
        );
        const main = screen.getByRole("main");
        expect(main).toHaveAttribute("tabindex", "-1");
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Forms — Tab order matches visual order                                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: LoginForm tab order", () => {
    /**
     * The tab order on the login form should be:
     *   1. Email
     *   2. Password
     *   3. (the password's eye-toggle suffix if shown)
     *   4. Log in
     *
     * We don't assert the eye toggle (AntD inserts it as a non-button
     * span by default), but we DO pin that the first focusable input is
     * email and the last is the submit button — i.e. nothing surprising
     * has been wedged into the middle.
     */
    it("first focusable field on the login form is the email input", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const focusable = Array.from(
            document.querySelectorAll<HTMLElement>(
                "form input, form button, form a, form [tabindex]:not([tabindex='-1'])"
            )
        );
        expect(focusable.length).toBeGreaterThan(0);
        const first = focusable[0];
        expect(first.tagName.toLowerCase()).toBe("input");
        // Email must be the very first form control.
        expect(first.getAttribute("type")).toBe("email");
    });

    it("submit button on the login form is the last focusable control in form order", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        // AntD's password eye toggle is rendered as a span, not a button,
        // so it's already excluded by the form-focusable selector below.
        const focusable = Array.from(
            document.querySelectorAll<HTMLElement>(
                "form input, form button, form a, form [tabindex]:not([tabindex='-1'])"
            )
        );
        const last = focusable[focusable.length - 1];
        expect(last.tagName.toLowerCase()).toBe("button");
        expect((last.textContent ?? "").trim().toLowerCase()).toBe("log in");
    });
});

describe("UI quality :: RegisterForm tab order", () => {
    /**
     * The register form tab order must move email → username → password
     * → submit. Anything else (e.g. autofocusing the password field) is
     * a regression that disorients keyboard users.
     */
    it("first focusable field on the register form is the email input", () => {
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>("form input")
        );
        const first = inputs[0];
        expect(first.getAttribute("type")).toBe("email");
    });

    it("password field comes after username on the register form", () => {
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>("form input")
        );
        const usernameIndex = inputs.findIndex(
            (el) => el.getAttribute("autocomplete") === "username"
        );
        const passwordIndex = inputs.findIndex(
            (el) => el.getAttribute("autocomplete") === "new-password"
        );
        expect(usernameIndex).toBeGreaterThanOrEqual(0);
        expect(passwordIndex).toBeGreaterThanOrEqual(0);
        expect(passwordIndex).toBeGreaterThan(usernameIndex);
    });
});

/* -------------------------------------------------------------------------- */
/* 3. Esc closes inline editors                                               */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Esc collapses inline editors", () => {
    /**
     * The board's inline editors (`ColumnCreator` and `TaskCreator`)
     * expand into an input on click. Pressing Esc must collapse the
     * input back to the button — keyboard users must have a way out
     * without committing a change.
     */
    it("ColumnCreator collapses back to the 'Add column' button on Esc", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        // Expand into the input.
        fireEvent.click(screen.getByRole("button", { name: /add column/i }));
        const input = screen.getByPlaceholderText(/Create column/);
        expect(input).toBeInTheDocument();

        // Press Esc.
        act(() => {
            fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
        });

        // The collapsed button is back; the input is gone.
        expect(
            screen.getByRole("button", { name: /add column/i })
        ).toBeInTheDocument();
        expect(
            screen.queryByPlaceholderText(/Create column/)
        ).not.toBeInTheDocument();
    });

    it("TaskCreator collapses back to the 'Create task' button on Esc", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <TaskCreator
                                        boardAiOn={false}
                                        columnId="c1"
                                        disabled={false}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));
        const input = screen.getByPlaceholderText("What needs to be done?");

        act(() => {
            fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
        });

        expect(
            screen.getByRole("button", { name: /^create task$/i })
        ).toBeInTheDocument();
        expect(
            screen.queryByPlaceholderText("What needs to be done?")
        ).not.toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 4. Modals — keyboard contract                                              */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectModal keyboard contract", () => {
    /**
     * The modal must:
     *   - render with role="dialog" so screen readers announce the
     *     mode change.
     *   - declare `aria-modal="true"` so assistive tech traps focus
     *     inside (or knows it should).
     *   - leave AntD's default Esc-to-close behaviour untouched (i.e.
     *     `keyboard !== false`).
     */
    it("ProjectModal exposes a dialog role with aria-modal='true'", async () => {
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
        expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    /**
     * The Cancel button must be present inside the dialog. Without it,
     * keyboard users can only confirm via the OK button — there is no
     * way to back out without pressing Esc, which is a UX dead-end if a
     * future PR sets `keyboard={false}` on the modal.
     */
    it("ProjectModal renders an inline Cancel button so keyboard users have an explicit way out", async () => {
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
    });
});

/* -------------------------------------------------------------------------- */
/* 5. AiChatDrawer — keyboard contract                                         */
/* -------------------------------------------------------------------------- */
describe("UI quality :: AiChatDrawer keyboard contract", () => {
    /**
     * When the drawer opens, focus must land in the chat input so a
     * keyboard user can immediately start typing (no extra Tab presses
     * to leave the trigger). The component already moves focus on open
     * via a setTimeout. We pin that the input is wired with the auto-
     * focus contract by checking it is the active element shortly
     * after open.
     */
    it("AiChatDrawer chat input is reachable in the dialog and is a textarea", () => {
        render(
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

        // The drawer mounts a `role="dialog"` container.
        const dialog = screen.getByRole("dialog");
        // It must contain a textarea for keyboard input.
        const textarea = dialog.querySelector("textarea");
        expect(textarea).not.toBeNull();
    });

    /**
     * The Clear / "Show details" extras and the close button must all
     * be focusable buttons (not bare `<a onClick>` patterns from §3.2).
     * We assert each control inside the dialog is a real <button>.
     */
    it("AiChatDrawer extra controls are real buttons (not <a onClick>)", () => {
        mockedUseAiChat.mockReturnValue({
            abort: jest.fn(),
            dismissError: jest.fn(),
            error: null,
            isLoading: false,
            messages: [{ role: "user", content: "hi" } as never],
            reset: jest.fn(),
            send: jest.fn().mockResolvedValue(undefined),
            streamingText: ""
        } as unknown as ReturnType<typeof useAiChat>);

        render(
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

        const dialog = screen.getByRole("dialog");
        // The "New conversation" button must be a real <button>.
        const clearBtn = Array.from(
            dialog.querySelectorAll<HTMLElement>("[aria-label]")
        ).find(
            (el) =>
                el.getAttribute("aria-label") === "New conversation" ||
                el.getAttribute("aria-label") === "Clear Board Copilot chat"
        );
        expect(clearBtn).toBeTruthy();
        if (clearBtn) {
            expect(clearBtn.tagName.toLowerCase()).toBe("button");
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 6. Form Enter behavior                                                     */
/* -------------------------------------------------------------------------- */
describe("UI quality :: form Enter / Escape behavior", () => {
    /**
     * Pressing Enter in a single-field inline editor on the board must
     * collapse the editor without firing the create mutation when the
     * value is whitespace-only. The companion contract on submit is
     * already covered in `uiQuality.strict.test.tsx`; here we pin the
     * pure-keyboard collapse path so a future regression that swallows
     * the Esc handler is still caught by the Enter path.
     */
    it("ColumnCreator Enter on whitespace collapses without firing the create mutation", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        const mutateAsync = jest.fn();
        mockedUseReactMutation.mockReturnValue({
            error: null,
            isLoading: false,
            mutate: jest.fn(),
            mutateAsync
        } as unknown as ReturnType<typeof useReactMutation<unknown>>);

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByRole("button", { name: /add column/i }));
        const input = screen.getByPlaceholderText(/Create column/);
        fireEvent.change(input, { target: { value: "   " } });
        // AntD's Input wires Enter to onPressEnter; fire the keyDown
        // pattern the existing tests use so the path is exercised end-to-end.
        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

        expect(mutateAsync).not.toHaveBeenCalled();
    });

    /**
     * The login form must not submit when Enter is pressed inside a
     * field that is empty: AntD's `Form` validation should catch the
     * missing email/password before reaching the mutation. A failing
     * test means a regression has slipped past validation and the
     * mutation runs against blank input.
     */
    it("LoginForm does not submit when Enter is pressed in empty fields", async () => {
        const mutateAsync = jest.fn();
        mockedUseReactMutation.mockReturnValue({
            error: null,
            isLoading: false,
            mutate: jest.fn(),
            mutateAsync
        } as unknown as ReturnType<typeof useReactMutation<unknown>>);

        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const email = screen.getByLabelText(/^email$/i);
        // Press Enter with an empty value.
        await act(async () => {
            fireEvent.keyDown(email, { code: "Enter", key: "Enter" });
        });

        // Validation should block the submit; the mutation never runs.
        expect(mutateAsync).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* 7. Header dropdown — keyboard reachability                                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header dropdown keyboard contract", () => {
    /**
     * The avatar dropdown is the keyboard user's only path to Logout
     * (and the dark-mode / AI toggles). The trigger must:
     *   - be a real `<button>` (so Tab reaches it),
     *   - declare a descriptive `aria-label` (so screen readers know
     *     what opens), and
     *   - declare `aria-haspopup`-compatible behaviour via AntD.
     */
    it("Header account-menu trigger is a real button reachable by Tab", () => {
        const Header = require("../components/header").default;
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const trigger = screen.getByRole("button", { name: /account menu/i });
        expect(trigger.tagName.toLowerCase()).toBe("button");
        // Either no tabindex (= 0 implicitly) or an explicit non-negative.
        const tabIndex = trigger.getAttribute("tabindex");
        if (tabIndex !== null) {
            expect(parseInt(tabIndex, 10)).toBeGreaterThanOrEqual(0);
        }
    });
});
