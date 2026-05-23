import { buildLensPredicate } from "./lensPredicate";

const task = (overrides: Partial<ITask> & { dueDate?: string } = {}) =>
    ({
        _id: "task-1",
        columnId: "column-1",
        coordinatorId: "u-self",
        epic: "Feature",
        index: 0,
        note: "",
        projectId: "p-1",
        storyPoints: 1,
        taskName: "Build",
        type: "Task",
        ...overrides
    }) as ITask;

describe("buildLensPredicate", () => {
    it("returns a pass-through predicate when lens is null", () => {
        const predicate = buildLensPredicate({
            lens: null,
            currentUserId: "u-self"
        });
        expect(predicate(task())).toBe(true);
        expect(predicate(task({ coordinatorId: "u-other" }))).toBe(true);
    });

    describe("mine lens (functional today)", () => {
        it("matches only tasks coordinated by the current user", () => {
            const predicate = buildLensPredicate({
                lens: "mine",
                currentUserId: "u-self"
            });
            expect(predicate(task({ coordinatorId: "u-self" }))).toBe(true);
            expect(predicate(task({ coordinatorId: "u-other" }))).toBe(false);
        });

        it("matches no tasks when no current user is provided", () => {
            const predicate = buildLensPredicate({
                lens: "mine",
                currentUserId: undefined
            });
            // We surface "nothing" rather than "everything" when a signed-out
            // user somehow toggles the Mine lens — avoids the surprise of
            // every task matching for a session that has no identity.
            expect(predicate(task())).toBe(false);
        });
    });

    describe("today lens (graceful-skip until dueDate ships)", () => {
        it("treats tasks without dueDate as matching (no-op)", () => {
            const predicate = buildLensPredicate({
                lens: "today",
                currentUserId: "u-self"
            });
            expect(predicate(task())).toBe(true);
        });

        it("matches a task whose dueDate is today", () => {
            const now = new Date("2026-05-23T12:00:00Z");
            const predicate = buildLensPredicate({
                lens: "today",
                currentUserId: "u-self",
                now
            });
            // Build a dueDate within "today" in the same TZ as `now`.
            const today = new Date(now);
            today.setHours(15, 0, 0, 0);
            expect(
                predicate(task({ dueDate: today.toISOString() } as never))
            ).toBe(true);
        });

        it("rejects a task whose dueDate is tomorrow", () => {
            const now = new Date("2026-05-23T12:00:00Z");
            const predicate = buildLensPredicate({
                lens: "today",
                currentUserId: "u-self",
                now
            });
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(15, 0, 0, 0);
            expect(
                predicate(task({ dueDate: tomorrow.toISOString() } as never))
            ).toBe(false);
        });
    });

    describe("this-week lens (graceful-skip until dueDate ships)", () => {
        it("treats tasks without dueDate as matching", () => {
            const predicate = buildLensPredicate({
                lens: "this-week",
                currentUserId: "u-self"
            });
            expect(predicate(task())).toBe(true);
        });

        it("matches a task whose dueDate is in the same ISO week", () => {
            // Saturday 2026-05-23 — within ISO week Mon 5/18 → Sun 5/24.
            const now = new Date("2026-05-23T12:00:00Z");
            const predicate = buildLensPredicate({
                lens: "this-week",
                currentUserId: "u-self",
                now
            });
            const monday = new Date(now);
            monday.setDate(monday.getDate() - 5); // 2026-05-18
            monday.setHours(15, 0, 0, 0);
            expect(
                predicate(task({ dueDate: monday.toISOString() } as never))
            ).toBe(true);
        });

        it("rejects a task whose dueDate is next week", () => {
            const now = new Date("2026-05-23T12:00:00Z");
            const predicate = buildLensPredicate({
                lens: "this-week",
                currentUserId: "u-self",
                now
            });
            const nextWeek = new Date(now);
            nextWeek.setDate(nextWeek.getDate() + 7);
            nextWeek.setHours(15, 0, 0, 0);
            expect(
                predicate(task({ dueDate: nextWeek.toISOString() } as never))
            ).toBe(false);
        });
    });

    describe("at-risk lens (graceful-skip until risk field ships)", () => {
        it("treats tasks without aiRisk as matching", () => {
            const predicate = buildLensPredicate({
                lens: "at-risk",
                currentUserId: "u-self"
            });
            expect(predicate(task())).toBe(true);
        });

        it("matches a task flagged aiRisk=high", () => {
            const predicate = buildLensPredicate({
                lens: "at-risk",
                currentUserId: "u-self"
            });
            expect(
                predicate({
                    ...task(),
                    aiRisk: "high"
                } as never)
            ).toBe(true);
        });

        it("rejects a task flagged aiRisk=low", () => {
            const predicate = buildLensPredicate({
                lens: "at-risk",
                currentUserId: "u-self"
            });
            expect(
                predicate({
                    ...task(),
                    aiRisk: "low"
                } as never)
            ).toBe(false);
        });
    });
});
