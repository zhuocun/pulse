import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Modal } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import TaskModal from ".";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
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

const members = [
    member(),
    member({
        _id: "member-2",
        email: "bob@example.com",
        username: "Bob"
    })
];

const tasks = [
    task(),
    task({
        _id: "task-2",
        coordinatorId: "member-2",
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

const LocationProbe = () => {
    const location = useLocation();

    return <div data-testid="location">{location.search}</div>;
};

const renderModal = (
    options: {
        initialTasks?: ITask[] | undefined;
        route?: string;
        boardAiOn?: boolean;
    } = {}
) => {
    const route =
        options.route ?? "/projects/project-1/board?editingTaskId=task-1";
    const boardAiOn =
        Object.prototype.hasOwnProperty.call(options, "boardAiOn") &&
        options.boardAiOn === false
            ? false
            : true;
    const initialTasks = Object.prototype.hasOwnProperty.call(
        options,
        "initialTasks"
    )
        ? options.initialTasks
        : tasks;
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], members);

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[route]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <>
                                <TaskModal
                                    boardAiOn={boardAiOn}
                                    tasks={initialTasks}
                                />
                                <LocationProbe />
                            </>
                        }
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
};

describe("TaskModal", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(response({ _id: "task-1" }));
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("opens from the URL, populates fields, and renders cached select options", async () => {
        renderModal();

        expect(
            await screen.findByText(/edit task · build task/i)
        ).toBeInTheDocument();
        expect(screen.getByDisplayValue("Build task")).toBeInTheDocument();

        fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
        expect((await screen.findAllByText("Alice")).length).toBeGreaterThan(0);
        expect((await screen.findAllByText("Bob")).length).toBeGreaterThan(0);

        fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);
        expect((await screen.findAllByText("Task")).length).toBeGreaterThan(0);
        expect((await screen.findAllByText("Bug")).length).toBeGreaterThan(0);
    });

    it("renders canonical type options when the dataset only has Task entries", async () => {
        renderModal({
            initialTasks: [task({ type: "Task" })]
        });

        expect(
            await screen.findByText(/edit task · build task/i)
        ).toBeInTheDocument();
        fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);

        expect((await screen.findAllByText("Task")).length).toBeGreaterThan(0);
        expect((await screen.findAllByText("Bug")).length).toBeGreaterThan(0);
    });

    it("renders canonical type options when the dataset only has Bug entries", async () => {
        renderModal({
            initialTasks: [
                task({
                    taskName: "Fix bug",
                    type: "Bug"
                })
            ]
        });

        expect(
            await screen.findByText(/edit task · fix bug/i)
        ).toBeInTheDocument();
        fireEvent.mouseDown(screen.getAllByRole("combobox")[1]);

        expect((await screen.findAllByText("Task")).length).toBeGreaterThan(0);
        expect((await screen.findAllByText("Bug")).length).toBeGreaterThan(0);
    });

    it("closes without mutation when submitted values are unchanged", async () => {
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("updates a changed task and clears the modal URL state", async () => {
        renderModal();
        const taskNameInput = await screen.findByDisplayValue("Build task");

        fireEvent.change(taskNameInput, {
            target: { value: "Build task details" }
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/tasks");
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({ method: "PUT" })
        );
        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(
            expect.objectContaining({
                _id: "task-1",
                coordinatorId: "member-1",
                taskName: "Build task details",
                type: "Task"
            })
        );
        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
    });

    it("surfaces a save error and keeps the modal open when the update fails", async () => {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(
            response({ error: "Save failed on server" }, false)
        );
        renderModal();
        const taskNameInput = await screen.findByDisplayValue("Build task");

        fireEvent.change(taskNameInput, {
            target: { value: "Build task details" }
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() =>
            expect(
                screen.getByText(/save failed on server/i)
            ).toBeInTheDocument()
        );
        expect(screen.getByTestId("location")).toHaveTextContent(
            "editingTaskId=task-1"
        );
    });

    it("resets and clears the URL when cancelled", async () => {
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("confirms before deleting the editing task", async () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        try {
            renderModal();

            expect(
                await screen.findByDisplayValue("Build task")
            ).toBeInTheDocument();
            fireEvent.click(
                screen.getByRole("button", { name: /^delete build task$/i })
            );

            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(confirmSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: "This action cannot be undone.",
                    title: "Delete this task?"
                })
            );
            expect(fetchMock.mock.calls[0][0]).toContain(
                "/api/v1/tasks?taskId=task-1"
            );
            expect(fetchMock.mock.calls[0][1]).toEqual(
                expect.objectContaining({ method: "DELETE" })
            );
            await waitFor(() =>
                expect(screen.getByTestId("location")).toHaveTextContent("")
            );
        } finally {
            confirmSpy.mockRestore();
        }
    });

    it("keeps the modal open when task deletion is cancelled", async () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation(() => {
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        try {
            renderModal();

            expect(
                await screen.findByDisplayValue("Build task")
            ).toBeInTheDocument();
            fireEvent.click(
                screen.getByRole("button", { name: /^delete build task$/i })
            );

            expect(confirmSpy).toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(screen.getByTestId("location")).toHaveTextContent(
                "editingTaskId=task-1"
            );
            expect(screen.getByDisplayValue("Build task")).toBeInTheDocument();
        } finally {
            confirmSpy.mockRestore();
        }
    });

    it("keeps the modal open if deleting the task fails", async () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        fetchMock.mockResolvedValue(
            response({ error: "Delete failed on server" }, false)
        );
        try {
            renderModal();

            expect(
                await screen.findByDisplayValue("Build task")
            ).toBeInTheDocument();
            fireEvent.click(
                screen.getByRole("button", { name: /^delete build task$/i })
            );

            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(screen.getByTestId("location")).toHaveTextContent(
                "editingTaskId=task-1"
            );
        } finally {
            confirmSpy.mockRestore();
        }
    });

    it("allows deleting the last saved task but still disables delete for optimistic tasks", async () => {
        const { unmount } = renderModal({ initialTasks: [task()] });

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /^delete build task$/i })
        ).toBeEnabled();

        unmount();
        renderModal({
            initialTasks: [
                task({
                    _id: "mock",
                    taskName: "Optimistic"
                }),
                task({ _id: "task-2" })
            ],
            route: "/projects/project-1/board?editingTaskId=mock"
        });

        expect(
            await screen.findByDisplayValue("Optimistic")
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /^delete optimistic$/i })
        ).toBeDisabled();
    });

    it("clears a stale editingTaskId after tasks finish loading without a match", async () => {
        renderModal({
            initialTasks: [],
            route: "/projects/project-1/board?editingTaskId=missing-task"
        });

        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
        expect(
            screen.queryByDisplayValue("Build task")
        ).not.toBeInTheDocument();
    });

    it("disables delete when the task list is unavailable", async () => {
        renderModal({ initialTasks: undefined });

        expect(screen.getByTestId("location")).toHaveTextContent(
            "editingTaskId=task-1"
        );
        expect(
            screen.queryByRole("button", { name: /^delete$/i })
        ).not.toBeInTheDocument();
    });

    it("hides the assist panel when board AI is off for the project", async () => {
        jest.useFakeTimers();
        try {
            renderModal({ boardAiOn: false });
            expect(
                await screen.findByDisplayValue("Build task")
            ).toBeInTheDocument();
            jest.advanceTimersByTime(1500);
            expect(
                screen.queryByLabelText("Apply suggested story points")
            ).not.toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it("renders the Board Copilot assist panel and applies its suggestions", async () => {
        jest.useFakeTimers();
        try {
            renderModal();
            const taskNameInput = await screen.findByDisplayValue("Build task");
            act(() => {
                jest.advanceTimersByTime(1000);
            });
            const applyPoints = await screen.findByLabelText(
                "Apply suggested story points"
            );
            fireEvent.click(applyPoints);
            // Apply readiness suggestion for the note field
            fireEvent.change(
                screen.getByPlaceholderText("Notes / acceptance criteria"),
                { target: { value: "" } }
            );
            act(() => {
                jest.advanceTimersByTime(1000);
            });
            const noteSuggestion = await screen.findByLabelText(
                /Apply readiness suggestion for note/
            );
            fireEvent.click(noteSuggestion);
            expect(
                (
                    screen.getByPlaceholderText(
                        "Notes / acceptance criteria"
                    ) as HTMLTextAreaElement
                ).value
            ).toMatch(/## Acceptance criteria/);
            fireEvent.change(screen.getByLabelText("Epic"), {
                target: { value: "" }
            });
            act(() => {
                jest.advanceTimersByTime(1000);
            });
            const epicSuggestion = await screen.findByLabelText(
                /Apply readiness suggestion for epic/
            );
            fireEvent.click(epicSuggestion);
            expect(
                (screen.getByLabelText("Epic") as HTMLInputElement).value
            ).toBeTruthy();
            expect(taskNameInput).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it("restores the previous field value when undoing a readiness suggestion", async () => {
        jest.useFakeTimers();
        try {
            renderModal();
            const noteInput = (await screen.findByPlaceholderText(
                "Notes / acceptance criteria"
            )) as HTMLTextAreaElement;

            fireEvent.change(noteInput, {
                target: { value: "Keep this note" }
            });
            act(() => {
                jest.advanceTimersByTime(1000);
            });
            const noteSuggestion = await screen.findByLabelText(
                /Apply readiness suggestion for note/
            );
            fireEvent.click(noteSuggestion);
            expect(noteInput.value).toMatch(/## Acceptance criteria/);

            const undoButtons = await screen.findAllByText("Undo");
            fireEvent.click(undoButtons[undoButtons.length - 1]);
            await waitFor(() => expect(noteInput.value).toBe("Keep this note"));
        } finally {
            jest.useRealTimers();
        }
    });
});
