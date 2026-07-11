import React from "react";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import useAppMessage from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { CitationRef } from "../../interfaces/agent";
import CopilotChip from "../copilotChip";

/**
 * Inline citation chip (PRD v3 §10.2). Renders as a small superscript tag
 * — clicking or pressing Enter navigates to the cited entity (or fires
 * `onNavigate` so the surface can scroll the row into view and pulse it
 * per C-R7). Verbatim `quote` is mandatory and always shown in the
 * popover so users can verify what the agent saw.
 *
 * QW#7 (2026-05 review §Quick Wins): the source preview + "report wrong
 * source" affordance now live inside a *Popover* with a `click` trigger
 * instead of a hover Tooltip. Tooltips dismiss on mouse-out and only
 * surface on hover, so the flag action was unreachable for keyboard +
 * touch users — the Popover keeps the same body but opens on click /
 * Enter, stays open until the user dismisses it (Esc or outside-click),
 * and lets the flag Button receive focus.
 *
 * The pill geometry is owned by the shared `<CopilotChip variant="citation">`
 * (Ambition 6 / 2026-05 review §6). The superscript positioning and 2 px
 * outer margin remain citation-specific so the chip slots inline with body
 * text without floating off the baseline.
 */
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
        project: microcopy.ai.citationSourceProject as string,
        user: microcopy.ai.citationSourceUser as string
    };
    return labels[source] ?? source;
};

const CitationChip: React.FC<CitationChipProps> = ({
    index,
    citation,
    onNavigate
}) => {
    const message = useAppMessage();
    const [flagged, setFlagged] = React.useState(false);
    const handleActivate = () => {
        track(ANALYTICS_EVENTS.CITATION_CLICKED, {
            source: citation.source,
            id: citation.id
        });
        onNavigate?.(citation);
    };
    const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
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
    const navigable = typeof onNavigate === "function";
    /*
     * The popover body lives inline so the source preview, verbatim
     * quote, and report-this-citation action share a single overlay.
     * The button stops propagation so flagging never also navigates to
     * the cited entity even though both affordances live in the same
     * overlay.
     */
    return (
        <Popover>
            {/*
             * Click-only trigger (QW#7): hover would re-introduce the
             * keyboard / touch reachability bug, focus would auto-open
             * the popover on tab-through and read the quote into the
             * screen reader stream mid-document. The chip already
             * forwards Enter / Space via `interactive` → `role=button`,
             * so keyboard activation still toggles the popover.
             */}
            <PopoverTrigger asChild>
                <CopilotChip
                    aria-label={microcopy.ai.citationAriaLabel
                        .replace("{index}", String(index))
                        .replace("{source}", getSourceLabel(citation.source))
                        .replace("{id}", citation.id)}
                    compact
                    interactive={navigable}
                    onClick={handleActivate}
                    onKeyDown={onKeyDown}
                    /*
                     * Non-navigable chips are inline `[n]` markers, not
                     * aside document sections — `role="note"` (an aside
                     * landmark) misrepresents them. `role="img"` pairs with
                     * the existing `aria-label` so the chip surfaces a
                     * single self-contained accessible name instead of
                     * leaking the `[n]` glyph as separate text. The
                     * navigable branch keeps `role="button"`.
                     */
                    role={navigable ? "button" : "img"}
                    style={{
                        margin: "0 2px",
                        verticalAlign: "super"
                    }}
                    tabIndex={navigable ? 0 : -1}
                    variant="citation"
                >
                    [{index}]
                </CopilotChip>
            </PopoverTrigger>
            <PopoverContent
                aria-label={getSourceLabel(citation.source)}
                className="flex w-72 max-w-[18rem] flex-col gap-xxs"
                side="top"
            >
                <Typography.Text strong>
                    {getSourceLabel(citation.source)} · {citation.id}
                </Typography.Text>
                <Typography.Text>“{citation.quote}”</Typography.Text>
                <Button
                    aria-label={microcopy.ai.citationFlagAction}
                    className="mt-xxs h-auto justify-start p-0"
                    disabled={flagged}
                    onClick={handleFlag}
                    variant="link"
                >
                    {flagged
                        ? microcopy.ai.citationFlagConfirm
                        : microcopy.ai.citationFlagAction}
                </Button>
            </PopoverContent>
        </Popover>
    );
};

export default CitationChip;
