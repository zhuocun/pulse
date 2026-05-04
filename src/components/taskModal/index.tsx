import {
    Button,
    Form,
    Grid,
    Input,
    message,
    Modal,
    Select,
    Tag,
    Typography
} from "antd";
import { useForm } from "antd/lib/form/Form";
import isEqual from "lodash/isEqual";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, modalWidthCss, space } from "../../theme/tokens";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
import ErrorBox from "../errorBox";

const buildTypeOptions = () => [
    { label: microcopy.options.taskTypes.task, value: "Task" },
    { label: microcopy.options.taskTypes.bug, value: "Bug" }
];

const STORY_POINT_OPTIONS = [1, 2, 3, 5, 8, 13].map((value) => ({
    label: `${value}`,
    value
}));

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
    const { mutateAsync: update, isLoading: uLoading } = useReactMutation(
        "tasks",
        "PUT",
        undefined,
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
    const members = useCachedQueryData<IMember[]>(["users/members"]) ?? [];

    const onClose = useCallback(() => {
        form.resetFields();
        setSaveError(null);
        closeModal();
    }, [closeModal, form]);

    const onOk = async () => {
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
        if (isEqual(merged, editingTask)) {
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
        const taskName = editingTask?.taskName;
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
                                taskName
                                    ? microcopy.feedback.couldntDeleteTask.replace(
                                          "{name}",
                                          taskName
                                      )
                                    : microcopy.feedback.saveFailed
                            )
                    }
                );
            }
        });
    };

    useEffect(() => {
        form.setFieldsValue(editingTask);
    }, [form, editingTask]);

    useEffect(() => {
        if (!editingTaskId || editingTaskId === "mock" || tasks === undefined) {
            return;
        }
        if (!editingTask) {
            onClose();
        }
    }, [editingTask, editingTaskId, onClose, tasks]);

    // Clear stale save errors when the user opens a different task; the
    // previous error referred to the prior payload and would mislead.
    useEffect(() => {
        setSaveError(null);
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
        !editingTask || dLoading || editingTaskId === "mock";

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
            okButtonProps={{ size: "large", block: !screens.sm }}
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
            open={Boolean(editingTaskId && editingTask)}
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
                     * modal.
                     */
                    maxHeight: screens.sm
                        ? "calc(100dvh - 220px)"
                        : "calc(100dvh - 320px)",
                    overflowY: "auto"
                }
            }}
            width={modalWidthCss(640)}
        >
            <ErrorBox error={saveError} />
            <Form
                form={form}
                initialValues={editingTask}
                layout="vertical"
                onValuesChange={() => {
                    setFormTick((tick) => tick + 1);
                    if (saveError) setSaveError(null);
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
                            message: microcopy.validation.coordinatorRequired
                        }
                    ]}
                >
                    <Select
                        options={members.map((member) => ({
                            label: member.username,
                            value: member._id
                        }))}
                        placeholder={`Select a ${microcopy.fields.coordinator.toLowerCase()}`}
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
                >
                    <Select
                        options={buildTypeOptions()}
                        placeholder={`Select a ${microcopy.fields.type.toLowerCase()}`}
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
                    label={microcopy.fields.storyPoints}
                    name="storyPoints"
                >
                    <Select
                        options={STORY_POINT_OPTIONS}
                        placeholder={`Select ${microcopy.fields.storyPoints.toLowerCase()}`}
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
                editingTaskId &&
                editingTaskId !== "mock" && (
                    <AiTaskAssistPanel
                        excludeTaskId={editingTaskId}
                        onApplyStoryPoints={(value) => {
                            form.setFieldsValue({ storyPoints: value });
                            setFormTick((tick) => tick + 1);
                        }}
                        onApplySuggestion={(field, suggestion, options) => {
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
                                form.setFieldsValue({ [field]: suggestion });
                            }
                            setFormTick((tick) => tick + 1);
                        }}
                        onOpenSimilarTask={(taskId) => startEditing(taskId)}
                        values={liveValues}
                    />
                )}
        </Modal>
    );
};

export default TaskModal;
