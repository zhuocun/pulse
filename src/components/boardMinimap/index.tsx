/**
 * Board minimap — sticky horizontal overview strip
 * (Phase 4.6 of `docs/todo/ui-todo.md`).
 *
 * Renders one proportional segment per column. The segment(s) whose
 * column is currently within the user's horizontal viewport are
 * highlighted with the brand accent fill; the rest stay in the
 * subtle neutral tone. Clicking a segment smooth-scrolls the board's
 * horizontal scroll container so that column comes into view.
 *
 * Design constraints (from the lane spec):
 *   - Returns `null` when `columns.length < minColumnsToShow` (default
 *     5). Boards small enough to fit the viewport in a single glance
 *     get no visual chrome from this surface.
 *   - Reads `scrollContainerRef.current.scrollLeft + clientWidth` and
 *     each column's `offsetLeft + offsetWidth` to compute which
 *     columns intersect the viewport. We use a scroll-position read
 *     (cheap, exact) rather than IntersectionObserver because the
 *     scroll container is the same element for every column and the
 *     intersection geometry is trivial.
 *   - Honours `prefers-reduced-motion`: instant `scrollLeft` jump
 *     instead of `behavior: "smooth"` so users who opt out of motion
 *     don't see the board slide. We read the preference via the
 *     existing `useReducedMotion` hook rather than each handler
 *     checking `matchMedia` so a system-level change re-renders.
 *   - Each segment is a real `<button>` with an aria-label that
 *     announces the column name, task count, and whether the column
 *     is currently in view or off-screen. The container is a
 *     `<nav aria-label="Board minimap">` landmark for fast
 *     keyboard / screen-reader skipping.
 *   - On `pointer: coarse` viewports every segment lifts to a 44 px
 *     minimum touch target (WCAG 2.5.5). The strip's own height is
 *     fine for thumb pinpointing; the lifted hit area extends above
 *     the visual strip via padding so the visual rhythm is preserved.
 *
 * Layout: the strip itself paints a thin, sticky band immediately
 * above the columns container. It does NOT participate in the
 * horizontal scroll — it always shows all columns regardless of
 * scrollLeft.
 */

import styled from "@emotion/styled";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    accent,
    breakpoints,
    fontSize,
    fontWeight,
    radius,
    space
} from "../../theme/tokens";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

/**
 * Lightweight column shape — the minimap only needs the unique id, the
 * label, and the task count it displays for that column. Accepting a
 * generic interface here (rather than `IColumn[]` directly) means the
 * component is decoupled from the global board model and can be reused
 * by the routed task-panel breadcrumbs or any future board projection
 * without dragging the entire `IColumn` shape along.
 */
export interface MinimapColumn {
    /** Stable column id — used as the React key and lookup token. */
    id: string;
    /** Human-readable column name; shown on hover and read by screen readers. */
    name: string;
    /** Visible task count (post any active filter) — surfaces in the aria-label. */
    taskCount: number;
}

interface BoardMinimapProps {
    columns: MinimapColumn[];
    /**
     * Ref to the horizontally scrollable element that contains the
     * columns. Reads `scrollLeft` / `clientWidth` / `scrollWidth` to
     * compute the visible viewport, and writes `scrollLeft` (via
     * `Element.scrollTo`) to bring a column into view.
     */
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    /**
     * Floor on column count — below this, the minimap renders `null`
     * so boards with a handful of columns don't develop redundant
     * chrome. Default 5, picked from the spec; tunable per board.
     */
    minColumnsToShow?: number;
}

/** Defaults at the module top so the component-level gate stays declarative. */
const DEFAULT_MIN_COLUMNS = 5;

/**
 * Bottom-padded so the visual strip looks like a single 32 px tall
 * band but the click/touch target extends another 6 px below — clears
 * the WCAG 2.5.5 24 px minimum on fine pointers without the visual
 * weight of a 44 px chrome on every viewport. The coarse-pointer
 * lift below extends each segment to 44 px without enlarging the
 * visual strip.
 */
const MinimapNav = styled.nav`
    align-items: stretch;
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.pill}px;
    display: flex;
    gap: 2px;
    height: 32px;
    margin-bottom: ${space.xs}px;
    overflow: hidden;
    padding: 2px;
    width: 100%;

    /* Hidden on the smallest viewports where one column fills the
     * screen — the SwipeHint surface already covers the
     * "more columns this way" affordance on phones, and the minimap
     * would be the dominant element on a 320 px display. */
    @media (max-width: ${breakpoints.sm - 1}px) {
        display: none;
    }
`;

