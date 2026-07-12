import React, { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";

import { microcopy } from "../../constants/microcopy";
import { fontSize, space } from "../../theme/tokens";

/**
 * Categories the user can attribute a thumbs-down to (Optimization Plan
 * §3 P1-3). The keys flow into analytics so product can prioritize the
 * actual failure modes rather than a single "down" counter.
 *
 * Listed in roughly the order users tend to choose: factual issues first,
 * source issues second, then actionability and safety, then a fallback.
 */
export const FEEDBACK_CATEGORIES = [
    "incorrect",
    "missingSource",
    "outdated",
    "notActionable",
    "unsafe",
    "privacy",
    "other"
] as const;

export type AiFeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface AiFeedbackSubmission {
    categories: AiFeedbackCategory[];
    /** Free-text note. Empty string when the user skipped the field. */
    note: string;
}

interface AiFeedbackPopoverProps {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onSubmit: (payload: AiFeedbackSubmission) => void;
    onSkip: () => void;
    children: React.ReactNode;
}

const NOTE_MAX_LENGTH = 280;

const AiFeedbackPopover: React.FC<AiFeedbackPopoverProps> = ({
    open,
    onOpenChange,
    onSubmit,
    onSkip,
    children
}) => {
    const [selected, setSelected] = useState<Set<AiFeedbackCategory>>(
        () => new Set()
    );
    const [note, setNote] = useState("");

    const handleToggle = useCallback((category: AiFeedbackCategory) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    }, []);

    const handleSubmit = useCallback(() => {
        if (selected.size === 0) return;
        onSubmit({
            categories: Array.from(selected),
            note: note.trim()
        });
        setSelected(new Set());
        setNote("");
    }, [selected, note, onSubmit]);

    const handleSkip = useCallback(() => {
        setSelected(new Set());
        setNote("");
        onSkip();
    }, [onSkip]);

    return (
        <Popover onOpenChange={onOpenChange} open={open}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                align="end"
                aria-label={microcopy.ai.feedbackPromptDownTitle}
                className="w-[min(320px,calc(100dvw-48px))] max-w-[min(320px,calc(100dvw-48px))]"
                data-testid="ai-feedback-popover-content"
                side="top"
            >
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {microcopy.ai.feedbackPromptDownTitle}
                </Typography.Text>
                <Typography.Paragraph
                    style={{
                        fontSize: fontSize.xs,
                        marginBottom: space.xs,
                        marginTop: 4
                    }}
                    type="secondary"
                >
                    {microcopy.ai.feedbackPromptDownHelper}
                </Typography.Paragraph>
                <div className="flex w-full flex-col gap-[4px]">
                    {FEEDBACK_CATEGORIES.map((category) => (
                        <label
                            className="flex items-center gap-xs text-sm text-foreground"
                            key={category}
                        >
                            <Checkbox
                                checked={selected.has(category)}
                                onCheckedChange={() => handleToggle(category)}
                            />
                            {microcopy.ai.feedbackCategories[category]}
                        </label>
                    ))}
                </div>
                <Textarea
                    aria-label={microcopy.ai.feedbackOptionalNote}
                    autoComplete="off"
                    className="mt-xs min-h-[3.5rem]"
                    enterKeyHint="send"
                    inputMode="text"
                    maxLength={NOTE_MAX_LENGTH}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={microcopy.ai.feedbackOptionalNote}
                    rows={2}
                    value={note}
                />
                <Typography.Paragraph
                    style={{
                        fontSize: fontSize.xs,
                        marginBottom: space.xs,
                        marginTop: space.xs
                    }}
                    type="secondary"
                >
                    {microcopy.ai.feedbackImpactNotice}
                </Typography.Paragraph>
                <div
                    className="flex w-full flex-wrap justify-end gap-xxs"
                    data-testid="ai-feedback-popover-actions"
                >
                    <Button onClick={handleSkip} size="sm" variant="ghost">
                        {microcopy.ai.feedbackSkip}
                    </Button>
                    <Button
                        disabled={selected.size === 0}
                        onClick={handleSubmit}
                        size="sm"
                        variant="primary"
                    >
                        {microcopy.ai.feedbackSubmit}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default AiFeedbackPopover;
