import type { LensId } from "./index";

/**
 * Lens predicate factory.
 *
 * Returns a `(task) => boolean` filter for the active lens, or `() => true`
 * (no-op) when no lens is active or the lens depends on an `ITask` field
 * that hasn't shipped yet (`dueDate`, AI risk score — Phase 4 roadmap).
 *
 * Predicate semantics:
 *   - `mine`       — task.coordinatorId === currentUserId (functional)
 *   - `today`      — task.dueDate falls on the local "today" (graceful skip)
 *   - `this-week`  — task.dueDate within current ISO week, Mon-Sun (skip)
 *   - `at-risk`    — task.aiRisk === "high" (graceful skip)
 *
 * The "graceful skip" lenses still appear in the chip row so the spec
 * surfaces; selecting them just returns every task. UX-wise the chip
 * carries a "soon" badge so the user is not misled into thinking the
 * lens is broken.
 */

type LensTask = Pick<ITask, "coordinatorId"> & {
    /** Phase 4 — not on `ITask` yet. */
    dueDate?: string | number | Date | null;
    /** Phase 4 — AI risk classification. */
    aiRisk?: "low" | "medium" | "high" | null;
};

/**
 * Returns the start of "today" in the runtime timezone. Hoisted so we
 * read `Date.now()` once per predicate build, not once per task.
 */
const startOfToday = (now: Date): number => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
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
        // Without a signed-in user the lens is a hard "no tasks" — better
        // to surface nothing than to silently match every task.
        if (!currentUserId) return () => false;
        return (task) => task.coordinatorId === currentUserId;
    }

    if (lens === "today") {
        const today = startOfToday(now);
        const tomorrow = today + 24 * 60 * 60 * 1000;
        return (task) => {
            if (!task.dueDate) return true; // Phase 4 — graceful skip.
            const ts = new Date(task.dueDate).getTime();
            if (Number.isNaN(ts)) return true;
            return ts >= today && ts < tomorrow;
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

    if (lens === "at-risk") {
        return (task) => (task.aiRisk ? task.aiRisk === "high" : true);
    }

    return () => true;
};
