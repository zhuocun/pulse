import {
    CopyOutlined,
    InfoCircleOutlined,
    ReloadOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    Button,
    List,
    Skeleton,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    BRIEF_AUTO_REFRESH_MIN_INTERVAL_MS,
    BRIEF_CACHE_TTL_MS
} from "../../theme/aiTokens";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { extractSuggestionRunId } from "../../utils/ai/extractSuggestionRunId";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import AiWhyPopover from "../aiWhyPopover";
import CitationChip from "../citationChip";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";
import { AiCopilotSurfaceFeedback } from "../aiFeedbackPopover";

/**
 * Brief-drawer list rows are activatable (open the underlying task in
 * the modal). They render as `<li role="button">` so styling has to live
 * here — global :focus-visible would land on the inner content.
 */
const ActivatableListItem = styled(List.Item)`
    && {
        border-radius: ${radius.sm}px;
        cursor: pointer;
        transition: background-color 120ms ease-out;
    }

    &&:hover {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.04));
    }

    &&:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.04));
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: -2px;
    }
`;

const WorkloadRow = styled(List.Item)`
    && {
        flex-wrap: wrap;
        gap: ${space.xs}px;
    }
`;

const WorkloadName = styled.span`
    flex: 1 1 auto;
    font-weight: ${fontWeight.medium};
`;

const WorkloadBarWrap = styled.div`
    background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04));
    border-radius: 999px;
    height: 6px;
    margin-top: 4px;
    overflow: hidden;
    width: 100%;
`;

const WorkloadBar = styled.div<{ overloaded: boolean }>`
    background: ${(props) =>
        props.overloaded
            ? "var(--ant-color-warning, #F59E0B)"
            : "var(--color-copilot-grad-mid, #EA580C)"};
    height: 100%;
    transform-origin: left;
    transition: transform 320ms ease-out;
    width: 100%;
`;

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
    <Typography.Title
        level={4}
        style={{
            fontSize: fontSize.base,
            marginBottom: space.xs,
            marginTop: space.md
        }}
    >
        {children}
    </Typography.Title>
);

interface ClickableListItemProps {
    onActivate: () => void;
    children: React.ReactNode;
}

