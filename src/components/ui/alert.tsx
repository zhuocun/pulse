import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Alert — replaces antd `Alert`. antd's `message` / `description` map to
 * `<AlertTitle>` / `<AlertDescription>`; `type` maps to `variant`; `icon`
 * is composed as the first child (auto-offset by the `[&>svg]` rules).
 */
const alertVariants = cva(
    cn(
        "relative w-full rounded-lg border p-md text-sm",
        "[&>svg]:absolute [&>svg]:left-md [&>svg]:top-md [&>svg]:size-4",
        "[&>svg~*]:pl-lg [&>svg+div]:translate-y-[-1px]"
    ),
    {
        variants: {
            variant: {
                default: "bg-card text-card-foreground border-border",
                info: "bg-card text-info border-info/40 [&>svg]:text-info",
                success:
                    "bg-card text-success border-success/40 [&>svg]:text-success",
                warning:
                    "bg-card text-warning border-warning/40 [&>svg]:text-warning",
                destructive:
                    "bg-card text-destructive border-destructive/50 [&>svg]:text-destructive"
            }
        },
        defaultVariants: {
            variant: "default"
        }
    }
);

export interface AlertProps
    extends
        React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
    ({ className, variant, ...props }, ref) => (
        <div
            ref={ref}
            role="alert"
            className={cn(alertVariants({ variant }), className)}
            {...props}
        />
    )
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    // Content is provided by the caller via `children` (spread through
    // `props`), which the static a11y rule can't see on a wrapper component.
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h5
        ref={ref}
        className={cn(
            "mb-xxs font-medium leading-none tracking-tight",
            className
        )}
        {...props}
    />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "text-sm text-muted-foreground [&_p]:leading-relaxed",
            className
        )}
        {...props}
    />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
