import {
    Alert,
    App,
    Button,
    Drawer,
    Form,
    Grid,
    Input,
    Modal,
    Select,
    Space,
    Spin,
    Tag,
    Typography
} from "antd";
import { useForm } from "antd/lib/form/Form";
import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useBlocker, useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    radius,
    space
} from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useMembersList from "../../utils/hooks/useMembersList";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useReactQuery from "../../utils/hooks/useReactQuery";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import useTaskPanelSiblings from "../../utils/hooks/useTaskPanelSiblings";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
import ErrorBox from "../errorBox";

/*
 * Routed inline task panel — Phase 3 A2. Mirrors the form body of
 * `TaskModal` but lives at a route (`/projects/:projectId/board/task/
 * :taskId`) so browser back, iOS swipe-back, deep links, and "Open in
 * new tab" all work first-class. Shipping behind
 * `environment.taskPanelRouted` until validated; once flipped, a
 * follow-up PR migrates the remaining callsites and removes the modal
 * surface. The form body is intentionally a copy-paste of
 * `TaskModal`'s body — the chrome diverges (Drawer vs Modal, dirty-
 * state guard via `useBlocker`, no portal mount cost on every paint)
 * and trying to share fragments now would couple two surfaces that
 * are about to merge anyway.
 *
 * Three chassis modes:
 *   - Phone (coarse pointer): bottom-sheet via AntD `Drawer`.
 *   - Tablet (md/lg-but-fine-pointer): right-overlay via AntD `Drawer`.
 *   - Desktop (>= lg + fine pointer): docked 480px right rail with no
 *     mask, no overlay, no Drawer chrome. The kanban columns reflow
 *     because `BoardRouteShell` (`src/routes/index.tsx`) renders this
 *     panel as a flex sibling to `BoardPage`; the rail consumes its
 *     480px and the board takes the remaining viewport. No URL matching
 *     or grid-width trimming happens — the flex shell does the work.
 *
 * See `docs/design/ui-ux-comprehensive-review-2026-05.md` §A2.
 */

// Width of the desktop docked rail (Phase 3 A2 spec — Line 23 + 171).
const DESKTOP_RAIL_WIDTH_PX = 480;

// Horizontal swipe threshold for next/prev navigation. 50 px is the
// minimum cleanly-distinguishable swipe on a thumbboard; anything
// shorter would conflict with vertical scroll gestures inside the
// long-note textarea.
const SWIPE_THRESHOLD_PX = 50;
// Vertical-to-horizontal slop ratio that disqualifies a gesture as a
// swipe. If the user's finger moves more than half as much vertically
// as horizontally, the gesture is scroll-not-swipe.
const SWIPE_VERTICAL_TOLERANCE = 0.5;
// Edge-from-screen guard for the swipe-between-tasks gesture (R-B L).
// iOS Safari fires its native swipe-back on touches that originate
// within the leftmost ~20 px of the viewport; the equivalent forward
// gesture lives on the right edge. PointerEvents reach the page
// alongside (or just before) the system gesture's commit, so without
// this guard a forward iOS swipe-back also reads as a left-swipe →
// next-task on our side and the user navigates twice. Skipping the
// gesture when the pointerdown origin is within the edge band lets the
// browser's chrome own that interaction entirely.
const SWIPE_EDGE_GUARD_PX = 20;

// Replaces lodash/isEqual for the panel's diff check. Matches the same
// shallow comparison logic as `TaskModal` (same ITask shape).
function shallowEqual<T>(a: T, b: T): boolean {
    if (a === b) return true;
    if (
        a === null ||
        b === null ||
        typeof a !== "object" ||
        typeof b !== "object"
    ) {
        return false;
    }
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        const va = (a as Record<string, unknown>)[k];
        const vb = (b as Record<string, unknown>)[k];
        if (Array.isArray(va) && Array.isArray(vb)) {
            if (va.length !== vb.length) return false;
            for (let i = 0; i < va.length; i++)
                if (va[i] !== vb[i]) return false;
        } else if (va !== vb) {
            return false;
        }
    }
    return true;
}

const TASK_TYPE_OPTIONS = [
    { label: microcopy.options.taskTypes.task, value: "Task" },
    { label: microcopy.options.taskTypes.bug, value: "Bug" }
];

const STORY_POINT_OPTIONS = [1, 2, 3, 5, 8, 13].map((value) => ({
    label: `${value}`,
    value
}));

type TaskPanelField =
    | "coordinatorId"
    | "epic"
    | "note"
    | "storyPoints"
    | "taskName"
    | "type";

const TASK_PANEL_FIELDS: readonly TaskPanelField[] = [
    "taskName",
    "note",
    "type",
    "epic",
    "coordinatorId",
    "storyPoints"
];

const isTaskPanelField = (field: string): field is TaskPanelField =>
    TASK_PANEL_FIELDS.includes(field as TaskPanelField);

interface TaskDetailPanelProps {
    projectId: string;
    taskId: string;
    boardAiOn?: boolean;
}

/**
 * Honors `prefers-reduced-motion: reduce` for the drawer entry. AntD
 * Drawer's motion is driven by `rc-motion`; passing `motion={null}` and
 * `maskMotion={null}` removes the transition entirely. We don't import
 * `rc-motion` types here — `motion={null}` is a documented escape
 * hatch.
 *
 * Also gates the swipe-to-next animation. When the user has reduced
 * motion enabled, the swipe still navigates but skips any cosmetic
 * easing.
 */
