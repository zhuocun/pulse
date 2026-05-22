import React, { forwardRef, type KeyboardEvent } from "react";

import { StyledSamplePromptChip } from "./aiChatDrawerStyles";

interface SamplePromptProps {
    children: React.ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
    "aria-label"?: string;
    "data-testid"?: string;
}

/**
 * AntD's `CheckableTag` type does not declare `tabIndex`, `role`, or
 * `onKeyDown`, but its runtime implementation spreads `restProps` onto
 * the underlying `<span>`, so these attributes do reach the DOM. We
 * cast the JSX element to a permissive props bag so the type-checker
 * accepts the extra a11y attributes without us having to drop the
 * styled-component wrapper.
 */
const ChipElement =
    StyledSamplePromptChip as unknown as React.ForwardRefExoticComponent<
        Omit<React.HTMLAttributes<HTMLSpanElement>, "onChange"> & {
            checked: boolean;
            onChange?: (checked: boolean) => void;
            children?: React.ReactNode;
        } & React.RefAttributes<HTMLSpanElement>
    >;

/**
 * Sample-prompt chip. Wraps `Tag.CheckableTag` (a bare <span> with no
 * tabIndex / role / keyboard handler) so the chip row is keyboard-
 * reachable via Tab and chips activate on Enter / Space — matching the
 * standard button semantics screen-reader and keyboard users expect.
 *
 * Visual treatment is preserved 1:1 with the previous styled wrapper —
 * only the a11y surface changes. Bug 3 in
 * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
 */
const SamplePrompt = forwardRef<HTMLSpanElement, SamplePromptProps>(
    function SamplePrompt(
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
            <ChipElement
                aria-label={ariaLabel}
                checked={checked}
                data-testid={dataTestId}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                ref={ref}
                role="button"
                tabIndex={0}
            >
                {children}
            </ChipElement>
        );
    }
);

export default SamplePrompt;
