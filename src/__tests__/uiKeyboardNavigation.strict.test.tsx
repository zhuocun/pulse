/**
 * Keyboard-navigation behavior tests:
 *
 *   - ColumnCreator collapses to its trigger button on Esc.
 *   - TaskCreator collapses to its trigger button on Esc.
 *
 * Structural tab-order assertions ("first focusable input is email",
 * "submit is last in tab order") were dropped — they lock down DOM order
 * without exercising real behavior.
 */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ColumnCreator from "../components/columnCreator";
import TaskCreator from "../components/taskCreator";
import { store } from "../store";
import useReactMutation from "../utils/hooks/useReactMutation";
import useReactQuery from "../utils/hooks/useReactQuery";

jest.mock("../utils/hooks/useReactMutation");
jest.mock("../utils/hooks/useReactQuery");

const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;
const mockedUseReactQuery = useReactQuery as jest.MockedFunction<
    typeof useReactQuery
>;

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
    mockedUseReactMutation.mockReturnValue({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({})
    } as unknown as ReturnType<typeof useReactMutation<unknown>>);
    mockedUseReactQuery.mockReturnValue({
        data: [],
        error: null,
        isLoading: false,
        isSuccess: true,
        refetch: jest.fn()
    } as unknown as ReturnType<typeof useReactQuery<unknown>>);
});

describe("Esc collapses inline editors", () => {
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

        fireEvent.click(screen.getByRole("button", { name: /add column/i }));
        const input = screen.getByPlaceholderText(/Create column/);
        expect(input).toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
        });

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
