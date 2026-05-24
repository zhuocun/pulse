import styled from "@emotion/styled";
import { Drawer } from "antd";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import type { PanInfo } from "framer-motion";
import React, {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { createPortal } from "react-dom";

import { radius } from "../../theme/tokens";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import useFocusTrap from "./useFocusTrap";

/**
 * Phase 6 Wave 3 — multi-detent bottom Sheet primitive.
 *
 * Wraps three rendering branches behind a single React API:
 *
 *   1. Phone + motion-enabled → portal'd animated surface with three
 *      snap detents (peek / medium / large), a grabber handle, a
 *      glass-tinted scrim, drag-to-dismiss, Esc-to-close, and a
 *      focus trap that restores focus on unmount.
 *
 *   2. Phone + prefers-reduced-motion → AntD `<Drawer placement="bottom">`.
 *      The accessibility fallback; AntD owns chrome, focus trap, and
 *      mask. No grabber, no detent UI.
 *
 *   3. Desktop / tablet / `forceDrawerFallback` → AntD `<Drawer>` with
 *      the consumer-supplied `desktopPlacement` (right by default) +
 *      `desktopSize`. Same content, no animated branch.
 *
 * The prop surface is a strict superset of the AntD Drawer props the
 * three consumer surfaces (activityFeedDrawer, copilotDock,
 * taskDetailPanel) use today so the migration is a straight swap.
 *
 * Detent geometry consumes the `--ant-detent-*` CSS vars emitted by
 * `theme/palettes/cssVars` — `peek=96px`, `medium=50dvh`, `large=92dvh`.
 * Animation timing reads `--ant-motion-detent-snap` (360 ms) and
 * `--ant-easing-detent` (`cubic-bezier(0.32, 0.72, 0, 1)`). Reading
 * the vars at runtime keeps the source of truth in the cssVars file
 * (the Phase 6 Wave 1 test pins) — touching the TS detent token alone
 * would silently drift the Sheet behaviour from the design tokens.
 *
 * Drag-to-dismiss is wired through Framer Motion's `useDragControls`
 * so only the grabber initiates the drag; the body content stays
 * scrollable / tappable without intercepting horizontal swipe
 * gestures (this is the contract that lets `taskDetailPanel` keep
 * its sibling-swipe gesture when it migrates in a later wave).
 */

export type SheetDetent = "peek" | "medium" | "large";

export interface SheetProps {
    open: boolean;
    onClose: () => void;

    /** Controlled current detent (uncontrolled if omitted). */
    detent?: SheetDetent;
    /** Initial detent when uncontrolled. Defaults to `medium`. */
    defaultDetent?: SheetDetent;
    onDetentChange?: (next: SheetDetent) => void;
    /**
     * Which detents the sheet may snap to. Defaults to
     * `["medium", "large"]`. Order is irrelevant — the Sheet sorts
     * by exposed height internally.
     */
    detents?: readonly SheetDetent[];

    /** Title slot — usually a string or a `<span>` with an icon. */
    title?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;

    /** Render a close (X) affordance in the header. Default `true`. */
    closable?: boolean;
    /** Render the scrim behind the sheet. Default `true`. */
    mask?: boolean;
    /**
     * Whether clicking the scrim dismisses the sheet. Default `true`.
     * AntD `<Drawer>` calls this `maskClosable`; we accept both names.
     */
    maskClosable?: boolean;
    dismissOnScrimClick?: boolean;

    /** Default `true` on the animated branch. Ignored elsewhere. */
    showGrabber?: boolean;

    /** Used by the desktop / fallback `<Drawer>`. Default `right`. */
    desktopPlacement?: "right" | "bottom";
    /** AntD `<Drawer>` `size` pass-through. Default `"default"`. */
    desktopSize?: number | "default" | "large";

    /**
     * Phone-branch root `data-testid`. The animated branch also emits
     * `${dataTestid}-scrim`, `${dataTestid}-surface`, and
     * `${dataTestid}-grabber` testids for fine-grained assertions.
     */
    "data-testid"?: string;
    "aria-labelledby"?: string;
    ariaLabelledBy?: string;
    rootClassName?: string;

    /** Mirror AntD `<Drawer>`'s `styles.body` slot. */
    styles?: {
        body?: React.CSSProperties;
    };

    /** Escape hatch — render the AntD Drawer fallback unconditionally. */
    forceDrawerFallback?: boolean;
}

/* -- Constants --------------------------------------------------------- */

const Z_INDEX_SCRIM = 1000;
const Z_INDEX_SURFACE = 1001;
const DEFAULT_DETENTS: readonly SheetDetent[] = ["medium", "large"];
const SNAP_DURATION_S = 0.36;
const SCRIM_DURATION_S = 0.22;
const DETENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
/**
 * Velocity threshold (px/s) above which a downward fling overrides
 * the distance-based snap and triggers dismiss / step-down. Mirrors
 * Apple's UIKit `UISheetPresentationController` heuristics.
 */
const DRAG_VELOCITY_DISMISS = 800;
/** Drag distance fraction toward the next detent that triggers a snap. */
const DRAG_DISTANCE_THRESHOLD = 0.4;
/** Past-the-lowest-detent distance (px) that triggers dismiss. */
const DRAG_DISMISS_PAST_PX = 120;

/* -- Helpers ----------------------------------------------------------- */

const parseCssLength = (raw: string, fallback: number): number => {
    if (typeof window === "undefined") return fallback;
    const trimmed = raw.trim();
    if (trimmed.endsWith("px")) {
        const n = parseFloat(trimmed);
        return Number.isFinite(n) ? n : fallback;
    }
    if (trimmed.endsWith("dvh")) {
        const n = parseFloat(trimmed);
        if (!Number.isFinite(n)) return fallback;
        return (n / 100) * window.innerHeight;
    }
    if (trimmed.endsWith("vh")) {
        const n = parseFloat(trimmed);
        if (!Number.isFinite(n)) return fallback;
        return (n / 100) * window.innerHeight;
    }
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Resolve a single CSS length value (e.g. "96px", "50dvh") against
 * the current viewport. Reads `getComputedStyle(document.documentElement)`
 * for the live value so it tracks any cssVars override (user glass
 * intensity etc.) without rebuilding the Sheet on every render.
 */
const resolveCssLength = (cssVar: string, fallback: number): number => {
    if (typeof document === "undefined") return fallback;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(cssVar)
        .trim();
    if (!raw) return fallback;
    return parseCssLength(raw, fallback);
};

/**
 * Exposed-height (px) of the surface at a given detent. The surface
 * is always 92 dvh tall (matches `large`); the translateY between
 * detents shrinks the visible portion to the configured height.
 */
const detentExposedPx = (d: SheetDetent): number => {
    switch (d) {
        case "peek":
            return resolveCssLength("--ant-detent-peek", 96);
        case "medium":
            return resolveCssLength(
                "--ant-detent-medium",
                typeof window !== "undefined" ? window.innerHeight * 0.5 : 400
            );
        case "large":
        default:
            return resolveCssLength(
                "--ant-detent-large",
                typeof window !== "undefined" ? window.innerHeight * 0.92 : 736
            );
    }
};

/* -- Styled surfaces --------------------------------------------------- */

const Scrim = styled(motion.div)`
    background: rgba(0, 0, 0, 0.4);
    inset: 0;
    position: fixed;
    z-index: ${Z_INDEX_SCRIM};
    /*
     * The scrim is decorative — role="presentation" keeps it out of
     * the a11y tree. We still register pointer-events so a click
     * dismisses (when dismissOnScrimClick is on).
     */
    @media (forced-colors: active) {
        background: rgba(0, 0, 0, 0.6);
    }
`;

const Surface = styled(motion.div)`
    background:
        var(--glass-surface, rgba(255, 255, 255, 0.7)),
        var(--page-background, #ffffff);
    backdrop-filter: var(
        --ant-backdrop-filter-glass,
        blur(20px) saturate(180%)
    );
    -webkit-backdrop-filter: var(
        --ant-backdrop-filter-glass,
        blur(20px) saturate(180%)
    );
    border-top: 1px solid var(--glass-border, rgba(15, 23, 42, 0.08));
    border-radius: ${radius.lg}px ${radius.lg}px 0 0;
    bottom: 0;
    box-shadow: var(--ant-shadow-glass-lifted, 0 -8px 24px rgba(0, 0, 0, 0.16));
    color: var(--ant-color-text, #0f172a);
    display: flex;
    flex-direction: column;
    /*
     * Surface height matches the "large" detent (92 dvh). Lower
     * detents are achieved by translating the surface downward so
     * only the configured "peek" / "medium" height remains visible.
     * Sitting the surface on "bottom: 0" and translating Y means
     * the bottom edge stays glued to the viewport bottom — the
     * Apple "card snapped to the bottom" model.
     */
    height: 92dvh;
    left: 0;
    max-height: 92dvh;
    position: fixed;
    right: 0;
    z-index: ${Z_INDEX_SURFACE};

    @media (prefers-reduced-transparency: reduce) {
        background: var(--page-background, #ffffff);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }

    @media (forced-colors: active) {
        background: Canvas;
        border-top: 1px solid CanvasText;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }
`;

const GrabberWrap = styled.div`
    align-items: center;
    cursor: grab;
    display: flex;
    flex: 0 0 auto;
    justify-content: center;
    padding: 8px 0 4px;
    touch-action: none;

    &:active {
        cursor: grabbing;
    }
`;

const GrabberPill = styled.div`
    background: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
    border-radius: 999px;
    height: 4px;
    opacity: 0.4;
    width: 36px;
`;

const HeaderRow = styled.div`
    align-items: center;
    border-bottom: 1px solid var(--glass-border, rgba(15, 23, 42, 0.08));
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    justify-content: space-between;
    padding: 8px 16px 12px;
`;

const TitleSlot = styled.div`
    flex: 1 1 auto;
    font-size: 16px;
    font-weight: 600;
    min-width: 0;
`;

const CloseButton = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    cursor: pointer;
    display: inline-flex;
    height: 32px;
    justify-content: center;
    padding: 0;
    width: 32px;

    &:hover {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04));
    }

    &:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 1px;
    }
