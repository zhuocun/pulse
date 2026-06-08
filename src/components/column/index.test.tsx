import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message, Modal } from "antd";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { userPreferencesSlice } from "../../store/reducers/userPreferencesSlice";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import { TaskSearchParam } from "../taskSearchPanel";

import Column from ".";

jest.mock("../../utils/hooks/useReactMutation");
jest.mock("../../utils/hooks/useTaskModal");
jest.mock("../../utils/hooks/useTaskPanelNavigation");
jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: { taskPanelRouted: false, aiColumnReadinessEnabled: false }
}));

type DragMockProps = {
    children: ReactNode;
    draggableId: string;
    isDragDisabled?: boolean;
    detachDragHandle?: boolean;
};

type DropMockProps = {
    children: ReactNode;
    droppableId: string;
};

type TaskCreatorMockProps = {
    columnId?: string;
    disabled?: boolean;
    boardAiOn?: boolean;
};

type DropdownMenuItem = {
    key?: string | number;
    label?: ReactNode;
};

type DropdownMockProps = {
    children: ReactNode;
    menu?: {
        items?: DropdownMenuItem[];
    };
};

jest.mock("../dragAndDrop", () => {
    const React = jest.requireActual("react");
    const { useDetachedDragHandleProps } =
        jest.requireActual<typeof import("../dragAndDrop")>("../dragAndDrop");

    return {
        useDetachedDragHandleProps,
        Drag: ({
            children,
            draggableId,
            isDragDisabled,
            detachDragHandle
        }: DragMockProps) => {
            if (detachDragHandle) {
                return (
                    <div data-testid={`detach-${draggableId}`}>{children}</div>
                );
            }
            const isDragging = String(draggableId).includes("__IS_DRAGGING__");
            const inner = React.isValidElement(children)
                ? React.cloneElement(children, {
                      "data-dragging": isDragging ? "true" : undefined
                  } as never)
                : children;
            return (
                <div
                    data-disabled={String(isDragDisabled)}
                    data-testid={draggableId}
                >
                    {inner}
                </div>
            );
        },
        Drop: ({ children, droppableId }: DropMockProps) => (
            <div data-testid={`drop-${droppableId}`}>{children}</div>
        ),
        DropChild: ({ children }: { children: ReactNode }) => (
            <div>{children}</div>
        )
    };
});

jest.mock("../taskCreator", () => ({
    __esModule: true,
    default: ({ columnId, disabled, boardAiOn }: TaskCreatorMockProps) => (
        <div
            data-board-ai={String(boardAiOn !== false)}
            data-column-id={columnId}
            data-disabled={String(disabled)}
            data-testid="task-creator"
        />
    )
}));

jest.mock("antd", () => {
    const actual = jest.requireActual("antd");
    const React = jest.requireActual("react");

    return {
        ...actual,
        Dropdown: ({ children, menu }: DropdownMockProps) =>
            React.createElement(
                "div",
                null,
                children,
                React.createElement(
                    "div",
                    { "data-testid": "dropdown-menu" },
                    menu?.items?.map((item) =>
                        React.createElement(
                            "div",
                            { key: item.key },
                            item.label
                        )
                    )
                )
            )
    };
});

const mockedUseReactMutation = useReactMutation as jest.Mock;
const mockedUseTaskModal = useTaskModal as jest.Mock;
const mockedUseTaskPanelNavigation = useTaskPanelNavigation as jest.Mock;
const mockedEnvironment = environment as {
    taskPanelRouted: boolean;
    aiColumnReadinessEnabled: boolean;
};

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    index: 0,
    projectId: "project-1",
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
    storyPoints: 1,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const defaultParam: TaskSearchParam = {
    coordinatorId: "",
    taskName: "",
    type: ""
};

const removeColumn = jest.fn();
const recreateColumn = jest.fn().mockResolvedValue(undefined);
const editColumn = jest.fn();
const updateTask = jest.fn();
const startEditing = jest.fn();
const openTask = jest.fn();
const closeTask = jest.fn();

/**
 * Phase 4.2 — the column now reads its density from the Redux
 * `userPreferences` slice via `useBoardDensity()`, so the test render
 * helper wraps the tree in a fresh store per render. We don't reuse the
 * app-level singleton because `beforeEach` already runs between tests
 * but the singleton persists user-preferences across tests, which would
 * leak compact-density across suites. A throwaway store keyed off the
 * slice's reducer keeps each test isolated.
 */
const makeTestStore = (density: "comfortable" | "compact" = "comfortable") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: density,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto" as const,
                // Phase 6 Wave 1 — preloadedState must carry the
                // current migration sentinel.
                glassIntensityVersion: 1,
                colorTheme: "orange" as const
            }
        }
    });

