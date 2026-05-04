import { fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "antd";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import { TaskSearchParam } from "../taskSearchPanel";

import Column from ".";

jest.mock("../../utils/hooks/useReactMutation");
jest.mock("../../utils/hooks/useTaskModal");

type DragMockProps = {
    children: ReactNode;
    draggableId: string;
    isDragDisabled?: boolean;
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

jest.mock("../dragAndDrop", () => ({
    Drag: ({ children, draggableId, isDragDisabled }: DragMockProps) => (
        <div data-disabled={String(isDragDisabled)} data-testid={draggableId}>
            {children}
        </div>
    ),
    Drop: ({ children, droppableId }: DropMockProps) => (
        <div data-testid={`drop-${droppableId}`}>{children}</div>
    ),
    DropChild: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

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

const removeColumn = jest.fn();
const startEditing = jest.fn();

const renderColumn = ({
    boardColumn = column(),
    isDragDisabled = false,
    taskDragDisabled,
    boardAiOn = true,
    param = defaultParam,
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
    param?: TaskSearchParam;
    tasks?: ITask[];
    boardAiOn?: boolean;
} = {}) => {
    mockedUseReactMutation.mockReturnValue({ mutate: removeColumn });
    mockedUseTaskModal.mockReturnValue({ startEditing });

    return render(
        <MemoryRouter initialEntries={["/projects/project-1/board"]}>
            <Routes>
                <Route
                    path="/projects/:projectId/board"
                    element={
                        <Column
                            boardAiOn={boardAiOn}
                            column={boardColumn}
                            isDragDisabled={isDragDisabled}
                            param={param}
                            taskDragDisabled={taskDragDisabled}
                            tasks={tasks}
                        />
                    }
                />
            </Routes>
        </MemoryRouter>
    );
};

describe("Column", () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

        expect(screen.getByRole("heading", { name: "Todo" })).toHaveStyle({
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

    it("starts editing non-mock tasks but ignores mock tasks", () => {
        renderColumn();

        fireEvent.click(screen.getByText("Build task"));
        fireEvent.click(screen.getByText("Optimistic task"));

        expect(startEditing).toHaveBeenCalledTimes(1);
        expect(startEditing).toHaveBeenCalledWith("task-1");
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
        expect(
            screen.getByTestId("task-unsaved-0-Unsaved-task")
        ).toHaveAttribute("data-disabled", "true");
        expect(
            screen.getByRole("button", { name: "Open task Unsaved task" })
        ).toBeDisabled();
    });

    it("confirms column deletion before calling the delete mutation", () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        renderColumn();

        fireEvent.click(
            screen.getByRole("button", { name: /^delete column todo$/i })
        );

        expect(confirmSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "This action cannot be undone.",
                title: "Delete this column?"
            })
        );
        expect(removeColumn).toHaveBeenCalledWith({ columnId: "column-1" });

        confirmSpy.mockRestore();
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
        mockedUseReactMutation.mockReturnValue({ mutate: removeColumn });
        mockedUseTaskModal.mockReturnValue({ startEditing });

        render(
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
        );

        const resetBtn = screen.getByRole("button", {
            name: /reset filters/i
        });
        fireEvent.click(resetBtn);
        expect(onResetFilters).toHaveBeenCalledTimes(1);
    });

    it("disables delete for the optimistic mock column", () => {
        const confirmSpy = jest.spyOn(Modal, "confirm");
        renderColumn({
            boardColumn: column({ _id: "mock", columnName: "Mock" })
        });

        const deleteButton = screen.getByRole("button", {
            name: /^delete column mock$/i
        });
        expect(deleteButton).toBeDisabled();
        fireEvent.click(deleteButton);

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(removeColumn).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
    });
});
