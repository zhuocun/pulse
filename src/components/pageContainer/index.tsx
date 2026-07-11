import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Routed page wrapper. Owns horizontal/vertical padding so individual
 * pages don't reinvent it. Padding shrinks below `md` so narrow
 * viewports don't waste a third of the screen on whitespace, and
 * honours iOS safe-area insets on devices with a notch / gesture bar.
 *
 * `max-width` caps the line length on ultra-wide monitors so headings
 * and tables don't sprawl. The board page opts out (full-bleed columns).
 */
const PageContainer = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "mx-auto w-full max-w-[88rem]",
            "px-md pt-lg",
            "pb-[max(var(--pulse-space-lg),env(safe-area-inset-bottom))]",
            "pl-[max(var(--pulse-space-md),env(safe-area-inset-left))]",
            "pr-[max(var(--pulse-space-md),env(safe-area-inset-right))]",
            "md:px-xl md:pt-xl md:pb-xxl",
            "md:pl-[max(var(--pulse-space-xl),env(safe-area-inset-left))]",
            "md:pr-[max(var(--pulse-space-xl),env(safe-area-inset-right))]",
            className
        )}
        {...props}
    />
));

PageContainer.displayName = "PageContainer";

export default PageContainer;
