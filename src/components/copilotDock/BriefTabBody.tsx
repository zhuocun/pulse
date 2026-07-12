import { AlertCircle, AlertTriangle, Copy, Info, RotateCw } from "lucide-react";
import {
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Paragraph, Text, Title } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    BRIEF_AUTO_REFRESH_MIN_INTERVAL_MS,
    BRIEF_CACHE_TTL_MS
} from "../../theme/aiTokens";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { extractSuggestionRunId } from "../../utils/ai/extractSuggestionRunId";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useAppMessage from "@/components/ui/toast";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import AiWhyPopover from "../aiWhyPopover";
import CitationChip from "../citationChip";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import { AiCopilotSurfaceFeedback } from "../aiFeedbackPopover";

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type LiProps = React.LiHTMLAttributes<HTMLLIElement>;

/**
 * Brief list rows are activatable (open the underlying task in the modal).
 * They render as `<li role="button">` so styling lives here — a global
 * :focus-visible would land on the inner content. Rows carry a hairline
 * divider between them, mirroring the previous list split.
 */
const ActivatableListItem = forwardRef<HTMLLIElement, LiProps>(
    ({ className, ...props }, ref) => (
        <li
            ref={ref}
            className={cn(
                "flex cursor-pointer flex-col gap-xxs rounded-sm px-xs py-xs transition-colors",
                "border-b border-border last:border-b-0",
                "hover:bg-muted/60",
                "focus-visible:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                className
            )}
            {...props}
        />
    )
);
ActivatableListItem.displayName = "ActivatableListItem";

const WorkloadRow = forwardRef<HTMLLIElement, LiProps>(
    ({ className, ...props }, ref) => (
        <li
            ref={ref}
            className={cn(
                "flex flex-col items-stretch gap-xxs border-b border-border py-xs last:border-b-0",
                className
            )}
            {...props}
        />
    )
);
WorkloadRow.displayName = "WorkloadRow";

/** Plain unordered wrapper matching the previous list container. */
const BriefList = forwardRef<
    HTMLUListElement,
    React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
    <ul
        ref={ref}
        className={cn("m-0 flex list-none flex-col p-0", className)}
        {...props}
    />
));
BriefList.displayName = "BriefList";

/**
 * Top line of a workload row: the contributor name (semibold, primary
 * read) sits opposite its open-count / points tags so the username and the
 * metrics no longer collapse into one undifferentiated line.
 */
const WorkloadHead: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "flex flex-wrap items-center justify-between gap-xs",
            className
        )}
        {...props}
    />
);

const WorkloadName: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({
    className,
    ...props
}) => (
    <span
        className={cn(
            "min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]",
            className
        )}
        {...props}
    />
);

const WorkloadBarWrap: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "h-1.5 w-full overflow-hidden rounded-pill bg-muted",
            className
        )}
        {...props}
    />
);

const WorkloadBar: React.FC<DivProps & { overloaded: boolean }> = ({
    className,
    overloaded,
    ...props
}) => (
    <div
        className={cn(
            "h-full w-full origin-left transition-transform motion-reduce:transition-none",
            overloaded ? "bg-warning" : "bg-primary",
            className
        )}
        {...props}
    />
);

/**
 * Compact stat-tile grid for the "At a glance" summary card. Auto-fits as
 * many tiles per row as fit at a 96px min, so the four stats wrap cleanly
 * on the narrow drawer / dock surface without magic breakpoints.
 */
const SummaryGrid: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "grid gap-sm [grid-template-columns:repeat(auto-fit,minmax(96px,1fr))]",
            className
        )}
        {...props}
    />
);

const SummaryTile: React.FC<DivProps> = ({ className, ...props }) => (
    <div className={cn("flex flex-col gap-xxs", className)} {...props} />
);

const SummaryValue: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({
    className,
    ...props
}) => (
    <span
        className={cn("text-xl font-semibold leading-tight", className)}
        {...props}
    />
);

/**
 * Per-column count visualization. A lightweight token-colored bar sized by
 * proportion of the busiest column — NOT a charting dependency.
 */
const CountRow: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "grid items-center gap-sm py-xxs [grid-template-columns:minmax(0,1fr)_minmax(0,2fr)_auto]",
            className
        )}
        {...props}
    />
);

const CountBarTrack: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "h-2 w-full overflow-hidden rounded-pill bg-muted",
            className
        )}
        {...props}
    />
);

const CountBarFill: React.FC<DivProps> = ({ className, ...props }) => (
    <div
        className={cn(
            "h-full w-full origin-left rounded-pill bg-primary transition-transform motion-reduce:transition-none",
            className
        )}
        {...props}
    />
);

