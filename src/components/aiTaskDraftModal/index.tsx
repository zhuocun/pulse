import { ReloadOutlined } from "@ant-design/icons";
import {
    Alert,
    Button,
    Checkbox,
    Form,
    Input,
    message,
    Modal,
    Progress,
    Select,
    Space,
    Spin,
    Tag,
    Tooltip,
    Typography
} from "antd";
import { useForm } from "antd/lib/form/Form";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { modalWidthCss, space } from "../../theme/tokens";
import { isMacLike } from "../../utils/platform";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { validateBreakdown, validateDraft } from "../../utils/ai/validate";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useApi from "../../utils/hooks/useApi";
import useAuth from "../../utils/hooks/useAuth";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import AiConfidenceIndicator from "../aiConfidenceIndicator";
import AiSparkleIcon from "../aiSparkleIcon";
import AiSuggestedBadge from "../aiSuggestedBadge";
import { CopilotPrivacyDisclosure } from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";

interface AiTaskDraftModalProps {
    open: boolean;
    onClose: () => void;
    columnId?: string;
}

const { TextArea } = Input;

type BreakdownAxis = "by_phase" | "by_surface" | "by_risk" | "freeform";

const BREAKDOWN_AXES: BreakdownAxis[] = [
    "by_phase",
    "by_surface",
    "by_risk",
    "freeform"
];

/**
 * Form fields the AI draft populates. After Apply, each populated field
 * shows the "Suggested by Copilot" badge until the user edits it.
 */
const AI_FIELDS: ReadonlyArray<keyof IDraftTaskSuggestion> = [
    "taskName",
    "type",
    "epic",
    "storyPoints",
    "note",
    "columnId",
    "coordinatorId"
];

