import styled from "@emotion/styled";
import { App, Button, Tag, Tooltip, Typography } from "antd";
import React from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { CitationRef } from "../../interfaces/agent";
import { fontSize, fontWeight, space } from "../../theme/tokens";

/**
 * Inline citation chip (PRD v3 §10.2). Renders as a small superscript tag
 * — clicking or pressing Enter navigates to the cited entity (or fires
 * `onNavigate` so the surface can scroll the row into view and pulse it
 * per C-R7). Verbatim `quote` is mandatory and always shown in the
 * tooltip / popover so users can verify what the agent saw.
 */
const Chip = styled(Tag)`
    && {
        background: var(--color-copilot-badge-bg);
        border-color: var(--color-copilot-bg-medium);
        border-radius: 999px;
        color: var(--color-copilot-badge);
        cursor: pointer;
        font-size: ${fontSize.xs - 1}px;
        font-weight: ${fontWeight.semibold};
        line-height: 1;
        margin: 0 2px;
        padding: 1px 6px;
        vertical-align: super;
    }

    &&:hover,
    &&:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 1px;
    }
`;

const TooltipBody = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    max-width: 18rem;
`;

interface CitationChipProps {
    /** 1-based index used for the visible label (`[1]`, `[2]`, …). */
    index: number;
    citation: CitationRef;
    /**
     * Called when the user activates the chip. The surface decides what
     * "navigate" means (open task modal, scroll to entity, focus a row).
     * If omitted, the chip becomes informational — no click handler is
     * attached, but the tooltip still opens on hover.
     */
    onNavigate?: (citation: CitationRef) => void;
}

/**
 * Map source → human-readable label. Resolved through microcopy so every
 * locale swap takes effect immediately without touching this component.
 */
const getSourceLabel = (source: CitationRef["source"]): string => {
    const labels: Record<CitationRef["source"], string> = {
        task: microcopy.ai.citationSourceTask as string,
        column: microcopy.ai.citationSourceColumn as string,
        member: microcopy.ai.citationSourceMember as string,
        project: microcopy.ai.citationSourceProject as string
    };
    return labels[source] ?? source;
};

const CitationChip: React.FC<CitationChipProps> = ({
    index,
    citation,
    onNavigate
}) => {
    const { message } = App.useApp();
    const [flagged, setFlagged] = React.useState(false);
    const handleActivate = () => {
        track(ANALYTICS_EVENTS.CITATION_CLICKED, {
            source: citation.source,
            id: citation.id
        });
        onNavigate?.(citation);
    };
    const onKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleActivate();
        }
    };
    const handleFlag = (event: React.MouseEvent) => {
        // Stop propagation so flagging doesn't also navigate to the cited
        // entity — the two affordances live inside the same tooltip card.
        event.stopPropagation();
        if (flagged) return;
        setFlagged(true);
        track(ANALYTICS_EVENTS.CITATION_FLAGGED, {
            source: citation.source,
            id: citation.id
        });
        message.success(microcopy.ai.citationFlagConfirm);
    };
    return (
        <Tooltip
            title={
                <TooltipBody>
                    <Typography.Text strong style={{ color: "inherit" }}>
                        {getSourceLabel(citation.source)} · {citation.id}
                    </Typography.Text>
                    <Typography.Text style={{ color: "inherit" }}>
                        “{citation.quote}”
                    </Typography.Text>
                    <Button
                        aria-label={microcopy.ai.citationFlagAction}
                        disabled={flagged}
                        onClick={handleFlag}
                        size="small"
                        style={{
                            color: "inherit",
                            marginTop: 4,
                            paddingInline: 0
                        }}
                        type="link"
                    >
                        {flagged
                            ? microcopy.ai.citationFlagConfirm
                            : microcopy.ai.citationFlagAction}
                    </Button>
                </TooltipBody>
            }
        >
            <Chip
                aria-label={microcopy.ai.citationAriaLabel
                    .replace("{index}", String(index))
                    .replace("{source}", getSourceLabel(citation.source))
                    .replace("{id}", citation.id)}
                onClick={handleActivate}
                onKeyDown={onKeyDown}
                role={onNavigate ? "button" : "note"}
                tabIndex={onNavigate ? 0 : -1}
            >
                [{index}]
            </Chip>
        </Tooltip>
    );
};

export default CitationChip;
