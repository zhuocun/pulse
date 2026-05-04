import { Tag, Tooltip } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";

/**
 * Per-result match-strength chip (Optimization Plan §3 P1-2).
 *
 * AiSearchInput already shows aggregate counts ("Strong: 3, Weak: 2") so
 * the user knows the quality of the result set. This chip surfaces the
 * same band on the *individual* result so users can tell which task or
 * project is the strong match without re-reading the rationale. Keeping
 * it small and tag-shaped means it reads as metadata, not a primary
 * action — it sits next to existing card meta (story points, badges)
 * without competing for attention.
 *
 * Returns `null` when the strength is unknown (older remote engine,
 * search not active) so consumers can render this unconditionally.
 */
const TAG_COLOR: Record<AiSearchMatchStrength, "green" | "orange" | "default"> =
    {
        strong: "green",
        moderate: "orange",
        weak: "default"
    };

interface AiMatchStrengthBadgeProps {
    strength: AiSearchMatchStrength | null;
    /**
     * `compact` drops the visible label and shows the colored dot only —
     * meant for dense card surfaces where space is tight. The aria-label
     * still announces the band so screen-reader users get the same signal.
     */
    compact?: boolean;
}

const AiMatchStrengthBadge: React.FC<AiMatchStrengthBadgeProps> = ({
    strength,
    compact = false
}) => {
    if (!strength) return null;
    const label = microcopy.ai.searchMatchStrength[strength];
    const ariaLabel = microcopy.ai.searchMatchStrengthAria.replace(
        "{strength}",
        label
    );
    const tag = (
        <Tag
            aria-label={ariaLabel}
            color={TAG_COLOR[strength]}
            /*
             * Compact mode renders an empty visible tag (a coloured dot).
             * Without an explicit role the element is a generic span and
             * aria-label is prohibited on it (axe rule aria-prohibited-attr,
             * WCAG 4.1.2). Adding role="img" makes it a named image-like
             * widget so screen readers announce the label instead of
             * ignoring it. Non-compact mode inherits the same role for
             * consistency, but the label is redundant there (the visible
             * text already conveys it).
             */
            role="img"
            style={{
                marginInlineEnd: 0,
                ...(compact
                    ? {
                          height: 6,
                          minWidth: 6,
                          padding: 0,
                          width: 6,
                          borderRadius: 999,
                          verticalAlign: "middle"
                      }
                    : {})
            }}
        >
            {compact ? "" : label}
        </Tag>
    );
    if (!compact) return tag;
    // Compact mode only renders a colored dot; keep the band name
    // discoverable via tooltip so sighted users get parity with the
    // aria-label that screen-reader users hear.
    return <Tooltip title={label}>{tag}</Tooltip>;
};

export default AiMatchStrengthBadge;
