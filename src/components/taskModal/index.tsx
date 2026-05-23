import {
    Alert,
    Button,
    Form,
    Grid,
    Input,
    message,
    Modal,
    Select,
    Spin,
    Tag,
    Typography
} from "antd";
import { useForm } from "antd/lib/form/Form";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, modalWidthCss, space } from "../../theme/tokens";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useMembersList from "../../utils/hooks/useMembersList";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import AiGhostText, {
    AI_PRIVACY_CONSENT_EVENT,
    type AiPrivacyConsentEventDetail
} from "../aiGhostText";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
import { CopilotPrivacyDisclosure } from "../copilotPrivacyPopover";
import ErrorBox from "../errorBox";

// Replaces lodash/isEqual for the modal's diff check. ITask is a flat
// object (see src/interfaces/task.d.ts) — every field is a primitive, so
// a shallow comparison is sufficient. Arrays are still handled
// element-by-element in case the shape evolves to include one.
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

type TaskModalField =
    | "coordinatorId"
    | "epic"
    | "note"
    | "storyPoints"
    | "taskName"
    | "type";

const TASK_MODAL_FIELDS: readonly TaskModalField[] = [
    "taskName",
    "note",
    "type",
    "epic",
    "coordinatorId",
    "storyPoints"
];

const isTaskModalField = (field: string): field is TaskModalField =>
    TASK_MODAL_FIELDS.includes(field as TaskModalField);

/**
 * Form-binding adapter for the ghost-text-wrapped notes textarea. AntD
 * `Form.Item` injects `value` / `onChange` into its direct child, so the
 * adapter intercepts that pair and feeds the live partial back into the
 * `<AiGhostText>` context so the local engine sees the user's most recent
 * keystroke. The wrapped textarea keeps every prop the bare
 * `Input.TextArea` had (placeholder, rows, inputMode, etc.) — they just
 * move through the adapter unchanged.
 */
const AiGhostTextNoteField: React.FC<{
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    columnId?: string;
    projectId?: string;
    taskName?: string;
    type?: "Task" | "Bug";
}> = ({ value, onChange, columnId, projectId, taskName, type }) => {
    const project = useCachedQueryData<IProject>(["projects", { projectId }]);
    const columns =
        useCachedQueryData<IColumn[]>(["boards", { projectId }]) ?? [];
    const currentColumn = columns.find((column) => column._id === columnId);
    return (
        <AiGhostText
            route="task-note"
            context={{
                projectName: project?.projectName,
                columnName: currentColumn?.columnName,
                taskName,
                type,
                currentValue: value ?? ""
            }}
        >
            <Input.TextArea
                autoComplete="off"
                enterKeyHint="done"
                inputMode="text"
                onChange={onChange}
                placeholder={microcopy.placeholders.notesAcceptanceCriteria}
                rows={4}
                value={value}
            />
        </AiGhostText>
    );
};

