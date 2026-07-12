import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import useAppMessage from "@/components/ui/toast";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";

import AiFeedbackPopover, { AiFeedbackSubmission } from "./feedbackPopover";

export type AiCopilotFeedbackSurface = "task-assist" | "board-brief";

export interface AiCopilotSurfaceFeedbackProps {
    surface: AiCopilotFeedbackSurface;
    suggestionKey: string;
    citationCount?: number;
    ariaGroupLabel: string;
}

/**
 * Mirrors `AiChatDrawer` thumbs rail for non-chat surfaces — same analytics
 * event with `surface` + `suggestionId` scoping (`THUMBS_FEEDBACK`).
 */
const AiCopilotSurfaceFeedback: React.FC<AiCopilotSurfaceFeedbackProps> = ({
    surface,
    suggestionKey,
    citationCount = 0,
    ariaGroupLabel
}) => {
    const [value, setValue] = useState<"up" | "down" | null>(null);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    // Toasts route through the sonner-backed `message` seam, which
    // no-ops until a `<Toaster>` is mounted (test-safe by default).
    const message = useAppMessage();

    useEffect(() => {
        setValue(null);
        setFeedbackOpen(false);
    }, [suggestionKey]);

    const recordFeedback = useCallback(
        (
            next: "up" | "down",
            extras?: { categories?: string[]; hasNote?: boolean }
        ) => {
            track(ANALYTICS_EVENTS.THUMBS_FEEDBACK, {
                value: next,
                surface,
                suggestionId: suggestionKey,
                citationCount,
                ...extras
            });
            setValue(next);
        },
        [citationCount, suggestionKey, surface]
    );

    const handleThumbsUp = useCallback(() => {
        if (value === "up") return;
        recordFeedback("up");
        message.success(microcopy.ai.feedbackThanks);
    }, [message, recordFeedback, value]);

    const handleSubmitFeedbackDown = useCallback(
        (submission: AiFeedbackSubmission) => {
            recordFeedback("down", {
                categories: submission.categories,
                hasNote: submission.note.length > 0
            });
            setFeedbackOpen(false);
            message.success(microcopy.ai.feedbackThanks);
        },
        [message, recordFeedback]
    );

    const handleSkipFeedbackDown = useCallback(() => {
        recordFeedback("down");
        setFeedbackOpen(false);
    }, [recordFeedback]);

    if (!suggestionKey) return null;

    return (
        <div
            aria-label={ariaGroupLabel}
            className="inline-flex flex-wrap items-center gap-xxs"
            role="group"
        >
            <Button
                aria-label={microcopy.a11y.helpfulAnswer}
                aria-pressed={value === "up"}
                onClick={handleThumbsUp}
                size="sm"
                variant={value === "up" ? "primary" : "ghost"}
            >
                👍
            </Button>
            <AiFeedbackPopover
                onOpenChange={setFeedbackOpen}
                onSkip={handleSkipFeedbackDown}
                onSubmit={handleSubmitFeedbackDown}
                open={feedbackOpen}
            >
                <Button
                    aria-expanded={feedbackOpen}
                    aria-haspopup="dialog"
                    aria-label={microcopy.a11y.notHelpfulGiveFeedback}
                    aria-pressed={value === "down"}
                    size="sm"
                    title={microcopy.ai.feedbackThumbsDownTooltip}
                    variant={value === "down" ? "primary" : "ghost"}
                >
                    👎
                </Button>
            </AiFeedbackPopover>
        </div>
    );
};

export default AiCopilotSurfaceFeedback;