/**
 * Individual column segment. `flex-grow` is set per-segment via the
 * inline `style` so each column claims a proportional share of the
 * minimap width that matches its actual width on the board (column
 * widths are uniform today, but we compute from the live width so a
 * future variable-width column doesn't ship a misaligned minimap).
 */
const MinimapSegment = styled.button<{ $inView: boolean }>`
    align-items: stretch;
    background: ${(p) =>
        p.$inView
            ? accent.bgStrong
            : "var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.06))"};
    border: 1px solid ${(p) => (p.$inView ? accent.border : "transparent")};
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55));
    cursor: pointer;
    display: flex;
    flex: 0 0 auto;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    height: 100%;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
    padding: 0 ${space.xs}px;
    position: relative;
    text-align: center;
    transition:
        background-color 120ms ease-out,
        border-color 120ms ease-out;
    white-space: nowrap;

    &:hover {
        background: ${(p) =>
            p.$inView
                ? accent.bgStrong
                : "var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.10))"};
    }

    &:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 1px;
    }

    /* Coarse-pointer touch lift (WCAG 2.5.5). The visual segment stays
     * 28 px tall (the strip's 32 px minus 2×2 px inner padding); the
     * 44 px touch target is achieved with absolute-positioned
     * extension above and below the visual strip. */
    @media (pointer: coarse) {
        &::after {
            content: "";
            position: absolute;
            inset: -8px 0;
            min-height: 44px;
        }
    }

    /* Forced-colors / Windows high-contrast: drop the brand fill so
     * the segment paints in system colours. The currentColor border
     * + Highlight background on the in-view variant keeps the
     * affordance legible without authoring custom palette overrides. */
    @media (forced-colors: active) {
        background: ${(p) => (p.$inView ? "Highlight" : "Canvas")};
        border-color: CanvasText;
        color: ${(p) => (p.$inView ? "HighlightText" : "CanvasText")};
    }
`;

const SegmentLabel = styled.span`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`;

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
): string =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

/**
 * Reads `scrollLeft` and the visible width from the scroll container.
 * Returns `null` until the ref has resolved (first render of the
 * scroll container hasn't completed yet), which keeps the in-view
 * highlight off until we have real measurements rather than guessing.
 */
const useScrollViewport = (
    ref: React.RefObject<HTMLElement | null>
): { scrollLeft: number; clientWidth: number } | null => {
    const [viewport, setViewport] = useState<{
        scrollLeft: number;
        clientWidth: number;
    } | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => {
            setViewport({
                scrollLeft: el.scrollLeft,
                clientWidth: el.clientWidth
            });
        };
        update();
        el.addEventListener("scroll", update, { passive: true });
        // ResizeObserver fires when the viewport width changes (e.g.
        // rotation, drawer open) so the in-view set re-computes
        // without a manual resize handler.
        const ro =
            typeof window !== "undefined" &&
            typeof window.ResizeObserver === "function"
                ? new window.ResizeObserver(update)
                : null;
        if (ro) ro.observe(el);
        // Also reflect window resizes for environments where the
        // container's own ResizeObserver doesn't fire (some legacy
        // browsers when the container's dimensions are derived
        // entirely from window-scaled flex parents).
        window.addEventListener("resize", update);
        return () => {
            el.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
            if (ro) ro.disconnect();
        };
    }, [ref]);

    return viewport;
};

/**
 * Looks up the column DOM element by id within the scroll container.
 * Columns are tagged with `data-minimap-column-id` by the board page
 * so this lookup is deterministic (no reliance on the dnd library's
 * draggable-id attribute, which is internal).
 */
const findColumnElement = (
    container: HTMLElement | null,
    id: string
): HTMLElement | null => {
    if (!container) return null;
    return container.querySelector<HTMLElement>(
        `[data-minimap-column-id="${CSS.escape(id)}"]`
    );
};

