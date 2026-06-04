import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import { message } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { DEFAULT_LOCALE, setActiveLocale } from "../../i18n";
import zhCN from "../../i18n/locales/zh-CN";
import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import { overlaysActions } from "../../store/reducers/overlaysSlice";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import TaskModal from ".";

// `ResponsiveFormSheet` swaps the desktop Modal for the animated bottom
// Sheet on coarse-pointer chrome. Both hooks are auto-mocked so every
// test can pin the branch: the default wired in `beforeEach` keeps the
// jsdom-desktop Modal (the existing `.ant-modal-*` assertions), and the
// dedicated phone test flips `useIsPhoneChrome` -> true to exercise the
// Sheet surface. `useReducedMotion` -> false selects the animated branch
// (the Drawer fallback has no `-surface` testid).
jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useReducedMotion");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseReducedMotion = useReducedMotion as jest.MockedFunction<
    typeof useReducedMotion
>;

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
        /** Project labels to seed the `["labels", …]` cache (label picker). */
        labels?: ILabel[];
        /**
         * Project members to seed the `["projects/members", …]` cache
         * (assignee picker). Distinct from the global `members` directory.
         */
        projectMembers?: IProjectMember[];
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
    // M2 task-richness pickers read project labels + the project-member
    // roster. Seed both per-project caches (fresh, via the hooks' 5-min
    // staleTime) so they serve from cache and add NO extra `fetch` calls —
    // the existing strict `toHaveBeenCalledTimes(1)` assertions below count
    // only the task PUT/DELETE. Tests that exercise the pickers pass
    // `labels` / `projectMembers` to override the empty defaults.
    queryClient.setQueryData(
        ["labels", { projectId: "project-1" }],
        options.labels ?? []
    );
    queryClient.setQueryData(
        ["projects/members", { projectId: "project-1" }],
        options.projectMembers ?? []
    );

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
        // Default every test to desktop chrome so the legacy `.ant-modal*`
        // assertions hold; the phone-branch test overrides this locally.
        mockedUseIsPhoneChrome.mockReturnValue(false);
        mockedUseReducedMotion.mockReturnValue(false);
        // Clear both slices so the Phase 4.3 integration assertions
        // below read a deterministic event list. The AI-ledger bridge
        // re-forwards every surviving aiLedger entry on each test
        // render, so failing to clear it leaks AI rows across tests
        // — assistive features like the task-assist panel push
        // entries into aiLedger during the existing suite.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
        // The Undo toast lives in a global AntD message container that
        // outlives unmount (10 s window); tear it down so a leaked "Undo"
        // button never bleeds into a sibling test's queries.
        act(() => {
            message.destroy();
        });
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
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

    it("deletes the editing task immediately (no confirm) and surfaces an Undo toast", async () => {
        // §2.A.4 — task delete is reversible, so it skips Modal.confirm
        // and goes straight to an optimistic DELETE + Undo toast.
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toContain(
            "/api/v1/tasks?taskId=task-1"
        );
        expect(fetchMock.mock.calls[0][1]).toEqual(
            expect.objectContaining({ method: "DELETE" })
        );
        // The modal closes right away and a toast offers a real,
        // focusable Undo button.
        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
        );
        expect(await screen.findByText("Task deleted")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Undo" })
        ).toBeInTheDocument();
    });

    it("re-creates the task via a POST when the Undo toast is clicked", async () => {
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const undoButton = await screen.findByRole("button", { name: "Undo" });
        await act(async () => {
            fireEvent.click(undoButton);
        });

        // Undo replays the inverse mutation: a POST that re-creates the
        // just-deleted task with its captured snapshot.
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][1]).toEqual(
            expect.objectContaining({ method: "POST" })
        );
    });

    it("surfaces an error toast (and still closes the modal) when the delete fails", async () => {
        fetchMock.mockResolvedValue(
            response({ error: "Delete failed on server" }, false)
        );
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        // The optimistic delete closes the modal, and the failure surfaces
        // a task-specific error message.
        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
        );
        expect(
            await screen.findByText("Couldn't delete Build task.")
        ).toBeInTheDocument();
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

    it("caps the modal body height with env(keyboard-inset-height) AND clamps it via max() so landscape + keyboard cannot produce a negative max-height (Bug 6)", async () => {
        // Regression for QW-18 + Bug 6 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The Modal body's inline style must subtract `env(keyboard-inset-height, 0px)`
        // so the footer (Save / Cancel / Delete) cannot fall below the
        // viewport when the iOS software keyboard pushes itself up
        // through `interactive-widget=resizes-content`. The phone branch
        // additionally wraps the calc in `max(80px, …)` so a 375 × 667
        // device in landscape with the keyboard up cannot collapse the
        // modal body to a negative max-height.
        renderModal();

        const dialog = await screen.findByRole("dialog");
        const body = dialog.querySelector(
            ".ant-modal-body"
        ) as HTMLElement | null;
        expect(body).not.toBeNull();
        expect(body!.style.maxHeight).toMatch(/env\(keyboard-inset-height/);
        expect(body!.style.maxHeight).toMatch(/max\(/);
    });

    it("stacks the phone footer Delete → Cancel → Save so the primary lands in the thumb zone", async () => {
        // Regression for QW-19 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The matchMedia mock returns `matches: false` for every query so
        // AntD's `Grid.useBreakpoint` resolves to phone mode. The footer
        // must render in DOM order Delete (top) → Cancel (middle) → Save
        // (bottom) so the destructive control is far from the primary
        // tap target. The DOM order is also the visual order in a flex
        // column.
        renderModal();
        await screen.findByDisplayValue("Build task");

        const footerButtons = Array.from(
            document.querySelectorAll(".ant-modal-footer button")
        ) as HTMLButtonElement[];
        const labels = footerButtons.map(
            (btn) => btn.textContent?.trim() ?? ""
        );
        const deleteIdx = labels.findIndex((label) => /^delete$/i.test(label));
        const cancelIdx = labels.findIndex((label) => /^cancel$/i.test(label));
        const saveIdx = labels.findIndex((label) => /^save$/i.test(label));
        expect(deleteIdx).toBeGreaterThanOrEqual(0);
        expect(cancelIdx).toBeGreaterThan(deleteIdx);
        expect(saveIdx).toBeGreaterThan(cancelIdx);
    });

    it("renders the bottom Sheet (medium detent) with the full footer on phone chrome, and the primary button reflects the mutation's loading/disabled state", async () => {
        // Phone migration (ResponsiveFormSheet). With coarse-pointer chrome
        // the editor renders the animated bottom Sheet instead of the
        // Modal. Assert the Sheet surface opens at the MEDIUM detent, the
        // footer still carries Delete + Cancel + Save (Delete -> Cancel ->
        // Save stacking preserved), and the primary button picks up the
        // PUT mutation's loading/disabled state while it is in flight.
        mockedUseIsPhoneChrome.mockReturnValue(true);
        let resolvePut: (value: Response) => void = () => undefined;
        fetchMock.mockImplementation(
            () =>
                new Promise<Response>((resolve) => {
                    resolvePut = resolve;
                })
        );
        renderModal();

        const surface = await screen.findByTestId("task-modal-surface");
        expect(surface).toHaveAttribute("role", "dialog");
        expect(surface).toHaveAttribute("data-detent", "medium");
        // The Sheet body wraps the form — no `.ant-modal*` chrome here.
        expect(screen.getByTestId("task-modal-body")).toBeInTheDocument();
        expect(
            within(surface).getByDisplayValue("Build task")
        ).toBeInTheDocument();

        const deleteButton = within(surface).getByRole("button", {
            name: /^delete build task$/i
        });
        const cancelButton = within(surface).getByRole("button", {
            name: /^cancel$/i
        });
        const saveButton = within(surface).getByRole("button", {
            name: /^save$/i
        });
        expect(deleteButton).toBeInTheDocument();
        expect(cancelButton).toBeInTheDocument();
        // Footer stacking order is preserved on the Sheet too.
        expect(
            deleteButton.compareDocumentPosition(cancelButton) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            cancelButton.compareDocumentPosition(saveButton) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();

        // Primary starts enabled (task resolved, no mutation in flight).
        expect(saveButton).toBeEnabled();
        expect(saveButton).not.toHaveClass("ant-btn-loading");

        fireEvent.change(within(surface).getByDisplayValue("Build task"), {
            target: { value: "Build task details" }
        });
        await act(async () => {
            fireEvent.click(saveButton);
        });

        // PUT is pending -> the primary mirrors `confirmLoading`/disabled.
        await waitFor(() => expect(saveButton).toHaveClass("ant-btn-loading"));
        expect(saveButton).toBeDisabled();

        await act(async () => {
            resolvePut(response({ _id: "task-1" }));
        });
        await waitFor(() =>
            expect(store.getState().overlays.editingTaskId).toBe(null)
        );
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

    /*
     * Phase 4.3 — integration assertion (Critical issue 1). The
     * brief required "task create/update/delete" all to land in the
     * activity feed; the update + delete paths live here in
     * taskModal. Read Redux directly so the assertion is independent
     * of any particular drawer-UI affordance.
     */
    it("records an activity-feed event when a task is updated (Phase 4.3 integration)", async () => {
        renderModal();
        const taskNameInput = await screen.findByDisplayValue("Build task");

        fireEvent.change(taskNameInput, {
            target: { value: "Build task details" }
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("task");
            expect(events[0].action).toBe("update");
            expect(events[0].summary).toContain("Build task details");
        });
    });

    it("records an activity-feed event when a task is deleted (Phase 4.3 integration)", async () => {
        renderModal();

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        // The transient Undo toast is the immediate recovery path; the
        // activity feed keeps a longer-lived record + undo alongside it.
        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("task");
            expect(events[0].action).toBe("delete");
            expect(events[0].summary).toContain("Build task");
        });
    });

    // ── M2 task-richness fields ──────────────────────────────────────────
    describe("M2 richness fields (dates, labels, assignees, parent)", () => {
        const labelFixtures: ILabel[] = [
            {
                _id: "label-1",
                projectId: "project-1",
                name: "Backend",
                color: "blue"
            },
            {
                _id: "label-2",
                projectId: "project-1",
                name: "Frontend",
                color: "geekblue"
            }
        ];
        const projectMemberFixtures: IProjectMember[] = [
            {
                _id: "member-1",
                email: "alice@example.com",
                username: "Alice",
                role: "manager"
            },
            {
                _id: "member-2",
                email: "bob@example.com",
                username: "Bob",
                role: "coordinator"
            }
        ];

        const lastPutBody = () => {
            const putCall = fetchMock.mock.calls.find(
                ([, init]) =>
                    (init as RequestInit | undefined)?.method === "PUT"
            );
            return JSON.parse(
                (putCall?.[1] as RequestInit)?.body as string
            ) as Record<string, unknown>;
        };

        it("renders the new field controls (start/due date, labels, assignees, parent task)", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });

            expect(
                await screen.findByDisplayValue("Build task")
            ).toBeInTheDocument();
            // Labelled Form.Items surface their field labels.
            expect(screen.getByText("Start date")).toBeInTheDocument();
            expect(screen.getByText("Due date")).toBeInTheDocument();
            expect(screen.getByText("Labels")).toBeInTheDocument();
            expect(screen.getByText("Assignees")).toBeInTheDocument();
            expect(screen.getByText("Parent task")).toBeInTheDocument();
        });

        it("offers project labels in the label picker (name + colour source)", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });
            await screen.findByDisplayValue("Build task");

            // Open the Labels multi-select and assert both project labels
            // appear as options.
            const labelsSelect = screen.getByRole("combobox", {
                name: /labels/i
            });
            fireEvent.mouseDown(labelsSelect);
            expect(
                (await screen.findAllByText("Backend")).length
            ).toBeGreaterThan(0);
            expect(
                (await screen.findAllByText("Frontend")).length
            ).toBeGreaterThan(0);
        });

        it("offers PROJECT members (not the global directory) in the assignee picker", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: [
                    {
                        _id: "member-9",
                        email: "carol@example.com",
                        username: "Carol",
                        role: "coordinator"
                    }
                ]
            });
            await screen.findByDisplayValue("Build task");

            const assigneesSelect = screen.getByRole("combobox", {
                name: /assignees/i
            });
            fireEvent.mouseDown(assigneesSelect);
            // The project roster (Carol) drives this picker, distinct from
            // the global `users/members` directory that powers Coordinator.
            expect(
                (await screen.findAllByText("Carol")).length
            ).toBeGreaterThan(0);
        });

        it("excludes the editing task itself from the parent-task options", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });
            await screen.findByDisplayValue("Build task");

            const parentSelect = screen.getByRole("combobox", {
                name: /parent task/i
            });
            fireEvent.mouseDown(parentSelect);
            // "Fix bug" (task-2) is selectable; the current task ("Build
            // task", task-1) must not list itself as a parent option.
            await screen.findByText("Fix bug");
            const optionContents = Array.from(
                document.querySelectorAll(".ant-select-item-option-content")
            ).map((el) => el.textContent);
            expect(optionContents).toContain("Fix bug");
            // A task can't be its own parent — the editing task is filtered
            // out of the option list.
            expect(optionContents).not.toContain("Build task");
        });

        it("includes labels, assignees, and parent in the PUT payload on save", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });
            await screen.findByDisplayValue("Build task");

            // Pick a label.
            fireEvent.mouseDown(
                screen.getByRole("combobox", { name: /labels/i })
            );
            fireEvent.click(await screen.findByText("Backend"));

            // Pick an assignee.
            fireEvent.mouseDown(
                screen.getByRole("combobox", { name: /assignees/i })
            );
            fireEvent.click(await screen.findByText("Bob"));

            // Pick a parent task.
            fireEvent.mouseDown(
                screen.getByRole("combobox", { name: /parent task/i })
            );
            fireEvent.click(await screen.findByText("Fix bug"));

            fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

            await waitFor(() =>
                expect(
                    fetchMock.mock.calls.some(
                        ([, init]) =>
                            (init as RequestInit | undefined)?.method === "PUT"
                    )
                ).toBe(true)
            );
            const body = lastPutBody();
            expect(body).toEqual(
                expect.objectContaining({
                    _id: "task-1",
                    labelIds: ["label-1"],
                    assigneeIds: ["member-2"],
                    parentTaskId: "task-2"
                })
            );
        });

        it("serializes a chosen due date as a YYYY-MM-DD string in the PUT payload", async () => {
            renderModal({
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });
            await screen.findByDisplayValue("Build task");

            // AntD DatePicker accepts typed input; type a date then confirm
            // with Enter so the picker commits the value.
            const dueInput = screen.getByPlaceholderText(
                "Select a due date"
            ) as HTMLInputElement;
            fireEvent.mouseDown(dueInput);
            fireEvent.change(dueInput, { target: { value: "2026-12-25" } });
            fireEvent.keyDown(dueInput, { key: "Enter", code: "Enter" });

            fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

            await waitFor(() =>
                expect(
                    fetchMock.mock.calls.some(
                        ([, init]) =>
                            (init as RequestInit | undefined)?.method === "PUT"
                    )
                ).toBe(true)
            );
            const body = lastPutBody();
            expect(body.dueDate).toBe("2026-12-25");
        });

        it("seeds the date pickers from the task's stored ISO date strings", async () => {
            renderModal({
                initialTasks: [
                    task({ startDate: "2026-03-01", dueDate: "2026-03-15" })
                ],
                labels: labelFixtures,
                projectMembers: projectMemberFixtures
            });
            await screen.findByDisplayValue("Build task");

            // The stored ISO strings round-trip into the picker inputs.
            expect(screen.getByDisplayValue("2026-03-01")).toBeInTheDocument();
            expect(screen.getByDisplayValue("2026-03-15")).toBeInTheDocument();
        });
    });
});
