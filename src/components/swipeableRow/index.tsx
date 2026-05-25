import styled from "@emotion/styled";
import React, { useEffect, useRef, useState } from "react";

import {
    easing,
    fontSize,
    fontWeight,
    motion,
    space
} from "../../theme/tokens";
import useHaptic from "../../utils/hooks/useHaptic";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

/**
 * SwipeableRow — iOS-26 mobile redesign "swipe-to-action" row primitive.
 *
 * Wraps a single row of content and reveals an action pane behind it as
 * the user swipes horizontally — the iOS Mail / Messages idiom. A
 * left→right swipe reveals the `leadingAction` pinned to the left edge; a
 * right→left swipe reveals the `trailingAction` pinned to the right edge.
 * Releasing past the commit threshold (distance OR fling velocity) fires
 * that action's `onCommit` exactly once and animates the row out;
 * otherwise the row snaps back. There is no sticky half-open state — the
 * gesture is commit-or-snap-back only.
 *
 * Gated on the same `(pointer: coarse)` + `prefers-reduced-motion`
 * predicates the rest of the phone chassis uses. When NOT enabled
 * (desktop, reduced-motion, disabled, or no actions supplied) the
 * primitive is a transparent passthrough — it renders `children` in a
 * plain wrapper with NO gesture listeners, so the untouched row (which
 * the consumer card drives via its own click / keyboard handlers) is
 * fully interactive on every non-phone surface. `useIsPhoneChrome` is
 * `false` in jsdom by default, so existing desktop tests see the row
 * unchanged unless they explicitly opt into the coarse branch.
 *
 * DESIGN CHOICE — raw touch events over framer-motion's `drag`, mirroring
 * the sibling `pullToRefresh` primitive (and the `taskDetailPanel` swipe).
 * Once the gesture is CLAIMED as horizontal we must `preventDefault()` the
 * `touchmove` to stop the page scrolling under the finger; React's passive
 * synthetic `onTouchMove` CANNOT call `preventDefault`, so the listeners
 * are attached manually via a ref + `addEventListener(..., { passive:
 * false })`. Framer's `drag` is built for element drag inside a constraint
 * box, can't be driven by jsdom's synthetic touch events (the tests fire
 * raw `touchstart` / `touchmove` / `touchend`), and would fight the
 * axis-lock that yields to vertical scroll. The live offset drives a plain
 * CSS `transform` + a conditional `transition` for the snap-back / commit
 * VISUAL only. All the release math lives in the pure, exported
 * `resolveSwipe` helper so it is unit-testable without a touch-physics
 * harness — mirroring `resolvePull` / Sheet's `decideDragEnd`.
 */

export interface SwipeAction {
    /** Stable identity for testids / keys. */
    key: string;
    /** Accessible + visible label, already localized by the consumer. */
    label: string;
    /** Decorative icon node. */
    icon: React.ReactNode;
    /** Background color of the revealed action pane. */
    background: string;
    /** Icon / label color. Defaults to `#fff`. */
    foreground?: string;
    /** Invoked exactly once when the swipe commits past the threshold. */
    onCommit: () => void;
    /** Styling hint only; the consumer owns any confirmation. */
    destructive?: boolean;
}

export interface SwipeableRowProps {
    children: React.ReactNode;
    /** Revealed by a left→right swipe (iOS "leading" edge). */
    leadingAction?: SwipeAction;
    /** Revealed by a right→left swipe (iOS "trailing" edge). */
    trailingAction?: SwipeAction;
    /** Force passthrough — render children with no gesture listeners. */
    disabled?: boolean;
    /**
     * Root testid. The primitive derives `${testid}-leading` and
     * `${testid}-trailing` for the revealed action panes.
     */
    "data-testid"?: string;
}

/* -- Constants --------------------------------------------------------- */

/**
 * Minimum horizontal travel (px) before the gesture is CLAIMED as a swipe.
 * Below this the touch stays passive so taps and vertical scroll pass
 * straight through to the (interactive) child. Mirrors the in-repo
 * activation slop used by the `taskDetailPanel` swipe.
 */