const BoardMinimap: React.FC<BoardMinimapProps> = ({
    columns,
    scrollContainerRef,
    minColumnsToShow = DEFAULT_MIN_COLUMNS
}) => {
    const reducedMotion = useReducedMotion();
    const viewport = useScrollViewport(scrollContainerRef);
    // Cache the per-column DOM rect data the most recent time we
    // measured. Recomputed lazily on render (cheap — offsetLeft /
    // offsetWidth read).
    const measurementsRef = useRef<
        Map<string, { left: number; right: number; width: number }>
    >(new Map());

    /*
     * Component-level kill-switch:
     *   - Below the column threshold (default 5) the minimap renders
     *     nothing so small boards stay uncluttered.
     *   - Empty columns array is also a no-op so a transient loading
     *     state doesn't paint an empty strip. We special-case the
     *     empty array because `minColumnsToShow=0` would otherwise
     *     paint an empty <nav> on a board with zero columns (the
     *     EmptyState surface owns that experience).
     */
    if (columns.length === 0 || columns.length < minColumnsToShow) return null;

    // Re-measure every column's offset against the scroll container
    // on each render. The reads are O(N) and synchronous; with N ≤ 30
    // columns (well above realistic boards) the work is unmeasurable
    // on every machine the app supports.
    const container = scrollContainerRef.current;
    if (container) {
        const next = new Map<
            string,
            { left: number; right: number; width: number }
        >();
        for (const column of columns) {
            const el = findColumnElement(container, column.id);
            if (!el) continue;
            const left = el.offsetLeft - container.offsetLeft;
            const width = el.offsetWidth;
            next.set(column.id, { left, right: left + width, width });
        }
        measurementsRef.current = next;
    }

    /*
     * Total measured width across all columns we found. Used to set
     * each segment's `flex-grow` so the minimap visually mirrors the
     * proportion each column occupies of the board's content width
     * (columns are uniform today but a future variable-width column
     * would be reflected correctly without code changes).
     */
    const totalMeasuredWidth = Array.from(
        measurementsRef.current.values()
    ).reduce((acc, m) => acc + m.width, 0);

    const isColumnInView = useCallback(
        (id: string): boolean => {
            if (!viewport) return false;
            const m = measurementsRef.current.get(id);
            if (!m) return false;
            const viewStart = viewport.scrollLeft;
            const viewEnd = viewport.scrollLeft + viewport.clientWidth;
            // Standard interval overlap — a column counts as "in view"
            // as long as ANY pixel of its rect intersects the viewport
            // rect, matching the user's visual intuition.
            return m.left < viewEnd && m.right > viewStart;
        },
        [viewport]
    );

    const handleSegmentClick = useCallback(
        (id: string) => {
            const c = scrollContainerRef.current;
            if (!c) return;
            const el = findColumnElement(c, id);
            if (!el) return;
            // Centre the column horizontally inside the scroll
            // viewport — gives a half-column peek of the neighbours
            // on either side so the user can confirm "yes, this is
            // the column I meant" by the surrounding context. Falls
            // back to a left-edge align if centring would overflow
            // the start.
            const colLeft = el.offsetLeft - c.offsetLeft;
            const colWidth = el.offsetWidth;
            const viewWidth = c.clientWidth;
            const target = Math.max(0, colLeft - (viewWidth - colWidth) / 2);
            try {
                c.scrollTo({
                    left: target,
                    behavior: reducedMotion ? "auto" : "smooth"
                });
            } catch {
                // Older browsers / jsdom may not support scroll
                // options — fall back to a plain assignment which
                // jumps instantly. The reduced-motion path lands
                // here too via behavior: "auto", which is the
                // pre-spec instant-jump default.
                c.scrollLeft = target;
            }
        },
        [reducedMotion, scrollContainerRef]
    );

    const inViewLabel = microcopyString(microcopy.board.minimap.inViewStatus);
    const offScreenLabel = microcopyString(
        microcopy.board.minimap.offScreenStatus
    );
    const ariaTemplateOne = microcopyString(
        microcopy.board.minimap.segmentAriaOne
    );
    const ariaTemplateOther = microcopyString(
        microcopy.board.minimap.segmentAriaOther
    );

    return (
        <MinimapNav
            aria-label={microcopyString(microcopy.board.minimap.aria)}
            data-testid="board-minimap"
        >
            {columns.map((column) => {
                const inView = isColumnInView(column.id);
                const measured = measurementsRef.current.get(column.id);
                // Fall back to flex-grow=1 (equal share) before the
                // measurements resolve so the strip still paints
                // something on first render instead of collapsing.
                const flexGrow =
                    totalMeasuredWidth > 0 && measured
                        ? Math.max(1, measured.width)
                        : 1;
                const template =
                    column.taskCount === 1
                        ? ariaTemplateOne
                        : ariaTemplateOther;
                const ariaLabel = formatTemplate(template, {
                    name: column.name,
                    count: column.taskCount,
                    status: inView ? inViewLabel : offScreenLabel
                });
                return (
                    <MinimapSegment
                        $inView={inView}
                        aria-current={inView ? "true" : undefined}
                        aria-label={ariaLabel}
                        data-column-id={column.id}
                        data-in-view={inView ? "true" : "false"}
                        data-testid={`board-minimap-segment-${column.id}`}
                        key={column.id}
                        onClick={() => handleSegmentClick(column.id)}
                        style={{ flexGrow }}
                        title={column.name}
                        type="button"
                    >
                        <SegmentLabel aria-hidden>{column.name}</SegmentLabel>
                    </MinimapSegment>
                );
            })}
        </MinimapNav>
    );
};

export default BoardMinimap;
