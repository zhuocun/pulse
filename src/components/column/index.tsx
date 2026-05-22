import { HolderOutlined, MoreOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Badge,
    Dropdown,
    MenuProps,
    Modal,
    Tag,
    Tooltip,
    Typography
} from "antd";
import React from "react";
import { useParams } from "react-router-dom";

import bugIcon from "../../assets/bug.svg";
import taskIcon from "../../assets/task.svg";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    brand,
    breakpoints,
    columnMinWidthRem,
    fontSize,
    fontWeight,
    letterSpacing,
    radius,
    shadow,
    space,
    touchTargetCoarse,
    touchTargetMin
} from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";
import AiMatchStrengthBadge from "../aiMatchStrengthBadge";
import {
    Drag,
    Drop,
    DropChild,
    useDetachedDragHandleProps
} from "../dragAndDrop";
import { NoPaddingButton } from "../projectList";
import Row from "../row";
import TaskCreator from "../taskCreator";
import { TaskSearchParam } from "../taskSearchPanel";
import UserAvatar from "../userAvatar";

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
) =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

export const ColumnContainer = styled.div`
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border: 1px solid transparent;
    border-radius: ${radius.lg}px;
    display: flex;
    flex-direction: column;
    margin-right: ${space.md}px;
    /* Fix the column at 18rem so a single ultra-wide task card cannot
     * stretch the lane past its lane-mates. min-width alone is a floor —
     * flex-basis: auto resolves to the card's max-content and the column
     * grew to ~780px when a 120-char single-token task name appeared. */
    width: ${columnMinWidthRem}rem;
    flex: 0 0 ${columnMinWidthRem}rem;
    min-width: ${columnMinWidthRem}rem;
    padding: ${space.sm}px;
    transition: background-color 200ms ease-out;

    /*
     * On phone-sized viewports a full desktop column overflows the screen.
     * BoardShell uses 16 px horizontal padding on mobile (16 + 16 = 32)
     * and the column carries its own 16 px margin-right. The previous
     * formula calc(100dvw - 48px) exactly filled that chrome, leaving the
     * next column with only the column's own margin (≈ 8 px after the
     * fade gradient) — readable text from the next column's header still
     * poked through, looking like a clipped layout. We now reserve an
     * extra space.xl (32 px) peek budget so ~32 px of the next column is
     * visible (column dot + first word of header), and we cap the column
     * at 17 rem on mobile (down from 18 rem on desktop) so even devices
     * just under the md breakpoint keep a visible peek.
     */
    @media (max-width: ${breakpoints.md - 1}px) {
        min-width: min(
            ${columnMinWidthRem - 1}rem,
            calc(100vw - ${space.md * 2 + space.md + space.xl}px)
        );
        min-width: min(
            ${columnMinWidthRem - 1}rem,
            calc(100dvw - ${space.md * 2 + space.md + space.xl}px)
        );
        width: min(
            ${columnMinWidthRem - 1}rem,
            calc(100vw - ${space.md * 2 + space.md + space.xl}px)
        );
        width: min(
            ${columnMinWidthRem - 1}rem,
            calc(100dvw - ${space.md * 2 + space.md + space.xl}px)
        );
    }
`;

const TaskContainer = styled.div`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: ${space.xs}px;
    overflow-y: auto;
    padding-bottom: ${space.xs}px;

    [data-rfd-placeholder-context-id] {
        background: ${brand.primaryBg};
        border: 1px dashed var(--ant-color-primary);
        border-radius: ${radius.sm}px;
        box-sizing: border-box;
        min-height: 40px;

        @media (prefers-reduced-motion: reduce) {
            transition: none !important;
        }
    }
`;

const TaskRowDragShell = styled.div`
    width: 100%;

    .task-card-lift-surface {
        transition:
            border-color 120ms ease-out,
            box-shadow 120ms ease-out,
            transform 120ms ease-out;
    }

    &[data-dragging="true"] .task-card-lift-surface {
        box-shadow: ${shadow.lift};

        @media (prefers-reduced-motion: no-preference) {
            transform: scale(1.02);
        }

        @media (prefers-reduced-motion: reduce) {
            transition: none;
        }
    }
`;