export const SWIPE_ACTIVATE_PX = 10;
/**
 * Edge-from-screen guard (px). iOS Safari fires its native back/forward
 * swipe on touches that originate within ~20 px of either viewport edge;
 * ignoring gestures that start in that band lets the browser chrome own
 * the system gesture. Mirrors `taskDetailPanel`'s `SWIPE_EDGE_GUARD_PX`.
 */
export const SWIPE_EDGE_GUARD_PX = 20;
/**
 * Fraction of the row width past which a release commits the active
 * action. 0.4 mirrors the 40%-of-gap commit ratio Sheet's `decideDragEnd`
 * uses for its detent snap.
 */
export const SWIPE_COMMIT_DISTANCE_RATIO = 0.4;
/**
 * Pointer velocity (px/s) past which a fling commits the active action
 * regardless of distance — the "flick it away" idiom.
 */
export const SWIPE_COMMIT_VELOCITY = 600;
/**
 * Minimum inter-frame delta (ms) before a velocity sample is trusted. Real
 * touch frames land ~16 ms apart; a sub-frame delta divides a tiny pixel
 * move by a near-zero `dt` and synthesizes an absurd velocity (a 25 px
 * move over 0.05 ms reads as 500 000 px/s). Flooring the sample window
 * keeps the fling detector honest — and is what makes the gesture testable
 * under jsdom, where synthetic `touchmove`s fire in the same microtask and
 * `performance.now()` barely advances between them, so velocity stays 0 and
 * the release decision falls through to the (deterministic) distance test.
 */
export const SWIPE_VELOCITY_MIN_DT_MS = 8;

/* -- Pure helper ------------------------------------------------------- */

export interface SwipeDecisionInput {
    /** Horizontal drag offset (px). Positive = rightward (toward leading). */
    offsetX: number;
    /** Pointer velocity (px/s). Positive = rightward. */
    velocityX: number;
    /** Row width (px). */
    rowWidth: number;
    hasLeading: boolean;
    hasTrailing: boolean;
}

export type SwipeDecision =
    | { kind: "commit"; action: "leading" | "trailing" }
    | { kind: "snap-back" };

/**
 * Pure swipe-release resolver. Decides whether a release at the given
 * offset / velocity commits the active-direction action or snaps the row
 * back. Extracted so the (otherwise DOM-bound) gesture decision is
 * unit-testable without a touch harness — jsdom can't run real touch
 * physics, the same constraint `resolvePull` / Sheet's `decideDragEnd`
 * work around. No DOM / refs inside.
 *
 *   - Active direction is set by the offset sign: `> 0` → leading,
 *     `< 0` → trailing. A zero / no-movement offset snaps back.
 *   - The active direction commits only when it HAS an action AND either
 *     the magnitude passed `rowWidth * SWIPE_COMMIT_DISTANCE_RATIO` OR the
 *     velocity in that direction passed `SWIPE_COMMIT_VELOCITY`.
 *   - If the active direction has no action it always snaps back (the live
 *     drag hard-clamps that side to 0, so it never opens onto an empty pane).
 */
export const resolveSwipe = ({
    offsetX,
    velocityX,
    rowWidth,
    hasLeading,
    hasTrailing
}: SwipeDecisionInput): SwipeDecision => {
    if (offsetX === 0) return { kind: "snap-back" };

    const distanceThreshold =
        Math.max(0, rowWidth) * SWIPE_COMMIT_DISTANCE_RATIO;

    if (offsetX > 0) {
        // Rightward → leading edge.
        if (!hasLeading) return { kind: "snap-back" };
        const committed =
            offsetX > distanceThreshold || velocityX > SWIPE_COMMIT_VELOCITY;
        return committed
            ? { kind: "commit", action: "leading" }
            : { kind: "snap-back" };
    }

    // Leftward → trailing edge.
    if (!hasTrailing) return { kind: "snap-back" };
    const committed =
        -offsetX > distanceThreshold || -velocityX > SWIPE_COMMIT_VELOCITY;
    return committed
        ? { kind: "commit", action: "trailing" }
        : { kind: "snap-back" };
};

/* -- Styled surfaces --------------------------------------------------- */

