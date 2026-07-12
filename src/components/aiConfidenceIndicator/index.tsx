import React from "react";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    confidenceBand,
    confidenceColor,
    confidencePercent,
    type ConfidenceBand
} from "../../utils/ai/confidenceBand";
import CopilotChip, { type CopilotChipTone } from "../copilotChip";

/**
 * Shared confidence indicator (Optimization Plan §3 P2-1).
 *
 * Surfaces the same band + percentage + tooltip everywhere AI emits a
 * structured suggestion (draft, estimate, brief, search, future
 * proposals). Centralizing the component keeps the band thresholds, color
 * map, and accessible label in one place — adding a new band only
 * requires editing `confidenceBand.ts` and the band copy below, not every
 * caller.
 *
 * The numeric percentage is intentionally *paired* with the qualitative
 * band per the AI UX best practices doc: NN/g and PAIR research shows
 * users underweight bare numbers (e.g. "82%") and overweight bare bands
 * ("High"). Showing both lets each audience read what they trust.
 *
 * The pill geometry now flows through the shared `<CopilotChip>`
 * (Ambition 6 / 2026-05 review §6) so the confidence band sits on the
 * same shape token as every other AI pill.
 */
interface AiConfidenceIndicatorProps {
    /** Raw 0–1 confidence value, typically from a model. */
    confidence: number;
    /**
     * Optional, plain-language tooltip override. Defaults to a generic
     * "Based on similar items" phrase; surfaces with a richer rationale
     * (the estimate panel cites similar tasks) should pass their own.
     */
    tooltip?: string;
    /** Render the band only, no percentage. Useful in dense layouts. */
    compact?: boolean;
}

const BAND_LABEL: Record<ConfidenceBand, string> = {
    High: microcopy.ai.confidenceBands.high,
    Moderate: microcopy.ai.confidenceBands.moderate,
    Low: microcopy.ai.confidenceBands.low
};

const AiConfidenceIndicator: React.FC<AiConfidenceIndicatorProps> = ({
    confidence,
    tooltip,
    compact = false
}) => {
    const band = confidenceBand(confidence);
    const percent = confidencePercent(confidence);
    /*
     * `confidenceColor` returns AntD-named colors ("green" / "orange" /
     * "red") that line up 1:1 with the shared chip's tone palette, so we
     * pass the value straight through. Adding a new band only requires a
     * change in `confidenceBand.ts`.
     */
    const tone = confidenceColor(band) as CopilotChipTone;
    const text = compact
        ? BAND_LABEL[band]
        : `${BAND_LABEL[band]} (${percent})`;
    /*
     * QW#13 (2026-05 review §Quick Wins): the aria-label flows through
     * the locale-aware microcopy template instead of a hard-coded
     * English string. The visible chip pairs the band with the
     * percentage; the SR label mirrors that pairing so users on
     * assistive tech don't get a strictly weaker signal. The band copy
     * itself comes from `ai.confidenceBands.*` (already locale-aware)
     * and is lowercased to keep the "High, 83%" → "high, 83%" reading
     * cadence that NN/g flagged as the most natural for confidence
     * announcements.
     */
    const ariaLabel = microcopyString(microcopy.a11y.confidenceAriaLabel)
        .replace("{band}", BAND_LABEL[band].toLowerCase())
        .replace("{percent}", percent);
    const node = (
        <CopilotChip aria-label={ariaLabel} tone={tone} variant="confidence">
            {text}
        </CopilotChip>
    );
    if (!tooltip) return node;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>{node}</TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default AiConfidenceIndicator;
