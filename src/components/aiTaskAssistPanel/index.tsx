import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Info,
    RotateCw,
    X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react"; // useRef kept for previousPointsRef
import { useParams } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    accent,
    fontSize,
    fontWeight,
    radius,
    space
} from "../../theme/tokens";
import { confidenceBand } from "../../utils/ai/confidenceBand";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
import { extractSuggestionRunId } from "../../utils/ai/extractSuggestionRunId";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useAiLedger from "../../utils/hooks/useAiLedger";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import useDebounce from "../../utils/hooks/useDebounce";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import useUndoToast from "../../utils/hooks/useUndoToast";
import AiConfidenceIndicator from "../aiConfidenceIndicator";
import AiSparkleIcon from "../aiSparkleIcon";
import AiSuggestedBadge from "../aiSuggestedBadge";
import AiWhyPopover from "../aiWhyPopover";
import CopilotChip from "../copilotChip";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import GlassPanel from "../glassPanel";
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

/*
 * Suggestion cross-fade. When an estimate resolves, the loading skeleton
 * gives way to the result block; a hard swap reads as a flash. This subtle
 * fade + upward drift eases the resolved suggestion in so the transition
 * from "thinking" to "answer" feels continuous. It plays once whenever the
 * result block mounts (i.e. each time a fresh suggestion arrives, including
 * after Regenerate). The `animate-in fade-in / slide-in-from-bottom` utility
 * (tailwindcss-animate) is silenced under `prefers-reduced-motion: reduce`
 * by the global rule in `App.css`, so reduced-motion users get the instant
 * skeleton→content swap with no drift.
 */
const SUGGESTION_REVEAL_CLASS =
    "animate-in fade-in-0 slide-in-from-bottom-1 duration-200";

type ErrorSeverity = "error" | "warning" | "info";

const severityVariant = (
    severity: ErrorSeverity
): "destructive" | "warning" | "info" =>
    severity === "error" ? "destructive" : severity;

