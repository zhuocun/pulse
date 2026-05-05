import {
    CloseOutlined,
    FileTextOutlined,
    MessageOutlined,
    SettingOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    Button,
    Dropdown,
    Popover,
    Skeleton,
    Space,
    Switch,
    Typography
} from "antd";
import type { MenuProps } from "antd";
import { DragDropContext } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import AiChatDrawer from "../components/aiChatDrawer";
import AiSearchInput from "../components/aiSearchInput";
import AiSparkleIcon from "../components/aiSparkleIcon";
import BoardBriefDrawer from "../components/boardBriefDrawer";
import CopilotShell from "../components/copilotShell";
import Column from "../components/column";
import CopilotWelcomeBanner from "../components/copilotWelcomeBanner";
import ColumnCreator from "../components/columnCreator";
import { Drag, Drop, DropChild } from "../components/dragAndDrop";
import EmptyState from "../components/emptyState";
import Row from "../components/row";
import TaskModal from "../components/taskModal";
import TaskSearchPanel from "../components/taskSearchPanel";
import environment from "../constants/env";
import { microcopy } from "../constants/microcopy";
import {
    breakpoints,
    columnMinWidthRem,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    radius,
    space as themeSpace
} from "../theme/tokens";
import type { TriageNudge } from "../interfaces/agent";
import useAgent from "../utils/hooks/useAgent";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAiProjectDisabled from "../utils/hooks/useAiProjectDisabled";
import useBoardBriefDrawer from "../utils/hooks/useBoardBriefDrawer";
import useDragEnd from "../utils/hooks/useDragEnd";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTaskModal from "../utils/hooks/useTaskModal";
import useTitle from "../utils/hooks/useTitle";
import useUrl from "../utils/hooks/useUrl";
import { isOptimisticPlaceholderId } from "../utils/optimisticClientId";

/**
 * The board page deliberately opts out of `PageContainer`'s max-width because
 * Kanban columns flow horizontally and benefit from the full viewport on
 * ultra-wide monitors. We keep our own padding here.
 */
const BoardShell = styled.div`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    padding: ${themeSpace.lg}px ${themeSpace.md}px ${themeSpace.md}px;
    padding-block-end: max(${themeSpace.lg}px, env(safe-area-inset-bottom));
    padding-inline-start: max(${themeSpace.md}px, env(safe-area-inset-left));
    padding-inline-end: max(${themeSpace.md}px, env(safe-area-inset-right));
    width: 100%;

    @media (min-width: ${breakpoints.md}px) {
        padding: ${themeSpace.xl}px ${themeSpace.xl}px ${themeSpace.xl}px;
        padding-inline-start: max(
            ${themeSpace.xl}px,
            env(safe-area-inset-left)
        );
        padding-inline-end: max(${themeSpace.xl}px, env(safe-area-inset-right));
    }
`;

export const ColumnContainer = styled.div`
    display: flex;
    flex: 1;
    min-height: 75%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: ${themeSpace.xs}px;
    /* Native, momentum-based scrolling on iOS so swiping between columns feels
     * fluid; the DnD library still catches long-press gestures separately. */
    -webkit-overflow-scrolling: touch;
    scroll-padding-inline: ${themeSpace.md}px;

    /* Subtle scrollbar on platforms that paint one (Firefox, desktop Linux,
     * older Edge). Keeps the visual rhythm calm without going to a hidden
     * scrollbar (which would remove the affordance entirely). */
    scrollbar-width: thin;
    scrollbar-color: var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.08))
        transparent;

    &::-webkit-scrollbar {
        height: 8px;
    }
    &::-webkit-scrollbar-thumb {
        background: var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.08));
        border-radius: ${radius.pill}px;
    }
    &::-webkit-scrollbar-thumb:hover {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.16));
    }

    /*
     * On phone-sized viewports we show roughly one column at a time, so
     * snap horizontal swipes to each column for a Trello-style flick UX.
     * The DnD library still controls drag-and-drop; native scrolling only
     * kicks in on swipes that don't engage the drag handle.
     */
    @media (max-width: ${breakpoints.md - 1}px) {
        scroll-snap-type: x mandatory;

        > * {
            scroll-snap-align: start;
        }
    }
`;

