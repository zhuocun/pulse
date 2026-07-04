import { CloseOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";

export interface FilterChip {
    /** Stable key (e.g. "manager", "type"). Drives the dismiss handler. */
    key: string;
    /** Short label for the dimension (e.g. "Manager"). */
    label: string;
    /** Concrete value (e.g. "Alice", "Task"). */
    value: string;
}

interface FilterChipsProps {
    chips: FilterChip[];
    onDismiss: (key: string) => void;
    /** Optional "Clear all" CTA shown when 2+ chips are active. */
    onClearAll?: () => void;
    clearAllLabel?: string;
}

const ChipRow = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    padding-top: ${space.xs}px;
`;

const Chip = styled.span`
    align-items: center;
    background: var(--ant-color-primary-bg, rgba(234, 88, 12, 0.08));
    border: 1px solid var(--ant-color-primary-border, rgba(234, 88, 12, 0.2));
    border-radius: ${radius.pill}px;
    color: var(--ant-color-primary, #ea580c);
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: ${space.xxs}px;
    padding: 2px ${space.xs}px 2px ${space.sm}px;
    max-width: 100%;

    > span:first-of-type {
        opacity: 0.65;
    }

    > span:nth-of-type(2) {
        max-width: 14ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

const ChipDismiss = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    height: 18px;
    justify-content: center;
    margin-inline-start: ${space.xxs}px;
    min-height: 18px;
    min-width: 18px;
    opacity: 0.7;
    padding: 0;
    transition:
        background-color 120ms ease-out,
        opacity 120ms ease-out;
    width: 18px;

    &:hover,
    &:focus-visible {
        background: var(--pulse-accent-bg-hover, rgba(234, 88, 12, 0.18));
        opacity: 1;
    }

    @media (pointer: coarse) {
        height: 44px;
        min-height: 44px;
        min-width: 44px;
        width: 44px;
    }

    svg {
        font-size: 9px;
    }
`;

const ClearAllButton = styled.button`
    background: transparent;
    border: none;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
    cursor: pointer;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    padding: 2px ${space.xs}px;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 2px;
    transition:
        color 120ms ease-out,
        text-decoration-color 120ms ease-out;

    &:hover,
    &:focus-visible {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.85));
        text-decoration-color: currentColor;
    }

    /* Lift to the 44 px touch floor on coarse pointers (WCAG 2.5.8),
     * mirroring the sibling ChipDismiss control so both filter affordances
     * stay comfortably tappable on a phone without disturbing the dense
     * desktop rhythm. */
    @media (pointer: coarse) {
        min-height: 44px;
    }
`;

/**
 * Renders the active filters as dismissible chips. Pairs with a search /
 * filter panel so users can see at a glance what is filtered, drop a single
 * dimension without recreating the whole filter, and reset everything in
 * one click. Replaces the previous "count-only" pill which left users
 * guessing which filters were active.
 */
const FilterChips: React.FC<FilterChipsProps> = ({
    chips,
    onDismiss,
    onClearAll,
    clearAllLabel = microcopy.actions.clear
}) => {
    if (chips.length === 0) return null;
    return (
        <ChipRow role="region" aria-label={microcopy.a11y.activeFilters}>
            {chips.map((chip) => (
                <Chip key={chip.key}>
                    <span>{chip.label}:</span>
                    <span>{chip.value}</span>
                    <ChipDismiss
                        aria-label={microcopy.a11y.removeFilter.replace(
                            "{label}",
                            chip.label
                        )}
                        onClick={() => onDismiss(chip.key)}
                        type="button"
                    >
                        <CloseOutlined aria-hidden />
                    </ChipDismiss>
                </Chip>
            ))}
            {onClearAll && chips.length >= 2 ? (
                <ClearAllButton onClick={onClearAll} type="button">
                    {clearAllLabel}
                </ClearAllButton>
            ) : null}
        </ChipRow>
    );
};

export default FilterChips;
