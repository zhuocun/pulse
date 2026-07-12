import React from "react";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";

import { microcopy } from "../../constants/microcopy";
import CopilotChip, { type CopilotChipTone } from "../copilotChip";

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
 *
 * Pill geometry flows through the shared `<CopilotChip variant="match">`
 * (Ambition 6 / 2026-05 review §6). Compact mode keeps the historical
 * 6 px coloured dot — the chip lets the surface customize geometry via
 * `style` while the shared component still pins font / radius / border.
 */
const TONE_FOR_STRENGTH: Record<AiSearchMatchStrength, CopilotChipTone> = {
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
    const tone = TONE_FOR_STRENGTH[strength];
    const tag = (
        <CopilotChip
            aria-label={ariaLabel}
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
            style={
                compact
                    ? {
                          height: 6,
                          minWidth: 6,
                          padding: 0,
                          width: 6,
                          borderRadius: 999,
                          verticalAlign: "middle"
                      }
                    : undefined
            }
            tone={tone}
            variant="match"
        >
            {compact ? "" : label}
        </CopilotChip>
    );
    if (!compact) return tag;
    // Compact mode only renders a colored dot; keep the band name
    // discoverable via tooltip so sighted users get parity with the
    // aria-label that screen-reader users hear.
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>{tag}</TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default AiMatchStrengthBadge;
