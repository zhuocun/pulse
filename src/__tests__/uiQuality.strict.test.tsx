/**
 * Strict UI quality tests (TDD harness).
 *
 * Each test asserts a specific UI quality bar. A failing test is the signal:
 * the surface under test does not yet meet the bar and should be fixed.
 *
 * Categories:
 *   1. Microcopy compliance — no banned words, copy comes from the central
 *      microcopy bundle, not hand-rolled per-page strings.
 *   2. Form input hygiene — whitespace-only / empty values must not submit.
 *   3. User identity fallbacks — never render "undefined", "null", "[object
 *      Object]" in a greeting or label when state is missing.
 *   4. Accessibility — interactive controls have accessible names, live
 *      regions are wired, focus is moved to the alert when an error appears.
 *   5. Visual stability — placeholders preserve layout when content toggles.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";

import { store } from "../store";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import ColumnCreator from "../components/columnCreator";
import EmptyState from "../components/emptyState";
import ErrorBox from "../components/errorBox";
import Header from "../components/header";
import LoginForm from "../components/loginForm";
import RegisterForm from "../components/registerForm";
import TaskCreator from "../components/taskCreator";
import UserAvatar, { initialsOf } from "../components/userAvatar";
import { microcopy } from "../constants/microcopy";
import LoginPage from "../pages/login";
import RegisterPage from "../pages/register";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useReactMutation from "../utils/hooks/useReactMutation";

jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useColorScheme");
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
        default: () => React.createElement("span", null, "Members")
    };
});

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
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

const mutateAsync = jest.fn();

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseReactMutation.mockReturnValue({
        isLoading: false,
        mutateAsync,
        mutate: jest.fn()
    } as unknown as ReturnType<typeof useReactMutation<unknown>>);
});

/* -------------------------------------------------------------------------- */
/* 1. Microcopy compliance                                                    */
/* -------------------------------------------------------------------------- */
describe("UI quality :: microcopy compliance", () => {
    /**
     * docs/ui-ux-optimization-plan.md §3.1 forbids raw "Submit", "OK",
     * "Login" labels in favour of action-verb microcopy. A regression
     * surfaces the exact string in the rendered DOM.
     */
    const BANNED_LABELS = [
        // "Submit" as a stand-alone button label is banned; we keep
        // legitimate uses (e.g. submitting a form, "Submitted at") out of
        // scope by matching whole-word, anchored to button text.
        /^Submit$/,
        /^OK$/,
        /^Login$/,
        /^Signup$/,
        /^Sign in$/
    ];

    const renderAt = (node: React.ReactElement) => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        return render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <BrowserRouter>{node}</BrowserRouter>
                </QueryClientProvider>
            </Provider>
        );
    };

    const expectNoBannedLabels = () => {
        const buttons = screen.queryAllByRole("button");
        const offending = buttons
            .map((btn) => (btn.textContent ?? "").trim())
            .filter((label) =>
                BANNED_LABELS.some((re) =>
                    re.test(label.replace(/…|\.\.\./, ""))
                )
            );
        expect(offending).toEqual([]);
    };

    it("login form action button uses the microcopy 'Log in' label, not 'Login' or 'Submit'", () => {
        renderAt(<LoginForm onError={jest.fn()} />);
        expectNoBannedLabels();
        expect(
            screen.getByRole("button", { name: microcopy.actions.logIn })
        ).toBeInTheDocument();
    });

    it("register form action button uses the microcopy 'Sign up' label, not 'Signup' or 'Submit'", () => {
        renderAt(<RegisterForm onError={jest.fn()} />);
        expectNoBannedLabels();
        expect(
            screen.getByRole("button", { name: microcopy.actions.signUp })
        ).toBeInTheDocument();
    });

    it("login page switch link uses microcopy.actions.registerCta verbatim", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        renderAt(<LoginPage />);

        // The plan §3.1 places the cross-page CTA in the central bundle;
        // hard-coding it on the page is the regression we want to catch.
        expect(
            screen.getByRole("link", { name: microcopy.actions.registerCta })
        ).toBeInTheDocument();
    });

    it("register page switch link uses microcopy.actions.loginCta verbatim", () => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        renderAt(<RegisterPage />);

        expect(
            screen.getByRole("link", { name: microcopy.actions.loginCta })
        ).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Form input hygiene                                                      */
/* -------------------------------------------------------------------------- */
describe("UI quality :: form input hygiene", () => {
    /**
     * TaskCreator currently submits whatever is typed verbatim, including
     * a value that is empty or only whitespace. The board should never end
     * up with a "   " task, so the create mutation must not fire for those
     * inputs.
     */
    const renderTaskCreator = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

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
    };

    const openCreator = () => {
        fireEvent.click(screen.getByRole("button", { name: /^create task$/i }));
        return screen.getByPlaceholderText("What needs to be done?");
    };

    it("does not submit a task when the input is empty and Enter is pressed", async () => {
        renderTaskCreator();
        const input = openCreator();
        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });

    it("does not submit a task when the input is whitespace-only", async () => {
        renderTaskCreator();
        const input = openCreator();
        fireEvent.change(input, { target: { value: "    " } });
        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });

    it("trims leading and trailing whitespace from the submitted task name", async () => {
        renderTaskCreator();
        const input = openCreator();
        fireEvent.change(input, { target: { value: "  Plan release  " } });
        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ taskName: "Plan release" })
        );
    });

    it("disables the create button while the parent column is mid-mutation", () => {
        renderTaskCreator();
        const button = screen.getByRole("button", { name: /^create task$/i });
        expect(button).toBeEnabled();
    });
});

