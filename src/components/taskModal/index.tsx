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

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, modalWidthCss, space } from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useMembersList from "../../utils/hooks/useMembersList";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
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

const TaskModal: React.FC<{
    tasks: ITask[] | undefined;
    boardAiOn?: boolean;
}> = ({ tasks, boardAiOn = true }) => {
    const [form] = useForm();
    const { projectId } = useParams<{ projectId: string }>();
    const { editingTaskId, startEditing, closeModal } = useTaskModal();
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
        try {
            await update(merged);
            setSaveError(null);
            message.success(microcopy.feedback.taskSaved);
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
                 * On phone widths the buttons stack full-width. The visual
                 * order is Save (primary) → Cancel → Delete (destructive last)
                 * so users do not accidentally tap the destructive control
                 * with a thumb reaching for the primary action. On tablet+
                 * we keep the conventional Delete-left, Cancel/Save-right
                 * arrangement that matches the rest of the app's modal
                 * footers.
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
                            <OkBtn />
                            <CancelBtn />
                            {deleteButton}
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
                     */
                    maxHeight: screens.sm
                        ? "calc(100dvh - 220px - env(keyboard-inset-height, 0px))"
                        : "calc(100dvh - 320px - env(keyboard-inset-height, 0px))",
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
                                onOpenSimilarTask={(taskId) =>
                                    startEditing(taskId)
                                }
                                values={liveValues}
                            />
                        )}
                </div>
            </div>
        </Modal>
    );
};

export default TaskModal;
