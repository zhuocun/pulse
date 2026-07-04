import {
    CheckCircleFilled,
    ClockCircleOutlined,
    FlagFilled,
    HolderOutlined,
    MoreOutlined,
    StopOutlined,
    WarningFilled
} from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Badge,
    Checkbox,
    Dropdown,
    Input,
    InputNumber,
    type InputRef,
    MenuProps,
    Modal,
    Select,
    Tag,
    Tooltip,
    Typography
} from "antd";
import dayjs from "dayjs";
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
    touchTargetMin,
    zIndex
} from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import { labelTagProps } from "../../utils/labelTagColor";
import normalizeTaskType from "../../utils/normalizeTaskType";
import useBoardDensity from "../../utils/hooks/useBoardDensity";
import useBulkSelection from "../../utils/hooks/useBulkSelection";
import useColumnReadiness from "../../utils/hooks/useColumnReadiness";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import newColumnCallback from "../../utils/optimisticUpdate/createColumn";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";
import updateColumnCallback from "../../utils/optimisticUpdate/updateColumn";
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

const TaskCardOuter = styled.button<{
    $dragDisabledByFilters?: boolean;
    $selectable?: boolean;
}>`
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.md}px;
    box-shadow: ${shadow.xs};
    /*
     * not-allowed signals that reordering is paused while filters are
     * active; the card itself stays clickable to open the task.
     */
    cursor: ${({ $dragDisabledByFilters }) =>
        $dragDisabledByFilters ? "not-allowed" : "pointer"};
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

    @media (pointer: coarse) {
        ${({ $selectable }) =>
            $selectable
                ? `
            padding-left: calc(${space.xs}px + ${touchTargetCoarse}px);
            padding-top: calc(${space.xs}px + ${touchTargetCoarse}px);
        `
                : ""}
    }
`;

/**
 * Wrapper that hosts the multi-select checkbox alongside the card button
 * (PRD-GAP-008). A native checkbox cannot live INSIDE the `<button>` card
 * (invalid HTML + the dnd library blocks drags off interactive elements),
 * so the checkbox is a sibling overlay and this relative shell positions
 * it over the card's top-left corner. Rendered only under a
 * `BulkSelectionProvider`; without one the card returns the bare button.
 */
const SelectableShell = styled.div`
    position: relative;
    width: 100%;

    &:hover [data-select-slot],
    &:focus-within [data-select-slot] {
        opacity: 1;
    }
`;

/**
 * Selection checkbox overlay. Hidden by default and revealed on
 * hover / keyboard focus of the card, or whenever the card is selected, so
 * the calm board isn't littered with checkboxes at rest. On coarse pointers
 * (no hover) it is always visible and lifts to a 44 px hit target (WCAG
 * 2.5.8). The wrapping click/mousedown guards stop the toggle from also
 * opening the task or starting a drag.
 */
const SelectionCheckboxSlot = styled.span<{ $selected: boolean }>`
    align-items: center;
    background: var(--ant-color-bg-container, #fff);
    border-radius: ${radius.sm}px;
    display: inline-flex;
    justify-content: center;
    left: ${space.xs}px;
    opacity: ${(p) => (p.$selected ? 1 : 0)};
    padding: 2px;
    position: absolute;
    top: ${space.xs}px;
    transition: opacity 120ms ease-out;
    z-index: 2;

    @media (pointer: coarse) {
        align-items: center;
        justify-content: center;
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
        opacity: 1;
        padding: 0;

        /* Stretch the AntD checkbox's clickable label to fill the whole
         * 44 x 44 slot so the tap target matches the visible hit area —
         * the bare checkbox glyph is only ~22 x 24 px, well under the
         * WCAG 2.5.8 floor. The glyph stays centred; only the label's
         * hit region grows. */
        .ant-checkbox-wrapper {
            align-items: center;
            height: 100%;
            justify-content: center;
            width: 100%;
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
    color: ${(p) =>
        p.$isBug ? "#DB2777" : "var(--pulse-brand-primary, #EA580C)"};
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
 * Row of label chips above the card title. Wraps so a task with several
 * labels stacks cleanly inside the column width instead of overflowing.
 */
const LabelRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
    margin-bottom: ${space.xs}px;
`;

