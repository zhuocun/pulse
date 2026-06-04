import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Popover, Typography } from "antd";
import React from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, space } from "../../theme/tokens";

/**
 * "Why?" rationale affordance for AI suggestions (B3 — AI provenance &
 * transparency, ui-todo §2.A.8).
 *
 * Renders a small, keyboard-operable "Why?" link next to an AI suggestion.
 * Activating it (click / Enter / Space — AntD `Button` handles all three)
 * opens a Popover that reveals the engine's *existing* rationale text,
 * turning a "magic" suggestion into "the machine followed these rules".
 *
 * The component is intentionally dumb: it only surfaces `rationale` text
 * the caller already has from the AI payload. It does NOT fabricate copy.
 * When the rationale is empty/whitespace the affordance renders nothing so
 * surfaces never expose an empty popover.
 *
 * Accessibility
 * -------------
 * The trigger is a real `<button>` (AntD `type="link"`) with an explicit
 * `aria-label`, so it has an accessible name and is reachable by keyboard.
 * The popover title gives the disclosed text a heading for context.
 */
export interface AiWhyPopoverProps {
    /** Existing rationale text from the AI payload. */
    rationale?: string;
    /**
     * Optional accessible-name suffix so multiple "Why?" buttons on one
     * surface stay distinguishable (e.g. "Why? — story-point estimate").
     */
    ariaContext?: string;
    /** Optional popover title override; defaults to the shared copy. */
    title?: React.ReactNode;
    style?: React.CSSProperties;
}

const AiWhyPopover: React.FC<AiWhyPopoverProps> = ({
    rationale,
    ariaContext,
    title,
    style
}) => {
    const text = typeof rationale === "string" ? rationale.trim() : "";
    if (!text) return null;

    const baseLabel = microcopyString(microcopy.ai.whyLabel);
    const accessibleName = ariaContext
        ? `${baseLabel} — ${ariaContext}`
        : baseLabel;

    const content = (
        <Typography.Paragraph
            style={{ marginBottom: 0, maxWidth: "18rem" }}
            type="secondary"
        >
            {text}
        </Typography.Paragraph>
    );

    return (
        <Popover
            content={content}
            title={title ?? microcopy.ai.whyPopoverTitle}
            trigger={["hover", "click"]}
        >
            <Button
                aria-label={accessibleName}
                icon={<QuestionCircleOutlined aria-hidden />}
                size="small"
                style={{
                    fontSize: fontSize.xs,
                    height: "auto",
                    paddingInline: space.xxs,
                    ...style
                }}
                type="link"
            >
                {baseLabel}
            </Button>
        </Popover>
    );
};

export default AiWhyPopover;
