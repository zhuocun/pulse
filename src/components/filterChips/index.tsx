import { X } from "lucide-react";
import React from "react";

import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { TOUCH_TARGET } from "../ui/touchTarget";

export interface FilterChip {
    /** Stable key (e.g. "manager", "type"). Drives the dismiss handler. */
    key: string;
    /** Short label for the dimension (e.g. "Manager"). */
    label: string;
    /** Concrete value (e.g. "Alice", "Task"). */
    value: string;
}

interface FilterChipsProps {
    chips: FilterChip[];
    onDismiss: (key: string) => void;
    /** Optional "Clear all" CTA shown when 2+ chips are active. */
    onClearAll?: () => void;
    clearAllLabel?: string;
}

/**
 * Renders the active filters as dismissible chips. Pairs with a search /
 * filter panel so users can see at a glance what is filtered, drop a single
 * dimension without recreating the whole filter, and reset everything in
 * one click. Replaces the previous "count-only" pill which left users
 * guessing which filters were active.
 */
const FilterChips: React.FC<FilterChipsProps> = ({
    chips,
    onDismiss,
    onClearAll,
    clearAllLabel = microcopy.actions.clear
}) => {
    if (chips.length === 0) return null;
    return (
        <div
            role="region"
            aria-label={microcopy.a11y.activeFilters}
            className="flex flex-wrap items-center gap-xs pt-xs"
        >
            {chips.map((chip) => (
                <span
                    key={chip.key}
                    className="inline-flex max-w-full items-center gap-xxs rounded-full border border-primary/20 bg-primary/10 py-[2px] pl-sm pr-xs text-xs font-medium text-primary"
                >
                    <span className="opacity-65">{chip.label}:</span>
                    <span className="max-w-[14ch] overflow-hidden text-ellipsis whitespace-nowrap">
                        {chip.value}
                    </span>
                    <button
                        aria-label={microcopy.a11y.removeFilter.replace(
                            "{label}",
                            chip.label
                        )}
                        onClick={() => onDismiss(chip.key)}
                        type="button"
                        className={cn(
                            "ms-xxs inline-flex size-[18px] items-center justify-center rounded-full p-0 text-current opacity-70 transition-colors",
                            "hover:bg-primary/20 hover:opacity-100 focus-visible:bg-primary/20 focus-visible:opacity-100 focus-visible:outline-none",
                            "coarse:size-11",
                            TOUCH_TARGET
                        )}
                    >
                        <X aria-hidden className="size-[9px]" />
                    </button>
                </span>
            ))}
            {onClearAll && chips.length >= 2 ? (
                <button
                    onClick={onClearAll}
                    type="button"
                    className={cn(
                        "px-xs py-[2px] text-xs font-medium text-muted-foreground underline decoration-transparent underline-offset-2 transition-colors",
                        "hover:text-foreground hover:decoration-current focus-visible:text-foreground focus-visible:decoration-current focus-visible:outline-none",
                        TOUCH_TARGET
                    )}
                >
                    {clearAllLabel}
                </button>
            ) : null}
        </div>
    );
};

export default FilterChips;
