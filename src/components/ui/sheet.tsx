import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { microcopy } from "@/constants/microcopy";
import { cn } from "@/lib/utils";

/**
 * Sheet — replaces antd `Drawer`. Same Radix Dialog machinery as `Dialog`
 * but slides in from an edge. antd's `placement` maps to `side`; `open` /
 * `onClose` map to `open` / `onOpenChange`. z-index follows the
 * `zIndex.drawer` (1000) token so a Dialog (1100) can stack above it.
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Overlay
        ref={ref}
        className={cn(
            "fixed inset-0 z-[1000] bg-black/45",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className
        )}
        {...props}
    />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
    cn(
        "fixed z-[1000] gap-md bg-card p-lg text-card-foreground shadow-lg",
        "transition ease-in-out",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:duration-300 data-[state=open]:duration-500"
    ),
    {
        variants: {
            side: {
                top: "inset-x-0 top-0 border-b border-border data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                bottom: "inset-x-0 bottom-0 border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
                right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
            }
        },
        defaultVariants: {
            side: "right"
        }
    }
);

export interface SheetContentProps
    extends
        React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
        VariantProps<typeof sheetVariants> {
    hideClose?: boolean;
}

const SheetContent = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Content>,
    SheetContentProps
>(
    (
        { className, side = "right", hideClose = false, children, ...props },
        ref
    ) => (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                ref={ref}
                className={cn(sheetVariants({ side }), className)}
                {...props}
            >
                {children}
                {hideClose ? null : (
                    <SheetPrimitive.Close
                        aria-label={microcopy.actions.close}
                        className={cn(
                            "absolute right-md top-md inline-flex size-8 items-center justify-center rounded-sm opacity-70 transition-opacity",
                            "hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                            "disabled:pointer-events-none coarse:size-11"
                        )}
                    >
                        <X className="size-4" aria-hidden />
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn("flex flex-col gap-xxs text-left", className)}
        {...props}
    />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse gap-xs sm:flex-row sm:justify-end",
            className
        )}
        {...props}
    />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Title
        ref={ref}
        className={cn("text-lg font-semibold text-foreground", className)}
        {...props}
    />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
    <SheetPrimitive.Description
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
    />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetOverlay,
    SheetPortal,
    SheetTitle,
    SheetTrigger
};
