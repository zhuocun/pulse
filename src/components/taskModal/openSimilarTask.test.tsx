import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

jest.mock("../aiTaskAssistPanel", () => ({
    __esModule: true,
    default: ({
        onOpenSimilarTask
    }: {
        onOpenSimilarTask: (taskId: string) => void;
    }) => (
        <button type="button" onClick={() => onOpenSimilarTask("task-2")}>
            Open similar (test stub)
        </button>
    )
}));

import TaskModal from ".";

const member = (): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice"
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const tasks = [
    task(),
    task({
        _id: "task-2",
        coordinatorId: "member-1",
        taskName: "Fix bug",
        type: "Bug"
    })
];

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const LocationProbe = () => {
    const location = useLocation();
    return <div data-testid="location">{location.search}</div>;
};

describe("TaskModal onOpenSimilarTask", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: () => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: false,
                media: "",
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
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(response({ _id: "task-1" }));
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("switches the edited task when the assist panel opens a similar task", async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        queryClient.setQueryData(["users/members"], [member()]);
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter
                        initialEntries={["/projects/project-1/board"]}
                    >
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <>
                                        <TaskModal tasks={tasks} />
                                        <LocationProbe />
                                    </>
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByText("Open similar (test stub)"));

        await waitFor(() => {
            expect(store.getState().overlays.editingTaskId).toBe("task-2");
        });
    });
});