/**
 * Wrapper that paints subtle gradient fades at the left and right edges so
 * users can see — without scrolling — that more columns exist beyond the
 * viewport. The fades use `pointer-events: none` so they never block clicks
 * or drag-and-drop on the columns underneath.
 */
const ColumnsViewport = styled.div`
    flex: 1;
    min-height: 0;
    position: relative;

    &::before,
    &::after {
        content: "";
        bottom: 0;
        pointer-events: none;
        position: absolute;
        top: 0;
        width: ${themeSpace.lg}px;
        z-index: 1;
    }

    &::before {
        background: linear-gradient(
            to right,
            var(--pulse-bg-page),
            transparent
        );
        left: 0;
    }

    &::after {
        background: linear-gradient(to left, var(--pulse-bg-page), transparent);
        right: 0;
    }

    /* Hide the fades in forced-colors / high-contrast mode where gradients
     * are filtered out and would just paint as solid blocks. */
    @media (forced-colors: active) {
        &::before,
        &::after {
            display: none;
        }
    }
`;

/**
 * Hint shown on phone-sized viewports the first time the board is loaded
 * with multiple columns, advising the user to swipe horizontally. Hidden
 * on tablet+ where columns are visible side-by-side. The hint can be
 * dismissed with the close icon and the dismissal persists in
 * localStorage so a user who has acknowledged it once is not nagged on
 * every fresh tab or app reopen.
 */
const SwipeHint = styled.div`
    align-items: center;
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border-radius: ${radius.pill}px;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.55));
    display: none;
    font-size: ${fontSize.xs}px;
    gap: ${themeSpace.xs}px;
    justify-content: center;
    margin-bottom: ${themeSpace.xs}px;
    padding: ${themeSpace.xxs}px ${themeSpace.sm}px;
    text-align: center;

    @media (max-width: ${breakpoints.md - 1}px) {
        display: flex;
    }
`;

const SwipeHintClose = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.pill}px;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    height: 24px;
    justify-content: center;
    padding: 0;
    width: 24px;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.06));
    }

    /*
     * The hint itself is only rendered on coarse-pointer / phone-sized
     * viewports, so a finger has to land this dismiss target. Lift to
     * the 44 px WCAG 2.5.5 touch floor on coarse pointers; the icon
     * glyph stays visually small (10 px) so the chrome doesn't grow.
     */
    @media (pointer: coarse) {
        height: 44px;
        width: 44px;
    }
`;

const BoardLoadingSkeleton = () => (
    <ColumnContainer aria-busy="true" aria-label={microcopy.a11y.loadingBoard}>
        {[0, 1, 2].map((i) => (
            <div
                key={i}
                style={{
                    background: "var(--ant-color-fill-quaternary, #f4f5f7)",
                    borderRadius: radius.lg,
                    marginRight: themeSpace.md,
                    minWidth: `${columnMinWidthRem}rem`,
                    padding: themeSpace.md
                }}
            >
                <Skeleton active paragraph={{ rows: 4 }} title />
            </div>
        ))}
    </ColumnContainer>
);

const BoardHeader = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${themeSpace.xs}px;
    margin-bottom: ${themeSpace.lg}px;
`;

const BoardTitle = styled(Typography.Title)`
    && {
        flex: 1 1 auto;
        font-size: ${fontSize.xl}px;
        font-weight: ${fontWeight.semibold};
        letter-spacing: ${letterSpacing.tight};
        line-height: ${lineHeight.tight};
        margin: 0;
        min-width: 0;
        /* break-word prefers natural word boundaries and only splits a
         * run mid-character when the run truly does not fit (e.g. a
         * 30+ char single token). The previous "anywhere" value happily
         * split "Roadmap" into "Roadma|p" on iPhone SE widths. */
        overflow-wrap: break-word;
        /* Cap a pathologically long single-token project name (e.g. a
         * 200-char paste) at two lines so it doesn't grow the heading to
         * 4+ lines and push the entire board down. The clamp only kicks
         * in once break-word has wrapped past two lines. */
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }

    @media (min-width: ${breakpoints.md}px) {
        && {
            font-size: ${fontSize.xxl}px;
        }
    }
`;

