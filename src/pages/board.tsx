import {
    CloseOutlined,
    DeleteOutlined,
    InboxOutlined,
    MoreOutlined,
    ReloadOutlined,
    SettingOutlined,
    UnorderedListOutlined
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
import { DragDropContext } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import AiSearchInput from "../components/aiSearchInput";
import ArchiveDrawer from "../components/archiveDrawer";
import BoardMinimap from "../components/boardMinimap";
import BulkEditToolbar from "../components/bulkEditToolbar";
import Column from "../components/column";
import CopilotMenu from "../components/copilotMenu";
import CopilotWelcomeBanner from "../components/copilotWelcomeBanner";
import ColumnCreator from "../components/columnCreator";
import { Drag, Drop, DropChild } from "../components/dragAndDrop";
import EmptyState from "../components/emptyState";
import GlassActionCluster from "../components/glassActionCluster";
import LensChips, { parseLensId } from "../components/lensChips";
import { buildLensPredicate } from "../components/lensChips/lensPredicate";
import MemberPopover from "../components/memberPopover";
import Row from "../components/row";
import TaskModal from "../components/taskModal";
import TaskSearchPanel from "../components/taskSearchPanel";
import TrashDrawer from "../components/trashDrawer";
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
import SrOnlyLive from "../utils/a11y/SrOnlyLive";
import { srOnlyLiveRegionStyle } from "../utils/a11y/srOnlyLiveRegionStyle";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useAiProjectDisabled from "../utils/hooks/useAiProjectDisabled";
import useArchiveDrawer from "../utils/hooks/useArchiveDrawer";
import useBoardBriefDrawer from "../utils/hooks/useBoardBriefDrawer";
import { BulkSelectionProvider } from "../utils/hooks/useBulkSelection";
import useCopilotDock from "../utils/hooks/useCopilotDock";
import useDragEnd from "../utils/hooks/useDragEnd";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";
import useLabels from "../utils/hooks/useLabels";
import useMembersList from "../utils/hooks/useMembersList";
import useMilestones from "../utils/hooks/useMilestones";
import useReactQuery from "../utils/hooks/useReactQuery";
import useReducedMotion from "../utils/hooks/useReducedMotion";
import useTitle from "../utils/hooks/useTitle";
import useTrashDrawer from "../utils/hooks/useTrashDrawer";
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
    min-width: 0;
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
    isolation: isolate;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
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

    @media (pointer: coarse) {
        gap: 0;
        margin-bottom: ${themeSpace.sm}px;
    }
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
 * Action cluster on the board header. Wraps the CopilotMenu launcher and the
 * Settings cog into a tight row. On phone-sized viewports the cluster takes
 * the full row below the title so the launcher gets a usable target size and
 * does not crowd the project name. From md upwards the cluster shrinks to
 * its natural width and aligns to the right of the title row.
 *
 * `flex-wrap: nowrap` keeps the settings cog inline with the launcher on
 * every viewport so a long launcher label does not orphan the cog onto a
 * second row.
 */
const BoardActions = styled.div`
    align-items: center;
    display: flex;
    flex: 1 1 100%;
    flex-wrap: nowrap;
    gap: ${themeSpace.xs}px;
    min-width: 0;

    @media (min-width: ${breakpoints.md}px) {
        flex: 0 0 auto;
        justify-content: flex-end;
    }
`;

/**
 * Bottom tier of the two-tier board header. Holds the search/filter rail
 * and the Copilot action launcher. On narrow viewports the launcher stacks
 * below the search rail (column direction); from md upwards they share a
 * row with the search rail growing to fill and the launcher hugging the
 * trailing edge. No fixed min-widths so the row reflows cleanly below the
 * 1024px breakpoint where the old single-row header used to wrap
 * unpredictably.
 */
const BoardBottomTier = styled.div`
    align-items: stretch;
    display: flex;
    flex-direction: column;
    gap: ${themeSpace.sm}px;

    @media (min-width: ${breakpoints.md}px) {
        align-items: flex-start;
        flex-direction: row;
    }
`;

const BoardSearchSlot = styled.div`
    flex: 1 1 auto;
    min-width: 0;
`;

const LensToggleRow = styled.div`
    margin-bottom: ${themeSpace.xs}px;
`;

const LensPanel = styled.div<{ $open: boolean }>`
    display: ${({ $open }) => ($open ? "block" : "none")};
`;

/**
 * Trailing slot in the bottom tier that carries the desktop Copilot
 * launcher. Hidden on phone chrome, where the launcher lives inside the
 * top-tier Liquid Glass capsule instead (iOS 26 toolbar idiom).
 */
const BoardCopilotSlot = styled.div`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${themeSpace.xs}px;
`;

const SWIPE_HINT_DISMISSED_KEY = "board.swipeHintDismissed";

/*
 * Shared frozen empty array. `Column` is `React.memo`'d, so handing it a
 * freshly-allocated `[]` fallback on every board render (for an empty
 * column's task bucket, or before `members` resolves) would change the
 * prop identity each time and re-render the memoized column for nothing.
 * One stable reference keeps the shallow prop comparison a no-op when the
 * real data is genuinely empty.
 */
const EMPTY_TASKS: ITask[] = Object.freeze([]) as unknown as ITask[];
const EMPTY_MEMBERS: IMember[] = Object.freeze([]) as unknown as IMember[];
const EMPTY_LABELS: ILabel[] = Object.freeze([]) as unknown as ILabel[];
const EMPTY_MILESTONES: IMilestone[] = Object.freeze(
    []
) as unknown as IMilestone[];

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
        "semanticIds",
        "lens"
    ]);
    const { user } = useAuth();
    const activeLens = parseLensId(param.lens);
    const [lensesOpen, setLensesOpen] = useState(() => Boolean(activeLens));
    useEffect(() => {
        if (activeLens) setLensesOpen(true);
    }, [activeLens]);
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
        refetch: refetchBoard,
        isRefetching: boardRefetching
    } = useReactQuery<IColumn[]>("boards", {
        projectId
    });
    const { isLoading: mLoading, data: members } = useMembersList();
    // Project labels, fetched once at the board level and threaded into each
    // column → card so a card can resolve its `labelIds` to name + colour
    // chips without an N-per-card fetch (mirrors how `members` is shared).
    const { labels } = useLabels(projectId);
    // Project milestones, fetched once at the board level and threaded into
    // each column → card so a card can resolve its `milestoneId` to a
    // milestone badge without an N-per-card fetch (mirrors `labels`).
    const { data: milestones } = useMilestones(projectId);
    /*
     * Stable members reference for the memoized `Column`. `members` from
     * the query is a stable ref once resolved, but is `undefined` while
     * loading; coalescing to the shared frozen `EMPTY_MEMBERS` (rather
     * than an inline `members ?? []`) keeps the prop identity steady
     * across the renders before the fetch resolves. `safeLabels` mirrors
     * this for the labels thread.
     */
    const safeMembers = members ?? EMPTY_MEMBERS;
    const safeLabels = labels ?? EMPTY_LABELS;
    // Frozen fallback for the memoized `Column` (see `safeLabels`): a fresh
    // `[]` each render would change the prop identity and defeat the memo.
    const safeMilestones = milestones ?? EMPTY_MILESTONES;

    const {
        data: tasks,
        isLoading: tLoading,
        error: tError,
        refetch: refetchTasks,
        isRefetching: tasksRefetching
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

    /*
     * Wave 6 — phone-only toolbar refresh. The board has no page-level
     * vertical scroll (the column container scrolls horizontally, each
     * column's task list scrolls internally, and the card itself is the
     * dnd drag handle), so a vertical pull-to-refresh gesture is
     * infeasible / conflict-prone here. A toolbar button is the honest
     * affordance. Re-fetches both the column layout and the tasks.
     */
    const handleRefresh = () => Promise.all([refetchBoard(), refetchTasks()]);
    const boardRefreshing = boardRefetching || tasksRefetching;

    const visibleTasks = tasks ?? [];
    // Phase 3 A7 — lens predicate narrows the task universe before the
    // filter rail's per-column predicate runs in `column.tsx`.
    const lensedTasks = useMemo(() => {
        const predicate = buildLensPredicate({
            lens: activeLens,
            currentUserId: user?._id
        });
        return activeLens ? visibleTasks.filter(predicate) : visibleTasks;
    }, [activeLens, user?._id, visibleTasks]);
    const tasksByColumn = useMemo(() => {
        const buckets = new Map<string, ITask[]>();
        for (const t of lensedTasks) {
            const list = buckets.get(t.columnId);
            if (list) {
                list.push(t);
            } else {
                buckets.set(t.columnId, [t]);
            }
        }
        return buckets;
    }, [lensedTasks]);
    const resetBoardFilters = useCallback(() => {
        setParam({
            taskName: undefined,
            coordinatorId: undefined,
            type: undefined,
            semanticIds: undefined
        });
    }, [setParam]);
    const emptyColumnCreatorRef = useRef<HTMLDivElement | null>(null);
    const handleCreateFirstColumn = useCallback(() => {
        const trigger = emptyColumnCreatorRef.current?.querySelector("button");
        if (trigger instanceof HTMLButtonElement) {
            trigger.click();
            trigger.focus();
        }
    }, []);
    /**
     * Phase 4.6 — horizontal scroll ref for the board minimap. The
     * minimap reads `scrollLeft + clientWidth` from this ref to
     * compute which columns are currently in the viewport and writes
     * `scrollLeft` (via `Element.scrollTo`) to bring a column into
     * view on click. Lives on the `ColumnContainer` styled-div, which
     * is the actual `overflow-x: auto` element; threading the ref
     * directly (rather than putting scroll state in Redux) keeps
     * scroll position out of the React tree and avoids a re-render
     * every frame while the user scrubs.
     */
    const boardScrollRef = useRef<HTMLDivElement | null>(null);
    /**
     * Per-column task counts for the minimap aria-labels. We project
     * `tasksByColumn` (already-bucketed by column id, lensed but not
     * filtered further) into a flat number map — the minimap surface
     * shouldn't reflect the search/coordinator filter because doing so
     * would make the in-view affordance change shape mid-search,
     * which is disorienting. The count we expose is the column's true
     * task count under the active lens (matching what the column
     * header's count badge would display when filters are cleared).
     */
    const minimapColumns = useMemo(() => {
        if (!board) return [];
        return board.map((col) => ({
            id: col._id,
            name: col.columnName,
            taskCount: tasksByColumn.get(col._id)?.length ?? 0
        }));
    }, [board, tasksByColumn]);
    const { enabled: aiEnabled } = useAiEnabled();
    const {
        disabled: aiDisabledForProject,
        setDisabled: setProjectAiDisabled
    } = useAiProjectDisabled(projectId);
    const boardAiOn = aiEnabled && !aiDisabledForProject;
    /*
     * Copilot launchers (CopilotMenu, welcome-banner CTA) only trigger
     * the unified dock, which `CopilotDockHost` mounts solely when the
     * `copilotDockEnabled` kill-switch is on. With the switch off the
     * dock host is a no-op, so a rendered launcher would be a dead
     * control whose click goes nowhere — gate it on both flags.
     */
    const copilotLaunchersOn = boardAiOn && environment.copilotDockEnabled;
    // Phone chassis clusters the header toolbar controls into a single
    // Liquid Glass capsule (iOS 26 toolbar idiom). Desktop keeps the
    // plain right-aligned flex row.
    const isPhone = useIsPhoneChrome();
    const reducedMotion = useReducedMotion();
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
    /*
     * Copilot launchers (CopilotMenu Ask / Brief, welcome-banner CTA).
     * These flip the `chatDrawer` / `boardBriefOpen` Redux flags which
     * `CopilotDockHost`'s bridge forwards onto the persistent dock
     * state — the dock itself is mounted once in `MainLayout`, so the
     * board page only triggers it. The launchers render only when
     * `copilotLaunchersOn` is true (AI on for the project AND the dock
     * kill-switch enabled), so a click always reaches a mounted dock.
     */
    const { openDrawer: openBriefDrawer } = useBoardBriefDrawer();
    const { openDrawer: openChatDrawer } = useAiChatDrawer();
    /*
     * Trash drawer (work-management-depth §5.4/§5.6). Open/close lives on
     * the overlays slice like the rest of the family; the drawer itself
     * is a core (non-AI) surface so it mounts unconditionally below,
     * alongside the always-on TaskModal.
     */
    const {
        open: trashOpen,
        openDrawer: openTrashDrawer,
        closeDrawer: closeTrashDrawer
    } = useTrashDrawer();
    /*
     * Archive drawer (work-management-depth §5.4/§5.6). Open/close lives on
     * the overlays slice like the rest of the family; the drawer itself is a
     * core (non-AI) surface so it mounts unconditionally below, alongside the
     * always-on TaskModal and TrashDrawer.
     */
    const {
        open: archiveOpen,
        openDrawer: openArchiveDrawer,
        closeDrawer: closeArchiveDrawer
    } = useArchiveDrawer();
    /*
     * Phase 4 A8 — launcher badge subscription. `inboxUnreadCount` is
     * a pure projection of the triage agent's nudge buffer (owned by
     * `CopilotDockHost`), so this Button doesn't mount the agent —
     * it just reads the cached count. When the count is 0 the Badge
     * collapses to nothing (AntD treats `count={0}` as no-badge).
     */
    const { inboxUnreadCount: copilotInboxUnread } = useCopilotDock();
    // Pick the one/other locale key off the count and interpolate. The
    // strings are plain placeholders (no ICU syntax); the .replace call
    // is the entire formatter. Skip altogether when count is zero so the
    // Badge collapses without an aria-label.
    const copilotUnreadAriaLabel = copilotInboxUnread
        ? (copilotInboxUnread === 1
              ? microcopy.copilotDock.inboxTab.unreadBadgeAriaLabelOne
              : microcopy.copilotDock.inboxTab.unreadBadgeAriaLabelOther
          ).replace("{count}", String(copilotInboxUnread))
        : undefined;
    /*
     * The CopilotDock is mounted once in `MainLayout` by
     * `CopilotDockHost`, which owns the persistent dock state, the
     * background triage-agent run, the inbox nudges, and the
     * command-palette `boardCopilot:openChat` hand-off across every
     * route. The board page only triggers the dock via the legacy
     * `chatDrawer` / `boardBriefOpen` Redux flags (see the launcher
     * callsites above); it no longer mounts an AI surface itself.
     */
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

    /*
     * Coaching UI should disappear once the user demonstrates the
     * behaviour (Apple HIG): the first horizontal scroll of the board
     * container dismisses the swipe hint, so it never lingers after a
     * swipe. The manual close button still persists the dismissal.
     */
    useEffect(() => {
        if (swipeHintDismissed) return;
        const node = boardScrollRef.current;
        if (!node) return;
        node.addEventListener("scroll", dismissSwipeHint, {
            passive: true,
            once: true
        });
        return () => node.removeEventListener("scroll", dismissSwipeHint);
        // `board` is a dep so the listener attaches once the
        // ColumnContainer mounts after the async board load resolves.
    }, [swipeHintDismissed, dismissSwipeHint, board]);

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
        return lensedTasks.filter(
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
    }, [lensedTasks, param]);
    const hasActiveFilters = Boolean(
        param.taskName ||
        param.coordinatorId ||
        param.type ||
        param.semanticIds ||
        activeLens
    );
    const filterStatusMessage = hasActiveFilters
        ? (visibleFilteredCount === 1
              ? microcopy.counts.tasksMatchingActiveFilters.one
              : microcopy.counts.tasksMatchingActiveFilters.other
          ).replace("{count}", String(visibleFilteredCount))
        : "";

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <BulkSelectionProvider>
                <BoardShell>
                    {copilotLaunchersOn && !isPhone && <CopilotWelcomeBanner />}
                    {(() => {
                        /*
                         * Two-tier board header (ui-todo §1.2 item 7). The old
                         * single overloaded row wrapped unpredictably around
                         * 1024px. We split it into:
                         *   - Top tier: project name + chrome toolbar (members,
                         *     per-project "Project AI" switch, phone-only
                         *     refresh).
                         *   - Bottom tier: the search/filter rail + the Copilot
                         *     action launcher.
                         * On phone chrome the whole toolbar (including the
                         * Copilot launcher) collapses into the shared Liquid
                         * Glass capsule, so we render the launcher there and
                         * skip the desktop bottom-tier slot.
                         */
                        const copilotMenuEl = copilotLaunchersOn ? (
                            <CopilotMenu
                                inboxUnread={copilotInboxUnread}
                                onAsk={() => openChatDrawer()}
                                onBrief={() => openBriefDrawer()}
                                onProjectOff={() => setProjectAiDisabled(true)}
                                unreadAriaLabel={copilotUnreadAriaLabel}
                            />
                        ) : null;

                        const projectAiSwitch = aiEnabled ? (
                            <Popover
                                content={
                                    <Space
                                        direction="vertical"
                                        size={themeSpace.xs}
                                        style={{ maxWidth: 280, width: "100%" }}
                                    >
                                        <Typography.Text type="secondary">
                                            {microcopy.ai.copilotLabel}
                                        </Typography.Text>
                                        <div
                                            style={{
                                                alignItems: "center",
                                                display: "flex",
                                                gap: themeSpace.sm,
                                                justifyContent: "space-between"
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
                                                checked={!aiDisabledForProject}
                                                onChange={(checked) =>
                                                    setProjectAiDisabled(
                                                        !checked
                                                    )
                                                }
                                                size="small"
                                            />
                                        </div>
                                        <Typography.Text
                                            style={{ fontSize: fontSize.xs }}
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
                        ) : null;

                        /*
                         * Phone clusters every chrome control — including the
                         * Copilot launcher — into one capsule (6 slots: refresh,
                         * members, trash, archive, Copilot, settings). Desktop keeps
                         * the Copilot launcher out of the top tier so it can anchor
                         * the bottom tier beside the search rail.
                         */
                        const phoneOverflowMenu = isPhone ? (
                            <Dropdown
                                menu={{
                                    items: [
                                        ...(aiEnabled
                                            ? [
                                                  {
                                                      key: "project-ai",
                                                      label: aiDisabledForProject
                                                          ? microcopy.board
                                                                .enableCopilotOnBoard
                                                          : microcopy.board
                                                                .copilotMenuProjectOff,
                                                      icon: (
                                                          <SettingOutlined
                                                              aria-hidden
                                                          />
                                                      ),
                                                      onClick: () =>
                                                          setProjectAiDisabled(
                                                              !aiDisabledForProject
                                                          )
                                                  }
                                              ]
                                            : []),
                                        {
                                            key: "trash",
                                            label: microcopy.trashDrawer
                                                .triggerAriaLabel,
                                            icon: (
                                                <DeleteOutlined aria-hidden />
                                            ),
                                            onClick: () => openTrashDrawer()
                                        },
                                        {
                                            key: "archive",
                                            label: microcopy.archiveDrawer
                                                .triggerAriaLabel,
                                            icon: <InboxOutlined aria-hidden />,
                                            onClick: () => openArchiveDrawer()
                                        }
                                    ]
                                }}
                                trigger={["click"]}
                            >
                                <Button
                                    aria-label={microcopy.board.moreActionsAria}
                                    data-testid="board-more-actions"
                                    icon={<MoreOutlined aria-hidden />}
                                    type="text"
                                />
                            </Dropdown>
                        ) : null;

                        const topTierControls = (
                            <>
                                {isPhone && (
                                    <Button
                                        aria-label={microcopy.actions.refresh}
                                        data-testid="board-refresh"
                                        icon={<ReloadOutlined aria-hidden />}
                                        loading={boardRefreshing}
                                        onClick={handleRefresh}
                                        type="text"
                                    />
                                )}
                                <MemberPopover />
                                {!isPhone && (
                                    <>
                                        <Button
                                            aria-label={
                                                microcopy.trashDrawer
                                                    .triggerAriaLabel
                                            }
                                            data-testid="board-trash"
                                            icon={
                                                <DeleteOutlined aria-hidden />
                                            }
                                            onClick={() => openTrashDrawer()}
                                            type="text"
                                        />
                                        <Button
                                            aria-label={
                                                microcopy.archiveDrawer
                                                    .triggerAriaLabel
                                            }
                                            data-testid="board-archive"
                                            icon={<InboxOutlined aria-hidden />}
                                            onClick={() => openArchiveDrawer()}
                                            type="text"
                                        />
                                    </>
                                )}
                                {isPhone && phoneOverflowMenu}
                                {!isPhone && projectAiSwitch}
                            </>
                        );

                        return (
                            <>
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
                                            isPhone ? (
                                                <BoardTitle
                                                    level={1}
                                                    style={
                                                        srOnlyLiveRegionStyle
                                                    }
                                                >
                                                    {microcopy.board.title}
                                                </BoardTitle>
                                            ) : (
                                                <span
                                                    aria-label={
                                                        microcopy.a11y
                                                            .loadingProjectName
                                                    }
                                                    role="status"
                                                    style={{
                                                        flex: "1 1 auto",
                                                        minWidth: 0
                                                    }}
                                                >
                                                    <Skeleton.Input
                                                        active
                                                        size="large"
                                                        style={{
                                                            maxWidth: "100%",
                                                            width: 240
                                                        }}
                                                    />
                                                </span>
                                            )
                                        ) : (
                                            <BoardTitle
                                                level={1}
                                                style={
                                                    isPhone
                                                        ? srOnlyLiveRegionStyle
                                                        : undefined
                                                }
                                            >
                                                {boardTitle(
                                                    currentProject?.projectName
                                                )}
                                            </BoardTitle>
                                        )}
                                        <BoardActions>
                                            {isPhone ? (
                                                <GlassActionCluster
                                                    data-testid="board-actions-cluster"
                                                    reducedMotion={
                                                        reducedMotion
                                                    }
                                                >
                                                    {topTierControls}
                                                </GlassActionCluster>
                                            ) : (
                                                topTierControls
                                            )}
                                        </BoardActions>
                                    </Row>
                                </BoardHeader>
                                <BoardBottomTier>
                                    <BoardSearchSlot>
                                        <LensToggleRow>
                                            <Button
                                                aria-expanded={
                                                    lensesOpen ||
                                                    Boolean(activeLens)
                                                }
                                                aria-label={
                                                    microcopy.board
                                                        .lensesToggleAria
                                                }
                                                data-testid="board-lenses-toggle"
                                                icon={
                                                    <UnorderedListOutlined
                                                        aria-hidden
                                                    />
                                                }
                                                onClick={() =>
                                                    setLensesOpen(
                                                        (open) => !open
                                                    )
                                                }
                                                type={
                                                    lensesOpen || activeLens
                                                        ? "primary"
                                                        : "default"
                                                }
                                            >
                                                {microcopy.board.lensesToggle}
                                            </Button>
                                        </LensToggleRow>
                                        <LensPanel
                                            $open={
                                                lensesOpen ||
                                                Boolean(activeLens)
                                            }
                                        >
                                            <LensChips
                                                active={activeLens}
                                                onChange={(next) =>
                                                    setParam(
                                                        {
                                                            lens:
                                                                next ??
                                                                undefined
                                                        },
                                                        {
                                                            viewTransition: true
                                                        }
                                                    )
                                                }
                                            />
                                        </LensPanel>
                                        <TaskSearchPanel
                                            tasks={visibleTasks}
                                            param={param}
                                            setParam={setParam}
                                            members={members}
                                            loading={tLoading || mLoading}
                                            aiSearchSlot={
                                                boardAiOn &&
                                                aiProjectContext ? (
                                                    <div
                                                        style={{
                                                            flexBasis: "100%",
                                                            marginBottom:
                                                                themeSpace.sm
                                                        }}
                                                    >
                                                        <AiSearchInput
                                                            kind="tasks"
                                                            projectContext={
                                                                aiProjectContext
                                                            }
                                                            semanticIds={
                                                                param.semanticIds
                                                            }
                                                            setSemanticIds={(
                                                                value
                                                            ) =>
                                                                setParam({
                                                                    semanticIds:
                                                                        value
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                ) : undefined
                                            }
                                        />
                                    </BoardSearchSlot>
                                    {!isPhone && copilotMenuEl && (
                                        <BoardCopilotSlot>
                                            {copilotMenuEl}
                                        </BoardCopilotSlot>
                                    )}
                                </BoardBottomTier>
                            </>
                        );
                    })()}
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
                    <SrOnlyLive>{filterStatusMessage}</SrOnlyLive>
                    {!(bLoading || tLoading) ? (
                        (board?.length ?? 0) === 0 && !(bError || tError) ? (
                            <>
                                <EmptyState
                                    title={microcopy.empty.board.title}
                                    description={
                                        microcopy.empty.board.description
                                    }
                                    cta={
                                        <Button
                                            onClick={handleCreateFirstColumn}
                                            type="primary"
                                        >
                                            {microcopy.empty.board.cta}
                                        </Button>
                                    }
                                />
                                <div ref={emptyColumnCreatorRef}>
                                    <ColumnCreator />
                                </div>
                            </>
                        ) : (
                            <>
                                {(board?.length ?? 0) > 1 &&
                                    !swipeHintDismissed && (
                                        <SwipeHint role="status">
                                            <span aria-hidden>←</span>
                                            <span>
                                                {microcopy.board.swipeHint}
                                            </span>
                                            <span aria-hidden>→</span>
                                            <SwipeHintClose
                                                aria-label={
                                                    microcopy.a11y
                                                        .dismissSwipeHint
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
                                {environment.boardMinimapEnabled && (
                                    <BoardMinimap
                                        columns={minimapColumns}
                                        scrollContainerRef={boardScrollRef}
                                    />
                                )}
                                <ColumnsViewport>
                                    <ColumnContainer ref={boardScrollRef}>
                                        <Drop
                                            droppableId="column"
                                            type="COLUMN"
                                            direction="horizontal"
                                        >
                                            <DropChild
                                                style={{ display: "flex" }}
                                            >
                                                {board?.map((column, index) => (
                                                    <Drag
                                                        detachDragHandle
                                                        disableInteractiveElementBlocking
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
                                                            boardAiOn={
                                                                boardAiOn
                                                            }
                                                            tasks={
                                                                tasksByColumn.get(
                                                                    column._id
                                                                ) ?? EMPTY_TASKS
                                                            }
                                                            column={column}
                                                            data-minimap-column-id={
                                                                column._id
                                                            }
                                                            members={
                                                                safeMembers
                                                            }
                                                            labels={safeLabels}
                                                            milestones={
                                                                safeMilestones
                                                            }
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
                                                            dragDisabledByFilters={
                                                                hasActiveFilters &&
                                                                !isTaskDragDisabled
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
                    {!environment.taskPanelRouted && (
                        <TaskModal boardAiOn={boardAiOn} tasks={tasks} />
                    )}
                    {/*
                     * Trash drawer is a core (non-AI) recovery surface, so it
                     * mounts unconditionally (like the TaskModal above). Its
                     * list query is disabled while closed, so the mount is cheap.
                     */}
                    <TrashDrawer
                        onClose={closeTrashDrawer}
                        open={trashOpen}
                        projectId={projectId}
                    />
                    {/*
                     * Archive drawer is a core (non-AI) recovery surface, so —
                     * like the TrashDrawer above — it mounts unconditionally
                     * (its list query is disabled while closed, so the mount is
                     * cheap).
                     */}
                    <ArchiveDrawer
                        onClose={closeArchiveDrawer}
                        open={archiveOpen}
                        projectId={projectId}
                    />
                    {/*
                     * Bulk-edit toolbar (PRD-GAP-008). Renders nothing until ≥1
                     * card is selected; mounting it unconditionally keeps the
                     * selection→toolbar wiring inside the same provider as the
                     * cards. Fed the shared member/label refs so its selects
                     * resolve coordinator + label options without a new fetch.
                     */}
                    <BulkEditToolbar
                        labels={safeLabels}
                        members={safeMembers}
                    />
                    {/*
                     * The Copilot AI surface (Chat / Brief / Inbox) is the
                     * tabbed `<CopilotDock>` mounted once by `CopilotDockHost`
                     * inside `MainLayout`, so it survives project-route
                     * navigations (R-A M1). The board page only triggers it via
                     * the launcher callsites above — it mounts no AI drawer.
                     */}
                </BoardShell>
            </BulkSelectionProvider>
        </DragDropContext>
    );
};

export default BoardPage;
