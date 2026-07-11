import React from "react";

import { cn } from "@/lib/utils";

import { shadow } from "../../theme/tokens";
import { flattenSlots } from "../../utils/flattenSlots";
import { TOUCH_TARGET } from "@/components/ui/touchTarget";

/**
 * GlassActionCluster — iOS 26 "Liquid Glass" toolbar idiom.
 *
 * Groups a handful of related toolbar actions into a single floating
 * Liquid Glass capsule with hairline separators between adjacent
 * controls — the iOS 26 segmented-toolbar look where the hierarchy
 * comes from the shared pill, not from per-button chrome.
 *
 * Each child is dropped into its own slot so the separators ride the
 * slot edges (inset vertically, never at the outer rim) WITHOUT merging
 * the children into one element — every passed-in control (DropdownMenu
 * trigger, Popover trigger, Badge-wrapped Button, …) stays individually
 * focusable with its own aria-label. The shared glass background is
 * purely visual.
 *
 * The per-button chrome (fills, borders, shadows) is stripped inside the
 * capsule so the controls read as concentric, background-free segments of
 * the pill rather than nested boxes-in-a-box.
 *
 * Material: Liquid Glass "regular" — the same recipe the BottomTabBar
 * capsule and the chrome header ship. It stamps `data-glass-context` so
 * any overlay opened from a child degrades to opaque — Apple's "never
 * glass on glass" rule.
 *
 * Fallbacks mirror GlassPanel / BottomTabBar: `prefers-reduced-
 * transparency` collapses to the opaque page background and drops the
 * blur + float; `forced-colors` swaps to system tokens.
 */

export interface GlassActionClusterProps extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "color"
> {
    /**
     * When true the press micro-interaction is transform-free (highlight
     * only). Callers thread `useReducedMotion()` so the static reduced-
     * motion path doesn't depend on a media query the test env can't
     * always evaluate.
     */
    reducedMotion?: boolean;
    children?: React.ReactNode;
    className?: string;
}

/**
 * Wraps each child in a slot element so the hairline separator (a slot
 * `::after`) sits between adjacent controls without merging the children
 * into a single accessibility element. Children pass through untouched —
 * their own roles / aria-labels / data-testids are preserved.
 */
const GlassActionCluster = React.forwardRef<
    HTMLDivElement,
    GlassActionClusterProps
>(({ reducedMotion = false, children, className, ...rest }, ref) => {
    const slots = flattenSlots(children);

    return (
        <div
            className={cn(
                "inline-flex items-center rounded-pill border px-xxs py-xxs",
                "[background:var(--glass-surface)] [border-color:var(--glass-border)]",
                "[backdrop-filter:var(--ant-backdrop-filter-glass)]",
                "[-webkit-backdrop-filter:var(--ant-backdrop-filter-glass)]",
                "shadow-[var(--gac-shadow)]",
                TOUCH_TARGET,
                // Strip per-button chrome so controls read as concentric,
                // background-free segments of the shared pill.
                "[&_button]:rounded-[995px] [&_button]:border-transparent",
                "[&_button]:bg-transparent [&_button]:shadow-none",
                "[&_button:active]:bg-foreground/[0.08]",
                "[&_button]:transition-[background-color,transform] [&_button]:duration-short",
                reducedMotion
                    ? "[&_button]:ease-standard"
                    : "[&_button:active]:scale-[0.96] [&_button]:ease-springSnap",
                "motion-reduce:[&_button:active]:scale-100",
                "coarse:[&_button]:min-h-[44px] coarse:[&_button]:min-w-[44px]",
                // reduced-transparency / forced-colors fallbacks
                "[@media(prefers-reduced-transparency:reduce)]:[background:var(--page-background)]",
                "[@media(prefers-reduced-transparency:reduce)]:shadow-none",
                "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]",
                "[@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none]",
                "forced-colors:[background:Canvas] forced-colors:[border-color:CanvasText]",
                "forced-colors:shadow-none forced-colors:[backdrop-filter:none]",
                "forced-colors:[-webkit-backdrop-filter:none]",
                className
            )}
            data-glass-context="true"
            ref={ref}
            style={
                {
                    "--gac-shadow": `var(--ant-shadow-glass-lifted, ${shadow.lift})`
                } as React.CSSProperties
            }
            {...rest}
        >
            {slots.map((child, index) => (
                // Slot wrappers are positional decoration around a stable,
                // ordered child set; the index is the correct identity.
                <div
                    className={cn(
                        "pulse-cluster-slot relative inline-flex items-center",
                        "me-xxs pe-xxs last:me-0 last:pe-0",
                        "coarse:min-h-[44px] coarse:min-w-[44px] coarse:justify-center",
                        // Hairline separator on the trailing edge of every
                        // slot except the last, inset vertically so it reads
                        // as a short divider rather than a full-height rule.
                        "after:pointer-events-none after:absolute after:inset-y-xs after:end-0",
                        "after:w-px after:bg-foreground/[0.15] after:content-['']",
                        "last:after:hidden",
                        "forced-colors:after:bg-[CanvasText] forced-colors:after:opacity-100"
                    )}
                    key={index}
                >
                    {child}
                </div>
            ))}
        </div>
    );
});

GlassActionCluster.displayName = "GlassActionCluster";

export default GlassActionCluster;