export interface BriefTabBodyProps {
    /**
     * Whether the host surface (legacy drawer or copilot dock) is open.
     * Drives the actual close-side teardown (abort in-flight brief, reset
     * local AI state). NOT mount/unmount — the body remains mounted across
     * dock-internal tab switches so the rendered brief survives (R1-H2).
     */
    dockOpen: boolean;
    /**
     * Whether this body is the *active surface* the user is looking at.
     * Drives the analytics "brief open" event, the relative-timestamp
     * interval, and the initial brief request kickoff. Defaults to
     * `dockOpen` so the legacy drawer wrapper (single surface) keeps the
     * original behavior.
     */
    tabActive?: boolean;
    project?: IProject;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
}

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({
    children
}) => (
    <Title className="mb-xs mt-md text-base" level={4}>
        {children}
    </Title>
);

interface ClickableListItemProps {
    onActivate: () => void;
    children: React.ReactNode;
}

const ClickableListItem: React.FC<ClickableListItemProps> = ({
    onActivate,
    children
}) => {
    const handleKey = (event: React.KeyboardEvent<HTMLLIElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onActivate();
        }
    };
    return (
        <ActivatableListItem
            onClick={onActivate}
            onKeyDown={handleKey}
            role="button"
            tabIndex={0}
        >
            {children}
        </ActivatableListItem>
    );
};

interface CachedBrief {
    data: IBoardBrief;
    generatedAt: number;
    /** Fingerprint of board state used to invalidate stale caches. */
    fingerprint: string;
}

const BRIEF_CACHE = new Map<string, CachedBrief>();

export const resetBriefCacheForTests = (): void => {
    BRIEF_CACHE.clear();
};

const fingerprintBoard = (
    columns: IColumn[],
    tasks: ITask[],
    members: IMember[]
): string => {
    const columnFingerprint = [...columns]
        .sort((a, b) => a.index - b.index || a._id.localeCompare(b._id))
        .map((column) => `${column._id}:${column.index}:${column.columnName}`)
        .join("|");
    const taskFingerprint = [...tasks]
        .sort((a, b) => a.index - b.index || a._id.localeCompare(b._id))
        .map(
            (task) =>
                `${task._id}:${task.index}:${task.columnId}:${task.coordinatorId}:${task.storyPoints}:${task.taskName}`
        )
        .join("|");
    const memberFingerprint = [...members]
        .sort((a, b) => a._id.localeCompare(b._id))
        .map((member) => `${member._id}:${member.username}`)
        .join("|");

    return [columnFingerprint, taskFingerprint, memberFingerprint].join("/");
};

/*
 * Localized relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util, reading the copy from
 * `microcopy.brief.relative*` directly (these keys resolve to string
 * leaves through the locale-aware Proxy, so no `microcopyString`
 * coercion is needed — preserving this surface's original reads exactly).
 * The Proxy reads stay at this call site so a locale switch propagates.
 */
const formatRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopy.brief.relativeJustNow,
        oneMinute: microcopy.brief.relativeOneMinute,
        minutes: microcopy.brief.relativeMinutes,
        oneHour: microcopy.brief.relativeOneHour,
        hours: microcopy.brief.relativeHours,
        oneDay: microcopy.brief.relativeOneDay,
        days: microcopy.brief.relativeDays
    });

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

const STRENGTH_VARIANT: Record<
    NonNullable<IBoardBrief["recommendationDetail"]>["strength"],
    "destructive" | "warning" | "info" | "secondary"
> = {
    strong: "destructive",
    moderate: "warning",
    low: "info",
    none: "secondary"
};

interface BriefRecommendationTitleProps {
    detail?: IBoardBrief["recommendationDetail"];
}

const BriefRecommendationTitle: React.FC<BriefRecommendationTitleProps> = ({
    detail
}) => (
    <span
        style={{
            alignItems: "center",
            display: "inline-flex",
            flexWrap: "wrap",
            gap: 6,
            minWidth: 0
        }}
    >
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {`${microcopy.a11y.aiSuggestion}: ${microcopy.brief.recommendedNextStep}`}
        </span>
        {detail && (
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge variant={STRENGTH_VARIANT[detail.strength]}>
                        {microcopy.brief.strengthLabels[detail.strength]}
                    </Badge>
                </TooltipTrigger>
                <TooltipContent>
                    {microcopy.brief.strengthTooltips[detail.strength]}
                </TooltipContent>
            </Tooltip>
        )}
        {detail?.basis ? (
            <AiWhyPopover
                ariaContext={String(microcopy.brief.recommendedNextStep)}
                rationale={detail.basis}
            />
        ) : null}
    </span>
);

interface BriefRecommendationBodyProps {
    detail?: IBoardBrief["recommendationDetail"];
    fallbackText: string;
    onOpenTask: (taskId: string) => void;
}

