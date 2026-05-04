import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import useDragEnd from "./useDragEnd";
import useReactMutation from "./useReactMutation";
import useReactQuery, { getReactQueryKey } from "./useReactQuery";

jest.mock("./useReactMutation");
jest.mock("./useReactQuery");

const mockedUseReactQuery = useReactQuery as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.Mock;

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
    note: "Ship it",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { gcTime: Infinity, retry: false }
        }
    });

let result: ReturnType<typeof useDragEnd>;
const reorderColumn = jest.fn();
const reorderTask = jest.fn();

let queryClient: QueryClient;

let tasksEnabledArg = true;
const Probe = () => {
    result = useDragEnd({ tasksEnabled: tasksEnabledArg });

    return (
        <div>
            {String(result.isColumnDragDisabled)}-
            {String(result.isTaskDragDisabled)}
        </div>
    );
};

const defaultBoards = [
    column({ _id: "column-1", columnName: "Todo", index: 0 }),
    column({ _id: "column-2", columnName: "Doing", index: 1 }),
    column({ _id: "column-3", columnName: "Done", index: 2 })
];

const defaultTasks = [
    task({ _id: "task-1", columnId: "column-1", taskName: "One" }),
    task({ _id: "task-2", columnId: "column-1", taskName: "Two" }),
    task({ _id: "task-3", columnId: "column-2", taskName: "Three" })
];

type RenderProbeOptions = {
    boards?: IColumn[] | undefined;
    tasks?: ITask[] | undefined;
    columnLoading?: boolean;
    taskLoading?: boolean;
    tasksEnabled?: boolean;
};

const renderProbe = (options: RenderProbeOptions = {}) => {
    tasksEnabledArg = options.tasksEnabled ?? true;
    const { columnLoading = false, taskLoading = false } = options;
    const boardData = Object.prototype.hasOwnProperty.call(options, "boards")
        ? options.boards
        : defaultBoards;
    const taskData = Object.prototype.hasOwnProperty.call(options, "tasks")
        ? options.tasks
        : defaultTasks;

    mockedUseReactQuery.mockImplementation(
        (endpoint: string, ...rest: unknown[]) =>
            endpoint === "boards"
                ? { data: boardData }
                : {
                      data: taskData,
                      tasksQueryEnabled: rest[4] as boolean | undefined
                  }
    );
    mockedUseReactMutation.mockImplementation((endpoint: string) =>
        endpoint === "boards/orders"
            ? { isLoading: columnLoading, mutate: reorderColumn }
            : { isLoading: taskLoading, mutate: reorderTask }
    );

    queryClient = createQueryClient();

    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={<Probe />}
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
};

const drop = (
    source: { droppableId: string; index: number },
    destination: { droppableId: string; index: number } | null,
    type: "COLUMN" | "ROW" = "ROW"
) =>
    result.onDragEnd({
        combine: null,
        destination,
        draggableId: "drag-1",
        mode: "FLUID",
        reason: "DROP",
        source,
        type
    });

describe("useDragEnd", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("exposes reorder loading flags as drag-disabled flags", () => {
        const { getByText } = renderProbe({
            columnLoading: true,
            taskLoading: true
        });

        expect(getByText("true-true")).toBeInTheDocument();
    });

    it("ignores drops without a destination", () => {
        renderProbe();

        drop({ droppableId: "column-1", index: 0 }, null, "COLUMN");

        expect(reorderColumn).not.toHaveBeenCalled();
        expect(reorderTask).not.toHaveBeenCalled();
    });

    it("maps a column drag to an after reorder payload", () => {
        renderProbe();

        drop(
            { droppableId: "column", index: 0 },
            { droppableId: "column", index: 2 },
            "COLUMN"
        );

        expect(reorderColumn).toHaveBeenCalledWith({
            fromId: "column-1",
            referenceId: "column-3",
            type: "after"
        });
        expect(reorderTask).not.toHaveBeenCalled();
    });

    it("maps a column drag to a before reorder payload", () => {
        renderProbe();

        drop(
            { droppableId: "column", index: 2 },
            { droppableId: "column", index: 0 },
            "COLUMN"
        );

        expect(reorderColumn).toHaveBeenCalledWith({
            fromId: "column-3",
            referenceId: "column-1",
            type: "before"
        });
    });

    it("ignores same-column column drags", () => {
        renderProbe({ boards: [column({ _id: "column-1" })] });

        drop(
            { droppableId: "column", index: 0 },
            { droppableId: "column", index: 0 },
            "COLUMN"
        );

        expect(reorderColumn).not.toHaveBeenCalled();
    });

    it("ignores column drags while board data is unavailable", () => {
        renderProbe({ boards: undefined });

        drop(
            { droppableId: "column", index: 0 },
            { droppableId: "column", index: 1 },
            "COLUMN"
        );

        expect(reorderColumn).not.toHaveBeenCalled();
    });

    it("uses after for a same-column downward task move", () => {
        renderProbe();

        drop(
            { droppableId: "column-1", index: 0 },
            { droppableId: "column-1", index: 1 }
        );

        expect(reorderTask).toHaveBeenCalledWith({
            fromColumnId: "column-1",
            fromId: "task-1",
            referenceColumnId: "column-1",
            referenceId: "task-2",
            type: "after"
        });
    });

    it("uses before for a same-column upward task move", () => {
        renderProbe();

        drop(
            { droppableId: "column-1", index: 1 },
            { droppableId: "column-1", index: 0 }
        );

        expect(reorderTask).toHaveBeenCalledWith({
            fromColumnId: "column-1",
            fromId: "task-2",
            referenceColumnId: "column-1",
            referenceId: "task-1",
            type: "before"
        });
    });

    it("uses before for a cross-column task move", () => {
        renderProbe();

        drop(
            { droppableId: "column-1", index: 1 },
            { droppableId: "column-2", index: 0 }
        );

        expect(reorderTask).toHaveBeenCalledWith({
            fromColumnId: "column-1",
            fromId: "task-2",
            referenceColumnId: "column-2",
            referenceId: "task-3",
            type: "before"
        });
    });

    it("passes an empty reference id for empty target-column drops", () => {
        renderProbe();

        drop(
            { droppableId: "column-1", index: 0 },
            { droppableId: "column-3", index: 0 }
        );

        expect(reorderTask).toHaveBeenCalledWith({
            fromColumnId: "column-1",
            fromId: "task-1",
            referenceColumnId: "column-3",
            referenceId: "",
            type: "before"
        });
    });

    it("ignores task drags when the source task cannot be resolved", () => {
        renderProbe({ tasks: defaultTasks.slice(1) });

        drop(
            { droppableId: "column-1", index: 1 },
            { droppableId: "column-2", index: 0 }
        );

        expect(reorderTask).not.toHaveBeenCalled();
    });

    it("reads cached tasks when the tasks query is disabled but cache is warm", () => {
        renderProbe({ tasksEnabled: false, tasks: undefined });
        queryClient.setQueryData(
            getReactQueryKey("tasks", { projectId: "project-1" }),
            defaultTasks
        );

        drop(
            { droppableId: "column-1", index: 0 },
            { droppableId: "column-1", index: 1 }
        );

        expect(reorderTask).toHaveBeenCalledWith({
            fromColumnId: "column-1",
            fromId: "task-1",
            referenceColumnId: "column-1",
            referenceId: "task-2",
            type: "after"
        });
    });

    it("ignores dragging a task onto itself", () => {
        renderProbe();

        drop(
            { droppableId: "column-1", index: 0 },
            { droppableId: "column-1", index: 0 }
        );

        expect(reorderTask).not.toHaveBeenCalled();
    });
});