const LabelChip = styled(Tag)`
    && {
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.medium};
        margin: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

/**
 * Overdue indicator on the card footer. Deliberately NOT colour-only: it
 * pairs a clock glyph with the visible word "Overdue" (and an aria-label
 * carrying the missed due date) so it reads for colour-blind and
 * screen-reader users alike (WCAG 1.4.1). The danger tint is a secondary,
 * reinforcing signal — never the sole carrier of meaning.
 */
const OverdueChip = styled.span`
    align-items: center;
    color: var(--ant-color-error, #dc2626);
    display: inline-flex;
    font-weight: ${fontWeight.semibold};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * WIP-limit display on the column header (PRD §5.5). Renders the live
 * count against the column's `wipLimit` as a compact `{count} / {limit}`
 * chip. The chip itself is a neutral count read-out; the over-limit ALARM
 * is carried by the separate `OverLimitChip` below (a glyph + visible word),
 * so the indicator is never colour-only (WCAG 1.4.1, matching the overdue
 * chip). Only rendered when `wipLimit > 0` — a `0` limit means "no limit".
 */
const WipLimitBadge = styled.span<{ $over: boolean }>`
    align-items: center;
    color: ${(p) =>
        p.$over
            ? "var(--ant-color-error, #dc2626)"
            : "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55))"};
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-variant-numeric: tabular-nums;
    font-weight: ${(p) => (p.$over ? fontWeight.semibold : fontWeight.medium)};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * Over-limit indicator on the column header (PRD §5.5). Deliberately NOT
 * colour-only: a warning glyph pairs with the visible word "Over limit" and
 * an `aria-label` carrying the count / limit / overflow so the signal reads
 * for colour-blind and screen-reader users alike (WCAG 1.4.1) — the exact
 * recipe the card's `OverdueChip` uses. Rendered only when the column's task
 * count strictly exceeds a positive `wipLimit`.
 */
const OverLimitChip = styled.span`
    align-items: center;
    color: var(--ant-color-error, #dc2626);
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * Priority indicator on the card footer (PRD §3.4). Like `OverdueChip`, it is
 * deliberately NOT colour-only: a flag glyph pairs with the visible priority
 * label and an `aria-label` so the signal reads for colour-blind and
 * screen-reader users alike (WCAG 1.4.1). The tint is a secondary, reinforcing
 * cue that scales with urgency. `priority === "none"` (or absent) renders
 * nothing — the badge only appears once a task is deliberately prioritised.
 */
const PriorityBadge = styled.span<{ $tint: string }>`
    align-items: center;
    color: ${(p) => p.$tint};
    display: inline-flex;
    font-weight: ${fontWeight.semibold};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * Per-priority tint, escalating low → urgent. `none` is absent from the map
 * because that branch renders no badge at all. The glyph is identical across
 * levels (a flag); the visible label + aria-label disambiguate, so colour is
 * never the sole carrier of meaning.
 */
const PRIORITY_TINT: Record<Exclude<TaskPriorityLevel, "none">, string> = {
    low: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))",
    medium: "var(--ant-color-info, #2563eb)",
    // `--ant-color-warning` (#F59E0B) reads at ~2.2:1 on the white card;
    // `--pulse-priority-high` is the AA-safe, mode-aware amber (see cssVars).
    high: "var(--pulse-priority-high, #b45309)",
    urgent: "var(--ant-color-error, #dc2626)"
};

/**
 * Blocked indicator on the card footer (PRD §4.5). Like `PriorityBadge` and
 * `OverdueChip`, it is deliberately NOT colour-only: a stop glyph pairs with
 * the visible "Blocked" label and an `aria-label` so the signal reads for
 * colour-blind and screen-reader users alike (WCAG 1.4.1). The badge renders
 * only when the server-derived `task.blockedBy` array is non-empty — i.e. the
 * task has ≥1 unfinished prerequisite — so a task with no dependencies (or one
 * whose prerequisites are all done) shows nothing.
 */
const BlockedBadge = styled.span`
    align-items: center;
    color: var(--ant-color-error, #dc2626);
    display: inline-flex;
    font-weight: ${fontWeight.semibold};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * Completed indicator on the card footer (PRD §3 lifecycle). Like its sibling
 * badges it is NOT colour-only: a filled check glyph pairs with the visible
 * "Completed" label and a dated `aria-label` so the signal reads for colour-
 * blind and screen-reader users alike (WCAG 1.4.1). The badge renders only
 * when the server-managed `task.completedAt` is set — i.e. the task currently
 * sits in a done-category column; the server clears the field the moment the
 * task leaves, so the card and the badge stay in lockstep. A completed task
 * supersedes the "Blocked"/"Overdue" chips (a finished task is neither), so
 * those are gated off below when `completed` is true.
 */
const CompletedBadge = styled.span`
    align-items: center;
    color: var(--ant-color-success, #16a34a);
    display: inline-flex;
    font-weight: ${fontWeight.semibold};
    gap: ${space.xxs}px;
    white-space: nowrap;
`;

/**
 * Milestone indicator on the card footer (PRD milestones). Unlike the
 * priority / overdue / blocked chips it is NOT an alarm — a milestone is a
 * neutral planning grouping, so it uses a restrained secondary tint (no
 * danger / warning colour). A flag glyph pairs with the visible milestone
 * name and an `aria-label` so the signal still reads for colour-blind and
 * screen-reader users alike (WCAG 1.4.1). The badge renders only when
 * `task.milestoneId` resolves against a passed milestone — an unset or
 * dangling id shows nothing (see the gate on the card). The name can be
 * long, so it truncates with an ellipsis rather than wrapping the footer.
 */
const MilestoneBadge = styled.span`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55));
    display: inline-flex;
    font-weight: ${fontWeight.medium};
    gap: ${space.xxs}px;
    max-width: 12ch;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;

    > span {
        overflow: hidden;
        text-overflow: ellipsis;
    }
`;

/**
 * Overdue rule: the task carries a `dueDate` whose LOCAL calendar date is
 * strictly before today. We compare date-only (`YYYY-MM-DD`), matching the
 * lens predicates, so a task due "today" is NOT overdue and a midnight-
 * straddling timestamp can't flip the verdict by timezone. A task with no
 * `dueDate` (or an unparsable one) is never overdue. Done-column semantics
 * aren't modeled on `IColumn` (no `isDone` flag), so we use the brief's
 * simpler date-only rule.
 */
const isTaskOverdue = (
    dueDate: string | null | undefined,
    now: Date = new Date()
): boolean => {
    if (!dueDate) return false;
    const due = dayjs(dueDate);
    if (!due.isValid()) return false;
    return due.startOf("day").isBefore(dayjs(now).startOf("day"));
};

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
 * backdrop-filter: var(--ant-backdrop-filter-glass) adds a soft
 * frost so task text scrolling underneath gets a subtle smear
 * instead of a hard crop (Wave 2 T4 — was the literal blur.sm
 * recipe before the global intensity migration);
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
    /*
     * Phase 6 W1 — iOS 26 concentricity: the sticky header sits flush
     * against the ColumnContainer's inner padding edge (top: 0 inside
     * TaskContainer, which itself sits inside ColumnContainer's
     * padding: space.sm = 12 px). The container's outer corner is
     * radius.lg (14 px); the concentric inner radius is therefore
     * 14 − 12 = 2 px so the header's rounded corners trace the
     * ColumnContainer's inner curve instead of pinching it. Previously
     * shipped at radius.sm (6 px), which read as a 4 px flared corner
     * against the container's rounded edge.
     */
    border-radius: 2px;
    /* Wave 2 T4 — consume the SUBTLE intensity-toggle var. The column
     * header is sticky over dense scrolling tasks; the original 12 px
     * blur kept text legible underneath. The subtle var defaults to
     * the same 12 px / 180% recipe but scales down under "clear" and
     * to none under "solid" so the user toggle still reaches this
     * surface. Three-var system reconciles parity (12 px today) with
     * the global lever (toggle works). */
    backdrop-filter: var(--ant-backdrop-filter-glass-subtle);
    -webkit-backdrop-filter: var(--ant-backdrop-filter-glass-subtle);
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
     * Phase 5 "Liquid Glass" Wave 2 — top-leading specular rim. The
     * column header is sticky inside the column's scroll port, so the
     * highlight rides with the pinned pane and reads as the same
     * tilted glass edge whether the column is scrolled or at rest.
     * No scroll-edge dissolve here — the column scroll port already
     * carries its own edge fade in board.tsx, so adding one here
     * would double-feather the boundary.
     *
     * No gel-flex on the children either: the column-name (inline
     * edit) and more-actions trigger don't follow the press-flex
     * interaction model — they're editing / popover triggers — and
     * the ColumnDragHandleButton lives inside @hello-pangea/dnd's
     * transform tree, so a scale-on-press would fight the drag
     * transform.
     */
    &::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-top);
        pointer-events: none;
        z-index: 0;
    }

    &::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--glass-specular-bottom);
        pointer-events: none;
        z-index: 0;
    }

    /*
     * Children sit above the rim pseudo-elements. The header's two
     * direct children (the title cluster span + DeleteDropDown) lift
     * onto z-index 1 so the rim paints behind, not over.
     */
    > * {
        position: relative;
        z-index: 1;
    }

    /*
     * Honour the user's reduced-transparency preference: collapse the
     * frosted backdrop to a solid surface so the column doesn't look
     * smeared in environments that disable transparency (Windows
     * high-contrast, macOS "Reduce Transparency"). Mirrors the recipe
     * the main page header uses. Drop the rim too — the achromatic
     * highlight reads as noise on an opaque body.
     */
    @media (prefers-reduced-transparency: reduce) {
        background: var(--ant-color-bg-container, #ffffff);
        backdrop-filter: none;
        -webkit-backdrop-filter: none;

        &::before,
        &::after {
            background: none;
        }
    }

    /*
     * Forced-colors mode (Windows high-contrast) replaces every author
     * colour with system tokens. Drop the translucent background so the
     * system colour wins; keep the sticky positioning intact because
     * pinning the header is still useful in high-contrast. Drop the
     * rim layers so they don't compete with Canvas / CanvasText.
     */
    @media (forced-colors: active) {
        background: Canvas;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;

        &::before,
        &::after {
            background: none;
        }
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
        letter-spacing: ${letterSpacing.wide};
        margin: 0;
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

// Column "done" categories shown in the edit picker — same source of truth
// the creator uses. Listed explicitly so the order is stable across renders.
const COLUMN_CATEGORY_OPTIONS: NonNullable<IColumn["category"]>[] = [
    "todo",
    "in_progress",
    "done"
];

/**
 * Column-edit modal (PRD §5.5 — the first real settings surface for
 * `columnName`, `category`, and `wipLimit`). The board PUT accepts exactly
 * `{columnName, wipLimit, category}` keyed by `_id`; we send all three so a
 * single save can rename, re-categorise, and re-cap the column. The optimistic
 * `updateColumnCallback` patches the cached column instantly and
 * `useReactMutation` rolls back on error. `wipLimit` is a non-negative int
 * (`0` = no limit, AC-C11), matched by the `InputNumber` `min={0}`.
 */
const ColumnEditModal: React.FC<{
    column: IColumn;
    open: boolean;
    onClose: () => void;
}> = ({ column, open, onClose }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const { mutate: update, isLoading } = useReactMutation(
        "boards",
        "PUT",
        ["boards", { projectId }],
        updateColumnCallback
    );
    const [name, setName] = React.useState(column.columnName);
    const [category, setCategory] = React.useState<
        NonNullable<IColumn["category"]>
    >(column.category ?? "todo");
    const [wipLimit, setWipLimit] = React.useState<number>(
        column.wipLimit ?? 0
    );
    // Re-seed the form from the column whenever the modal (re)opens so a
    // cancelled edit never leaks a stale draft into the next open.
    React.useEffect(() => {
        if (open) {
            setName(column.columnName);
            setCategory(column.category ?? "todo");
            setWipLimit(column.wipLimit ?? 0);
        }
    }, [open, column.columnName, column.category, column.wipLimit]);
    const trimmed = name.trim();
    const onSave = () => {
        if (!trimmed) return;
        update({
            _id: column._id,
            columnName: trimmed,
            category,
            wipLimit
        });
        onClose();
    };
    return (
        <Modal
            centered
            confirmLoading={isLoading}
            okButtonProps={{ disabled: !trimmed }}
            okText={microcopy.actions.save}
            cancelText={microcopy.actions.cancel}
            onCancel={onClose}
            onOk={onSave}
            open={open}
            title={microcopy.column.editTitle}
        >
            <label
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: space.xxs,
                    marginBottom: space.sm
                }}
            >
                <span>{microcopy.a11y.newColumnName}</span>
                <Input
                    aria-label={microcopy.a11y.newColumnName}
                    autoComplete="off"
                    autoFocus
                    enterKeyHint="done"
                    inputMode="text"
                    onChange={(e) => setName(e.target.value)}
                    onPressEnter={onSave}
                    value={name}
                />
            </label>
            <label
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: space.xxs,
                    marginBottom: space.sm
                }}
            >
                <span>{microcopy.a11y.newColumnCategory}</span>
                <Select<NonNullable<IColumn["category"]>>
                    aria-label={microcopy.a11y.newColumnCategory}
                    onChange={setCategory}
                    options={COLUMN_CATEGORY_OPTIONS.map((value) => ({
                        label: microcopy.options.columnCategories[value],
                        value
                    }))}
                    value={category}
                />
            </label>
            <label
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: space.xxs
                }}
            >
                <span>{microcopy.fields.wipLimit}</span>
                <InputNumber
                    aria-label={microcopy.fields.wipLimit}
                    inputMode="numeric"
                    min={0}
                    onChange={(value) =>
                        setWipLimit(typeof value === "number" ? value : 0)
                    }
                    step={1}
                    style={{ width: "100%" }}
                    value={wipLimit}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {microcopy.column.wipLimitHelp}
                </Typography.Text>
            </label>
        </Modal>
    );
};