const BriefRecommendationBody: React.FC<BriefRecommendationBodyProps> = ({
    detail,
    fallbackText,
    onOpenTask
}) => {
    const text = detail?.text ?? fallbackText;
    return (
        <div>
            <Paragraph className="mb-[4px] [overflow-wrap:anywhere]">
                {text}
            </Paragraph>
            {detail && detail.sources.length > 0 && (
                <div className="flex flex-wrap gap-[4px]">
                    {detail.sources.map((source) => (
                        <Badge
                            className="max-w-full cursor-pointer overflow-hidden text-ellipsis"
                            key={source.taskId}
                            onClick={() => onOpenTask(source.taskId)}
                            onKeyDown={(event) => {
                                if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                ) {
                                    event.preventDefault();
                                    onOpenTask(source.taskId);
                                }
                            }}
                            role="button"
                            tabIndex={0}
                            variant="secondary"
                        >
                            {source.taskName}
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
};

const briefToMarkdown = (brief: IBoardBrief): string => {
    const lines: string[] = [];
    lines.push(`# ${brief.headline}`, "");
    if (brief.recommendation) {
        lines.push(`> ${brief.recommendation}`, "");
        if (brief.recommendationDetail?.basis) {
            lines.push(
                microcopy.brief.basisItalic.replace(
                    "{text}",
                    brief.recommendationDetail.basis
                ),
                ""
            );
        }
    }
    lines.push(`## ${microcopy.brief.markdownCountsHeading}`, "");
    for (const entry of brief.counts) {
        lines.push(`- **${entry.columnName}** — ${entry.count}`);
    }
    if (brief.largestUnstarted.length > 0) {
        lines.push("", `## ${microcopy.brief.markdownLargestHeading}`, "");
        for (const t of brief.largestUnstarted) {
            const ptsSuffix =
                t.storyPoints !== undefined
                    ? ` (${microcopy.brief.markdownStoryPoints.replace(
                          "{count}",
                          String(t.storyPoints)
                      )})`
                    : "";
            lines.push(`- ${t.taskName}${ptsSuffix}`);
        }
    }
    if (brief.unowned.length > 0) {
        lines.push("", `## ${microcopy.brief.markdownUnownedHeading}`, "");
        for (const t of brief.unowned) {
            lines.push(`- ${t.taskName}`);
        }
    }
    if (brief.workload.length > 0) {
        lines.push("", `## ${microcopy.brief.markdownWorkloadHeading}`, "");
        for (const w of brief.workload) {
            lines.push(
                `- **${w.username}** — ${microcopy.brief.markdownWorkloadEntry
                    .replace("{count}", String(w.openTasks))
                    .replace("{points}", String(w.openPoints))}`
            );
        }
    }
    return lines.join("\n");
};

const BriefTabBody: React.FC<BriefTabBodyProps> = ({
    dockOpen,
    tabActive,
    project,
    columns,
    tasks,
    members
}) => {
    // Toasts route through the sonner-backed `message` seam, which
    // no-ops until a `<Toaster>` is mounted (test-safe by default).
    const message = useAppMessage();
    // `tabActive` defaults to `dockOpen` so a legacy single-surface caller
    // (drawer wrapper) inherits the original semantics. Inside this body:
    //   - `dockOpen`        gates close-side teardown only.
    //   - `surfaceVisible`  gates analytics + intervals + initial request.
    const surfaceVisible = dockOpen && (tabActive ?? true);
    const { startEditing } = useTaskModal();
    const { openTask } = useTaskPanelNavigation();
    const projectId = project?._id ?? "";

    // Mount BOTH hooks unconditionally (React hook ordering rule).
    // Only one drives the UI based on environment.aiUseLocalEngine.
    const localAi = useAi<IBoardBrief>({ route: "board-brief" });
    const remoteAgent = useAgent("board-brief-agent", { projectId });
    const startRemoteBrief = remoteAgent.start;
    const abortRemoteBrief = remoteAgent.abort;
    const clearRemoteBriefSuggestion = remoteAgent.clearSuggestion;
    const remoteBriefSuggestion = remoteAgent.lastSuggestion;
    const remoteBriefError = remoteAgent.error;
    const remoteBriefIsStreaming = remoteAgent.isStreaming;
    const remoteBriefThreadId = remoteAgent.threadId;

    const isRemote = !environment.aiUseLocalEngine;
    const remoteAiConsentGranted = useRemoteAiConsent(environment.aiBaseUrl);

    const {
        run,
        data: localData,
        error: localError,
        isLoading,
        reset: localReset
    } = localAi;

    const agentBriefData = useMemo((): IBoardBrief | undefined => {
        const suggestion = remoteBriefSuggestion;
        if (!suggestion || suggestion.surface !== "brief") return undefined;
        const raw = suggestion.payload as IBoardBrief;
        return {
            ...raw,
            counts: raw.counts ?? [],
            largestUnstarted: raw.largestUnstarted ?? [],
            unowned: raw.unowned ?? [],
            workload: raw.workload ?? []
        };
    }, [remoteBriefSuggestion]);

    const data = isRemote ? agentBriefData : localData;
    const error = isRemote ? remoteBriefError : localError;
    const activeIsLoading = isRemote ? remoteBriefIsStreaming : isLoading;

    const fingerprint = fingerprintBoard(columns, tasks, members);
    const cacheKey = projectId;
    const [cachedAt, setCachedAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const lastFingerprintRef = useRef<string>("");
    // R-A M3 — min-interval gate state for the fingerprint-driven refetch.
    // `lastAutoRefreshAtRef` is the wall-clock ms of the last refetch we
    // actually fired; `pendingTrailingTimerRef` is the trailing-edge
    // setTimeout handle scheduled when a fingerprint change arrives mid
    // gate (so the final-state refetch still lands after the window
    // clears). Manual refreshes update `lastAutoRefreshAtRef` too so a
    // user-driven refresh resets the gate window — no point burning a
    // second auto-refetch 100ms later.
    const lastAutoRefreshAtRef = useRef<number>(0);
    const pendingTrailingTimerRef = useRef<number | null>(null);
    // Always-current fingerprint snapshot for the trailing-edge timer
    // (R-A M3 follow-up). The setTimeout callback otherwise closes over
    // the fingerprint at SCHEDULE time, which goes stale if the user
    // undoes a mid-gate change (B → C → B). When the trailing fires we
    // re-read from this ref so the refetch reflects the LATEST state,
    // and skip the refetch entirely when nothing actually changed.
    const currentFingerprintRef = useRef<string>(fingerprint);
    useEffect(() => {
        currentFingerprintRef.current = fingerprint;
    }, [fingerprint]);

    const runBrief = useCallback(
        async (options: { bypassCache?: boolean } = {}) => {
            if (!project) return;
            const cached = BRIEF_CACHE.get(cacheKey);
            const fresh =
                cached &&
                Date.now() - cached.generatedAt < BRIEF_CACHE_TTL_MS &&
                cached.fingerprint === fingerprint;
            if (fresh && !options.bypassCache) {
                setCachedAt(cached.generatedAt);
                return;
            }
            try {
                const result = await run({
                    brief: {
                        context: {
                            project: {
                                _id: project._id,
                                projectName: project.projectName
                            },
                            columns,
                            tasks,
                            members
                        }
                    }
                });
                if (result) {
                    const generatedAt = Date.now();
                    BRIEF_CACHE.set(cacheKey, {
                        data: result,
                        generatedAt,
                        fingerprint
                    });
                    setCachedAt(generatedAt);
                }
            } catch {
                /* surfaced via error state */
            }
        },
        [project, cacheKey, fingerprint, run, columns, tasks, members]
    );

    useEffect(() => {
        if (!isRemote) return;
        if (!remoteAiConsentGranted) return;
        // Kick the remote brief request only when the user is actually
        // looking at the Brief surface. Tearing it down is wired to
        // `dockOpen` below so a Chat ↔ Brief tab switch doesn't abort the
        // in-flight stream (R1-H2). Skip the start call when a stream is
        // already running OR a suggestion has already rendered — coming
        // back to the tab must NOT abort the in-flight stream and restart
        // it (R-A H1). The fingerprint-change refetch path handles the
        // "board moved underneath you" case below.
        if (surfaceVisible && projectId) {
            if (!remoteBriefIsStreaming && !remoteBriefSuggestion) {
                void startRemoteBrief(microcopy.ai.generateBoardBriefPrompt, {
                    autonomy: "suggest"
                });
            }
        } else if (!dockOpen) {
            abortRemoteBrief();
            clearRemoteBriefSuggestion();
        }
    }, [
        surfaceVisible,
        dockOpen,
        isRemote,
        remoteAiConsentGranted,
        projectId,
        remoteBriefIsStreaming,
        remoteBriefSuggestion,
        startRemoteBrief,
        abortRemoteBrief,
        clearRemoteBriefSuggestion
    ]);

    useEffect(() => {
        // Surface-visible gates the analytics event + fingerprint-driven
        // refresh: the user has to be looking at the Brief tab for either
        // to count. On tab switch to Chat (surfaceVisible flips false,
        // dockOpen stays true), keep the fingerprint ref so we don't
        // double-fire the "open" event when the user comes back to Brief
        // with no underlying change.
        if (!surfaceVisible) {
            if (!dockOpen) {
                lastFingerprintRef.current = "";
            }
            // Cancel any in-flight trailing-refetch timer when we move
            // off the brief surface — we never want a delayed refetch
            // firing while the user is on Chat or the dock is closed.
            // When they return, the effect re-runs and re-evaluates the
            // gate against the current fingerprint.
            if (pendingTrailingTimerRef.current !== null) {
                window.clearTimeout(pendingTrailingTimerRef.current);
                pendingTrailingTimerRef.current = null;
            }
            return;
        }
        if (isRemote && !remoteAiConsentGranted) return;
        const prevFingerprint = lastFingerprintRef.current;
        const fingerprintChanged =
            prevFingerprint !== "" && prevFingerprint !== fingerprint;
        const isFirstOpen = prevFingerprint === "";
        // COPILOT_BRIEF_OPEN models a true open transition only. A
        // mid-session board mutation that triggers a refetch is a
        // separate signal (R-A H2) so the open-rate metric stays clean.
        // First-open never goes through the gate — the user opened the
        // brief to look at it, they should see data immediately.
        if (isFirstOpen) {
            track(ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN);
            lastFingerprintRef.current = fingerprint;
            // First-open does NOT consume the gate slot. The next
            // fingerprint-driven refetch should still fire immediately
            // (so the user sees an instant board-change refresh after
            // their first edit). The gate kicks in once the auto path
            // has actually fired — see `fireFingerprintRefetch` below.
            if (!isRemote) {
                void runBrief();
            }
            // Remote first-open is handled by the sibling effect above
            // (gated on !isStreaming && !lastSuggestion) — don't double
            // up the start call here.
            return;
        }

        // R-A M3 — performs the actual refetch + analytics for a
        // fingerprint-driven refresh. Defined inline so it captures the
        // current effect-scope closures (runBrief, etc.) and can be
        // deferred via setTimeout for the trailing-edge path. The
        // fingerprint is passed in by the caller so the trailing path
        // can read it at FIRE time (from `currentFingerprintRef`) rather
        // than at SCHEDULE time — closure-captured fingerprints go stale
        // if the user undoes a mid-gate change.
        const fireFingerprintRefetch = (fpAtFire: string) => {
            track(ANALYTICS_EVENTS.BRIEF_REFRESHED_BY_BOARD_CHANGE);
            lastFingerprintRef.current = fpAtFire;
            lastAutoRefreshAtRef.current = Date.now();
            if (!isRemote) {
                void runBrief();
            } else {
                abortRemoteBrief();
                clearRemoteBriefSuggestion();
                void startRemoteBrief(microcopy.ai.generateBoardBriefPrompt, {
                    autonomy: "suggest"
                });
            }
        };

        if (fingerprintChanged) {
            // Clear any prior trailing timer so we don't fire twice when
            // a fresh change arrives — we always replace with the latest
            // fingerprint's wait.
            if (pendingTrailingTimerRef.current !== null) {
                window.clearTimeout(pendingTrailingTimerRef.current);
                pendingTrailingTimerRef.current = null;
            }
            const elapsed = Date.now() - lastAutoRefreshAtRef.current;
            if (elapsed >= BRIEF_AUTO_REFRESH_MIN_INTERVAL_MS) {
                // Gate clear: refetch right away with the current
                // effect-scope fingerprint (which is the latest by
                // definition — the effect just re-ran for it).
                fireFingerprintRefetch(fingerprint);
            } else {
                // Gate active: schedule a trailing-edge refetch for the
                // remainder of the window. If the user keeps editing the
                // board, each successive effect run replaces this timer
                // with one keyed to the latest fingerprint — so at most
                // one refetch lands when the dust settles. The callback
                // re-reads the fingerprint at FIRE time so an undo
                // landed in-between (B → C → B) becomes a no-op instead
                // of corrupting `lastFingerprintRef` with the stale C.
                const remaining = BRIEF_AUTO_REFRESH_MIN_INTERVAL_MS - elapsed;
                pendingTrailingTimerRef.current = window.setTimeout(() => {
                    pendingTrailingTimerRef.current = null;
                    const fpAtFire = currentFingerprintRef.current;
                    if (fpAtFire === lastFingerprintRef.current) return;
                    fireFingerprintRefetch(fpAtFire);
                }, remaining);
            }
        } else if (!isRemote) {
            // No fingerprint change but the local engine's effect ran
            // (e.g. surfaceVisible just flipped true). Preserve the
            // pre-M3 behavior of letting `runBrief` decide via its
            // internal cache-freshness check — no analytics, no gate.
            void runBrief();
        }
    }, [
        surfaceVisible,
        dockOpen,
        fingerprint,
        runBrief,
        isRemote,
        remoteAiConsentGranted,
        abortRemoteBrief,
        clearRemoteBriefSuggestion,
        startRemoteBrief
    ]);

    useEffect(() => {
        // R-A M3 — global teardown so a trailing-refetch timer can't
        // fire after the component unmounts (would leak the start call
        // into a torn-down agent hook). The effect above clears the
        // timer on surfaceVisible flips; this covers the unmount case.
        return () => {
            if (pendingTrailingTimerRef.current !== null) {
                window.clearTimeout(pendingTrailingTimerRef.current);
                pendingTrailingTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        // Reset the local AI state only when the dock actually closes —
        // a tab switch must leave the rendered brief intact (R1-H2).
        if (!dockOpen) {
            localReset();
        }
    }, [dockOpen, localReset]);

    useEffect(() => {
        // The "generated X ago" interval only ticks while the user is
        // looking at the Brief tab; no point burning a setInterval when
        // they're typing in Chat. Switching back re-establishes it.
        if (!surfaceVisible) return;
        const handle = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(handle);
    }, [surfaceVisible]);

    const cached = cacheKey ? BRIEF_CACHE.get(cacheKey) : undefined;
    const briefData: IBoardBrief | undefined = data ?? cached?.data;
    const generatedAt = cachedAt ?? cached?.generatedAt ?? null;
    const showBriefLoadingSkeleton = useDelayedFlag(
        activeIsLoading && !briefData,
        250
    );
    const errorView = aiErrorView(
        error,
        microcopy.feedback.couldntGenerateBrief
    );
    const briefStatusAnnouncement = useMemo(() => {
        // Announcements only fire while the user is actually looking at
        // the brief surface; on tab switch we don't want a queued status
        // message firing to screen readers about a tab they can't see.
        if (!surfaceVisible) return "";
        if (error && !briefData) return microcopy.ai.briefStatusError;
        if (briefData) return microcopy.ai.briefStatusReady;
        if (activeIsLoading) return microcopy.ai.briefStatusLoading;
        return "";
    }, [surfaceVisible, error, briefData, activeIsLoading]);

    const headline = useMemo(() => {
        if (!briefData) return "";
        const totalTasks = tasks.length;
        const overloaded = briefData.workload.find((w) => w.openTasks >= 5);
        if (overloaded) {
            return microcopy.brief.overloaded
                .replace("{name}", overloaded.username)
                .replace("{count}", String(overloaded.openTasks));
        }
        if (briefData.unowned.length >= 3) {
            return microcopy.brief.unownedHeadline.replace(
                "{count}",
                String(briefData.unowned.length)
            );
        }
        if (briefData.largestUnstarted.length >= 5) {
            return microcopy.brief.unstartedWaiting.replace(
                "{count}",
                String(briefData.largestUnstarted.length)
            );
        }
        if (totalTasks === 0) {
            return microcopy.brief.boardEmpty;
        }
        return briefData.headline;
    }, [briefData, tasks.length]);

    const openTaskFromBrief = (taskId: string) => {
        // Route through the panel when `taskPanelRouted` is on; otherwise
        // fall back to the legacy modal via `useTaskModal` (Phase 3 A2).
        if (environment.taskPanelRouted) openTask(taskId, projectId);
        else startEditing(taskId);
    };

    const handleCopyMarkdown = async () => {
        if (!briefData) return;
        try {
            await navigator.clipboard.writeText(briefToMarkdown(briefData));
            message.success(microcopy.ai.copiedConfirm);
        } catch {
            message.error(microcopy.feedback.couldntCopy);
        }
    };

    const handleRefresh = async () => {
        if (isRemote && !remoteAiConsentGranted) return;
        track(ANALYTICS_EVENTS.BRIEF_REFRESHED, { projectId });
        // R-A M3 — a user-initiated refresh resets the auto-refresh
        // gate baseline. Without this, an auto-trailing refetch could
        // land seconds after the manual one and burn the same call
        // twice. Also drop any pending trailing timer for the same
        // reason — the user just got fresh data.
        lastAutoRefreshAtRef.current = Date.now();
        if (pendingTrailingTimerRef.current !== null) {
            window.clearTimeout(pendingTrailingTimerRef.current);
            pendingTrailingTimerRef.current = null;
        }
        if (isRemote) {
            clearRemoteBriefSuggestion();
            await startRemoteBrief(microcopy.ai.generateBoardBriefPrompt, {
                autonomy: "suggest"
            });
        } else {
            await runBrief({ bypassCache: true });
        }
    };

    const teamAverage = useMemo(() => {
        if (!briefData || briefData.workload.length === 0) return 0;
        const sum = briefData.workload.reduce((acc, w) => acc + w.openTasks, 0);
        return sum / briefData.workload.length;
    }, [briefData]);

    // At-a-glance summary stats, all derived from the brief payload (no new
    // data fetched). Feeds the top summary card + the per-column bar scaling.
    const summary = useMemo(() => {
        if (!briefData) {
            return { totalTasks: 0, columns: 0, unowned: 0, contributors: 0 };
        }
        return {
            totalTasks: briefData.counts.reduce(
                (acc, entry) => acc + entry.count,
                0
            ),
            columns: briefData.counts.length,
            unowned: briefData.unowned.length,
            contributors: briefData.workload.length
        };
    }, [briefData]);

    const maxColumnCount = useMemo(() => {
        if (!briefData || briefData.counts.length === 0) return 0;
        return briefData.counts.reduce(
            (max, entry) => Math.max(max, entry.count),
            0
        );
    }, [briefData]);

    const boardBriefRecommendationKey = useMemo(() => {
        if (!briefData?.recommendation) return "";
        const embedded = extractSuggestionRunId(remoteBriefSuggestion?.payload);
        if (embedded) return embedded;
        const baseline = `${briefData.headline}:${briefData.recommendation}:${briefData.recommendationDetail?.text ?? ""}`;
        const runScoped = isRemote
            ? remoteBriefThreadId
            : `${projectId}:${generatedAt ?? 0}`;
        return `${runScoped}:${baseline}`;
    }, [
        briefData,
        generatedAt,
        isRemote,
        projectId,
        remoteBriefSuggestion,
        remoteBriefThreadId
    ]);

    const recommendationFeedbackVisible = Boolean(
        briefData?.recommendation &&
        boardBriefRecommendationKey.length > 0 &&
        !showBriefLoadingSkeleton
    );

    return (
        <TooltipProvider>
            <div className="mb-xs flex justify-end gap-xs">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            aria-label={microcopy.ai.regenerateLabel}
                            disabled={activeIsLoading}
                            onClick={handleRefresh}
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
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            aria-label={microcopy.a11y.copyBriefAsMarkdown}
                            disabled={!briefData || activeIsLoading}
                            onClick={handleCopyMarkdown}
                            size="icon"
                            variant="ghost"
                        >
                            <Copy aria-hidden />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {microcopy.actions.copyAsMarkdown}
                    </TooltipContent>
                </Tooltip>
                <CopilotPrivacyPopover
                    label={
                        <span aria-label={microcopy.ai.privacyLink}>
                            <Info aria-hidden />
                        </span>
                    }
                    route="board-brief"
                />
            </div>
            <CopilotRemoteConsentNotice route="board-brief" />
            <SrOnlyLive>{briefStatusAnnouncement}</SrOnlyLive>
            {showBriefLoadingSkeleton && (
                <div
                    aria-label={microcopy.a11y.generatingBrief}
                    aria-busy="true"
                >
                    <div className="flex flex-col gap-xs">
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                    </div>
                    <div className="mt-lg flex flex-col gap-xs">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-4 w-3/5" />
                    </div>
                </div>
            )}
            {error && !briefData && (
                <Alert variant={severityVariant(errorView.severity)}>
                    <SeverityIcon severity={errorView.severity} />
                    <AlertTitle>{errorView.heading}</AlertTitle>
                    {errorView.body ? (
                        <AlertDescription>{errorView.body}</AlertDescription>
                    ) : null}
                    {errorView.retryable ? (
                        <AlertDescription>
                            <Button
                                className="h-auto p-0"
                                onClick={handleRefresh}
                                size="sm"
                                variant="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        </AlertDescription>
                    ) : null}
                </Alert>
            )}
            {briefData && (
                <div
                    aria-label={microcopy.a11y.boardBriefContent}
                    aria-live="polite"
                >
                    <Title className="mt-0" level={3}>
                        {headline}
                    </Title>
                    <Card className="mb-md">
                        <CardHeader className="p-md pb-xxs">
                            <CardTitle>
                                {microcopy.brief.summaryTitle}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-md pt-xs">
                            <SummaryGrid>
                                <SummaryTile>
                                    <SummaryValue>
                                        {summary.totalTasks}
                                    </SummaryValue>
                                    <Text type="secondary">
                                        {microcopy.brief.summaryTotalTasks}
                                    </Text>
                                </SummaryTile>
                                <SummaryTile>
                                    <SummaryValue>
                                        {summary.columns}
                                    </SummaryValue>
                                    <Text type="secondary">
                                        {microcopy.brief.summaryColumns}
                                    </Text>
                                </SummaryTile>
                                <SummaryTile>
                                    <SummaryValue>
                                        {summary.unowned}
                                    </SummaryValue>
                                    <Text type="secondary">
                                        {microcopy.brief.summaryUnowned}
                                    </Text>
                                </SummaryTile>
                                <SummaryTile>
                                    <SummaryValue>
                                        {summary.contributors}
                                    </SummaryValue>
                                    <Text type="secondary">
                                        {microcopy.brief.summaryContributors}
                                    </Text>
                                </SummaryTile>
                            </SummaryGrid>
                        </CardContent>
                    </Card>
                    {briefData.recommendation && (
                        <Alert
                            className="mb-md"
                            variant={
                                briefData.recommendationDetail?.strength ===
                                "none"
                                    ? "info"
                                    : "warning"
                            }
                        >
                            {briefData.recommendationDetail?.strength ===
                            "none" ? (
                                <Info aria-hidden />
                            ) : (
                                <AlertTriangle aria-hidden />
                            )}
                            <AlertTitle>
                                <BriefRecommendationTitle
                                    detail={briefData.recommendationDetail}
                                />
                            </AlertTitle>
                            <AlertDescription>
                                <BriefRecommendationBody
                                    detail={briefData.recommendationDetail}
                                    fallbackText={briefData.recommendation}
                                    onOpenTask={openTaskFromBrief}
                                />
                            </AlertDescription>
                            {recommendationFeedbackVisible &&
                            !activeIsLoading ? (
                                <AlertDescription className="mt-xs">
                                    <AiCopilotSurfaceFeedback
                                        ariaGroupLabel={(
                                            microcopy.feedback
                                                .boardBriefTitle as string
                                        ).replace(
                                            "{section}",
                                            String(
                                                microcopy.brief
                                                    .recommendedNextStep
                                            )
                                        )}
                                        citationCount={
                                            remoteAgent.citations.length
                                        }
                                        suggestionKey={
                                            boardBriefRecommendationKey
                                        }
                                        surface="board-brief"
                                    />
                                </AlertDescription>
                            ) : null}
                        </Alert>
                    )}
                    <SectionHeading>
                        {microcopy.brief.countsPerColumn}
                    </SectionHeading>
                    <div className="mb-md">
                        {briefData.counts.map((entry) => {
                            const ratio =
                                maxColumnCount > 0
                                    ? entry.count / maxColumnCount
                                    : 0;
                            return (
                                <CountRow
                                    aria-label={microcopy.brief.countsBarAria
                                        .replace("{column}", entry.columnName)
                                        .replace(
                                            "{count}",
                                            String(entry.count)
                                        )}
                                    key={entry.columnId}
                                    role="group"
                                >
                                    <Text className="min-w-0 truncate">
                                        {entry.columnName}
                                    </Text>
                                    <CountBarTrack aria-hidden>
                                        <CountBarFill
                                            style={{
                                                transform: `scaleX(${ratio})`
                                            }}
                                        />
                                    </CountBarTrack>
                                    <Text className="tabular-nums" strong>
                                        {entry.count}
                                    </Text>
                                </CountRow>
                            );
                        })}
                    </div>
                    <Separator className="my-md" />

                    <SectionHeading>
                        {microcopy.brief.largestUnstarted}
                    </SectionHeading>
                    {briefData.largestUnstarted.length === 0 ? (
                        <Text type="secondary">
                            {microcopy.brief.noUnstarted}
                        </Text>
                    ) : (
                        <BriefList className="mb-md">
                            {briefData.largestUnstarted.map((item) => (
                                <ClickableListItem
                                    key={item.taskId}
                                    onActivate={() =>
                                        openTaskFromBrief(item.taskId)
                                    }
                                >
                                    <span className="font-medium text-foreground">
                                        {item.taskName}
                                    </span>
                                    {item.storyPoints !== undefined ? (
                                        <span>
                                            <Badge variant="secondary">
                                                {microcopy.brief.ptsCount.replace(
                                                    "{count}",
                                                    String(item.storyPoints)
                                                )}
                                            </Badge>
                                        </span>
                                    ) : null}
                                </ClickableListItem>
                            ))}
                        </BriefList>
                    )}

                    <Separator className="my-md" />

                    <SectionHeading>
                        {microcopy.brief.unownedTasks}
                    </SectionHeading>
                    {briefData.unowned.length === 0 ? (
                        <Text type="secondary">{microcopy.brief.allOwned}</Text>
                    ) : (
                        <BriefList className="mb-md">
                            {briefData.unowned.map((item) => (
                                <ClickableListItem
                                    key={item.taskId}
                                    onActivate={() =>
                                        openTaskFromBrief(item.taskId)
                                    }
                                >
                                    {item.taskName}
                                </ClickableListItem>
                            ))}
                        </BriefList>
                    )}

                    <Separator className="my-md" />

                    <SectionHeading>{microcopy.brief.workload}</SectionHeading>
                    {briefData.workload.length === 0 ? (
                        <Text type="secondary">
                            {microcopy.brief.noActivePerMember}
                        </Text>
                    ) : (
                        <BriefList>
                            {briefData.workload.map((item) => {
                                const ratio =
                                    teamAverage > 0
                                        ? Math.min(
                                              1.5,
                                              item.openTasks / teamAverage
                                          )
                                        : 0;
                                const overloaded = ratio > 1.2;
                                return (
                                    <WorkloadRow key={item.username}>
                                        <WorkloadHead>
                                            <WorkloadName>
                                                {item.username}
                                            </WorkloadName>
                                            <span className="flex gap-xxs">
                                                <Badge variant="secondary">
                                                    {microcopy.brief.openCount.replace(
                                                        "{count}",
                                                        String(item.openTasks)
                                                    )}
                                                </Badge>
                                                <Badge variant="info">
                                                    {microcopy.brief.ptsCount.replace(
                                                        "{count}",
                                                        String(item.openPoints)
                                                    )}
                                                </Badge>
                                            </span>
                                        </WorkloadHead>
                                        <WorkloadBarWrap aria-hidden>
                                            <WorkloadBar
                                                overloaded={overloaded}
                                                style={{
                                                    transform: `scaleX(${Math.min(100, ratio * 80) / 100})`
                                                }}
                                            />
                                        </WorkloadBarWrap>
                                    </WorkloadRow>
                                );
                            })}
                        </BriefList>
                    )}
                    {generatedAt !== null && (
                        <Text className="mt-md block" type="secondary">
                            {microcopy.brief.generated.replace(
                                "{time}",
                                formatRelative(generatedAt, now)
                            )}
                        </Text>
                    )}
                    {isRemote && remoteAgent.citations.length > 0 && (
                        <div className="mt-sm flex flex-wrap gap-[4px]">
                            {remoteAgent.citations.map((c, i) => (
                                <CitationChip
                                    citation={c}
                                    index={i + 1}
                                    key={`${c.id}-${i}`}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </TooltipProvider>
    );
};

export default BriefTabBody;
