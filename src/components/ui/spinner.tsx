import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const spinnerVariants = cva("animate-spin text-primary", {
    variants: {
        size: {
            sm: "size-4",
            md: "size-6",
            lg: "size-8"
        }
    },
    defaultVariants: {
        size: "md"
    }
});

export interface SpinnerProps
    extends
        React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof spinnerVariants> {
    /** Accessible name for the busy region; announced to screen readers. */
    label?: string;
}

/**
 * Spinner — the active-loading half of antd `Spin`. Renders a live status
 * region so assistive tech announces the busy state; pass `label` for the
 * accessible name (defaults to a neutral "Loading").
 */
const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
    ({ className, size, label = "Loading", ...props }, ref) => (
        <span
            ref={ref}
            role="status"
            aria-live="polite"
            className={cn("inline-flex items-center justify-center", className)}
            {...props}
        >
            <Loader2 aria-hidden className={cn(spinnerVariants({ size }))} />
            <span className="sr-only">{label}</span>
        </span>
    )
);
Spinner.displayName = "Spinner";

export { Spinner, spinnerVariants };
