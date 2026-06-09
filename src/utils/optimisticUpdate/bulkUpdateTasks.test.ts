import bulkUpdateTasksCallback from "./bulkUpdateTasks";

const task = (overrides: Partial<ITask> = {}): ITask =>
    ({
        _id: "t1",
        columnId: "c1",
        coordinatorId: "m1",
        epic: "Feature",
        index: 0,
        note: "",
        projectId: "p1",
        storyPoints: 1,
        taskName: "Build",
        type: "Task",
        ...overrides
    }) as ITask;

describe("bulkUpdateTasksCallback", () => {
    it("returns the old value untouched when the cache is empty", () => {
        expect(
            bulkUpdateTasksCallback(
                { taskIds: ["t1"], changes: { priority: "high" } },
                undefined
            )
        ).toBeUndefined();
    });

    it("patches only the targeted tasks with the change set", () => {
        const old = [
            task({ _id: "t1", priority: "none" }),
            task({ _id: "t2", priority: "low" }),
            task({ _id: "t3", priority: "medium" })
        ];

        const next = bulkUpdateTasksCallback(
            { taskIds: ["t1", "t3"], changes: { priority: "urgent" } },
            old
        ) as ITask[];

        expect(next[0].priority).toBe("urgent");
        // Untargeted task is left exactly as-is (same reference even).
        expect(next[1]).toBe(old[1]);
        expect(next[2].priority).toBe("urgent");
    });

    it("applies multiple fields and an explicit label clear at once", () => {
        const old = [task({ _id: "t1", labelIds: ["l1"] })];

        const next = bulkUpdateTasksCallback(
            {
                taskIds: ["t1"],
                changes: { coordinatorId: "m2", labelIds: [] }
            },
            old
        ) as ITask[];

        expect(next[0].coordinatorId).toBe("m2");
        expect(next[0].labelIds).toEqual([]);
    });
});