const SeverityIcon: React.FC<{ severity: ErrorSeverity }> = ({ severity }) => {
    if (severity === "error") return <AlertCircle aria-hidden />;
    if (severity === "warning") return <AlertTriangle aria-hidden />;
    return <Info aria-hidden />;
};

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
    const remoteAiConsentGranted = useRemoteAiConsent(environment.aiBaseUrl);

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
    /**
     * Most recently applied story-point value, captured for Undo.
     *
     * Issue #8 (A8 review) — deferred: when the user stacks applies
     * (A → B → C), each ledger entry's `previous` captures the
     * immediately-prior value, so reverting C restores B, then reverting
     * B restores A. Reverting B *first* (skipping C) jumps the field to
     * A but leaves C's stale entry in place; clicking C's revert then
     * snaps the field back to B (already reverted). This is out of scope
     * for the A8 PR — a proper fix needs a per-id snapshot store keyed
     * by ledger id, which the parent task ticket tracks separately.
     */
    const previousPointsRef = useRef<number | undefined>(values.storyPoints);
    const [showAlternative, setShowAlternative] = useState(false);
    const undoToast = useUndoToast();
    /*
     * Activity ledger (A8): each accepted suggestion logs an entry so the
     * dock's session-level activity log can surface a one-click revert
     * even after the 10-second toast window closes. We destructure the
     * memoized callbacks so dependency arrays stay narrow — the parent
     * `aiLedger` object is a fresh reference every render and would
     * otherwise re-fire any effect/callback that listed it (issue #5 in
     * the A8 review).
     */
    const { record: recordLedger, remove: removeLedger } = useAiLedger();
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
        if (!remoteAiConsentGranted) return;
        const clearDismissed = () =>
            setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
        clearDismissed();
        void startRemoteEstimate(remoteInput, { autonomy: "plan" });
    }, [
        trimmedName,
        isRemote,
        remoteAiConsentGranted,
        remoteInput,
        startRemoteEstimate
    ]);

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
        /*
         * A8 contract (issues #2 / #3): the ledger is the authoritative
         * record. We record the entry FIRST so we have the id, then wire
         * BOTH the 10 s toast Undo and the ledger entry's own undo
         * closure to call back into the same path AND drop the ledger
         * entry. Without this, clicking toast Undo reverted the value
         * but left the ledger row in place — clicking ledger Revert
         * later would then re-apply the same undo against state that
         * already reverted, causing duplicate side effects.
         *
         * `removeLedger(id)` drops the entry without re-running the
         * closure; `recordedRef`/guard via the early return below makes
         * the closure idempotent so concurrent toast+ledger paths can't
         * cause double reverts.
         */
        const performUndo = () => {
            if (previous === undefined) return;
            onApplyStoryPoints(previous as StoryPoints);
            previousPointsRef.current = previous;
        };
        const ledgerId = recordLedger({
            description: asMicrocopyString(
                microcopy.aiActivityLog.descriptions.taskAssistPointsApplied
            )
                .replace("{points}", String(next))
                .replace("{taskName}", values.taskName ?? ""),
            surface: "task-assist",
            undo:
                previous === undefined
                    ? undefined
                    : () => {
                          performUndo();
                      }
        });
        undoToast.show({
            description: asMicrocopyString(microcopy.ai.storyPointsSet).replace(
                "{points}",
                String(next)
            ),
            analyticsTag: "copilot.estimate.apply",
            undo: () => {
                performUndo();
                /*
                 * Synchronized contract: the toast Undo has already
                 * performed the reversal, so drop the ledger entry
                 * without firing the undo a second time. `remove(id)`
                 * is a no-op if the user already clicked the ledger's
                 * Revert button first.
                 */
                removeLedger(ledgerId);
            }
        });
    }, [
        estimateData,
        onApplyStoryPoints,
        recordLedger,
        removeLedger,
        undoToast,
        values.taskName
    ]);

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
            /*
             * A8 contract (issues #2 / #3): record first to capture the
             * ledger id, then wire BOTH the toast and the ledger's own
             * undo closure to share a single `performUndo`. The toast
             * Undo additionally calls `removeLedger(id)` so the activity
             * log row is dropped immediately — without this, clicking
             * the toast Undo for an append-style mutation (e.g. a
             * suggestion that appended to the description) would revert
             * the field but leave the ledger row, and clicking ledger
             * Revert later would replay the same revert against state
             * the user has likely edited in the meantime.
             */
            const performUndo = () => {
                onApplySuggestion(issue.field, previous, { replace: true });
            };
            const ledgerId = recordLedger({
                description: asMicrocopyString(
                    microcopy.aiActivityLog.descriptions.taskAssistFieldApplied
                )
                    .replace("{taskName}", values.taskName ?? "")
                    .replace("{field}", String(issue.field)),
                surface: "task-assist",
                undo: () => {
                    performUndo();
                }
            });
            undoToast.show({
                description: asMicrocopyString(
                    microcopy.ai.readinessFieldUpdated
                ).replace("{field}", String(issue.field)),
                analyticsTag: "copilot.readiness.apply",
                undo: () => {
                    performUndo();
                    removeLedger(ledgerId);
                }
            });
        },
        [
            excludeTaskId,
            onApplySuggestion,
            projectId,
            recordLedger,
            removeLedger,
            undoToast,
            values
        ]
    );

    const handleRegenerate = useCallback(() => {
        if (!trimmedName) return;
        track(ANALYTICS_EVENTS.COPILOT_CHAT_REGENERATE, {
            surface: "estimate"
        });
        if (isRemote) {
            if (!remoteAiConsentGranted) return;
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
        remoteAiConsentGranted,
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
    /*
     * Consent-pending gate: in remote mode no request fires until the
     * user acknowledges the remote-AI notice, so the two suggestion
     * sections would render as bare headings over permanently-empty
     * bodies. Collapse them and let the consent notice own the panel
     * until acknowledgement.
     */
    const consentPending = isRemote && !remoteAiConsentGranted;
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
        <TooltipProvider>
            <GlassPanel
                intensity="strong"
                tone="aurora"
                style={{
                    // Match the original AntD Card `size="small"` corner so
                    // the migrated panel sits at the same radius the rest of
                    // the form's surfaces resolve to (radius.md, not the
                    // GlassPanel default of radius.lg).
                    borderRadius: radius.md,
                    marginTop: space.md
                }}
            >
                {/*
                 * The GlassPanel paints the frosted surface (background +
                 * blur + border + shine). This header/body pair reproduces
                 * the structure the inner AntD Card `size="small"` used to
                 * supply — a title row with a bottom-border separator and a
                 * padded body — while staying fully transparent so the
                 * panel's glass shows through.
                 */}
                <div className="flex flex-wrap items-center gap-xs border-b border-border px-sm py-xs">
                    <AiSparkleIcon aria-hidden />
                    <span style={{ fontWeight: fontWeight.semibold }}>
                        {microcopy.ai.copilotLabel}
                    </span>
                    <CopilotChip variant="badge">
                        {microcopy.a11y.aiBadge}
                    </CopilotChip>
                    {/*
                     * EngineModeTag now mounts once in the global header.
                     */}
                    <CopilotPrivacyPopover route="estimate" />
                </div>
                <div className="px-sm py-xs">
                    <CopilotRemoteConsentNotice route="estimate" />
                    <SrOnlyLive>{suggestionStatusAnnouncement}</SrOnlyLive>
                    {consentPending ? null : (
                        <>
                            <SectionHeading
                                right={
                                    <span className="inline-flex flex-wrap items-center gap-xs">
                                        {estimateData &&
                                        !showEstimateSpinner &&
                                        taskAssistEstimateSuggestionKey.length >
                                            0 ? (
                                            <AiCopilotSurfaceFeedback
                                                ariaGroupLabel={asMicrocopyString(
                                                    microcopy.feedback
                                                        .taskAssistTitle
                                                ).replace(
                                                    "{section}",
                                                    asMicrocopyString(
                                                        microcopy.ai
                                                            .suggestedStoryPoints
                                                    )
                                                )}
                                                citationCount={0}
                                                suggestionKey={
                                                    taskAssistEstimateSuggestionKey
                                                }
                                                surface="task-assist"
                                            />
                                        ) : null}
                                        {estimateData ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        aria-label={
                                                            microcopy.ai
                                                                .regenerateLabel
                                                        }
                                                        disabled={
                                                            estimateIsLoading
                                                        }
                                                        onClick={
                                                            handleRegenerate
                                                        }
                                                        size="icon"
                                                        variant="ghost"
                                                    >
                                                        <RotateCw aria-hidden />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {
                                                        microcopy.ai
                                                            .regenerateLabel
                                                    }
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : null}
                                    </span>
                                }
                            >
                                {asMicrocopyString(
                                    microcopy.ai.suggestedStoryPoints
                                )}
                            </SectionHeading>
                            <div aria-atomic="false" aria-live="polite">
                                {!trimmedName && !estimateIsLoading && (
                                    <Typography.Paragraph
                                        style={{ margin: 0 }}
                                        type="secondary"
                                    >
                                        {asMicrocopyString(
                                            microcopy.ai.estimateTaskNameHint
                                        )}
                                    </Typography.Paragraph>
                                )}
                                {showEstimateSpinner && (
                                    <div
                                        aria-label={asMicrocopyString(
                                            microcopy.ai.estimatingPoints
                                        )}
                                        role="status"
                                    >
                                        <Skeleton className="mb-xs h-4 w-full" />
                                        <Skeleton className="h-4 w-2/3" />
                                    </div>
                                )}
                                {estimateError && (
                                    <Alert
                                        className="mb-xs"
                                        variant={severityVariant(
                                            errorView.severity
                                        )}
                                    >
                                        <SeverityIcon
                                            severity={errorView.severity}
                                        />
                                        <AlertTitle>
                                            {errorView.heading}
                                        </AlertTitle>
                                        {errorView.retryable ? (
                                            <AlertDescription>
                                                <Button
                                                    className="h-auto p-0"
                                                    onClick={handleRegenerate}
                                                    size="sm"
                                                    variant="link"
                                                >
                                                    {microcopy.ai.retryLabel}
                                                </Button>
                                            </AlertDescription>
                                        ) : null}
                                    </Alert>
                                )}
                                {estimateData && (
                                    <div
                                        className={SUGGESTION_REVEAL_CLASS}
                                        data-testid="ai-suggestion-reveal"
                                    >
                                        {/*
                                         * Load-bearing estimate block. Pulled into its
                                         * own tinted, rounded container so the number +
                                         * confidence + Apply always read as the primary
                                         * output of the panel rather than the first line
                                         * of an undifferentiated wall of text (§1.2.12).
                                         */}
                                        <div
                                            style={{
                                                alignItems: "center",
                                                background: accent.bgSubtle,
                                                borderRadius: radius.sm,
                                                display: "flex",
                                                gap: space.sm,
                                                flexWrap: "wrap",
                                                paddingBlock: space.xs,
                                                paddingInline: space.sm
                                            }}
                                        >
                                            <span
                                                aria-label={asMicrocopyString(
                                                    microcopy.ai
                                                        .suggestedPointsAria
                                                ).replace(
                                                    "{points}",
                                                    String(
                                                        estimateData.storyPoints
                                                    )
                                                )}
                                                style={{
                                                    fontSize: fontSize.xxl,
                                                    fontWeight:
                                                        fontWeight.semibold,
                                                    lineHeight: 1
                                                }}
                                            >
                                                {estimateData.storyPoints}
                                            </span>
                                            <AiConfidenceIndicator
                                                confidence={
                                                    estimateData.confidence
                                                }
                                                tooltip={asMicrocopyString(
                                                    microcopy.ai
                                                        .estimateConfidenceTooltip
                                                )}
                                            />
                                            <span
                                                style={{ flex: "1 1 auto" }}
                                            />
                                            <Button
                                                aria-label={asMicrocopyString(
                                                    microcopy.ai.applyPointsAria
                                                )}
                                                onClick={handleApplyPoints}
                                                size="sm"
                                                variant={
                                                    lowConfidence
                                                        ? "default"
                                                        : "primary"
                                                }
                                            >
                                                {lowConfidence
                                                    ? microcopy.ai.applyAnyway
                                                    : microcopy.actions.apply}
                                            </Button>
                                            {estimateData.similar.length >
                                                1 && (
                                                <Button
                                                    aria-label={
                                                        microcopy.ai
                                                            .showAlternatives
                                                    }
                                                    onClick={() =>
                                                        setShowAlternative(
                                                            (prev) => !prev
                                                        )
                                                    }
                                                    size="sm"
                                                    variant="link"
                                                >
                                                    {
                                                        microcopy.ai
                                                            .showAlternatives
                                                    }
                                                </Button>
                                            )}
                                            <AiWhyPopover
                                                ariaContext={asMicrocopyString(
                                                    microcopy.ai
                                                        .suggestedStoryPoints
                                                )}
                                                rationale={
                                                    estimateData.rationale
                                                }
                                            />
                                        </div>
                                        {showAlternative &&
                                            estimateData.similar.length > 1 && (
                                                <Alert
                                                    className="my-xs"
                                                    variant="info"
                                                >
                                                    <Info aria-hidden />
                                                    <AlertTitle>
                                                        <strong>
                                                            Alternative:
                                                        </strong>{" "}
                                                        similar task “
                                                        {taskById(
                                                            estimateData
                                                                .similar[1]._id
                                                        )?.taskName ??
                                                            estimateData
                                                                .similar[1]._id}
                                                        ” —{" "}
                                                        {
                                                            estimateData
                                                                .similar[1]
                                                                .reason
                                                        }
                                                    </AlertTitle>
                                                </Alert>
                                            )}
                                        {values.storyPoints !== undefined &&
                                            values.storyPoints ===
                                                estimateData.storyPoints && (
                                                <div
                                                    style={{
                                                        marginBlockStart:
                                                            space.xs
                                                    }}
                                                >
                                                    <AiSuggestedBadge
                                                        onRevert={() => {
                                                            const prev =
                                                                previousPointsRef.current;
                                                            if (
                                                                prev !==
                                                                    undefined &&
                                                                prev !== null
                                                            ) {
                                                                onApplyStoryPoints(
                                                                    prev as StoryPoints
                                                                );
                                                            }
                                                        }}
                                                        rationale={
                                                            estimateData.rationale
                                                        }
                                                        style={{
                                                            marginInlineEnd:
                                                                space.xs
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        {estimateData.similar.length > 0 && (
                                            <section
                                                aria-label={asMicrocopyString(
                                                    microcopy.ai.similarTasks
                                                )}
                                            >
                                                <Separator className="my-sm" />
                                                <Typography.Text
                                                    strong
                                                    style={{
                                                        display: "block",
                                                        marginBlockEnd:
                                                            space.xxs
                                                    }}
                                                >
                                                    {asMicrocopyString(
                                                        microcopy.ai
                                                            .similarTasks
                                                    )}
                                                </Typography.Text>
                                                <ul
                                                    style={{
                                                        margin: 0,
                                                        paddingInlineStart:
                                                            space.lg
                                                    }}
                                                >
                                                    {estimateData.similar.map(
                                                        (entry) => {
                                                            const task =
                                                                taskById(
                                                                    entry._id
                                                                );
                                                            return (
                                                                <li
                                                                    key={
                                                                        entry._id
                                                                    }
                                                                    style={{
                                                                        marginBlockEnd:
                                                                            space.xxs
                                                                    }}
                                                                >
                                                                    <Button
                                                                        className="h-auto p-0"
                                                                        onClick={() =>
                                                                            onOpenSimilarTask(
                                                                                entry._id
                                                                            )
                                                                        }
                                                                        size="sm"
                                                                        variant="link"
                                                                    >
                                                                        {task?.taskName ??
                                                                            entry._id}
                                                                    </Button>{" "}
                                                                    <Typography.Text type="secondary">
                                                                        —{" "}
                                                                        {
                                                                            entry.reason
                                                                        }
                                                                    </Typography.Text>
                                                                </li>
                                                            );
                                                        }
                                                    )}
                                                </ul>
                                            </section>
                                        )}
                                    </div>
                                )}
                            </div>

                            <Separator className="my-md" />

                            <div>
                                <SectionHeading
                                    right={
                                        readinessData &&
                                        !showReadinessSpinner &&
                                        taskAssistReadinessSuggestionKey.length >
                                            0 ? (
                                            <AiCopilotSurfaceFeedback
                                                ariaGroupLabel={asMicrocopyString(
                                                    microcopy.feedback
                                                        .taskAssistTitle
                                                ).replace(
                                                    "{section}",
                                                    asMicrocopyString(
                                                        microcopy.ai
                                                            .readinessCheck
                                                    )
                                                )}
                                                citationCount={0}
                                                suggestionKey={
                                                    taskAssistReadinessSuggestionKey
                                                }
                                                surface="task-assist"
                                            />
                                        ) : null
                                    }
                                >
                                    {asMicrocopyString(
                                        microcopy.ai.readinessCheck
                                    )}
                                </SectionHeading>
                            </div>
                            <div aria-atomic="false" aria-live="polite">
                                {showReadinessSpinner && (
                                    <div
                                        aria-label={asMicrocopyString(
                                            microcopy.ai.runningReadiness
                                        )}
                                        role="status"
                                    >
                                        <Skeleton className="h-4 w-full" />
                                    </div>
                                )}
                                {readinessError && (
                                    <Alert
                                        className="mb-xs"
                                        variant={severityVariant(
                                            readinessErrorView.severity
                                        )}
                                    >
                                        <SeverityIcon
                                            severity={
                                                readinessErrorView.severity
                                            }
                                        />
                                        <AlertTitle>
                                            {readinessErrorView.heading}
                                        </AlertTitle>
                                    </Alert>
                                )}
                                {readinessData &&
                                    readinessData.issues.length === 0 && (
                                        <Alert variant="success">
                                            <CheckCircle2 aria-hidden />
                                            <AlertTitle>
                                                {asMicrocopyString(
                                                    microcopy.ai.readinessReady
                                                )}
                                            </AlertTitle>
                                        </Alert>
                                    )}
                                {readinessData &&
                                    readinessData.issues
                                        .filter(
                                            (issue) =>
                                                !dismissedKeys.has(
                                                    `${issue.field}-${issue.message}`
                                                )
                                        )
                                        .map((issue) => {
                                            const issueSeverity: ErrorSeverity =
                                                issue.severity === "error"
                                                    ? "error"
                                                    : issue.severity === "warn"
                                                      ? "warning"
                                                      : "info";
                                            return (
                                                <Alert
                                                    className="relative mb-xxs"
                                                    key={`${issue.field}-${issue.message}`}
                                                    variant={severityVariant(
                                                        issueSeverity
                                                    )}
                                                >
                                                    <SeverityIcon
                                                        severity={issueSeverity}
                                                    />
                                                    <AlertTitle>{`${microcopy.a11y.aiSuggestion}: ${issue.message}`}</AlertTitle>
                                                    {issue.suggestion ? (
                                                        <AlertDescription>
                                                            <span className="block">
                                                                {
                                                                    issue.suggestion
                                                                }
                                                            </span>
                                                            <Button
                                                                aria-label={microcopy.a11y.applyReadinessSuggestion.replace(
                                                                    "{field}",
                                                                    issue.field
                                                                )}
                                                                className="h-auto p-0"
                                                                onClick={() =>
                                                                    handleApplyReadiness(
                                                                        issue
                                                                    )
                                                                }
                                                                size="sm"
                                                                variant="link"
                                                            >
                                                                {
                                                                    microcopy
                                                                        .actions
                                                                        .apply
                                                                }
                                                            </Button>
                                                        </AlertDescription>
                                                    ) : null}
                                                    <button
                                                        aria-label={
                                                            microcopy.actions
                                                                .close
                                                        }
                                                        className="absolute right-sm top-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                        onClick={() => {
                                                            setDismissedKeys(
                                                                (prev) => {
                                                                    const next =
                                                                        new Set(
                                                                            prev
                                                                        );
                                                                    next.add(
                                                                        `${issue.field}-${issue.message}`
                                                                    );
                                                                    return next;
                                                                }
                                                            );
                                                        }}
                                                        type="button"
                                                    >
                                                        <X
                                                            aria-hidden
                                                            className="size-4"
                                                        />
                                                    </button>
                                                </Alert>
                                            );
                                        })}
                            </div>
                        </>
                    )}
                </div>
            </GlassPanel>
        </TooltipProvider>
    );
};

export default AiTaskAssistPanel;
