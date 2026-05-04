import { columnCallback, taskCallback } from "./reorder";

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    projectId: "project-1",
    index: 0,
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Platform",
    taskName: "Existing task",
    type: "Task",
    note: "Existing note",
    projectId: "project-1",
    storyPoints: 3,
    index: 0,
    ...overrides
});

const ids = <T extends { _id: string }>(items: T[]) =>
    items.map((item) => item._id);

describe("columnCallback", () => {
    const columns = [
        column({ _id: "column-1", columnName: "Todo", index: 0 }),
        column({ _id: "column-2", columnName: "Doing", index: 1 }),
        column({ _id: "column-3", columnName: "Done", index: 2 })
    ];

    it("moves a column before the reference column", () => {
        const result = columnCallback(
            {
                fromId: "column-3",
                referenceId: "column-1",
                type: "before"
            },
            columns
        );

        expect(ids(result)).toEqual(["column-3", "column-1", "column-2"]);
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
        expect(ids(columns)).toEqual(["column-1", "column-2", "column-3"]);
    });

    it("moves a column after the reference column", () => {
        const result = columnCallback(
            {
                fromId: "column-1",
                referenceId: "column-3",
                type: "after"
            },
            columns
        );

        expect(ids(result)).toEqual(["column-2", "column-3", "column-1"]);
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("moves a column to the end when there is no reference id", () => {
        const result = columnCallback(
            {
                fromId: "column-1",
                referenceId: "",
                type: "after"
            },
            columns
        );

        expect(ids(result)).toEqual(["column-2", "column-3", "column-1"]);
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("preserves order when moving the last column with no reference id", () => {
        const result = columnCallback(
            {
                fromId: "column-3",
                referenceId: "",
                type: "after"
            },
            columns
        );

        expect(ids(result)).toEqual(["column-1", "column-2", "column-3"]);
        expect(result).not.toBe(columns);
    });

    it("preserves order when the moving column cannot be found", () => {
        const result = columnCallback(
            {
                fromId: "missing",
                referenceId: "column-1",
                type: "before"
            },
            columns
        );

        expect(result).toEqual(columns);
        expect(result).not.toBe(columns);
    });

    it("preserves order when the reference column cannot be found", () => {
        const result = columnCallback(
            {
                fromId: "column-1",
                referenceId: "missing",
                type: "before"
            },
            columns
        );

        expect(result).toEqual(columns);
        expect(result).not.toBe(columns);
    });
});

describe("taskCallback", () => {
    const tasks = [
        task({ _id: "task-1", taskName: "Todo one", columnId: "column-1" }),
        task({ _id: "task-2", taskName: "Todo two", columnId: "column-1" }),
        task({ _id: "task-3", taskName: "Doing one", columnId: "column-2" })
    ];

    it("moves a task before the reference task in the same column", () => {
        const result = taskCallback(
            {
                fromId: "task-2",
                referenceId: "task-1",
                fromColumnId: "column-1",
                referenceColumnId: "column-1",
                type: "before"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-2", "task-1", "task-3"]);
        expect(result.find((item) => item._id === "task-2")?.columnId).toBe(
            "column-1"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
        expect(ids(tasks)).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("moves a task after the reference task and updates the moved task column", () => {
        const result = taskCallback(
            {
                fromId: "task-1",
                referenceId: "task-3",
                fromColumnId: "column-1",
                referenceColumnId: "column-2",
                type: "after"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-2", "task-3", "task-1"]);
        expect(result.find((item) => item._id === "task-1")?.columnId).toBe(
            "column-2"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("moves a task to an empty target column position when there is no reference id", () => {
        const result = taskCallback(
            {
                fromId: "task-1",
                referenceId: "",
                fromColumnId: "column-1",
                referenceColumnId: "column-3",
                type: "after"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-2", "task-3", "task-1"]);
        expect(result.find((item) => item._id === "task-1")?.columnId).toBe(
            "column-3"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("preserves order when the last task is moved with no reference id", () => {
        const result = taskCallback(
            {
                fromId: "task-3",
                referenceId: "",
                fromColumnId: "column-2",
                referenceColumnId: "column-2",
                type: "after"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-1", "task-2", "task-3"]);
        expect(result.find((item) => item._id === "task-3")?.columnId).toBe(
            "column-2"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("keeps the moved task aligned to the destination column even when the order is unchanged", () => {
        const result = taskCallback(
            {
                fromId: "task-3",
                referenceId: "missing",
                fromColumnId: "column-2",
                referenceColumnId: "column-1",
                type: "before"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-1", "task-2", "task-3"]);
        expect(result.find((item) => item._id === "task-3")?.columnId).toBe(
            "column-1"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("preserves order when the moving task cannot be found", () => {
        const result = taskCallback(
            {
                fromId: "missing",
                referenceId: "task-1",
                fromColumnId: "column-1",
                referenceColumnId: "column-1",
                type: "before"
            },
            tasks
        );

        expect(ids(result)).toEqual(ids(tasks));
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
        expect(result).not.toBe(tasks);
    });

    it("preserves order when the reference task cannot be found", () => {
        const result = taskCallback(
            {
                fromId: "task-1",
                referenceId: "missing",
                fromColumnId: "column-1",
                referenceColumnId: "column-2",
                type: "before"
            },
            tasks
        );

        expect(ids(result)).toEqual(["task-1", "task-2", "task-3"]);
        expect(result.find((item) => item._id === "task-1")?.columnId).toBe(
            "column-1"
        );
        expect(result.map((item) => item.index)).toEqual([0, 1, 2]);
    });
});
