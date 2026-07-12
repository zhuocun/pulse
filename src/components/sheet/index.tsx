import { X } from "lucide-react";
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

import {
    Sheet as UISheet,
    SheetClose as UISheetClose,
    SheetContent as UISheetContent,
    SheetFooter as UISheetFooter,
    SheetHeader as UISheetHeader,
    SheetTitle as UISheetTitle
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

import useFocusTrap from "./useFocusTrap";

/**
 * Multi-detent bottom Sheet primitive.
 *
 * Wraps three rendering branches behind a single React API:
 *
 *   1. Phone + motion-enabled → portal'd surface with three snap detents
 *      (peek / medium / large), a grabber handle, a scrim, drag-to-dismiss,
 *      Esc-to-close, and a focus trap that restores focus on unmount. The
 *      surface positions itself with a CSS `translateY` transform and
 *      animates snap transitions with a token-timed CSS transition; the
 *      scrim fades in via `tailwindcss-animate` (`animate-in fade-in-0`).
 *      No `framer-motion`.
 *
 *   2. Phone + prefers-reduced-motion → the shadcn `<Sheet side="bottom">`
 *      fallback. Radix owns chrome, focus trap, and scrim. No grabber, no
 *      detent UI.
 *
 *   3. Desktop / tablet / `forceDrawerFallback` → the shadcn `<Sheet>` with
 *      the consumer-supplied `desktopPlacement` (right by default). Same
 *      content, no animated branch.
 *
 * Detent geometry consumes the `--pulse-detent-*` CSS vars — `peek=96px`,
 * `medium=50dvh`, `large=92dvh`. Reading the vars at runtime keeps the
 * source of truth in the cssVars layer.
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
    /** Accessible name for the close affordance. Defaults to localized "Close". */
    closeAriaLabel?: string;
    /** Render the scrim behind the sheet. Default `true`. */
    mask?: boolean;
    /**
     * Whether clicking the scrim dismisses the sheet. Default `true`.
     * The shadcn `<Sheet>` fallback calls this behavior "interact
     * outside"; we accept both names.
     */
    maskClosable?: boolean;
    dismissOnScrimClick?: boolean;

    /** Default `true` on the animated branch. Ignored elsewhere. */
    showGrabber?: boolean;

    /** Used by the desktop / fallback `<Sheet>`. Default `right`. */
    desktopPlacement?: "right" | "bottom";
    /**
     * Legacy AntD `<Drawer>` `size` pass-through. Retained for API
     * compatibility but no longer drives width — the shadcn `<Sheet>`
     * fallback owns a fixed edge width.
     */
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

    /** Mirror the `<Sheet>` body slot. */
    styles?: {
        body?: React.CSSProperties;
    };

    /** Escape hatch — render the shadcn `<Sheet>` fallback unconditionally. */
    forceDrawerFallback?: boolean;
}

/* -- Constants --------------------------------------------------------- */

const DEFAULT_DETENTS: readonly SheetDetent[] = ["medium", "large"];
/** Snap transition duration (ms) — mirrors `motion.detentSnap`. */
const SNAP_DURATION_MS = 360;
/** Sheet snap curve — mirrors `easing.detent`. */
const DETENT_EASE_CSS = "cubic-bezier(0.32, 0.72, 0, 1)";
/**
 * Velocity threshold (px/s) above which a downward fling overrides
 * the distance-based snap and triggers dismiss / step-down.
 */
const DRAG_VELOCITY_DISMISS = 800;
/** Drag distance fraction toward the next detent that triggers a snap. */
const DRAG_DISTANCE_THRESHOLD = 0.4;
/** Past-the-lowest-detent distance (px) that triggers dismiss. */
const DRAG_DISMISS_PAST_PX = 120;

