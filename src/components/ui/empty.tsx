import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyProps extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "title"
> {
    /** Optional illustration/icon shown above the title. */
    icon?: React.ReactNode;
    /** Primary line — what's empty. */
    title?: React.ReactNode;
    /** Secondary explanatory line. */
    description?: React.ReactNode;
    /** Optional action row (e.g. a "Create" `Button`). */
    action?: React.ReactNode;
}

/**
 * Empty — replaces antd `Empty`. A centered empty-state block. The caller
 * supplies copy via `title` / `description` so no user-visible string is
 * baked in here.
 */
const Empty = React.forwardRef<HTMLDivElement, EmptyProps>(
    (
        { className, icon, title, description, action, children, ...props },
        ref
    ) => (
        <div
            ref={ref}
            className={cn(
                "flex flex-col items-center justify-center gap-xs px-md py-xl text-center",
                className
            )}
            {...props}
        >
            {icon ? (
                <div className="text-muted-foreground [&_svg]:size-10">
                    {icon}
                </div>
            ) : null}
            {title ? (
                <p className="text-sm font-medium text-foreground">{title}</p>
            ) : null}
            {description ? (
                <p className="max-w-prose text-sm text-muted-foreground">
                    {description}
                </p>
            ) : null}
            {children}
            {action ? <div className="mt-xs">{action}</div> : null}
        </div>
    )
);
Empty.displayName = "Empty";

export { Empty };