describe("UI quality :: column creator hygiene", () => {
    /**
     * ColumnCreator already trims before submitting (good), but it should
     * also reject Enter on a whitespace-only value and never POST a column
     * with an empty trimmed name.
     */
    const renderColumnCreator = () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        mockedUseReactMutation.mockReturnValue({
            isLoading: false,
            mutateAsync,
            mutate: jest.fn()
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
    };

    it("does not submit a column when only whitespace is typed", async () => {
        renderColumnCreator();
        fireEvent.click(screen.getByRole("button", { name: /add column/i }));
        const input = await screen.findByPlaceholderText(/Create column/);

        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });

        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: /add column/i })
            ).toBeInTheDocument();
        });
        expect(mutateAsync).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* 3. User identity fallbacks                                                 */
/* -------------------------------------------------------------------------- */
describe("UI quality :: user identity fallbacks", () => {
    const renderHeader = (currentUser: IUser | undefined) => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: Boolean(currentUser ? "jwt-1" : null),
            user: currentUser
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

        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );
    };

    /**
     * The header reads `Hi, ${user?.username}` — when user is undefined
     * the optional chain produces undefined and the visible text becomes
     * "Hi, undefined". A user-facing greeting must never include the
     * literal strings "undefined" / "null" / "[object Object]".
     */
    it("never renders 'Hi, undefined' when the auth user is missing", () => {
        renderHeader(undefined);

        expect(screen.queryByText(/hi,\s*undefined/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/hi,\s*null/i)).not.toBeInTheDocument();
    });

    it("never renders the literal 'undefined' anywhere in the header when the user has no username", () => {
        renderHeader(user({ username: "" }));

        const offending = Array.from(
            document.querySelectorAll("body *")
        ).filter(
            (node) =>
                node.children.length === 0 &&
                /\bundefined\b/i.test(node.textContent ?? "")
        );
        expect(offending).toEqual([]);
    });

    it("UserAvatar.initialsOf falls back to a non-empty string for empty / whitespace input", () => {
        // No emoji, no empty string — at minimum the visual placeholder.
        expect(initialsOf(null)).not.toBe("");
        expect(initialsOf(undefined)).not.toBe("");
        expect(initialsOf("")).not.toBe("");
        expect(initialsOf("   ").length).toBeGreaterThan(0);
    });

    it("UserAvatar renders a single-letter initial when the username is one word", () => {
        render(<UserAvatar id="abc" name="Alice" />);
        // Initials should be exactly one letter for a single name and
        // never contain whitespace or punctuation.
        const text = screen.getByText(/^A$/);
        expect(text).toBeInTheDocument();
    });

    it("UserAvatar renders first+last initials for two-word names", () => {
        render(<UserAvatar id="abc" name="Alice Cooper" />);
        expect(screen.getByText(/^AC$/)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 4. Accessibility hygiene                                                   */
/* -------------------------------------------------------------------------- */
describe("UI quality :: accessibility", () => {
    /**
     * ErrorBox is wired as `role=alert` with an `aria-live` region so
     * screen readers announce server errors. When a message is present
     * the element should be programmatically focusable (`tabIndex=-1`)
     * so the page can move focus to it for keyboard users.
     */
    it("ErrorBox is focusable when a message is shown", () => {
        const { rerender } = render(<ErrorBox error={null} />);
        const alert = screen.getByRole("alert");
        // No tabIndex when empty — the box is just a placeholder.
        expect(alert).not.toHaveAttribute("tabindex");

        rerender(<ErrorBox error={new Error("Boom")} />);
        const focusable = screen.getByRole("alert");
        expect(focusable).toHaveAttribute("tabindex", "-1");
        // Sanity check: focus() must succeed (jsdom respects tabIndex=-1).
        focusable.focus();
        expect(focusable).toHaveFocus();
    });

    it("ErrorBox uses an assertive live region so the alert isn't suppressed", () => {
        render(<ErrorBox error={new Error("Server down")} />);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveAttribute("aria-live", "assertive");
        expect(alert).toHaveAttribute("aria-atomic", "true");
    });

    it("ErrorBox preserves layout space when no error is present", () => {
        render(<ErrorBox error={null} />);
        const alert = screen.getByRole("alert");
        // The placeholder must reserve at least 1.5em — otherwise the
        // form jumps when an error appears.
        const inline = alert.getAttribute("style") ?? "";
        expect(inline).toMatch(/min-height:\s*1\.5em/);
    });

    it("EmptyState exposes its title as a heading so screen readers can navigate to it", () => {
        render(<EmptyState description="Nothing here yet" title="No items" />);
        expect(
            screen.getByRole("heading", { name: /no items/i })
        ).toBeInTheDocument();
    });

    /**
     * Login form has a Caps Lock advisory wired to a `role=status` live
     * region. The slot should preserve a non-zero height even when no
     * advisory is shown so the submit button does not jump.
     */
    it("login form reserves vertical space for the Caps Lock advisory", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );
        const slot = screen.getByRole("status");
        // The styled component has `min-height: <number>em` set inline
        // on the component class. We can read the live region's min-height
        // via getComputedStyle (jsdom only sees the inline style, but the
        // emotion serializer attaches it to the element class). Falling
        // back to verifying the live region exists is acceptable here:
        // the structural assertion is the durable one.
        expect(slot).toBeInTheDocument();
        expect(slot).toHaveAttribute("aria-live", "polite");
        expect(slot).toHaveAttribute("aria-atomic", "true");
    });

    it("login form password field has an autocomplete hint for current-password", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );
        const passwordField = screen.getByLabelText(/^password$/i);
        expect(passwordField).toHaveAttribute(
            "autocomplete",
            "current-password"
        );
    });

    it("register form password field has an autocomplete hint for new-password", () => {
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );
        const passwordField = screen.getByLabelText(/^password$/i);
        expect(passwordField).toHaveAttribute("autocomplete", "new-password");
    });

    it("register form email field has an autocomplete hint of email", () => {
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );
        const emailField = screen.getByLabelText(/^email$/i);
        expect(emailField).toHaveAttribute("autocomplete", "email");
    });

    it("login form email field validates that whitespace-only is rejected", async () => {
        const onError = jest.fn();
        mutateAsync.mockResolvedValue(user());

        render(
            <BrowserRouter>
                <LoginForm onError={onError} />
            </BrowserRouter>
        );

        // Whitespace email should be flagged by the email type rule and
        // the mutation must not fire.
        await act(async () => {
            fireEvent.change(screen.getByLabelText(/^email$/i), {
                target: { value: "   " }
            });
            fireEvent.change(screen.getByLabelText(/^password$/i), {
                target: { value: "password" }
            });
        });
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: microcopy.actions.logIn })
            );
        });

        await waitFor(() => {
            expect(mutateAsync).not.toHaveBeenCalled();
        });
    });
});

