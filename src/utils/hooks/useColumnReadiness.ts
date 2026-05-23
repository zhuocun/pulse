/**
 * Column-readiness batch hook (Phase 4 Wave 3 — Ambition 5).
 *
 * Runs the deterministic readiness engine
 * (`utils/ai/engine.ts → readiness`) over every task in a column and
 * derives a single "status" the column header can surface as a passive
 * pill. The engine is the same one `useAi<IReadinessReport>` reaches in
 * local-engine mode, so we skip the hook altogether and call it
 * synchronously: the function is pure, has no I/O, and a 30-task column
 * resolves in well under a millisecond on commodity hardware.
 *
 * Why a custom hook instead of N `useAi` mounts (each task)? `useAi`
 * carries an `AbortController` + a `useEffect` mount cycle per call. For
 * 30 task cards that is 30 controllers and 30 effect tear-downs every
 * time the column re-renders — pure overhead for a synchronous engine.
 * Calling `readiness()` directly under a `useMemo` keeps the work
 * deterministic, lets React drop the result the moment `tasks` mutates,
 * and matches the spec's "cap the batch at column-open time, not on
 * every task edit" requirement: a `tasks` reference change is the
 * column-level "open" event in this codebase (each task edit produces a
 * fresh task array via react-query's optimistic update).
 *
 * Threshold copy lives in microcopy, not here, so the locale files are
 * the single source of truth for the surface; the hook only returns the
 * three machine-readable status states.
 */

import { useMemo } from "react";

import { readiness } from "../ai/engine";

/**
 * A task that did NOT pass the readiness check, paired with the
 * human-readable reasons the engine emitted for it. Reasons are the
 * raw `message` field from `IReadinessIssue` — they are already
 * presentation-ready ("No coordinator assigned.", etc.) so the popover
 * can render them verbatim.
 */
export interface ColumnReadinessBlocker {
    task: ITask;
    reasons: string[];
}

export type ColumnReadinessStatus = "ready" | "needs-grooming" | "neutral";

export interface ColumnReadinessReport {
    readyCount: number;
    totalCount: number;
    blockerTasks: ColumnReadinessBlocker[];
    status: ColumnReadinessStatus;
}

/**
 * Minimum tasks required before we surface either status. With 1–2
 * tasks a single missing field flips the ratio violently (a 1/2 column
 * is 50 % → "needs grooming" the moment one task is empty) — that's
 * noisy, not useful. The spec calls out a 3-task floor; we honour it
 * for both directions.
 */
export const COLUMN_READINESS_MIN_TASKS = 3;
export const COLUMN_READINESS_READY_RATIO = 0.8;
export const COLUMN_READINESS_GROOMING_RATIO = 0.6;

/**
 * A task is "ready" when the engine emits NO blocker-class issues. The
 * engine tags issues as `info` / `warn` / `error`; we count anything
 * stronger than `info` as a blocker. The rationale: `info` covers soft
 * recommendations like "no explicit acceptance criteria" — those don't
 * stop a task from being worked on, they just suggest polish. `warn`
 * and `error` cover real gaps (no name, no type, no coordinator) that
 * make the task actually un-actionable.
 */
const isBlockerIssue = (issue: IReadinessIssue): boolean =>
    issue.severity === "warn" || issue.severity === "error";

interface UseColumnReadinessOptions {
    tasks: ITask[];
    columnId: string;
    /**
     * Caller-controlled gate. When `false` the hook returns a neutral
     * zero-count report without invoking the engine — lets the column
     * header skip the batch when the env flag is off without forcing
     * the caller to short-circuit the JSX.
     */
    enabled: boolean;
}

/**
 * Build a stable fingerprint for the memo dep. We can't memo on the
 * `tasks` reference alone because react-query swaps that array on
 * every refetch even when nothing material changed. The fingerprint
 * folds in only the fields the readiness engine actually reads, so
 * unrelated mutations (an `index` shift from a drag) do not re-run.
 */
const fingerprintTasks = (tasks: ITask[]): string =>
    tasks
        .map(
            (task) =>
                `${task._id}|${task.taskName}|${task.note ?? ""}|${task.epic ?? ""}|${task.type ?? ""}|${task.coordinatorId ?? ""}`
        )
        .join("\n");

const deriveStatus = (
    readyCount: number,
    totalCount: number
): ColumnReadinessStatus => {
    if (totalCount < COLUMN_READINESS_MIN_TASKS) return "neutral";
    const ratio = readyCount / totalCount;
    if (ratio >= COLUMN_READINESS_READY_RATIO) return "ready";
    if (ratio < COLUMN_READINESS_GROOMING_RATIO) return "needs-grooming";
    return "neutral";
};

const useColumnReadiness = (
    options: UseColumnReadinessOptions
): ColumnReadinessReport => {
    const { tasks, columnId, enabled } = options;
    const fingerprint = enabled ? fingerprintTasks(tasks) : "";
    return useMemo<ColumnReadinessReport>(() => {
        if (!enabled || tasks.length === 0) {
            return {
                readyCount: 0,
                totalCount: 0,
                blockerTasks: [],
                status: "neutral"
            };
        }
        let readyCount = 0;
        const blockerTasks: ColumnReadinessBlocker[] = [];
        for (const task of tasks) {
            const report = readiness({
                taskName: task.taskName,
                note: task.note,
                epic: task.epic,
                type: task.type,
                coordinatorId: task.coordinatorId
            });
            const blockers = report.issues.filter(isBlockerIssue);
            if (blockers.length === 0) {
                readyCount += 1;
            } else {
                blockerTasks.push({
                    task,
                    reasons: blockers.map((issue) => issue.message)
                });
            }
        }
        return {
            readyCount,
            totalCount: tasks.length,
            blockerTasks,
            status: deriveStatus(readyCount, tasks.length)
        };
        /*
         * Memo deps: the `fingerprint` collapses the materially-readiness-
         * relevant fields of every task, `columnId` keeps the memo bucketed
         * when two columns share a tasks-array reference shape across
         * mounts, and `enabled` short-circuits without churning the memo
         * key. We intentionally omit `tasks` itself: a fresh array
         * reference with identical contents (the react-query refetch case)
         * must not re-run the engine — that's exactly the fingerprint's
         * job. The lint rule for exhaustive-deps is not configured in this
         * repo so no escape hatch is needed.
         */
    }, [fingerprint, columnId, enabled]);
};

export default useColumnReadiness;
