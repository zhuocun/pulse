import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge — replaces antd `Tag`. Non-interactive by default; when a caller
 * needs a closable/checkable tag they compose a `Button` alongside it.
 */
const badgeVariants = cva(
    cn(
        "inline-flex items-center gap-xxs rounded-pill border px-xs py-[2px] text-xs font-medium",
        "tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    ),
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground",
                secondary:
                    "border-transparent bg-secondary text-secondary-foreground",
                destructive:
                    "border-transparent bg-destructive text-destructive-foreground",
                outline: "border-border text-foreground",
                success: "border-transparent bg-success text-white",
                warning: "border-transparent bg-warning text-white",
                info: "border-transparent bg-info text-white"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

export interface BadgeProps
    extends
        React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

const Badge = ({ className, variant, ...props }: BadgeProps) => (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
);

export { Badge, badgeVariants };