const isVisibleFocusTarget = (element: HTMLElement): boolean => {
    if (
        !element.isConnected ||
        element.hidden ||
        element.closest('[hidden], [aria-hidden="true"], [inert]')
    ) {
        return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
};

const useFallbackFocusRestore = (enabled: boolean, open: boolean) => {
    const openerRef = useRef<HTMLElement | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const wasOpenRef = useRef(false);
    const restoreEligibleRef = useRef(false);
    const restoreQueuedRef = useRef(false);

    if (
        enabled &&
        open &&
        !wasOpenRef.current &&
        typeof document !== "undefined" &&
        typeof HTMLElement !== "undefined"
    ) {
        const active = document.activeElement;
        openerRef.current =
            active instanceof HTMLElement && active !== document.body
                ? active
                : null;
        restoreEligibleRef.current = true;
        wasOpenRef.current = true;
    }

    const markRestoreEligibility = useCallback(() => {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        restoreEligibleRef.current =
            !(active instanceof HTMLElement) ||
            active === document.body ||
            Boolean(surfaceRef.current?.contains(active));
    }, []);

    const scheduleRestore = useCallback(() => {
        if (
            typeof document === "undefined" ||
            typeof window === "undefined" ||
            !restoreEligibleRef.current ||
            !openerRef.current ||
            restoreQueuedRef.current
        ) {
            return;
        }

        const opener = openerRef.current;
        const surface = surfaceRef.current;
        const active = document.activeElement;
        if (
            active instanceof HTMLElement &&
            active !== document.body &&
            !surface?.contains(active)
        ) {
            restoreEligibleRef.current = false;
            openerRef.current = null;
            return;
        }

        restoreQueuedRef.current = true;
        window.queueMicrotask(() => {
            restoreQueuedRef.current = false;
            const current = document.activeElement;
            if (
                current instanceof HTMLElement &&
                current !== document.body &&
                !surface?.contains(current)
            ) {
                restoreEligibleRef.current = false;
                openerRef.current = null;
                return;
            }
            if (
                surface?.isConnected &&
                surface.getAttribute("data-state") === "open"
            ) {
                return;
            }
            if (isVisibleFocusTarget(opener)) {
                opener.focus({ preventScroll: true });
            }
            restoreEligibleRef.current = false;
            openerRef.current = null;
        });
    }, []);

    useEffect(
        () => () => {
            if (!enabled || !wasOpenRef.current) return;
            markRestoreEligibility();
            scheduleRestore();
        },
        [enabled, markRestoreEligibility, scheduleRestore]
    );

    useEffect(() => {
        if (!enabled || open) return;
        wasOpenRef.current = false;
    }, [enabled, open]);

    const setSurfaceRef = useCallback((node: HTMLDivElement | null) => {
        if (node) surfaceRef.current = node;
    }, []);

    const handleCloseAutoFocus = useCallback(
        (event: Event) => {
            event.preventDefault();
            markRestoreEligibility();
            scheduleRestore();
        },
        [markRestoreEligibility, scheduleRestore]
    );

    return {
        handleCloseAutoFocus,
        markRestoreEligibility,
        setSurfaceRef
    };
};

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
            return resolveCssLength("--pulse-detent-peek", 96);
        case "medium":
            return resolveCssLength(
                "--pulse-detent-medium",
                typeof window !== "undefined" ? window.innerHeight * 0.5 : 400
            );
        case "large":
        default:
            return resolveCssLength(
                "--pulse-detent-large",
                typeof window !== "undefined" ? window.innerHeight * 0.92 : 736
            );
    }
};

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

/* -- Drag-end decision helper ----------------------------------------- */

/**
 * Inputs the drag-end decision needs. The component supplies these from
 * the live pointer gesture + the ordered detent list it already
 * memoizes; the helper is otherwise pure so it can be unit-tested
 * without standing up a DOM or a pointer-event harness (jsdom can't run
 * a real pointer drag).
 *
 * `detentOffsetsPx` is the y-translation each detent in `orderedDetents`
 * sits at — index-aligned. This shape avoids re-computing
 * `surfaceTranslateY` inside the helper and keeps the threshold math
 * exclusively pixel-space.
 */
export interface DragEndDecisionInput {
    currentDetent: SheetDetent;
    orderedDetents: readonly SheetDetent[];
    /** y-translation (px) for each detent at the same index. */
    detentOffsetsPx: readonly number[];
    /** Drag offset y (px). Positive = downward (closer to dismiss). */
    dragOffsetPx: number;
    /** Pointer velocity y (px/s). Positive = downward. */
    velocityPx: number;
}

export type DragEndDecision =
    { kind: "snap"; to: SheetDetent } | { kind: "dismiss" };