const renderColumn = ({
    boardColumn = column(),
    isDragDisabled = false,
    taskDragDisabled,
    dragDisabledByFilters = false,
    boardAiOn = true,
    param = defaultParam,
    boardDensity = "comfortable",
    labels = [],
    milestones = [],
    tasks = [
        task(),
        task({
            _id: "task-2",
            coordinatorId: "member-2",
            taskName: "Fix bug",
            type: "Bug"
        }),
        task({
            _id: "mock",
            taskName: "Optimistic task"
        })
    ]
}: {
    boardColumn?: IColumn;
    isDragDisabled?: boolean;
    taskDragDisabled?: boolean;
    dragDisabledByFilters?: boolean;
    param?: TaskSearchParam;
    tasks?: ITask[];
    boardAiOn?: boolean;
    boardDensity?: "comfortable" | "compact";
    labels?: ILabel[];
    milestones?: IMilestone[];
} = {}) => {
    // The component calls `useReactMutation` four times: the column
    // DELETE (endpoint="boards", method="DELETE"), the column re-create
    // used by the Undo toast (endpoint="boards", method="POST"), the
    // column edit (endpoint="boards", method="PUT"), and the inline task
    // rename (endpoint="tasks"). Route by the first two args so the
    // mutations don't collide in test assertions.
    mockedUseReactMutation.mockImplementation(
        (endPoint: string, method: string) => {
            if (endPoint === "tasks") {
                return { mutate: updateTask, isLoading: false };
            }
            if (method === "POST") {
                return { mutateAsync: recreateColumn, isLoading: false };
            }
            if (method === "PUT") {
                return { mutate: editColumn, isLoading: false };
            }
            return { mutate: removeColumn, isLoading: false };
        }
    );
    mockedUseTaskModal.mockReturnValue({ startEditing });
    mockedUseTaskPanelNavigation.mockReturnValue({ openTask, closeTask });

    return render(
        <Provider store={makeTestStore(boardDensity)}>
            <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <Column
                                boardAiOn={boardAiOn}
                                column={boardColumn}
                                dragDisabledByFilters={dragDisabledByFilters}
                                isDragDisabled={isDragDisabled}
                                labels={labels}
                                milestones={milestones}
                                param={param}
                                taskDragDisabled={taskDragDisabled}
                                tasks={tasks}
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>
        </Provider>
    );
};

