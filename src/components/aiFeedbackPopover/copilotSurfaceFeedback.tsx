import { Button, message } from "antd";
import React, { useCallback, useEffect, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";

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
    }, [recordFeedback, value]);

    const handleSubmitFeedbackDown = useCallback(
        (submission: AiFeedbackSubmission) => {
            recordFeedback("down", {
                categories: submission.categories,
                hasNote: submission.note.length > 0
            });
            setFeedbackOpen(false);
            message.success(microcopy.ai.feedbackThanks);
        },
        [recordFeedback]
    );

    const handleSkipFeedbackDown = useCallback(() => {
        recordFeedback("down");
        setFeedbackOpen(false);
    }, [recordFeedback]);

    if (!suggestionKey) return null;

    return (
        <div
            aria-label={ariaGroupLabel}
            role="group"
            style={{
                alignItems: "center",
                columnGap: space.xxs,
                display: "inline-flex",
                flexWrap: "wrap",
                rowGap: space.xxs
            }}
        >
            <Button
                aria-label={microcopy.a11y.helpfulAnswer}
                aria-pressed={value === "up"}
                onClick={handleThumbsUp}
                size="small"
                type={value === "up" ? "primary" : "text"}
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
                    size="small"
                    title={microcopy.ai.feedbackThumbsDownTooltip}
                    type={value === "down" ? "primary" : "text"}
                >
                    👎
                </Button>
            </AiFeedbackPopover>
        </div>
    );
};

export default AiCopilotSurfaceFeedback;
