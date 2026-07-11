import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "./touchTarget";

/**
 * Switch — replaces antd `Switch`. `checked` / `onChange(bool)` map to
 * `checked` / `onCheckedChange`. The Root (the `role="switch"` control)
 * carries the coarse-pointer 44px floor so the whole toggle is the tap
 * target; the track grows on coarse to keep the thumb centered.
 */
const Switch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
        ref={ref}
        className={cn(
            "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border-2 border-transparent transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
            "coarse:w-14",
            TOUCH_TARGET,
            className
        )}
        {...props}
    >
        <SwitchPrimitive.Thumb
            className={cn(
                "pointer-events-none block size-5 rounded-pill bg-background shadow-lg ring-0 transition-transform",
                "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
                "coarse:size-7 coarse:data-[state=checked]:translate-x-6"
            )}
        />
    </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
