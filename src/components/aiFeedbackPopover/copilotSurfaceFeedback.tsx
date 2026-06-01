import styled from "@emotion/styled";
import { Button } from "antd";
import React, { useCallback, useEffect, useState } from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { space, touchTargetCoarse } from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";

import AiFeedbackPopover, { AiFeedbackSubmission } from "./feedbackPopover";

export type AiCopilotFeedbackSurface = "task-assist" | "board-brief";

export interface AiCopilotSurfaceFeedbackProps {
    surface: AiCopilotFeedbackSurface;
    suggestionKey: string;
    citationCount?: number;
    ariaGroupLabel: string;
}

const FeedbackRail = styled.div`
    align-items: center;
    column-gap: ${space.xxs}px;
    display: inline-flex;
    flex-wrap: wrap;
    row-gap: ${space.xxs}px;

    @media (pointer: coarse) {
        && .ant-btn {
            min-height: ${touchTargetCoarse}px;
            min-width: ${touchTargetCoarse}px;
        }
    }
`;

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
    // AntD v6: static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance from the
    // nearest `<App>` provider (with a static fallback for tests
    // rendering in isolation).
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
        <FeedbackRail aria-label={ariaGroupLabel} role="group">
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
        </FeedbackRail>
    );
};

export default AiCopilotSurfaceFeedback;