const FilteredEmpty = styled.div`
    align-items: center;
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border: 1px dashed var(--ant-color-border-secondary, rgba(15, 23, 42, 0.12));
    border-radius: ${radius.md}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55));
    display: flex;
    flex-direction: column;
    font-size: ${fontSize.xs}px;
    gap: ${space.xxs}px;
    padding: ${space.sm}px ${space.md}px;
    text-align: center;
`;

const FilteredEmptyButton = styled.button`
    background: transparent;
    border: 0;
    border-radius: ${radius.sm}px;
    color: var(--ant-color-primary, #ea580c);
    cursor: pointer;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    padding: ${space.xxs}px ${space.xs}px;

    &:hover {
        background: var(--ant-color-primary-bg, rgba(234, 88, 12, 0.1));
    }

    &:focus-visible {
        background: var(--ant-color-primary-bg, rgba(234, 88, 12, 0.1));
        box-shadow: ${shadow.focus};
        outline: 2px solid transparent;
        outline-offset: 2px;
    }

    /* The "Reset filters" CTA is the recovery path out of an empty filtered
     * column — fingers must land it without zoom. Lift to the 44 px touch
     * floor (Apple HIG, WCAG 2.5.8) on coarse pointers without disturbing the
     * dense desktop rhythm. */
    @media (pointer: coarse) {
        min-height: 44px;
        padding: ${space.xs}px ${space.sm}px;
    }
`;

const TaskCardOuter = styled.button`
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.md}px;
    box-shadow: ${shadow.xs};
    cursor: pointer;
    display: block;
    padding: ${space.sm}px ${space.md}px;
    text-align: left;
    transition:
        border-color 120ms ease-out,
        box-shadow 120ms ease-out,
        transform 120ms ease-out;
    width: 100%;

    &:hover:not(:disabled) {
        /* Restrained hover: a single 1 px brand-accent ring + soft
         * ambient drop. No background gradient — the white card stays
         * white, the brand colour only signals intent at the edge.
         * Uses the palette-derived --glass-border-strong so a palette
         * swap re-tints the ring with no edits here. */
        border-color: var(--glass-border-strong);
        box-shadow:
            ${shadow.md},
            0 0 0 1px var(--glass-border-strong);
        transform: translateY(-1px);
    }

    &:focus-visible {
        border-color: var(--ant-color-primary);
        outline: none;
        box-shadow: ${shadow.focus}, ${shadow.md};
    }

    &:active:not(:disabled) {
        transform: translateY(0);
    }

    &:disabled {
        cursor: default;
        opacity: 0.7;
    }

    /* On touch devices the hover lift feels janky and never triggers; skip
     * it so finger taps don't get a stale outline. */
    @media (hover: none) {
        &:hover:not(:disabled) {
            border-color: var(
                --ant-color-border-secondary,
                rgba(15, 23, 42, 0.06)
            );
            box-shadow: ${shadow.xs};
            transform: none;
        }
    }
`;

const CardTitle = styled.div`
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    display: -webkit-box;
    font-size: ${fontSize.base}px;
    font-weight: ${fontWeight.medium};
    line-height: 1.4;
    margin-bottom: ${space.xs}px;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    /* A 120-char single-token name (URL, commit hash) has no natural break
     * points, so the line-clamp can't truncate and the unbreakable run grows
     * the column past 18rem, distorting the whole kanban. break-word lets the
     * run split mid-character so the clamp engages and the column stays at
     * its min-width. */
    word-break: break-word;
`;

const CardFooter = styled.div`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55));
    display: flex;
    font-size: ${fontSize.xs}px;
    gap: ${space.xs}px;
    justify-content: space-between;
`;

const TaskTypeBadge = styled.span<{ $isBug: boolean }>`
    align-items: center;
    color: ${(p) => (p.$isBug ? "#DB2777" : "#EA580C")};
    display: inline-flex;
    font-weight: ${fontWeight.medium};
    gap: ${space.xxs}px;

    img {
        height: 14px;
        width: 14px;
    }
`;

const CardMeta = styled.span`
    align-items: center;
    display: inline-flex;
    gap: ${space.xs}px;
`;

const StoryPointsTag = styled(Tag)`
    && {
        font-variant-numeric: tabular-nums;
        font-weight: ${fontWeight.semibold};
        margin: 0;
    }
`;

