import {
    Alert,
    Button,
    Col,
    Collapse,
    DatePicker,
    Dropdown,
    Form,
    Grid,
    Input,
    Row,
    Select,
    Spin,
    Tag,
    Typography
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { useForm } from "antd/lib/form/Form";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, modalWidthCss, space } from "../../theme/tokens";
import filterRequest from "../../utils/filterRequest";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useLabels from "../../utils/hooks/useLabels";
import useMembersList from "../../utils/hooks/useMembersList";
import useMilestones from "../../utils/hooks/useMilestones";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import useUnsavedChangesGuard from "../../utils/hooks/useUnsavedChangesGuard";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import AiGhostText, {
    AI_PRIVACY_CONSENT_EVENT,
    type AiPrivacyConsentEventDetail
} from "../aiGhostText";
import AiRewritePanel from "../aiRewritePanel";
import AiTaskAssistPanel from "../aiTaskAssistPanel";
import CommentsThread from "../commentsThread";
import { CopilotPrivacyDisclosure } from "../copilotPrivacyPopover";
import ErrorBox from "../errorBox";
import ResponsiveFormSheet from "../responsiveFormSheet";

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

/**
 * Priority `Select` options (PRD §3.4). The value list is the single-sourced
 * `TaskPriorityLevel` union so the modal, the card badge, and the lens can never
 * drift; the labels come from the localized `options.priorities` dictionary.
 * `none` is included so a task can be explicitly de-prioritised back to the
 * default (which renders no card badge).
 */
const PRIORITY_OPTIONS: { label: string; value: TaskPriorityLevel }[] = (
    ["none", "low", "medium", "high", "urgent"] as const
).map((value) => ({
    label: microcopy.options.priorities[value],
    value
}));

/**
 * `startDate` / `dueDate` persist as date-only ISO strings (`YYYY-MM-DD`).
 * AntD's `DatePicker` works in `Dayjs`, so we convert at the form boundary:
 * `taskToFormValues` maps the stored string → a `Dayjs` for the control,
 * and `normalizeDateFields` maps the `Dayjs` back to a `YYYY-MM-DD` string
 * for the submit payload (and the `shallowEqual` dirty-check). Using
 * date-only (not a full timestamp) keeps the value timezone-stable — the
 * lens predicates compare local-calendar dates, so a midnight-straddling
 * timestamp would drift the "Today"/"This week" buckets.
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
 * Map an `ITask` into the shape AntD `Form` expects for THIS modal — every
 * field passes through unchanged except the two date fields, which become
 * `Dayjs` instances (or `undefined` when unset / unparsable) so the
 * `DatePicker` controls bind correctly.
 */
const taskToFormValues = (task: ITask): TaskFormValues => ({
    ...task,
    startDate: toDayjsOrUndefined(task.startDate),
    dueDate: toDayjsOrUndefined(task.dueDate)
    // `dependsOn` is seeded by the `...task` spread above (same as
    // `labelIds` / `assigneeIds`): an absent value stays `undefined` (which
    // `filterRequest` strips on both sides of the dirty-check, so an
    // untouched task fires no needless PUT), while an explicit cleared `[]`
    // is kept and reaches the wire so the backend removes the edges.
});

/**
 * Convert any `Dayjs` date-field values in a raw form payload back to
 * date-only ISO strings, leaving every other field untouched. An empty /
 * cleared picker is left as its falsy value (`undefined` / `null`), which
 * `filterRequest` strips before the POST/PUT and which the dirty-check
 * normalizes away too — so an unset date is simply absent from the payload.
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

type TaskModalField =
    | "coordinatorId"
    | "dependsOn"
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
    "storyPoints",
    "dependsOn"
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
/**
 * A Form.Item label that appends a "Suggested by Copilot" provenance tag
 * when the field's most recent value came from an AI Apply (§2.A.8). The
 * tag clears as soon as the user edits the field (see
 * `clearOriginOnManualEdits`).
 */
