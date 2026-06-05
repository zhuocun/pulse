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

        it("is a no-op when the current user is unresolved (R2-M2)", () => {
            const predicate = buildLensPredicate({
                lens: "mine",
                currentUserId: undefined
            });
            // Auth-refresh / login propagation can leave `currentUserId`
            // briefly undefined. The lens behaves as a no-op there
            // rather than emptying the board — the user identity is
            // authoritative when present, not when missing.
            expect(predicate(task())).toBe(true);
            expect(predicate(task({ coordinatorId: "u-other" }))).toBe(true);
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

        /*
         * R2-M1 regression: comparing UTC timestamps to a local-midnight
         * window excluded tasks whose ISO `dueDate` crossed UTC midnight
         * but were still "today" on the user's wall clock. The predicate
         * now compares the local-calendar `YYYY-MM-DD` strings on both
         * sides, so a task that the calendar shows as "today" in any
         * timezone is matched regardless of the dueDate's hour.
         */
        it("matches tasks whose dueDate is the SAME local calendar date even when the ISO timestamp straddles UTC midnight", () => {
            // Pick a local time that's safely "today" for any TZ jsdom
            // happens to use. The two dueDates below describe the same
            // local calendar date (split across UTC midnight in some
            // timezones), so both must match.
            const now = new Date("2026-05-23T18:00:00");
            const predicate = buildLensPredicate({
                lens: "today",
                currentUserId: "u-self",
                now
            });

            // A dueDate stamped late in the day: same local calendar
            // date as `now`. Must match.
            const sameDayLate = new Date(now);
            sameDayLate.setHours(23, 30, 0, 0);
            expect(
                predicate(task({ dueDate: sameDayLate.toISOString() } as never))
            ).toBe(true);

            // A dueDate stamped right after local midnight: same local
            // calendar date as `now`. Must match.
            const sameDayEarly = new Date(now);
            sameDayEarly.setHours(0, 1, 0, 0);
            expect(
                predicate(
                    task({ dueDate: sameDayEarly.toISOString() } as never)
                )
            ).toBe(true);
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

    describe("priority-high lens (functional — priority enum shipped)", () => {
        it("matches tasks at high OR urgent priority", () => {
            const predicate = buildLensPredicate({
                lens: "priority-high",
                currentUserId: "u-self"
            });
            expect(predicate(task({ priority: "high" }))).toBe(true);
            expect(predicate(task({ priority: "urgent" }))).toBe(true);
        });

        it("rejects tasks below high priority (and unset/none)", () => {
            const predicate = buildLensPredicate({
                lens: "priority-high",
                currentUserId: "u-self"
            });
            expect(predicate(task({ priority: "medium" }))).toBe(false);
            expect(predicate(task({ priority: "low" }))).toBe(false);
            expect(predicate(task({ priority: "none" }))).toBe(false);
            // Exclusionary (unlike the date lenses): an unprioritised task
            // is hidden, not passed through.
            expect(predicate(task())).toBe(false);
        });
    });

    describe("priority-urgent lens (functional)", () => {
        it("matches only urgent tasks", () => {
            const predicate = buildLensPredicate({
                lens: "priority-urgent",
                currentUserId: "u-self"
            });
            expect(predicate(task({ priority: "urgent" }))).toBe(true);
            expect(predicate(task({ priority: "high" }))).toBe(false);
            expect(predicate(task())).toBe(false);
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

        it("matches a task flagged aiRisk=medium (R2-L2)", () => {
            // "At risk" reads to most teams as "any AI flag worth a
            // second look," not just the most-critical bucket. Medium-
            // risk tasks surface alongside high so the triage view is
            // useful, not a one-bucket sliver.
            const predicate = buildLensPredicate({
                lens: "at-risk",
                currentUserId: "u-self"
            });
            expect(
                predicate({
                    ...task(),
                    aiRisk: "medium"
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
