import styled from "@emotion/styled";
import { Popover, Tag, Typography } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";

/**
 * "Suggested by Copilot" provenance badge (PRD v3 T-R3, D-R2).
 *
 * Renders below or beside an AI-populated form field. Surfaces stamp the
 * underlying field with `data-ai-suggested` so the badge can be cleared
 * automatically when the user edits the value (via ResizeObserver / on
 * change handlers in the consuming component).
 *
 * Click/keyboard activation opens a Popover with a "Revert to previous"
 * affordance — the consumer wires the actual revert via `onRevert`.
 */
const BadgeTag = styled(Tag)`
    && {
        background: var(--color-copilot-badge-bg);
        border-color: var(--color-copilot-bg-medium);
        border-radius: 999px;
        color: var(--color-copilot-badge);
        cursor: pointer;
        font-size: ${fontSize.xs - 1}px;
        font-weight: ${fontWeight.semibold};
        margin-inline-end: 0;
        padding: 1px 8px;
    }
`;

interface AiSuggestedBadgeProps {
    /** Optional explanatory text shown in the popover. */
    rationale?: string;
    /** Triggered when the user clicks "Revert to previous". */
    onRevert?: () => void;
    /**
     * Compact variant uses just "AI" — used in dense form labels where
     * the full "Suggested by Copilot" string would wrap.
     */
    compact?: boolean;
    style?: React.CSSProperties;
}

const AiSuggestedBadge: React.FC<AiSuggestedBadgeProps> = ({
    rationale,
    onRevert,
    compact,
    style
}) => {
    const label = compact
        ? microcopy.ai.appliedSuggestionShort
        : microcopy.ai.appliedSuggestion;
    const popoverContent = (
        <div style={{ maxWidth: "18rem" }}>
            <Typography.Paragraph
                style={{ marginBottom: space.xs }}
                type="secondary"
            >
                {rationale ?? microcopy.ai.suggestionPopover}
            </Typography.Paragraph>
            {onRevert && (
                <Typography.Link onClick={onRevert}>
                    {microcopy.ai.revertToPrevious}
                </Typography.Link>
            )}
        </div>
    );
    /*
     * Popover triggers — we deliberately omit `"focus"`. Form-fill
     * surfaces tab through several badges in a row, and an
     * auto-opening popover on focus narrates the rationale paragraph
     * into the screen-reader stream mid-form-fill. `"hover"` keeps the
     * tooltip-style preview for pointer users; `"click"` (and keyboard
     * Enter/Space via `role="button"` + `tabIndex={0}`) is the explicit
     * affordance that opens the Revert link.
     */
    return (
        <Popover content={popoverContent} trigger={["hover", "click"]}>
            <BadgeTag
                aria-label={microcopy.ai.appliedSuggestion}
                role="button"
                style={style}
                tabIndex={0}
            >
                {label}
            </BadgeTag>
        </Popover>
    );
};

export default AiSuggestedBadge;
