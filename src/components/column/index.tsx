import { HolderOutlined, MoreOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Badge,
    Dropdown,
    Input,
    type InputRef,
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
    blur,
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
    touchTargetMin,
    zIndex
} from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import useBoardDensity from "../../utils/hooks/useBoardDensity";
import useColumnReadiness from "../../utils/hooks/useColumnReadiness";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";
import AiMatchStrengthBadge from "../aiMatchStrengthBadge";
import ColumnReadinessPill from "../columnReadinessPill";
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

/**
 * Phase 4.2 — density-driven CSS custom properties. The column reads
 * the user's preference from Redux via `useBoardDensity()` and writes
 * `data-density` on the container; the variables below cascade into
 * every styled-component child without us having to re-thread the
 * density value through props. Comfortable values mirror the legacy
 * tokens (8 / 12 / 16 / 14 px) so the default UI is byte-identical.
 *
 * Density deltas vs. comfortable (legacy) baseline:
 *   - --density-card-padding-y     12 → 8  (−33%)
 *   - --density-card-padding-x     16 → 12 (−25%)
 *   - --density-card-gap            8 → 4  (−50%)
 *   - --density-card-title-mb       8 → 4  (−50%)
 *   - --density-card-title-fs       14 → 13 (−7%)
 *   - --density-card-footer-fs      12 → 11 (−8%)
 *
 * Tightening padding ~25–30% (the brief), title margin & inter-card gap
 * by 50%, and trimming the title down a step gives ~3 more cards per
 * 720 px-tall column without compromising hit targets (the click target
 * is still a 44+px button thanks to the 8 px top/bottom + line-height
 * 1.4 of the title).
 */
export const ColumnContainer = styled.div`
    --density-card-padding-y: ${space.sm}px;
    --density-card-padding-x: ${space.md}px;
    --density-card-gap: ${space.xs}px;
    --density-card-title-mb: ${space.xs}px;
    --density-card-title-fs: ${fontSize.base}px;
    --density-card-footer-fs: ${fontSize.xs}px;

    &[data-density="compact"] {
        --density-card-padding-y: ${space.xs}px;
        --density-card-padding-x: ${space.sm}px;
        --density-card-gap: ${space.xxs}px;
        --density-card-title-mb: ${space.xxs}px;
        --density-card-title-fs: ${fontSize.sm}px;
        --density-card-footer-fs: 11px;
    }

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

/**
 * The column's vertical scroll context. The ColumnHeader lives *inside*
 * this container as its first child so `position: sticky` on the header
 * pins it against this exact scroll port; if the header were a sibling
 * outside, sticky would degenerate to plain relative because the
 * nearest scroll ancestor would be the page itself (or the BoardShell
 * flex item, which doesn't scroll).
 *
 * `display: flex; flex-direction: column; gap: ${space.xs}` preserves
 * the original 8-px rhythm between every task card. The header used to
 * carry its own `margin-bottom: ${space.sm}` (12 px) as a sibling
 * above; that's dropped now that the flex gap supplies the 8-px
 * separator between the header and the first card. Net visual delta
 * is 4 px tighter — well within the "calm board" rhythm.
 */
const TaskContainer = styled.div`
    display: flex;
    flex: 1;
    flex-direction: column;
    /* Density: var falls back to the legacy 8 px (space.xs) rhythm. */
    gap: var(--density-card-gap, ${space.xs}px);
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
    /* Density-driven padding. Comfortable resolves the var to the
     * legacy 12 / 16 px (space.sm / space.md) rhythm; compact tightens
     * to 8 / 12 px (~33% / 25% reduction). The fallback after the
     * comma keeps a card rendered outside the ColumnContainer (e.g.
     * the storybook in column-dnd.test) looking like before. */
    padding: var(--density-card-padding-y, ${space.sm}px)
        var(--density-card-padding-x, ${space.md}px);
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
    /* Density-driven title size — comfortable resolves to 14 px
     * (legacy), compact to 13 px (fontSize.sm). */
    font-size: var(--density-card-title-fs, ${fontSize.base}px);
    font-weight: ${fontWeight.medium};
    line-height: 1.4;
    margin-bottom: var(--density-card-title-mb, ${space.xs}px);
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    /* Inline-edit Input (Wave 3) needs to mirror the title's density —
     * AntD's default Input padding/font ignore the surrounding CSS
     * custom properties, so without this override the edit affordance
     * stays comfortable-sized even when the board is compact. The
     * size="small" prop already trims AntD's vertical padding; we
     * just need to align the font with the title above it. */
    & .ant-input {
        font-size: var(--density-card-title-fs, ${fontSize.base}px);
        line-height: 1.4;
    }
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
    /* Density: 12 px (comfortable) / 11 px (compact). */
    font-size: var(--density-card-footer-fs, ${fontSize.xs}px);
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