/**
 * Pure decision function for drag-end. Returns `dismiss` when the
 * user has flung past the lowest detent (or > 120px past it with no
 * lower neighbour), otherwise the detent we should snap to. The
 * caller is responsible for invoking `setDetent` or `onClose`.
 *
 * Branches in priority order:
 *  1. Downward velocity > 800 px/s → dismiss-if-lowest or step-down.
 *  2. Upward velocity > 800 px/s → step-up (no-op if already highest).
 *  3. Downward drag past lowest detent by ≥ 120 px → dismiss.
 *  4. Downward drag ≥ 40% of gap to the next-lower detent → snap down.
 *  5. Upward drag ≥ 40% of gap to the next-higher detent → snap up.
 *  6. Otherwise → snap back to current detent.
 */
export const decideDragEnd = (input: DragEndDecisionInput): DragEndDecision => {
    const {
        currentDetent,
        orderedDetents,
        detentOffsetsPx,
        dragOffsetPx,
        velocityPx
    } = input;
    const currentIdx = orderedDetents.indexOf(currentDetent);
    const isLowest = currentIdx <= 0;
    const isHighest = currentIdx >= orderedDetents.length - 1;

    // Velocity override — fling downward past 800 px/s.
    if (velocityPx > DRAG_VELOCITY_DISMISS) {
        if (isLowest) return { kind: "dismiss" };
        return { kind: "snap", to: orderedDetents[currentIdx - 1] };
    }
    // Velocity override — fling upward.
    if (velocityPx < -DRAG_VELOCITY_DISMISS && !isHighest) {
        return { kind: "snap", to: orderedDetents[currentIdx + 1] };
    }

    if (dragOffsetPx > 0) {
        // Downward drag.
        if (isLowest) {
            if (dragOffsetPx > DRAG_DISMISS_PAST_PX) {
                return { kind: "dismiss" };
            }
            return { kind: "snap", to: currentDetent };
        }
        const nextLower = orderedDetents[currentIdx - 1];
        const gap =
            detentOffsetsPx[currentIdx - 1] - detentOffsetsPx[currentIdx];
        if (gap > 0 && dragOffsetPx > gap * DRAG_DISTANCE_THRESHOLD) {
            return { kind: "snap", to: nextLower };
        }
        return { kind: "snap", to: currentDetent };
    }

    if (dragOffsetPx < 0) {
        // Upward drag.
        if (isHighest) return { kind: "snap", to: currentDetent };
        const nextHigher = orderedDetents[currentIdx + 1];
        const gap =
            detentOffsetsPx[currentIdx] - detentOffsetsPx[currentIdx + 1];
        if (gap > 0 && Math.abs(dragOffsetPx) > gap * DRAG_DISTANCE_THRESHOLD) {
            return { kind: "snap", to: nextHigher };
        }
    }

    return { kind: "snap", to: currentDetent };
};

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
    closeAriaLabel: string;
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

interface DragState {
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
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
    closeAriaLabel,
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

    // Slide-up-on-mount: start fully off-screen, flip to the active
    // detent on the next frame so the CSS transition animates the
    // entrance without framer-motion's AnimatePresence.
    const [entered, setEntered] = useState(false);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStateRef = useRef<DragState | null>(null);

