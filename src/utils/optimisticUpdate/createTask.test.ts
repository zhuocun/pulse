import newTaskCallback from "./createTask";

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

describe("newTaskCallback", () => {
    const target = {
        taskName: "Draft task",
        projectId: "project-1",
        columnId: "column-2",
        coordinatorId: "member-2",
        type: "Task",
        epic: "New Feature",
        storyPoints: 1,
        note: "No note yet"
    } as const;

    it("preserves the empty cache when there is no existing task cache", () => {
        expect(newTaskCallback(target, undefined)).toBeUndefined();
    });

    it("appends a mock task with submitted fields without mutating the old array", () => {
        const oldTasks = [task()];

        const result = newTaskCallback(target, oldTasks);

        expect(result).toEqual([task(), { ...target, _id: "mock" }]);
        expect(result).not.toBe(oldTasks);
        expect(oldTasks).toEqual([task()]);
    });
});