const DeleteDropDown: React.FC<{
    columnId: string;
    columnName: string;
    /** Full column snapshot — captured so Undo can re-create it. */
    column: IColumn;
    /**
     * Whether the column currently holds any tasks. Column deletion
     * cascades server-side (`board_service.delete` runs
     * `delete_many(TASKS, { columnId })`) and the re-create POST mints a
     * fresh column without those tasks — so a non-empty column delete has
     * no honorable inverse. We gate on this to keep the §2.A.4 contract
     * honest: empty columns get the optimistic-delete + Undo toast;
     * non-empty columns fall back to a Modal.confirm (same reasoning that
     * keeps project deletion on Modal.confirm).
     */
    hasTasks: boolean;
}> = ({ columnId, columnName, column, hasTasks }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const { mutate: remove } = useReactMutation(
        "boards",
        "DELETE",
        ["boards", { projectId }],
        deleteColumnCallback,
        // Suppress useReactMutation's auto-revert toast; the toast+Undo
        // surface below owns the user-visible feedback for this delete.
        () => {}
    );
    // Companion POST mutation used purely as the Undo closure: it
    // re-creates the just-deleted column with the captured snapshot so an
    // accidental delete is recoverable. Fire-and-forget — the empty
    // onError keeps useReactMutation's auto-toast suppressed because the
    // user already initiated the Undo deliberately.
    const { mutateAsync: undoDelete } = useReactMutation(
        "boards",
        "POST",
        ["boards", { projectId }],
        newColumnCallback,
        () => {}
    );
    const { show: showUndoToast } = useUndoToast();
    const [editOpen, setEditOpen] = React.useState(false);
    const onDelete = (id: string) => {
        if (hasTasks) {
            // Non-empty column: the server cascade-deletes every task in
            // the column and re-create cannot restore them, so an Undo we
            // can't honor would lie to the user. Confirm instead (§2.A.4 —
            // Modal.confirm is reserved for irreversible operations).
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
            return;
        }
        // Capture the full column payload BEFORE removal so the Undo
        // closure can POST it back. After the optimistic prune the cache
        // no longer carries it.
        const beforeState = column;
        // Empty column — the delete is reversible (nothing cascades), so
        // optimistic delete + Undo toast (§2.A.4), no Modal.confirm.
        remove({ columnId: id });
        showUndoToast({
            description: microcopy.feedback.columnDeleted,
            analyticsTag: "column.delete",
            // The optimistic delete prunes this column from the board, so
            // this Column instance unmounts on the same action; keep the
            // toast alive past unmount so the user still gets their Undo
            // window. The inverse re-create runs through the persistent
            // react-query client.
            dismissOnUnmount: false,
            undo: async () => {
                await undoDelete(
                    beforeState as unknown as Record<string, unknown>
                );
            }
        });
    };
    const items: MenuProps["items"] = [
        {
            key: "edit",
            label: (
                <NoPaddingButton
                    aria-label={formatTemplate(
                        microcopy.a11y.editColumnNamed as string,
                        {
                            name: columnName
                        }
                    )}
                    disabled={isOptimisticPlaceholderId(columnId)}
                    onClick={() => setEditOpen(true)}
                    size="small"
                    type="text"
                >
                    {microcopy.actions.edit}
                </NoPaddingButton>
            )
        },
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
        <>
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
            <ColumnEditModal
                column={column}
                onClose={() => setEditOpen(false)}
                open={editOpen}
            />
        </>
    );
};

type TaskCardProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    task: ITask;
    members: IMember[];
    /**
     * Project labels, used to resolve `task.labelIds` → name + colour chips.
     * Optional so callers that don't render labels (or haven't loaded them)
     * simply omit the chip row.
     */
    labels?: ILabel[];
    /**
     * Project milestones, used to resolve `task.milestoneId` → a milestone
     * badge. Optional so callers that don't render the badge (or haven't
     * loaded them) simply omit it.
     */
    milestones?: IMilestone[];
    onOpen?: () => void;
    isMock?: boolean;
    /** Reordering is paused by active filters — advisory affordance only. */
    dragDisabledByFilters?: boolean;
};

const TaskCard = React.forwardRef<HTMLButtonElement, TaskCardProps>(
    (
        {
            task,
            members,
            labels,
            milestones,
            onOpen,
            isMock,
            dragDisabledByFilters,
            "aria-label": ariaLabel,
            ...rest
        },
        ref
    ) => {
        const { projectId } = useParams<{ projectId: string }>();
        // Board multi-select (PRD-GAP-008). `selectable` gates the checkbox
        // on a live provider AND a persisted task — an optimistic placeholder
        // has no server id to bulk-edit, so it's never selectable.
        const selection = useBulkSelection();
        const selectable = selection.enabled && !isMock;
        const selected = selectable && selection.isSelected(task._id);
        const coordinator = members.find((m) => m._id === task.coordinatorId);
        // Shared normalizer keeps the card's Task/Bug coercion in
        // lockstep with the task modal's select + title tag.
        const isBug = normalizeTaskType(task.type) === "Bug";
        // Resolve the task's label ids to the project's label objects (name
        // + colour). Unknown ids (a label deleted since the task was tagged)
        // are dropped rather than rendered as a blank chip. Order follows
        // `task.labelIds` so the chips are stable across renders.
        const taskLabels = (task.labelIds ?? [])
            .map((id) => (labels ?? []).find((label) => label._id === id))
            .filter((label): label is ILabel => Boolean(label));
        const overdue = isTaskOverdue(task.dueDate);
        const overdueLabel = task.dueDate
            ? formatTemplate(microcopy.a11y.overdueTask as string, {
                  date: task.dueDate
              })
            : "";
        // Priority badge (PRD §3.4): `none` / absent renders nothing, so the
        // badge only surfaces once a task is deliberately prioritised. The
        // label is read from the localized `options.priorities` dictionary
        // and reinforced by `PRIORITY_TINT`. Narrowing to the non-`none`
        // union here lets both maps index the priority safely (single-source
        // `TaskPriorityLevel`).
        const priority: TaskPriorityLevel | undefined = task.priority;
        const activePriority: Exclude<TaskPriorityLevel, "none"> | null =
            priority !== undefined && priority !== "none" ? priority : null;
        // Blocked badge (PRD §4.5): the server returns `blockedBy` — the ids of
        // this task's UNFINISHED prerequisites — on `GET /tasks`. A non-empty
        // array means the task can't start yet, so the badge surfaces; an
        // empty/absent array renders nothing. Read-only signal in this slice.
        const blocked =
            Array.isArray(task.blockedBy) && task.blockedBy.length > 0;
        // Completed badge (PRD §3 lifecycle): the server sets `completedAt`
        // (an ISO timestamp) while the task sits in a done-category column and
        // clears it on exit, so a truthy value is an authoritative "this task
        // is done" signal. Guard `Boolean(task.completedAt)` BEFORE handing the
        // value to dayjs — `dayjs(undefined)` is "now" and would render a bogus
        // date — then validate it parses before formatting.
        const completed =
            Boolean(task.completedAt) && dayjs(task.completedAt).isValid();
        const completedLabel = completed
            ? formatTemplate(microcopy.a11y.completedTask as string, {
                  date: dayjs(task.completedAt).format("YYYY-MM-DD")
              })
            : "";
        // Milestone badge (PRD milestones): resolve `task.milestoneId` against
        // the project's milestones (threaded board → column → card, same as
        // labels). An unset id — or one that no longer resolves (the milestone
        // was deleted since assignment) — renders nothing, so the chip is
        // gated on both the id AND a resolved milestone below.
        const milestone = (milestones ?? []).find(
            (m) => m._id === task.milestoneId
        );
        const milestoneLabel = milestone
            ? formatTemplate(microcopy.a11y.milestoneTask as string, {
                  name: milestone.name
              })
            : "";
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
        const cardButton = (
            <TaskCardOuter
                $dragDisabledByFilters={dragDisabledByFilters}
                $selectable={selectable}
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
                title={
                    dragDisabledByFilters
                        ? undefined
                        : microcopy.dragHints.taskCardKeyboard
                }
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
                {taskLabels.length > 0 ? (
                    <LabelRow aria-label={microcopy.fields.labels}>
                        {taskLabels.map((label) => (
                            <LabelChip
                                key={label._id}
                                variant="filled"
                                {...labelTagProps(label.color)}
                            >
                                {label.name}
                            </LabelChip>
                        ))}
                    </LabelRow>
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
                            autoComplete="off"
                            autoFocus
                            data-testid="task-card-title-input"
                            disabled={isUpdating}
                            enterKeyHint="done"
                            inputMode="text"
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
                            loading="lazy"
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
                        {completed ? (
                            <CompletedBadge
                                aria-label={completedLabel}
                                data-testid="task-card-completed"
                            >
                                <CheckCircleFilled aria-hidden />
                                <span>{microcopy.taskCard.completed}</span>
                            </CompletedBadge>
                        ) : null}
                        {blocked && !completed ? (
                            <BlockedBadge
                                aria-label={
                                    microcopy.a11y.blockedTask as string
                                }
                                data-testid="task-card-blocked"
                            >
                                <StopOutlined aria-hidden />
                                <span>{microcopy.taskCard.blocked}</span>
                            </BlockedBadge>
                        ) : null}
                        {activePriority ? (
                            <PriorityBadge
                                $tint={PRIORITY_TINT[activePriority]}
                                aria-label={formatTemplate(
                                    microcopy.a11y.priorityTask as string,
                                    {
                                        priority:
                                            microcopy.options.priorities[
                                                activePriority
                                            ]
                                    }
                                )}
                                data-testid="task-card-priority"
                            >
                                <FlagFilled aria-hidden />
                                <span>
                                    {
                                        microcopy.options.priorities[
                                            activePriority
                                        ]
                                    }
                                </span>
                            </PriorityBadge>
                        ) : null}
                        {overdue && !completed ? (
                            <OverdueChip
                                aria-label={overdueLabel}
                                data-testid="task-card-overdue"
                            >
                                <ClockCircleOutlined aria-hidden />
                                <span>{microcopy.taskCard.overdue}</span>
                            </OverdueChip>
                        ) : null}
                        {task.milestoneId && milestone ? (
                            <MilestoneBadge
                                aria-label={milestoneLabel}
                                data-testid="task-card-milestone"
                                title={milestone.name}
                            >
                                <FlagFilled aria-hidden />
                                <span>{milestone.name}</span>
                            </MilestoneBadge>
                        ) : null}
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
        if (!selectable) {
            return cardButton;
        }
        const selectLabel = formatTemplate(
            (selected
                ? microcopy.bulkEdit.deselectTask
                : microcopy.bulkEdit.selectTask) as string,
            { name: task.taskName }
        );
        return (
            <SelectableShell data-selected={selected ? "true" : "false"}>
                <SelectionCheckboxSlot
                    $selected={Boolean(selected)}
                    data-select-slot
                    // Quarantine pointer events so toggling selection never
                    // bubbles to the card's open handler or kicks off a drag.
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        aria-label={selectLabel}
                        checked={Boolean(selected)}
                        data-testid="task-card-select"
                        onChange={() => selection.toggle(task._id)}
                    />
                </SelectionCheckboxSlot>
                {cardButton}
            </SelectableShell>
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
    /**
     * True when row drag is disabled SOLELY because filters are active
     * (not by an in-flight reorder). Surfaces a tooltip + `aria-disabled`
     * affordance on the cards so the user understands why reordering is
     * paused. Does not itself disable drag — `taskDragDisabled` does that.
     */
    dragDisabledByFilters?: boolean;
    boardAiOn?: boolean;
    members?: IMember[];
    /** Project labels, threaded down to each card to resolve `labelIds`. */
    labels?: ILabel[];
    /** Project milestones, threaded down to each card to resolve `milestoneId`. */
    milestones?: IMilestone[];
    onResetFilters?: () => void;
};

const ColumnComponent = React.forwardRef<HTMLDivElement, ColumnComponentProps>(
    (
        {
            column,
            param,
            tasks,
            isDragDisabled,
            taskDragDisabled = isDragDisabled,
            dragDisabledByFilters = false,
            boardAiOn = true,
            members = [],
            labels = [],
            milestones = [],
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
         * WIP limit (PRD §5.5). The over-limit verdict is a property of the
         * column's REAL load, not of whatever search filter is active, so it
         * reads the unfiltered `tasks.length` (same reasoning as the
         * readiness pill above). `wipLimit === 0` (or absent) means "no
         * limit" per the drift-detector contract, so the indicator only
         * surfaces for a positive cap.
         */
        const wipLimit = column.wipLimit ?? 0;
        const wipCount = tasks.length;
        const overLimit = wipLimit > 0 && wipCount > wipLimit;
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
                    <ColumnHeader
                        between
                        data-glass-context="true"
                        data-testid="column-header"
                    >
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
                            {wipLimit > 0 ? (
                                <WipLimitBadge
                                    $over={overLimit}
                                    aria-label={formatTemplate(
                                        (overLimit
                                            ? microcopy.a11y.columnOverLimit
                                            : microcopy.a11y
                                                  .columnWipCount) as string,
                                        {
                                            count: wipCount,
                                            limit: wipLimit,
                                            over: wipCount - wipLimit
                                        }
                                    )}
                                    data-testid="column-wip-badge"
                                >
                                    {wipCount} / {wipLimit}
                                </WipLimitBadge>
                            ) : null}
                            {overLimit ? (
                                <OverLimitChip
                                    aria-hidden
                                    data-testid="column-wip-over"
                                >
                                    <WarningFilled aria-hidden />
                                    <span>{microcopy.column.overLimit}</span>
                                </OverLimitChip>
                            ) : null}
                            <ColumnReadinessPill report={readinessReport} />
                        </span>
                        <DeleteDropDown
                            column={column}
                            columnId={column._id}
                            columnName={column.columnName}
                            hasTasks={tasks.length > 0}
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
                                // Only persisted cards are reorderable, so the
                                // filter-paused affordance only applies there.
                                const showFilterPausedHint =
                                    dragDisabledByFilters && hasPersistedTaskId;

                                const card = (
                                    <TaskCard
                                        className="task-card-lift-surface"
                                        dragDisabledByFilters={
                                            showFilterPausedHint
                                        }
                                        isMock={!hasPersistedTaskId}
                                        labels={labels}
                                        members={members}
                                        milestones={milestones}
                                        onOpen={
                                            hasPersistedTaskId
                                                ? () => startEditing(task._id)
                                                : undefined
                                        }
                                        task={task}
                                    />
                                );

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
                                        {/*
                                         * The drag shell stays the direct child
                                         * of <Drag> so dnd attaches its ref /
                                         * draggable props to the real DOM node;
                                         * the tooltip only wraps the inner card.
                                         */}
                                        <TaskRowDragShell>
                                            {showFilterPausedHint ? (
                                                <Tooltip
                                                    title={
                                                        microcopy.dragHints
                                                            .reorderDisabledByFilters
                                                    }
                                                >
                                                    {card}
                                                </Tooltip>
                                            ) : (
                                                card
                                            )}
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

ColumnComponent.displayName = "Column";

/**
 * Memoized so board-level state changes that don't touch a column's own
 * props — opening the Copilot drawer, toggling project AI, the refresh
 * spinner, the swipe-hint dismissal — don't re-render every column (and,
 * transitively, every task card) on the board. The board now hands each
 * column stable prop refs: the per-column `tasks` bucket comes from a
 * memoized `Map`, `members` is the shared `EMPTY_MEMBERS` fallback or the
 * stable query ref, `param` is `useMemo`'d in `useUrl`, and
 * `onResetFilters` is `useCallback`'d. A real change — a search keystroke
 * (new `param`), a drag reorder (new `tasks`), or a member load — still
 * flows through because those refs genuinely change. The DnD `Drag`
 * wrapper spreads its own props onto the cloned element, but those are
 * forwarded via `...props` and only change when drag state actually does.
 */
const Column = React.memo(ColumnComponent);
Column.displayName = "Column";

export default Column;