const EpicTag = styled(Tag)`
    && {
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.medium};
        margin-bottom: ${space.xs}px;
        max-width: 100%;
        padding-inline: ${space.xs}px;
        white-space: normal;
        word-break: break-word;
    }
`;

const ColumnHeader = styled(Row)`
    align-items: center;
    margin-bottom: ${space.sm}px;
    padding: ${space.xxs}px ${space.xs}px;

    /*
     * Lift the column-level "more actions" trigger to a 32 × 32 hit target
     * on touch viewports so a thumb can land it without zooming. The icon
     * stays visually small but the surrounding padding grows, satisfying
     * WCAG 2.5.5 (24 × 24 minimum, 44 × 44 recommended on coarse pointers).
     */
    @media (pointer: coarse) {
        > button:last-child,
        > div:last-child > button {
            min-height: 44px;
            min-width: 44px;
        }
    }
`;

const ColumnDragHandleButton = styled.button`
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    cursor: grab;
    display: inline-flex;
    flex: 0 0 auto;
    justify-content: center;
    margin-inline-end: ${space.xxs}px;
    min-height: ${touchTargetMin}px;
    min-width: ${touchTargetMin}px;
    padding: ${space.xxs}px;

    &:active {
        cursor: grabbing;
    }

    &:focus-visible {
        box-shadow: ${shadow.focus};
        outline: 2px solid transparent;
        outline-offset: 2px;
    }

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
`;

const ColumnTitle = styled(Typography.Title)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.semibold};
        letter-spacing: ${letterSpacing.wider};
        margin: 0;
        text-transform: uppercase;
    }
`;

const ColumnDot = styled.span<{ statusColor: string }>`
    background: ${(props) => props.statusColor};
    border-radius: 50%;
    box-shadow: 0 0 0 4px ${(props) => `${props.statusColor}33`};
    display: inline-block;
    flex: 0 0 auto;
    height: 8px;
    width: 8px;
