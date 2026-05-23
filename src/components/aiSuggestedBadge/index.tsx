import { Popover, Typography } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import CopilotChip from "../copilotChip";

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
 *
 * The chip itself is now the shared `<CopilotChip variant="suggested">`
 * (Ambition 6 / 2026-05 review §6). Previously this component rolled its
 * own styled `<Tag>` with bespoke padding / font weight; the shared chip
 * pins the geometry so all six AI pills stay shape-consistent.
 */
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
            <CopilotChip
                aria-label={microcopy.ai.appliedSuggestion}
                compact={compact}
                interactive
                style={style}
                variant="suggested"
            >
                {label}
            </CopilotChip>
        </Popover>
    );
};

export default AiSuggestedBadge;