const FieldLabelWithProvenance: React.FC<{
    label: React.ReactNode;
    suggested: boolean;
}> = ({ label, suggested }) => (
    <span
        style={{
            alignItems: "center",
            display: "inline-flex",
            gap: space.xs
        }}
    >
        {label}
        {suggested ? (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                {microcopy.ai.suggestedByCopilot}
            </Tag>
        ) : null}
    </span>
);

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
    // AntD v6: static `message` warns about dynamic theme;
    // `useAppMessage()` returns a theme-aware instance (with a static
    // fallback for tests that render without `<App>`).
    const message = useAppMessage();
    const [form] = useForm();
    const { projectId } = useParams<{ projectId: string }>();
    const { editingTaskId, startEditing, closeModal } = useTaskModal();
    const { openTask } = useTaskPanelNavigation();
    const { enabled: aiEnabled } = useAiEnabled();
    const screens = Grid.useBreakpoint();
    const isPhone = useIsPhoneChrome();
    const titleId = useId();
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
        (err) => setSaveError(err),
        // `setCache` stays default; the trailing list opts these clearable
        // scalar/date keys into `filterRequest`'s preserve path so a cleared
        // (`null`/`""`) value reaches the PUT and the backend CLEARS the
        // field instead of treating the stripped/absent key as unchanged.
        undefined,
        ["milestoneId", "parentTaskId", "startDate", "dueDate"]
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
    const { show: showUndoToast } = useUndoToast();
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
    // Project labels + project-member roster power the new richness
    // pickers. Both are keyed per-project and disabled until `projectId`
    // resolves (see the hooks). `useLabels` exposes the list for the
    // tag-mode label Select; `useProjectMembers` hits
    // `/projects/members` (the project roster) rather than `useMembersList`'s
    // global `/users/members` directory, so the assignee picker offers
    // only the people actually on this project.
    const { labels: labelsData } = useLabels(projectId);
    const labels = useMemo(() => labelsData ?? [], [labelsData]);
    // Project milestones power the clearable single-select milestone picker.
    // Keyed per-project + disabled until `projectId` resolves (see the hook);
    // `task.milestoneId` rides the same `merged` → `tasks` PUT as every other
    // richness field — same shape/path as `parentTaskId`, no separate write.
    const { data: milestones } = useMilestones(projectId);
    const { data: projectMembersData } = useProjectMembers(projectId);
    // Guard against a non-array payload (errored / stubbed response sharing
    // the query cache) so the assignee `.map` below never throws — mirrors
    // the `Array.isArray` normalization `useLabels` / `useNotifications` do.
    const projectMembers = useMemo(
        () => (Array.isArray(projectMembersData) ? projectMembersData : []),
        [projectMembersData]
    );
    // Parent-task options: every OTHER task in the project (a task can't be
    // its own parent). Clearable + optional.
    const parentTaskOptions = useMemo(
        () =>
            (tasks ?? [])
                .filter((candidate) => candidate._id !== editingTaskId)
                .map((candidate) => ({
                    label: candidate.taskName,
                    value: candidate._id
                })),
        [tasks, editingTaskId]
    );
    // Milestone options: the project's milestones (single-select, clearable).
    // Mirrors `parentTaskOptions` — `task.milestoneId` is the same
    // `string | null` FK shape and rides the identical `tasks` PUT path.
    const milestoneOptions = useMemo(
        () =>
            (milestones ?? []).map((m) => ({
                label: m.name,
                value: m._id
            })),
        [milestones]
    );
    // Dependency options (PRD §4.5): the same-project tasks this one may
    // depend on — every OTHER task (a task can't depend on itself). Mirrors
    // `parentTaskOptions`; the backend rejects a self / cross-project /
    // cycle-forming edit with a 400 that surfaces through `ErrorBox`.
    const dependencyOptions = useMemo(
        () =>
            (tasks ?? [])
                .filter((candidate) => candidate._id !== editingTaskId)
                .map((candidate) => ({
                    label: candidate.taskName,
                    value: candidate._id
                })),
        [tasks, editingTaskId]
    );
    // Inverse of `dependsOn`, computed client-side from the project task
    // list: the tasks that list THIS task among their prerequisites — i.e.
    // the tasks this one blocks. Read-only; nothing here is persisted.
    const blocksOptions = useMemo(
        () =>
            (tasks ?? [])
                .filter(
                    (candidate) =>
                        Array.isArray(candidate.dependsOn) &&
                        candidate.dependsOn.includes(editingTaskId as string)
                )
                .map((candidate) => ({
                    label: candidate.taskName,
                    value: candidate._id
                })),
        [tasks, editingTaskId]
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

    const onClose = useCallback(() => {
        form.resetFields();
        setSaveError(null);
        setAppliedFieldOrigin({});
        closeModal();
    }, [closeModal, form]);

    // §2.A.1 — guard the cancel / mask-close paths so unsaved edits aren't
    // discarded without a prompt. An untouched form closes immediately.
    const { requestClose, confirmNode } = useUnsavedChangesGuard({
        isDirty: () => form.isFieldsTouched(),
        onConfirmDiscard: onClose
    });

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
        // Date pickers hand back `Dayjs` instances; normalize them to
        // date-only ISO strings so the dirty-check and the persisted
        // payload both carry the same string shape the backend stores.
        const fieldValues = normalizeDateFields(form.getFieldsValue());
        const rawName = fieldValues.taskName;
        const trimmedName =
            typeof rawName === "string" ? rawName.trim() : editingTask.taskName;
        const merged = {
            ...editingTask,
            ...fieldValues,
            taskName: trimmedName
        } as ITask;
        // Clearable FK / date fields share the milestone pattern: the
        // single-select / date picker clears to `undefined`, so convert each
        // to an explicit `null` so the (opt-in `preserveNullKeys`) PUT carries
        // the cleared key and the backend CLEARS the field (a stripped/absent
        // key would leave it unchanged). Harmless when already unset
        // (null → backend no-op); the default-stripped dirty-check below treats
        // an untouched unset field as equal so no needless PUT fires.
        merged.milestoneId = merged.milestoneId ?? null;
        merged.parentTaskId = merged.parentTaskId ?? null;
        merged.startDate = merged.startDate ?? null;
        merged.dueDate = merged.dueDate ?? null;
        // Compare the FILTERED payloads. The form now registers optional
        // fields (dates, labelIds, assigneeIds, parentTaskId) that read back
        // as `undefined` / `null` / `""` when unset; `filterRequest` strips
        // those void keys from both sides (exactly as the wire payload would
        // be), so an untouched task with no richness still compares equal and
        // closes without a needless PUT instead of tripping the key-count
        // check.
        if (
            shallowEqual(
                filterRequest(merged as unknown as Record<string, unknown>),
                filterRequest(editingTask as unknown as Record<string, unknown>)
            )
        ) {
            closeModal();
            return;
        }
        // Capture the before-state for the activity-feed undo closure
        // BEFORE the server PUT lands — once the cache flips to the
        // updated payload the original values would be lost.
        const beforeState: ITask = { ...editingTask };
        try {
            // `MutationParam` is an open string-indexed record; `ITask` is
            // structurally compatible at runtime but its declared shape
            // carries no index signature, hence the assertion (matches the
            // `undoUpdate(beforeState …)` cast below).
            await update(merged as unknown as Record<string, unknown>);
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
        // Capture the full task payload before the DELETE so the Undo
        // toast (and the activity-feed undo) can re-POST it via the
        // create mutation. After the optimistic prune the cache no
        // longer carries it.
        const beforeState: ITask = { ...editingTask };
        // §2.A.4 — task delete is reversible, so it skips Modal.confirm
        // and goes straight to an optimistic delete + Undo toast. The
        // undo closure re-creates the just-deleted task with the captured
        // snapshot so an accidental delete is recoverable within the
        // window; once the window lapses the delete stands.
        remove(
            { taskId },
            {
                onError: () =>
                    message.error(
                        microcopy.feedback.couldntDeleteTask.replace(
                            "{name}",
                            taskName
                        )
                    )
            }
        );
        showUndoToast({
            description: microcopy.feedback.taskDeleted,
            analyticsTag: "task.delete",
            undo: async () => {
                await recreate(
                    beforeState as unknown as Record<string, unknown>
                );
            }
        });
        // Phase 4.3 — also record the delete into the activity feed so the
        // bell-icon log keeps a longer-lived recovery path beyond the
        // transient toast window. Both undo paths replay the same captured
        // snapshot through the create mutation.
        recordActivity({
            kind: "task",
            action: "delete",
            summary: microcopyString(
                microcopy.activityFeed.descriptions.taskDeleted
            ).replace("{name}", taskName),
            undo: () => {
                void recreate(
                    beforeState as unknown as Record<string, unknown>
                );
            }
        });
        onClose();
    };

    useEffect(() => {
        if (!editingTask) {
            return;
        }
        // Convert the stored ISO date strings into `Dayjs` so the
        // `DatePicker` controls bind (they reject bare strings).
        form.setFieldsValue(taskToFormValues(editingTask));
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

    const showAiAssist =
        aiEnabled &&
        boardAiOn &&
        Boolean(editingTask) &&
        Boolean(editingTaskId) &&
        !isOptimisticPlaceholderId(editingTaskId);

    const aiAssistNode =
        showAiAssist && editingTaskId ? (
            <AiTaskAssistPanel
                excludeTaskId={editingTaskId}
                onApplyStoryPoints={(value) => {
                    markFieldAsCopilotApplied("storyPoints");
                    form.setFieldsValue({ storyPoints: value });
                    setFormTick((tick) => tick + 1);
                }}
                onApplySuggestion={(field, suggestion, options) => {
                    if (
                        !options?.replace &&
                        suggestion !== undefined &&
                        isTaskModalField(field)
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
                        form.setFieldsValue({ [field]: suggestion });
                    }
                    setFormTick((tick) => tick + 1);
                }}
                onOpenSimilarTask={(taskId) => {
                    // Flag-aware hand-off — TaskModal is only mounted when
                    // the flag is off, so this branch is for symmetry with
                    // TaskDetailPanel's twin handler.
                    if (environment.taskPanelRouted) {
                        openTask(taskId, projectId);
                    } else {
                        startEditing(taskId);
                    }
                }}
                values={liveValues}
            />
        ) : null;

    const formNode = (
        <Form
            form={form}
            initialValues={
                editingTask ? taskToFormValues(editingTask) : undefined
            }
            layout="vertical"
            onValuesChange={(changedValues) => {
                setFormTick((tick) => tick + 1);
                if (saveError) setSaveError(null);
                clearOriginOnManualEdits(changedValues);
            }}
        >
            <Form.Item
                label={
                    <FieldLabelWithProvenance
                        label={microcopy.fields.taskName}
                        suggested={appliedFieldOrigin.taskName === "copilot"}
                    />
                }
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
                label={
                    <FieldLabelWithProvenance
                        label={microcopy.fields.coordinator}
                        suggested={
                            appliedFieldOrigin.coordinatorId === "copilot"
                        }
                    />
                }
                name="coordinatorId"
                required
                rules={[
                    {
                        required: true,
                        message: microcopy.validation.coordinatorRequired
                    }
                ]}
                validateTrigger={["onBlur", "onSubmit"]}
            >
                <Select
                    options={members.map((member) => ({
                        label: member.username,
                        value: member._id
                    }))}
                    placeholder={microcopy.placeholders.selectCoordinator}
                />
            </Form.Item>
            <Form.Item
                label={
                    <FieldLabelWithProvenance
                        label={microcopy.fields.type}
                        suggested={appliedFieldOrigin.type === "copilot"}
                    />
                }
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
            <Collapse
                ghost
                items={[
                    {
                        key: "more-details",
                        label: microcopy.taskModal.moreDetails,
                        children: (
                            <>
                                <Form.Item
                                    label={
                                        <FieldLabelWithProvenance
                                            label={microcopy.fields.epic}
                                            suggested={
                                                appliedFieldOrigin.epic ===
                                                "copilot"
                                            }
                                        />
                                    }
                                    name="epic"
                                >
                                    <Input
                                        autoComplete="off"
                                        enterKeyHint="next"
                                        inputMode="text"
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={
                                        <FieldLabelWithProvenance
                                            label={microcopy.fields.storyPoints}
                                            suggested={
                                                appliedFieldOrigin.storyPoints ===
                                                "copilot"
                                            }
                                        />
                                    }
                                    name="storyPoints"
                                >
                                    <Select
                                        onChange={() => {
                                            setAppliedFieldOrigin((prev) => {
                                                if (!prev.storyPoints)
                                                    return prev;
                                                const next = { ...prev };
                                                delete next.storyPoints;
                                                return next;
                                            });
                                        }}
                                        options={STORY_POINT_OPTIONS}
                                        placeholder={
                                            microcopy.placeholders
                                                .selectStoryPoints
                                        }
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={microcopy.fields.priority}
                                    name="priority"
                                >
                                    <Select
                                        options={PRIORITY_OPTIONS}
                                        placeholder={
                                            microcopy.placeholders
                                                .selectPriority
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
                                        placeholder={
                                            microcopy.placeholders
                                                .selectStartDate
                                        }
                                        style={{ width: "100%" }}
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={microcopy.fields.dueDate}
                                    name="dueDate"
                                >
                                    <DatePicker
                                        allowClear
                                        format={ISO_DATE_FORMAT}
                                        placeholder={
                                            microcopy.placeholders.selectDueDate
                                        }
                                        style={{ width: "100%" }}
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={microcopy.fields.labels}
                                    name="labelIds"
                                >
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
                                        placeholder={
                                            microcopy.placeholders.selectLabels
                                        }
                                        tagRender={(tagProps) => {
                                            const color = labels.find(
                                                (item) =>
                                                    item._id === tagProps.value
                                            )?.color;
                                            return (
                                                <Tag
                                                    closable={tagProps.closable}
                                                    color={color}
                                                    onClose={tagProps.onClose}
                                                    style={{
                                                        marginInlineEnd:
                                                            space.xxs
                                                    }}
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
                                        placeholder={
                                            microcopy.placeholders
                                                .selectAssignees
                                        }
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
                                            microcopy.placeholders
                                                .selectParentTask
                                        }
                                        showSearch
                                    />
                                </Form.Item>
                                <Form.Item
                                    data-testid="task-modal-milestone"
                                    label={microcopy.fields.milestone}
                                    name="milestoneId"
                                >
                                    <Select
                                        allowClear
                                        optionFilterProp="label"
                                        options={milestoneOptions}
                                        placeholder={
                                            microcopy.placeholders
                                                .selectMilestone
                                        }
                                        showSearch
                                    />
                                </Form.Item>
                                <Form.Item
                                    label={microcopy.fields.dependsOn}
                                    name="dependsOn"
                                >
                                    <Select
                                        allowClear
                                        mode="multiple"
                                        onClear={() =>
                                            form.setFieldsValue({
                                                dependsOn: []
                                            })
                                        }
                                        optionFilterProp="label"
                                        options={dependencyOptions}
                                        placeholder={
                                            microcopy.placeholders
                                                .selectDependencies
                                        }
                                    />
                                </Form.Item>
                                {blocksOptions.length > 0 ? (
                                    <Form.Item
                                        label={microcopy.taskModal.blocksLabel}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: space.xxs
                                            }}
                                        >
                                            {blocksOptions.map((option) => (
                                                <Tag
                                                    key={option.value}
                                                    style={{
                                                        marginInlineEnd: 0
                                                    }}
                                                >
                                                    {option.label}
                                                </Tag>
                                            ))}
                                        </div>
                                    </Form.Item>
                                ) : null}
                            </>
                        )
                    }
                ]}
            />
            {environment.aiGhostTextEnabled && aiEnabled && boardAiOn ? (
                <CopilotPrivacyDisclosure
                    onAcknowledge={() => {
                        // The HTML spec restricts the `storage` event to
                        // *other* tabs, so the writer never sees its own
                        // write. Without this dispatch the already-mounted
                        // `<AiGhostText>` would only pick up consent on the
                        // next modal close/reopen — which is exactly the
                        // regression the reviewer flagged.
                        const detail: AiPrivacyConsentEventDetail = {
                            route: "task-note"
                        };
                        window.dispatchEvent(
                            new CustomEvent(AI_PRIVACY_CONSENT_EVENT, {
                                detail
                            })
                        );
                    }}
                    /*
                     * Wave 4 follow-up: pass `route` so the disclosure
                     * reads the task-note scope from `getAiDataScope` and
                     * surfaces the ghost-text-specific data list (column /
                     * task name / type / in-progress note text) instead of
                     * the generic global summary. The explicit `storageKey`
                     * is kept for the existing acknowledgement state — the
                     * default resolved from `route` would match
                     * (`boardCopilot:privacyShown:task-note`) but pinning
                     * the key here documents the contract for the test
                     * fixtures that pre-set it.
                     */
                    route="task-note"
                    storageKey="boardCopilot:privacyShown:task-note"
                />
            ) : null}
            {aiEnabled && boardAiOn ? (
                <AiRewritePanel
                    note={liveValues.note ?? ""}
                    onAccept={(text) => {
                        markFieldAsCopilotApplied("note");
                        form.setFieldsValue({ note: text });
                        setFormTick((tick) => tick + 1);
                    }}
                    projectId={projectId}
                />
            ) : null}
            <Form.Item
                label={
                    <FieldLabelWithProvenance
                        label={microcopy.fields.notes}
                        suggested={appliedFieldOrigin.note === "copilot"}
                    />
                }
                name="note"
            >
                {environment.aiGhostTextEnabled && aiEnabled && boardAiOn ? (
                    <AiGhostTextNoteField
                        columnId={editingTask?.columnId}
                        projectId={projectId}
                        taskName={liveValues.taskName}
                        type={liveValues.type === "Bug" ? "Bug" : "Task"}
                    />
                ) : (
                    <Input.TextArea
                        autoComplete="off"
                        enterKeyHint="done"
                        inputMode="text"
                        placeholder={
                            microcopy.placeholders.notesAcceptanceCriteria
                        }
                        rows={4}
                    />
                )}
            </Form.Item>
        </Form>
    );

    // Phase 2.6 — two-column split-pane only on the DESKTOP Modal branch at
    // >= md (768px). The phone Sheet (isPhone) always stays single-column.
    const twoColumnAi = Boolean(aiAssistNode) && !isPhone && screens.md;

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
                justifyContent: "space-between",
                minWidth: 0,
                width: "100%"
            }}
        >
            <div
                style={{
                    alignItems: "center",
                    display: "flex",
                    flex: "1 1 auto",
                    flexWrap: "wrap",
                    gap: space.xs,
                    minWidth: 0
                }}
            >
                {editingTask ? (
                    <Tag
                        variant="filled"
                        color={
                            editingTask.type === "Bug" ? "magenta" : "geekblue"
                        }
                        style={{ fontWeight: 500, marginInlineEnd: 0 }}
                    >
                        {editingTask.type === "Bug"
                            ? microcopy.options.taskTypes.bug
                            : microcopy.options.taskTypes.task}
                    </Tag>
                ) : null}
                <Typography.Text
                    id={titleId}
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
            {isPhone ? (
                <Dropdown
                    menu={{
                        items: [
                            {
                                key: "delete",
                                danger: true,
                                disabled: deleteDisabled,
                                label: microcopy.actions.delete,
                                onClick: onDelete
                            }
                        ]
                    }}
                    trigger={["click"]}
                >
                    <Button
                        aria-label={microcopy.taskModal.moreActionsAria}
                        icon={<MoreOutlined aria-hidden />}
                        type="text"
                    />
                </Dropdown>
            ) : null}
        </div>
    );

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
    const cancelButton = (
        <Button block={!screens.sm} onClick={requestClose} size="large">
            {microcopy.actions.cancel}
        </Button>
    );
    const okButton = (
        <Button
            block={!screens.sm}
            disabled={!editingTask || uLoading}
            loading={uLoading}
            onClick={onOk}
            size="large"
            type="primary"
        >
            {microcopy.actions.save}
        </Button>
    );
    /*
     * Footer rebuilt as a PLAIN NODE (the responsive wrapper forwards a
     * single node to both the desktop Modal footer slot and the phone
     * Sheet footer slot — AntD's `(_, { OkBtn, CancelBtn }) => …`
     * render-prop form is unsupported there). The breakpoint-driven order
     * is preserved exactly: on phone widths the buttons stack full-width
     * with the primary Save in the thumb zone (bottom), Cancel directly
     * above it, and the destructive Delete at the top, de-emphasised as a
     * danger text button. Desktop / tablet keeps Delete-left,
     * Cancel/Save-right. See QW-19 in
     * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
     */
    const footerNode = isPhone ? (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: space.xs
            }}
        >
            {cancelButton}
            {okButton}
        </div>
    ) : !screens.sm ? (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: space.xs
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
            <div
                style={{
                    display: "flex",
                    flex: "0 0 auto",
                    flexWrap: "wrap",
                    gap: space.xs,
                    justifyContent: "flex-end"
                }}
            >
                {cancelButton}
                {okButton}
            </div>
        </div>
    );

    return (
        <>
            {confirmNode}
            <ResponsiveFormSheet
                centered
                forceRender
                footer={footerNode}
                onClose={requestClose}
                ariaLabelledBy={titleId}
                data-testid="task-modal"
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
                        maxHeight: isPhone
                            ? "max(80px, calc(100dvh - 240px - env(keyboard-inset-height, 0px)))"
                            : screens.sm
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
                                message={
                                    microcopy.taskModal.removedByOthersTitle
                                }
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
                        {/*
                         * Phase 2.6 split-pane.
                         *   - Desktop Modal, >= md (768px): form left, AI assist
                         *     right, as two Row/Col columns (`twoColumnAi`).
                         *   - Desktop Modal, < md: single column; the AI panel
                         *     stacks below the form inside a Collapse so the
                         *     long panel can't push the form off-screen.
                         *   - Phone (isPhone): the form already renders inside
                         *     the bottom Sheet, which stays single-column — the
                         *     panel simply follows the form in normal flow.
                         * `aiAssistNode` / `formNode` are byte-identical across
                         * every branch, so the debounced estimate/readiness
                         * calls, the apply handlers, and the Copilot provenance
                         * wiring are untouched — only the container differs.
                         */}
                        {twoColumnAi ? (
                            <Row gutter={space.lg}>
                                <Col flex="1 1 0" style={{ minWidth: 0 }}>
                                    {formNode}
                                </Col>
                                <Col flex="0 0 280px" style={{ minWidth: 0 }}>
                                    {aiAssistNode}
                                </Col>
                            </Row>
                        ) : (
                            <>
                                {formNode}
                                {aiAssistNode ? (
                                    <Collapse
                                        defaultActiveKey={[]}
                                        ghost
                                        items={[
                                            {
                                                key: "ai-assist",
                                                label: microcopy.taskModal
                                                    .aiAssistLabel,
                                                children: aiAssistNode
                                            }
                                        ]}
                                        style={{
                                            marginBlockStart: space.sm
                                        }}
                                    />
                                ) : null}
                            </>
                        )}
                        {/*
                         * Comments + @mentions thread. Mounted below the
                         * form + AI assist for a real (persisted) task only —
                         * an optimistic placeholder has no server comments,
                         * and the thread keys its query off the concrete
                         * task id. The roster + author resolution need
                         * `projectId`, so we also gate on it being known.
                         */}
                        {editingTask &&
                        editingTaskId &&
                        !placeholderId &&
                        projectId ? (
                            <CommentsThread
                                projectId={projectId}
                                taskId={editingTaskId}
                            />
                        ) : null}
                    </div>
                </div>
            </ResponsiveFormSheet>
        </>
    );
};

export default TaskModal;
