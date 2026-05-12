import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DragDropContext } from "@hello-pangea/dnd";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import { Drag, Drop, DropChild } from "../dragAndDrop";
import { TaskSearchParam } from "../taskSearchPanel";

import Column from ".";

jest.mock("../../utils/hooks/useReactMutation");
jest.mock("../../utils/hooks/useTaskModal");

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

        expect(startEditing).toHaveBeenCalledTimes(1);
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

        expect(screen.getByTestId("dropdown-menu")).toBeInTheDocument();
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
        );

        expect(
            screen.queryByRole("button", {
                name: microcopy.dragHints.columnDragHandle
            })
        ).not.toBeInTheDocument();
    });
});
