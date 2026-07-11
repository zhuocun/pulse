import * as React from "react";

import { cn } from "@/lib/utils";

/** Skeleton — loading placeholder (the static half of antd `Spin`'s job). */
const Skeleton = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        aria-hidden
        className={cn("animate-pulse rounded-md bg-muted", className)}
        {...props}
    />
);

export { Skeleton };
