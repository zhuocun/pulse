import {
    Alert,
    Button,
    Drawer,
    Form,
    Grid,
    Input,
    message,
    Modal,
    Select,
    Space,
    Spin,
    Tag,
    Typography
} from "antd";
import { useForm } from "antd/lib/form/Form";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { breakpoints, fontSize, fontWeight, space } from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useMembersList from "../../utils/hooks/useMembersList";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useReactQuery from "../../utils/hooks/useReactQuery";
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
 * See `docs/design/ui-ux-comprehensive-review-2026-05.md` §A2.
 */

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
 * Detects coarse-pointer phones so the drawer mounts as a bottom sheet.
 * Falls back to the AntD `Grid` breakpoints when the media query API is
 * unavailable (jsdom default). The two signals are OR'd because some
 * tablets report `pointer: coarse` but have `md` width — there a
 * right-side drawer is still the right call.
 */
const useIsPhoneViewport = (): boolean => {
    const screens = Grid.useBreakpoint();
    const [coarse, setCoarse] = useState<boolean>(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return false;
        }
        return window.matchMedia("(pointer: coarse)").matches;
    });

    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const media = window.matchMedia("(pointer: coarse)");
        const handler = (event: MediaQueryListEvent) =>
            setCoarse(event.matches);
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        media.addListener(handler);
        return () => media.removeListener(handler);
    }, []);

    // A phone is "coarse pointer AND not md-or-wider". A tablet hits md+
    // even on a touch screen and we want the right drawer there.
    return coarse && screens.md === false;
};