/**
 * Action cluster on the board header. Stretches full-width below the title
 * on phone-sized viewports so the Brief / Ask buttons get a usable target
 * size and do not crowd the project name. From md upwards the cluster
 * shrinks to its natural width and aligns to the right of the title row.
 *
 * `flex-wrap: nowrap` keeps the settings cog inline with the Brief/Ask
 * compact group on every viewport — when the cluster could wrap, the
 * 100 %-width Space.Compact pushed the cog onto its own row where it
 * floated, orphaned, between the title and the search panel.
 */
const BoardActions = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 100%;
    flex-wrap: nowrap;
    gap: ${themeSpace.xs}px;
    min-width: 0;

    .ant-space-compact {
        flex: 1 1 auto;
        min-width: 0;
    }

    @media (min-width: ${breakpoints.md}px) {
        flex: 0 0 auto;
        justify-content: flex-end;

        .ant-space-compact {
            flex: 0 0 auto;
            /*
             * Space.Compact ships with the \`block\` prop on this surface so
             * Brief / Ask stretch full-width on phones. \`block\` writes
             * \`width: 100%\` inline, which on tablet+ would have the compact
             * group claim the entire BoardActions row and crush the
             * settings cog beside it down to a 2 px sliver. Reset the
             * width here so each child sizes to its content instead.
             */
            width: auto;
        }
    }
