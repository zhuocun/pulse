import { Button, Checkbox, Input, Popover, Space, Typography } from "antd";
import React, { useCallback, useState } from "react";

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

    const content = (
        <div style={{ maxWidth: 320 }}>
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
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {FEEDBACK_CATEGORIES.map((category) => (
                    <Checkbox
                        checked={selected.has(category)}
                        key={category}
                        onChange={() => handleToggle(category)}
                    >
                        {microcopy.ai.feedbackCategories[category]}
                    </Checkbox>
                ))}
            </Space>
            <Input.TextArea
                aria-label={microcopy.ai.feedbackOptionalNote}
                autoSize={{ maxRows: 4, minRows: 2 }}
                enterKeyHint="send"
                inputMode="text"
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder={microcopy.ai.feedbackOptionalNote}
                style={{ marginTop: space.xs }}
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
            <Space style={{ justifyContent: "flex-end", width: "100%" }}>
                <Button onClick={handleSkip} size="small" type="text">
                    {microcopy.ai.feedbackSkip}
                </Button>
                <Button
                    disabled={selected.size === 0}
                    onClick={handleSubmit}
                    size="small"
                    type="primary"
                >
                    {microcopy.ai.feedbackSubmit}
                </Button>
            </Space>
        </div>
    );

    return (
        <Popover
            content={content}
            destroyOnHidden
            onOpenChange={onOpenChange}
            open={open}
            placement="topRight"
            trigger="click"
        >
            {children}
        </Popover>
    );
};

export default AiFeedbackPopover;
