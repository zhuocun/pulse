import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import { Modal } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { DEFAULT_LOCALE, setActiveLocale } from "../../i18n";
import zhCN from "../../i18n/locales/zh-CN";
import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

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
        /**
         * Task id to seed `overlaysSlice.editingTaskId` with before render.
         * Replaces the previous `?editingTaskId=…` URL bootstrap now that
         * the modal is Redux-driven. Pass `null` to render with the modal
         * closed.
         */
        editingTaskId?: string | null;
    } = {}
) => {
    const route = options.route ?? "/projects/project-1/board";
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
    const editingTaskId =
        options.editingTaskId === undefined ? "task-1" : options.editingTaskId;
    if (editingTaskId) {
        store.dispatch(overlaysActions.startEditingTask(editingTaskId));
    } else {
        store.dispatch(overlaysActions.closeTaskModal());
    }
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], members);

    return render(
        <Provider store={store}>
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
        </Provider>
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

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders localized select placeholders when zh-CN is active and story points are unset", async () => {
        setActiveLocale("zh-CN");
        renderModal({
            initialTasks: [
                task({
                    storyPoints: undefined as unknown as ITask["storyPoints"]
                })
            ]
        });

        expect(
            await screen.findByText(
                new RegExp(`${zhCN.actions.editTask} · build task`, "i")
            )
        ).toBeInTheDocument();
        expect(
            screen.getByText(zhCN.placeholders.selectStoryPoints)
        ).toBeInTheDocument();
        expect(
            screen.queryByText(/Select story points/i)
        ).not.toBeInTheDocument();
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
            expect(store.getState().overlays.editingTaskId).toBe(null)
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
            expect(store.getState().overlays.editingTaskId).toBe(null)
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
        expect(store.getState().overlays.editingTaskId).toBe("task-1");
    });

    it("resets and clears the URL when cancelled", async () => {
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
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
                expect(store.getState().overlays.editingTaskId).toBe(null)
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
            expect(store.getState().overlays.editingTaskId).toBe("task-1");
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
            expect(store.getState().overlays.editingTaskId).toBe("task-1");
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
            editingTaskId: "mock",
            route: "/projects/project-1/board"
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
            editingTaskId: "missing-task",
            route: "/projects/project-1/board"
        });

        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
        );
        expect(
            screen.queryByDisplayValue("Build task")
        ).not.toBeInTheDocument();
    });

    it("keeps the modal open with a banner when the task disappears mid-edit", async () => {
        // Regression for the data-loss bug surfaced in
        // ui-ux-comprehensive-review-2026-05.md §"Critical bugs that ship
        // today": a concurrent refetch that drops the editing task used
        // to auto-close the modal and ``resetFields()`` the dirty
        // payload silently. Now we keep the modal open with a sticky
        // banner so the user can decide what to do with their edits.
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        queryClient.setQueryData(["users/members"], members);
        const route = "/projects/project-1/board";
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        function Harness({ taskList }: { taskList: ITask[] | undefined }) {
            return (
                <Provider store={store}>
                    <QueryClientProvider client={queryClient}>
                        <MemoryRouter initialEntries={[route]}>
                            <Routes>
                                <Route
                                    path="/projects/:projectId/board"
                                    element={
                                        <>
                                            <TaskModal
                                                boardAiOn={false}
                                                tasks={taskList}
                                            />
                                            <LocationProbe />
                                        </>
                                    }
                                />
                            </Routes>
                        </MemoryRouter>
                    </QueryClientProvider>
                </Provider>
            );
        }

        const { rerender } = render(<Harness taskList={tasks} />);

        const taskNameInput = await screen.findByDisplayValue("Build task");
        await act(async () => {
            fireEvent.change(taskNameInput, {
                target: { value: "edited title" }
            });
        });

        // Refetch resolves without our edited task — the dirty form must
        // not be discarded.
        await act(async () => {
            rerender(<Harness taskList={[]} />);
        });

        expect(
            await screen.findByText(/this task was removed by another change/i)
        ).toBeInTheDocument();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByDisplayValue("edited title")).toBeInTheDocument();
        expect(store.getState().overlays.editingTaskId).toBe("task-1");

        // Discard restores the previous "close cleanly" behaviour.
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: /^discard edits$/i })
            );
        });
        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
        );
    });

    it("opens with loading UI while tasks are unresolved, then shows the full form once tasks resolve", async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        queryClient.setQueryData(["users/members"], members);
        const route = "/projects/project-1/board";
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        function Harness({ taskList }: { taskList: ITask[] | undefined }) {
            return (
                <Provider store={store}>
                    <QueryClientProvider client={queryClient}>
                        <MemoryRouter initialEntries={[route]}>
                            <Routes>
                                <Route
                                    path="/projects/:projectId/board"
                                    element={
                                        <>
                                            <TaskModal
                                                boardAiOn={false}
                                                tasks={taskList}
                                            />
                                            <LocationProbe />
                                        </>
                                    }
                                />
                            </Routes>
                        </MemoryRouter>
                    </QueryClientProvider>
                </Provider>
            );
        }

        const { rerender } = render(<Harness taskList={undefined} />);

        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(screen.getByLabelText(/loading board/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
        expect(
            screen.getByRole("button", { name: /^delete$/i })
        ).toBeDisabled();

        await act(async () => {
            rerender(<Harness taskList={tasks} />);
        });

        await waitFor(() =>
            expect(
                screen.queryByLabelText(/loading board/i)
            ).not.toBeInTheDocument()
        );
        expect(screen.getByDisplayValue("Build task")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /^save$/i })
        ).not.toBeDisabled();
        expect(store.getState().overlays.editingTaskId).toBe("task-1");
    });

    it("caps the modal body height with env(keyboard-inset-height) so the footer stays above the iOS soft keyboard", async () => {
        // Regression for QW-18 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The Modal body's inline style must subtract `env(keyboard-inset-height, 0px)`
        // so the footer (Save / Cancel / Delete) cannot fall below the
        // viewport when the iOS software keyboard pushes itself up
        // through `interactive-widget=resizes-content`.
        renderModal();

        const dialog = await screen.findByRole("dialog");
        const body = dialog.querySelector(
            ".ant-modal-body"
        ) as HTMLElement | null;
        expect(body).not.toBeNull();
        expect(body!.style.maxHeight).toMatch(/env\(keyboard-inset-height/);
    });

    it("does not open the modal for optimistic placeholder ids while tasks are still loading", () => {
        renderModal({
            initialTasks: undefined,
            editingTaskId: "mock",
            route: "/projects/project-1/board"
        });

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(store.getState().overlays.editingTaskId).toBe("mock");
    });

    it("disables delete when the task list is unavailable", async () => {
        renderModal({ initialTasks: undefined });

        expect(store.getState().overlays.editingTaskId).toBe("task-1");
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(screen.getByLabelText(/loading board/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
        expect(
            screen.getByRole("button", { name: /^delete$/i })
        ).toBeDisabled();
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

    it("shows a story-points copilot badge after Apply and clears it after editing the field", async () => {
        renderModal();
        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(
            await screen.findByLabelText("Apply suggested story points")
        );

        const storyPointsLabel = screen
            .getByText("Story points")
            .closest("label");
        expect(storyPointsLabel).not.toBeNull();
        expect(
            within(storyPointsLabel as HTMLLabelElement).getByText(
                "Suggested by Copilot"
            )
        ).toBeInTheDocument();

        const storyPointsCombobox = screen.getByRole("combobox", {
            name: /Story points/i
        });
        expect(storyPointsCombobox).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Task name"), {
            target: { value: "Build task updated" }
        });

        await waitFor(() =>
            expect(
                within(storyPointsLabel as HTMLLabelElement).queryByText(
                    "Suggested by Copilot"
                )
            ).not.toBeInTheDocument()
        );
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
