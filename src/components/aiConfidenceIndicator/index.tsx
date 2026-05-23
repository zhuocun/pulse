import { Tooltip } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
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
    const ariaLabel = `Confidence ${BAND_LABEL[band].toLowerCase()}, ${percent}`;
    const node = (
        <CopilotChip aria-label={ariaLabel} tone={tone} variant="confidence">
            {text}
        </CopilotChip>
    );
    if (!tooltip) return node;
    return <Tooltip title={tooltip}>{node}</Tooltip>;
};

export default AiConfidenceIndicator;