    useLayoutEffect(() => {
        const update = () => {
            setSurfaceHeight(
                resolveCssLength(
                    "--pulse-detent-large",
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

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(raf);
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

    const handleScrimClick = useCallback(() => {
        const allowDismiss = dismissOnScrimClick ?? maskClosable;
        if (allowDismiss) onClose();
    }, [dismissOnScrimClick, maskClosable, onClose]);

    /**
     * Lightweight pointer drag on the grabber (framer-motion's
     * `useDragControls` replacement). Tracks the live offset for the
     * transform and estimates release velocity from the last sample so
     * `decideDragEnd` — the same pure helper the unit tests exercise —
     * makes the snap/dismiss call.
     */
    const startDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragStateRef.current = {
            startY: event.clientY,
            lastY: event.clientY,
            lastT: event.timeStamp,
            velocity: 0
        };
        setIsDragging(true);
    }, []);

    const moveDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const dt = event.timeStamp - drag.lastT;
        if (dt > 0) {
            drag.velocity = ((event.clientY - drag.lastY) / dt) * 1000;
        }
        drag.lastY = event.clientY;
        drag.lastT = event.timeStamp;
        setDragOffset(event.clientY - drag.startY);
    }, []);

    const endDrag = useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            const drag = dragStateRef.current;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            dragStateRef.current = null;
            setIsDragging(false);
            const offset = dragOffset;
            setDragOffset(0);
            if (!drag) return;
            const detentOffsetsPx = orderedDetents.map((d) =>
                surfaceTranslateY(d, surfaceHeight)
            );
            const decision = decideDragEnd({
                currentDetent: activeDetent,
                orderedDetents,
                detentOffsetsPx,
                dragOffsetPx: offset,
                velocityPx: drag.velocity
            });
            if (decision.kind === "dismiss") {
                onClose();
                return;
            }
            if (decision.to !== activeDetent) setDetent(decision.to);
        },
        [
            activeDetent,
            dragOffset,
            onClose,
            orderedDetents,
            setDetent,
            surfaceHeight
        ]
    );

    const fallbackLabelId = useId();
    const labelledById =
        ariaLabelledBy ?? (title ? fallbackLabelId : undefined);

    // SSR / jsdom guard — `document.body` exists in jsdom, but bail
    // anyway if the import lands in a non-DOM environment.
    if (typeof document === "undefined") return null;
    if (!open) return null;

    const translateY = isDragging
        ? Math.min(surfaceHeight, Math.max(0, activeY + dragOffset))
        : entered
          ? activeY
          : surfaceHeight;

    return createPortal(
        <div className={rootClassName} data-testid={dataTestid}>
            {mask ? (
                <div
                    className="fixed inset-0 z-[1000] bg-black/40 animate-in fade-in-0 forced-colors:bg-black/60"
                    data-testid={
                        dataTestid ? `${dataTestid}-scrim` : "sheet-scrim"
                    }
                    onClick={handleScrimClick}
                    role="presentation"
                />
            ) : null}
            <div
                aria-labelledby={labelledById}
                aria-modal="true"
                className="fixed inset-x-0 bottom-0 z-[1001] flex h-[92dvh] max-h-[92dvh] flex-col rounded-t-lg border-t border-glass-border bg-page text-page-text shadow-2xl forced-colors:bg-[Canvas]"
                data-detent={activeDetent}
                data-testid={
                    dataTestid ? `${dataTestid}-surface` : "sheet-surface"
                }
                ref={surfaceRef}
                role="dialog"
                style={{
                    transform: `translateY(${translateY}px)`,
                    transition: isDragging
                        ? "none"
                        : `transform ${SNAP_DURATION_MS}ms ${DETENT_EASE_CSS}`
                }}
                tabIndex={-1}
            >
                {showGrabber ? (
                    <div
                        aria-hidden="true"
                        className="flex flex-none cursor-grab touch-none items-center justify-center pb-1 pt-xs active:cursor-grabbing coarse:min-h-[44px]"
                        data-testid={
                            dataTestid
                                ? `${dataTestid}-grabber`
                                : "sheet-grabber"
                        }
                        onPointerCancel={endDrag}
                        onPointerDown={startDrag}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                    >
                        <div className="h-1 w-9 rounded-full bg-muted-foreground/40" />
                    </div>
                ) : null}
                {title || closable ? (
                    <div className="flex flex-none items-center justify-between gap-xs border-b border-glass-border px-md pb-sm pt-xs">
                        {/*
                         * Only stamp the resolved labelled-by id on the
                         * title wrapper when the consumer did NOT supply
                         * their own. If they did, their inner heading
                         * already carries the id — reusing it would
                         * produce a duplicate id in the DOM and fail axe.
                         */}
                        <div
                            className="min-w-0 flex-1 text-md font-semibold"
                            id={
                                ariaLabelledBy === undefined
                                    ? labelledById
                                    : undefined
                            }
                        >
                            {title}
                        </div>
                        {closable ? (
                            <button
                                aria-label={closeAriaLabel}
                                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary coarse:size-11 coarse:min-h-[44px] coarse:min-w-[44px]"
                                data-testid={
                                    dataTestid
                                        ? `${dataTestid}-close`
                                        : "sheet-close"
                                }
                                onClick={onClose}
                                type="button"
                            >
                                <X aria-hidden className="size-3.5" />
                            </button>
                        ) : null}
                    </div>
                ) : null}
                <div
                    className="flex-1 overflow-y-auto overscroll-contain p-md [padding-bottom:max(theme(spacing.md),env(safe-area-inset-bottom),env(keyboard-inset-height,0px))]"
                    data-testid={
                        dataTestid ? `${dataTestid}-body` : "sheet-body"
                    }
                    style={bodyStyles}
                >
                    {children}
                </div>
                {footer ? (
                    <div className="flex-none border-t border-glass-border px-md py-sm [padding-bottom:max(theme(spacing.sm),env(safe-area-inset-bottom))]">
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>,
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
    closeAriaLabel,
    mask = true,
    maskClosable = true,
    dismissOnScrimClick,
    showGrabber = true,
    desktopPlacement = "right",
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
    const fallbackFocusRestore = useFallbackFocusRestore(
        !useAnimatedBranch,
        open
    );
    const resolvedCloseAriaLabel =
        closeAriaLabel ?? microcopyString(microcopy.actions.close);

    if (!useAnimatedBranch) {
        const side = isPhone ? "bottom" : desktopPlacement;
        const resolvedAriaLabelledBy = ariaLabelledByProp ?? ariaLabelledBy;
        // Only forward `aria-labelledby` when the caller supplied one —
        // passing `undefined` would clobber Radix's automatic association
        // with the rendered <SheetTitle>, leaving the dialog unnamed.
        const labelledByProps = resolvedAriaLabelledBy
            ? { "aria-labelledby": resolvedAriaLabelledBy }
            : {};
        return (
            <UISheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) {
                        fallbackFocusRestore.markRestoreEligibility();
                        onClose();
                    }
                }}
            >
                <UISheetContent
                    {...labelledByProps}
                    className={cn("flex flex-col gap-0 p-0", rootClassName)}
                    data-testid={dataTestid}
                    hideClose
                    onCloseAutoFocus={fallbackFocusRestore.handleCloseAutoFocus}
                    // `maskClosable=false` mirrors AntD's masked-but-not-
                    // dismissible drawer: block scrim / outside-click close
                    // while Escape and the close button still dismiss.
                    onInteractOutside={
                        maskClosable
                            ? undefined
                            : (event) => event.preventDefault()
                    }
                    ref={fallbackFocusRestore.setSurfaceRef}
                    side={side}
                >
                    {title ? (
                        <UISheetHeader className="border-b border-border px-lg py-md">
                            <UISheetTitle>{title}</UISheetTitle>
                        </UISheetHeader>
                    ) : null}
                    <div
                        className="flex-1 overflow-y-auto p-lg"
                        style={styles?.body}
                    >
                        {children}
                    </div>
                    {footer ? (
                        <UISheetFooter className="border-t border-border px-lg py-md">
                            {footer}
                        </UISheetFooter>
                    ) : null}
                    {closable ? (
                        <UISheetClose
                            aria-label={resolvedCloseAriaLabel}
                            className="absolute right-md top-md inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring coarse:size-11"
                        >
                            <X aria-hidden className="size-4" />
                        </UISheetClose>
                    ) : null}
                </UISheetContent>
            </UISheet>
        );
    }

    // -- Branch 1: animated multi-detent surface ----------------------
    return (
        <AnimatedSheet
            ariaLabelledBy={ariaLabelledByProp ?? ariaLabelledBy}
            bodyStyles={styles?.body}
            closable={closable}
            closeAriaLabel={resolvedCloseAriaLabel}
            dataTestid={dataTestid}
            defaultDetent={defaultDetent}
            detent={detent}
            detents={detents}
            dismissOnScrimClick={dismissOnScrimClick}
            footer={footer}
            mask={mask}
            maskClosable={maskClosable}
            onClose={onClose}
            onDetentChange={onDetentChange}
            open={open}
            rootClassName={rootClassName}
            showGrabber={showGrabber}
            title={title}
        >
            {children}
        </AnimatedSheet>
    );
};

export { Sheet };
export default Sheet;
