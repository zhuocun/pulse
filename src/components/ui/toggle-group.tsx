import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "./touchTarget";

/**
 * ToggleGroup — replaces antd `Segmented`. antd's `options`/`value`/
 * `onChange` map to composed `<ToggleGroupItem>` children + `value`/
 * `onValueChange`. Defaults to single-select (`type="single"`) like
 * Segmented; pass `type="multiple"` for a multi-toggle bar.
 */
const toggleItemVariants = cva(
    cn(
        "inline-flex items-center justify-center gap-xs rounded-sm px-sm text-sm font-medium transition-colors",
        "hover:bg-background/60 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        TOUCH_TARGET
    ),
    {
        variants: {
            size: {
                sm: "h-8",
                md: "h-9",
                lg: "h-10"
            }
        },
        defaultVariants: {
            size: "md"
        }
    }
);

const ToggleGroupContext = React.createContext<
    VariantProps<typeof toggleItemVariants>
>({ size: "md" });

const ToggleGroup = React.forwardRef<
    React.ElementRef<typeof ToggleGroupPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
        VariantProps<typeof toggleItemVariants>
>(({ className, size, children, ...props }, ref) => (
    <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn(
            "inline-flex items-center gap-xxs rounded-md bg-muted p-xxs text-muted-foreground",
            className
        )}
        {...props}
    >
        <ToggleGroupContext.Provider value={{ size }}>
            {children}
        </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
    React.ElementRef<typeof ToggleGroupPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
        VariantProps<typeof toggleItemVariants>
>(({ className, size, children, ...props }, ref) => {
    const context = React.useContext(ToggleGroupContext);
    return (
        <ToggleGroupPrimitive.Item
            ref={ref}
            className={cn(
                toggleItemVariants({ size: context.size ?? size }),
                className
            )}
            {...props}
        >
            {children}
        </ToggleGroupPrimitive.Item>
    );
});
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