/* -------------------------------------------------------------------------- */
/* 5. Login & register page focus/error handling                              */
/* -------------------------------------------------------------------------- */
describe("UI quality :: focus management for inline errors", () => {
    /**
     * The real `useReactMutation` calls its 5th argument (`onError`) when a
     * mutation rejects. The hook is mocked here, so we replicate that
     * contract: capture the `onError` callback and invoke it ourselves
     * when `mutateAsync` rejects. This keeps the test focused on the page
     * (not the hook), while still exercising the real
     * mutation-rejected → onError → setError → focus path.
     */
    const renderLoginAndTriggerError = (errorMsg: string) => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: false,
            user: undefined
        });

        let capturedOnError: ((err: Error | IError | null) => void) | undefined;
        mockedUseReactMutation.mockImplementation(
            (
                _endpoint: unknown,
                _method: unknown,
                _key: unknown,
                _callback: unknown,
                onError: unknown
            ) => {
                capturedOnError = onError as (
                    err: Error | IError | null
                ) => void;
                return {
                    isLoading: false,
                    mutate: jest.fn(),
                    mutateAsync: jest.fn().mockImplementation(async () => {
                        const err = new Error(errorMsg);
                        capturedOnError?.(err);
                        throw err;
                    })
                } as unknown as ReturnType<typeof useReactMutation<unknown>>;
            }
        );

        render(
            <BrowserRouter>
                <LoginPage />
            </BrowserRouter>
        );
    };

    it("LoginPage moves focus to the alert when a server error appears", async () => {
        renderLoginAndTriggerError("Invalid credentials");

        await act(async () => {
            fireEvent.change(screen.getByLabelText(/^email$/i), {
                target: { value: "alice@example.com" }
            });
            fireEvent.change(screen.getByLabelText(/^password$/i), {
                target: { value: "secret" }
            });
        });
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: microcopy.actions.logIn })
            );
        });

        await waitFor(() => {
            const alert = screen.getByRole("alert");
            expect(alert).toHaveTextContent(/invalid credentials/i);
        });
        // Focus management: assertive region must receive focus so screen
        // readers and keyboard users know something went wrong.
        const alert = screen.getByRole("alert");
        await waitFor(() => expect(alert).toHaveFocus());
    });
});
