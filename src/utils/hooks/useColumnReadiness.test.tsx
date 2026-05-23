import { renderHook } from "@testing-library/react";

import useColumnReadiness from "./useColumnReadiness";

const baseTask = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "col-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "Acceptance criteria: the button works.",
    projectId: "project-1",
    storyPoints: 1,
    taskName: "Implement the login screen",
    type: "Task",
    ...overrides
});

/**
 * The deterministic engine flags a task as "not ready" (warn/error) when
 * it is missing a coordinator, a type, or a usable name. We mint these
 * partial tasks via small overrides so each test stays focused on the
 * one signal it cares about.
 */
const readyTask = (id: string): ITask =>
    baseTask({ _id: id, taskName: `Ready ${id}` });

const blockedTask = (id: string): ITask =>
    baseTask({
        _id: id,
        taskName: `Blocked ${id}`,
        coordinatorId: "" // engine emits warn → counts as blocker.
    });

describe("useColumnReadiness", () => {
    it("returns a neutral report with zero counts when there are no tasks", () => {
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks: [], columnId: "col-1", enabled: true })
        );
        expect(result.current).toEqual({
            readyCount: 0,
            totalCount: 0,
            blockerTasks: [],
            status: "neutral"
        });
    });

    it("returns neutral without invoking the engine when disabled", () => {
        // Even with a fully-broken column we should get a neutral report
        // because `enabled: false` is the caller's gate (env flag, etc.).
        const tasks = [blockedTask("a"), blockedTask("b"), blockedTask("c")];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: false })
        );
        expect(result.current.status).toBe("neutral");
        expect(result.current.totalCount).toBe(0);
        expect(result.current.readyCount).toBe(0);
    });

    it("reports `ready` when ≥80% of tasks pass readiness AND totalCount ≥ 3", () => {
        // 4/5 ready = 80% → ready.
        const tasks = [
            readyTask("r1"),
            readyTask("r2"),
            readyTask("r3"),
            readyTask("r4"),
            blockedTask("b1")
        ];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        expect(result.current.status).toBe("ready");
        expect(result.current.readyCount).toBe(4);
        expect(result.current.totalCount).toBe(5);
        expect(result.current.blockerTasks).toHaveLength(1);
        expect(result.current.blockerTasks[0].task._id).toBe("b1");
        expect(result.current.blockerTasks[0].reasons.length).toBeGreaterThan(
            0
        );
    });

    it("reports `needs-grooming` when <60% pass AND totalCount ≥ 3", () => {
        // 1/3 ready = ~33% → needs-grooming.
        const tasks = [readyTask("r1"), blockedTask("b1"), blockedTask("b2")];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        expect(result.current.status).toBe("needs-grooming");
        expect(result.current.readyCount).toBe(1);
        expect(result.current.totalCount).toBe(3);
        expect(result.current.blockerTasks).toHaveLength(2);
    });

    it("returns `neutral` for the 60–80% mid-band so the pill stays out of the way", () => {
        // 2/3 ready = 66.6% → neutral (≥60% so NOT needs-grooming, <80% so
        // NOT ready).
        const tasks = [readyTask("r1"), readyTask("r2"), blockedTask("b1")];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        expect(result.current.status).toBe("neutral");
        expect(result.current.readyCount).toBe(2);
        expect(result.current.totalCount).toBe(3);
    });

    it("returns `neutral` when totalCount is below the 3-task floor even if every task is ready", () => {
        // 2/2 = 100% but totalCount < 3 → neutral by spec ("ratio is too
        // unstable below 3 tasks").
        const tasks = [readyTask("r1"), readyTask("r2")];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        expect(result.current.status).toBe("neutral");
        expect(result.current.readyCount).toBe(2);
        expect(result.current.totalCount).toBe(2);
    });

    it("returns `neutral` when totalCount is below the 3-task floor even if every task is blocked", () => {
        const tasks = [blockedTask("b1"), blockedTask("b2")];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        expect(result.current.status).toBe("neutral");
        expect(result.current.readyCount).toBe(0);
        expect(result.current.totalCount).toBe(2);
    });

    it("preserves the memoized result when the same task list is passed by a fresh array reference", () => {
        // react-query swaps the tasks array on refetch even when nothing
        // material changed; the hook must memo on a fingerprint, not on
        // identity, so the same downstream popover doesn't re-render.
        const tasks = [readyTask("r1"), readyTask("r2"), readyTask("r3")];
        const { result, rerender } = renderHook(
            (input: { tasks: ITask[] }) =>
                useColumnReadiness({
                    tasks: input.tasks,
                    columnId: "col-1",
                    enabled: true
                }),
            { initialProps: { tasks } }
        );
        const first = result.current;
        rerender({ tasks: tasks.map((t) => ({ ...t })) });
        expect(result.current).toBe(first);
    });

    it("includes the readiness `message` field as the blocker reason copy", () => {
        const tasks = [
            readyTask("r1"),
            readyTask("r2"),
            blockedTask("b1"),
            blockedTask("b2")
        ];
        const { result } = renderHook(() =>
            useColumnReadiness({ tasks, columnId: "col-1", enabled: true })
        );
        const reasons = result.current.blockerTasks[0].reasons;
        // The deterministic engine reports the "No coordinator assigned."
        // message verbatim — surface copy depends on this being the
        // engine's `message` field.
        expect(reasons.some((r) => /coordinator/i.test(r))).toBe(true);
    });
});
