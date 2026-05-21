/**
 * Loading / error state behavior tests:
 *
 *   - Board Retry button calls refetch on the failed boards query.
 *   - ErrorBoundary renders a friendly fallback when a child crashes.
 *   - EmptyState CTA fires onClick.
 *   - ErrorBox swaps placeholder for resolved message when error transitions.
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import EmptyState from "../components/emptyState";
import ErrorBoundary from "../components/errorBoundary";
import ErrorBox from "../components/errorBox";
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

const member: IMember = {
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice"
};

const user: IUser = {
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice"
};

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
        refetch: jest.Mock;
    }>
) =>
    ({
        data: overrides.data ?? undefined,
        error: overrides.error ?? null,
        isLoading: overrides.isLoading ?? false,
        isSuccess: !overrides.error,
        refetch: overrides.refetch ?? jest.fn()
    }) as unknown as ReturnType<typeof useReactQuery<unknown>>;

beforeAll(() => {
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
});

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user
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

describe("Board error state — Retry behavior", () => {
    it("Retry button calls refetch on the failed boards query", async () => {
        const refetchBoards = jest.fn();
        mockedUseReactQuery.mockImplementation((endpoint: string) => {
            if (endpoint === "boards") {
                return stubQuery({
                    data: undefined,
                    error: new Error("Network down"),
                    refetch: refetchBoards
                });
            }
            if (endpoint === "users/members")
                return stubQuery({ data: [member] });
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

        const userEv = userEvent.setup();
        await userEv.click(
            screen.getByRole("button", {
                name: new RegExp(`^${microcopy.actions.retry}$`, "i")
            })
        );

        expect(refetchBoards).toHaveBeenCalledTimes(1);
    });
});

describe("ErrorBoundary fallback", () => {
    const Boom = () => {
        throw new Error("Boom");
    };

    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {
            // Silence the React-emitted error boundary log.
        });
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it("renders the friendly fallback heading on a child crash", () => {
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>
        );
        expect(
            screen.getByText(new RegExp(microcopy.feedback.renderFailed, "i"))
        ).toBeInTheDocument();
    });

    it("offers a 'Reload page' CTA in the fallback", () => {
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>
        );
        expect(
            screen.getByRole("button", {
                name: new RegExp(microcopy.feedback.reloadPage, "i")
            })
        ).toBeInTheDocument();
    });
});

describe("EmptyState CTA delivery", () => {
    it("fires its onClick when clicked", () => {
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
        fireEvent.click(
            screen.getByRole("button", {
                name: /create your first project/i
            })
        );
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe("ErrorBox transition behavior", () => {
    it("swaps placeholder for the resolved message when the error transitions", () => {
        const { rerender } = render(<ErrorBox error={null} />);
        expect((screen.getByRole("alert").textContent ?? "").trim()).toBe("");

        rerender(<ErrorBox error={new Error("Network down")} />);
        expect(screen.getByRole("alert").textContent ?? "").toMatch(
            /network down/i
        );
    });

    it("clears the message when the error transitions back to null", () => {
        const { rerender } = render(
            <ErrorBox error={new Error("Network down")} />
        );
        rerender(<ErrorBox error={null} />);
        expect((screen.getByRole("alert").textContent ?? "").trim()).toBe("");
    });
});