const usePrefersReducedMotion = (): boolean => {
    const [reduced, setReduced] = useState<boolean>(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return false;
        }
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    });

    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const handler = (event: MediaQueryListEvent) =>
            setReduced(event.matches);
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        media.addListener(handler);
        return () => media.removeListener(handler);
    }, []);

    return reduced;
};

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
    projectId,
    taskId,
    boardAiOn = true
}) => {
    // AntD v6: static `message` warns about dynamic theme;
    // `App.useApp()` returns a theme-aware instance.
    const { message } = App.useApp();
    const [form] = useForm();
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const isPhone = useIsPhoneChrome();
    const prefersReducedMotion = usePrefersReducedMotion();
    const screens = Grid.useBreakpoint();
    /*
     * Three chassis modes — see the file header. Desktop docked rail
     * only fires when (a) the user is on a fine pointer (NOT phone)
     * AND (b) the viewport is >= lg per AntD's breakpoint hook. Phone
     * always wins regardless of width because a touchscreen laptop
     * still wants the bottom-sheet (B-H1).
     */
    const isDesktopRail = !isPhone && screens.lg === true;
    /*
     * Rail focus management (R-B H1). The AntD Drawer used by the
     * phone/tablet chassis handles focus trap + restore on its own; the
     * desktop rail is a plain `<aside>` so we wire equivalent SR/keyboard
     * affordances by hand. On mount we capture the previously-focused
     * element, then move focus into the aside so screen readers announce
     * the panel landmark; on unmount we restore focus to that element so
     * keyboard users land back on the column card that opened the task.
     */
    const asideRef = useRef<HTMLElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const [formTick, setFormTick] = useState(0);
    const [saveError, setSaveError] = useState<Error | null>(null);
    const [appliedFieldOrigin, setAppliedFieldOrigin] = useState<
        Partial<Record<TaskPanelField, "copilot">>
    >({});

    // Read the task list from the SAME cache key the board page uses
    // (`useReactQuery<ITask[]>("tasks", { projectId })`), so the panel
    // can render off an existing fetch when the user opens it from the
    // board, and triggers a fresh fetch when the URL is opened directly.
    const { data: tasks } = useReactQuery<ITask[]>("tasks", {
        projectId
    });

    const editingTask = tasks?.find((task) => task._id === taskId);
    const tasksStillLoading = tasks === undefined;
    const placeholderId = Boolean(taskId && isOptimisticPlaceholderId(taskId));

    /*
     * Same after-load missing-task semantics as `TaskModal`: when the
     * underlying task disappears from the resolved list while the user
     * has unsaved edits, keep the panel open with a non-dismissable
     * banner instead of silently closing and `resetFields`-ing the
     * dirty payload. Bug 3 in
     * `docs/design/ui-ux-comprehensive-review-2026-05.md` §"Critical
     * bugs that ship today" — preserved here so the routed surface
     * doesn't regress the fix the modal already ships.
     */
    const taskMissingAfterLoad =
        Boolean(taskId) && !placeholderId && !tasksStillLoading && !editingTask;
    const awaitingTaskResolution =
        Boolean(taskId) && !placeholderId && tasksStillLoading;

    const { mutateAsync: update, isLoading: uLoading } = useReactMutation(
        "tasks",
        "PUT",
        ["tasks", { projectId }],
        undefined,
        (err) => setSaveError(err)
    );
    const { mutate: remove, isLoading: dLoading } = useReactMutation(
        "tasks",
        "DELETE",
        ["tasks", { projectId }],
        deleteTaskCallback,
        () => {}
    );
    const { data: membersData } = useMembersList();
    const members = membersData ?? [];

    /*
     * Sibling navigation (Phase 3 A2 — swipe-between-tasks). The hook
     * computes `nextTaskId` / `prevTaskId` from the same `boards` +
     * `tasks` cache the board reads, so swiping advances along the
     * visual top-to-bottom-left-to-right reading order. The
     * useBlocker guard intercepts dirty-edit swipes the same way it
     * intercepts a programmatic close — one confirm dialog covers
     * every navigation away.
     */
    const { goToNext, goToPrev, nextTaskId, prevTaskId } =
        useTaskPanelSiblings();
    // Single source of truth for the panel URL contract; openSimilarTask
    // routes through here so we don't hand-roll the path twice (R-C M1).
    const { openTask } = useTaskPanelNavigation();

    /**
     * Dirty flag driven by `onValuesChange`. We can't rely on
     * `form.isFieldsTouched()` alone — AntD treats `setFieldsValue`
     * (which we call on every `editingTask` change) as a "touch" so
     * the flag would be permanently true. We also can't lazily diff
     * via `form.getFieldsValue()` inside `useBlocker`'s callback —
     * the blocker callback is captured at render time and would read
     * stale state on the navigation tick.
     *
     * The state flips:
     *   - false → true on any user-driven `onValuesChange` whose
     *     merged result diverges from `editingTask`.
     *   - true → false when the user discards (Modal.confirm OK,
     *     `form.resetFields()`), saves successfully, or the task
     *     deletes.
     *
     * A ref mirrors the same value so the blocker callback (which
     * the router re-invokes on every navigation attempt) always reads
     * the latest dirty state without re-subscribing.
     */
    const [isFormDirty, setIsFormDirty] = useState(false);
    const isFormDirtyRef = useRef(false);
    isFormDirtyRef.current = isFormDirty;

    // Confirm-dialog state for the mask-click / Esc / explicit close
    // path. Wires the same dialog as the useBlocker programmatic-
    // navigation path so the user sees one consistent confirmation
    // surface regardless of how they tried to leave.
    const [pendingClose, setPendingClose] = useState(false);

    const closePanel = useCallback(() => {
        form.resetFields();
        setIsFormDirty(false);
        isFormDirtyRef.current = false;
        setSaveError(null);
        setAppliedFieldOrigin({});
        setPendingClose(false);
        // Navigate to the board URL. We can't use `navigate(-1)`
        // because a deep-link visitor (or a fresh tab opened to
        // `/projects/:projectId/board/task/:taskId`) has no history
        // entry to pop back to — `navigate(-1)` would no-op or land
        // outside the app. Going to the board URL works both for
        // freshly-loaded sessions and within-app opens.
        navigate(`/projects/${projectId}/board`, { viewTransition: true });
    }, [form, navigate, projectId]);

    /*
     * Dirty-state guard via React Router 7's `useBlocker`. Returns
     * `true` to intercept any navigation away from the panel route
     * while the form has uncommitted edits — covers programmatic
     * `navigate(...)`, browser back, iOS swipe-back, Android system
     * back, AND the swipe-between-tasks gesture (which routes through
     * `goToNext` / `goToPrev`, i.e. the same `navigate(...)`).
     * The mask-click path is handled separately by `requestClose`
     * below; both surfaces converge on the same `Modal.confirm`.
     */
    const blocker = useBlocker(({ currentLocation, nextLocation }) => {
        // Don't block self-navigation (StrictMode re-renders, or the
        // identity-equal re-entry that `blocker.reset()` triggers).
        if (currentLocation.pathname === nextLocation.pathname) return false;
        // Always allow navigation to the parent board URL — that's the
        // canonical self-initiated close target (B-M2).
        if (nextLocation.pathname === `/projects/${projectId}/board`)
            return false;
        return isFormDirtyRef.current;
    });

    /**
     * Mask-click / Esc / explicit dismissal request. If the form is
     * dirty, surface the confirm dialog; otherwise close immediately.
     */
    const requestClose = useCallback(() => {
        if (isFormDirtyRef.current) {
            setPendingClose(true);
            return;
        }
        closePanel();
    }, [closePanel]);

    const markFieldAsCopilotApplied = useCallback((field: TaskPanelField) => {
        setAppliedFieldOrigin((prev) => ({ ...prev, [field]: "copilot" }));
    }, []);

    const clearOriginOnManualEdits = useCallback(
        (changedValues: Record<string, unknown>) => {
            const changedFields =
                Object.keys(changedValues).filter(isTaskPanelField);
            if (changedFields.length === 0) return;
            setAppliedFieldOrigin((prev) => {
                let next = prev;
                changedFields.forEach((field) => {
                    if (!prev[field]) return;
                    if (next === prev) next = { ...prev };
                    delete next[field];
                });
                if (
                    prev.storyPoints &&
                    changedFields.some((field) => field !== "storyPoints")
                ) {
                    if (next === prev) next = { ...prev };
                    delete next.storyPoints;
                }
                return next;
            });
        },
        []
    );

    const onSubmit = async () => {
        if (!editingTask) return;
        try {
            await form.validateFields();
        } catch {
            // AntD has surfaced inline errors on the failing fields;
            // bail so we never persist a half-validated payload.
            return;
        }
        const fieldValues = form.getFieldsValue();
        const trimmedName =
            typeof fieldValues.taskName === "string"
                ? fieldValues.taskName.trim()
                : fieldValues.taskName;
        const merged = {
            ...editingTask,
            ...fieldValues,
            taskName: trimmedName
        };
        if (shallowEqual(merged, editingTask)) {
            closePanel();
            return;
        }
        try {
            await update(merged);
            setSaveError(null);
            message.success(microcopy.feedback.taskSaved);
            closePanel();
        } catch {
            // ErrorBox surfaces the message via the onError callback
            // above; keep the panel open so the user can retry without
            // re-entering their changes.
        }
    };

    const onDelete = () => {
        if (!editingTask) return;
        const taskName = editingTask.taskName;
        const id = taskId;
        Modal.confirm({
            centered: true,
            okText: microcopy.confirm.deleteTask.confirmLabel,
            cancelText: microcopy.actions.cancel,
            okButtonProps: { danger: true },
            title: microcopy.confirm.deleteTask.title,
            content: microcopy.confirm.deleteTask.description,
            onOk() {
                // Clear dirty state synchronously so the blocker won't
                // intercept any close-during-delete fallback (B-C1).
                isFormDirtyRef.current = false;
                setIsFormDirty(false);
                form.resetFields();
                remove(
                    { taskId: id },
                    {
                        onSuccess: () => {
                            message.success(microcopy.feedback.taskDeleted);
                            closePanel();
                        },
                        onError: () =>
                            message.error(
                                microcopy.feedback.couldntDeleteTask.replace(
                                    "{name}",
                                    taskName
                                )
                            )
                    }
                );
            }
        });
    };

    // Seed the form whenever the resolved task changes (different
    // taskId, fresh fetch). Mirrors the modal's effect.
    useEffect(() => {
        if (!editingTask) return;
        form.setFieldsValue(editingTask);
    }, [form, editingTask]);

    // Clear stale save errors when the user opens a different task; the
    // previous error referred to the prior payload and would mislead.
    useEffect(() => {
        setSaveError(null);
        setAppliedFieldOrigin({});
    }, [taskId]);

    // After-load missing-task auto-close (only when no dirty edits AND
    // not mid-delete — otherwise optimistic cache eviction races the
    // DELETE round-trip and the panel closes before failure rollback).
    useEffect(() => {
        if (
            !taskId ||
            isOptimisticPlaceholderId(taskId) ||
            tasks === undefined
        ) {
            return;
        }
        if (!editingTask && !form.isFieldsTouched() && !dLoading) {
            closePanel();
        }
    }, [closePanel, dLoading, editingTask, form, taskId, tasks]);

    /*
     * Rail focus management (R-B H1). On mount in desktop-rail mode,
     * remember whatever was focused (typically the column card the user
     * activated), then move focus to the aside so screen readers
     * announce the new landmark; on unmount, restore focus so keyboard
     * users land back on the trigger. The drawer chassis (phone/tablet)
     * gets focus trap + restore from AntD's Drawer, so this only fires
     * for the bare `<aside>`.
     */
    useEffect(() => {
        if (!isDesktopRail) return;
        previousFocusRef.current = document.activeElement as HTMLElement | null;
        asideRef.current?.focus();
        return () => {
            previousFocusRef.current?.focus?.();
        };
    }, [isDesktopRail]);

    /*
     * Swipe-between-tasks handlers (Phase 3 A2 — Line 171 of the
     * design doc; migrated to PointerEvents in R-B L). pointerdown
     * records origin; pointerup computes delta and routes through
     * `goToNext` / `goToPrev` when the horizontal delta exceeds the
     * threshold AND the gesture is more horizontal than vertical.
     * Vertical-dominant moves are scrolls (long notes inside the form)
     * and must NOT trigger navigation.
     *
     * PointerEvents over TouchEvents:
     *   - One handler covers touch + pen + (active-pen) trackpad; we
     *     keep the desktop click/drag-select path clean by filtering
     *     `pointerType === "mouse"` out of the gesture entirely.
     *   - `setPointerCapture` keeps the gesture bound to the panel
     *     surface even if the finger slides off the element mid-drag
     *     (e.g. onto the body backdrop). TouchEvents bubbled through
     *     `changedTouches` which is fragile when the touch leaves the
     *     element.
     *   - `pointercancel` fires when the OS reclaims the gesture
     *     (multi-finger pinch promoted to zoom, iOS swipe-back commit
     *     reaching threshold, scroll inertia kick-in). We clear the
     *     origin and DO NOT navigate.
     *
     * Edge-from-screen guard (R-B L): pointerdown origins within
     * `SWIPE_EDGE_GUARD_PX` of either viewport edge are skipped so
     * iOS Safari's native swipe-back stays interaction-exclusive on
     * the leftmost band, and the mirror-image forward gesture stays
     * exclusive on the rightmost band.
     *
     * The handlers attach to the panel surface — Drawer body for
     * phone/tablet, the docked `<aside>` for desktop. The dirty-state
     * guard intercepts via `useBlocker` because `goToNext` / `goToPrev`
     * route through `navigate(...)` like every other close path.
     */
    const swipeOriginRef = useRef<{
        x: number;
        y: number;
        pointerId: number;
    } | null>(null);
    const onPointerDown = useCallback((event: ReactPointerEvent) => {
        // Mouse drag-select inside the form (text selection, link
        // clicks, scrollbar drags) shares the pointer surface. The
        // swipe gesture is finger / pen only — mice keep their native
        // behavior and never navigate.
        if (event.pointerType === "mouse") return;
        // Skip when the pointerdown lands in either viewport-edge band
        // so the browser's native back/forward gesture (iOS Safari)
        // is interaction-exclusive there.
        const viewportWidth =
            typeof window !== "undefined" ? window.innerWidth : 0;
        if (
            event.clientX < SWIPE_EDGE_GUARD_PX ||
            (viewportWidth > 0 &&
                event.clientX > viewportWidth - SWIPE_EDGE_GUARD_PX)
        ) {
            return;
        }
        swipeOriginRef.current = {
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId
        };
        // Capture so the gesture survives the pointer leaving this
        // element (sliding onto the drawer mask, the AntD Select
        // dropdown layer, etc.). jsdom doesn't implement
        // `setPointerCapture` so we guard with a feature check; real
        // browsers (including iOS Safari 13+) ship it.
        const target = event.currentTarget;
        if (typeof target.setPointerCapture === "function") {
            try {
                target.setPointerCapture(event.pointerId);
            } catch {
                // Some browsers throw if the pointer id is no longer
                // active (race with pointercancel). The gesture still
                // works without capture; swallow and move on.
            }
        }
    }, []);
    const onPointerUp = useCallback(
        (event: ReactPointerEvent) => {
            const origin = swipeOriginRef.current;
            swipeOriginRef.current = null;
            const target = event.currentTarget;
            if (typeof target.releasePointerCapture === "function") {
                try {
                    target.releasePointerCapture(event.pointerId);
                } catch {
                    // Releasing a capture that was never held throws
                    // in some engines; swallow.
                }
            }
            if (!origin) return;
            // Only honour the same pointer that started the gesture.
            // Stray pointerup from a second finger arriving mid-drag
            // would otherwise short-circuit the primary swipe.
            if (event.pointerId !== origin.pointerId) return;
            const deltaX = event.clientX - origin.x;
            const deltaY = event.clientY - origin.y;
            // Reject swipes that don't clear the threshold (likely a
            // tap with finger drift) or that are scroll-dominant.
            if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return;
            if (
                Math.abs(deltaY) >
                Math.abs(deltaX) * SWIPE_VERTICAL_TOLERANCE
            ) {
                return;
            }
            // Right-swipe (positive X) → previous task; left-swipe
            // (negative X) → next task. Matches the natural "drag the
            // page toward you" mental model.
            if (deltaX > 0) {
                goToPrev();
            } else {
                goToNext();
            }
        },
        [goToNext, goToPrev]
    );
    const onPointerCancel = useCallback((event: ReactPointerEvent) => {
        // OS reclaimed the gesture (system back-swipe commit, zoom
        // promotion, etc.). Drop the origin so the next pointerup
        // doesn't accidentally navigate, and release any active
        // capture so the pointer id is clean for the next gesture.
        swipeOriginRef.current = null;
        const target = event.currentTarget;
        if (typeof target.releasePointerCapture === "function") {
            try {
                target.releasePointerCapture(event.pointerId);
            } catch {
                // Same race as in onPointerUp; swallow.
            }
        }
    }, []);

    const liveValues = (() => {
        const fromForm = form.getFieldsValue();
        return {
            taskName: fromForm.taskName ?? editingTask?.taskName,
            note: fromForm.note ?? editingTask?.note,
            type: fromForm.type ?? editingTask?.type,
            epic: fromForm.epic ?? editingTask?.epic,
            coordinatorId: fromForm.coordinatorId ?? editingTask?.coordinatorId,
            storyPoints: fromForm.storyPoints ?? editingTask?.storyPoints
        };
    })();
    void formTick;

    const deleteDisabled =
        !editingTask || dLoading || isOptimisticPlaceholderId(taskId);

    const titleText = editingTask?.taskName
        ? `${microcopy.actions.editTask} · ${editingTask.taskName}`
        : microcopy.actions.editTask;
    const titleNode = (
        <div
            style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: space.xs,
                minWidth: 0
            }}
        >
            {editingTask ? (
                <Tag
                    variant="filled"
                    color={editingTask.type === "Bug" ? "magenta" : "geekblue"}
                    style={{ fontWeight: 500, marginInlineEnd: 0 }}
                >
                    {editingTask.type === "Bug"
                        ? microcopy.options.taskTypes.bug
                        : microcopy.options.taskTypes.task}
                </Tag>
            ) : null}
            <Typography.Text
                style={{
                    fontSize: fontSize.lg,
                    fontWeight: fontWeight.semibold,
                    lineHeight: 1.3,
                    overflowWrap: "anywhere"
                }}
            >
                {titleText}
            </Typography.Text>
        </div>
    );

    /*
     * Footer layout matches `TaskModal`'s QW-19 ordering: on phone
     * (= phone viewport here, since the right-drawer on tablet/desktop
     * has more room) Delete sits at the top of the column, Cancel
     * mid, Save in the thumb zone. On the right drawer Delete-left,
     * Cancel/Save-right (also matching the modal).
     */
    const deleteButton = (
        <Button
            aria-label={
                editingTask?.taskName
                    ? microcopy.a11y.deleteTask.replace(
                          "{name}",
                          editingTask.taskName
                      )
                    : microcopy.actions.delete
            }
            block={isPhone || !screens.sm}
            danger
            disabled={deleteDisabled}
            onClick={onDelete}
            type="text"
        >
            {microcopy.actions.delete}
        </Button>
    );

    const cancelButton = (
        <Button
            block={isPhone || !screens.sm}
            onClick={requestClose}
            size="large"
        >
            {microcopy.actions.cancel}
        </Button>
    );

    const okButton = (
        <Button
            block={isPhone || !screens.sm}
            disabled={!editingTask || uLoading}
            loading={uLoading}
            onClick={onSubmit}
            size="large"
            type="primary"
        >
            {microcopy.actions.save}
        </Button>
    );

    const footerNode = isPhone ? (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: space.xs,
                /*
                 * Subtract `env(keyboard-inset-height)` so the primary
                 * action stays above the iOS soft keyboard when it
                 * opens — same reasoning as the modal's body
                 * maxHeight cap (QW-18), but applied to the
                 * sticky-bottom action area instead.
                 */
                paddingBottom: `max(${space.xs}px, env(keyboard-inset-height, 0px))`
            }}
        >
            {deleteButton}
            {cancelButton}
            {okButton}
        </div>
    ) : (
        <div
            style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: space.xs,
                justifyContent: "space-between",
                rowGap: space.xs
            }}
        >
            {deleteButton}
            <Space size={space.xs}>
                {cancelButton}
                {okButton}
            </Space>
        </div>
    );

    /*
     * Sibling hint shows the prev/next task IDs (or "First task" /
     * "Last task" placeholders) below the form on viewports where the
     * swipe gesture is reachable. Always rendered when at least one
     * sibling exists so keyboard / non-touch users can also tap the
     * pills to advance — the swipe is the accelerator, not the only
     * path.
     */
    const siblingHint = useMemo(() => {
        if (!nextTaskId && !prevTaskId) return null;
        return (
            // <nav> + dedicated aria-label so ATs surface this as a
            // sibling-task navigation landmark (R-B H2). A bare <div>
            // dropped the aria-label, and reusing the panel's generic
            // "Task details" string didn't describe the widget itself.
            <nav
                aria-label={microcopy.taskDetailPanel.siblingNavAriaLabel}
                style={{
                    alignItems: "center",
                    color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.55))",
                    display: "flex",
                    fontSize: fontSize.xs,
                    gap: space.sm,
                    justifyContent: "space-between",
                    marginBlockStart: space.md,
                    paddingBlockStart: space.sm,
                    borderBlockStart:
                        "1px solid var(--ant-color-split, rgba(15, 23, 42, 0.06))"
                }}
            >
                <Button
                    disabled={!prevTaskId}
                    onClick={() => goToPrev()}
                    size="small"
                    type="text"
                >
                    {`← ${microcopy.taskDetailPanel.siblingPrevLabel}`}
                </Button>
                <Button
                    disabled={!nextTaskId}
                    onClick={() => goToNext()}
                    size="small"
                    type="text"
                >
                    {`${microcopy.taskDetailPanel.siblingNextLabel} →`}
                </Button>
            </nav>
        );
    }, [goToNext, goToPrev, nextTaskId, prevTaskId]);

    /*
     * The form body and chrome render identically across all three
     * chassis modes; only the wrapper differs. Extracting the body
     * once keeps the JSX in lockstep and the responsive branch
     * trivially shallow.
     */
    const bodyContent = (
        <div style={{ position: "relative", width: "100%" }}>
            {awaitingTaskResolution ? (
                <div
                    style={{
                        alignItems: "center",
                        display: "flex",
                        justifyContent: "center",
                        marginBlock: space.xxl,
                        minHeight: space.xxl * 3,
                        width: "100%"
                    }}
                >
                    <Spin
                        aria-label={microcopy.a11y.loadingBoard}
                        size="large"
                    />
                </div>
            ) : null}
            <div hidden={awaitingTaskResolution}>
                {taskMissingAfterLoad ? (
                    <Alert
                        action={
                            <Button
                                danger
                                onClick={() => {
                                    // Bypass the dirty-guard — the
                                    // user just told us to discard.
                                    form.resetFields();
                                    closePanel();
                                }}
                                size="small"
                                type="text"
                            >
                                {microcopy.taskModal.discardEdits}
                            </Button>
                        }
                        description={microcopy.taskModal.removedByOthersBody}
                        message={microcopy.taskModal.removedByOthersTitle}
                        role="alert"
                        showIcon
                        style={{ marginBlockEnd: space.md }}
                        type="warning"
                    />
                ) : null}
                {/* Save-as-new follow-up tracked in the doc — see
                 * TaskModal's mirror comment. Discard above is the
                 * minimum viable recovery; same logic applies. */}
                <ErrorBox error={saveError} />
                <Form
                    form={form}
                    initialValues={editingTask}
                    layout="vertical"
                    onValuesChange={(changedValues, allValues) => {
                        setFormTick((tick) => tick + 1);
                        if (saveError) setSaveError(null);
                        clearOriginOnManualEdits(changedValues);
                        /*
                         * Flip the dirty flag iff the current
                         * form contents diverge from the
                         * persisted task. Trim the taskName
                         * before comparing so trailing whitespace
                         * doesn't read as a real edit. Mirroring
                         * the same trim that `onSubmit` applies
                         * keeps the dirty signal in lockstep
                         * with the persistence boundary.
                         */
                        if (!editingTask) return;
                        const trimmedName =
                            typeof allValues.taskName === "string"
                                ? allValues.taskName.trim()
                                : allValues.taskName;
                        const merged = {
                            ...editingTask,
                            ...allValues,
                            taskName: trimmedName
                        };
                        const nextDirty = !shallowEqual(merged, editingTask);
                        setIsFormDirty(nextDirty);
                        isFormDirtyRef.current = nextDirty;
                    }}
                >
                    <Form.Item
                        label={microcopy.fields.taskName}
                        name="taskName"
                        required
                        rules={[
                            {
                                required: true,
                                whitespace: true,
                                message: microcopy.validation.taskNameRequired
                            }
                        ]}
                        validateTrigger={["onBlur", "onSubmit"]}
                    >
                        <Input
                            autoComplete="off"
                            enterKeyHint="next"
                            inputMode="text"
                        />
                    </Form.Item>
                    <Form.Item
                        label={microcopy.fields.coordinator}
                        name="coordinatorId"
                        required
                        rules={[
                            {
                                required: true,
                                message:
                                    microcopy.validation.coordinatorRequired
                            }
                        ]}
                        validateTrigger={["onBlur", "onSubmit"]}
                    >
                        <Select
                            options={members.map((m) => ({
                                label: m.username,
                                value: m._id
                            }))}
                            placeholder={
                                microcopy.placeholders.selectCoordinator
                            }
                        />
                    </Form.Item>
                    <Form.Item
                        label={microcopy.fields.type}
                        name="type"
                        required
                        rules={[
                            {
                                required: true,
                                message: microcopy.validation.taskTypeRequired
                            }
                        ]}
                        validateTrigger={["onBlur", "onSubmit"]}
                    >
                        <Select
                            options={TASK_TYPE_OPTIONS}
                            placeholder={microcopy.placeholders.selectType}
                        />
                    </Form.Item>
                    <Form.Item label={microcopy.fields.epic} name="epic">
                        <Input
                            autoComplete="off"
                            enterKeyHint="next"
                            inputMode="text"
                        />
                    </Form.Item>
                    <Form.Item
                        label={
                            <span
                                style={{
                                    alignItems: "center",
                                    display: "inline-flex",
                                    gap: space.xs
                                }}
                            >
                                {microcopy.fields.storyPoints}
                                {appliedFieldOrigin.storyPoints ===
                                "copilot" ? (
                                    <Tag
                                        color="purple"
                                        style={{ marginInlineEnd: 0 }}
                                    >
                                        {microcopy.ai.suggestedByCopilot}
                                    </Tag>
                                ) : null}
                            </span>
                        }
                        name="storyPoints"
                    >
                        <Select
                            onChange={() => {
                                setAppliedFieldOrigin((prev) => {
                                    if (!prev.storyPoints) return prev;
                                    const next = { ...prev };
                                    delete next.storyPoints;
                                    return next;
                                });
                            }}
                            options={STORY_POINT_OPTIONS}
                            placeholder={
                                microcopy.placeholders.selectStoryPoints
                            }
                        />
                    </Form.Item>
                    <Form.Item label={microcopy.fields.notes} name="note">
                        <Input.TextArea
                            autoComplete="off"
                            enterKeyHint="done"
                            inputMode="text"
                            placeholder={
                                microcopy.placeholders.notesAcceptanceCriteria
                            }
                            rows={4}
                        />
                    </Form.Item>
                </Form>
                {aiEnabled &&
                    boardAiOn &&
                    editingTask &&
                    taskId &&
                    !isOptimisticPlaceholderId(taskId) && (
                        <AiTaskAssistPanel
                            excludeTaskId={taskId}
                            onApplyStoryPoints={(value) => {
                                markFieldAsCopilotApplied("storyPoints");
                                form.setFieldsValue({ storyPoints: value });
                                setFormTick((tick) => tick + 1);
                            }}
                            onApplySuggestion={(field, suggestion, options) => {
                                if (
                                    !options?.replace &&
                                    suggestion !== undefined &&
                                    isTaskPanelField(field)
                                ) {
                                    markFieldAsCopilotApplied(field);
                                }
                                const current = form.getFieldValue(field) ?? "";
                                if (options?.replace) {
                                    form.setFieldValue(field, suggestion);
                                } else if (suggestion === undefined) {
                                    return;
                                } else if (field === "note") {
                                    const appended = `${current}${
                                        current ? "\n\n" : ""
                                    }## Acceptance criteria\n- ${suggestion}`;
                                    form.setFieldsValue({ note: appended });
                                } else {
                                    form.setFieldsValue({
                                        [field]: suggestion
                                    });
                                }
                                setFormTick((tick) => tick + 1);
                            }}
                            onOpenSimilarTask={(otherTaskId) => {
                                // Same-tab navigation to a sibling task —
                                // shared URL contract via useTaskPanelNavigation
                                // so the path lives in one place. The
                                // dirty-guard intercepts if needed.
                                openTask(otherTaskId, projectId);
                            }}
                            values={liveValues}
                        />
                    )}
                {siblingHint}
            </div>
        </div>
    );

    /*
     * Discard-confirm dialog rendered once, shared by all three
     * chassis modes. Driven by EITHER the mask-click path
     * (`requestClose` → `pendingClose`) or the `useBlocker`
     * programmatic-navigation interception (`blocker.state ===
     * "blocked"`). Both surfaces share the same buttons so the user
     * gets one consistent UX no matter how they tried to leave.
     */
    const discardConfirm = (
        <Modal
            centered
            cancelText={microcopy.taskDetailPanel.confirmDiscardCancel}
            okText={microcopy.taskDetailPanel.confirmDiscardOk}
            okButtonProps={{ danger: true }}
            onCancel={() => {
                setPendingClose(false);
                // "Keep editing" — cancel the navigation if the
                // blocker fired, otherwise just dismiss the
                // dialog and leave the panel open.
                if (blocker.state === "blocked") {
                    blocker.reset?.();
                }
            }}
            onOk={() => {
                setPendingClose(false);
                // "Discard" — clear the form first so the
                // blocker re-reads `isFormDirty` as false and
                // doesn't intercept the proceed-or-close call.
                form.resetFields();
                setIsFormDirty(false);
                isFormDirtyRef.current = false;
                if (blocker.state === "blocked") {
                    blocker.proceed?.();
                } else {
                    closePanel();
                }
            }}
            open={pendingClose || blocker.state === "blocked"}
            title={microcopy.taskDetailPanel.confirmDiscardTitle}
            width={Math.min(420, breakpoints.sm)}
            // Link the body to the dialog via aria-describedby so SR
            // users hear the description right after the title (B-M4).
            // rc-dialog renders the dialog div with hardcoded
            // aria-labelledby only; modalRender wraps the inner
            // container and lets us inject the aria attribute there.
            modalRender={(node) =>
                isValidElement(node)
                    ? cloneElement(
                          node as React.ReactElement<{
                              "aria-describedby"?: string;
                          }>,
                          {
                              "aria-describedby":
                                  "task-detail-panel-discard-body"
                          }
                      )
                    : node
            }
        >
            <div id="task-detail-panel-discard-body">
                {microcopy.taskDetailPanel.confirmDiscardBody}
            </div>
        </Modal>
    );

    /*
     * Desktop docked rail (Phase 3 A2 — Line 23 + 171). When the
     * viewport is >= lg AND the user is not on a coarse pointer, the
     * panel renders as a fixed-width 480 px aside docked to the right
     * edge of the board's content region. No Drawer, no mask, no
     * scrim — the rail is part of the layout. Column reflow is owned
     * by the `BoardRouteShell` flex row in `src/routes/index.tsx`,
     * which renders this panel as the second flex child and lets the
     * 480 px aside take a fixed slice while the kanban surface
     * (`BoardPage`) takes the remaining viewport via `flex: 1 1 auto`.
     */
    if (isDesktopRail) {
        return (
            <>
                <aside
                    aria-label={microcopy.taskDetailPanel.ariaLabel}
                    data-testid="task-detail-panel"
                    data-placement="rail"
                    // Pointer handlers ride the aside surface directly
                    // so swipe gestures captured anywhere within the
                    // rail (header, body, footer) advance the URL.
                    // PointerEvents (R-B L) supersede the legacy touch
                    // pair so pen + trackpad gestures also work and the
                    // capture survives pointer drift off the element.
                    onPointerCancel={onPointerCancel}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    ref={asideRef}
                    // tabIndex=-1 so the rail mount effect can focus the
                    // landmark for screen-reader announcement (R-B H1).
                    tabIndex={-1}
                    style={{
                        background:
                            "var(--ant-color-bg-container, var(--pulse-bg-surface, #ffffff))",
                        borderInlineStart:
                            "1px solid var(--ant-color-split, rgba(15, 23, 42, 0.06))",
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        flex: `0 0 ${DESKTOP_RAIL_WIDTH_PX}px`,
                        height: "100%",
                        minHeight: 0,
                        overflow: "hidden",
                        // BoardRouteShell's flex row reserves the rail
                        // slot via this `flex` basis; we just paint it.
                        position: "sticky",
                        right: 0,
                        top: 0,
                        // Above the columns scroller's edge fades, below
                        // any AntD overlays (popovers, dropdowns) which
                        // run at z-index >= 1050.
                        zIndex: 100
                    }}
                >
                    <header
                        style={{
                            alignItems: "center",
                            borderBlockEnd:
                                "1px solid var(--ant-color-split, rgba(15, 23, 42, 0.06))",
                            display: "flex",
                            flex: "0 0 auto",
                            gap: space.sm,
                            justifyContent: "space-between",
                            padding: `${space.md}px ${space.lg}px`
                        }}
                    >
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                            {titleNode}
                        </div>
                        <Button
                            aria-label={microcopy.actions.cancel}
                            onClick={requestClose}
                            size="small"
                            type="text"
                            style={{ borderRadius: radius.pill }}
                        >
                            ×
                        </Button>
                    </header>
                    <div
                        style={{
                            flex: "1 1 auto",
                            minHeight: 0,
                            overflowY: "auto",
                            padding: `${space.lg}px ${space.lg}px ${space.md}px`
                        }}
                    >
                        {bodyContent}
                    </div>
                    <footer
                        style={{
                            borderBlockStart:
                                "1px solid var(--ant-color-split, rgba(15, 23, 42, 0.06))",
                            flex: "0 0 auto",
                            padding: `${space.md}px ${space.lg}px`,
                            paddingBlockEnd: `max(${space.md}px, env(safe-area-inset-bottom))`
                        }}
                    >
                        {footerNode}
                    </footer>
                </aside>
                {discardConfirm}
            </>
        );
    }

    // Phone (bottom-sheet) and tablet (right-overlay) both use the
    // AntD Drawer chassis. Placement matches the chassis
    // `useIsPhoneChrome` signal so the bottom-tab bar and the panel
    // never collide on touchscreen laptops / tablets (B-H1).
    const drawerProps = isPhone
        ? { placement: "bottom" as const, size: "large" as const }
        : { placement: "right" as const, size: "large" as const };

    return (
        <Drawer
            {...drawerProps}
            mask
            maskClosable
            onClose={requestClose}
            open={true}
            title={titleNode}
            footer={footerNode}
            // Honor prefers-reduced-motion. AntD's `motion={null}` and
            // `maskMotion={null}` disable the drawer's open/close
            // transition; passing `undefined` (the default) keeps the
            // motion. Drawer accepts both shapes per `rc-motion`.
            motion={
                prefersReducedMotion
                    ? (null as unknown as undefined)
                    : undefined
            }
            maskMotion={
                prefersReducedMotion
                    ? (null as unknown as undefined)
                    : undefined
            }
            styles={{
                body: {
                    paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`,
                    /*
                     * Body scrolls independently from the sticky
                     * footer so long notes don't push Save below the
                     * fold. The keyboard-inset subtraction parallels
                     * the modal's QW-18 fix.
                     */
                    overflowY: "auto"
                }
            }}
            data-testid="task-detail-panel"
            data-placement={drawerProps.placement}
            // Pointer handlers ride the body div via styles — but on
            // the Drawer surface they need to attach to the inner
            // content container; AntD doesn't expose that directly.
            // Wrap the body in our own div with the handlers so the
            // gesture is captured anywhere inside the drawer
            // (PointerEvents, R-B L).
        >
            <div
                data-testid="task-detail-panel-swipe-target"
                onPointerCancel={onPointerCancel}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                style={{ minHeight: "100%" }}
            >
                {bodyContent}
            </div>
            {discardConfirm}
        </Drawer>
    );
};

export default TaskDetailPanel;
