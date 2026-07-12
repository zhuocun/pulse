import React, { useMemo } from "react";

import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";

/**
 * Phase 3 A7 — Lenses (chip-based filters).
 *
 * URL-driven, single-select chip row that narrows the visible task universe
 * with a single tap. Mounted on the board above the existing filter rail so
 * the lens layers on top of `taskName / coordinatorId / type / semanticIds`.
 *
 * Chip set:
 *   - Today      ── tasks due today (functional — M2 `dueDate` shipped)
 *   - This week  ── tasks due in the current ISO week (functional)
 *   - Mine       ── tasks assigned to the current user (functional)
 *   - At risk    ── tasks flagged by AI (graceful-skip until risk field)
 *
 * "Graceful-skip" lenses are still selectable, but their predicate is a
 * no-op (`() => true`) so the board renders unchanged. The chip shows a
 * small "AI" / "soon" badge so the user knows the lens is on the way and
 * not silently broken. With M2's `dueDate` field shipped, the Today /
 * This-week lenses are now FUNCTIONAL (their predicates filter against
 * `task.dueDate` in `lensPredicate.ts`); only "At risk" remains
 * coming-soon until the AI risk score lands.
 *
 * Mutually exclusive: only one lens is active at a time. Re-clicking the
 * active lens clears it back to All.
 */

export type LensId =
    | "today"
    | "this-week"
    | "mine"
    | "priority-high"
    | "priority-urgent"
    | "at-risk";

const KNOWN_LENS_IDS: readonly LensId[] = [
    "today",
    "this-week",
    "mine",
    "priority-high",
    "priority-urgent",
    "at-risk"
];

/**
 * Lenses whose data field is not yet on `ITask`. Selecting one is a no-op
 * predicate, but the chip surfaces a "soon" hint so the user knows the
 * lens exists in spec form.
 *
 * M2 update: `dueDate` shipped, so "Today" and "This week" graduated to
 * functional lenses (their predicates filter against `task.dueDate`).
 * Only "At risk" remains here, gated on the AI risk score that hasn't
 * landed yet.
 */
const COMING_SOON_LENSES: ReadonlySet<LensId> = new Set(["at-risk"]);

/**
 * Coerce a raw URL value into a `LensId`, or `null` if the string isn't
 * a known lens.
 *
 * Note on first-occurrence semantics: callers pass `param.lens` from
 * `useUrl`, which exposes `URLSearchParams#get` — that returns only the
 * FIRST value for a key, so `?lens=today&lens=mine` resolves to `today`.
 * That matches the URL-as-state contract the lens chip row builds on
 * (only one lens active at a time) and is documented here so consumers
 * don't expect a list. If we ever ship multi-lens, this function and
 * the URL writer both have to be revisited.
 */
export const parseLensId = (value: string | null | undefined): LensId | null =>
    value && (KNOWN_LENS_IDS as readonly string[]).includes(value)
        ? (value as LensId)
        : null;

const CHIP_BASE_CLASS = cn(
    "inline-flex min-h-[32px] items-center gap-xxs rounded-full border px-sm py-xxs text-sm font-medium",
    "transition-colors motion-reduce:transition-none",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    "coarse:min-h-[44px] coarse:px-md"
);

const chipClass = (active: boolean, disabled: boolean): string =>
    cn(
        CHIP_BASE_CLASS,
        active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background text-foreground",
        disabled
            ? "cursor-not-allowed opacity-55"
            : cn(
                  "cursor-pointer",
                  active ? "hover:bg-primary/90" : "hover:bg-muted"
              )
    );

const comingSoonBadgeClass = (active: boolean): string =>
    cn(
        "rounded-full px-xs py-[2px] text-xs font-semibold leading-none",
        active ? "bg-white/[0.22]" : "bg-muted"
    );

interface LensChipsProps {
    /** Current lens from the URL (or `null` for All). */
    active: LensId | null;
    /**
     * Called with the next active lens. Pass `null` to clear (the
     * implicit "All" state — no chip active).
     */
    onChange: (next: LensId | null) => void;
}

const LensChips: React.FC<LensChipsProps> = ({ active, onChange }) => {
    const chips = useMemo(
        () =>
            [
                {
                    id: "today" as const,
                    label: microcopy.lenses.today,
                    tooltip: microcopy.lenses.todayTooltip
                },
                {
                    id: "this-week" as const,
                    label: microcopy.lenses.thisWeek,
                    tooltip: microcopy.lenses.thisWeekTooltip
                },
                {
                    id: "mine" as const,
                    label: microcopy.lenses.mine,
                    tooltip: microcopy.lenses.mineTooltip
                },
                {
                    id: "priority-high" as const,
                    label: microcopy.lenses.highPriority,
                    tooltip: microcopy.lenses.highPriorityTooltip
                },
                {
                    id: "priority-urgent" as const,
                    label: microcopy.lenses.urgent,
                    tooltip: microcopy.lenses.urgentTooltip
                },
                {
                    id: "at-risk" as const,
                    label: microcopy.lenses.atRisk,
                    tooltip: microcopy.lenses.atRiskTooltip
                }
            ].filter((chip) => !COMING_SOON_LENSES.has(chip.id)),
        []
    );

    return (
        <div
            aria-label={microcopy.a11y.lensChips}
            className="mb-sm flex flex-wrap gap-xs"
            role="group"
        >
            {chips.map((chip) => {
                const isComingSoon = COMING_SOON_LENSES.has(chip.id);
                const isActive = !isComingSoon && active === chip.id;
                return (
                    <button
                        className={chipClass(isActive, isComingSoon)}
                        /*
                         * Coming-soon lenses have no working predicate, so
                         * they read as disabled (no toggle, no pressed
                         * state) until their data field ships — tapping
                         * one must not silently filter nothing.
                         */
                        aria-disabled={isComingSoon || undefined}
                        aria-pressed={isComingSoon ? undefined : isActive}
                        key={chip.id}
                        onClick={
                            isComingSoon
                                ? undefined
                                : () => onChange(isActive ? null : chip.id)
                        }
                        title={chip.tooltip}
                        type="button"
                    >
                        <span>{chip.label}</span>
                        {isComingSoon ? (
                            <span
                                aria-label={microcopy.a11y.lensComingSoon}
                                className={comingSoonBadgeClass(isActive)}
                            >
                                {microcopy.lenses.comingSoonBadge}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
};

export default LensChips;