const ClickableListItem: React.FC<ClickableListItemProps> = ({
    onActivate,
    children
}) => {
    const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

const STRENGTH_COLOR: Record<
    NonNullable<IBoardBrief["recommendationDetail"]>["strength"],
    "red" | "orange" | "blue" | "default"
> = {
    strong: "red",
    moderate: "orange",
    low: "blue",
    none: "default"
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
            <Tooltip title={microcopy.brief.strengthTooltips[detail.strength]}>
                <Tag
                    color={STRENGTH_COLOR[detail.strength]}
                    style={{ marginInlineEnd: 0 }}
                >
                    {microcopy.brief.strengthLabels[detail.strength]}
                </Tag>
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
            <Typography.Paragraph
                style={{ marginBottom: 4, overflowWrap: "anywhere" }}
            >
                {text}
            </Typography.Paragraph>
            {detail && detail.sources.length > 0 && (
                <Space size={4} wrap>
                    {detail.sources.map((source) => (
                        <Tag
                            color="purple"
                            key={source.taskId}
                            onClick={() => onOpenTask(source.taskId)}
                            style={{
                                cursor: "pointer",
                                marginInlineEnd: 0,
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis"
                            }}
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                ) {
                                    event.preventDefault();
                                    onOpenTask(source.taskId);
                                }
                            }}
                        >
                            {source.taskName}
                        </Tag>
                    ))}
                </Space>
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
    // AntD v6: static `message` warns about dynamic theme;
    // `useAppMessage()` returns a theme-aware instance (with a static
    // fallback for tests that render without `<App>`).
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
        <>
            <Space
                size={space.xs}
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: space.xs
                }}
            >
                <Tooltip title={microcopy.ai.regenerateLabel}>
                    <Button
                        aria-label={microcopy.ai.regenerateLabel}
                        disabled={activeIsLoading}
                        icon={<ReloadOutlined />}
                        onClick={handleRefresh}
                        size="small"
                        type="text"
                    />
                </Tooltip>
                <Tooltip title={microcopy.actions.copyAsMarkdown}>
                    <Button
                        aria-label={microcopy.a11y.copyBriefAsMarkdown}
                        disabled={!briefData || activeIsLoading}
                        icon={<CopyOutlined />}
                        onClick={handleCopyMarkdown}
                        size="small"
                        type="text"
                    />
                </Tooltip>
                <CopilotPrivacyPopover
                    label={
                        <span aria-label={microcopy.ai.privacyLink}>
                            <InfoCircleOutlined />
                        </span>
                    }
                    route="board-brief"
                />
            </Space>
            <CopilotRemoteConsentNotice route="board-brief" />
            <SrOnlyLive>{briefStatusAnnouncement}</SrOnlyLive>
            {showBriefLoadingSkeleton && (
                <div
                    aria-label={microcopy.a11y.generatingBrief}
                    aria-busy="true"
                >
                    <Skeleton active paragraph={{ rows: 2 }} title />
                    <Skeleton
                        active
                        paragraph={{ rows: 4 }}
                        style={{ marginTop: space.lg }}
                        title={false}
                    />
                </div>
            )}
            {error && !briefData && (
                <Alert
                    action={
                        errorView.retryable ? (
                            <Button
                                onClick={handleRefresh}
                                size="small"
                                type="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        ) : null
                    }
                    description={errorView.body || undefined}
                    showIcon
                    title={errorView.heading}
                    type={errorView.severity}
                />
            )}
            {briefData && (
                <div
                    aria-label={microcopy.a11y.boardBriefContent}
                    aria-live="polite"
                >
                    <Typography.Title level={3} style={{ marginTop: 0 }}>
                        {headline}
                    </Typography.Title>
                    {briefData.recommendation && (
                        <Alert
                            action={
                                recommendationFeedbackVisible &&
                                !activeIsLoading ? (
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
                                ) : null
                            }
                            description={
                                <BriefRecommendationBody
                                    detail={briefData.recommendationDetail}
                                    fallbackText={briefData.recommendation}
                                    onOpenTask={openTaskFromBrief}
                                />
                            }
                            showIcon
                            style={{ marginBottom: space.md }}
                            title={
                                <BriefRecommendationTitle
                                    detail={briefData.recommendationDetail}
                                />
                            }
                            type={
                                briefData.recommendationDetail?.strength ===
                                "none"
                                    ? "info"
                                    : "warning"
                            }
                        />
                    )}
                    <SectionHeading>
                        {microcopy.brief.countsPerColumn}
                    </SectionHeading>
                    <Table
                        columns={[
                            {
                                dataIndex: "columnName",
                                key: "columnName",
                                title: microcopy.brief.column
                            },
                            {
                                align: "right",
                                dataIndex: "count",
                                key: "count",
                                title: microcopy.brief.tasks
                            }
                        ]}
                        dataSource={briefData.counts.map((entry) => ({
                            ...entry,
                            key: entry.columnId
                        }))}
                        pagination={false}
                        size="small"
                        style={{ marginBottom: space.md }}
                    />

                    <SectionHeading>
                        {microcopy.brief.largestUnstarted}
                    </SectionHeading>
                    {briefData.largestUnstarted.length === 0 ? (
                        <Typography.Text type="secondary">
                            {microcopy.brief.noUnstarted}
                        </Typography.Text>
                    ) : (
                        <List
                            dataSource={briefData.largestUnstarted}
                            renderItem={(item) => (
                                <ClickableListItem
                                    onActivate={() =>
                                        openTaskFromBrief(item.taskId)
                                    }
                                >
                                    <List.Item.Meta
                                        description={
                                            item.storyPoints !== undefined ? (
                                                <Tag>
                                                    {microcopy.brief.ptsCount.replace(
                                                        "{count}",
                                                        String(item.storyPoints)
                                                    )}
                                                </Tag>
                                            ) : null
                                        }
                                        title={item.taskName}
                                    />
                                </ClickableListItem>
                            )}
                            size="small"
                            style={{ marginBottom: space.md }}
                        />
                    )}

                    <SectionHeading>
                        {microcopy.brief.unownedTasks}
                    </SectionHeading>
                    {briefData.unowned.length === 0 ? (
                        <Typography.Text type="secondary">
                            {microcopy.brief.allOwned}
                        </Typography.Text>
                    ) : (
                        <List
                            dataSource={briefData.unowned}
                            renderItem={(item) => (
                                <ClickableListItem
                                    onActivate={() =>
                                        openTaskFromBrief(item.taskId)
                                    }
                                >
                                    {item.taskName}
                                </ClickableListItem>
                            )}
                            size="small"
                            style={{ marginBottom: space.md }}
                        />
                    )}

                    <SectionHeading>{microcopy.brief.workload}</SectionHeading>
                    {briefData.workload.length === 0 ? (
                        <Typography.Text type="secondary">
                            {microcopy.brief.noActivePerMember}
                        </Typography.Text>
                    ) : (
                        <List
                            dataSource={briefData.workload}
                            renderItem={(item) => {
                                const ratio =
                                    teamAverage > 0
                                        ? Math.min(
                                              1.5,
                                              item.openTasks / teamAverage
                                          )
                                        : 0;
                                const overloaded = ratio > 1.2;
                                return (
                                    <WorkloadRow>
                                        <WorkloadName>
                                            {item.username}
                                        </WorkloadName>
                                        <span>
                                            <Tag style={{ marginInlineEnd: 0 }}>
                                                {microcopy.brief.openCount.replace(
                                                    "{count}",
                                                    String(item.openTasks)
                                                )}
                                            </Tag>{" "}
                                            <Tag
                                                color="blue"
                                                style={{ marginInlineEnd: 0 }}
                                            >
                                                {microcopy.brief.ptsCount.replace(
                                                    "{count}",
                                                    String(item.openPoints)
                                                )}
                                            </Tag>
                                        </span>
                                        <WorkloadBarWrap>
                                            <WorkloadBar
                                                overloaded={overloaded}
                                                style={{
                                                    transform: `scaleX(${Math.min(100, ratio * 80) / 100})`
                                                }}
                                            />
                                        </WorkloadBarWrap>
                                    </WorkloadRow>
                                );
                            }}
                            size="small"
                        />
                    )}
                    {generatedAt !== null && (
                        <Typography.Text
                            style={{
                                display: "block",
                                marginTop: space.md
                            }}
                            type="secondary"
                        >
                            {microcopy.brief.generated.replace(
                                "{time}",
                                formatRelative(generatedAt, now)
                            )}
                        </Typography.Text>
                    )}
                    {isRemote && remoteAgent.citations.length > 0 && (
                        <Space size={4} style={{ marginTop: space.sm }} wrap>
                            {remoteAgent.citations.map((c, i) => (
                                <CitationChip
                                    citation={c}
                                    index={i + 1}
                                    key={`${c.id}-${i}`}
                                />
                            ))}
                        </Space>
                    )}
                </div>
            )}
        </>
    );
};

export default BriefTabBody;
