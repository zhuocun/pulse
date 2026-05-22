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
import {
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useRef,
    useState
} from "react";
import { useBlocker, useNavigate } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { breakpoints, fontSize, fontWeight, space } from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
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
    const isPhone = useIsPhoneChrome();
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
     * `navigate(...)`, browser back, iOS swipe-back, and Android
     * system back, because react-router 7's blocker hooks into the
     * History API for all three. The mask-click path is handled
     * separately by `requestClose` below; both surfaces converge on
     * the same `Modal.confirm`.
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

    // Placement matches the chassis `useIsPhoneChrome` signal so the
    // bottom-tab bar and the panel never collide on touchscreen
    // laptops / tablets (B-H1).
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
                            const nextDirty = !shallowEqual(
                                merged,
                                editingTask
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
                                        `/projects/${projectId}/board/task/${otherTaskId}`,
                                        { viewTransition: true }
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
        </Drawer>
    );
};

export default TaskDetailPanel;
