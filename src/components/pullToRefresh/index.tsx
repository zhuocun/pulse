import {
    ArrowDownOutlined,
    LoadingOutlined,
    ReloadOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button } from "antd";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import {
    easing,
    fontSize,
    fontWeight,
    motion,
    radius,
    shadow,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import useHaptic from "../../utils/hooks/useHaptic";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

/**
 * PullToRefresh — Phase 6 Wave 6 mobile pull-to-refresh primitive.
 *
 * Wraps a page's scrollable content and exposes a single React API behind
 * three rendering modes, gated on the same `(pointer: coarse)` +
 * `prefers-reduced-motion` predicates the rest of the phone chassis uses:
 *
 *   1. GESTURE  (phone + motion-enabled) → a real top-of-document pull
 *      gesture. A finger drag DOWN from the scroll-top translates an
 *      indicator + the content by a damped delta; releasing past the
 *      trigger threshold awaits `onRefresh()` then snaps back. This is
 *      the iOS-native idiom for "I want the freshest data".
 *
 *   2. BUTTON   (phone + prefers-reduced-motion) → a refresh `<Button>`
 *      above the content. This is the WCAG 2.5.7 (Motion Actuation)
 *      non-motion alternative: a user who has motion off must still be
 *      able to refresh without performing a path-based gesture.
 *
 *   3. PASSTHROUGH (desktop / disabled) → renders `children` directly
 *      with no indicator, button, or listeners. Desktop refreshes via
 *      the existing in-page affordances (the error-retry Alert, AntD's
 *      own controls), so the primitive adds nothing here. This keeps
 *      every existing desktop page test unchanged — `useIsPhoneChrome`
 *      is `false` in jsdom by default, so the primitive is a transparent
 *      wrapper unless a test explicitly opts into the coarse branch.
 *
 * DESIGN CHOICE — raw touch events over framer-motion. A vertical pull
 * must `preventDefault()` the `touchmove` to stop the document scrolling
 * while the finger drags (rubber-banding the page would fight the
 * indicator). React's synthetic `onTouchMove` is bound passively and
 * CANNOT call `preventDefault`, so the listeners are attached manually
 * via a ref + `addEventListener(..., { passive: false })`. Framer's
 * `drag` is built for element drag inside a constraint box, not a
 * conditional document-top gesture that yields to native scroll the
 * instant the finger moves up or the page isn't scrolled to the top —
 * wiring that through Framer would mean fighting its gesture recognizer.
 * The raw-pointer swipe in `taskDetailPanel` is the in-repo template.
 * All the pull math lives in the pure, exported `resolvePull` helper so
 * it is unit-testable without a real touch-physics harness (jsdom can't
 * run one) — mirroring Sheet's `decideDragEnd` split.
 */

export interface PullToRefreshProps {
    /**
     * Invoked when the user triggers a refresh (gesture past the
     * threshold, or the button in reduced-motion mode). The primitive
     * AWAITS the returned promise to know when to stop the spinner —
     * resolve it when the data has settled.
     */
    onRefresh: () => void | Promise<unknown>;
    children: React.ReactNode;
    disabled?: boolean;
    /**
     * Optional externally-controlled spinner state. OR'd with the
     * primitive's internal "awaiting the onRefresh promise" state, so a
     * consumer can drive the spinner off react-query's `isRefetching`
     * even when the refresh was kicked off elsewhere.
     */
    refreshing?: boolean;
    /** Button-mode label. Defaults to `microcopy.actions.refresh`. */
    refreshLabel?: string;
    className?: string;
    /**
     * Root testid. The primitive derives `${testid}-indicator` (gesture
     * status live region) and `${testid}-button` (reduced-motion button)
     * from it for fine-grained assertions.
     */
    "data-testid"?: string;
}

/* -- Constants --------------------------------------------------------- */

/** Pull distance (px, post-damping) past which a release triggers a refresh. */
export const PULL_THRESHOLD_PX = 64;
/** Hard cap (px, post-damping) on how far the content can be pulled. */
export const MAX_PULL_PX = 96;
/**
 * Resistance applied to the raw finger delta. Halving the travel models
 * the rubber-band feel of native pull-to-refresh — the content lags the
 * finger so the gesture reads as elastic rather than 1:1 sticky.
 */
export const PULL_DAMPING = 0.5;
/** Spinner-hold offset (px) while `onRefresh` is in flight. */
const SPINNER_OFFSET_PX = PULL_THRESHOLD_PX;

/* -- Pure helper ------------------------------------------------------- */

export interface ResolvePullInput {
    /** Raw downward finger delta (px). Negative deltas are clamped to 0. */
    rawDelta: number;
    /** Trigger threshold (px, post-damping). */
    threshold: number;
    /** Hard cap (px, post-damping). */
    max: number;
    /** Resistance multiplier. Defaults to {@link PULL_DAMPING}. */
    damping?: number;
}

export interface ResolvePullResult {
    /** Damped, clamped offset (px) to translate the indicator + content. */
    offset: number;
    /** Whether releasing at this offset should trigger a refresh. */
    willRefresh: boolean;
}

/**
 * Pure pull-physics resolver. Damps the raw finger delta, clamps it to
 * `[0, max]`, and reports whether the damped offset has crossed the
 * trigger threshold. Extracted so the (otherwise DOM-bound) gesture math
 * is unit-testable without a touch harness — jsdom can't run real touch
 * physics, the same constraint Sheet's `decideDragEnd` works around.
 *
 *   - Upward / zero drags resolve to `{ offset: 0, willRefresh: false }`
 *     (the gesture only engages downward from the scroll-top).
 *   - The offset is clamped to `max` so the content can never be hauled
 *     past the cap no matter how far the finger travels.
 *   - `willRefresh` is `offset >= threshold` — the caller hands the live
 *     offset back so the same predicate drives both the live "Release to
 *     refresh" status flip and the release decision.
 */
export const resolvePull = ({
    rawDelta,
    threshold,
    max,
    damping = PULL_DAMPING
}: ResolvePullInput): ResolvePullResult => {
    if (rawDelta <= 0) return { offset: 0, willRefresh: false };
    const offset = Math.min(rawDelta * damping, max);
    return { offset, willRefresh: offset >= threshold };
};

/* -- Styled surfaces --------------------------------------------------- */

interface ViewportProps {
    $reducedMotion: boolean;
}

/**
 * Gesture-mode clip box. `overflow: hidden` keeps the indicator tucked
 * above the content (translated up by its own height) from spilling into
 * the page, and `touch-action: pan-y` lets the browser keep vertical
 * scroll everywhere except while we actively `preventDefault` a pull.
 */
const Viewport = styled.div<ViewportProps>`
    overflow: hidden;
    position: relative;
    touch-action: pan-y;
`;

interface IndicatorProps {
    $offset: number;
    $reducedMotion: boolean;
    $settling: boolean;
}

/**
 * The pull indicator. Solid `--ant-color-bg-container` token background
 * (NOT glass) per the brief — a translucent indicator over scrolling
 * content reads as muddy, and glass would need the reduced-transparency
 * / forced-colors gating dance for no benefit here. It is parked just
 * above the content (translated up by its own resting height) and rides
 * down with the pull offset.
 */
const Indicator = styled.div<IndicatorProps>`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    display: flex;
    gap: ${space.xs}px;
    height: ${touchTargetCoarse}px;
    justify-content: center;
    left: 0;
    position: absolute;
    right: 0;
    /* Park the indicator one row above the content, then ride the pull
     * offset down into view. */
    top: -${touchTargetCoarse}px;
    transform: translateY(${(p) => p.$offset}px);
    transition: ${(p) =>
        p.$reducedMotion || !p.$settling
            ? "none"
            : `transform ${motion.medium}ms ${easing.standard}`};
    z-index: 1;
`;

const IndicatorPill = styled.span`
    align-items: center;
    background: var(--ant-color-bg-container, #ffffff);
    border-radius: ${radius.pill}px;
    box-shadow: ${shadow.sm};
    color: var(--ant-color-primary, #ea580c);
    display: inline-flex;
    gap: ${space.xxs}px;
    height: ${space.xl}px;
    padding-inline: ${space.sm}px;

    /* Forced-colors mode strips box-shadow, so the pill would lose its
     * edge against the content; restore one with a system-color border. */
    @media (forced-colors: active) {
        border: 1px solid CanvasText;
        box-shadow: none;
    }
`;

const IndicatorLabel = styled.span`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
`;

interface ArrowProps {
    $flipped: boolean;
    $reducedMotion: boolean;
}

/** The pull arrow rotates 180deg once the pull crosses the threshold. */
const Arrow = styled(ArrowDownOutlined)<ArrowProps>`
    transform: rotate(${(p) => (p.$flipped ? 180 : 0)}deg);
    transition: ${(p) =>
        p.$reducedMotion
            ? "none"
            : `transform ${motion.short}ms ${easing.standard}`};
`;

interface ContentProps {
    $offset: number;
    $reducedMotion: boolean;
    $settling: boolean;
}

/** Content wrapper — translated down by the live pull offset. */
const Content = styled.div<ContentProps>`
    transform: translateY(${(p) => p.$offset}px);
    transition: ${(p) =>
        p.$reducedMotion || !p.$settling
            ? "none"
            : `transform ${motion.medium}ms ${easing.standard}`};
    will-change: transform;
`;

const ButtonRow = styled.div`
    display: flex;
    justify-content: center;
    margin-bottom: ${space.sm}px;
`;

/* -- Component --------------------------------------------------------- */

const PullToRefresh: React.FC<PullToRefreshProps> = ({
    onRefresh,
    children,
    disabled = false,
    refreshing = false,
    refreshLabel,
    className,
    "data-testid": dataTestid
}) => {
    const isPhone = useIsPhoneChrome();
    const reducedMotion = useReducedMotion();
    const { vibrate } = useHaptic();

    const gestureMode = isPhone && !reducedMotion && !disabled;
    const buttonMode = isPhone && reducedMotion && !disabled;

    const label = refreshLabel ?? microcopy.actions.refresh;

    // Internal "awaiting the onRefresh promise" spinner state. OR'd with
    // the externally-controlled `refreshing` prop.
    const [internalRefreshing, setInternalRefreshing] = useState(false);
    const busy = refreshing || internalRefreshing;

    /**
     * Run the consumer's refresh, awaiting its (possibly-thenable)
     * return so the spinner clears only once the data has settled.
     * Guards against overlapping invocations with the `busy` flag.
     */
    const runRefresh = useCallback(async () => {
        setInternalRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setInternalRefreshing(false);
        }
    }, [onRefresh]);

    /* -- Gesture mode --------------------------------------------------- */

    const viewportRef = useRef<HTMLDivElement | null>(null);
    // Live pull offset (px) the indicator + content translate by.
    const [offset, setOffset] = useState(0);
    // True once the finger crosses the trigger threshold — flips the
    // status text and the arrow.
    const [willRefresh, setWillRefresh] = useState(false);
    // True while the post-release snap-back transition runs (so we only
    // animate the snap, never the live finger-tracking).
    const [settling, setSettling] = useState(false);

    // Mutable gesture bookkeeping kept off React state to avoid a render
    // per touchmove frame.
    const pullStateRef = useRef<{
        startY: number;
        active: boolean;
        crossed: boolean;
    } | null>(null);
    // Keep the latest threshold-crossed haptic edge so we buzz once per
    // crossing, not once per frame past it.
    const busyRef = useRef(busy);
    busyRef.current = busy;
    const runRefreshRef = useRef(runRefresh);
    runRefreshRef.current = runRefresh;

    useEffect(() => {
        const node = viewportRef.current;
        if (!node || !gestureMode) return undefined;

        const atTop = (): boolean =>
            (document.scrollingElement?.scrollTop ?? 0) <= 0;

        const handleTouchStart = (event: TouchEvent): void => {
            // Don't start a new pull mid-refresh or with multiple fingers.
            if (busyRef.current || event.touches.length !== 1) return;
            if (!atTop()) return;
            pullStateRef.current = {
                startY: event.touches[0].clientY,
                active: true,
                crossed: false
            };
            setSettling(false);
        };

        const handleTouchMove = (event: TouchEvent): void => {
            const state = pullStateRef.current;
            if (!state || !state.active) return;
            // If the document scrolled away from the top mid-gesture
            // (inertia, a programmatic scroll), abandon the pull and hand
            // the touch back to native scrolling.
            if (!atTop()) {
                pullStateRef.current = null;
                setOffset(0);
                setWillRefresh(false);
                return;
            }
            const rawDelta = event.touches[0].clientY - state.startY;
            if (rawDelta <= 0) {
                // Upward / neutral — let the page scroll normally.
                setOffset(0);
                setWillRefresh(false);
                return;
            }
            // Downward from the top: this is our gesture. Stop the page
            // from scrolling (rubber-banding) under the pull. This is the
            // line React's passive synthetic handler can't reach.
            event.preventDefault();
            const { offset: nextOffset, willRefresh: nextWillRefresh } =
                resolvePull({
                    rawDelta,
                    threshold: PULL_THRESHOLD_PX,
                    max: MAX_PULL_PX
                });
            setOffset(nextOffset);
            if (nextWillRefresh !== state.crossed) {
                state.crossed = nextWillRefresh;
                setWillRefresh(nextWillRefresh);
                // Light tap as the pull crosses (either direction across)
                // the trigger threshold.
                vibrate("tap");
            }
        };

        const handleTouchEnd = (): void => {
            const state = pullStateRef.current;
            pullStateRef.current = null;
            if (!state || !state.active) return;
            setSettling(true);
            if (state.crossed) {
                // Hold a small spinner offset, fire the refresh, then snap
                // back once it settles.
                setOffset(SPINNER_OFFSET_PX);
                setWillRefresh(false);
                vibrate("success");
                void runRefreshRef.current().finally(() => {
                    setOffset(0);
                });
            } else {
                setOffset(0);
                setWillRefresh(false);
            }
        };

        // `{ passive: false }` on touchmove is the whole point — it lets
        // `preventDefault` stop the page scroll while pulling.
        node.addEventListener("touchstart", handleTouchStart, {
            passive: true
        });
        node.addEventListener("touchmove", handleTouchMove, { passive: false });
        node.addEventListener("touchend", handleTouchEnd, { passive: true });
        node.addEventListener("touchcancel", handleTouchEnd, { passive: true });
        return () => {
            node.removeEventListener("touchstart", handleTouchStart);
            node.removeEventListener("touchmove", handleTouchMove);
            node.removeEventListener("touchend", handleTouchEnd);
            node.removeEventListener("touchcancel", handleTouchEnd);
        };
    }, [gestureMode, vibrate]);

    // When the external `refreshing` prop or internal spinner clears while
    // an offset is still held (consumer drove the spinner), snap back.
    useEffect(() => {
        if (!busy && !pullStateRef.current && offset === SPINNER_OFFSET_PX) {
            setSettling(true);
            setOffset(0);
        }
    }, [busy, offset]);

    if (gestureMode) {
        const statusText = busy
            ? microcopy.pullToRefresh.refreshing
            : willRefresh
              ? microcopy.pullToRefresh.release
              : microcopy.pullToRefresh.pull;
        // Spinner means "fetch in flight", NOT "armed". While the finger
        // is still down past the threshold the indicator shows the flipped
        // arrow + "Release to refresh"; the spinner appears only once
        // `onRefresh` is awaiting (`busy`). OR-ing in the offset would mask
        // that armed state behind a premature spinner.
        const showSpinner = busy;
        return (
            <Viewport
                $reducedMotion={reducedMotion}
                className={className}
                data-testid={dataTestid}
                ref={viewportRef}
            >
                <Indicator
                    $offset={offset}
                    $reducedMotion={reducedMotion}
                    $settling={settling}
                    aria-live="polite"
                    data-testid={
                        dataTestid ? `${dataTestid}-indicator` : undefined
                    }
                    role="status"
                >
                    <IndicatorPill>
                        {showSpinner ? (
                            <LoadingOutlined aria-hidden spin />
                        ) : (
                            <Arrow
                                $flipped={willRefresh}
                                $reducedMotion={reducedMotion}
                                aria-hidden
                            />
                        )}
                        <IndicatorLabel>{statusText}</IndicatorLabel>
                    </IndicatorPill>
                </Indicator>
                <Content
                    $offset={offset}
                    $reducedMotion={reducedMotion}
                    $settling={settling}
                >
                    {children}
                </Content>
            </Viewport>
        );
    }

    /* -- Button mode (reduced-motion) ----------------------------------- */

    if (buttonMode) {
        return (
            <div className={className} data-testid={dataTestid}>
                <ButtonRow>
                    <Button
                        aria-label={label}
                        data-testid={
                            dataTestid ? `${dataTestid}-button` : undefined
                        }
                        icon={<ReloadOutlined aria-hidden />}
                        loading={busy}
                        onClick={() => {
                            void runRefresh();
                        }}
                    >
                        {label}
                    </Button>
                </ButtonRow>
                {children}
            </div>
        );
    }

    /* -- Passthrough (desktop / disabled) ------------------------------- */

    return (
        <div className={className} data-testid={dataTestid}>
            {children}
        </div>
    );
};

export default PullToRefresh;
export { PullToRefresh };