/**
 * Gesture-mode clip box. `overflow: hidden` keeps the action panes tucked
 * behind the foreground row from spilling out, `position: relative`
 * anchors the absolutely-positioned panes, and `touch-action: pan-y` lets
 * the browser keep vertical scroll everywhere except while we actively
 * `preventDefault` a claimed horizontal swipe.
 */
const Viewport = styled.div`
    overflow: hidden;
    position: relative;
    touch-action: pan-y;
`;

interface ActionPaneProps {
    $side: "leading" | "trailing";
    $background: string;
    $foreground: string;
}

/**
 * A revealed action pane, pinned to its edge and sitting BEHIND the
 * foreground row (which slides aside to reveal it). Pointer-only visual
 * enhancement that duplicates controls available elsewhere, so it is
 * `aria-hidden` and never focusable — the icon + label are decorative.
 */
const ActionPane = styled.div<ActionPaneProps>`
    align-items: center;
    background: ${(p) => p.$background};
    bottom: 0;
    color: ${(p) => p.$foreground};
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    justify-content: center;
    ${(p) => (p.$side === "leading" ? "left: 0;" : "right: 0;")}
    padding-inline: ${space.lg}px;
    position: absolute;
    top: 0;
`;

const ActionIcon = styled.span`
    align-items: center;
    display: inline-flex;
    font-size: ${fontSize.lg}px;
    justify-content: center;
`;

const ActionLabel = styled.span`
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
`;

interface ForegroundProps {
    $offset: number;
    $settling: boolean;
    $reducedMotion: boolean;
}

/**
 * The foreground row — translated horizontally by the live clamped offset
 * while dragging, then transitioned to its resting / committed position on
 * release. The transition runs ONLY while settling so the live
 * finger-tracking stays 1:1; reduced-motion users never reach this branch,
 * but the guard keeps the surface honest if that ever changes.
 */
const Foreground = styled.div<ForegroundProps>`
    background: var(--ant-color-bg-container, #ffffff);
    position: relative;
    transform: translate3d(${(p) => p.$offset}px, 0, 0);
    transition: ${(p) =>
        p.$reducedMotion || !p.$settling
            ? "none"
            : `transform ${motion.medium}ms ${easing.standard}`};
    will-change: transform;
    z-index: 1;
`;

/* -- Component --------------------------------------------------------- */

interface SwipeStateRef {
    startX: number;
    startY: number;
    /** Whether the gesture has been CLAIMED as a horizontal swipe. */
    claimed: boolean;
    /** Whether this gesture is disqualified (vertical scroll, edge band). */
    abandoned: boolean;
    /** Latest live offset (px) — used for the release decision. */
    offset: number;
    /** Latest pointer velocity (px/s) — used for the fling decision. */
    velocity: number;
    /** Timestamp of the last move (ms) for velocity integration. */
    lastTime: number;
    /** Last clientX for velocity integration. */
    lastX: number;
    /** Whether the live offset has crossed the commit threshold. */
    crossed: boolean;
}