`;

const SWIPE_HINT_DISMISSED_KEY = "board.swipeHintDismissed";

const boardTitle = (projectName?: string) =>
    projectName
        ? microcopy.board.titleWithName.replace("{name}", projectName)
        : microcopy.board.title;

const BoardPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const [param, setParam] = useUrl([
        "taskName",
        "coordinatorId",
        "type",
        "semanticIds"
    ]);
    const { data: currentProject, isLoading: pLoading } =
        useReactQuery<IProject>("projects", {
            projectId
        });
    /*
     * Browser tab title mirrors the heading. While the project query is in
     * flight we keep the generic "Board" title rather than rendering an
     * orphan " board" with a leading space, and the title updates the
     * moment the project name resolves.
     */
    useTitle(boardTitle(currentProject?.projectName));
    const {
        data: board,
        isLoading: bLoading,
        error: bError,
        refetch: refetchBoard
    } = useReactQuery<IColumn[]>("boards", {
        projectId
    });
    const { isLoading: mLoading, data: members } =
        useReactQuery<IMember[]>("users/members");

    const {
        data: tasks,
        isLoading: tLoading,
        error: tError,
        refetch: refetchTasks
    } = useReactQuery<ITask[]>(
        "tasks",
        {
            projectId
        },
        undefined,
        undefined,
        undefined,
        Boolean(board)
    );

    const { onDragEnd, isColumnDragDisabled, isTaskDragDisabled } = useDragEnd({
        tasksEnabled: Boolean(board)
    });
    const visibleTasks = tasks ?? [];
    const tasksByColumn = useMemo(() => {
        const buckets = new Map<string, ITask[]>();
        for (const t of visibleTasks) {
            const list = buckets.get(t.columnId);
            if (list) {
                list.push(t);
            } else {
                buckets.set(t.columnId, [t]);
            }
        }
        return buckets;
    }, [visibleTasks]);
    const resetBoardFilters = useCallback(() => {
        setParam({
            taskName: undefined,
            coordinatorId: undefined,
            type: undefined,
            semanticIds: undefined
        });
    }, [setParam]);
    const { enabled: aiEnabled } = useAiEnabled();
    const {
        disabled: aiDisabledForProject,
        setDisabled: setProjectAiDisabled
    } = useAiProjectDisabled(projectId);
    const boardAiOn = aiEnabled && !aiDisabledForProject;
    const aiProjectContext =
        currentProject && board
            ? {
                  project: {
                      _id: currentProject._id,
                      projectName: currentProject.projectName
                  },
                  columns: board,
                  tasks: visibleTasks,
                  members: members ?? []
              }
            : null;
    // Brief drawer state lives in the URL so the system back button (iOS
    // swipe-back, Android hardware back) dismisses it before exiting the
    // route.
    const {
        open: briefOpen,
        openDrawer: openBriefDrawer,
        closeDrawer: closeBriefDrawer
    } = useBoardBriefDrawer();
    const {
        open: chatOpen,
        openDrawer: openChatDrawer,
        closeDrawer: closeChatDrawer,
        pendingPrompt: chatInitialPrompt
    } = useAiChatDrawer();
    // P1-A: Unified Copilot shell state
    const [copilotShellOpen, setCopilotShellOpen] = useState(false);
    /**
     * Background triage-agent mount (v2.1). Always call the hook
     * unconditionally to respect React's hook ordering rules. The agent
     * will only be started (via effect below) when all of the following
     * are true:
     *   - boardAiOn is true
     *   - aiUseLocalEngine is false (remote backend is available)
     *   - the chat drawer has just been opened for the first time for this
     *     project in the current app session
     */
    const triageAgent = useAgent("triage-agent", {
        projectId: currentProject?._id,
        feToolContext: { projectId: currentProject?._id }
    });
    /**
     * Track which project IDs have already triggered a triage run in
     * this app session so we fire at most once per (project, session).
     */
    const triagedProjectsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!chatOpen) return;
        const pid = currentProject?._id;
        if (!pid) return;
        if (!boardAiOn) return;
        if (environment.aiUseLocalEngine) return;
        if (triagedProjectsRef.current.has(pid)) return;

        triagedProjectsRef.current.add(pid);
        try {
            void triageAgent.start({
                messages: [
                    {
                        role: "user",
                        content: microcopy.ai.runBoardTriagePrompt
                    }
                ]
            });
        } catch {
            // AgentForbiddenError (per-project AI opt-out) — fail silently;
            // the error will also surface via triageAgent.error if needed.
        }
    }, [boardAiOn, chatOpen, currentProject?._id, triageAgent]);

    const { startEditing: openTaskModal } = useTaskModal();
    /**
     * Triage-nudge primary CTA. The nudge wire shape (`agent.d.ts`)
     * exposes `target_ids` but does not type-distinguish between task,
     * column, or member ids. Resolve the first id against the in-cache
     * task list and only navigate when it matches — that avoids
     * opening a phantom modal when the id is a column/member ref (e.g.
     * `wip_overflow`, `load_imbalance`). When no target resolves the
     * click is a graceful no-op; the user still has Dismiss.
     */
    const handleTriageNudgeAction = useCallback(
        (nudge: TriageNudge) => {
            const taskId = nudge.target_ids.find((id) =>
                visibleTasks.some((t) => t._id === id)
            );
            if (taskId) openTaskModal(taskId);
        },
        [openTaskModal, visibleTasks]
    );
    const handleTriageNudgeDismiss = useCallback(
        (nudge: TriageNudge) => {
            triageAgent.dismissNudge(nudge.nudge_id);
        },
        [triageAgent]
    );

    /**
     * Wire the command palette → AI chat hand-off (PRD CP-R6). When the
     * user submits a prompt in palette AI mode, the palette dispatches
     * a `boardCopilot:openChat` event with the prompt; we open the
     * drawer here so the chat hook can pick up the pre-populated value.
     */
    useEffect(() => {
        if (!boardAiOn) return;
        const onOpenChat = (event: Event) => {
            const detail = (event as CustomEvent<{ prompt?: string }>).detail;
            openChatDrawer(detail?.prompt);
        };
        window.addEventListener("boardCopilot:openChat", onOpenChat);
        return () =>
            window.removeEventListener("boardCopilot:openChat", onOpenChat);
    }, [boardAiOn, openChatDrawer]);
    const [swipeHintDismissed, setSwipeHintDismissed] = useState(() => {
        if (typeof window === "undefined") return false;
        try {
            return (
                window.localStorage.getItem(SWIPE_HINT_DISMISSED_KEY) === "1"
            );
        } catch {
            return false;
        }
    });
    const dismissSwipeHint = useCallback(() => {
        setSwipeHintDismissed(true);
        try {
            window.localStorage.setItem(SWIPE_HINT_DISMISSED_KEY, "1");
        } catch {
            // Storage may be unavailable (private mode); state still updates.
        }
    }, []);

    useEffect(() => {
        if (!boardAiOn && param.semanticIds) {
            setParam({ semanticIds: undefined });
        }
    }, [boardAiOn, param.semanticIds, setParam]);

    /*
     * Live status string for the visible task count after filters apply.
     * Read by screen readers when the user types in the search input or
     * picks a coordinator filter; also surfaces the empty-result state
     * for keyboard users who can't see the kanban columns visually.
     */
    const visibleFilteredCount = useMemo(() => {
        return visibleTasks.filter(
            (task) =>
                (!param.type || task.type === param.type) &&
                (!param.coordinatorId ||
                    task.coordinatorId === param.coordinatorId) &&
                (!param.taskName || task.taskName.includes(param.taskName)) &&
                (!param.semanticIds ||
                    param.semanticIds
                        .split(",")
                        .filter(Boolean)
                        .includes(task._id))
        ).length;
    }, [visibleTasks, param]);
    const hasActiveFilters = Boolean(
        param.taskName || param.coordinatorId || param.type || param.semanticIds
    );
    const filterStatusMessage = hasActiveFilters
        ? (visibleFilteredCount === 1
              ? microcopy.counts.tasksMatchingActiveFilters.one
              : microcopy.counts.tasksMatchingActiveFilters.other
          ).replace("{count}", String(visibleFilteredCount))
        : "";

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <BoardShell>
                {boardAiOn && (
                    <CopilotWelcomeBanner
                        onCta={() => {
                            openBriefDrawer();
                        }}
                    />
                )}
                <BoardHeader>
                    <Row
                        between
                        style={{
                            alignItems: "flex-start",
                            flexWrap: "wrap",
                            gap: themeSpace.sm,
                            rowGap: themeSpace.xs
                        }}
                    >
                        {pLoading ? (
                            <span
                                aria-label={microcopy.a11y.loadingProjectName}
                                role="status"
                                style={{ flex: "1 1 auto", minWidth: 0 }}
                            >
                                <Skeleton.Input
                                    active
                                    size="large"
                                    style={{ maxWidth: "100%", width: 240 }}
                                />
                            </span>
                        ) : (
                            <BoardTitle level={1}>
                                {boardTitle(currentProject?.projectName)}
                            </BoardTitle>
                        )}
                        {aiEnabled && (
                            <BoardActions>
                                {boardAiOn && (
                                    <>
                                        {/* P1-A: CopilotMenu — consolidated AI entry point */}
                                        <Dropdown
                                            menu={{
                                                items: [
                                                    {
                                                        key: "ask",
                                                        label: microcopy.board.copilotMenuAsk,
                                                        icon: (
                                                            <MessageOutlined
                                                                aria-hidden
                                                            />
                                                        ),
                                                        onClick: () =>
                                                            openChatDrawer()
                                                    },
                                                    {
                                                        key: "brief",
                                                        label: microcopy.board.copilotMenuBrief,
                                                        icon: (
                                                            <FileTextOutlined
                                                                aria-hidden
                                                            />
                                                        ),
                                                        onClick: () =>
                                                            openBriefDrawer()
                                                    },
                                                    {
                                                        type: "divider"
                                                    },
                                                    {
                                                        key: "shell",
                                                        label: microcopy.board.copilotMenuOpenPanel,
                                                        icon: (
                                                            <AiSparkleIcon
                                                                aria-hidden
                                                            />
                                                        ),
                                                        onClick: () =>
                                                            setCopilotShellOpen(
                                                                true
                                                            )
                                                    }
                                                ] satisfies MenuProps["items"]
                                            }}
                                            placement="bottomRight"
                                            trigger={["click"]}
                                        >
                                            <Button
                                                aria-label={
                                                    microcopy.a11y.boardCopilotMenu
                                                }
                                                icon={
                                                    <AiSparkleIcon
                                                        aria-hidden
                                                    />
                                                }
                                                type="default"
                                            >
                                                {microcopy.labels.copilotShort}
                                            </Button>
                                        </Dropdown>
                                        {/* P1-A: Consolidate into CopilotMenu in next phase */}
                                        <Space.Compact block>
                                            <Button
                                                aria-label={
                                                    microcopy.a11y
                                                        .openBoardCopilotBrief
                                                }
                                                icon={
                                                    <FileTextOutlined
                                                        aria-hidden
                                                    />
                                                }
                                                onClick={openBriefDrawer}
                                                type="default"
                                            >
                                                {microcopy.labels.briefShort}
                                            </Button>
                                            <Button
                                                aria-label={
                                                    microcopy.ai.askCopilot
                                                }
                                                icon={
                                                    <MessageOutlined
                                                        aria-hidden
                                                    />
                                                }
                                                onClick={() => openChatDrawer()}
                                                type="default"
                                            >
                                                {microcopy.labels.askShort}
                                            </Button>
                                        </Space.Compact>
                                    </>
                                )}
                                <Popover
                                    content={
                                        <Space
                                            orientation="vertical"
                                            size={themeSpace.xs}
                                            style={{ maxWidth: 280 }}
                                        >
                                            <Typography.Text type="secondary">
                                                {microcopy.ai.copilotLabel}
                                            </Typography.Text>
                                            <div
                                                style={{
                                                    alignItems: "center",
                                                    display: "flex",
                                                    gap: themeSpace.sm,
                                                    justifyContent:
                                                        "space-between"
                                                }}
                                            >
                                                <span>
                                                    {
                                                        microcopy.board
                                                            .enableCopilotOnBoard
                                                    }
                                                </span>
                                                <Switch
                                                    aria-label={
                                                        microcopy.a11y
                                                            .boardCopilotProjectToggle
                                                    }
                                                    checked={
                                                        !aiDisabledForProject
                                                    }
                                                    onChange={(checked) =>
                                                        setProjectAiDisabled(
                                                            !checked
                                                        )
                                                    }
                                                    size="small"
                                                />
                                            </div>
                                            <Typography.Text
                                                style={{
                                                    fontSize: fontSize.xs
                                                }}
                                                type="secondary"
                                            >
                                                {
                                                    microcopy.board
                                                        .copilotProjectDisabledDescription
                                                }
                                            </Typography.Text>
                                        </Space>
                                    }
                                    placement="bottomRight"
                                    trigger={["click"]}
                                >
                                    <Button
                                        aria-label={
                                            microcopy.a11y.boardCopilotSettings
                                        }
                                        icon={<SettingOutlined aria-hidden />}
                                        type="text"
                                    />
                                </Popover>
                            </BoardActions>
                        )}
                    </Row>
                </BoardHeader>
                <TaskSearchPanel
                    tasks={visibleTasks}
                    param={param}
                    setParam={setParam}
                    members={members}
                    loading={tLoading || mLoading}
                    aiSearchSlot={
                        boardAiOn && aiProjectContext ? (
                            <div
                                style={{
                                    flexBasis: "100%",
                                    marginBottom: themeSpace.sm
                                }}
                            >
                                <AiSearchInput
                                    kind="tasks"
                                    projectContext={aiProjectContext}
                                    semanticIds={param.semanticIds}
                                    setSemanticIds={(value) =>
                                        setParam({ semanticIds: value })
                                    }
                                />
                            </div>
                        ) : undefined
                    }
                />
                {bError || tError ? (
                    <Alert
                        action={
                            <Button
                                onClick={() => {
                                    if (bError) refetchBoard();
                                    if (tError) refetchTasks();
                                }}
                                size="small"
                                type="primary"
                            >
                                {microcopy.actions.retry}
                            </Button>
                        }
                        description={microcopy.feedback.retryHint}
                        title={microcopy.feedback.loadFailed}
                        showIcon
                        style={{ marginBottom: themeSpace.md }}
                        type="error"
                    />
                ) : null}
                <span
                    aria-atomic="true"
                    aria-live="polite"
                    style={{
                        clip: "rect(0 0 0 0)",
                        height: 1,
                        overflow: "hidden",
                        position: "absolute",
                        whiteSpace: "nowrap",
                        width: 1
                    }}
                >
                    {filterStatusMessage}
                </span>
                {!(bLoading || tLoading) ? (
                    (board?.length ?? 0) === 0 && !(bError || tError) ? (
                        // When the board has no columns, show only the empty
                        // hero with a single inline CTA. Previously we also
                        // rendered the ColumnsViewport with a lone
                        // <ColumnCreator />, producing a duplicate "Add column"
                        // tile floating to the left of the centered hero.
                        <EmptyState
                            title={microcopy.empty.board.title}
                            description={microcopy.empty.board.description}
                            cta={<ColumnCreator />}
                        />
                    ) : (
                        <>
                            {(board?.length ?? 0) > 1 &&
                                !swipeHintDismissed && (
                                    <SwipeHint role="status">
                                        <span aria-hidden>←</span>
                                        <span>{microcopy.board.swipeHint}</span>
                                        <span aria-hidden>→</span>
                                        <SwipeHintClose
                                            aria-label={
                                                microcopy.a11y.dismissSwipeHint
                                            }
                                            onClick={dismissSwipeHint}
                                            type="button"
                                        >
                                            <CloseOutlined
                                                aria-hidden
                                                style={{ fontSize: 10 }}
                                            />
                                        </SwipeHintClose>
                                    </SwipeHint>
                                )}
                            <ColumnsViewport>
                                <ColumnContainer>
                                    <Drop
                                        droppableId="column"
                                        type="COLUMN"
                                        direction="horizontal"
                                    >
                                        <DropChild style={{ display: "flex" }}>
                                            {board?.map((column, index) => (
                                                <Drag
                                                    key={column._id}
                                                    draggableId={`column${column._id}`}
                                                    index={index}
                                                    isDragDisabled={
                                                        isColumnDragDisabled ||
                                                        isTaskDragDisabled ||
                                                        isOptimisticPlaceholderId(
                                                            column._id
                                                        )
                                                    }
                                                >
                                                    <Column
                                                        boardAiOn={boardAiOn}
                                                        tasks={
                                                            tasksByColumn.get(
                                                                column._id
                                                            ) ?? []
                                                        }
                                                        column={column}
                                                        members={members ?? []}
                                                        param={param}
                                                        onResetFilters={
                                                            resetBoardFilters
                                                        }
                                                        isDragDisabled={
                                                            isTaskDragDisabled
                                                        }
                                                        taskDragDisabled={
                                                            isTaskDragDisabled ||
                                                            hasActiveFilters
                                                        }
                                                    />
                                                </Drag>
                                            ))}
                                        </DropChild>
                                    </Drop>
                                    <ColumnCreator />
                                </ColumnContainer>
                            </ColumnsViewport>
                        </>
                    )
                ) : (
                    <BoardLoadingSkeleton />
                )}
                <TaskModal boardAiOn={boardAiOn} tasks={tasks} />
                {boardAiOn && (
                    <>
                        <BoardBriefDrawer
                            columns={board ?? []}
                            members={members ?? []}
                            onClose={closeBriefDrawer}
                            open={briefOpen}
                            project={currentProject}
                            tasks={visibleTasks}
                        />
                        <AiChatDrawer
                            columns={board ?? []}
                            initialPrompt={chatInitialPrompt}
                            knownProjectIds={projectId ? [projectId] : []}
                            members={members ?? []}
                            onActionNudge={
                                !environment.aiUseLocalEngine
                                    ? handleTriageNudgeAction
                                    : undefined
                            }
                            onClose={closeChatDrawer}
                            onDismissNudge={
                                !environment.aiUseLocalEngine
                                    ? handleTriageNudgeDismiss
                                    : undefined
                            }
                            open={chatOpen}
                            pendingNudges={
                                !environment.aiUseLocalEngine
                                    ? triageAgent.nudges
                                    : undefined
                            }
                            project={currentProject ?? null}
                            tasks={visibleTasks}
                        />
                        {/* P1-A: Unified Copilot shell */}
                        <CopilotShell
                            columns={board ?? []}
                            knownProjectIds={projectId ? [projectId] : []}
                            members={members ?? []}
                            onClose={() => setCopilotShellOpen(false)}
                            onOpenBrief={openBriefDrawer}
                            onOpenChat={() => openChatDrawer()}
                            open={copilotShellOpen}
                            project={currentProject ?? null}
                            tasks={visibleTasks}
                        />
                    </>
                )}
            </BoardShell>
        </DragDropContext>
    );
};

export default BoardPage;