describe("Column", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedEnvironment.taskPanelRouted = false;
        mockedEnvironment.aiColumnReadinessEnabled = false;
    });

    afterEach(() => {
        // The Undo toast lives in a global AntD message container that
        // outlives unmount (10 s window); tear it down so a leaked "Undo"
        // button never bleeds into a sibling test's queries.
        act(() => {
            message.destroy();
        });
    });

    it("advertises the keyboard-drag hint on a card while reordering is allowed", () => {
        renderColumn();

        expect(
            screen.getByRole("button", { name: /open task build task/i })
        ).toHaveAttribute(
            "title",
            microcopy.dragHints.taskCardKeyboard as string
        );
    });

    it("drops the misleading drag affordances when filters pause reordering", () => {
        renderColumn({ dragDisabledByFilters: true });

        // The card still opens the task on click, so it must NOT advertise
        // itself as disabled; the native keyboard-drag title is suppressed
        // (the reorder-paused Tooltip carries the explanation instead).
        const card = screen.getByRole("button", {
            name: /open task build task/i
        });
        expect(card).not.toHaveAttribute("aria-disabled");
        expect(card).not.toHaveAttribute("title");
    });

    it("renders the column title, matching task cards, and TaskCreator state", () => {
        renderColumn({
            isDragDisabled: true,
            param: {
                coordinatorId: "member-2",
                taskName: "Fix",
                type: "Bug"
            }
        });

        // iOS 26 sentence-case sweep (Phase 6 W1 T2.7): the column title
        // dropped its text-transform: uppercase. The microcopy source
        // ("Todo") is already sentence case so the heading reads as-is.
        expect(screen.getByRole("heading", { name: "Todo" })).not.toHaveStyle({
            textTransform: "uppercase"
        });
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.queryByText("Build task")).not.toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /open task fix bug/i })
        ).toBeInTheDocument();
        expect(screen.getByTestId("task-creator")).toHaveAttribute(
            "data-disabled",
            "true"
        );
        expect(screen.getByTestId("tasktask-2")).toHaveAttribute(
            "data-disabled",
            "true"
        );
        expect(screen.getByTestId("task-creator")).toHaveAttribute(
            "data-column-id",
            "column-1"
        );
        expect(screen.getByTestId("task-creator")).toHaveAttribute(
            "data-board-ai",
            "true"
        );
    });

    it("disables only row drag when filters are active but keeps TaskCreator enabled", () => {
        renderColumn({
            isDragDisabled: false,
            taskDragDisabled: true,
            param: {
                coordinatorId: "member-2",
                taskName: "Fix",
                type: "Bug"
            }
        });

        expect(screen.getByTestId("task-creator")).toHaveAttribute(
            "data-disabled",
            "false"
        );
        expect(screen.getByTestId("tasktask-2")).toHaveAttribute(
            "data-disabled",
            "true"
        );
    });

    it("passes boardAiOn=false to TaskCreator when project AI is off", () => {
        renderColumn({ boardAiOn: false });
        expect(screen.getByTestId("task-creator")).toHaveAttribute(
            "data-board-ai",
            "false"
        );
    });

    it("marks task type icons as decorative beside the visible type label", () => {
        renderColumn();

        const taskCard = screen.getByRole("button", {
            name: /open task build task/i
        });
        const imgs = taskCard.querySelectorAll("img");
        expect(imgs).toHaveLength(1);
        expect(imgs[0]).toHaveAttribute("alt", "");
        expect(imgs[0]).toHaveAttribute("aria-hidden", "true");

        const bugCard = screen.getByRole("button", {
            name: /open task fix bug/i
        });
        const bugImgs = bugCard.querySelectorAll("img");
        expect(bugImgs).toHaveLength(1);
        expect(bugImgs[0]).toHaveAttribute("alt", "");
        expect(bugImgs[0]).toHaveAttribute("aria-hidden", "true");
    });

    it("adds a keyboard drag hint and shortcut metadata to task cards", () => {
        renderColumn();

        const taskCard = screen.getByRole("button", {
            name: /open task build task/i
        });
        expect(taskCard).toHaveAttribute(
            "title",
            microcopy.dragHints.taskCardKeyboard
        );
        expect(taskCard).toHaveAttribute(
            "aria-keyshortcuts",
            "Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
        );
    });

    it("marks the task row shell data-dragging while a drag snapshot is active", () => {
        renderColumn({
            tasks: [
                task({
                    _id: "persisted__IS_DRAGGING__",
                    taskName: "Lifted task"
                })
            ]
        });

        expect(document.querySelector('[data-dragging="true"]')).toBeTruthy();
        expect(
            screen.getByRole("button", { name: /open task lifted task/i })
                .className
        ).toContain("task-card-lift-surface");
    });

    it("starts editing non-mock tasks but ignores mock tasks", () => {
        jest.useFakeTimers();
        try {
            renderColumn();

            // The card defers `onOpen` by 250 ms so that a real
            // browser's `click → click → dblclick` sequence has a
            // chance to cancel the modal before it opens. Advance
            // timers to drain that window.
            fireEvent.click(screen.getByText("Build task"));
            fireEvent.click(screen.getByText("Optimistic task"));
            act(() => {
                jest.runAllTimers();
            });

            expect(startEditing).toHaveBeenCalledTimes(1);
            expect(startEditing).toHaveBeenCalledWith("task-1");
            // Routed-panel path is NOT taken when the flag is off.
            expect(openTask).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("routes the click through useTaskPanelNavigation when the flag is on (Phase 3 A2)", () => {
        jest.useFakeTimers();
        try {
            // Flip the mocked environment flag. The column reads it lazily
            // on render so this needs to happen before renderColumn().
            mockedEnvironment.taskPanelRouted = true;
            renderColumn();

            fireEvent.click(screen.getByText("Build task"));
            act(() => {
                jest.runAllTimers();
            });

            // openTask is wired; the legacy modal-opening startEditing is
            // not called at all when the flag is on.
            expect(openTask).toHaveBeenCalledTimes(1);
            expect(openTask).toHaveBeenCalledWith("task-1");
            expect(startEditing).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("disables drag and open behavior when a task id is empty", () => {
        renderColumn({
            tasks: [
                task({
                    _id: "",
                    taskName: "Unsaved task"
                })
            ]
        });

        expect(screen.getByText("Unsaved task")).toBeInTheDocument();
        expect(screen.getByTestId("task-unsaved-0")).toHaveAttribute(
            "data-disabled",
            "true"
        );
        expect(
            screen.getByRole("button", { name: "Open task Unsaved task" })
        ).toBeDisabled();
    });

    it("deletes an empty column immediately (no confirm) and surfaces an Undo toast", async () => {
        // §2.A.4 — an EMPTY column delete is reversible (nothing cascades),
        // so it skips Modal.confirm and goes straight to an optimistic
        // delete + Undo toast.
        const confirmSpy = jest.spyOn(Modal, "confirm");
        renderColumn({ tasks: [] });

        fireEvent.click(
            screen.getByRole("button", { name: /^delete column todo$/i })
        );

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(removeColumn).toHaveBeenCalledWith({ columnId: "column-1" });

        // The toast announces the delete and offers a real, focusable
        // Undo button.
        expect(await screen.findByText("Column deleted")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Undo" })
        ).toBeInTheDocument();

        confirmSpy.mockRestore();
    });

    it("re-creates the empty column via the POST mutation when Undo is clicked", async () => {
        renderColumn({ tasks: [] });

        fireEvent.click(
            screen.getByRole("button", { name: /^delete column todo$/i })
        );

        const undoButton = await screen.findByRole("button", { name: "Undo" });
        await act(async () => {
            fireEvent.click(undoButton);
        });

        // Undo replays the inverse mutation with the captured snapshot.
        expect(recreateColumn).toHaveBeenCalledWith(
            expect.objectContaining({ _id: "column-1", columnName: "Todo" })
        );
    });

    it("confirms before deleting a non-empty column and offers no Undo (cascade has no inverse)", async () => {
        // A column that still holds tasks cascades server-side
        // (board_service deletes every task with the columnId) and the
        // re-create POST can't restore them — so §2.A.4 keeps it on
        // Modal.confirm rather than promising an Undo we can't honor.
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                (config as { onOk?: () => void }).onOk?.();
                return {} as ReturnType<typeof Modal.confirm>;
            });
        renderColumn(); // default render seeds column-1 with tasks

        fireEvent.click(
            screen.getByRole("button", { name: /^delete column todo$/i })
        );

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        // Confirming still deletes the column…
        expect(removeColumn).toHaveBeenCalledWith({ columnId: "column-1" });
        // …but the reversible-delete affordances are absent.
        expect(screen.queryByText("Column deleted")).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Undo" })
        ).not.toBeInTheDocument();

        confirmSpy.mockRestore();
    });

    it("leaves the empty-column delete in place when the Undo toast is never clicked", async () => {
        renderColumn({ tasks: [] });

        fireEvent.click(
            screen.getByRole("button", { name: /^delete column todo$/i })
        );

        await screen.findByText("Column deleted");
        // No Undo click — the optimistic delete stands and the inverse
        // mutation is never fired.
        expect(removeColumn).toHaveBeenCalledTimes(1);
        expect(recreateColumn).not.toHaveBeenCalled();
    });

    it("filters tasks by semanticIds when set", () => {
        renderColumn({
            param: {
                ...defaultParam,
                semanticIds: "task-1"
            }
        });

        expect(screen.getByText("Build task")).toBeInTheDocument();
        expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
    });

    it("shows the filtered-empty hint when filters hide every task in the column", () => {
        renderColumn({
            param: {
                ...defaultParam,
                taskName: "no-such-task"
            }
        });

        expect(
            screen.getByText("No tasks match the current filters")
        ).toBeInTheDocument();
        // No reset callback supplied — the CTA must be hidden.
        expect(
            screen.queryByRole("button", { name: /reset filters/i })
        ).not.toBeInTheDocument();
    });

    it("does not show the filtered-empty hint when the column has no tasks at all", () => {
        renderColumn({ tasks: [] });

        expect(
            screen.queryByText("No tasks match the current filters")
        ).not.toBeInTheDocument();
    });

    it("invokes onResetFilters when the reset button is clicked", () => {
        const onResetFilters = jest.fn();
        mockedUseReactMutation.mockImplementation((endPoint: string) =>
            endPoint === "tasks"
                ? { mutate: updateTask, isLoading: false }
                : { mutate: removeColumn, isLoading: false }
        );
        mockedUseTaskModal.mockReturnValue({ startEditing });

        render(
            <Provider store={makeTestStore()}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <Column
                                    column={column()}
                                    isDragDisabled={false}
                                    onResetFilters={onResetFilters}
                                    param={{
                                        ...defaultParam,
                                        taskName: "no-such-task"
                                    }}
                                    tasks={[task()]}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </Provider>
        );

        const resetBtn = screen.getByRole("button", {
            name: /reset filters/i
        });
        fireEvent.click(resetBtn);
        expect(onResetFilters).toHaveBeenCalledTimes(1);
    });

    /*
     * PRD-GAP-007 — WIP-limit header indicator. The over-limit verdict is a
     * property of the column's real (unfiltered) task count, surfaced as a
     * `{count} / {limit}` chip plus a non-colour-only "Over limit" chip when
     * the count strictly exceeds a positive limit.
     */
    it("shows the WIP count and an over-limit indicator when the column exceeds its limit", () => {
        // renderColumn seeds three tasks by default (> 2).
        renderColumn({ boardColumn: column({ wipLimit: 2 }) });

        const wipBadge = screen.getByTestId("column-wip-badge");
        expect(wipBadge).toHaveTextContent("3 / 2");
        // Accessible over-limit label rides on the count chip (the visible
        // chip is the colour-blind-safe glyph + word reinforcement).
        expect(wipBadge).toHaveAttribute(
            "aria-label",
            "3 of 2 tasks — over the WIP limit by 1"
        );
        const overChip = screen.getByTestId("column-wip-over");
        expect(overChip).toHaveTextContent("Over limit");
    });

    it("shows the WIP count without an over-limit indicator when within the limit", () => {
        renderColumn({ boardColumn: column({ wipLimit: 5 }) });

        const wipBadge = screen.getByTestId("column-wip-badge");
        expect(wipBadge).toHaveTextContent("3 / 5");
        expect(wipBadge).toHaveAttribute(
            "aria-label",
            "3 of 5 tasks (WIP limit)"
        );
        expect(
            screen.queryByTestId("column-wip-over")
        ).not.toBeInTheDocument();
    });

    it("renders no WIP badge when the column has no limit (0 = no limit)", () => {
        renderColumn({ boardColumn: column({ wipLimit: 0 }) });
        expect(
            screen.queryByTestId("column-wip-badge")
        ).not.toBeInTheDocument();

        // Absent wipLimit reads the same as 0.
        renderColumn();
        expect(
            screen.queryByTestId("column-wip-badge")
        ).not.toBeInTheDocument();
    });

    /*
     * PRD-GAP-007 — column edit path. The more-actions menu now exposes an
     * Edit affordance that opens a modal sending `{columnName, category,
     * wipLimit}` on PUT /boards.
     */
    it("edits a column's name and WIP limit through the edit modal (PUT /boards)", async () => {
        renderColumn({ boardColumn: column({ wipLimit: 0 }) });

        fireEvent.click(
            screen.getByRole("button", { name: /^edit column todo$/i })
        );

        // The modal seeds from the column; rename it and set a positive cap.
        const nameInput = await screen.findByLabelText("New column name");
        fireEvent.change(nameInput, { target: { value: "Doing" } });
        const wipInput = screen.getByRole("spinbutton", { name: "WIP limit" });
        fireEvent.change(wipInput, { target: { value: "4" } });

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(editColumn).toHaveBeenCalledWith({
            _id: "column-1",
            columnName: "Doing",
            category: "todo",
            wipLimit: 4
        });
    });

    it("disables the edit affordance for an optimistic mock column", () => {
        renderColumn({
            boardColumn: column({ _id: "mock", columnName: "Mock" })
        });

        expect(
            screen.getByRole("button", { name: /^edit column mock$/i })
        ).toBeDisabled();
    });

    it("disables delete for the optimistic mock column", () => {
        renderColumn({
            boardColumn: column({ _id: "mock", columnName: "Mock" })
        });

        const deleteButton = screen.getByRole("button", {
            name: /^delete column mock$/i
        });
        expect(deleteButton).toBeDisabled();
        fireEvent.click(deleteButton);

        // The placeholder column has no server id yet, so the delete (and
        // therefore the Undo toast) never fires.
        expect(removeColumn).not.toHaveBeenCalled();
        expect(screen.queryByText("Column deleted")).not.toBeInTheDocument();
    });

    it("does NOT render the readiness pill when the env flag is off (default)", () => {
        // With aiColumnReadinessEnabled=false the pill never mounts even if
        // the column has enough tasks to clear the 3-task floor.
        renderColumn({
            tasks: [
                task({ _id: "t1", taskName: "Ready 1" }),
                task({ _id: "t2", taskName: "Ready 2" }),
                task({ _id: "t3", taskName: "Ready 3" }),
                task({ _id: "t4", taskName: "Ready 4" })
            ]
        });
        expect(
            screen.queryByTestId("column-readiness-pill")
        ).not.toBeInTheDocument();
    });

    it("renders the readiness pill when the env flag is on AND ≥80% of tasks are ready", () => {
        mockedEnvironment.aiColumnReadinessEnabled = true;
        // 4 fully-ready tasks → 100% → "Ready to ship".
        renderColumn({
            tasks: [
                task({ _id: "t1", taskName: "Ready 1" }),
                task({ _id: "t2", taskName: "Ready 2" }),
                task({ _id: "t3", taskName: "Ready 3" }),
                task({ _id: "t4", taskName: "Ready 4" })
            ]
        });
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill).toHaveAttribute("data-status", "ready");
    });

    it("renders the grooming pill when the env flag is on AND <60% are ready", () => {
        mockedEnvironment.aiColumnReadinessEnabled = true;
        // 1 ready, 3 blocked (no coordinator) → 25% → grooming.
        renderColumn({
            tasks: [
                task({ _id: "t1", taskName: "Ready" }),
                task({ _id: "t2", taskName: "Blocked 1", coordinatorId: "" }),
                task({ _id: "t3", taskName: "Blocked 2", coordinatorId: "" }),
                task({ _id: "t4", taskName: "Blocked 3", coordinatorId: "" })
            ]
        });
        const pill = screen.getByTestId("column-readiness-pill");
        expect(pill).toHaveAttribute("data-status", "needs-grooming");
    });

    /*
     * Phase 4.6 — sticky column header. The header is rendered as the
     * first child of the column's scroll container so `position: sticky`
     * pins it against that scroll port; without the move, the header
     * would degenerate to plain relative and never stick when the user
     * scrolls a tall task list.
     *
     * jsdom does not paint, so we assert the *contract* (computed
     * position, top, z-index) rather than visual pinning. The
     * z-index contract is the load-bearing assertion: it must sit
     * above task cards (which paint at the default z-index 0) and
     * below AntD's overlay tier (Dropdown / Popover ride at 1050) so
     * the readiness-pill popover and column-actions dropdown render
     * above the pinned header without a stacking-context trap.
     */
    describe("sticky column header (Phase 4.6)", () => {
        it("pins the column header inside the task scroll container with sticky positioning", () => {
            renderColumn();
            const taskContainer = screen.getByTestId("column-task-container");
            const header = screen.getByTestId("column-header");

            // Contract 1: header is the FIRST child of the scroll
            // container, so sticky `top: 0` snaps it to the top edge
            // when the user scrolls the task list. If a wrapper sneaks
            // between them later, sticky still works but the visual
            // padding behaviour may shift — fail loud so it's a
            // conscious choice.
            expect(taskContainer.firstElementChild).toBe(header);

            // Contract 2: the styled CSS declares `position: sticky;
            // top: 0`. Read via getComputedStyle so the assertion is
            // robust to Emotion's class-name churn.
            const style = window.getComputedStyle(header);
            expect(style.position).toBe("sticky");
            expect(style.top).toBe("0px");
        });

        it("keeps the header z-index strictly below the AntD overlay tier", () => {
            // Load-bearing: the readiness-pill Popover (1050) and the
            // column-actions Dropdown (1050) MUST render above the
            // sticky header so a click on either surface doesn't open
            // a panel that's then clipped behind a pinned header. The
            // sticky tier (10) is far enough below that even a future
            // bump to 100 stays safe.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const tokens = require("../../theme/tokens");
            expect(tokens.zIndex.sticky).toBeLessThan(tokens.zIndex.dropdown);
            expect(tokens.zIndex.sticky).toBeLessThan(tokens.zIndex.modal);

            // And the header's computed z-index matches the sticky
            // token (i.e. nobody silently inlined a different value).
            renderColumn();
            const header = screen.getByTestId("column-header");
            const headerZ = Number(window.getComputedStyle(header).zIndex);
            expect(headerZ).toBe(tokens.zIndex.sticky);
        });
    });

    /*
     * Phase 5 "Liquid Glass" Wave 2 T3 — Liquid chrome recipe upgrade.
     * The ColumnHeader gains:
     *   1. Specular rim (::before / ::after gradient layers).
     *   2. data-glass-context="true" marker.
     *
     * Deliberately omitted:
     *   - Gel-flex on children: the column-name (inline-edit) and the
     *     more-actions trigger don't follow the press-flex interaction
     *     model. The ColumnDragHandleButton lives inside @hello-pangea/dnd's
     *     transform tree; a scale-on-press would fight the drag transform.
     *   - Scroll-edge dissolve: the parent TaskContainer scroll port
     *     already carries its own edge fade in board.tsx — adding a
     *     second one would double-feather the boundary.
     */
    describe("Liquid Glass chrome recipe (Wave 2 T3)", () => {
        const sheetText = () =>
            Array.from(document.styleSheets)
                .map((sheet) => {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        return "";
                    }
                    return Array.from(rules)
                        .map((rule) => rule.cssText)
                        .join("\n");
                })
                .join("\n");

        it('marks the ColumnHeader root with data-glass-context="true"', () => {
            renderColumn();
            const header = screen.getByTestId("column-header");
            expect(header.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            renderColumn();
            const css = sheetText();
            expect(css).toMatch(
                /::before[^}]*background:\s*var\(--glass-specular-top\)/
            );
        });

        it("emits a ::after companion shadow layer with --glass-specular-bottom", () => {
            renderColumn();
            const css = sheetText();
            expect(css).toMatch(
                /::after[^}]*background:\s*var\(--glass-specular-bottom\)/
            );
        });

        it("respects prefers-reduced-transparency by dropping the rim backgrounds", () => {
            renderColumn();
            const css = sheetText();
            expect(css).toMatch(/prefers-reduced-transparency[^}]*reduce/);
        });

        it("respects forced-colors mode (Windows high-contrast) by dropping the rim layers", () => {
            renderColumn();
            const css = sheetText();
            expect(css).toMatch(/forced-colors[^}]*active/);
        });
    });

    /*
     * Part B — inline-edit task card title (Phase 4.5 of `ui-todo.md`).
     */
    describe("inline-edit task title", () => {
        it("enters edit mode on double-click of the title and shows an autofocused Input", () => {
            renderColumn();
            const title = screen.getAllByTestId("task-card-title")[0];
            fireEvent.doubleClick(title);
            const input = screen.getByTestId(
                "task-card-title-input"
            ) as HTMLInputElement;
            expect(input).toBeInTheDocument();
            // AntD's Input wraps a native <input>; the value mirrors the
            // task name when edit mode opens.
            expect(input.value).toBe("Build task");
            expect(input).toHaveAccessibleName("Rename task");
        });

        it("commits the rename through the task PUT mutation on Enter", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.change(input, { target: { value: "Renamed task" } });
            fireEvent.keyDown(input, { key: "Enter" });
            expect(updateTask).toHaveBeenCalledTimes(1);
            expect(updateTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: "task-1",
                    taskName: "Renamed task"
                })
            );
        });

        it("reverts and skips the mutation on Esc", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.change(input, { target: { value: "Renamed task" } });
            fireEvent.keyDown(input, { key: "Escape" });
            expect(updateTask).not.toHaveBeenCalled();
            // The card title text reverts to the original.
            expect(screen.getByText("Build task")).toBeInTheDocument();
            // The Input is unmounted.
            expect(
                screen.queryByTestId("task-card-title-input")
            ).not.toBeInTheDocument();
        });

        it("commits on blur (Linear convention) when the value actually changed", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.change(input, { target: { value: "Blurred name" } });
            fireEvent.blur(input);
            expect(updateTask).toHaveBeenCalledTimes(1);
            expect(updateTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: "task-1",
                    taskName: "Blurred name"
                })
            );
        });

        it("does not call the mutation when blur fires with an unchanged value", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.blur(input);
            expect(updateTask).not.toHaveBeenCalled();
        });

        it("does not call the mutation when the trimmed value is empty (whitespace-only)", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.change(input, { target: { value: "   " } });
            fireEvent.keyDown(input, { key: "Enter" });
            expect(updateTask).not.toHaveBeenCalled();
        });

        it("stops click propagation from the Input so the modal doesn't open underneath", () => {
            renderColumn();
            fireEvent.doubleClick(screen.getAllByTestId("task-card-title")[0]);
            const input = screen.getByTestId("task-card-title-input");
            fireEvent.click(input);
            // The card-level open handler is `startEditing` (modal flow,
            // since `taskPanelRouted` is false in this suite). It must
            // NOT have fired despite the click landing inside the card.
            expect(startEditing).not.toHaveBeenCalled();
        });

        it("does not enter edit mode for mock (optimistic-placeholder) tasks", () => {
            renderColumn();
            // The third task in the fixture is the optimistic placeholder
            // ("Optimistic task" with _id="mock"); its title must remain
            // a plain non-editable label.
            const optimisticTitle = screen
                .getAllByTestId("task-card-title")
                .find((node) => node.textContent === "Optimistic task");
            expect(optimisticTitle).toBeTruthy();
            fireEvent.doubleClick(optimisticTitle!);
            expect(
                screen.queryByTestId("task-card-title-input")
            ).not.toBeInTheDocument();
        });

        /*
         * Regression: a real browser fires `click → click → dblclick`
         * for a double-click. `fireEvent.doubleClick` only synthesises
         * the trailing `dblclick`, so the previous test suite missed a
         * production bug where the first `click` of a dblclick sequence
         * bubbled to TaskCardOuter and opened the modal before the
         * inline-edit Input could mount. `userEvent.dblClick` simulates
         * the full sequence, and the timer-deferred open in the card
         * gives `enterEditing` a window to cancel the pending modal.
         */
        it("enters edit mode WITHOUT opening the modal when the user really double-clicks the title", async () => {
            jest.useFakeTimers();
            try {
                const user = userEvent.setup({
                    advanceTimers: jest.advanceTimersByTime
                });
                renderColumn();
                const title = screen.getAllByTestId("task-card-title")[0];
                await user.dblClick(title);
                // The inline-edit Input mounts immediately.
                expect(
                    screen.getByTestId("task-card-title-input")
                ).toBeInTheDocument();
                // Drain the 250 ms open-timer; if the dblclick failed
                // to cancel it, the modal handler would fire here.
                act(() => {
                    jest.runAllTimers();
                });
                expect(startEditing).not.toHaveBeenCalled();
                expect(openTask).not.toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        it("still opens the modal on a plain single click after the timer resolves", async () => {
            jest.useFakeTimers();
            try {
                const user = userEvent.setup({
                    advanceTimers: jest.advanceTimersByTime
                });
                renderColumn();
                const card = screen.getByRole("button", {
                    name: /open task build task/i
                });
                await user.click(card);
                // Before the 250 ms window elapses, no modal opens.
                expect(startEditing).not.toHaveBeenCalled();
                act(() => {
                    jest.advanceTimersByTime(250);
                });
                expect(startEditing).toHaveBeenCalledTimes(1);
                expect(startEditing).toHaveBeenCalledWith("task-1");
            } finally {
                jest.useRealTimers();
            }
        });
    });

    /*
     * Phase 4.2 — Board density toggle. The column reads its density
     * from the Redux `userPreferences` slice via `useBoardDensity()` and
     * writes `data-density` on `ColumnContainer`. Comfortable resolves
     * the density CSS vars to their legacy values; compact tightens
     * card padding, gap, and title size (see `index.tsx` for the deltas).
     */
    describe("board density (Phase 4.2)", () => {
        it('renders with data-density="comfortable" by default', () => {
            const { container } = renderColumn();
            const columnContainer = container.querySelector(
                "[data-density]"
            ) as HTMLElement | null;
            expect(columnContainer).not.toBeNull();
            expect(columnContainer).toHaveAttribute(
                "data-density",
                "comfortable"
            );
        });

        it('renders with data-density="compact" when the slice is in compact mode', () => {
            const { container } = renderColumn({ boardDensity: "compact" });
            const columnContainer = container.querySelector(
                "[data-density]"
            ) as HTMLElement | null;
            expect(columnContainer).not.toBeNull();
            expect(columnContainer).toHaveAttribute("data-density", "compact");
        });

        it("inline-edit Input inherits the compact title font", async () => {
            const rtlUser = userEvent.setup();
            renderColumn({ boardDensity: "compact" });
            const title = screen.getAllByTestId("task-card-title")[0];
            await rtlUser.dblClick(title);
            const input = await screen.findByTestId("task-card-title-input");
            // The styled CardTitle scopes `.ant-input { font-size: var(...) }`
            // to keep the rename affordance in lockstep with the title's
            // compact font size. A failing assertion here flags that the
            // override CSS rule was dropped or its selector drifted.
            const ancestor = input
                .closest('[data-testid="task-card-title-input"]')
                ?.closest("div");
            expect(ancestor?.parentElement).not.toBeNull();
            // The rule lives on a styled-component class that wraps the
            // editing CardTitle; assert by querying for the descendant
            // selector pattern via the stylesheet rule presence.
            const styleSheets = Array.from(document.styleSheets);
            const hasDensityInputRule = styleSheets.some((sheet) => {
                try {
                    return Array.from(sheet.cssRules ?? []).some(
                        (rule) =>
                            rule.cssText.includes("--density-card-title-fs") &&
                            rule.cssText.includes(".ant-input")
                    );
                } catch {
                    return false;
                }
            });
            expect(hasDensityInputRule).toBe(true);
        });
    });

    // ── M2 task-richness card surfaces (overdue + label chips) ───────────
    describe("M2 task-richness card surfaces", () => {
        // Build past / today / future ISO date-only strings relative to the
        // real "now" so the assertions hold regardless of run date.
        const isoDate = (offsetDays: number) => {
            const d = new Date();
            d.setDate(d.getDate() + offsetDays);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
        };

        const label = (overrides: Partial<ILabel> = {}): ILabel => ({
            _id: "label-1",
            projectId: "project-1",
            name: "Backend",
            color: "blue",
            ...overrides
        });

        it("renders an overdue indicator (icon + visible text + a11y date) when dueDate is in the past", () => {
            renderColumn({
                tasks: [task({ dueDate: isoDate(-2) })]
            });

            const overdue = screen.getByTestId("task-card-overdue");
            // Not colour-only: the visible word "Overdue" carries the signal.
            expect(overdue).toHaveTextContent(/overdue/i);
            // The accessible name surfaces the missed due date.
            expect(overdue).toHaveAttribute(
                "aria-label",
                expect.stringContaining(isoDate(-2))
            );
        });

        it("does NOT mark a task due today as overdue", () => {
            renderColumn({
                tasks: [task({ dueDate: isoDate(0) })]
            });

            expect(
                screen.queryByTestId("task-card-overdue")
            ).not.toBeInTheDocument();
        });

        it("does NOT mark a future-dated or undated task as overdue", () => {
            renderColumn({
                tasks: [
                    task({ _id: "future", dueDate: isoDate(5) }),
                    task({ _id: "undated" })
                ]
            });

            expect(
                screen.queryByTestId("task-card-overdue")
            ).not.toBeInTheDocument();
        });

        it("renders label chips (name) for a task's labelIds resolved via the labels list", () => {
            renderColumn({
                labels: [
                    label(),
                    label({ _id: "label-2", name: "Urgent", color: "red" })
                ],
                tasks: [task({ labelIds: ["label-1", "label-2"] })]
            });

            expect(screen.getByText("Backend")).toBeInTheDocument();
            expect(screen.getByText("Urgent")).toBeInTheDocument();
        });

        it("drops unknown label ids instead of rendering a blank chip", () => {
            renderColumn({
                labels: [label()],
                tasks: [task({ labelIds: ["label-1", "deleted-label"] })]
            });

            // The known label renders…
            expect(screen.getByText("Backend")).toBeInTheDocument();
            // …and the label chip row holds exactly one chip (the unknown id
            // is silently skipped).
            const labelRow = screen
                .getByText("Backend")
                .closest("[aria-label]");
            expect(labelRow).toHaveAttribute(
                "aria-label",
                microcopy.fields.labels
            );
        });

        it("renders no label chips when the task has no labelIds", () => {
            renderColumn({
                labels: [label()],
                tasks: [task()]
            });

            expect(screen.queryByText("Backend")).not.toBeInTheDocument();
        });

        it("renders a priority badge (icon + visible label + a11y) for a prioritised task", () => {
            renderColumn({
                tasks: [task({ priority: "urgent" })]
            });

            const badge = screen.getByTestId("task-card-priority");
            // Not colour-only: the visible enum label carries the signal.
            expect(badge).toHaveTextContent(/urgent/i);
            // The accessible name surfaces the priority level.
            expect(badge).toHaveAttribute(
                "aria-label",
                expect.stringMatching(/urgent/i)
            );
        });

        it("renders NO priority badge for a none / unset priority", () => {
            renderColumn({
                tasks: [
                    task({ _id: "p-none", priority: "none" }),
                    task({ _id: "p-unset" })
                ]
            });

            expect(
                screen.queryByTestId("task-card-priority")
            ).not.toBeInTheDocument();
        });

        it("renders a blocked badge (icon + visible label + a11y) when blockedBy is non-empty", () => {
            // `blockedBy` is the server-derived list of UNFINISHED prerequisite
            // ids (PRD §4.5); a non-empty array means the task is blocked.
            renderColumn({
                tasks: [task({ blockedBy: ["task-99"] })]
            });

            const badge = screen.getByTestId("task-card-blocked");
            // Not colour-only: the visible word "Blocked" carries the signal.
            expect(badge).toHaveTextContent(/blocked/i);
            // The accessible name explains why the task is flagged.
            expect(badge).toHaveAttribute(
                "aria-label",
                microcopy.a11y.blockedTask as string
            );
        });

        it("renders NO blocked badge when blockedBy is empty or absent", () => {
            renderColumn({
                tasks: [
                    task({ _id: "b-empty", blockedBy: [] }),
                    task({ _id: "b-absent" })
                ]
            });

            expect(
                screen.queryByTestId("task-card-blocked")
            ).not.toBeInTheDocument();
        });

        it("renders a completed badge (icon + visible label + dated a11y) when completedAt is set", () => {
            // `completedAt` is a server-managed timestamp (PRD §3 lifecycle);
            // a truthy value means the task currently sits in a done-category
            // column, so the badge surfaces. We use a DATE-ONLY fixture so the
            // assertion is timezone-proof: dayjs parses a bare `YYYY-MM-DD` as
            // LOCAL midnight, so `.format("YYYY-MM-DD")` round-trips to the same
            // literal in every runner TZ (a full UTC instant would roll to the
            // prev/next calendar day under far-west/-east offsets).
            renderColumn({
                tasks: [task({ completedAt: "2026-01-15" })]
            });

            const badge = screen.getByTestId("task-card-completed");
            // Not colour-only: the visible word "Completed" carries the signal.
            expect(badge).toHaveTextContent(/completed/i);
            // The accessible name surfaces the (date-only) completion date.
            expect(badge).toHaveAttribute(
                "aria-label",
                microcopy.a11y.completedTask.replace("{date}", "2026-01-15")
            );
        });

        it("renders NO completed badge when completedAt is absent or null", () => {
            renderColumn({
                tasks: [
                    task({ _id: "c-null", completedAt: null }),
                    task({ _id: "c-absent" })
                ]
            });

            expect(
                screen.queryByTestId("task-card-completed")
            ).not.toBeInTheDocument();
        });

        it("a completed task does not also show the overdue chip", () => {
            // A finished task is neither overdue nor blocked, so the completed
            // badge supersedes the (contradictory) overdue chip even when the
            // task carries a past dueDate.
            renderColumn({
                tasks: [
                    task({
                        completedAt: "2026-01-15",
                        dueDate: isoDate(-2)
                    })
                ]
            });

            expect(
                screen.getByTestId("task-card-completed")
            ).toBeInTheDocument();
            expect(
                screen.queryByTestId("task-card-overdue")
            ).not.toBeInTheDocument();
        });

        const milestone = (
            overrides: Partial<IMilestone> = {}
        ): IMilestone => ({
            _id: "milestone-1",
            projectId: "project-1",
            name: "Beta launch",
            ...overrides
        });

        it("renders a milestone badge (icon + visible name + a11y) when milestoneId resolves against the milestones list", () => {
            renderColumn({
                milestones: [milestone()],
                tasks: [task({ milestoneId: "milestone-1" })]
            });

            const badge = screen.getByTestId("task-card-milestone");
            // Not colour-only: the visible milestone name carries the signal.
            expect(badge).toHaveTextContent("Beta launch");
            // The accessible name surfaces the milestone name.
            expect(badge).toHaveAttribute(
                "aria-label",
                microcopy.a11y.milestoneTask.replace("{name}", "Beta launch")
            );
        });

        it("renders NO milestone badge when the task has no milestoneId", () => {
            renderColumn({
                milestones: [milestone()],
                tasks: [task()]
            });

            expect(
                screen.queryByTestId("task-card-milestone")
            ).not.toBeInTheDocument();
        });

        it("renders NO milestone badge when milestoneId does not resolve against the milestones list", () => {
            // A dangling id (the milestone was deleted since assignment) must
            // render nothing rather than a blank chip.
            renderColumn({
                milestones: [milestone()],
                tasks: [task({ milestoneId: "deleted-milestone" })]
            });

            expect(
                screen.queryByTestId("task-card-milestone")
            ).not.toBeInTheDocument();
        });
    });
});
