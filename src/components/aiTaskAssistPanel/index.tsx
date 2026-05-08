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

    const debouncedValues = useDebounce(values, 1000);
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
        250
    );
    const showReadinessSpinner = useDelayedFlag(
        readinessIsLoading && !readinessData,
        250
    );
    /**
     * Dismissed readiness issues (T-R5). Cleared whenever the task name
     * changes so a new run shows fresh issues. The set holds composite
     * `field + message` keys to handle multiple issues per field.
     */
    const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
        () => new Set()
    );
    /** Most recently applied story-point value, captured for Undo (T-R1). */
    const previousPointsRef = useRef<number | undefined>(values.storyPoints);
    const [showAlternative, setShowAlternative] = useState(false);
    const undoToast = useUndoToast();
    const errorView = aiErrorView(estimateError);
    const readinessErrorView = aiErrorView(readinessError);

    /**
     * Stale-data guard (T-R7, T-R9). When the trimmed task name is empty,
     * clear both AI state hooks so the panel renders the empty-state copy
     * instead of the previous task's estimate. Whitespace-only changes
     * to the *name* are skipped, but real context changes (board / tasks
     * /members loading in after mount) still re-fire so cold caches
     * don't strand the panel.
     */
    const trimmedName = taskName.trim();
    const remotePrompt = useMemo(() => {
        if (!trimmedName) return "";
        return (
            `Estimate task: name="${trimmedName}"` +
            (debouncedValues.type ? ` type="${debouncedValues.type}"` : "") +
            (debouncedValues.epic ? ` epic="${debouncedValues.epic}"` : "") +
            (debouncedValues.note ? ` note="${debouncedValues.note}"` : "")
        );
    }, [
        trimmedName,
        debouncedValues.type,
        debouncedValues.epic,
        debouncedValues.note
    ]);
    useEffect(() => {
        if (!trimmedName) {
            resetEstimate();
            resetReadiness();
            setDismissedKeys(new Set());
            if (isRemote) {
                abortRemoteEstimate();
                clearRemoteSuggestion();
            }
            return;
        }
        setDismissedKeys(new Set());
        if (isRemote) {
            void startRemoteEstimate(remotePrompt, { autonomy: "plan" });
        } else {
            runEstimate({
                estimate: {
                    taskName: trimmedName,
                    note: debouncedValues.note,
                    epic: debouncedValues.epic,
                    type: debouncedValues.type,
                    tasks,
                    excludeTaskId,
                    context: {
                        project: { _id: projectId ?? "", projectName: "" },
                        columns,
                        tasks,
                        members
                    }
                }
            }).catch(() => undefined);
            runReadiness({
                readiness: {
                    taskName: trimmedName,
                    note: debouncedValues.note,
                    epic: debouncedValues.epic,
                    type: debouncedValues.type,
                    coordinatorId: debouncedValues.coordinatorId,
                    context: {
                        project: { _id: projectId ?? "", projectName: "" },
                        columns,
                        tasks,
                        members
                    }
                }
            }).catch(() => undefined);
        }
    }, [
        trimmedName,
        debouncedValues.note,
        debouncedValues.epic,
        debouncedValues.type,
        debouncedValues.coordinatorId,
        excludeTaskId,
        projectId,
        columns,
        tasks,
        members,
        isRemote,
        remotePrompt,
        startRemoteEstimate,
        abortRemoteEstimate,
        clearRemoteSuggestion,
        runEstimate,
        runReadiness,
        resetEstimate,
        resetReadiness
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
            description: (microcopy.ai.storyPointsSet as string).replace(
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
                description: (
                    microcopy.ai.readinessFieldUpdated as string
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
            void startRemoteEstimate(remotePrompt, { autonomy: "plan" });
        } else {
            runEstimate({
                estimate: {
                    taskName: trimmedName,
                    note: debouncedValues.note,
                    epic: debouncedValues.epic,
                    type: debouncedValues.type,
                    tasks,
                    excludeTaskId,
                    context: {
                        project: { _id: projectId ?? "", projectName: "" },
                        columns,
                        tasks,
                        members
                    }
                }
            }).catch(() => undefined);
        }
    }, [
        trimmedName,
        debouncedValues.note,
        debouncedValues.epic,
        debouncedValues.type,
        excludeTaskId,
        projectId,
        columns,
        tasks,
        members,
        isRemote,
        remotePrompt,
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
            <SectionHeading
                right={
                    estimateData ? (
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
                    ) : null
                }
            >
                {microcopy.ai.suggestedStoryPoints as string}
            </SectionHeading>
            <div aria-atomic="false" aria-live="polite">
                {!trimmedName && !estimateIsLoading && (
                    <Typography.Paragraph
                        style={{ margin: 0 }}
                        type="secondary"
                    >
                        {microcopy.ai.estimateTaskNameHint as string}
                    </Typography.Paragraph>
                )}
                {showEstimateSpinner && (
                    <Skeleton
                        active
                        aria-label={microcopy.ai.estimatingPoints as string}
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
                                aria-label={(
                                    microcopy.ai.suggestedPointsAria as string
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
                                aria-label={
                                    microcopy.ai.applyPointsAria as string
                                }
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
                                    {microcopy.ai.similarTasks as string}
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
                <SectionHeading>
                    {microcopy.ai.readinessCheck as string}
                </SectionHeading>
            </div>
            <div aria-atomic="false" aria-live="polite">
                {showReadinessSpinner && (
                    <Skeleton
                        active
                        aria-label={microcopy.ai.runningReadiness as string}
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
                        title={microcopy.ai.readinessReady as string}
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
