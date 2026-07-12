import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { TOUCH_TARGET } from "./touchTarget";

/**
 * Button — replaces antd `Button`.
 *
 * The label is always `children` (or `aria-label` for icon-only buttons):
 * this primitive never bakes in a user-visible string, so callers pass
 * `microcopy.actions.*` exactly as they did to antd's `<Button>`.
 */
const buttonVariants = cva(
    cn(
        "inline-flex items-center justify-center gap-xs whitespace-nowrap rounded-md text-sm font-medium",
        "ring-offset-background transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        "coarse:min-w-[44px]",
        "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        TOUCH_TARGET
    ),
    {
        variants: {
            variant: {
                primary:
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                default:
                    "bg-secondary text-secondary-foreground border border-input hover:bg-muted",
                destructive:
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                outline:
                    "border border-input bg-background hover:bg-muted hover:text-foreground",
                ghost: "hover:bg-muted hover:text-foreground",
                link: "text-primary underline-offset-4 hover:underline"
            },
            size: {
                sm: "h-8 rounded-sm px-sm text-xs",
                md: "h-10 px-md py-xs",
                lg: "h-11 rounded-md px-lg text-md",
                icon: "size-10"
            },
            block: {
                true: "w-full",
                false: ""
            }
        },
        defaultVariants: {
            variant: "default",
            size: "md",
            block: false
        }
    }
);

export interface ButtonProps
    extends
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    /** Render as a `<Slot>` so the styles land on the single child element. */
    asChild?: boolean;
    /** Show a spinner and disable interaction, mirroring antd's `loading`. */
    loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant,
            size,
            block,
            asChild = false,
            loading = false,
            disabled,
            children,
            ...props
        },
        ref
    ) => {
        const Comp = asChild ? Slot : "button";
        // Slot forwards a single child, so a spinner must ride inside it —
        // wrap the child rather than prepend a sibling.
        const content = (
            <>
                {loading ? (
                    <Loader2
                        aria-hidden
                        className="animate-spin"
                        data-testid="button-spinner"
                    />
                ) : null}
                {children}
            </>
        );
        return (
            <Comp
                ref={ref}
                className={cn(
                    buttonVariants({ variant, size, block }),
                    loading && "disabled:opacity-100",
                    className
                )}
                disabled={disabled || loading}
                aria-busy={loading || undefined}
                {...props}
            >
                {asChild ? children : content}
            </Comp>
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
