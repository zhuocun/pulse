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

    it("creates an optimistic list when there is no existing task cache", () => {
        const [created] = newTaskCallback(target, undefined) as ITask[];
        expect(created).toMatchObject(target);
        expect(created._id.startsWith("tmp-")).toBe(true);
    });

    it("appends a mock task with submitted fields without mutating the old array", () => {
        const oldTasks = [task()];

        const result = newTaskCallback(target, oldTasks);

        expect(result[0]).toEqual(task());
        expect(result[1]).toMatchObject(target);
        expect(result[1]._id.startsWith("tmp-")).toBe(true);
        expect(result).not.toBe(oldTasks);
        expect(oldTasks).toEqual([task()]);
    });
});
