import styled from "@emotion/styled";
import React from "react";

import {
    easing,
    motion,
    radius,
    radiusConcentric,
    shadow,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import { flattenSlots } from "../../utils/flattenSlots";

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
 * the children into one element — every passed-in control (Dropdown
 * trigger, Popover trigger, Badge-wrapped Button, …) stays individually
 * focusable with its own aria-label. The shared glass background is
 * purely visual.
 *
 * The per-button AntD chrome (`type="default"` / `type="text"` fills,
 * borders, shadows) is stripped inside the capsule so the controls read
 * as concentric, background-free segments of the pill rather than nested
 * boxes-in-a-box. Callers should still pass `type="text"` triggers where
 * they can; this strip is the belt-and-braces backstop.
 *
 * Material: Liquid Glass "regular" — the same recipe the BottomTabBar
 * capsule and the chrome header ship (`--glass-surface` fill,
 * `--ant-backdrop-filter-glass` blur, `--glass-border` hairline,
 * `--ant-shadow-glass-lifted` float). It stamps `data-glass-context`
 * so any AntD overlay opened from a child (the Dropdown menu, the
 * Settings Popover) degrades to opaque — Apple's "never glass on glass"
 * rule.
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

/*
 * Inner block padding the capsule shape uses. Drives the concentric
 * radius math (`radiusConcentric(outer = pill, padding)`) for the inner
 * slots the same way the BottomTabBar threads its INNER_PADDING.
 */
const INNER_PADDING = space.xxs;

interface ClusterRootProps {
    $reducedMotion: boolean;
}

const ClusterRoot = styled.div<ClusterRootProps>`
    align-items: center;
    display: inline-flex;
    /* Liquid Glass "regular" surface — mirrors the BottomTabBar capsule
     * + chrome header. The user-facing intensity toggle (Clear / Regular
     * / Solid) re-tunes the blur var globally. */
    background: var(--glass-surface);
    backdrop-filter: var(--ant-backdrop-filter-glass);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass);
    border: 1px solid var(--glass-border);
    /* True capsule — half the height. radius.pill (999) caps it. */
    border-radius: ${radius.pill}px;
    /* Floating lift — same recipe as the bottom tab bar capsule. */
    box-shadow: var(--ant-shadow-glass-lifted, ${shadow.lift});
    /* Tap-target floor: icon/short-label buttons need >= 44 px. The
     * inner block padding tops the resting height a touch above this. */
    min-height: ${touchTargetCoarse}px;
    padding: ${INNER_PADDING}px ${space.xxs}px;

    /*
     * Each child is dropped into a slot. The separator is a hairline on
     * the trailing edge of every slot except the last, so it never
     * paints at the outer capsule rim. Inset vertically (~8 px top /
     * bottom) so it reads as a short divider, not a full-height rule.
     */
    > * {
        align-items: center;
        display: inline-flex;
        position: relative;
    }

    > *:not(:last-child) {
        margin-inline-end: ${space.xxs}px;
        padding-inline-end: ${space.xxs}px;
    }

    > *:not(:last-child)::after {
        content: "";
        position: absolute;
        inset-inline-end: 0;
        /* Inset the hairline ~8 px from the capsule's top + bottom so it
         * reads as a short divider rather than a full-height rule. */
        inset-block: ${space.xs}px;
        width: 1px;
        /* ~15% label-color hairline. Falls back to the glass border ink
         * if the text-color var is absent. */
        background: var(--ant-color-text, rgba(15, 23, 42, 0.9));
        opacity: 0.15;
        pointer-events: none;
    }

    /*
     * Strip the per-button AntD chrome inside the capsule so the
     * controls read as concentric, background-free segments. Hierarchy
     * comes from the shared pill grouping, not nested boxes. Inner
     * radius is concentric with the pill (clamps to the pill cap).
     */
    .ant-btn {
        background: transparent;
        border-color: transparent;
        box-shadow: none;
        border-radius: ${radiusConcentric(radius.pill, INNER_PADDING)}px;
        /*
         * Press state — brief highlight + a tight gel-flex scale on
         * press. Spring-snap recovery over motion.short. Reduced-motion
         * keeps the highlight, drops the transform.
         */
        transition:
            background ${motion.short}ms ${easing.standard},
            transform ${motion.short}ms ${easing.springSnap};
    }

    .ant-btn:active {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.08));
        transform: ${(p) => (p.$reducedMotion ? "none" : "scale(0.96)")};
    }

    @media (pointer: coarse) {
        .pulse-cluster-slot,
        .ant-btn {
            min-block-size: ${touchTargetCoarse}px;
            min-inline-size: ${touchTargetCoarse}px;
        }

        .pulse-cluster-slot {
            justify-content: center;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .ant-btn {
            transition: background ${motion.short}ms ${easing.standard};
        }

        .ant-btn:active {
            transform: none;
        }
    }

    /*
     * Honor reduced-transparency: collapse the frosted surface to the
     * solid page background and drop the blur + float. Mirrors the
     * recipe GlassPanel / BottomTabBar / header already ship.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow: none;
    }

    @media (forced-colors: active) {
        background: Canvas;
        border: 1px solid CanvasText;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        box-shadow: none;

        > *:not(:last-child)::after {
            background: CanvasText;
            opacity: 1;
        }
    }
`;

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
        <ClusterRoot
            $reducedMotion={reducedMotion}
            className={className}
            // Degrade nested AntD overlays (Dropdown menu, Popover) to
            // opaque so we never stack frost-on-frost. Apple's explicit
            // "never glass on glass" rule.
            data-glass-context="true"
            ref={ref}
            {...rest}
        >
            {slots.map((child, index) => (
                // Slot wrappers are positional decoration around a stable,
                // ordered child set; the index is the correct identity.
                <div className="pulse-cluster-slot" key={index}>
                    {child}
                </div>
            ))}
        </ClusterRoot>
    );
});

GlassActionCluster.displayName = "GlassActionCluster";

export default GlassActionCluster;