/**
 * Honors `prefers-reduced-motion: reduce` for the drawer entry. AntD
 * Drawer's motion is driven by `rc-motion`; passing `motion={null}` and
 * `maskMotion={null}` removes the transition entirely. We don't import
 * `rc-motion` types here — `motion={null}` is a documented escape
 * hatch.
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
    const [form] = useForm();
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const isPhone = useIsPhoneViewport();
    const prefersReducedMotion = usePrefersReducedMotion();
    const screens = Grid.useBreakpoint();
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

    /**
     * Returns true when the form has at least one user-supplied edit
     * relative to the canonical task payload. We can't rely on
     * `form.isFieldsTouched()` alone — AntD treats `setFieldsValue`
     * (which we call on every `editingTask` change) as a "touch" so
     * the flag would be permanently true. Instead, compare the live
     * form values against `editingTask`. The dirty flag drives both
     * the close-on-mask blocker (next commit) and the
     * `taskMissingAfterLoad` recovery banner above.
     */
    const isFormDirty = useMemo(() => {
        if (!editingTask) return false;
        const live = form.getFieldsValue();
        const trimmedName =
            typeof live.taskName === "string"
                ? live.taskName.trim()
                : live.taskName;
        const merged = { ...editingTask, ...live, taskName: trimmedName };
        // Touch the dependency so this memo re-runs on every field
        // change — `formTick` increments inside `onValuesChange`.
        void formTick;
        return !shallowEqual(merged, editingTask);
    }, [editingTask, form, formTick]);

    // Confirm-dialog state for the dirty-state guard. Wired to
    // `useBlocker` in a follow-up commit; the renderer below already
    // honors the `pendingClose` state so the back-button path works
    // identically to the mask click.
    const [pendingClose, setPendingClose] = useState(false);

    const closePanel = useCallback(() => {
        form.resetFields();
        setSaveError(null);
        setAppliedFieldOrigin({});
        setPendingClose(false);
        // useNavigate(-1) preserves browser history so a tab opened on
        // a deep URL (with no prior board entry) doesn't navigate to a
        // blank page — we resolve the board-level URL relative to the
        // current route. Use the route-aware fallback so deep links
        // still close gracefully.
        navigate(`/projects/${projectId}/board`);
    }, [form, navigate, projectId]);

    /*
     * Dirty-state guard via React Router 7's `useBlocker`. Returns
     * `true` to intercept any navigation away from the panel route
     * while the form has uncommitted edits — covers programmatic
     * `navigate(...)`, browser back, iOS swipe-back, and Android
     * system back, because react-router 7's blocker hooks into the
     * History API for all three. The mask-click path goes through
     * the drawer's `onClose` which calls our `requestClose` below
     * and falls through to the same confirm dialog.
     */
    const blocker = useBlocker(({ currentLocation, nextLocation }) => {
        // Don't block if we're not actually moving (StrictMode double
        // render guard). currentLocation === nextLocation happens when
        // the blocker re-evaluates after `reset()`.
        if (currentLocation.pathname === nextLocation.pathname) return false;
        // Don't block when there are no dirty edits, or when the
        // user has explicitly approved the close via the dialog —
        // the `closePanel`/`reset()` path runs `form.resetFields()`
        // first so `isFormDirty` is already false by then.
        return isFormDirty;
    });

    /**
     * Mask-click / Esc / explicit dismissal request. If the form is
     * dirty, surface the confirm dialog; otherwise close immediately.
     */
    const requestClose = useCallback(() => {
        if (isFormDirty) {
            setPendingClose(true);
            return;
        }
        closePanel();
    }, [closePanel, isFormDirty]);

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
                remove(
                    { taskId: id },
                    {
                        onSuccess: () => {
                            message.success(microcopy.feedback.taskDeleted);
                            // Bypass the dirty-guard — the task no
                            // longer exists, the form payload is
                            // irrelevant. resetFields() first so the
                            // blocker re-evaluates as `false`.
                            form.resetFields();
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

    // After-load missing-task auto-close (only when no dirty edits)
    useEffect(() => {
        if (
            !taskId ||
            isOptimisticPlaceholderId(taskId) ||
            tasks === undefined
        ) {
            return;
        }
        if (!editingTask && !form.isFieldsTouched()) {
            closePanel();
        }
    }, [closePanel, editingTask, form, taskId, tasks]);

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
     * Drawer width/height. Phone: bottom sheet at 92dvh — leaves a
     * thin sliver of the board peeking so the user keeps spatial
     * orientation. Tablet+: right-side drawer at 480px (the figure
     * the review doc spec'd). Desktop "docked rail that reflows the
     * columns" is a Phase 4 follow-up — for now the right drawer is
     * sufficient.
     */
    const drawerProps = isPhone
        ? {
              placement: "bottom" as const,
              height: "92dvh"
          }
        : {
              placement: "right" as const,
              width: screens.md ? 480 : "92vw"
          };

    return (
        <Drawer
            {...drawerProps}
            destroyOnClose={false}
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
        >
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
                            description={
                                microcopy.taskModal.removedByOthersBody
                            }
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
                        onValuesChange={(changedValues) => {
                            setFormTick((tick) => tick + 1);
                            if (saveError) setSaveError(null);
                            clearOriginOnManualEdits(changedValues);
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
                                    message:
                                        microcopy.validation.taskNameRequired
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
                                    message:
                                        microcopy.validation.taskTypeRequired
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
                                    microcopy.placeholders
                                        .notesAcceptanceCriteria
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
                                onApplySuggestion={(
                                    field,
                                    suggestion,
                                    options
                                ) => {
                                    if (
                                        !options?.replace &&
                                        suggestion !== undefined &&
                                        isTaskPanelField(field)
                                    ) {
                                        markFieldAsCopilotApplied(field);
                                    }
                                    const current =
                                        form.getFieldValue(field) ?? "";
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
                                    // Same-tab navigation to a sibling
                                    // task. The dirty-guard intercepts
                                    // if needed.
                                    navigate(
                                        `/projects/${projectId}/board/task/${otherTaskId}`
                                    );
                                }}
                                values={liveValues}
                            />
                        )}
                </div>
            </div>
            {/*
             * Dirty-state confirm dialog. Driven by EITHER the mask-
             * click path (`requestClose` → `pendingClose`) or the
             * `useBlocker` programmatic-navigation interception
             * (`blocker.state === "blocked"`). Both surfaces share the
             * same buttons so the user gets one consistent UX no matter
             * how they tried to leave.
             */}
            <Modal
                centered
                cancelText={microcopy.taskDetailPanel.confirmDiscardCancel}
                okText={microcopy.taskDetailPanel.confirmDiscardOk}
                okButtonProps={{ danger: true }}
                onCancel={() => {
                    setPendingClose(false);
                    if (blocker.state === "blocked") blocker.reset?.();
                }}
                onOk={() => {
                    setPendingClose(false);
                    if (blocker.state === "blocked") {
                        // The user approved the navigation; `proceed`
                        // continues to the URL the blocker
                        // intercepted. Clear the form first so the
                        // blocker re-evaluation reads `isFormDirty`
                        // as `false`.
                        form.resetFields();
                        blocker.proceed?.();
                    } else {
                        closePanel();
                    }
                }}
                open={
                    pendingClose ||
                    (blocker.state === "blocked" &&
                        blocker.location?.pathname !==
                            `/projects/${projectId}/board/task/${taskId}`)
                }
                title={microcopy.taskDetailPanel.confirmDiscardTitle}
                width={Math.min(420, breakpoints.sm)}
            >
                {microcopy.taskDetailPanel.confirmDiscardBody}
            </Modal>
        </Drawer>
    );
};

export default TaskDetailPanel;
