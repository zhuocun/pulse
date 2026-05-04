import deleteTaskCallback from "./deleteTask";

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

describe("deleteTaskCallback", () => {
    it("preserves a missing task cache without creating optimistic data", () => {
        expect(deleteTaskCallback({ taskId: "task-1" }, undefined)).toBe(
            undefined
        );
    });

    it("removes the matching task from the existing cache", () => {
        const oldTasks = [
            task({ _id: "task-1", taskName: "First" }),
            task({ _id: "task-2", taskName: "Second" }),
            task({ _id: "task-3", taskName: "Third" })
        ];

        const result = deleteTaskCallback({ taskId: "task-2" }, oldTasks);

        expect(result).not.toBe(oldTasks);
        expect(result?.map((item) => item._id)).toEqual(["task-1", "task-3"]);
        expect(oldTasks.map((item) => item._id)).toEqual([
            "task-1",
            "task-2",
            "task-3"
        ]);
    });

    it("leaves the cache unchanged when the target task is missing", () => {
        const oldTasks = [
            task({ _id: "task-1", taskName: "First" }),
            task({ _id: "task-2", taskName: "Second" })
        ];

        const result = deleteTaskCallback({ taskId: "missing" }, oldTasks);

        expect(result).toBe(oldTasks);
        expect(result?.map((item) => item._id)).toEqual(["task-1", "task-2"]);
    });
});
