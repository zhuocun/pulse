import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tooltip — replaces antd `Tooltip`. Wrap the app (or a subtree) in a single
 * `<TooltipProvider>`; then `Tooltip` + `TooltipTrigger` + `TooltipContent`
 * map onto antd's `title` + child.
 */
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                "z-[1050] overflow-hidden rounded-md bg-foreground px-xs py-xxs text-xs text-background shadow-md",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
                "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
                className
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
