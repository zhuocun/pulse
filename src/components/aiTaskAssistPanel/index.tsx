import { ReloadOutlined } from "@ant-design/icons";
import {
    Alert,
    Button,
    Card,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react"; // useRef kept for previousPointsRef
import { useParams } from "react-router-dom";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";
import { confidenceBand } from "../../utils/ai/confidenceBand";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { extractSuggestionRunId } from "../../utils/ai/extractSuggestionRunId";
import { srOnlyLiveRegionStyle } from "../../utils/a11y/srOnlyLiveRegionStyle";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import useDebounce from "../../utils/hooks/useDebounce";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import useUndoToast from "../../utils/hooks/useUndoToast";
import AiConfidenceIndicator from "../aiConfidenceIndicator";
import AiSparkleIcon from "../aiSparkleIcon";
import AiSuggestedBadge from "../aiSuggestedBadge";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import EngineModeTag from "../engineModeTag";
import { AiCopilotSurfaceFeedback } from "../aiFeedbackPopover";

import {
    absorbUseAiRunRejection,
    asMicrocopyString,
    buildLocalAiContext,
    buildLocalEstimateRunPayload,
    buildLocalReadinessRunPayload,
    TASK_ASSIST_DEBOUNCE_MS,
    TASK_ASSIST_DELAYED_SPINNER_MS
} from "./aiTaskAssistContext";

// Stable fallbacks: avoid producing a new `[]` reference on every render, which
// otherwise re-fires the suggestion effect endlessly when the cache is empty.
const EMPTY_TASKS: ITask[] = [];
const EMPTY_MEMBERS: IMember[] = [];
const EMPTY_COLUMNS: IColumn[] = [];

type WireEstimateSuggestion = Omit<
    IEstimateSuggestion,
    "confidence" | "similar"
> & {
    confidence?: unknown;
    similar?: IEstimateSuggestion["similar"];
};

const CONFIDENCE_BY_LABEL: Record<string, number> = {
    low: 0.25,
    moderate: 0.6,
    high: 0.85
};

const normalizeEstimateConfidence = (confidence: unknown): number => {
    if (typeof confidence === "number") return confidence;
    if (typeof confidence !== "string") return 0;

    const normalized = confidence.trim().toLowerCase();
    if (normalized in CONFIDENCE_BY_LABEL) {
        return CONFIDENCE_BY_LABEL[normalized];
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
};

interface V21ReadinessIssueItem {
    field?: unknown;
    severity?: unknown;
    message?: unknown;
    suggestion?: unknown;
}
interface V21ReadinessPayload {
    ready?: boolean;
    issues?: V21ReadinessIssueItem[];
    missing?: V21ReadinessIssueItem[];
    rationale?: string;
}
const normalizeReadinessSeverity = (
    severity: unknown
): IReadinessIssue["severity"] =>
    severity === "warning"
        ? "warn"
        : severity === "info" || severity === "warn" || severity === "error"
          ? severity
          : "warn";

const adaptV21Readiness = (r: V21ReadinessPayload): IReadinessReport => {
    const issues = Array.isArray(r.issues) ? r.issues : (r.missing ?? []);
    return {
        issues: issues.map((issue) => ({
            field:
                typeof issue.field === "string"
                    ? (issue.field as IReadinessIssue["field"])
                    : ("" as IReadinessIssue["field"]),
            severity: normalizeReadinessSeverity(issue.severity),
            message: typeof issue.message === "string" ? issue.message : "",
            ...(typeof issue.suggestion === "string"
                ? { suggestion: issue.suggestion }
                : {})
        }))
    };
};

interface AiTaskAssistPanelProps {
    values: {
        taskName?: string;
        note?: string;
        type?: string;
        epic?: string;
        coordinatorId?: string;
        storyPoints?: number;
    };
    excludeTaskId?: string;
    onApplyStoryPoints: (value: StoryPoints) => void;
    onApplySuggestion: (
        field: IReadinessIssue["field"],
        suggestion: string | undefined,
        options?: { replace?: boolean }
    ) => void;
    onOpenSimilarTask: (taskId: string) => void;
}

const AiTaskAssistPanel: React.FC<AiTaskAssistPanelProps> = ({
    values,
    excludeTaskId,
    onApplyStoryPoints,
    onApplySuggestion,
    onOpenSimilarTask
}) => {
    const { projectId } = useParams<{ projectId: string }>();
    const tasks =
        useCachedQueryData<ITask[]>(["tasks", { projectId }]) ?? EMPTY_TASKS;
    const members =
        useCachedQueryData<IMember[]>(["users/members"]) ?? EMPTY_MEMBERS;
    const columns =
        useCachedQueryData<IColumn[]>(["boards", { projectId }]) ??
        EMPTY_COLUMNS;

    const debouncedValues = useDebounce(values, TASK_ASSIST_DEBOUNCE_MS);
    const taskName = debouncedValues.taskName ?? "";

    // Mount BOTH hooks unconditionally (React hook ordering rule).
    // Only one drives the UI based on environment.aiUseLocalEngine.
    const estimateAi = useAi<IEstimateSuggestion>({ route: "estimate" });
    const readinessAi = useAi<IReadinessReport>({ route: "readiness" });
    const remoteAgent = useAgent("task-estimation-agent", { projectId });
    const isRemote = !environment.aiUseLocalEngine;
    const startRemoteEstimate = remoteAgent.start;
    const abortRemoteEstimate = remoteAgent.abort;
    const clearRemoteSuggestion = remoteAgent.clearSuggestion;
    const remoteLastSuggestion = remoteAgent.lastSuggestion;
    const remoteError = remoteAgent.error;
    const remoteIsStreaming = remoteAgent.isStreaming;

    const runEstimate = estimateAi.run;
    const runReadiness = readinessAi.run;
    const resetEstimate = estimateAi.reset;
    const resetReadiness = readinessAi.reset;

    // Extract both estimate + readiness from the single agent suggestion event.
    const agentEstimateData = useMemo((): IEstimateSuggestion | undefined => {
        const s = remoteLastSuggestion;
        if (!s || s.surface !== "estimate") return undefined;
        const p = s.payload as {
            estimate?: WireEstimateSuggestion;
        };
        return p.estimate
            ? {
                  ...p.estimate,
                  confidence: normalizeEstimateConfidence(
                      p.estimate.confidence
                  ),
                  similar: p.estimate.similar ?? []
              }
            : undefined;
    }, [remoteLastSuggestion]);

    const agentReadinessData = useMemo((): IReadinessReport | undefined => {
        const s = remoteLastSuggestion;
        if (!s || s.surface !== "estimate") return undefined;
        const p = s.payload as {
            readiness?: V21ReadinessPayload;
        };
        return p.readiness ? adaptV21Readiness(p.readiness) : undefined;
    }, [remoteLastSuggestion]);

    const remotePayloadRunId = useMemo(
        () =>
            !isRemote
                ? null
                : extractSuggestionRunId(remoteLastSuggestion?.payload),
        [isRemote, remoteLastSuggestion?.payload]
    );

    // Active data/error/loading derived from the selected engine.
    const estimateData = isRemote ? agentEstimateData : estimateAi.data;
    const readinessData = isRemote ? agentReadinessData : readinessAi.data;
    const estimateError = isRemote ? remoteError : estimateAi.error;
    const readinessError = isRemote ? null : readinessAi.error;
    const estimateIsLoading = isRemote
        ? remoteIsStreaming
        : estimateAi.isLoading;
    const readinessIsLoading = isRemote
        ? remoteIsStreaming
        : readinessAi.isLoading;

    const showEstimateSpinner = useDelayedFlag(
        estimateIsLoading && !estimateData,
        TASK_ASSIST_DELAYED_SPINNER_MS
    );
    const showReadinessSpinner = useDelayedFlag(
        readinessIsLoading && !readinessData,
        TASK_ASSIST_DELAYED_SPINNER_MS
    );
    /**
     * Dismissed readiness issues. Cleared whenever the task name changes
     * so a new run shows fresh issues. The set holds composite
     * `field + message` keys to handle multiple issues per field.
     */
    const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
        () => new Set()
    );
    /** Most recently applied story-point value, captured for Undo. */
    const previousPointsRef = useRef<number | undefined>(values.storyPoints);
    const [showAlternative, setShowAlternative] = useState(false);
    const undoToast = useUndoToast();
    const errorView = aiErrorView(estimateError);
    const readinessErrorView = aiErrorView(readinessError);

    /**
     * Stale-data guard. When the trimmed task name is empty, clear both
     * AI state hooks so the panel renders the empty-state copy instead
     * of the previous task's estimate. Whitespace-only changes to the
     * *name* are skipped, but real context changes (board / tasks /
     * members loading in after mount) still re-fire so cold caches don't
     * strand the panel.
     */
    const trimmedName = taskName.trim();

    const localAiContext = useMemo(
        () => buildLocalAiContext(projectId, columns, tasks, members),
        [projectId, columns, tasks, members]
    );

    const localDraftFields = useMemo(
        () => ({
            taskName: trimmedName,
            note: debouncedValues.note,
            epic: debouncedValues.epic,
            type: debouncedValues.type,
            coordinatorId: debouncedValues.coordinatorId
        }),
        [
            trimmedName,
            debouncedValues.note,
            debouncedValues.epic,
            debouncedValues.type,
            debouncedValues.coordinatorId
        ]
    );

    const taskAssistEstimateSuggestionKey =
        estimateData == null
            ? ""
            : remotePayloadRunId
              ? `${remotePayloadRunId}:estimate:${trimmedName}`
              : [
                    `local:${trimmedName}:estimate:${estimateData.storyPoints}:${estimateData.confidence}`,
                    estimateData.rationale ?? "",
                    (estimateData.similar ?? []).map((s) => s._id).join(",")
                ].join(":");

    const taskAssistReadinessSuggestionKey =
        readinessData == null
            ? ""
            : remotePayloadRunId
              ? `${remotePayloadRunId}:readiness:${trimmedName}:${readinessData.issues
                    .map((i) => `${i.field}:${i.message}:${i.suggestion ?? ""}`)
                    .join("|")}`
              : `local:${trimmedName}:readiness:${readinessData.issues
                    .map((i) => `${i.field}:${i.message}:${i.suggestion ?? ""}`)
                    .join("|")}`;

    const remoteInput = useMemo(
        () => ({
            task_draft: {
                taskName: trimmedName,
                note: debouncedValues.note,
                epic: debouncedValues.epic,
                type: debouncedValues.type,
                coordinatorId: debouncedValues.coordinatorId
            }
        }),
        [
            trimmedName,
            debouncedValues.note,
            debouncedValues.epic,
            debouncedValues.type,
            debouncedValues.coordinatorId
        ]
    );
    useEffect(() => {
        if (trimmedName) return;
        // Skip the state write when the set is already empty so an unstable
        // dep (e.g. a useAi mock returning fresh ``run``/``reset`` refs on
        // every render) cannot drive this effect into a re-render loop.
        const clearDismissed = () =>
            setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
        resetEstimate();
        resetReadiness();
        clearDismissed();
        if (isRemote) {
            abortRemoteEstimate();
            clearRemoteSuggestion();
        }
    }, [
        trimmedName,
        isRemote,
        resetEstimate,
        resetReadiness,
        abortRemoteEstimate,
        clearRemoteSuggestion
    ]);

    useEffect(() => {
        if (!trimmedName || !isRemote) return;
        const clearDismissed = () =>
            setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
        clearDismissed();
        void startRemoteEstimate(remoteInput, { autonomy: "plan" });
    }, [trimmedName, isRemote, remoteInput, startRemoteEstimate]);

    useEffect(() => {
        if (!trimmedName || isRemote) return;
        const clearDismissed = () =>
            setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
        clearDismissed();
        void runEstimate(
            buildLocalEstimateRunPayload(localDraftFields, {
                tasks: localAiContext.tasks,
                excludeTaskId,
                context: localAiContext
            })
        ).catch(absorbUseAiRunRejection);
        void runReadiness(
            buildLocalReadinessRunPayload(localDraftFields, localAiContext)
        ).catch(absorbUseAiRunRejection);
    }, [
        trimmedName,
        isRemote,
        localDraftFields,
        localAiContext,
        excludeTaskId,
        runEstimate,
        runReadiness
    ]);

    // Abort the remote agent and clear its suggestion on unmount.
    useEffect(() => {
        if (!isRemote) return;
        return () => {
            abortRemoteEstimate();
            clearRemoteSuggestion();
        };
    }, [isRemote, abortRemoteEstimate, clearRemoteSuggestion]);

    const taskById = (id: string) => tasks.find((task) => task._id === id);

    const handleApplyPoints = useCallback(() => {
        if (!estimateData) return;
        const previous = previousPointsRef.current;
        const next = estimateData.storyPoints;
        previousPointsRef.current = next;
        onApplyStoryPoints(next);
        track(ANALYTICS_EVENTS.COPILOT_ESTIMATE_APPLY, {
            storyPoints: next,
            confidence: estimateData.confidence
        });
        undoToast.show({
            description: asMicrocopyString(microcopy.ai.storyPointsSet).replace(
                "{points}",
                String(next)
            ),
            analyticsTag: "copilot.estimate.apply",
            undo: () => {
                if (previous === undefined) return;
                onApplyStoryPoints(previous as StoryPoints);
                previousPointsRef.current = previous;
            }
        });
    }, [estimateData, onApplyStoryPoints, undoToast]);

    const handleApplyReadiness = useCallback(
        (issue: IReadinessIssue) => {
            if (!issue.suggestion) return;
            const previous = values[issue.field];
            onApplySuggestion(issue.field, issue.suggestion);
            track(ANALYTICS_EVENTS.COPILOT_REWRITE_ACCEPT, {
                field: issue.field,
                ...(projectId ? { projectId } : {}),
                ...(excludeTaskId ? { taskId: excludeTaskId } : {})
            });
            undoToast.show({
                description: asMicrocopyString(
                    microcopy.ai.readinessFieldUpdated
                ).replace("{field}", String(issue.field)),
                analyticsTag: "copilot.readiness.apply",
                undo: () => {
                    onApplySuggestion(issue.field, previous, {
                        replace: true
                    });
                }
            });
        },
        [excludeTaskId, onApplySuggestion, projectId, undoToast, values]
    );

    const handleRegenerate = useCallback(() => {
        if (!trimmedName) return;
        track(ANALYTICS_EVENTS.COPILOT_CHAT_REGENERATE, {
            surface: "estimate"
        });
        if (isRemote) {
            clearRemoteSuggestion();
            void startRemoteEstimate(remoteInput, { autonomy: "plan" });
        } else {
            void runEstimate(
                buildLocalEstimateRunPayload(localDraftFields, {
                    tasks: localAiContext.tasks,
                    excludeTaskId,
                    context: localAiContext
                })
            ).catch(absorbUseAiRunRejection);
        }
    }, [
        trimmedName,
        localDraftFields,
        localAiContext,
        excludeTaskId,
        isRemote,
        remoteInput,
        startRemoteEstimate,
        clearRemoteSuggestion,
        runEstimate
    ]);

    const SectionHeading: React.FC<{
        children: React.ReactNode;
        right?: React.ReactNode;
    }> = ({ children, right }) => (
        <div
            style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: space.xxs
            }}
        >
            <Typography.Title
                level={5}
                style={{
                    fontSize: fontSize.base,
                    margin: 0
                }}
            >
                {children}
            </Typography.Title>
            {right ? <span>{right}</span> : null}
        </div>
    );

    const band = estimateData ? confidenceBand(estimateData.confidence) : "Low";
    const lowConfidence = estimateData && band === "Low";
    const suggestionStatusAnnouncement = useMemo(() => {
        if (!trimmedName) return "";
        if (estimateError || readinessError) {
            return microcopy.ai.suggestionStatusError;
        }
        if (estimateData || readinessData) {
            return microcopy.ai.suggestionStatusReady;
        }
        if (estimateIsLoading || readinessIsLoading) {
            return microcopy.ai.suggestionStatusLoading;
        }
        return "";
    }, [
        trimmedName,
        estimateError,
        readinessError,
        estimateData,
        readinessData,
        estimateIsLoading,
        readinessIsLoading
    ]);

    return (
        <Card
            size="small"
            style={{
                background:
                    "linear-gradient(135deg, var(--aurora-blob-faint) 0%, transparent 70%), var(--glass-surface-strong)",
                backdropFilter: "blur(20px) saturate(170%)",
                WebkitBackdropFilter: "blur(20px) saturate(170%)",
                borderColor: "var(--glass-border-strong)",
                boxShadow:
                    "0 4px 16px -8px var(--aurora-blob), inset 0 1px 0 rgba(255, 255, 255, 0.55)",
                marginTop: space.md
            }}
            title={
                <Space align="center" size={space.xs} wrap>
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.ai.copilotLabel}
                    </span>
                    <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                    <EngineModeTag />
                    <CopilotPrivacyPopover route="estimate" />
                </Space>
            }
        >
            <CopilotRemoteConsentNotice route="estimate" />
            <div
                aria-atomic="true"
                aria-live="polite"
                role="status"
                style={srOnlyLiveRegionStyle}
            >
                {suggestionStatusAnnouncement}
            </div>
            <SectionHeading
                right={
                    <Space align="center" wrap>
                        {estimateData &&
                        !showEstimateSpinner &&
                        taskAssistEstimateSuggestionKey.length > 0 ? (
                            <AiCopilotSurfaceFeedback
                                ariaGroupLabel={asMicrocopyString(
                                    microcopy.feedback.taskAssistTitle
                                ).replace(
                                    "{section}",
                                    asMicrocopyString(
                                        microcopy.ai.suggestedStoryPoints
                                    )
                                )}
                                citationCount={0}
                                suggestionKey={taskAssistEstimateSuggestionKey}
                                surface="task-assist"
                            />
                        ) : null}
                        {estimateData ? (
                            <Tooltip title={microcopy.ai.regenerateLabel}>
                                <Button
                                    aria-label={microcopy.ai.regenerateLabel}
                                    disabled={estimateIsLoading}
                                    icon={<ReloadOutlined />}
                                    onClick={handleRegenerate}
                                    size="small"
                                    type="text"
                                />
                            </Tooltip>
                        ) : null}
                    </Space>
                }
            >
                {asMicrocopyString(microcopy.ai.suggestedStoryPoints)}
            </SectionHeading>
            <div aria-atomic="false" aria-live="polite">
                {!trimmedName && !estimateIsLoading && (
                    <Typography.Paragraph
                        style={{ margin: 0 }}
                        type="secondary"
                    >
                        {asMicrocopyString(microcopy.ai.estimateTaskNameHint)}
                    </Typography.Paragraph>
                )}
                {showEstimateSpinner && (
                    <Skeleton
                        active
                        aria-label={asMicrocopyString(
                            microcopy.ai.estimatingPoints
                        )}
                        paragraph={{ rows: 2 }}
                        title={false}
                    />
                )}
                {estimateError && (
                    <Alert
                        action={
                            errorView.retryable ? (
                                <Button
                                    onClick={handleRegenerate}
                                    size="small"
                                    type="link"
                                >
                                    {microcopy.ai.retryLabel}
                                </Button>
                            ) : null
                        }
                        title={errorView.heading}
                        showIcon
                        style={{ marginBottom: space.xs }}
                        type={errorView.severity}
                    />
                )}
                {estimateData && (
                    <div>
                        <div
                            style={{
                                alignItems: "center",
                                display: "flex",
                                gap: space.xs,
                                flexWrap: "wrap"
                            }}
                        >
                            <span
                                aria-label={asMicrocopyString(
                                    microcopy.ai.suggestedPointsAria
                                ).replace(
                                    "{points}",
                                    String(estimateData.storyPoints)
                                )}
                                style={{
                                    fontSize: fontSize.xxl,
                                    fontWeight: 600
                                }}
                            >
                                {estimateData.storyPoints}
                            </span>
                            <AiConfidenceIndicator
                                confidence={estimateData.confidence}
                                tooltip="Based on similar tasks on this board."
                            />
                            <Button
                                aria-label={asMicrocopyString(
                                    microcopy.ai.applyPointsAria
                                )}
                                onClick={handleApplyPoints}
                                size="small"
                                type={lowConfidence ? "default" : "primary"}
                            >
                                {lowConfidence
                                    ? microcopy.ai.applyAnyway
                                    : microcopy.actions.apply}
                            </Button>
                            {estimateData.similar.length > 1 && (
                                <Button
                                    aria-label={microcopy.ai.showAlternatives}
                                    onClick={() =>
                                        setShowAlternative((prev) => !prev)
                                    }
                                    size="small"
                                    type="link"
                                >
                                    {microcopy.ai.showAlternatives}
                                </Button>
                            )}
                        </div>
                        <Typography.Paragraph
                            style={{ margin: `${space.xxs}px 0` }}
                            type="secondary"
                        >
                            {estimateData.rationale}
                        </Typography.Paragraph>
                        {showAlternative && estimateData.similar.length > 1 && (
                            <Alert
                                title={
                                    <span>
                                        <strong>Alternative:</strong> similar
                                        task “
                                        {taskById(estimateData.similar[1]._id)
                                            ?.taskName ??
                                            estimateData.similar[1]._id}
                                        ” — {estimateData.similar[1].reason}
                                    </span>
                                }
                                showIcon
                                style={{ marginBottom: space.xs }}
                                type="info"
                            />
                        )}
                        {values.storyPoints !== undefined &&
                            values.storyPoints === estimateData.storyPoints && (
                                <AiSuggestedBadge
                                    onRevert={() => {
                                        const prev = previousPointsRef.current;
                                        if (
                                            prev !== undefined &&
                                            prev !== null
                                        ) {
                                            onApplyStoryPoints(
                                                prev as StoryPoints
                                            );
                                        }
                                    }}
                                    rationale={estimateData.rationale}
                                    style={{ marginInlineEnd: space.xs }}
                                />
                            )}
                        {estimateData.similar.length > 0 && (
                            <div>
                                <strong>
                                    {asMicrocopyString(
                                        microcopy.ai.similarTasks
                                    )}
                                </strong>
                                <ul style={{ paddingLeft: space.lg }}>
                                    {estimateData.similar.map((entry) => {
                                        const task = taskById(entry._id);
                                        return (
                                            <li key={entry._id}>
                                                <Button
                                                    onClick={() =>
                                                        onOpenSimilarTask(
                                                            entry._id
                                                        )
                                                    }
                                                    size="small"
                                                    style={{
                                                        height: "auto",
                                                        padding: 0
                                                    }}
                                                    type="link"
                                                >
                                                    {task?.taskName ??
                                                        entry._id}
                                                </Button>{" "}
                                                <Typography.Text type="secondary">
                                                    — {entry.reason}
                                                </Typography.Text>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div style={{ marginTop: space.md }}>
                <SectionHeading
                    right={
                        readinessData &&
                        !showReadinessSpinner &&
                        taskAssistReadinessSuggestionKey.length > 0 ? (
                            <AiCopilotSurfaceFeedback
                                ariaGroupLabel={asMicrocopyString(
                                    microcopy.feedback.taskAssistTitle
                                ).replace(
                                    "{section}",
                                    asMicrocopyString(
                                        microcopy.ai.readinessCheck
                                    )
                                )}
                                citationCount={0}
                                suggestionKey={taskAssistReadinessSuggestionKey}
                                surface="task-assist"
                            />
                        ) : null
                    }
                >
                    {asMicrocopyString(microcopy.ai.readinessCheck)}
                </SectionHeading>
            </div>
            <div aria-atomic="false" aria-live="polite">
                {showReadinessSpinner && (
                    <Skeleton
                        active
                        aria-label={asMicrocopyString(
                            microcopy.ai.runningReadiness
                        )}
                        paragraph={{ rows: 1 }}
                        title={false}
                    />
                )}
                {readinessError && (
                    <Alert
                        title={readinessErrorView.heading}
                        showIcon
                        style={{ marginBottom: space.xs }}
                        type={readinessErrorView.severity}
                    />
                )}
                {readinessData && readinessData.issues.length === 0 && (
                    <Alert
                        title={asMicrocopyString(microcopy.ai.readinessReady)}
                        showIcon
                        type="success"
                    />
                )}
                {readinessData &&
                    readinessData.issues
                        .filter(
                            (issue) =>
                                !dismissedKeys.has(
                                    `${issue.field}-${issue.message}`
                                )
                        )
                        .map((issue) => (
                            <Alert
                                action={
                                    issue.suggestion ? (
                                        <Button
                                            aria-label={microcopy.a11y.applyReadinessSuggestion.replace(
                                                "{field}",
                                                issue.field
                                            )}
                                            onClick={() =>
                                                handleApplyReadiness(issue)
                                            }
                                            size="small"
                                            type="link"
                                        >
                                            {microcopy.actions.apply}
                                        </Button>
                                    ) : null
                                }
                                closable
                                description={issue.suggestion}
                                key={`${issue.field}-${issue.message}`}
                                onClose={() => {
                                    setDismissedKeys((prev) => {
                                        const next = new Set(prev);
                                        next.add(
                                            `${issue.field}-${issue.message}`
                                        );
                                        return next;
                                    });
                                }}
                                showIcon
                                style={{ marginBottom: space.xxs }}
                                title={`${microcopy.a11y.aiSuggestion}: ${issue.message}`}
                                type={
                                    issue.severity === "error"
                                        ? "error"
                                        : issue.severity === "warn"
                                          ? "warning"
                                          : "info"
                                }
                            />
                        ))}
            </div>
        </Card>
    );
};

export default AiTaskAssistPanel;
