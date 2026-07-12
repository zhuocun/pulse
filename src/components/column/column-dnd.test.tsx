import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DragDropContext } from "@hello-pangea/dnd";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { userPreferencesSlice } from "../../store/reducers/userPreferencesSlice";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import { Drag, Drop, DropChild } from "../dragAndDrop";
import { TaskSearchParam } from "../taskSearchPanel";

import Column from ".";

/*
 * The column more-actions menu raises an Undo toast via the out-of-Batch-B,
 * AntD-backed `useUndoToast` / `useAppMessage` hooks. Mock them so this DnD
 * suite stays free of AntD's global message container.
 */
jest.mock("../../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn(() => ({ dismiss: jest.fn() })) })
}));
jest.mock("../../utils/hooks/useAppMessage", () => ({
    __esModule: true,
    default: () => ({
        error: jest.fn(),
        success: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
        loading: jest.fn(),
        open: jest.fn(),
        destroy: jest.fn()
    })
}));

/*
 * Radix `DropdownMenu` (the column more-actions menu) drives its surface
 * with pointer-capture and `scrollIntoView`, neither of which jsdom
 * implements.
 */
Element.prototype.scrollIntoView = jest.fn();
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = jest.fn(() => false);
}
if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = jest.fn();
}
if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = jest.fn();
}

const makeTestStore = () =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto" as const,
                // Phase 6 Wave 1 — preloadedState must carry the
                // current migration sentinel; the slice's
                // UserPreferencesState type now requires it.
                glassIntensityVersion: 1,
                colorTheme: "orange" as const
            }
        }
    });

jest.mock("../../utils/hooks/useReactMutation");
jest.mock("../../utils/hooks/useTaskModal");
// Phase 3 A2 — `useTaskPanelNavigation` now reads from `useReactQuery`
// so Column needs the hook to be either mocked or wrapped in a
// QueryClientProvider. Mock here mirrors what `column/index.test.tsx`
// already does; the DnD suite focuses on drag behaviour, not navigation.
jest.mock("../../utils/hooks/useTaskPanelNavigation", () => ({
    __esModule: true,
    default: () => ({
        openTask: jest.fn(),
        closeTask: jest.fn(),
        goToNext: jest.fn(),
        goToPrev: jest.fn(),
        nextTaskId: null,
        prevTaskId: null
    })
}));

type TaskCreatorMockProps = {
    columnId?: string;
    disabled?: boolean;
    boardAiOn?: boolean;
};

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

const mockedUseReactMutation = useReactMutation as jest.Mock;
const mockedUseTaskModal = useTaskModal as jest.Mock;

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

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
) =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

const renderColumnWithColumnDnD = (options?: { startEditing?: jest.Mock }) => {
    mockedUseReactMutation.mockReturnValue({ mutate: jest.fn() });
    mockedUseTaskModal.mockReturnValue({
        startEditing: options?.startEditing ?? jest.fn()
    });

    return render(
        <Provider store={makeTestStore()}>
            <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <DragDropContext onDragEnd={() => undefined}>
                                <Drop
                                    direction="horizontal"
                                    droppableId="column"
                                    type="COLUMN"
                                >
                                    <DropChild style={{ display: "flex" }}>
                                        <Drag
                                            detachDragHandle
                                            disableInteractiveElementBlocking
                                            draggableId="columncolumn-1"
                                            index={0}
                                            isDragDisabled={false}
                                        >
                                            <Column
                                                column={column()}
                                                isDragDisabled={false}
                                                param={defaultParam}
                                                tasks={[task()]}
                                            />
                                        </Drag>
                                    </DropChild>
                                </Drop>
                            </DragDropContext>
                        }
                    />
                </Routes>
            </MemoryRouter>
        </Provider>
    );
};

describe("Column DnD affordances (live @hello-pangea/dnd)", () => {
    it("delivers clicks to the task card button inside a task Draggable (native button is not event-blocked)", async () => {
        const user = userEvent.setup();
        const startEditing = jest.fn();

        renderColumnWithColumnDnD({ startEditing });

        await user.click(
            screen.getByRole("button", {
                name: formatTemplate(microcopy.a11y.openTask as string, {
                    name: "Build task"
                })
            })
        );

        // TaskCardOuter now defers `onOpen()` by 250 ms so a real
        // browser's `click → click → dblclick` sequence has a chance
        // to cancel the modal before it opens (see the dblclick
        // regression coverage in `index.test.tsx`). Wait for the
        // timer to drain rather than asserting synchronously.
        await waitFor(() => {
            expect(startEditing).toHaveBeenCalledTimes(1);
        });
        expect(startEditing).toHaveBeenCalledWith("task-1");
    });

    it("delivers clicks to the column more-actions control inside a column Draggable", async () => {
        const user = userEvent.setup();

        renderColumnWithColumnDnD();

        await user.click(
            screen.getByRole("button", {
                name: formatTemplate(
                    microcopy.a11y.moreActionsForColumn as string,
                    {
                        name: "Todo"
                    }
                )
            })
        );

        // The click reaches the Radix DropdownMenu trigger (the native
        // button is not event-blocked inside the column Draggable), so the
        // menu opens and surfaces its edit / delete items.
        expect(
            await screen.findByRole("menuitem", {
                name: formatTemplate(microcopy.a11y.editColumnNamed as string, {
                    name: "Todo"
                })
            })
        ).toBeInTheDocument();
    });

    it("exposes an accessible column drag handle with RFD handle attributes, not on the column surface", () => {
        renderColumnWithColumnDnD();

        const handle = screen.getByRole("button", {
            name: microcopy.dragHints.columnDragHandle
        });
        expect(handle).toHaveAttribute(
            "data-rfd-drag-handle-draggable-id",
            "columncolumn-1"
        );

        const draggableSurface = document.querySelector(
            '[data-rfd-draggable-id="columncolumn-1"]'
        );
        expect(draggableSurface).toBeTruthy();
        expect(draggableSurface).not.toHaveAttribute(
            "data-rfd-drag-handle-draggable-id"
        );
    });

    it("does not render the column handle when column drag is disabled", () => {
        mockedUseReactMutation.mockReturnValue({ mutate: jest.fn() });
        mockedUseTaskModal.mockReturnValue({ startEditing: jest.fn() });

        render(
            <Provider store={makeTestStore()}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <DragDropContext onDragEnd={() => undefined}>
                                    <Drop
                                        direction="horizontal"
                                        droppableId="column"
                                        type="COLUMN"
                                    >
                                        <DropChild style={{ display: "flex" }}>
                                            <Drag
                                                detachDragHandle
                                                disableInteractiveElementBlocking
                                                draggableId="columncolumn-1"
                                                index={0}
                                                isDragDisabled
                                            >
                                                <Column
                                                    column={column()}
                                                    isDragDisabled={false}
                                                    param={defaultParam}
                                                    tasks={[task()]}
                                                />
                                            </Drag>
                                        </DropChild>
                                    </Drop>
                                </DragDropContext>
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </Provider>
        );

        expect(
            screen.queryByRole("button", {
                name: microcopy.dragHints.columnDragHandle
            })
        ).not.toBeInTheDocument();
    });
});
