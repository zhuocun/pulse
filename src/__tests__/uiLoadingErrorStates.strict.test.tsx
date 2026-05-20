/**
 * Strict loading- and error-state tests (TDD harness).
 *
 * Each test pins one expectation about how a surface should behave when
 * data is loading or when a fetch fails. A failing test means the
 * surface either shows a stale skeleton, swallows an error silently, or
 * fails to announce a state change to assistive tech.
 *
 * Coverage by plan §:
 *   - §3.5 (Loading states) — replace bare `<Spin>` with `<Skeleton>` of
 *     the right shape; throttle spinners.
 *   - §3.6 (Empty states) — every empty surface has a CTA.
 *   - §3.7 (Error states) — top-of-board `<Alert>` with a Retry button.
 *   - §3.4 (4.1.3 Status messages) — `aria-live="polite"` on filter
 *     count, optimistic update toasts, AI suggestion arrival.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import EmptyState from "../components/emptyState";
import ErrorBoundary from "../components/errorBoundary";
import ErrorBox from "../components/errorBox";
import ProjectList from "../components/projectList";
import { microcopy } from "../constants/microcopy";
import BoardPage from "../pages/board";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";

jest.mock("../utils/hooks/useAiEnabled", () => ({
    __esModule: true,
    default: jest.fn(),
    useAutonomyLevel: jest.fn(() => ({ level: "plan", setLevel: jest.fn() }))
}));
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useProjectModal");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
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

const stubMutation = () =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({})
    }) as unknown as ReturnType<typeof useReactMutation<unknown>>;

const stubQuery = (
    overrides: Partial<{
        data: unknown;
        error: unknown;
        isLoading: boolean;
    }>
) =>
    ({
        data: overrides.data ?? undefined,
        error: overrides.error ?? null,
        isLoading: overrides.isLoading ?? false,
        isSuccess: !overrides.error,
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
    mockedUseProjectModal.mockReturnValue({
        closeModal: jest.fn(),
        editingProject: undefined,
        isLoading: false,
        isModalOpened: false,
        openModal: jest.fn(),
        startEditing: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue(stubMutation());
});

const ProvidersWrap = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });
    return (
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={children}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

/* -------------------------------------------------------------------------- */
/* 1. Board loading skeleton — aria-busy + skeleton shape match               */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Board loading skeleton", () => {
    /**
     * §3.5 says skeletons must match the final element's bounding box.
     * The board's loading state ships three column-shaped skeletons.
     * We assert the loading container declares `aria-busy="true"` so
     * screen readers know the region is updating, and that it carries
     * a descriptive `aria-label`.
     */
    it("Board renders an aria-busy='true' loading region while board data loads", () => {
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return stubQuery({ isLoading: true });
            }
            if (endpoint === "tasks") {
                return stubQuery({ isLoading: true });
            }
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({ isLoading: true });
            }
            return stubQuery({});
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        const busy = document.querySelector("[aria-busy='true']");
        expect(busy).not.toBeNull();
    });

    it("Board loading skeleton has a descriptive aria-label so screen readers announce the loading state", () => {
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return stubQuery({ isLoading: true });
            }
            if (endpoint === "tasks") {
                return stubQuery({ isLoading: true });
            }
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({ isLoading: true });
            }
            return stubQuery({});
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        const busy = document.querySelector("[aria-busy='true'][aria-label]");
        expect(busy).not.toBeNull();
        if (busy) {
            const label = busy.getAttribute("aria-label") ?? "";
            // The label must communicate "loading" to screen readers.
            expect(label.toLowerCase()).toMatch(/load|loading/);
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Board error state — Alert + Retry button                                */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Board error state", () => {
    /**
     * §3.7 — when the board fetch fails, the page must render a
     * top-of-board `<Alert>` with a Retry button. The button must be
     * keyboard-reachable and labeled with the microcopy retry verb.
     */
    it("Board renders an Alert + Retry button when board fetch fails", () => {
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return stubQuery({
                    data: undefined,
                    error: new Error("Network down")
                });
            }
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({ data: { _id: "p1", projectName: "P" } });
            }
            return stubQuery({ data: [] });
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        // The microcopy retry button is the canonical signal.
        const retry = screen.getByRole("button", {
            name: new RegExp(`^${microcopy.actions.retry}$`, "i")
        });
        expect(retry).toBeInTheDocument();
    });

    /**
     * Clicking Retry must call `refetch` on the failed query. The hook
     * is mocked here so we capture the spy and assert it fires once.
     */
    it("Board Retry button calls refetch on the failed boards query", () => {
        const refetchBoards = jest.fn();

        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return {
                    data: undefined,
                    error: new Error("Network down"),
                    isLoading: false,
                    isSuccess: false,
                    refetch: refetchBoards
                } as unknown as ReturnType<typeof useReactQuery<unknown>>;
            }
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({
                    data: { _id: "p1", projectName: "P" }
                });
            }
            return stubQuery({ data: [] });
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        act(() => {
            fireEvent.click(
                screen.getByRole("button", {
                    name: new RegExp(`^${microcopy.actions.retry}$`, "i")
                })
            );
        });

        expect(refetchBoards).toHaveBeenCalledTimes(1);
    });

    /**
     * The failure Alert must use `role="alert"` (or contain it) so screen
     * readers immediately announce the error.
     */
    it("Board failure Alert is announced via role='alert'", () => {
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return stubQuery({
                    data: undefined,
                    error: new Error("Network down")
                });
            }
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({
                    data: { _id: "p1", projectName: "P" }
                });
            }
            return stubQuery({ data: [] });
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        // AntD's Alert renders with role="alert" by default.
        const alerts = screen.getAllByRole("alert");
        expect(alerts.length).toBeGreaterThanOrEqual(1);
    });
});