`;

const Body = styled.div`
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 16px;
    /*
     * iOS Safari: the dvh-based height collapses to the visual
     * viewport when the URL bar is visible, so we add a safe-area
     * inset for the home indicator clearance to avoid swallowing
     * the bottom 34 pt.
     */
    padding-bottom: max(16px, env(safe-area-inset-bottom));
`;

const Footer = styled.div`
    border-top: 1px solid var(--glass-border, rgba(15, 23, 42, 0.08));
    flex: 0 0 auto;
    padding: 12px 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
`;

/* -- Internal: detent y math ------------------------------------------ */

const orderDetents = (
    enabled: readonly SheetDetent[]
): readonly SheetDetent[] => {
    // Smallest exposed-height first (peek < medium < large).
    const rank: Record<SheetDetent, number> = {
        peek: 0,
        medium: 1,
        large: 2
    };
    return [...enabled].sort((a, b) => rank[a] - rank[b]);
};

/**
 * Y translation in px the surface needs at a given detent. The
 * surface is 92 dvh tall; if the detent exposes `e` px, then we
 * translate down by (surfaceHeight - e). Negative numbers would
 * mean the surface is OFF the bottom, which we never do.
 */
const surfaceTranslateY = (d: SheetDetent, surfaceHeight: number): number =>
    Math.max(0, surfaceHeight - detentExposedPx(d));

/* -- Animated branch -------------------------------------------------- */

interface AnimatedSheetProps {
    open: boolean;
    onClose: () => void;
    detent?: SheetDetent;
    defaultDetent: SheetDetent;
    onDetentChange?: (next: SheetDetent) => void;
    detents: readonly SheetDetent[];
    title?: React.ReactNode;
    footer?: React.ReactNode;
    closable: boolean;
    mask: boolean;
    maskClosable: boolean;
    dismissOnScrimClick?: boolean;
    showGrabber: boolean;
    dataTestid?: string;
    ariaLabelledBy?: string;
    rootClassName?: string;
    bodyStyles?: React.CSSProperties;
    children: React.ReactNode;
}

const AnimatedSheet: React.FC<AnimatedSheetProps> = ({
    open,
    onClose,
    detent,
    defaultDetent,
    onDetentChange,
    detents,
    title,
    footer,
    closable,
    mask,
    maskClosable,
    dismissOnScrimClick,
    showGrabber,
    dataTestid,
    ariaLabelledBy,
    rootClassName,
    bodyStyles,
    children
}) => {
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const [internalDetent, setInternalDetent] =
        useState<SheetDetent>(defaultDetent);
    const activeDetent = detent ?? internalDetent;

    // Surface height in px (resolved against the live viewport so the
    // dvh CSS var dance survives the iOS URL-bar collapse). Updated
    // on mount + on window resize.
    const [surfaceHeight, setSurfaceHeight] = useState<number>(() =>
        typeof window !== "undefined" ? window.innerHeight * 0.92 : 736
    );

    useLayoutEffect(() => {
        const update = () => {
            setSurfaceHeight(
                resolveCssLength(
                    "--ant-detent-large",
                    typeof window !== "undefined"
                        ? window.innerHeight * 0.92
                        : 736
                )
            );
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const orderedDetents = useMemo(
        () => orderDetents(detents.length > 0 ? detents : DEFAULT_DETENTS),
        [detents]
    );

    // Y translation at the active detent.
    const activeY = useMemo(
        () => surfaceTranslateY(activeDetent, surfaceHeight),
        [activeDetent, surfaceHeight]
    );

    const dragControls = useDragControls();

    // Esc-to-close — single window listener while open.
    useEffect(() => {
        if (!open) return;
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [open, onClose]);

    // Focus trap — only active while the surface is mounted (open).
    useFocusTrap(surfaceRef, open);

    const setDetent = useCallback(
        (next: SheetDetent) => {
            if (next === activeDetent) return;
            if (detent === undefined) setInternalDetent(next);
            onDetentChange?.(next);
        },
        [activeDetent, detent, onDetentChange]
    );

    /**
     * Decide what to do at drag-end:
     *   - Big downward velocity → dismiss / step-down.
     *   - Small downward motion (< threshold) → snap back.
     *   - Crossing a detent gap by ≥ 40% → snap to that detent.
     *   - Past lowest detent by ≥ 120 px → dismiss.
     */
    const handleDragEnd = useCallback(
        (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
            const dragOffsetPx = info.offset.y; // positive = downward
            const velocityPx = info.velocity.y;
            const currentIdx = orderedDetents.indexOf(activeDetent);
            const isLowest = currentIdx <= 0;
            const isHighest = currentIdx >= orderedDetents.length - 1;

            // Velocity override — fling downward past 800 px/s.
            if (velocityPx > DRAG_VELOCITY_DISMISS) {
                if (isLowest) {
                    onClose();
                    return;
                }
                setDetent(orderedDetents[currentIdx - 1]);
                return;
            }
            // Velocity override — fling upward.
            if (velocityPx < -DRAG_VELOCITY_DISMISS && !isHighest) {
                setDetent(orderedDetents[currentIdx + 1]);
                return;
            }

            if (dragOffsetPx > 0) {
                // Downward drag.
                if (isLowest) {
                    if (dragOffsetPx > DRAG_DISMISS_PAST_PX) {
                        onClose();
                        return;
                    }
                    // Snap back to current.
                    return;
                }
                const nextLower = orderedDetents[currentIdx - 1];
                const gap =
                    surfaceTranslateY(nextLower, surfaceHeight) - activeY;
                if (gap > 0 && dragOffsetPx > gap * DRAG_DISTANCE_THRESHOLD) {
                    setDetent(nextLower);
                }
                return;
            }

            if (dragOffsetPx < 0) {
                // Upward drag.
                if (isHighest) return;
                const nextHigher = orderedDetents[currentIdx + 1];
                const gap =
                    activeY - surfaceTranslateY(nextHigher, surfaceHeight);
                if (
                    gap > 0 &&
                    Math.abs(dragOffsetPx) > gap * DRAG_DISTANCE_THRESHOLD
                ) {
                    setDetent(nextHigher);
                }
            }
        },
        [
            activeDetent,
            activeY,
            onClose,
            orderedDetents,
            setDetent,
            surfaceHeight
        ]
    );

    const handleScrimClick = useCallback(() => {
        const allowDismiss = dismissOnScrimClick ?? maskClosable;
        if (allowDismiss) onClose();
    }, [dismissOnScrimClick, maskClosable, onClose]);

    const startDrag = useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            dragControls.start(event, { snapToCursor: false });
        },
        [dragControls]
    );

    const fallbackLabelId = useId();
    const labelledById =
        ariaLabelledBy ?? (title ? fallbackLabelId : undefined);

    // SSR / jsdom guard — `document.body` exists in jsdom, but bail
    // anyway if the import lands in a non-DOM environment.
    if (typeof document === "undefined") return null;

    return createPortal(
        <AnimatePresence>
            {open ? (
                <div className={rootClassName} data-testid={dataTestid}>
                    {mask ? (
                        <Scrim
                            data-testid={
                                dataTestid
                                    ? `${dataTestid}-scrim`
                                    : "sheet-scrim"
                            }
                            role="presentation"
                            onClick={handleScrimClick}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{
                                duration: SCRIM_DURATION_S,
                                ease: DETENT_EASE
                            }}
                        />
                    ) : null}
                    <Surface
                        ref={surfaceRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={labelledById}
                        data-testid={
                            dataTestid
                                ? `${dataTestid}-surface`
                                : "sheet-surface"
                        }
                        data-detent={activeDetent}
                        tabIndex={-1}
                        drag="y"
                        dragControls={dragControls}
                        dragListener={false}
                        dragConstraints={{ top: 0, bottom: surfaceHeight }}
                        dragElastic={0.1}
                        onDragEnd={handleDragEnd}
                        initial={{ y: surfaceHeight }}
                        animate={{ y: activeY }}
                        exit={{ y: surfaceHeight }}
                        transition={{
                            duration: SNAP_DURATION_S,
                            ease: DETENT_EASE
                        }}
                    >
                        {showGrabber ? (
                            <GrabberWrap
                                data-testid={
                                    dataTestid
                                        ? `${dataTestid}-grabber`
                                        : "sheet-grabber"
                                }
                                onPointerDown={startDrag}
                                role="separator"
                                aria-orientation="horizontal"
                                aria-label="Drag to resize"
                            >
                                <GrabberPill aria-hidden="true" />
                            </GrabberWrap>
                        ) : null}
                        {title || closable ? (
                            <HeaderRow>
                                <TitleSlot id={labelledById}>{title}</TitleSlot>
                                {closable ? (
                                    <CloseButton
                                        aria-label="Close"
                                        data-testid={
                                            dataTestid
                                                ? `${dataTestid}-close`
                                                : "sheet-close"
                                        }
                                        onClick={onClose}
                                        type="button"
                                    >
                                        <svg
                                            aria-hidden="true"
                                            fill="none"
                                            height="14"
                                            stroke="currentColor"
                                            strokeLinecap="round"
                                            strokeWidth="2"
                                            viewBox="0 0 14 14"
                                            width="14"
                                        >
                                            <path d="M2 2 L12 12 M12 2 L2 12" />
                                        </svg>
                                    </CloseButton>
                                ) : null}
                            </HeaderRow>
                        ) : null}
                        <Body
                            data-testid={
                                dataTestid ? `${dataTestid}-body` : "sheet-body"
                            }
                            style={bodyStyles}
                        >
                            {children}
                        </Body>
                        {footer ? <Footer>{footer}</Footer> : null}
                    </Surface>
                </div>
            ) : null}
        </AnimatePresence>,
        document.body
    );
};

/* -- Component --------------------------------------------------------- */

const Sheet: React.FC<SheetProps> = ({
    open,
    onClose,
    detent,
    defaultDetent = "medium",
    onDetentChange,
    detents = DEFAULT_DETENTS,
    title,
    children,
    footer,
    closable = true,
    mask = true,
    maskClosable = true,
    dismissOnScrimClick,
    showGrabber = true,
    desktopPlacement = "right",
    desktopSize = "default",
    "data-testid": dataTestid,
    "aria-labelledby": ariaLabelledByProp,
    ariaLabelledBy,
    rootClassName,
    styles,
    forceDrawerFallback = false
}) => {
    const isPhone = useIsPhoneChrome();
    const reducedMotion = useReducedMotion();
    const useAnimatedBranch = isPhone && !reducedMotion && !forceDrawerFallback;

    if (!useAnimatedBranch) {
        const placement = isPhone ? "bottom" : desktopPlacement;
        return (
            <Drawer
                closable={closable}
                mask={mask}
                maskClosable={maskClosable}
                onClose={onClose}
                open={open}
                placement={placement}
                rootClassName={rootClassName}
                size={desktopSize}
                styles={styles}
                title={title}
                footer={footer}
                data-testid={dataTestid}
            >
                {children}
            </Drawer>
        );
    }

    // -- Branch 1: animated multi-detent surface ----------------------
    return (
        <AnimatedSheet
            open={open}
            onClose={onClose}
            detent={detent}
            defaultDetent={defaultDetent}
            onDetentChange={onDetentChange}
            detents={detents}
            title={title}
            footer={footer}
            closable={closable}
            mask={mask}
            maskClosable={maskClosable}
            dismissOnScrimClick={dismissOnScrimClick}
            showGrabber={showGrabber}
            dataTestid={dataTestid}
            ariaLabelledBy={ariaLabelledByProp ?? ariaLabelledBy}
            rootClassName={rootClassName}
            bodyStyles={styles?.body}
        >
            {children}
        </AnimatedSheet>
    );
};

export { Sheet };
export default Sheet;
