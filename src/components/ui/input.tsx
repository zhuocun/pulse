import * as React from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "./touchTarget";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Input — replaces antd `Input`. A plain themed `<input>`; affix/password
 * variants compose an adornment in the caller (see PRIMITIVE-MAP) rather
 * than shipping antd's `Input.Password` surface here.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type = "text", ...props }, ref) => (
        <input
            ref={ref}
            type={type}
            className={cn(
                "flex h-10 w-full rounded-md border border-input bg-background px-sm py-xs text-sm text-foreground",
                "ring-offset-background transition-colors",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "file:border-0 file:bg-transparent file:text-sm file:font-medium",
                TOUCH_TARGET,
                className
            )}
            {...props}
        />
    )
);
Input.displayName = "Input";

export { Input };