/**
 * Column header — sticky-pinned against the parent TaskContainer so a
 * user scrolling a tall task list always sees the column name + count
 * + readiness pill + more-actions menu. Phase 4.6 of `ui-todo.md`.
 *
 * `position: sticky` requires a positioned ancestor that scrolls; the
 * direct parent (`TaskContainer`) is `overflow-y: auto` so the header
 * snaps to its top edge.
 *
 * `z-index: ${zIndex.sticky}` (10) sits above every task card (which
 * paint at the default `0`) so card text never bleeds through the
 * header during the cross-fade as a card scrolls beneath it. The pill's
 * AntD Popover (`zIndex.dropdown` = 1050) and the more-actions Dropdown
 * (same) both ride well above the sticky tier, so neither clips behind
 * the header — verified by the contract test in `index.test.tsx`.
 *
 * The dnd drag clone is painted at z-index 5000 on `document.body` via
 * React's createPortal (see `tokens.ts` § dndDragClone), so a card in
 * flight always paints over this header on every browser including iOS.
 *
 * `backdrop-filter: blur(${blur.sm}px)` adds a soft frost so task text
 * scrolling underneath gets a subtle smear instead of a hard crop;
 * paired with a translucent background tint so the header reads as a
 * pane, not a hole. Both fall back gracefully on `forced-colors` /
 * `prefers-reduced-transparency` (the browser drops backdrop-filter
 * and we paint the page background underneath).
 */