const AiTaskDraftModal: React.FC<AiTaskDraftModalProps> = ({
    open,
    onClose,
    columnId
}) => {
    const { user } = useAuth();
    const { projectId } = useParams<{ projectId: string }>();
    const columns =
        useCachedQueryData<IColumn[]>(["boards", { projectId }]) ?? [];
    const tasks = useCachedQueryData<ITask[]>(["tasks", { projectId }]) ?? [];
    const members = useCachedQueryData<IMember[]>(["users/members"]) ?? [];
    const cachedProject = useCachedQueryData<IProject>([
        "projects",
        { projectId }
    ]);

    const [prompt, setPrompt] = useState("");
    const [breakdownMode, setBreakdownMode] = useState(false);
    const [breakdownAxis, setBreakdownAxis] =
        useState<BreakdownAxis>("freeform");
    const [breakdownItems, setBreakdownItems] = useState<
        IDraftTaskSuggestion[]
    >([]);
    const [breakdownChecked, setBreakdownChecked] = useState<boolean[]>([]);
    const [bulkProgress, setBulkProgress] = useState<{
        current: number;
        total: number;
    } | null>(null);
    /** Track which fields are still AI-suggested vs. user-edited. */
    const [aiFields, setAiFields] = useState<Set<string>>(new Set());
    /** Remote-agent path: stores the last applied single draft for confidence/rationale display. */
    const [remoteDraft, setRemoteDraft] = useState<IDraftTaskSuggestion | null>(
        null
    );
    const [form] = useForm();
    const undoToast = useUndoToast();

    // Mount ALL hooks unconditionally (React hook ordering rule).
    // Only one engine path drives the UI based on environment.aiUseLocalEngine.
    const draftAi = useAi<IDraftTaskSuggestion>({ route: "task-draft" });
    const breakdownAi = useAi<ITaskBreakdownSuggestion>({
        route: "task-breakdown"
    });
    const remoteAgent = useAgent("task-drafting-agent", { projectId });

    const isRemote = !environment.aiUseLocalEngine;
    const remoteStart = remoteAgent.start;
    const remoteAbort = remoteAgent.abort;
    const remoteClearSuggestion = remoteAgent.clearSuggestion;
    const remoteLastSuggestion = remoteAgent.lastSuggestion;

    const queryClient = useQueryClient();
    const apiCall = useApi();
    const { mutateAsync: createTask, isLoading: creating } = useReactMutation(
        "tasks",
        "POST",
        ["tasks", { projectId }],
        newTaskCallback
    );

    const resetDraftAi = draftAi.reset;
    const resetBreakdownAi = breakdownAi.reset;
    const reset = useCallback(() => {
        setPrompt("");
        setBreakdownMode(false);
        setBreakdownAxis("freeform");
        setBreakdownItems([]);
        setBreakdownChecked([]);
        setBulkProgress(null);
        setAiFields(new Set());
        setRemoteDraft(null);
        form.resetFields();
        resetDraftAi();
        resetBreakdownAi();
        remoteAbort();
        remoteClearSuggestion();
    }, [
        form,
        resetBreakdownAi,
        resetDraftAi,
        remoteAbort,
        remoteClearSuggestion
    ]);

    /**
     * Modal state reset on close. Clearing on close is correct, but the
     * previous implementation also reset on every effect run after open
     * because of stale dependencies — guarded with a ref so it only fires
     * once per open→close transition.
     */
    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (open && !wasOpenRef.current) {
            wasOpenRef.current = true;
            return;
        }
        if (!open && wasOpenRef.current) {
            wasOpenRef.current = false;
            reset();
        }
    }, [open, reset]);

    const draftValidateContext = useMemo(
        () => ({
            columns,
            members,
            tasks,
            fallbackColumnId: columnId,
            fallbackCoordinatorId: user?._id
        }),
        [columns, members, tasks, columnId, user?._id]
    );

    // React to incoming agent suggestions after streaming completes.
    // Using a useEffect on lastSuggestion ensures state flush before we read.
    useEffect(() => {
        const suggestion = remoteLastSuggestion;
        if (!suggestion || suggestion.surface !== "draft") return;
        const payload = suggestion.payload as
            | IDraftTaskSuggestion
            | { axis: string; items: IDraftTaskSuggestion[] };
        if ("items" in payload && Array.isArray(payload.items)) {
            const validated = validateBreakdown(
                { items: payload.items },
                draftValidateContext
            );
            setBreakdownMode(true);
            setBreakdownItems(validated.items);
            setBreakdownChecked(validated.items.map(() => true));
        } else {
            const draft = validateDraft(
                payload as IDraftTaskSuggestion,
                draftValidateContext
            );
            form.setFieldsValue(draft);
            setAiFields(new Set(AI_FIELDS as string[]));
            setRemoteDraft(draft);
        }
        remoteClearSuggestion();
    }, [
        remoteLastSuggestion,
        form,
        remoteClearSuggestion,
        draftValidateContext
    ]);

    const aiContext = useMemo(
        () => ({
            project: {
                _id: projectId ?? "",
                projectName: cachedProject?.projectName ?? ""
            },
            columns,
            tasks,
            members
        }),
        [projectId, cachedProject, columns, tasks, members]
    );

    const samplePrompts = useMemo(() => {
        const projectName =
            tasks[0]?.projectId === projectId && tasks[0]?.epic
                ? tasks[0].epic
                : microcopy.ai.draftSampleFallbackProject;
        const [bugDraft, , spikeDraft] = microcopy.ai.draftSuggestions;
        return [
            bugDraft,
            microcopy.ai.draftSamplePlanFeature.replace(
                "{project}",
                projectName
            ),
            spikeDraft
        ];
    }, [tasks, projectId]);

    const onDraft = async () => {
        if (!prompt.trim()) return;
        setBreakdownMode(false);
        track(ANALYTICS_EVENTS.COPILOT_DRAFT_SUBMIT, {
            mode: "single",
            length: prompt.length
        });
        if (isRemote) {
            setRemoteDraft(null);
            await remoteStart({ prompt }, { autonomy: "plan" });
        } else {
            const suggestion = await draftAi.run({
                draft: {
                    prompt,
                    columnId,
                    coordinatorId: user?._id,
                    context: aiContext
                }
            });
            form.setFieldsValue(suggestion);
            setAiFields(new Set(AI_FIELDS as string[]));
        }
    };

    const onBreakdown = async (axis: BreakdownAxis = breakdownAxis) => {
        if (!prompt.trim()) return;
        track(ANALYTICS_EVENTS.COPILOT_DRAFT_SUBMIT, {
            mode: "breakdown",
            axis,
            length: prompt.length
        });
        if (isRemote) {
            await remoteStart(
                { prompt, breakdown_axis: axis },
                { autonomy: "plan" }
            );
        } else {
            const result = await breakdownAi.run({
                draft: {
                    prompt,
                    columnId,
                    coordinatorId: user?._id,
                    context: aiContext,
                    count: 3,
                    axis
                }
            });
            setBreakdownMode(true);
            setBreakdownItems(result.items);
            setBreakdownChecked(result.items.map(() => true));
        }
    };

    const onBreakdownAxisChange = (next: BreakdownAxis) => {
        setBreakdownAxis(next);
        track(ANALYTICS_EVENTS.BREAKDOWN_AXIS_CHANGED, { next });
        if (breakdownMode && prompt.trim()) {
            void onBreakdown(next);
        }
    };

    const onSubmitSingle = async () => {
        const values = form.getFieldsValue();
        await createTask({
            taskName: values.taskName,
            type: values.type,
            epic: values.epic,
            note: values.note,
            storyPoints: values.storyPoints,
            columnId: values.columnId,
            coordinatorId: values.coordinatorId,
            projectId
        });
        onClose();
    };

    const onSubmitBreakdown = async () => {
        const selected = breakdownItems.filter(
            (_, index) => breakdownChecked[index]
        );
        if (selected.length === 0) return;
        setBulkProgress({ current: 0, total: selected.length });
        const created: string[] = [];
        try {
            for (const [index, item] of selected.entries()) {
                // sequential to keep optimistic cache consistent
                // eslint-disable-next-line no-await-in-loop
                const result = await createTask({
                    taskName: item.taskName,
                    type: item.type,
                    epic: item.epic,
                    note: item.note,
                    storyPoints: item.storyPoints,
                    columnId: item.columnId,
                    coordinatorId: item.coordinatorId,
                    projectId
                });
                if (
                    result &&
                    typeof result === "object" &&
                    "_id" in result &&
                    typeof (result as { _id: string })._id === "string"
                ) {
                    created.push((result as { _id: string })._id);
                }
                setBulkProgress({ current: index + 1, total: selected.length });
            }
            undoToast.show({
                description: (selected.length === 1
                    ? microcopy.counts.subtasksCreated.one
                    : microcopy.counts.subtasksCreated.other
                ).replace("{count}", String(selected.length)),
                analyticsTag: "copilot.draft.bulk",
                undo: async () => {
                    /*
                     * Per-task undo. Routing each delete through `useApi`
                     * gives us auth, base-URL, and error normalization —
                     * the previous raw `fetch` silently swallowed network
                     * failures. We tally the outcome per-id so a partial
                     * undo can be surfaced to the user instead of
                     * pretending everything reverted.
                     */
                    let removed = 0;
                    let failed = 0;
                    for (const id of created) {
                        try {
                            // eslint-disable-next-line no-await-in-loop
                            await apiCall(`tasks/${id}`, {
                                method: "DELETE"
                            });
                            removed += 1;
                        } catch {
                            failed += 1;
                        }
                    }
                    void queryClient.invalidateQueries({
                        queryKey: ["tasks", { projectId }]
                    });
                    if (failed === 0) {
                        message.success(
                            (removed === 1
                                ? microcopy.counts.subtasksRemoved.one
                                : microcopy.counts.subtasksRemoved.other
                            ).replace("{count}", String(removed))
                        );
                    } else if (removed === 0) {
                        message.error(
                            (failed === 1
                                ? microcopy.counts.subtasksRemoveFailed.one
                                : microcopy.counts.subtasksRemoveFailed.other
                            ).replace("{count}", String(failed))
                        );
                    } else {
                        message.warning(
                            microcopy.counts.subtasksRemovedPartial
                                .replace("{removed}", String(removed))
                                .replace("{failed}", String(failed))
                        );
                    }
                }
            });
        } finally {
            setBulkProgress(null);
        }
        onClose();
    };

    const handleFieldEdit = (field: string) => {
        if (aiFields.size === 0) return;
        setAiFields((prev) => {
            if (!prev.has(field)) return prev;
            const next = new Set(prev);
            next.delete(field);
            return next;
        });
    };

    const handleRegenerate = () => {
        if (!prompt.trim()) return;
        setAiFields(new Set());
        if (breakdownMode) {
            void onBreakdown();
        } else {
            void onDraft();
        }
    };

    const suggestion = draftAi.data;
    const activeSuggestion = isRemote ? remoteDraft : suggestion;
    const showForm = Boolean(activeSuggestion) && !breakdownMode;
    const activeError = isRemote
        ? remoteAgent.error
        : (draftAi.error ?? breakdownAi.error);
    const draftErrorView = aiErrorView(activeError);
    const activeIsLoading = isRemote ? remoteAgent.isStreaming : false;

    const breakdownProgressPercent = bulkProgress
        ? Math.round(
              (bulkProgress.current / Math.max(1, bulkProgress.total)) * 100
          )
        : 0;

    return (
        <Modal
            destroyOnHidden
            footer={null}
            onCancel={onClose}
            open={open}
            styles={{
                body: {
                    /*
                     * Subtract `env(keyboard-inset-height)` so the modal
                     * body shrinks above the iOS soft keyboard instead of
                     * pushing the footer below the fold. Falls back to
                     * `0px` on browsers without the env variable so the
                     * desktop layout is unchanged. See QW-18 in
                     * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
                     *
                     * The `max(80px, …)` wrapper clamps the result so the
                     * body never collapses to a negative height in
                     * landscape orientation with the keyboard up — a
                     * 375 × 667 device in landscape reports `100dvh` ≈
                     * 375 px and a ~260 px keyboard inset would otherwise
                     * subtract past zero (Bug 6).
                     */
                    maxHeight:
                        "max(80px, calc(100dvh - 220px - env(keyboard-inset-height, 0px)))",
                    overflowY: "auto"
                }
            }}
            title={
                <Space align="center" size={space.xs} wrap>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: 600 }}>
                        {microcopy.actions.draftWithAi}
                    </span>
                    <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                    {/*
                     * EngineModeTag now mounts once in the global header.
                     */}
                </Space>
            }
            width={modalWidthCss(640)}
        >
            <CopilotRemoteConsentNotice route="task-draft" />
            <CopilotPrivacyDisclosure
                route="task-draft"
                storageKey="boardCopilot:draftPrivacyShown"
            />
            <Form.Item label={microcopy.placeholders.describeWork}>
                <TextArea
                    aria-label={microcopy.a11y.taskPrompt}
                    autoComplete="off"
                    enterKeyHint="go"
                    inputMode="text"
                    maxLength={1000}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                        if (
                            (event.metaKey || event.ctrlKey) &&
                            event.key === "Enter" &&
                            prompt.trim()
                        ) {
                            event.preventDefault();
                            void onDraft();
                        }
                    }}
                    placeholder={microcopy.placeholders.taskPromptExample}
                    rows={3}
                    showCount
                    value={prompt}
                />
                <Typography.Text
                    style={{ display: "block", marginTop: 4 }}
                    type="secondary"
                >
                    {isMacLike() ? "⌘⏎" : "Ctrl+Enter"} to draft.
                </Typography.Text>
            </Form.Item>
            {!prompt.trim() && (
                <Space size={space.xs} style={{ marginBottom: space.sm }} wrap>
                    {samplePrompts.map((sample) => (
                        <Button
                            key={sample}
                            onClick={() => setPrompt(sample)}
                            size="small"
                            type="default"
                        >
                            {sample}
                        </Button>
                    ))}
                </Space>
            )}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: space.xs,
                    marginBottom: space.md
                }}
            >
                <Button
                    aria-label={microcopy.a11y.draftTaskWithCopilot}
                    disabled={
                        !prompt.trim() ||
                        (isRemote ? activeIsLoading : draftAi.isLoading)
                    }
                    onClick={onDraft}
                    type="primary"
                >
                    {(isRemote ? activeIsLoading : draftAi.isLoading) ? (
                        <Spin size="small" />
                    ) : (
                        microcopy.actions.draftTask
                    )}
                </Button>
                <Select<BreakdownAxis>
                    aria-label={microcopy.a11y.breakdownAxisLabel}
                    onChange={onBreakdownAxisChange}
                    options={BREAKDOWN_AXES.map((axis) => ({
                        label: (
                            <Tooltip
                                title={microcopy.ai.breakdownAxes[axis].tooltip}
                            >
                                {microcopy.ai.breakdownAxes[axis].label}
                            </Tooltip>
                        ),
                        value: axis
                    }))}
                    style={{ width: 180 }}
                    value={breakdownAxis}
                />
                <Button
                    aria-label={microcopy.a11y.breakPromptIntoSubtasks}
                    disabled={
                        !prompt.trim() ||
                        (isRemote ? activeIsLoading : breakdownAi.isLoading)
                    }
                    onClick={() => onBreakdown()}
                >
                    {(isRemote ? activeIsLoading : breakdownAi.isLoading) ? (
                        <Spin size="small" />
                    ) : (
                        microcopy.actions.breakDown
                    )}
                </Button>
                {(Boolean(activeSuggestion) || breakdownMode) && (
                    <Tooltip title={microcopy.ai.regenerateLabel}>
                        <Button
                            aria-label={microcopy.ai.regenerateLabel}
                            disabled={
                                isRemote
                                    ? activeIsLoading
                                    : draftAi.isLoading || breakdownAi.isLoading
                            }
                            icon={<ReloadOutlined aria-hidden />}
                            onClick={handleRegenerate}
                        />
                    </Tooltip>
                )}
            </div>

            {activeError && (
                <Alert
                    action={
                        draftErrorView.retryable ? (
                            <Button
                                onClick={handleRegenerate}
                                size="small"
                                type="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        ) : null
                    }
                    showIcon
                    style={{ marginBottom: space.md }}
                    title={draftErrorView.heading}
                    description={draftErrorView.body || undefined}
                    type={draftErrorView.severity}
                />
            )}

            {bulkProgress && (
                <Progress
                    aria-label={microcopy.a11y.creatingSubtasks}
                    format={() =>
                        microcopy.ai.bulkProgressFormat
                            .replace("{current}", String(bulkProgress.current))
                            .replace("{total}", String(bulkProgress.total))
                    }
                    percent={breakdownProgressPercent}
                    status="active"
                    style={{ marginBottom: space.md }}
                />
            )}

            {showForm && activeSuggestion && (
                <Form
                    form={form}
                    initialValues={activeSuggestion}
                    layout="vertical"
                    onFinish={onSubmitSingle}
                    onValuesChange={(changed) => {
                        Object.keys(changed).forEach(handleFieldEdit);
                    }}
                >
                    <Alert
                        showIcon
                        style={{ marginBottom: space.sm }}
                        title={
                            <span>
                                {`${microcopy.a11y.aiSuggestion} · ${microcopy.ai.reviewAndEdit}`}{" "}
                                <AiConfidenceIndicator
                                    confidence={activeSuggestion.confidence}
                                />
                            </span>
                        }
                        description={activeSuggestion.rationale}
                        type="info"
                    />
                    <Form.Item
                        extra={
                            aiFields.has("taskName") && (
                                <AiSuggestedBadge compact />
                            )
                        }
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
                        extra={
                            aiFields.has("type") && <AiSuggestedBadge compact />
                        }
                        label={microcopy.fields.type}
                        name="type"
                    >
                        <Select
                            options={[
                                {
                                    label: microcopy.options.taskTypes.task,
                                    value: "Task"
                                },
                                {
                                    label: microcopy.options.taskTypes.bug,
                                    value: "Bug"
                                }
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        extra={
                            aiFields.has("epic") && <AiSuggestedBadge compact />
                        }
                        label={microcopy.fields.epic}
                        name="epic"
                    >
                        <Input
                            autoComplete="off"
                            enterKeyHint="next"
                            inputMode="text"
                        />
                    </Form.Item>
                    <Form.Item
                        extra={
                            aiFields.has("storyPoints") && (
                                <AiSuggestedBadge compact />
                            )
                        }
                        label={microcopy.fields.storyPoints}
                        name="storyPoints"
                    >
                        <Select
                            options={[1, 2, 3, 5, 8, 13].map((value) => ({
                                label: `${value}`,
                                value
                            }))}
                        />
                    </Form.Item>
                    <Form.Item
                        extra={
                            aiFields.has("columnId") && (
                                <AiSuggestedBadge compact />
                            )
                        }
                        label={microcopy.fields.column}
                        name="columnId"
                    >
                        <Select
                            options={columns.map((column) => ({
                                label: column.columnName,
                                value: column._id
                            }))}
                        />
                    </Form.Item>
                    <Form.Item
                        extra={
                            aiFields.has("coordinatorId") && (
                                <AiSuggestedBadge compact />
                            )
                        }
                        label={microcopy.fields.coordinator}
                        name="coordinatorId"
                    >
                        <Select
                            options={members.map((member) => ({
                                label: member.username,
                                value: member._id
                            }))}
                        />
                    </Form.Item>
                    <Form.Item
                        extra={
                            aiFields.has("note") && <AiSuggestedBadge compact />
                        }
                        label={microcopy.fields.notes}
                        name="note"
                    >
                        <TextArea
                            autoComplete="off"
                            enterKeyHint="done"
                            inputMode="text"
                            rows={4}
                        />
                    </Form.Item>
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: space.xs,
                            justifyContent: "flex-end"
                        }}
                    >
                        <Button onClick={onClose}>
                            {microcopy.actions.cancel}
                        </Button>
                        <Button
                            htmlType="submit"
                            loading={creating}
                            type="primary"
                        >
                            {microcopy.actions.createTask}
                        </Button>
                    </div>
                </Form>
            )}

            {breakdownMode && breakdownItems.length > 0 && (
                <div aria-label={microcopy.a11y.subtaskBreakdown}>
                    <Alert
                        showIcon
                        style={{ marginBottom: space.sm }}
                        title={`${microcopy.a11y.aiSuggestion}: ${microcopy.ai.pickSubtasks}`}
                        description={microcopy.ai.breakdownAxisInfo.replace(
                            "{label}",
                            microcopy.ai.breakdownAxes[breakdownAxis].label
                        )}
                        type="info"
                    />
                    {breakdownItems.map((item, index) => {
                        const column = columns.find(
                            (col) => col._id === item.columnId
                        );
                        const owner = members.find(
                            (member) => member._id === item.coordinatorId
                        );
                        return (
                            <div
                                key={`${item.taskName}-${index}`}
                                style={{
                                    alignItems: "center",
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: space.xs,
                                    marginBottom: space.xs
                                }}
                            >
                                <Checkbox
                                    aria-label={microcopy.a11y.includeSubtask.replace(
                                        "{name}",
                                        item.taskName
                                    )}
                                    checked={breakdownChecked[index]}
                                    onChange={(event) => {
                                        const next = [...breakdownChecked];
                                        next[index] = event.target.checked;
                                        setBreakdownChecked(next);
                                    }}
                                />
                                <span
                                    style={{
                                        flex: "1 1 12rem",
                                        minWidth: 0,
                                        overflowWrap: "anywhere"
                                    }}
                                >
                                    {item.taskName}
                                </span>
                                {column && (
                                    <Tag color="default">
                                        {column.columnName}
                                    </Tag>
                                )}
                                {owner && <Tag>{owner.username}</Tag>}
                                <Tag style={{ marginInlineEnd: 0 }}>
                                    {microcopy.brief.ptsCount.replace(
                                        "{count}",
                                        String(item.storyPoints)
                                    )}
                                </Tag>
                                <Tag
                                    color={item.type === "Bug" ? "red" : "blue"}
                                    style={{ marginInlineEnd: 0 }}
                                >
                                    {item.type === "Bug"
                                        ? microcopy.options.taskTypes.bug
                                        : microcopy.options.taskTypes.task}
                                </Tag>
                            </div>
                        );
                    })}
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: space.xs,
                            justifyContent: "flex-end",
                            marginTop: space.sm
                        }}
                    >
                        <Button onClick={onClose}>
                            {microcopy.actions.cancel}
                        </Button>
                        <Button
                            disabled={breakdownChecked.every((value) => !value)}
                            loading={creating}
                            onClick={onSubmitBreakdown}
                            type="primary"
                        >
                            {microcopy.counts.createNSubtasks.replace(
                                "{count}",
                                String(breakdownChecked.filter(Boolean).length)
                            )}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
};

export default AiTaskDraftModal;
