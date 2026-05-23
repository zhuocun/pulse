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
    message,
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
import { BRIEF_CACHE_TTL_MS } from "../../theme/aiTokens";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { extractSuggestionRunId } from "../../utils/ai/extractSuggestionRunId";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import useAgent from "../../utils/hooks/useAgent";
import useAi from "../../utils/hooks/useAi";
import useDelayedFlag from "../../utils/hooks/useDelayedFlag";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
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

const fingerprintBoard = (
    columns: IColumn[],
    tasks: ITask[],
    members: IMember[]
): string => {
    return [
        columns.length,
        tasks.length,
        members.length,
        // Sample a few tasks' ids so adding/removing a single task busts the cache
        tasks
            .slice(0, 8)
            .map((t) => `${t._id}:${t.columnId ?? ""}:${t.coordinatorId ?? ""}`)
            .join("|")
    ].join("/");
};

const formatRelative = (then: number, now: number): string => {
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 30) return microcopy.brief.relativeJustNow;
    if (seconds < 90) return microcopy.brief.relativeOneMinute;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return microcopy.brief.relativeMinutes.replace(
            "{count}",
            String(minutes)
        );
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return hours === 1
            ? microcopy.brief.relativeOneHour
            : microcopy.brief.relativeHours.replace("{count}", String(hours));
    const days = Math.round(hours / 24);
    return days === 1
        ? microcopy.brief.relativeOneDay
        : microcopy.brief.relativeDays.replace("{count}", String(days));
};

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
    <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
        <span>{`${microcopy.a11y.aiSuggestion}: ${microcopy.brief.recommendedNextStep}`}</span>
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
            <Typography.Paragraph style={{ marginBottom: 4 }}>
                {text}
            </Typography.Paragraph>
            {detail?.basis && (
                <Typography.Paragraph
                    style={{ fontSize: fontSize.xs, marginBottom: 4 }}
                    type="secondary"
                >
                    {microcopy.brief.basisLabel.replace("{text}", detail.basis)}
                </Typography.Paragraph>
            )}
            {detail && detail.sources.length > 0 && (
                <Space size={4} wrap>
                    {detail.sources.map((source) => (
                        <Tag
                            color="purple"
                            key={source.taskId}
                            onClick={() => onOpenTask(source.taskId)}
                            style={{
                                cursor: "pointer",
                                marginInlineEnd: 0
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
        // Kick the remote brief request only when the user is actually
        // looking at the Brief surface. Tearing it down is wired to
        // `dockOpen` below so a Chat ↔ Brief tab switch doesn't abort the
        // in-flight stream (R1-H2).
        if (surfaceVisible && projectId) {
            void startRemoteBrief(microcopy.ai.generateBoardBriefPrompt);
        } else if (!dockOpen) {
            abortRemoteBrief();
            clearRemoteBriefSuggestion();
        }
    }, [
        surfaceVisible,
        dockOpen,
        isRemote,
        projectId,
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
            return;
        }
        const prevFingerprint = lastFingerprintRef.current;
        const fingerprintChanged =
            prevFingerprint !== "" && prevFingerprint !== fingerprint;
        const isFirstOpen = prevFingerprint === "";
        if (isFirstOpen || fingerprintChanged) {
            track(ANALYTICS_EVENTS.COPILOT_BRIEF_OPEN);
        }
        if (prevFingerprint !== fingerprint) {
            lastFingerprintRef.current = fingerprint;
        }
        if (!isRemote) {
            void runBrief();
        } else if (fingerprintChanged) {
            abortRemoteBrief();
            clearRemoteBriefSuggestion();
            void startRemoteBrief(microcopy.ai.generateBoardBriefPrompt);
        }
    }, [
        surfaceVisible,
        dockOpen,
        fingerprint,
        runBrief,
        isRemote,
        abortRemoteBrief,
        clearRemoteBriefSuggestion,
        startRemoteBrief
    ]);

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
        track(ANALYTICS_EVENTS.BRIEF_REFRESHED, { projectId });
        if (isRemote) {
            clearRemoteBriefSuggestion();
            await startRemoteBrief(microcopy.ai.generateBoardBriefPrompt);
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
