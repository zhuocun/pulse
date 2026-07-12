import { HelpCircle } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";

/**
 * "Why?" rationale affordance for AI suggestions (B3 — AI provenance &
 * transparency, ui-todo §2.A.8).
 *
 * Renders a small, keyboard-operable "Why?" link next to an AI suggestion.
 * Activating it (click / Enter / Space — the `Button` handles all three)
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
 * The trigger is a real `<button>` (`variant="link"`) with an explicit
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

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    aria-label={accessibleName}
                    className="h-auto gap-xxs px-xxs py-0 text-xs"
                    style={style}
                    variant="link"
                >
                    <HelpCircle aria-hidden />
                    {baseLabel}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                aria-label={microcopyString(microcopy.ai.whyPopoverTitle)}
            >
                <Typography.Text className="mb-sm block font-semibold">
                    {title ?? microcopy.ai.whyPopoverTitle}
                </Typography.Text>
                <Typography.Paragraph
                    className="mb-0 max-w-[18rem]"
                    type="secondary"
                >
                    {text}
                </Typography.Paragraph>
            </PopoverContent>
        </Popover>
    );
};

export default AiWhyPopover;