/* -------------------------------------------------------------------------- */
/* 3. Board empty state — heading + helpful description                       */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Board empty state", () => {
    /**
     * When the board has zero columns, render the canonical empty
     * state: heading from `microcopy.empty.board.title`, description
     * from `microcopy.empty.board.description`. A failing test means
     * the board falls back to a bare ColumnCreator with no guidance.
     */
    it("Board empty state shows the microcopy title heading when there are zero columns", () => {
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") return stubQuery({ data: [] });
            if (endpoint === "tasks") return stubQuery({ data: [] });
            if (endpoint === "users/members") {
                return stubQuery({ data: [member()] });
            }
            if (endpoint === "projects") {
                return stubQuery({
                    data: { _id: "p1", projectName: "Roadmap" }
                });
            }
            return stubQuery({});
        });

        render(
            <ProvidersWrap>
                <BoardPage />
            </ProvidersWrap>
        );

        // Heading match — the EmptyState forces level={5} today; the
        // semantic-structure test in `uiSemanticStructure.strict.test.tsx`
        // already pins the configurability gap. Here we just match the
        // text content via `heading` role.
        const heading = screen.getByRole("heading", {
            name: new RegExp(microcopy.empty.board.title, "i")
        });
        expect(heading).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 4. ErrorBoundary — friendly fallback                                        */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ErrorBoundary fallback", () => {
    /**
     * §3.7 — wrap routed pages in an ErrorBoundary so a JS crash
     * doesn't show the user a blank page. The component must:
     *   - render a friendly title from `microcopy.feedback.renderFailed`,
     *   - offer a "Reload page" CTA that hits `microcopy.feedback.reloadPage`,
     *   - announce the failure via `role="alert"`.
     */
    const Boom = () => {
        throw new Error("Boom");
    };

    /**
     * Suppress the noisy JSDOM-level error log that React emits when an
     * uncaught error reaches an ErrorBoundary. We still propagate
     * unrelated logs by deferring to the original handler for anything
     * not from the React error path.
     */
    const silenceErrorBoundaryLogs = () => {
        // eslint-disable-next-line no-console
        const original = console.error;
        return jest.spyOn(console, "error").mockImplementation((...args) => {
            const msg = args.map(String).join(" ");
            if (
                msg.includes("Error: Boom") ||
                msg.includes("ErrorBoundary") ||
                msg.includes("not wrapped in act") ||
                msg.includes("The above error occurred")
            ) {
                return;
            }
            original(...args);
        });
    };

    it("ErrorBoundary renders the canonical fallback heading on a child crash", () => {
        const spy = silenceErrorBoundaryLogs();
        try {
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>
            );
            // The fallback ships a heading bearing the microcopy text.
            expect(
                screen.getByText(
                    new RegExp(microcopy.feedback.renderFailed, "i")
                )
            ).toBeInTheDocument();
        } finally {
            spy.mockRestore();
        }
    });

    it("ErrorBoundary fallback offers a 'Reload page' CTA", () => {
        const spy = silenceErrorBoundaryLogs();
        try {
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>
            );
            const reload = screen.getByRole("button", {
                name: new RegExp(microcopy.feedback.reloadPage, "i")
            });
            expect(reload).toBeInTheDocument();
        } finally {
            spy.mockRestore();
        }
    });

    it("ErrorBoundary fallback announces via role='alert'", () => {
        const spy = silenceErrorBoundaryLogs();
        try {
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>
            );
            // At least one role=alert surfaces the crash.
            const alerts = screen.getAllByRole("alert");
            expect(alerts.length).toBeGreaterThanOrEqual(1);
        } finally {
            spy.mockRestore();
        }
    });
});

