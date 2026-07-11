import { AlertCircle, AlertTriangle, Info, RotateCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, useForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { modalWidthCss } from "../../theme/tokens";
import { isMacLike } from "../../utils/platform";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
import { validateBreakdown, validateDraft } from "../../utils/ai/validate";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useAiLedger from "../../utils/hooks/useAiLedger";
import useApi from "../../utils/hooks/useApi";
import useAppMessage from "@/components/ui/toast";
import useAuth from "../../utils/hooks/useAuth";
import useCachedQueryData from "../../utils/hooks/useCachedQueryData";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import useUnsavedChangesGuard from "../../utils/hooks/useUnsavedChangesGuard";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import AiConfidenceIndicator from "../aiConfidenceIndicator";
import AiSparkleIcon from "../aiSparkleIcon";
import AiSuggestedBadge from "../aiSuggestedBadge";
import CopilotChip from "../copilotChip";
import { CopilotPrivacyDisclosure } from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import ResponsiveFormSheet from "../responsiveFormSheet";

interface AiTaskDraftModalProps {
    open: boolean;
    onClose: () => void;
    columnId?: string;
}

type BreakdownAxis = "by_phase" | "by_surface" | "by_risk" | "freeform";

const BREAKDOWN_AXES: BreakdownAxis[] = [
    "by_phase",
    "by_surface",
    "by_risk",
    "freeform"
];

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

/*
 * The draft action row wraps its controls on narrow modal bodies and stacks
 * each button / the axis picker full-width below the `sm` breakpoint; the
 * primitives already carry the ≥44px coarse-pointer touch floor.
 */
const DRAFT_ACTION_ROW_CLASS = "mb-md flex flex-wrap gap-xs";
const DRAFT_ACTION_ITEM_CLASS = "max-sm:w-full max-sm:flex-1";
const SAMPLE_PROMPT_BUTTON_CLASS =
    "h-auto max-w-full whitespace-normal text-left [overflow-wrap:anywhere]";

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

const STORY_POINT_OPTIONS = [1, 2, 3, 5, 8, 13] as const;

/**
 * Radix `Select` values are strings, so the numeric `storyPoints` field is
 * carried through the form as a string and coerced back to a number on
 * submit, keeping the string form out of the created task's wire payload.
 */
const toFormValues = (
    suggestion: IDraftTaskSuggestion
): Record<string, unknown> => ({
    ...suggestion,
    storyPoints:
        suggestion.storyPoints == null
            ? undefined
            : String(suggestion.storyPoints)
});

const AiTaskDraftModal: React.FC<AiTaskDraftModalProps> = ({
    open,
    onClose,
    columnId
}) => {
    // Toasts route through the sonner-backed `message` seam, which
    // no-ops until a `<Toaster>` is mounted (test-safe by default).
    const message = useAppMessage();
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
    /*
     * Coarse-pointer chrome has no hardware keyboard, so the
     * "⌘⏎ / Ctrl+Enter to draft" hint reads as noise there.
     */
    const isPhoneChrome = useIsPhoneChrome();
    /*
     * A8 activity ledger: each drafted task that lands creates an entry
     * so the dock's session log can show + revert AI-created work even
     * after the bulk-progress toast disappears.
     *
     * We destructure `record` + `remove` so the bulk-undo path can drop
     * the per-subtask ledger rows synchronously after the toast Undo
     * runs — without this, the bulk toast would delete the BE rows but
     * leave the per-subtask ledger entries pointing at now-404'd ids
     * (issues #3 / #7 in the A8 review).
     */
    const { record: recordLedger, remove: removeLedger } = useAiLedger();

    // Mount ALL hooks unconditionally (React hook ordering rule).
    // Only one engine path drives the UI based on environment.aiUseLocalEngine.
    const draftAi = useAi<IDraftTaskSuggestion>({ route: "task-draft" });
    const breakdownAi = useAi<ITaskBreakdownSuggestion>({
        route: "task-breakdown"
    });
    const remoteAgent = useAgent("task-drafting-agent", { projectId });

    const isRemote = !environment.aiUseLocalEngine;
    const remoteAiConsentGranted = useRemoteAiConsent(environment.aiBaseUrl);
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
            form.setFieldsValue(toFormValues(draft));
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
        if (isRemote && !remoteAiConsentGranted) return;
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
            form.setFieldsValue(toFormValues(suggestion));
            setAiFields(new Set(AI_FIELDS as string[]));
        }
    };

    const onBreakdown = async (axis: BreakdownAxis = breakdownAxis) => {
        if (!prompt.trim()) return;
        if (isRemote && !remoteAiConsentGranted) return;
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
        const result = await createTask({
            taskName: values.taskName,
            type: values.type,
            epic: values.epic,
            note: values.note,
            storyPoints:
                values.storyPoints == null || values.storyPoints === ""
                    ? undefined
                    : Number(values.storyPoints),
            columnId: values.columnId,
            coordinatorId: values.coordinatorId,
            projectId
        });
        /*
         * A8: log the AI-drafted task creation. Undo deletes the task
         * through the existing tasks endpoint and invalidates the
         * cached list so the board removes the row immediately. If the
         * create did not return an `_id` (optimistic-only path), we
         * still log the entry but skip the undo callback — the user
         * sees the activity entry without a broken Revert button.
         */
        const createdId =
            result &&
            typeof result === "object" &&
            "_id" in result &&
            typeof (result as { _id: string })._id === "string"
                ? (result as { _id: string })._id
                : null;
        recordLedger({
            description: microcopyString(
                microcopy.aiActivityLog.descriptions.taskDraftCreated
            ).replace("{taskName}", String(values.taskName ?? "")),
            surface: "task-draft",
            undo: createdId
                ? async () => {
                      await apiCall(`tasks/${createdId}`, { method: "DELETE" });
                      void queryClient.invalidateQueries({
                          queryKey: ["tasks", { projectId }]
                      });
                  }
                : undefined
        });
        onClose();
    };

    const onSubmitBreakdown = async () => {
        const selected = breakdownItems.filter(
            (_, index) => breakdownChecked[index]
        );
        if (selected.length === 0) return;
        setBulkProgress({ current: 0, total: selected.length });
        /*
         * A8 contract (issues #3 / #7): we track per-subtask `createdId`
         * AND per-subtask `ledgerId` so the bulk Undo toast can clean up
         * BOTH the BE rows and the corresponding activity-log entries
         * in a single pass. Without ledger-id capture, the toast Undo
         * would delete the BE rows but leave the ledger pointing at
         * now-404'd ids — and clicking a per-row Revert from the
         * activity log later would re-hit DELETE on the same id (404
         * for issues already removed, idempotent at best, surprising
         * at worst). The per-row revert path is also defensive: if the
         * user clicked a per-row Revert first, the bulk toast's loop
         * still does the DELETE — the BE call is idempotent (404 ≈
         * "already done") and the partial-failure counter surfaces the
         * net result. Issue #7 deferred: a perfect fix would require
         * the per-row revert to mark its createdId as already-undone
         * so the bulk loop could skip it; the existing
         * removed/failed/partial messaging is correct telemetry.
         */
        const created: string[] = [];
        const ledgerIds: string[] = [];
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
                const createdId =
                    result &&
                    typeof result === "object" &&
                    "_id" in result &&
                    typeof (result as { _id: string })._id === "string"
                        ? (result as { _id: string })._id
                        : null;
                if (createdId) created.push(createdId);
                /*
                 * A8: each subtask gets its own activity-ledger entry so
                 * the user can revert individual rows from the dock log
                 * (the bulk undo toast still covers the whole batch in
                 * the first 10 s).
                 */
                const ledgerId = recordLedger({
                    description: microcopyString(
                        microcopy.aiActivityLog.descriptions.taskDraftCreated
                    ).replace("{taskName}", item.taskName ?? ""),
                    surface: "task-draft",
                    undo: createdId
                        ? async () => {
                              await apiCall(`tasks/${createdId}`, {
                                  method: "DELETE"
                              });
                              void queryClient.invalidateQueries({
                                  queryKey: ["tasks", { projectId }]
                              });
                          }
                        : undefined
                });
                ledgerIds.push(ledgerId);
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
                    /*
                     * Sync ledger with the actual deletes. We drop every
                     * captured ledger row regardless of per-id outcome —
                     * the visible failure tally tells the user which
                     * tasks survived, and keeping ledger rows whose
                     * closures would 404 is worse than the brief loss
                     * of in-dock visibility for tasks the user can see
                     * back on the board. The `remove(id)` is a no-op if
                     * the user had already clicked the per-row Revert
                     * (the Map slot is already gone).
                     */
                    ledgerIds.forEach((id) => removeLedger(id));
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

    /*
     * §2.A.1 — guard the cancel / mask-close paths. "Dirty" here is wider
     * than a touched form: an unsubmitted prompt, an applied single draft,
     * or a pending breakdown selection all represent work the user could
     * lose. The `discard` is the parent `onClose` prop — the open→close
     * effect (`reset()`) still runs the form reset AND `remoteAbort()`, so
     * in-flight AI work is aborted on close exactly as before. Successful
     * create paths call `onClose` directly (below) so they never prompt.
     */
    const { requestClose, confirmNode } = useUnsavedChangesGuard({
        isDirty: () =>
            Boolean(prompt.trim()) ||
            breakdownMode ||
            breakdownItems.length > 0 ||
            Boolean(activeSuggestion) ||
            form.isFieldsTouched(),
        onConfirmDiscard: onClose
    });

    return (
        <>
            {confirmNode}
            <ResponsiveFormSheet
                data-testid="ai-task-draft-modal"
                destroyOnHidden
                footer={null}
                onClose={requestClose}
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
                    <span className="inline-flex flex-wrap items-center gap-xs">
                        <AiSparkleIcon aria-hidden />
                        <span style={{ fontWeight: 600 }}>
                            {microcopy.actions.draftWithAi}
                        </span>
                        <CopilotChip variant="badge">
                            {microcopy.a11y.aiBadge}
                        </CopilotChip>
                        {/*
                         * EngineModeTag now mounts once in the global header.
                         */}
                    </span>
                }
                width={modalWidthCss(640)}
            >
                <TooltipProvider>
                    <CopilotRemoteConsentNotice route="task-draft" />
                    <CopilotPrivacyDisclosure
                        route="task-draft"
                        storageKey="boardCopilot:draftPrivacyShown"
                    />
                    <div className="mb-md flex flex-col gap-xxs">
                        <Label htmlFor="ai-task-draft-prompt">
                            {microcopy.placeholders.describeWork}
                        </Label>
                        <Textarea
                            aria-label={microcopy.a11y.taskPrompt}
                            autoComplete="off"
                            enterKeyHint="go"
                            id="ai-task-draft-prompt"
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
                            placeholder={
                                microcopy.placeholders.taskPromptExample
                            }
                            rows={3}
                            value={prompt}
                        />
                        <div className="flex items-center justify-between gap-xs">
                            {!isPhoneChrome ? (
                                <Typography.Text type="secondary">
                                    {isMacLike() ? "⌘⏎" : "Ctrl+Enter"} to
                                    draft.
                                </Typography.Text>
                            ) : (
                                <span />
                            )}
                            <Typography.Text
                                aria-hidden
                                className="tabular-nums"
                                type="secondary"
                            >
                                {`${prompt.length} / 1000`}
                            </Typography.Text>
                        </div>
                    </div>
                    {!prompt.trim() && (
                        <div className="mb-sm flex max-w-full flex-wrap gap-xs">
                            {samplePrompts.map((sample) => (
                                <Button
                                    className={SAMPLE_PROMPT_BUTTON_CLASS}
                                    key={sample}
                                    onClick={() => setPrompt(sample)}
                                    size="sm"
                                    variant="default"
                                >
                                    {sample}
                                </Button>
                            ))}
                        </div>
                    )}
                    <div
                        className={DRAFT_ACTION_ROW_CLASS}
                        data-testid="ai-task-draft-action-row"
                    >
                        <Button
                            aria-label={microcopy.a11y.draftTaskWithCopilot}
                            className={DRAFT_ACTION_ITEM_CLASS}
                            disabled={!prompt.trim()}
                            loading={
                                isRemote ? activeIsLoading : draftAi.isLoading
                            }
                            onClick={onDraft}
                            variant="primary"
                        >
                            {microcopy.actions.draftTask}
                        </Button>
                        <Select
                            onValueChange={(value) =>
                                onBreakdownAxisChange(value as BreakdownAxis)
                            }
                            value={breakdownAxis}
                        >
                            <SelectTrigger
                                aria-label={microcopy.a11y.breakdownAxisLabel}
                                className={cn(
                                    DRAFT_ACTION_ITEM_CLASS,
                                    "sm:w-[180px]"
                                )}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {BREAKDOWN_AXES.map((axis) => (
                                    <SelectItem
                                        key={axis}
                                        title={microcopyString(
                                            microcopy.ai.breakdownAxes[axis]
                                                .tooltip
                                        )}
                                        value={axis}
                                    >
                                        {microcopy.ai.breakdownAxes[axis].label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            aria-label={microcopy.a11y.breakPromptIntoSubtasks}
                            className={DRAFT_ACTION_ITEM_CLASS}
                            disabled={!prompt.trim()}
                            loading={
                                isRemote
                                    ? activeIsLoading
                                    : breakdownAi.isLoading
                            }
                            onClick={() => onBreakdown()}
                        >
                            {microcopy.actions.breakDown}
                        </Button>
                        {(Boolean(activeSuggestion) || breakdownMode) && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        aria-label={
                                            microcopy.ai.regenerateLabel
                                        }
                                        disabled={
                                            isRemote
                                                ? activeIsLoading
                                                : draftAi.isLoading ||
                                                  breakdownAi.isLoading
                                        }
                                        onClick={handleRegenerate}
                                        size="icon"
                                        variant="ghost"
                                    >
                                        <RotateCw aria-hidden />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {microcopy.ai.regenerateLabel}
                                </TooltipContent>
                            </Tooltip>
                        )}
                    </div>

                    {activeError && (
                        <Alert
                            className="mb-md"
                            variant={severityVariant(draftErrorView.severity)}
                        >
                            <SeverityIcon severity={draftErrorView.severity} />
                            <AlertTitle>{draftErrorView.heading}</AlertTitle>
                            {draftErrorView.body ? (
                                <AlertDescription>
                                    {draftErrorView.body}
                                </AlertDescription>
                            ) : null}
                            {draftErrorView.retryable ? (
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

                    {bulkProgress && (
                        <div
                            aria-label={microcopyString(
                                microcopy.a11y.creatingSubtasks
                            )}
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={breakdownProgressPercent}
                            className="mb-md"
                            role="progressbar"
                        >
                            <div className="h-2 w-full overflow-hidden rounded-pill bg-muted">
                                <div
                                    className="h-full rounded-pill bg-primary transition-all"
                                    style={{
                                        width: `${breakdownProgressPercent}%`
                                    }}
                                />
                            </div>
                            <div className="mt-xxs text-xs text-muted-foreground">
                                {microcopy.ai.bulkProgressFormat
                                    .replace(
                                        "{current}",
                                        String(bulkProgress.current)
                                    )
                                    .replace(
                                        "{total}",
                                        String(bulkProgress.total)
                                    )}
                            </div>
                        </div>
                    )}

                    {showForm && activeSuggestion && (
                        <Form
                            form={form}
                            initialValues={toFormValues(activeSuggestion)}
                            layout="vertical"
                            onFinish={onSubmitSingle}
                        >
                            <Alert className="mb-sm" variant="info">
                                <Info aria-hidden />
                                <AlertTitle>
                                    {`${microcopy.a11y.aiSuggestion} · ${microcopy.ai.reviewAndEdit}`}{" "}
                                    <AiConfidenceIndicator
                                        confidence={activeSuggestion.confidence}
                                    />
                                </AlertTitle>
                                {activeSuggestion.rationale ? (
                                    <AlertDescription>
                                        {activeSuggestion.rationale}
                                    </AlertDescription>
                                ) : null}
                            </Alert>
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
                                        message:
                                            microcopy.validation
                                                .taskNameRequired
                                    }
                                ]}
                                validateTrigger={["onBlur", "onSubmit"]}
                            >
                                <Input
                                    autoComplete="off"
                                    enterKeyHint="next"
                                    inputMode="text"
                                    onChange={() => handleFieldEdit("taskName")}
                                />
                            </Form.Item>
                            <Form.Item
                                extra={
                                    aiFields.has("type") && (
                                        <AiSuggestedBadge compact />
                                    )
                                }
                                label={microcopy.fields.type}
                                name="type"
                                trigger="onValueChange"
                            >
                                <Select
                                    onValueChange={() =>
                                        handleFieldEdit("type")
                                    }
                                >
                                    <SelectTrigger
                                        aria-label={microcopy.fields.type}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Task">
                                            {microcopy.options.taskTypes.task}
                                        </SelectItem>
                                        <SelectItem value="Bug">
                                            {microcopy.options.taskTypes.bug}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </Form.Item>
                            <Form.Item
                                extra={
                                    aiFields.has("epic") && (
                                        <AiSuggestedBadge compact />
                                    )
                                }
                                label={microcopy.fields.epic}
                                name="epic"
                            >
                                <Input
                                    autoComplete="off"
                                    enterKeyHint="next"
                                    inputMode="text"
                                    onChange={() => handleFieldEdit("epic")}
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
                                trigger="onValueChange"
                            >
                                <Select
                                    onValueChange={() =>
                                        handleFieldEdit("storyPoints")
                                    }
                                >
                                    <SelectTrigger
                                        aria-label={
                                            microcopy.fields.storyPoints
                                        }
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {STORY_POINT_OPTIONS.map((value) => (
                                            <SelectItem
                                                key={value}
                                                value={String(value)}
                                            >
                                                {value}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Form.Item>
                            <Form.Item
                                extra={
                                    aiFields.has("columnId") && (
                                        <AiSuggestedBadge compact />
                                    )
                                }
                                label={microcopy.fields.column}
                                name="columnId"
                                trigger="onValueChange"
                            >
                                <Select
                                    onValueChange={() =>
                                        handleFieldEdit("columnId")
                                    }
                                >
                                    <SelectTrigger
                                        aria-label={microcopy.fields.column}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {columns.map((column) => (
                                            <SelectItem
                                                key={column._id}
                                                value={column._id}
                                            >
                                                {column.columnName}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Form.Item>
                            <Form.Item
                                extra={
                                    aiFields.has("coordinatorId") && (
                                        <AiSuggestedBadge compact />
                                    )
                                }
                                label={microcopy.fields.coordinator}
                                name="coordinatorId"
                                trigger="onValueChange"
                            >
                                <Select
                                    onValueChange={() =>
                                        handleFieldEdit("coordinatorId")
                                    }
                                >
                                    <SelectTrigger
                                        aria-label={
                                            microcopy.fields.coordinator
                                        }
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {members.map((member) => (
                                            <SelectItem
                                                key={member._id}
                                                value={member._id}
                                            >
                                                {member.username}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Form.Item>
                            <Form.Item
                                extra={
                                    aiFields.has("note") && (
                                        <AiSuggestedBadge compact />
                                    )
                                }
                                label={microcopy.fields.notes}
                                name="note"
                            >
                                <Textarea
                                    autoComplete="off"
                                    enterKeyHint="done"
                                    inputMode="text"
                                    onChange={() => handleFieldEdit("note")}
                                    rows={4}
                                />
                            </Form.Item>
                            <div className="flex flex-wrap justify-end gap-xs">
                                <Button onClick={requestClose}>
                                    {microcopy.actions.cancel}
                                </Button>
                                <Button
                                    loading={creating}
                                    type="submit"
                                    variant="primary"
                                >
                                    {microcopy.actions.createTask}
                                </Button>
                            </div>
                        </Form>
                    )}

                    {breakdownMode && breakdownItems.length > 0 && (
                        <div aria-label={microcopy.a11y.subtaskBreakdown}>
                            <Alert className="mb-sm" variant="info">
                                <Info aria-hidden />
                                <AlertTitle>{`${microcopy.a11y.aiSuggestion}: ${microcopy.ai.pickSubtasks}`}</AlertTitle>
                                <AlertDescription>
                                    {microcopy.ai.breakdownAxisInfo.replace(
                                        "{label}",
                                        microcopy.ai.breakdownAxes[
                                            breakdownAxis
                                        ].label
                                    )}
                                </AlertDescription>
                            </Alert>
                            {breakdownItems.map((item, index) => {
                                const column = columns.find(
                                    (col) => col._id === item.columnId
                                );
                                const owner = members.find(
                                    (member) =>
                                        member._id === item.coordinatorId
                                );
                                return (
                                    <div
                                        className="mb-xs flex flex-wrap items-center gap-xs"
                                        key={`${item.taskName}-${index}`}
                                    >
                                        <Checkbox
                                            aria-label={microcopy.a11y.includeSubtask.replace(
                                                "{name}",
                                                item.taskName
                                            )}
                                            checked={breakdownChecked[index]}
                                            onCheckedChange={(checked) => {
                                                const next = [
                                                    ...breakdownChecked
                                                ];
                                                next[index] = checked === true;
                                                setBreakdownChecked(next);
                                            }}
                                        />
                                        <span className="min-w-0 flex-[1_1_12rem] [overflow-wrap:anywhere]">
                                            {item.taskName}
                                        </span>
                                        {column && (
                                            <Badge variant="secondary">
                                                {column.columnName}
                                            </Badge>
                                        )}
                                        {owner && (
                                            <Badge variant="secondary">
                                                {owner.username}
                                            </Badge>
                                        )}
                                        <Badge variant="secondary">
                                            {microcopy.brief.ptsCount.replace(
                                                "{count}",
                                                String(item.storyPoints)
                                            )}
                                        </Badge>
                                        <Badge
                                            variant={
                                                item.type === "Bug"
                                                    ? "destructive"
                                                    : "info"
                                            }
                                        >
                                            {item.type === "Bug"
                                                ? microcopy.options.taskTypes
                                                      .bug
                                                : microcopy.options.taskTypes
                                                      .task}
                                        </Badge>
                                    </div>
                                );
                            })}
                            <div className="mt-sm flex flex-wrap justify-end gap-xs">
                                <Button onClick={requestClose}>
                                    {microcopy.actions.cancel}
                                </Button>
                                <Button
                                    disabled={breakdownChecked.every(
                                        (value) => !value
                                    )}
                                    loading={creating}
                                    onClick={onSubmitBreakdown}
                                    variant="primary"
                                >
                                    {microcopy.counts.createNSubtasks.replace(
                                        "{count}",
                                        String(
                                            breakdownChecked.filter(Boolean)
                                                .length
                                        )
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </TooltipProvider>
            </ResponsiveFormSheet>
        </>
    );
};

export default AiTaskDraftModal;