`;

const STATUS_PALETTE = [
    "#94A3B8",
    "#475569",
    "#0EA5E9",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#3B82F6",
    "#F472B6"
] as const;

const dotForColumn = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    return STATUS_PALETTE[Math.abs(hash) % STATUS_PALETTE.length];
};

const DeleteDropDown: React.FC<{ columnId: string; columnName: string }> = ({
    columnId,
    columnName
}) => {
    const { projectId } = useParams<{ projectId: string }>();
    const { mutate: remove } = useReactMutation(
        "boards",
        "DELETE",
        ["boards", { projectId }],
        deleteColumnCallback
    );
    const onDelete = (id: string) => {
        Modal.confirm({
            centered: true,
            okText: microcopy.confirm.deleteColumn.confirmLabel,
            cancelText: microcopy.actions.cancel,
            okButtonProps: { danger: true },
            title: microcopy.confirm.deleteColumn.title,
            content: microcopy.confirm.deleteColumn.description,
            onOk() {
                remove({ columnId: id });
            }
        });
    };
    const items: MenuProps["items"] = [
        {
            key: "delete",
            label: (
                <NoPaddingButton
                    aria-label={formatTemplate(
                        microcopy.a11y.deleteColumnNamed as string,
                        {
                            name: columnName
                        }
                    )}
                    danger
                    disabled={isOptimisticPlaceholderId(columnId)}
                    onClick={() => onDelete(columnId)}
                    size="small"
                    type="text"
                >
                    {microcopy.actions.delete}
                </NoPaddingButton>
            )
        }
    ];
    return (
        <Dropdown menu={{ items }}>
            <NoPaddingButton
                aria-label={formatTemplate(
                    microcopy.a11y.moreActionsForColumn as string,
                    {
                        name: columnName
                    }
                )}
                icon={<MoreOutlined />}
                size="small"
                type="text"
            />
        </Dropdown>
    );
};

type TaskCardProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    task: ITask;
    members: IMember[];
    onOpen?: () => void;
    isMock?: boolean;
};

const TaskCard = React.forwardRef<HTMLButtonElement, TaskCardProps>(
    (
        { task, members, onOpen, isMock, "aria-label": ariaLabel, ...rest },
        ref
    ) => {
        const coordinator = members.find((m) => m._id === task.coordinatorId);
        const isBug = task.type === "Bug";
        // Read per-result strength from the AI search cache (P1-2). Returns
        // null when no semantic filter is active, so the badge stays out of
        // the way during normal browsing.
        const strength = getAiSearchStrength("tasks", task._id);
        return (
            <TaskCardOuter
                aria-label={
                    ariaLabel ??
                    formatTemplate(microcopy.a11y.openTask as string, {
                        name: task.taskName
                    })
                }
                aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
                disabled={isMock}
                onClick={onOpen}
                ref={ref}
                title={microcopy.dragHints.taskCardKeyboard}
                type="button"
                {...rest}
            >
                {task.epic ? (
                    <EpicTag
                        color={isBug ? "magenta" : "geekblue"}
                        variant="filled"
                    >
                        {task.epic}
                    </EpicTag>
                ) : null}
                <CardTitle>{task.taskName}</CardTitle>
                <CardFooter>
                    {/* The label "Bug"/"Task" reads as the visible text and
                     * the icon is decorative, so no Tooltip is needed —
                     * the previous Tooltip duplicated the label and
                     * announced it twice to screen readers. */}
                    <TaskTypeBadge $isBug={isBug}>
                        {/* Explicit width/height attributes lock the badge's
                         * aspect ratio so the card row never shifts while
                         * the SVG asset is loading (CLS red flag, doc §3 —
                         * Layout shift). The styled-component CSS still wins
                         * for visual sizing, but the HTML hint prevents the
                         * brief 0×0 reservation that would otherwise jump
                         * neighbouring cards on slow networks. */}
                        <img
                            alt=""
                            aria-hidden
                            height={14}
                            src={isBug ? bugIcon : taskIcon}
                            width={14}
                        />
                        <span>
                            {isBug
                                ? microcopy.options.taskTypes.bug
                                : microcopy.options.taskTypes.task}
                        </span>
                    </TaskTypeBadge>
                    <CardMeta>
                        {strength ? (
                            <AiMatchStrengthBadge strength={strength} />
                        ) : null}
                        {typeof task.storyPoints === "number" ? (
                            <StoryPointsTag variant="filled">
                                {microcopy.brief.markdownStoryPoints.replace(
                                    "{count}",
                                    String(task.storyPoints)
                                )}
                            </StoryPointsTag>
                        ) : null}
                        {coordinator ? (
                            <Tooltip
                                title={formatTemplate(
                                    microcopy.a11y.assignedTo as string,
                                    {
                                        name: coordinator.username
                                    }
                                )}
                            >
                                <UserAvatar
                                    aria-label={formatTemplate(
                                        microcopy.a11y.assignedTo as string,
                                        {
                                            name: coordinator.username
                                        }
                                    )}
                                    id={coordinator._id}
                                    name={coordinator.username}
                                />
                            </Tooltip>
                        ) : null}
                    </CardMeta>
                </CardFooter>
            </TaskCardOuter>
        );
    }
);

TaskCard.displayName = "TaskCard";

const Column = React.forwardRef<
    HTMLDivElement,
    {
        tasks: ITask[];
        column: IColumn;
        param: TaskSearchParam;
        /** Disables inline task creation while a reorder mutation is in flight. */
        isDragDisabled: boolean;
        /**
         * When set, controls row drag only (e.g. filters active). Defaults to
         * `isDragDisabled` so a single flag still disables both behaviors.
         */
        taskDragDisabled?: boolean;
        boardAiOn?: boolean;
        members?: IMember[];
        onResetFilters?: () => void;
    }
>(
    (
        {
            column,
            param,
            tasks,
            isDragDisabled,
            taskDragDisabled = isDragDisabled,
            boardAiOn = true,
            members = [],
            onResetFilters,
            ...props
        },
        ref
    ) => {
        /*
         * Demonstration callsite for the Phase 3 A2 routed task
         * panel. When `environment.taskPanelRouted` is on, the card
         * click navigates to `/projects/:projectId/board/task/:taskId`
         * (URL state, deep-linkable, browser-back-friendly) via
         * `useTaskPanelNavigation`. When the flag is off, the click
         * dispatches the Redux overlay action through `useTaskModal`
         * exactly as before — this PR only flips ONE callsite so
         * users can toggle the flag and validate both paths end-to-
         * end. The follow-up cleanup PR migrates remaining callsites
         * (palette, triage nudge, AI assist's "open similar task"
         * link) and removes `TaskModal` once validated.
         */
        const { startEditing: openViaModal } = useTaskModal();
        const { openTask: openViaPanel } = useTaskPanelNavigation();
        const startEditing = environment.taskPanelRouted
            ? openViaPanel
            : openViaModal;
        const columnDragHandleProps = useDetachedDragHandleProps();
        const filteredTasks = tasks.filter(
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
        );
        const hasTasksHiddenByFilter =
            tasks.length > 0 && filteredTasks.length === 0;
        return (
            <ColumnContainer {...props} ref={ref}>
                <ColumnHeader between>
                    <span
                        style={{
                            alignItems: "center",
                            display: "inline-flex",
                            gap: space.xs,
                            minWidth: 0
                        }}
                    >
                        {columnDragHandleProps ? (
                            <ColumnDragHandleButton
                                type="button"
                                {...columnDragHandleProps}
                                aria-label={
                                    microcopy.dragHints.columnDragHandle
                                }
                            >
                                <HolderOutlined aria-hidden />
                            </ColumnDragHandleButton>
                        ) : null}
                        <ColumnDot
                            aria-hidden
                            statusColor={dotForColumn(column._id)}
                        />
                        <ColumnTitle level={4}>{column.columnName}</ColumnTitle>
                        <Badge
                            aria-label={`${filteredTasks.length} tasks in ${column.columnName}`}
                            color="default"
                            count={filteredTasks.length}
                            showZero
                            style={{
                                backgroundColor:
                                    "var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.06))",
                                color: "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55))",
                                fontWeight: 600
                            }}
                        />
                    </span>
                    <DeleteDropDown
                        columnId={column._id}
                        columnName={column.columnName}
                    />
                </ColumnHeader>
                <TaskContainer>
                    <Drop
                        type="ROW"
                        direction="vertical"
                        droppableId={String(column._id)}
                    >
                        <DropChild>
                            {filteredTasks.map((task, index) => {
                                const hasPersistedTaskId =
                                    Boolean(task._id) &&
                                    !isOptimisticPlaceholderId(task._id);
                                const taskDragId = task._id
                                    ? `task${task._id}`
                                    : `task-unsaved-${index}`;

                                return (
                                    <Drag
                                        key={task._id || taskDragId}
                                        index={index}
                                        draggableId={taskDragId}
                                        isDragDisabled={
                                            taskDragDisabled ||
                                            !hasPersistedTaskId
                                        }
                                        // TaskCard renders a <button>, which @hello-pangea/dnd
                                        // refuses to drag from by default; opt out of that block.
                                        disableInteractiveElementBlocking
                                    >
                                        <TaskRowDragShell>
                                            <TaskCard
                                                className="task-card-lift-surface"
                                                isMock={!hasPersistedTaskId}
                                                members={members}
                                                onOpen={
                                                    hasPersistedTaskId
                                                        ? () =>
                                                              startEditing(
                                                                  task._id
                                                              )
                                                        : undefined
                                                }
                                                task={task}
                                            />
                                        </TaskRowDragShell>
                                    </Drag>
                                );
                            })}
                            <TaskCreator
                                boardAiOn={boardAiOn}
                                columnId={column._id}
                                disabled={isDragDisabled}
                            />
                            {hasTasksHiddenByFilter ? (
                                <FilteredEmpty aria-live="polite" role="status">
                                    <span>
                                        {microcopy.empty.filteredColumn.title}
                                    </span>
                                    {onResetFilters ? (
                                        <FilteredEmptyButton
                                            onClick={onResetFilters}
                                            type="button"
                                        >
                                            {microcopy.empty.filteredColumn.cta}
                                        </FilteredEmptyButton>
                                    ) : null}
                                </FilteredEmpty>
                            ) : null}
                        </DropChild>
                    </Drop>
                </TaskContainer>
            </ColumnContainer>
        );
    }
);

Column.displayName = "Column";

export default Column;