/* -------------------------------------------------------------------------- */
/* 5. ProjectList loading state                                                */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectList loading state", () => {
    /**
     * AntD's `Table` flips `aria-busy` on its body via the `loading`
     * prop. We assert that passing `loading={true}` surfaces a busy
     * indicator (so screen-readers announce the wait) AND the empty
     * state CTA is NOT rendered while loading (it would be a misleading
     * call-to-action while fetch is in flight).
     */
    it("ProjectList renders an aria-busy region when loading is true", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        const { container } = render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={
                                    <ProjectList
                                        dataSource={undefined}
                                        loading
                                        members={[member()]}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        // AntD wraps the Spin in an element with `aria-busy="true"` or
        // a `.ant-spin-container` whose parent carries the spin state.
        const busy =
            container.querySelector("[aria-busy='true']") ||
            container.querySelector(".ant-spin-spinning");
        expect(busy).not.toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* 6. EmptyState exposes a CTA verbatim                                       */
/* -------------------------------------------------------------------------- */
describe("UI quality :: EmptyState CTA delivery", () => {
    /**
     * §3.6 — every empty surface must offer a CTA. The `EmptyState`
     * component must render the `cta` child with no wrapper that
     * suppresses pointer events or hides the button from the
     * accessibility tree.
     */
    it("EmptyState CTA fires its onClick when clicked", () => {
        const onClick = jest.fn();
        render(
            <EmptyState
                cta={
                    <button onClick={onClick} type="button">
                        Create your first project
                    </button>
                }
                description="Get started"
                title="No projects yet"
            />
        );

        const btn = screen.getByRole("button", {
            name: /create your first project/i
        });
        fireEvent.click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

/* -------------------------------------------------------------------------- */
/* 7. ErrorBox shifts focus when the message changes from null → text         */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ErrorBox transition behavior", () => {
    /**
     * The `ErrorBox` is the in-page error region. When an error comes
     * in, the surrounding form's `useEffect` is responsible for moving
     * focus to it. The contract this test pins: re-rendering with a
     * non-null error must keep the alert role attached and replace the
     * empty placeholder text with the message.
     *
     * The aria-live + role=alert wiring is already covered by
     * `uiQuality.strict.test.tsx`; here we cover the transition path
     * specifically.
     */
    it("ErrorBox swaps placeholder for the resolved message when the error transitions", () => {
        const { rerender } = render(<ErrorBox error={null} />);
        const alert = screen.getByRole("alert");
        expect((alert.textContent ?? "").trim()).toBe("");

        rerender(<ErrorBox error={new Error("Network down")} />);
        const next = screen.getByRole("alert");
        expect(next.textContent ?? "").toMatch(/network down/i);
    });

    /**
     * When the error returns to null, the alert must clear so the form
     * does not announce a stale message. (This catches a regression
     * where a useEffect dependency keeps the last message frozen.)
     */
    it("ErrorBox clears the message when the error transitions back to null", () => {
        const { rerender } = render(
            <ErrorBox error={new Error("Network down")} />
        );
        rerender(<ErrorBox error={null} />);
        const alert = screen.getByRole("alert");
        expect((alert.textContent ?? "").trim()).toBe("");
    });
});