const SwipeableRow: React.FC<SwipeableRowProps> = ({
    children,
    leadingAction,
    trailingAction,
    disabled = false,
    "data-testid": dataTestid
}) => {
    const isPhone = useIsPhoneChrome();
    const reducedMotion = useReducedMotion();
    const { vibrate } = useHaptic();

    const hasActions = Boolean(leadingAction || trailingAction);
    const enabled = isPhone && !reducedMotion && !disabled && hasActions;

    const viewportRef = useRef<HTMLDivElement | null>(null);
    // Live horizontal offset (px) the foreground row translates by.
    const [offset, setOffset] = useState(0);
    // True while the post-release snap-back / commit transition runs, so we
    // only animate the release, never the live finger-tracking.
    const [settling, setSettling] = useState(false);

    // Mutable gesture bookkeeping kept off React state to avoid a render
    // per touchmove frame.
    const stateRef = useRef<SwipeStateRef | null>(null);

    // Keep the latest actions / vibrate behind refs so the effect (bound
    // once per `enabled` flip) always sees current values without
    // re-subscribing the listeners every render.
    const leadingRef = useRef(leadingAction);
    leadingRef.current = leadingAction;
    const trailingRef = useRef(trailingAction);
    trailingRef.current = trailingAction;
    const vibrateRef = useRef(vibrate);
    vibrateRef.current = vibrate;

    useEffect(() => {
        const node = viewportRef.current;
        if (!node || !enabled) return undefined;

        // Row width drives the distance threshold. `getBoundingClientRect`
        // is `0` in jsdom (no layout), so fall back to the viewport width
        // to keep the threshold meaningful under test and on the rare real
        // 0-width measurement (pre-layout first frame).
        const measureWidth = (): number => {
            const measured = node.getBoundingClientRect().width;
            if (measured > 0) return measured;
            return typeof window !== "undefined" && window.innerWidth > 0
                ? window.innerWidth
                : 0;
        };

        // Clamp the live offset: only the side that HAS an action travels
        // freely; the actionless direction is hard-clamped to 0 (no elastic
        // give) so the row can't open onto an empty pane.
        const clampOffset = (raw: number): number => {
            if (raw > 0) return leadingRef.current ? raw : 0;
            if (raw < 0) return trailingRef.current ? raw : 0;
            return 0;
        };

        const handleTouchStart = (event: TouchEvent): void => {
            if (event.touches.length !== 1) return;
            const touch = event.touches[0];
            // Skip touches that begin in either viewport-edge band so the
            // browser's native back/forward gesture owns them.
            const viewportWidth =
                typeof window !== "undefined" ? window.innerWidth : 0;
            const inEdgeBand =
                touch.clientX < SWIPE_EDGE_GUARD_PX ||
                (viewportWidth > 0 &&
                    touch.clientX > viewportWidth - SWIPE_EDGE_GUARD_PX);
            stateRef.current = {
                startX: touch.clientX,
                startY: touch.clientY,
                claimed: false,
                abandoned: inEdgeBand,
                offset: 0,
                velocity: 0,
                lastTime:
                    typeof performance !== "undefined"
                        ? performance.now()
                        : Date.now(),
                lastX: touch.clientX,
                crossed: false
            };
            setSettling(false);
        };

        const handleTouchMove = (event: TouchEvent): void => {
            const state = stateRef.current;
            if (!state || state.abandoned) return;
            const touch = event.touches[0];
            // A multi-touch lift can momentarily empty `touches` mid-gesture;
            // bail rather than dereference an undefined touch.
            if (!touch) return;
            const dx = touch.clientX - state.startX;
            const dy = touch.clientY - state.startY;

            if (!state.claimed) {
                // Yield to vertical scroll: the moment the gesture reads as
                // vertical-dominant, abandon it and hand the touch back to
                // native scrolling (and keep the child's tap intact).
                if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 0) {
                    state.abandoned = true;
                    return;
                }
                // Not yet past the activation slop — stay passive so a tap
                // or a tiny drift never swallows the child's click.
                if (Math.abs(dx) < SWIPE_ACTIVATE_PX) return;
                // Horizontal and past the slop → CLAIM the gesture.
                state.claimed = true;
            }

            // Claimed: this is our swipe. Stop the page scrolling under the
            // finger. This is the line React's passive synthetic handler
            // can't reach.
            event.preventDefault();

            // Velocity integration over the inter-frame delta.
            const now =
                typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();
            const dt = now - state.lastTime;
            // Only trust a velocity sample once a realistic frame's worth of
            // time has passed (see SWIPE_VELOCITY_MIN_DT_MS); otherwise a
            // sub-frame `dt` would manufacture a bogus fling.
            if (dt >= SWIPE_VELOCITY_MIN_DT_MS) {
                state.velocity = ((touch.clientX - state.lastX) / dt) * 1000;
                state.lastTime = now;
                state.lastX = touch.clientX;
            }

            const next = clampOffset(dx);
            state.offset = next;
            setOffset(next);

            // Light tap the first time the live offset crosses the commit
            // distance threshold (either direction across it).
            const width = measureWidth();
            const distanceThreshold = width * SWIPE_COMMIT_DISTANCE_RATIO;
            const pastThreshold =
                distanceThreshold > 0 && Math.abs(next) > distanceThreshold;
            if (pastThreshold !== state.crossed) {
                state.crossed = pastThreshold;
                if (pastThreshold) vibrateRef.current("tap");
            }
        };

        const handleTouchEnd = (): void => {
            const state = stateRef.current;
            stateRef.current = null;
            if (!state || !state.claimed) {
                // Never claimed (tap / vertical scroll / edge band): leave
                // the child fully interactive and the row at rest.
                return;
            }
            setSettling(true);
            const decision = resolveSwipe({
                offsetX: state.offset,
                velocityX: state.velocity,
                rowWidth: measureWidth(),
                hasLeading: Boolean(leadingRef.current),
                hasTrailing: Boolean(trailingRef.current)
            });
            if (decision.kind === "commit") {
                const action =
                    decision.action === "leading"
                        ? leadingRef.current
                        : trailingRef.current;
                // Commit: buzz, fire the consumer's handler exactly once,
                // then animate the row back to rest. The consumer typically
                // removes or navigates the row on commit; settling to 0
                // covers the case where it stays mounted (no sticky
                // half-open state — commit-or-snap-back only).
                vibrateRef.current("success");
                action?.onCommit();
                setOffset(0);
            } else {
                setOffset(0);
            }
        };

        const handleTouchCancel = (): void => {
            const state = stateRef.current;
            stateRef.current = null;
            if (!state || !state.claimed) return;
            // The OS reclaimed a CLAIMED swipe (e.g. system-gesture
            // promotion). Snap back WITHOUT committing — for a destructive
            // trailing action a stray commit is worse than none, so a cancel
            // must never fire `onCommit` (unlike touchend).
            setSettling(true);
            setOffset(0);
        };

        node.addEventListener("touchstart", handleTouchStart, {
            passive: true
        });
        // `{ passive: false }` on touchmove is the whole point — it lets
        // `preventDefault` stop the page scroll once we've claimed the swipe.
        node.addEventListener("touchmove", handleTouchMove, {
            passive: false
        });
        node.addEventListener("touchend", handleTouchEnd, { passive: true });
        node.addEventListener("touchcancel", handleTouchCancel, {
            passive: true
        });
        return () => {
            node.removeEventListener("touchstart", handleTouchStart);
            node.removeEventListener("touchmove", handleTouchMove);
            node.removeEventListener("touchend", handleTouchEnd);
            node.removeEventListener("touchcancel", handleTouchCancel);
        };
    }, [enabled]);

    /* -- Passthrough (desktop / reduced-motion / disabled / no actions) - */

    if (!enabled) {
        return <div data-testid={dataTestid}>{children}</div>;
    }

    /* -- Gesture mode --------------------------------------------------- */

    // Reveal only the side currently being dragged toward — the leading
    // pane while rightward, the trailing pane while leftward. Both render
    // when at rest (offset 0) is unnecessary, so gate each on its sign.
    const showLeading = offset > 0 && Boolean(leadingAction);
    const showTrailing = offset < 0 && Boolean(trailingAction);

    return (
        <Viewport data-testid={dataTestid} ref={viewportRef}>
            {leadingAction && (
                <ActionPane
                    $background={leadingAction.background}
                    $foreground={leadingAction.foreground ?? "#fff"}
                    $side="leading"
                    aria-hidden="true"
                    data-testid={
                        dataTestid ? `${dataTestid}-leading` : undefined
                    }
                    style={{ opacity: showLeading ? 1 : 0 }}
                >
                    <ActionIcon aria-hidden="true">
                        {leadingAction.icon}
                    </ActionIcon>
                    <ActionLabel>{leadingAction.label}</ActionLabel>
                </ActionPane>
            )}
            {trailingAction && (
                <ActionPane
                    $background={trailingAction.background}
                    $foreground={trailingAction.foreground ?? "#fff"}
                    $side="trailing"
                    aria-hidden="true"
                    data-testid={
                        dataTestid ? `${dataTestid}-trailing` : undefined
                    }
                    style={{ opacity: showTrailing ? 1 : 0 }}
                >
                    <ActionIcon aria-hidden="true">
                        {trailingAction.icon}
                    </ActionIcon>
                    <ActionLabel>{trailingAction.label}</ActionLabel>
                </ActionPane>
            )}
            <Foreground
                $offset={offset}
                $reducedMotion={reducedMotion}
                $settling={settling}
            >
                {children}
            </Foreground>
        </Viewport>
    );
};

export default SwipeableRow;
export { SwipeableRow };
