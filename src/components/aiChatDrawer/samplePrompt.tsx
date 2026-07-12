import React, { forwardRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "../ui/touchTarget";

interface SamplePromptProps {
    children: React.ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    "aria-label"?: string;
    "data-testid"?: string;
}

/**
 * Sample-prompt chip. A pill-shaped toggle rendered as a keyboard-reachable
 * `role="button"` so the chip row is Tab-navigable and chips activate on
 * Enter / Space — matching the standard button semantics screen-reader and
 * keyboard users expect. `checked` paints the selected (primary) fill.
 */
const SamplePrompt = forwardRef<HTMLSpanElement, SamplePromptProps>(
    function SamplePromptImpl(
        {
            children,
            checked,
            onChange,
            "aria-label": ariaLabel,
            "data-testid": dataTestId
        },
        ref
    ) {
        const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
            // Standard button keyboard contract: Enter and Space activate.
            // Arrow keys are intentionally NOT bound — the chip row is a
            // flat list, not a radio group, so they still belong to the
            // surrounding scroll container.
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onChange(!checked);
            }
        };

        return (
            <span
                aria-label={ariaLabel}
                aria-pressed={checked}
                className={cn(
                    "inline-flex cursor-pointer items-center rounded-pill px-sm py-xxs text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    checked
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground hover:bg-muted/80",
                    TOUCH_TARGET
                )}
                data-testid={dataTestId}
                onClick={() => onChange(!checked)}
                onKeyDown={handleKeyDown}
                ref={ref}
                role="button"
                tabIndex={0}
            >
                {children}
            </span>
        );
    }
);

export default SamplePrompt;