const TaskModal: React.FC<{
    tasks: ITask[] | undefined;
    boardAiOn?: boolean;
}> = ({ tasks, boardAiOn = true }) => {
    const [form] = useForm();
    const { projectId } = useParams<{ projectId: string }>();
    const { editingTaskId, startEditing, closeModal } = useTaskModal();
    const { openTask } = useTaskPanelNavigation();
    const { enabled: aiEnabled } = useAiEnabled();
    const screens = Grid.useBreakpoint();
    const [formTick, setFormTick] = useState(0);
    const [saveError, setSaveError] = useState<Error | null>(null);
    const [appliedFieldOrigin, setAppliedFieldOrigin] = useState<
        Partial<Record<TaskModalField, "copilot">>
    >({});
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
        // Suppress useReactMutation's auto-revert toast; the per-call
        // mutate(..., { onError }) below shows a task-specific message.
        () => {}
    );
    // Re-create + re-update mutations used only as undo closures from the
    // activity feed (Phase 4.3). They share the same react-query cache key
    // so the optimistic update lands in the same list the UI is reading.
    const { mutateAsync: recreate } = useReactMutation(
        "tasks",
        "POST",
        ["tasks", { projectId }],
        newTaskCallback,
        // The undo path is fire-and-forget per brief — if it fails the
        // user has already moved on; the empty handler keeps
        // useReactMutation's auto-toast suppressed.
        () => {}
    );
    const { mutateAsync: undoUpdate } = useReactMutation(
        "tasks",
        "PUT",
        ["tasks", { projectId }],
        undefined,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const editingTask = tasks?.find((task) => task._id === editingTaskId);
    const tasksStillLoading = tasks === undefined;
    const placeholderId = Boolean(
        editingTaskId && isOptimisticPlaceholderId(editingTaskId)
    );
    // When the underlying task disappears from the resolved list while the
    // user has unsaved edits, keep the modal open with a non-dismissable
    // banner instead of silently closing and ``resetFields``-ing the
    // dirty payload. Without this guard a concurrent delete or refetch
    // discards in-flight edits with no warning — a real data-loss bug,
    // see review note ``ui-ux-comprehensive-review-2026-05.md`` §"Critical
    // bugs that ship today".
    const taskMissingAfterLoad =
        Boolean(editingTaskId) &&
        !placeholderId &&
        !tasksStillLoading &&
        !editingTask;
    const hasDirtyEdits = taskMissingAfterLoad && form.isFieldsTouched();
    const modalOpen =
        Boolean(editingTaskId) &&
        (placeholderId
            ? Boolean(editingTask)
            : tasksStillLoading || Boolean(editingTask) || hasDirtyEdits);
    const awaitingTaskResolution =
        Boolean(editingTaskId) && !placeholderId && tasksStillLoading;
    const { data: membersData } = useMembersList();
    const members = membersData ?? [];

    const onClose = useCallback(() => {
        form.resetFields();
        setSaveError(null);
        setAppliedFieldOrigin({});
        closeModal();
    }, [closeModal, form]);

    const markFieldAsCopilotApplied = useCallback((field: TaskModalField) => {
        setAppliedFieldOrigin((prev) => ({ ...prev, [field]: "copilot" }));
    }, []);

    const clearOriginOnManualEdits = useCallback(
        (changedValues: Record<string, unknown>) => {
            const changedFields =
                Object.keys(changedValues).filter(isTaskModalField);
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

    const onOk = async () => {
        if (!editingTask) {
            return;
        }
        try {
            await form.validateFields();
        } catch {
            // AntD has surfaced inline errors on the failing fields; bail
            // so we never persist a half-validated payload.
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
            closeModal();
            return;
        }
        // Capture the before-state for the activity-feed undo closure
        // BEFORE the server PUT lands — once the cache flips to the
        // updated payload the original values would be lost.
        const beforeState: ITask = { ...editingTask };
        try {
            await update(merged);
            setSaveError(null);
            message.success(microcopy.feedback.taskSaved);
            // Phase 4.3 — record the update into the activity feed only
            // after the server confirms. Undo PUTs the captured
            // before-state through the same react-query mutation so the
            // cache and the server move back in lockstep.
            recordActivity({
                kind: "task",
                action: "update",
                summary: microcopyString(
                    microcopy.activityFeed.descriptions.taskUpdated
                ).replace("{name}", merged.taskName),
                undo: () => {
                    // `MutationParam` is an open string-indexed record;
                    // `ITask` is structurally identical at runtime but
                    // its declared shape doesn't carry the index
                    // signature, hence the assertion.
                    void undoUpdate(
                        beforeState as unknown as Record<string, unknown>
                    );
                }
            });
            onClose();
        } catch {
            // ErrorBox surfaces the message via the onError callback above;
            // keep the modal open so the user can retry without re-entering
            // their changes.
        }
    };

    const onDelete = () => {
        if (!editingTask) {
            return;
        }
        const taskName = editingTask.taskName;
        const taskId = editingTaskId;
        // Capture the full task payload before the DELETE so the
        // activity-feed undo can re-POST it via the create mutation.
        const beforeState: ITask = { ...editingTask };
        Modal.confirm({
            centered: true,
            okText: microcopy.confirm.deleteTask.confirmLabel,
            cancelText: microcopy.actions.cancel,
            okButtonProps: { danger: true },
            title: microcopy.confirm.deleteTask.title,
            content: microcopy.confirm.deleteTask.description,
            onOk() {
                remove(
                    { taskId },
                    {
                        onSuccess: () => {
                            message.success(microcopy.feedback.taskDeleted);
                            // Phase 4.3 — record the delete into the
                            // activity feed only after the server
                            // confirms. The undo closure re-POSTs the
                            // captured task so the user can recover from
                            // an accidental destructive action.
                            recordActivity({
                                kind: "task",
                                action: "delete",
                                summary: microcopyString(
                                    microcopy.activityFeed.descriptions
                                        .taskDeleted
                                ).replace("{name}", taskName),
                                undo: () => {
                                    void recreate(
                                        beforeState as unknown as Record<
                                            string,
                                            unknown
                                        >
                                    );
                                }
                            });
                            onClose();
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

    useEffect(() => {
        if (!editingTask) {
            return;
        }
        form.setFieldsValue(editingTask);
    }, [form, editingTask]);

    useEffect(() => {
        if (
            !editingTaskId ||
            isOptimisticPlaceholderId(editingTaskId) ||
            tasks === undefined
        ) {
            return;
        }
        // Preserve dirty edits if the task vanished between renders — the
        // banner inside the modal (see ``taskMissingAfterLoad`` above) is
        // the user's recovery path. Only auto-close when the user has not
        // touched the form, so the previous "task gone -> close cleanly"
        // path still works for read-only viewers.
        if (!editingTask && !form.isFieldsTouched()) {
            onClose();
        }
    }, [editingTask, editingTaskId, form, onClose, tasks]);

    // Clear stale save errors when the user opens a different task; the
    // previous error referred to the prior payload and would mislead.
    useEffect(() => {
        setSaveError(null);
        setAppliedFieldOrigin({});
    }, [editingTaskId]);

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
        !editingTask || dLoading || isOptimisticPlaceholderId(editingTaskId);

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

    return (
        <Modal
            confirmLoading={uLoading}
            centered
            forceRender
            okText={microcopy.actions.save}
            okButtonProps={{
                disabled: !editingTask || uLoading,
                size: "large",
                block: !screens.sm
            }}
            cancelButtonProps={{ size: "large", block: !screens.sm }}
            onOk={onOk}
            cancelText={microcopy.actions.cancel}
            onCancel={onClose}
            footer={(_originalFooter, { OkBtn, CancelBtn }) => {
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
                        block={!screens.sm}
                        danger
                        disabled={deleteDisabled}
                        onClick={onDelete}
                        type="text"
                    >
                        {microcopy.actions.delete}
                    </Button>
                );
                /*
                 * On phone widths the buttons stack full-width with the
                 * primary action in the thumb zone (bottom of the stack)
                 * and the destructive Delete at the top of the stack,
                 * de-emphasised as a danger-coloured text button. The
                 * thumb-down reach is reserved for Save, Cancel sits
                 * directly above it, and Delete is intentionally far from
                 * the primary tap target. Desktop / tablet keeps the
                 * conventional Delete-left, Cancel/Save-right
                 * arrangement. See QW-19 in
                 * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
                 */
                if (!screens.sm) {
                    return (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: space.xs
                            }}
                        >
                            {deleteButton}
                            <CancelBtn />
                            <OkBtn />
                        </div>
                    );
                }
                return (
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
                        <div
                            style={{
                                display: "flex",
                                flex: "0 0 auto",
                                flexWrap: "wrap",
                                gap: space.xs,
                                justifyContent: "flex-end"
                            }}
                        >
                            <CancelBtn />
                            <OkBtn />
                        </div>
                    </div>
                );
            }}
            title={titleNode}
            open={modalOpen}
            styles={{
                body: {
                    /*
                     * Phone widths render the title across two lines and
                     * stack three full-height buttons in the footer
                     * (Save / Cancel / Delete), which together consume
                     * roughly 280 px of chrome — well over the 220 px the
                     * desktop layout reserves. Without a tighter cap the
                     * footer falls below the viewport on a 390 × 844
                     * device and the destructive Delete control becomes
                     * unreachable without scrolling the page behind the
                     * modal. The extra `env(keyboard-inset-height)`
                     * subtraction keeps the footer above the iOS soft
                     * keyboard when it opens — see QW-18 in
                     * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
                     *
                     * The phone branch wraps the calc in `max(80px, …)` so
                     * the maxHeight never goes negative on landscape
                     * orientation when the keyboard is up — a 375 × 667
                     * iPhone in landscape with `interactive-widget=resizes-
                     * content` reports `100dvh` ≈ 375 px, then the 320 px
                     * chrome reserve plus a ~260 px keyboard inset would
                     * push the result well past zero and collapse the
                     * modal body. The 80 px floor leaves at least a sliver
                     * of scrollable content in pathological cases (Bug 6).
                     */
                    maxHeight: screens.sm
                        ? "calc(100dvh - 220px - env(keyboard-inset-height, 0px))"
                        : "max(80px, calc(100dvh - 320px - env(keyboard-inset-height, 0px)))",
                    overflowY: "auto"
                }
            }}
            width={modalWidthCss(640)}
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
                                    onClick={onClose}
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
                    {/* TODO(ui-ux-comprehensive-review-2026-05 · §"Critical
                     * bugs that ship today" · Bug 3): pair this banner
                     * with a "Save as new" CTA that POSTs the dirty
                     * fields through the existing create-task mutation
                     * once the routed-task-panel refactor (A2) lands.
                     * The Discard button above is the minimum viable
                     * recovery — the data-loss bug is closed; the more
                     * complete UX awaits the panel rewrite. */}
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
                                options={members.map((member) => ({
                                    label: member.username,
                                    value: member._id
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
                        {environment.aiGhostTextEnabled &&
                        aiEnabled &&
                        boardAiOn ? (
                            <CopilotPrivacyDisclosure
                                onAcknowledge={() => {
                                    // The HTML spec restricts the
                                    // `storage` event to *other* tabs, so
                                    // the writer never sees its own
                                    // write. Without this dispatch the
                                    // already-mounted `<AiGhostText>`
                                    // would only pick up consent on the
                                    // next modal close/reopen — which is
                                    // exactly the regression the reviewer
                                    // flagged.
                                    const detail: AiPrivacyConsentEventDetail =
                                        { route: "task-note" };
                                    window.dispatchEvent(
                                        new CustomEvent(
                                            AI_PRIVACY_CONSENT_EVENT,
                                            { detail }
                                        )
                                    );
                                }}
                                /*
                                 * Wave 4 follow-up: pass `route` so the
                                 * disclosure reads the task-note scope
                                 * from `getAiDataScope` and surfaces
                                 * the ghost-text-specific data list
                                 * (column / task name / type / in-
                                 * progress note text) instead of the
                                 * generic global summary. The explicit
                                 * `storageKey` is kept for the existing
                                 * acknowledgement state — the default
                                 * resolved from `route` would match
                                 * (`boardCopilot:privacyShown:task-note`)
                                 * but pinning the key here documents
                                 * the contract for the test fixtures
                                 * that pre-set it.
                                 */
                                route="task-note"
                                storageKey="boardCopilot:privacyShown:task-note"
                            />
                        ) : null}
                        <Form.Item label={microcopy.fields.notes} name="note">
                            {environment.aiGhostTextEnabled &&
                            aiEnabled &&
                            boardAiOn ? (
                                <AiGhostTextNoteField
                                    columnId={editingTask?.columnId}
                                    projectId={projectId}
                                    taskName={liveValues.taskName}
                                    type={
                                        liveValues.type === "Bug"
                                            ? "Bug"
                                            : "Task"
                                    }
                                />
                            ) : (
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
                            )}
                        </Form.Item>
                    </Form>
                    {aiEnabled &&
                        boardAiOn &&
                        editingTask &&
                        editingTaskId &&
                        !isOptimisticPlaceholderId(editingTaskId) && (
                            <AiTaskAssistPanel
                                excludeTaskId={editingTaskId}
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
                                        isTaskModalField(field)
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
                                onOpenSimilarTask={(taskId) => {
                                    // Flag-aware hand-off — TaskModal is
                                    // only mounted when the flag is off,
                                    // so this branch is for symmetry with
                                    // TaskDetailPanel's twin handler.
                                    if (environment.taskPanelRouted) {
                                        openTask(taskId, projectId);
                                    } else {
                                        startEditing(taskId);
                                    }
                                }}
                                values={liveValues}
                            />
                        )}
                </div>
            </div>
        </Modal>
    );
};

export default TaskModal;
