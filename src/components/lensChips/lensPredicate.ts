import type { LensId } from "./index";

/**
 * Lens predicate factory.
 *
 * Returns a `(task) => boolean` filter for the active lens, or `() => true`
 * (no-op) when no lens is active or the lens depends on an `ITask` field
 * that hasn't shipped yet (AI risk score).
 *
 * Predicate semantics:
 *   - `mine`       — task.coordinatorId === currentUserId (functional;
 *                    no-op when current user is unresolved)
 *   - `today`      — task.dueDate falls on the local-calendar "today",
 *                    compared as a `YYYY-MM-DD` string in the runtime
 *                    timezone (functional — M2 `dueDate` shipped)
 *   - `this-week`  — task.dueDate within current ISO week, Mon-Sun
 *                    (functional)
 *   - `priority-high`   — task.priority in {"high", "urgent"} (functional —
 *                    the `priority` enum shipped; exclusionary, like `mine`)
 *   - `priority-urgent` — task.priority === "urgent" (functional)
 *   - `at-risk`    — task.aiRisk in {"high", "medium"} (graceful skip
 *                    until the AI risk score ships)
 *
 * A task with no `dueDate` is treated as matching the date lenses (a
 * date filter can't exclude a task that carries no date), so those
 * lenses narrow the board to dated-and-in-range tasks plus the undated
 * backlog rather than hiding undated work outright. The remaining
 * "graceful skip" lens (`at-risk`) still appears in the chip row so the
 * spec surfaces; selecting it returns every task and the chip carries a
 * "soon" badge so the user is not misled into thinking the lens is broken.
 */

type LensTask = Pick<ITask, "coordinatorId" | "priority"> & {
    /** M2 — date-only ISO string on `ITask`; widened here so the predicate
     * also accepts the timestamp / Date shapes that historical fixtures and
     * callers may pass. */
    dueDate?: string | number | Date | null;
    /** Not on `ITask` yet — AI risk classification. */
    aiRisk?: "low" | "medium" | "high" | null;
};

/**
 * Returns the "today" anchor in the runtime timezone. We return the
 * local-calendar `YYYY-MM-DD` string rather than a millisecond timestamp
 * so the comparison is timezone-agnostic for any input shape.
 *
 * Why a date-only string instead of a timestamp window:
 *   A task with `dueDate: "2026-05-24T00:01:00Z"` viewed by a Pacific
 *   user at 17:01 local on May 23 used to be excluded (the UTC timestamp
 *   fell into "tomorrow" in the local-midnight window) even though it's
 *   still May 23 on the user's wall clock. Comparing date-only strings
 *   keeps the answer aligned with what the user sees on the calendar.
 */
const localDateString = (input: Date): string => {
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, "0");
    const day = String(input.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * Returns the [start, end) range for the ISO week (Mon 00:00 → next Mon
 * 00:00) that contains `now`. ISO weeks start on Monday — JavaScript's
 * `getDay()` returns Sunday = 0, so we map Sunday → 7 to land on the
 * correct Monday.
 */
const isoWeekRange = (now: Date): { start: number; end: number } => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() === 0 ? 7 : d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day - 1));
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return { start: monday.getTime(), end: nextMonday.getTime() };
};

export interface LensPredicateContext {
    lens: LensId | null;
    currentUserId: string | undefined;
    now?: Date;
}

export const buildLensPredicate = ({
    lens,
    currentUserId,
    now = new Date()
}: LensPredicateContext): ((task: LensTask) => boolean) => {
    if (!lens) return () => true;

    if (lens === "mine") {
        // Without a signed-in user the lens is a no-op (`() => true`)
        // rather than a hard "show nothing". Auth-refresh / login
        // propagation can leave `currentUserId` briefly undefined, and
        // returning `false` there flickered the entire board to empty
        // (R2-M2). The user data is authoritative when present; until
        // then, leave the visible task set alone.
        if (!currentUserId) return () => true;
        return (task) => task.coordinatorId === currentUserId;
    }

    if (lens === "today") {
        const today = localDateString(now);
        return (task) => {
            // Undated tasks can't be excluded by a date filter — pass them.
            if (!task.dueDate) return true;
            const parsed = new Date(task.dueDate);
            if (Number.isNaN(parsed.getTime())) return true;
            return localDateString(parsed) === today;
        };
    }

    if (lens === "this-week") {
        const { start, end } = isoWeekRange(now);
        return (task) => {
            if (!task.dueDate) return true;
            const ts = new Date(task.dueDate).getTime();
            if (Number.isNaN(ts)) return true;
            return ts >= start && ts < end;
        };
    }

    if (lens === "priority-high") {
        // "High priority" reads as "anything worth bumping up the queue",
        // so it surfaces both `high` AND `urgent` — the same widen-not-
        // narrow choice the `at-risk` lens makes. Unlike the date lenses,
        // a priority filter is exclusionary (it answers "show me the
        // high-priority work"), so non-matching tasks are hidden rather
        // than passed through.
        return (task) => task.priority === "high" || task.priority === "urgent";
    }

    if (lens === "priority-urgent") {
        // The narrowest triage view: only the tasks explicitly flagged
        // `urgent`.
        return (task) => task.priority === "urgent";
    }

    if (lens === "at-risk") {
        // Both "high" and "medium" surface — the chip reads "At risk",
        // which most teams interpret as "any AI flag worth a second
        // look", not just the most-critical bucket. Narrowing to "high"
        // (R2-L2) hid the "yellow" tasks teams typically want to triage
        // alongside the red ones.
        return (task) =>
            task.aiRisk
                ? task.aiRisk === "high" || task.aiRisk === "medium"
                : true;
    }

    return () => true;
};
