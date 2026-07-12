import * as React from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "./touchTarget";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Textarea — replaces antd `Input.TextArea`. */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(
                "flex min-h-20 w-full rounded-md border border-input bg-background px-sm py-xs text-sm text-foreground",
                "ring-offset-background transition-colors",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                TOUCH_TARGET,
                className
            )}
            {...props}
        />
    )
);
Textarea.displayName = "Textarea";

export { Textarea };