const ColumnHeader = styled(Row)`
    align-items: center;
    /*
     * Solid-ish pane that lets a touch of the column's fill-quaternary
     * tint show through. Falls back to the column's own background
     * (set at the ColumnContainer level) on browsers that don't
     * support backdrop-filter (no blur, no shimmer — still readable).
     */
    background: var(--ant-color-bg-container, rgba(255, 255, 255, 0.86));
    /* Pull the sticky bg inside the column's own rounded corner so the
     * header doesn't paint past the column's radius when pinned. */
    border-radius: ${radius.sm}px;
    backdrop-filter: saturate(180%) blur(${blur.sm}px);
    -webkit-backdrop-filter: saturate(180%) blur(${blur.sm}px);
    padding: ${space.xxs}px ${space.xs}px;
    position: sticky;
    top: 0;
    /*
     * zIndex.sticky (= 10) — above task cards (which paint at the
     * default z-index 0), below all AntD overlays (Dropdown / Popover
     * ride at 1050+) so the readiness-pill popover and column-actions
     * dropdown render above this header without a stacking-context
     * trap. The dnd drag clone (z-index 5000 via body portal) also
     * paints above this, so a dragged card stays visible while
     * crossing the pinned header.
     */
    z-index: ${zIndex.sticky};

    /*
     * Honour the user's reduced-transparency preference: collapse the
     * frosted backdrop to a solid surface so the column doesn't look
     * smeared in environments that disable transparency (Windows
     * high-contrast, macOS "Reduce Transparency"). Mirrors the recipe
     * the main page header uses.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--ant-color-bg-container, #ffffff);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }

    /*
     * Forced-colors mode (Windows high-contrast) replaces every author
     * colour with system tokens. Drop the translucent background so the
     * system colour wins; keep the sticky positioning intact because
     * pinning the header is still useful in high-contrast.
     */
    @media (forced-colors: active) {
        background: Canvas;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }

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
        const { projectId } = useParams<{ projectId: string }>();
        const coordinator = members.find((m) => m._id === task.coordinatorId);
        const isBug = task.type === "Bug";
        // Read per-result strength from the AI search cache (P1-2). Returns
        // null when no semantic filter is active, so the badge stays out of
        // the way during normal browsing.
        const strength = getAiSearchStrength("tasks", task._id);
        /*
         * Inline-edit title (Phase 4.5 of `docs/todo/ui-todo.md`):
         * double-click the title to swap it for an Input that mutates the
         * task in place. We reuse the SAME ``tasks PUT`` mutation that
         * `taskModal` uses so optimistic update + cache invalidation work
         * identically across both surfaces — the rename flows through
         * `/api/v1/tasks` like any modal save.
         *
         * Why double-click instead of single-click? Single-click is
         * already bound to "open the task" (modal or routed panel). The
         * cross-cutting `e` shortcut in `docs/todo/ui-todo.md` §2.A.9
         * also opens the modal, so trading "e" for inline-rename would
         * silently break a global affordance. Double-click is a Linear /
         * Notion / GitHub project convention for "I meant the title,
         * not the row," so users familiar with those tools find it
         * intuitively.
         *
         * Why blur → commit? Two reasons. (1) Linear is the dominant
         * convention for task-card inline edits, and committing on blur
         * matches the user's mental model of "I clicked away, save what
         * I typed." (2) The alternative — revert on blur — silently
         * eats typed edits when the user thinks they've already
         * committed; that's a worse failure mode than an accidental
         * commit (Enter / Esc are both available to disambiguate
         * deliberately).
         */
        const { mutate: updateTask, isLoading: isUpdating } = useReactMutation(
            "tasks",
            "PUT",
            ["tasks", { projectId }]
        );
        const [editing, setEditing] = React.useState(false);
        const [draft, setDraft] = React.useState(task.taskName);
        const cardRef = React.useRef<HTMLButtonElement | null>(null);
        const inputRef = React.useRef<InputRef | null>(null);
        /*
         * Browsers fire `click → click → dblclick` for a real
         * double-click. Stopping propagation on `dblclick` alone is
         * not enough — both preceding `click` events would still
         * bubble to TaskCardOuter and trigger `onOpen()`, opening
         * the modal underneath the inline-edit Input. We defer the
         * outer-card open by ~250 ms; if a `dblclick` lands inside
         * that window, `enterEditing` cancels the pending timer and
         * the modal never fires. The timeout id is kept in a ref so
         * the cancellation path can find it across renders.
         *
         * 250 ms matches the OS-level dblclick threshold on macOS /
         * Windows (Linear / Notion use the same envelope). Lower
         * values race against slow-finger users; higher values add
         * perceptible lag to a plain single click.
         */
        const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
            null
        );
        // Cancel any pending open timer on unmount so we don't open
        // a modal for a card that has scrolled out of the column.
        React.useEffect(
            () => () => {
                if (openTimerRef.current !== null) {
                    clearTimeout(openTimerRef.current);
                    openTimerRef.current = null;
                }
            },
            []
        );
        // Bridge the outer forwardRef to our local cardRef so we can
        // restore focus on commit/revert without losing parent-supplied
        // refs (react-router, dnd, etc.).
        const setCardRef = React.useCallback(
            (node: HTMLButtonElement | null) => {
                cardRef.current = node;
                if (typeof ref === "function") ref(node);
                else if (ref) {
                    (
                        ref as React.MutableRefObject<HTMLButtonElement | null>
                    ).current = node;
                }
            },
            [ref]
        );
        /*
         * Sync `draft` to upstream renames (server roundtrip finishes,
         * react-query refetch, or another client edits the same task).
         * Compare against the source of truth — `task.taskName` — and
         * only mirror it back into the draft when the user is NOT
         * actively editing, otherwise we'd clobber in-flight keystrokes.
         */
        React.useEffect(() => {
            if (!editing) setDraft(task.taskName);
        }, [editing, task.taskName]);
        const exitEditing = React.useCallback(
            (opts?: { restoreFocus?: boolean }) => {
                setEditing(false);
                if (opts?.restoreFocus !== false) {
                    // Defer until after the Input has unmounted so React
                    // doesn't fight the focus-on-mount of the next card
                    // when the user tabs away.
                    queueMicrotask(() => cardRef.current?.focus());
                }
            },
            []
        );
        const commitDraft = React.useCallback(() => {
            const trimmed = draft.trim();
            // No-op commit when the trimmed value equals the current
            // server value — saves a request AND avoids react-query
            // invalidating a list that didn't actually change.
            if (!trimmed || trimmed === task.taskName) {
                exitEditing();
                return;
            }
            updateTask({ ...task, taskName: trimmed });
            exitEditing();
        }, [draft, exitEditing, task, updateTask]);
        const revertDraft = React.useCallback(() => {
            setDraft(task.taskName);
            exitEditing();
        }, [exitEditing, task.taskName]);
        const enterEditing = React.useCallback(
            (event: React.MouseEvent<HTMLDivElement>) => {
                // Double-click on the title — stop propagation so the
                // outer `onClick={onOpen}` doesn't also fire and open
                // the modal underneath our Input. Stopping propagation
                // suppresses the `dblclick` bubble; the click-timer
                // cancellation below handles the two preceding `click`
                // events that already fired before this handler runs.
                event.stopPropagation();
                if (openTimerRef.current !== null) {
                    clearTimeout(openTimerRef.current);
                    openTimerRef.current = null;
                }
                if (isMock) return;
                setDraft(task.taskName);
                setEditing(true);
                // Defer the focus so AntD Input's own autoFocus path
                // has time to mount the underlying <input>.
                queueMicrotask(() =>
                    inputRef.current?.focus({ cursor: "all" })
                );
            },
            [isMock, task.taskName]
        );
        /*
         * Outer card click → deferred `onOpen`. The first `click` of
         * a real double-click sequence lands here ~10–30 ms before
         * the matching `dblclick` reaches `enterEditing` on the
         * title; the 250 ms timer gives `enterEditing` a window to
         * cancel before the modal opens. A plain single click
         * resolves the timer normally — there's a ~250 ms perceived
         * lag, but it sits below the 300 ms threshold most users
         * register as "delayed" and matches Linear's behaviour for
         * card rows that support inline edit.
         */
        const handleCardClick = React.useCallback(() => {
            if (!onOpen) return;
            if (openTimerRef.current !== null) {
                clearTimeout(openTimerRef.current);
            }
            openTimerRef.current = setTimeout(() => {
                openTimerRef.current = null;
                onOpen();
            }, 250);
        }, [onOpen]);
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
                onClick={handleCardClick}
                ref={setCardRef}
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
                {editing ? (
                    <CardTitle
                        // The Input is a button child — every pointer/
                        // key event has to be quarantined or the parent
                        // <button> would treat typing as a click and
                        // open the modal underneath. The CardTitle is
                        // already non-interactive so wrapping the Input
                        // in it preserves the card's vertical rhythm.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <Input
                            aria-label={microcopy.a11y.renameTask as string}
                            autoFocus
                            data-testid="task-card-title-input"
                            disabled={isUpdating}
                            onBlur={commitDraft}
                            onChange={(e) => setDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            /*
                             * Enter / Esc are handled in `onKeyDown`
                             * rather than AntD's `onPressEnter` so a
                             * single commit fires per keypress — using
                             * both raises the mutation twice on the same
                             * Enter event.
                             */
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitDraft();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    revertDraft();
                                }
                            }}
                            ref={inputRef}
                            size="small"
                            value={draft}
                        />
                    </CardTitle>
                ) : (
                    <CardTitle
                        data-testid="task-card-title"
                        onDoubleClick={enterEditing}
                    >
                        {task.taskName}
                    </CardTitle>
                )}
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

/**
 * Column props extend the native `<div>` HTML attributes so the
 * Drag wrapper (which spreads its `draggableProps` / `dragHandleProps`
 * onto the cloned child) and the BoardMinimap (which threads a
 * `data-minimap-column-id` identifier through for its in-view lookup)
 * can both attach data-attrs without per-attr forwarding plumbing.
 */
type ColumnComponentProps = React.HTMLAttributes<HTMLDivElement> & {
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
};

const Column = React.forwardRef<HTMLDivElement, ColumnComponentProps>(
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
        /*
         * Phase 4.2 — apply the user's board-density preference as a
         * `data-density` data-attr on `ColumnContainer`. The styled
         * component above writes the density-aware CSS custom
         * properties under `&[data-density="compact"]`; reading the
         * hook here lets the CSS cascade do the rest without
         * threading the value through every styled child. The hook
         * subscribes to Redux so a toggle in `taskSearchPanel`
         * re-renders every column in lockstep.
         */
        const { density } = useBoardDensity();
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
        /*
         * Column-readiness batch (Phase 4 W3). Runs the deterministic
         * readiness engine over the (unfiltered) task list — the score
         * is a property of the column's actual work, not of whatever
         * filter the user has typed into the search bar. The hook
         * short-circuits to a neutral report when the env flag is off,
         * and `<ColumnReadinessPill>` renders nothing for the neutral
         * state, so the header stays empty by default.
         */
        const readinessReport = useColumnReadiness({
            tasks,
            columnId: column._id,
            enabled: environment.aiColumnReadinessEnabled
        });
        return (
            <ColumnContainer data-density={density} {...props} ref={ref}>
                {/*
                 * Phase 4.6 — the ColumnHeader is now rendered *inside*
                 * TaskContainer so its `position: sticky` pins against
                 * that scroll port. As a sibling it would have
                 * degenerated to plain relative (no nearest scrollable
                 * ancestor) and not stuck at all.
                 */}
                <TaskContainer data-testid="column-task-container">
                    <ColumnHeader between data-testid="column-header">
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
                            <ColumnTitle level={4}>
                                {column.columnName}
                            </ColumnTitle>
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
                            <ColumnReadinessPill report={readinessReport} />
                        </span>
                        <DeleteDropDown
                            columnId={column._id}
                            columnName={column.columnName}
                        />
                    </ColumnHeader>
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
