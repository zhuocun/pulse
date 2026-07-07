import { CloseOutlined } from "@ant-design/icons";
import {
    Alert,
    Button,
    DatePicker,
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
import dayjs, { type Dayjs } from "dayjs";
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
import filterRequest from "../../utils/filterRequest";
import normalizeTaskType from "../../utils/normalizeTaskType";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useLabels from "../../utils/hooks/useLabels";
import useMembersList from "../../utils/hooks/useMembersList";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useReactQuery from "../../utils/hooks/useReactQuery";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import useTaskPanelSiblings from "../../utils/hooks/useTaskPanelSiblings";
import useUndoToast from "../../utils/hooks/useUndoToast";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import AiRewritePanel from "../aiRewritePanel";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
import CommentsThread from "../commentsThread";
import ErrorBox from "../errorBox";
import Sheet from "../sheet";

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
 *   - Phone (coarse pointer): animated multi-detent bottom Sheet via
 *     the shared `<Sheet>` primitive (Phase 6 Wave 3 Phase 2).
 *   - Tablet (md/lg-but-fine-pointer): right-overlay via Sheet's
 *     AntD `<Drawer>` fallback (`desktopPlacement="right"`).
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

/*
 * `startDate` / `dueDate` persist as date-only ISO strings (`YYYY-MM-DD`).
 * AntD's `DatePicker` works in `Dayjs`, so we convert at the form
 * boundary — same contract as `TaskModal`: `taskToFormValues` maps the
 * stored string → a `Dayjs` for the control, and `normalizeDateFields`
 * maps the `Dayjs` back to a `YYYY-MM-DD` string for the submit payload
 * (and the `shallowEqual` dirty-check).
 */
const ISO_DATE_FORMAT = "YYYY-MM-DD";

const DATE_FIELDS = ["startDate", "dueDate"] as const;

const toDayjsOrUndefined = (value: unknown): Dayjs | undefined => {
    if (!value) return undefined;
    const parsed = dayjs(value as string);
    return parsed.isValid() ? parsed : undefined;
};

type TaskFormValues = Omit<ITask, "startDate" | "dueDate"> & {
    startDate?: Dayjs;
    dueDate?: Dayjs;
};

/**
 * Map an `ITask` into the shape AntD `Form` expects for this panel —
 * every field passes through unchanged except the two date fields, which
 * become `Dayjs` instances (or `undefined` when unset / unparsable) so the
 * `DatePicker` controls bind correctly. `labelIds` / `assigneeIds` /
 * `parentTaskId` are seeded by the spread (an absent value stays
 * `undefined`, which `filterRequest` strips on both sides of the dirty-
 * check so an untouched task fires no needless PUT).
 */
const taskToFormValues = (task: ITask): TaskFormValues => ({
    ...task,
    // The wire `type` is an open string; the select only knows the
    // canonical Task/Bug vocabulary. Normalize at the form boundary so
    // an out-of-vocabulary value (e.g. "feature") binds as "Task" —
    // matching how the board card and the title tag render it —
    // instead of leaking the raw string into the control.
    type: normalizeTaskType(task.type),
    startDate: toDayjsOrUndefined(task.startDate),
    dueDate: toDayjsOrUndefined(task.dueDate)
});

/**
 * Convert any `Dayjs` date-field values in a raw form payload back to
 * date-only ISO strings, leaving every other field untouched. A cleared
 * picker stays falsy (`undefined` / `null`), which the cleared-scalar
 * normalisation in `onSubmit` then maps to an explicit `null` so the
 * `preserveNullKeys` PUT clears the field.
 */
const normalizeDateFields = (
    values: Record<string, unknown>
): Record<string, unknown> => {
    const next = { ...values };
    DATE_FIELDS.forEach((field) => {
        const value = next[field];
        if (value && dayjs.isDayjs(value)) {
            next[field] = value.format(ISO_DATE_FORMAT);
        }
    });
    return next;
};

/**
 * Merge a raw form payload onto the persisted task into the exact `ITask`
 * shape the PUT (and the dirty-check) need: date `Dayjs` values become
 * ISO strings, the name is trimmed, and the clearable FK/date fields
 * coerce a cleared `undefined` to an explicit `null` so the
 * `preserveNullKeys` PUT clears them. Shared by `onSubmit` and the
 * `onValuesChange` dirty signal so both read the same boundary.
 */
const buildMergedTask = (
    base: ITask,
    rawValues: Record<string, unknown>
): ITask => {
    const fieldValues = normalizeDateFields(rawValues);
    const rawName = fieldValues.taskName;
    const trimmedName =
        typeof rawName === "string" ? rawName.trim() : base.taskName;
    const merged = {
        ...base,
        ...fieldValues,
        taskName: trimmedName
    } as ITask;
    merged.parentTaskId = merged.parentTaskId ?? null;
    merged.startDate = merged.startDate ?? null;
    merged.dueDate = merged.dueDate ?? null;
    return merged;
};

/**
 * The form binds a NORMALIZED `type` (out-of-vocabulary values read as
 * "Task"), so the dirty-checks must compare against the same
 * normalization — otherwise an untouched task with a legacy type would
 * diff as dirty and fire a needless PUT on Save. Mirrors `TaskModal`'s
 * baseline.
 */
const toDirtyCheckBaseline = (task: ITask): ITask => ({
    ...task,
    type: normalizeTaskType(task.type)
});

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

const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
    projectId,
    taskId,
    boardAiOn = true
}) => {
    // AntD v6: static `message` warns about dynamic theme;
    // `useAppMessage()` returns a theme-aware instance (with a static
    // fallback for tests that render without `<App>`).
    const message = useAppMessage();
    const [form] = useForm();
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const isPhone = useIsPhoneChrome();
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
    /*
     * Deep-link hydration guard (W2-01). On the very first render —
     * before effects run — the phone chassis forces Sheet's static
     * AntD Drawer fallback instead of the framer-motion animated
     * branch. A deep-linked (or freshly-hydrated) mount otherwise
     * kicks off the enter animation while the surrounding lazy chunk
     * is still settling, which can wedge the sheet mid-transition.
     * After mount the animated branch takes over for every subsequent
     * render (detent drags, sibling swipes, etc.).
     */
    const [hasMounted, setHasMounted] = useState(false);
    useEffect(() => {
        setHasMounted(true);
    }, []);
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
        (err) => setSaveError(err),
        // `setCache` stays default; the trailing list opts these clearable
        // scalar/date keys into `filterRequest`'s preserve path so a cleared
        // (`null`/`""`) value reaches the PUT and the backend CLEARS the
        // field instead of treating the stripped/absent key as unchanged
        // (the PRD-GAP-005 pattern, mirrored from `TaskModal`).
        undefined,
        ["parentTaskId", "startDate", "dueDate"]
    );
    // Re-update mutation used only as the Undo closure for a successful
    // save: it PUTs the captured before-state back through the same
    // react-query cache key so the cache and the server move back in
    // lockstep. Errors are swallowed — the user deliberately clicked Undo.
    const { mutateAsync: undoUpdate } = useReactMutation(
        "tasks",
        "PUT",
        ["tasks", { projectId }],
        undefined,
        () => {}
    );
    // Name of the task currently being deleted, captured so the DELETE
    // failure toast reads the right label. The error toast MUST fire from
    // the mutation-level onError (below) rather than a per-`mutate`-call
    // callback: the panel navigates to the board on delete, so its
    // MutationObserver unmounts before the request settles and React
    // Query skips per-call callbacks — only the mutation-level onError
    // (and the optimistic rollback) survive the unmount.
    const deletingTaskNameRef = useRef("");
    const { mutate: remove, isLoading: dLoading } = useReactMutation(
        "tasks",
        "DELETE",
        ["tasks", { projectId }],
        deleteTaskCallback,
        () =>
            message.error(
                microcopy.feedback.couldntDeleteTask.replace(
                    "{name}",
                    deletingTaskNameRef.current
                )
            )
    );
    // Companion POST mutation used purely as the Undo closure: it
    // re-creates the just-deleted task with the captured snapshot so an
    // accidental delete is recoverable. Shares the board's tasks cache
    // key so the optimistic re-create lands where the UI is reading.
    const { mutateAsync: recreate } = useReactMutation(
        "tasks",
        "POST",
        ["tasks", { projectId }],
        newTaskCallback,
        () => {}
    );
    const { show: showUndoToast } = useUndoToast();
    const { data: membersData } = useMembersList();
    const members = membersData ?? [];
    // Project labels + project-member roster power the richness pickers
    // (parity with `TaskModal`). Both are keyed per-project and disabled
    // until `projectId` resolves. `useLabels` feeds the tag-mode label
    // Select; `useProjectMembers` hits `/projects/members` (the project
    // roster) so the assignee picker offers only the people on this
    // project — NOT `useMembersList`'s global directory used for the
    // coordinator picker.
    const { labels: labelsData } = useLabels(projectId);
    const labels = useMemo(() => labelsData ?? [], [labelsData]);
    const { data: projectMembersData } = useProjectMembers(projectId);
    // Guard against a non-array payload (errored / stubbed response sharing
    // the query cache) so the `.map` below never throws — mirrors the
    // `Array.isArray` normalization `useLabels` / `useProjectMembers` do.
    const projectMembers = useMemo(
        () => (Array.isArray(projectMembersData) ? projectMembersData : []),
        [projectMembersData]
    );
    const labelOptions = useMemo(
        () =>
            labels.map((label) => ({
                label: label.name,
                value: label._id,
                color: label.color
            })),
        [labels]
    );
    const assigneeOptions = useMemo(
        () =>
            projectMembers.map((member) => ({
                label: member.username,
                value: member._id
            })),
        [projectMembers]
    );
    // Parent-task options: every OTHER task in the project (a task can't be
    // its own parent). Clearable + optional — mirrors `TaskModal`.
    const parentTaskOptions = useMemo(
        () =>
            (tasks ?? [])
                .filter((candidate) => candidate._id !== taskId)
                .map((candidate) => ({
                    label: candidate.taskName,
                    value: candidate._id
                })),
        [tasks, taskId]
    );

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
        const merged = buildMergedTask(editingTask, form.getFieldsValue());
        // Compare the FILTERED payloads. The form now registers optional
        // richness fields (dates, labelIds, assigneeIds, parentTaskId) that
        // read back as `undefined` / `null` / `""` when unset; `filterRequest`
        // strips those void keys from both sides (exactly as the wire payload
        // would be) so an untouched task with no richness still compares equal
        // and closes without a needless PUT.
        const baseline = toDirtyCheckBaseline(editingTask);
        if (
            shallowEqual(
                filterRequest(merged as unknown as Record<string, unknown>),
                filterRequest(baseline as unknown as Record<string, unknown>)
            )
        ) {
            closePanel();
            return;
        }
        // Capture the before-state for the Undo closure BEFORE the PUT
        // lands — once the cache flips to the updated payload the original
        // values would be lost.
        const beforeState: ITask = { ...editingTask };
        try {
            await update(merged as unknown as Record<string, unknown>);
            setSaveError(null);
            // §2.A.4 — a task update is reversible, so surface a transient
            // Undo toast instead of a plain success message. The panel
            // navigates to the board on `closePanel()` below, so it unmounts
            // on this same action; keep the toast alive past unmount
            // (`dismissOnUnmount: false`) so the user still gets their Undo
            // window. The inverse PUT runs through the persistent
            // react-query client.
            showUndoToast({
                description: microcopy.feedback.taskSaved,
                analyticsTag: "task.update",
                dismissOnUnmount: false,
                undo: async () => {
                    await undoUpdate(
                        beforeState as unknown as Record<string, unknown>
                    );
                }
            });
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
        // Capture the full task payload before the DELETE so the Undo
        // closure can re-POST it. After the optimistic prune the cache no
        // longer carries it.
        const beforeState: ITask = { ...editingTask };
        // §2.A.4 — task delete is reversible, so it skips Modal.confirm
        // and goes straight to an optimistic delete + Undo toast.
        // Clear dirty state synchronously so the blocker won't intercept
        // the close-during-delete navigation (B-C1).
        isFormDirtyRef.current = false;
        setIsFormDirty(false);
        form.resetFields();
        deletingTaskNameRef.current = taskName;
        remove({ taskId: id });
        showUndoToast({
            description: microcopy.feedback.taskDeleted,
            analyticsTag: "task.delete",
            // The panel navigates to the board on `closePanel()` below, so
            // it unmounts on this same action; keep the toast alive past
            // unmount so the user still gets their Undo window. The inverse
            // re-create runs through the persistent react-query client.
            dismissOnUnmount: false,
            undo: async () => {
                await recreate(
                    beforeState as unknown as Record<string, unknown>
                );
            }
        });
        closePanel();
    };

    // Seed the form whenever the resolved task changes (different
    // taskId, fresh fetch). Mirrors the modal's effect.
    useEffect(() => {
        if (!editingTask) return;
        // Convert the stored ISO date strings into `Dayjs` so the
        // `DatePicker` controls bind (they reject bare strings).
        form.setFieldsValue(taskToFormValues(editingTask));
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
                    color={
                        normalizeTaskType(editingTask.type) === "Bug"
                            ? "magenta"
                            : "geekblue"
                    }
                    style={{ fontWeight: 500, marginInlineEnd: 0 }}
                >
                    {normalizeTaskType(editingTask.type) === "Bug"
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
                    initialValues={
                        editingTask ? taskToFormValues(editingTask) : undefined
                    }
                    layout="vertical"
                    onValuesChange={(changedValues, allValues) => {
                        setFormTick((tick) => tick + 1);
                        if (saveError) setSaveError(null);
                        clearOriginOnManualEdits(changedValues);
                        /*
                         * Flip the dirty flag iff the current form
                         * contents diverge from the persisted task.
                         * `buildMergedTask` applies the same name-trim,
                         * date normalisation, and cleared-scalar coercion
                         * that `onSubmit` does, and the comparison runs
                         * over the FILTERED payloads so a registered-but-
                         * unset optional richness field doesn't read as a
                         * spurious edit.
                         */
                        if (!editingTask) return;
                        const merged = buildMergedTask(editingTask, allValues);
                        const baseline = toDirtyCheckBaseline(editingTask);
                        const nextDirty = !shallowEqual(
                            filterRequest(
                                merged as unknown as Record<string, unknown>
                            ),
                            filterRequest(
                                baseline as unknown as Record<string, unknown>
                            )
                        );
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
                    <Form.Item
                        label={microcopy.fields.startDate}
                        name="startDate"
                    >
                        <DatePicker
                            allowClear
                            format={ISO_DATE_FORMAT}
                            placeholder={microcopy.placeholders.selectStartDate}
                            style={{ width: "100%" }}
                        />
                    </Form.Item>
                    <Form.Item label={microcopy.fields.dueDate} name="dueDate">
                        <DatePicker
                            allowClear
                            format={ISO_DATE_FORMAT}
                            placeholder={microcopy.placeholders.selectDueDate}
                            style={{ width: "100%" }}
                        />
                    </Form.Item>
                    <Form.Item label={microcopy.fields.labels} name="labelIds">
                        <Select
                            allowClear
                            mode="multiple"
                            optionFilterProp="label"
                            options={labelOptions}
                            optionRender={(option) => (
                                <span
                                    style={{
                                        alignItems: "center",
                                        display: "inline-flex",
                                        gap: space.xs
                                    }}
                                >
                                    <span
                                        aria-hidden
                                        style={{
                                            background:
                                                (
                                                    option.data as {
                                                        color?: string;
                                                    }
                                                ).color ||
                                                "var(--ant-color-border, #d9d9d9)",
                                            borderRadius: "50%",
                                            display: "inline-block",
                                            flex: "0 0 auto",
                                            height: 10,
                                            width: 10
                                        }}
                                    />
                                    {option.label}
                                </span>
                            )}
                            placeholder={microcopy.placeholders.selectLabels}
                            tagRender={(tagProps) => {
                                const color = labels.find(
                                    (item) => item._id === tagProps.value
                                )?.color;
                                return (
                                    <Tag
                                        closable={tagProps.closable}
                                        color={color}
                                        onClose={tagProps.onClose}
                                        style={{ marginInlineEnd: space.xxs }}
                                    >
                                        {tagProps.label}
                                    </Tag>
                                );
                            }}
                        />
                    </Form.Item>
                    <Form.Item
                        label={microcopy.fields.assignees}
                        name="assigneeIds"
                    >
                        <Select
                            allowClear
                            mode="multiple"
                            optionFilterProp="label"
                            options={assigneeOptions}
                            placeholder={microcopy.placeholders.selectAssignees}
                        />
                    </Form.Item>
                    <Form.Item
                        label={microcopy.fields.parentTask}
                        name="parentTaskId"
                    >
                        <Select
                            allowClear
                            optionFilterProp="label"
                            options={parentTaskOptions}
                            placeholder={
                                microcopy.placeholders.selectParentTask
                            }
                            showSearch
                        />
                    </Form.Item>
                    {aiEnabled && boardAiOn && editingTask ? (
                        <Form.Item label={null}>
                            <AiRewritePanel
                                note={liveValues.note ?? ""}
                                onAccept={(text) => {
                                    markFieldAsCopilotApplied("note");
                                    form.setFieldsValue({ note: text });
                                    setFormTick((tick) => tick + 1);
                                    setIsFormDirty(true);
                                    isFormDirtyRef.current = true;
                                }}
                                projectId={projectId}
                            />
                        </Form.Item>
                    ) : null}
                    <Form.Item
                        label={
                            <span
                                style={{
                                    alignItems: "center",
                                    display: "inline-flex",
                                    gap: space.xs
                                }}
                            >
                                {microcopy.fields.notes}
                                {appliedFieldOrigin.note === "copilot" ? (
                                    <Tag
                                        color="purple"
                                        style={{ marginInlineEnd: 0 }}
                                    >
                                        {microcopy.ai.suggestedByCopilot}
                                    </Tag>
                                ) : null}
                            </span>
                        }
                        name="note"
                    >
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
                {/*
                 * Comments + @mentions thread (GAP-010 — parity with
                 * `TaskModal`). Mounted below the form + AI assist for a
                 * real (persisted) task only — an optimistic placeholder has
                 * no server comments, and the thread keys its query off the
                 * concrete task id. `projectId` is always known on the panel
                 * (a required prop), but we gate on `editingTask` /
                 * non-placeholder so the thread never queries a half-resolved
                 * task. RBAC (author-only edit, author-or-owner delete) and
                 * mention → notifications invalidation all live in
                 * `CommentsThread` / `useComments`.
                 */}
                {editingTask && taskId && !placeholderId && projectId ? (
                    <CommentsThread projectId={projectId} taskId={taskId} />
                ) : null}
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
                            aria-label={microcopy.actions.close}
                            icon={<CloseOutlined aria-hidden />}
                            onClick={requestClose}
                            size="small"
                            type="text"
                            style={{ borderRadius: radius.pill }}
                        />
                    </header>
                    <div
                        style={{
                            flex: "1 1 auto",
                            minHeight: 0,
                            overflowY: "auto",
                            overscrollBehavior: "contain",
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

    /*
     * Phone (animated bottom-sheet) and tablet (right-overlay) both
     * flow through the shared `<Sheet>` primitive. Sheet's internal
     * `useIsPhoneChrome` / `useReducedMotion` check picks the branch:
     *
     *   - Coarse pointer + motion-enabled → portal'd animated surface
     *     with `medium ↔ large` detents, grabber drag-to-dismiss, and
     *     glass-tinted scrim.
     *   - Anything else (mouse, narrow-desktop, reduced-motion) →
     *     AntD `<Drawer>` at `desktopPlacement="right"` / `size="large"`.
     *
     * Sheet also owns the `prefers-reduced-motion` gating, so this
     * branch does not gate motion itself.
     *
     * The bottom-tab bar collision guard from the previous Drawer
     * config (B-H1) is preserved because Sheet treats phone chrome the
     * same way — coarse pointer always wins, regardless of viewport
     * width, so a touchscreen laptop still gets the animated bottom
     * sheet instead of the right shelf.
     */
    return (
        <>
            <Sheet
                closable
                data-testid="task-detail-panel"
                defaultDetent="large"
                detents={["medium", "large"]}
                desktopPlacement="right"
                desktopSize="large"
                footer={footerNode}
                forceDrawerFallback={!hasMounted}
                mask
                maskClosable
                onClose={requestClose}
                open={true}
                styles={{
                    body: {
                        paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`,
                        paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                        paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`,
                        /*
                         * Body scrolls independently from the sticky
                         * footer so long notes don't push Save below
                         * the fold. The keyboard-inset subtraction
                         * parallels the modal's QW-18 fix.
                         */
                        overflowY: "auto",
                        overscrollBehavior: "contain"
                    }
                }}
                title={titleNode}
            >
                {/*
                 * Pointer handlers ride a dedicated wrapper inside the
                 * Sheet's body slot. The Sheet primitive uses
                 * grabber-only drag (`dragListener={false}` +
                 * `useDragControls`), so body pointer events are NOT
                 * captured by the Sheet's drag-to-dismiss — they
                 * remain available for the panel's horizontal sibling-
                 * navigation swipe (R-B L, Phase 3 A2).
                 */}
                <div
                    data-testid="task-detail-panel-swipe-target"
                    onPointerCancel={onPointerCancel}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    style={{ minHeight: "100%" }}
                >
                    {bodyContent}
                </div>
            </Sheet>
            {discardConfirm}
        </>
    );
};

export default TaskDetailPanel;
