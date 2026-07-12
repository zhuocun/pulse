import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Typography — the Title / Text / Paragraph trio that replaces antd
 * `Typography.Title` / `Typography.Text` / `Typography.Paragraph`. The call
 * shape mirrors antd: `<Title level={3}>`, `<Text type="secondary">`,
 * `<Paragraph>`.
 */
type TitleLevel = 1 | 2 | 3 | 4 | 5;

const TITLE_CLASSES: Record<TitleLevel, string> = {
    1: "text-display font-bold tracking-tight",
    2: "text-xxl font-bold tracking-tight",
    3: "text-xl font-semibold tracking-tight",
    4: "text-lg font-semibold",
    5: "text-md font-semibold"
};

export interface TitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
    level?: TitleLevel;
}

const Title = React.forwardRef<HTMLHeadingElement, TitleProps>(
    ({ className, level = 1, ...props }, ref) => {
        const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5";
        return (
            <Tag
                ref={ref}
                className={cn(
                    "text-foreground",
                    TITLE_CLASSES[level],
                    className
                )}
                {...props}
            />
        );
    }
);
Title.displayName = "Title";

const textVariants = cva("", {
    variants: {
        type: {
            default: "text-foreground",
            secondary: "text-muted-foreground",
            success: "text-success",
            warning: "text-warning",
            danger: "text-destructive"
        },
        strong: {
            true: "font-semibold",
            false: ""
        }
    },
    defaultVariants: {
        type: "default",
        strong: false
    }
});

export interface TextProps
    extends
        React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof textVariants> {}

const Text = React.forwardRef<HTMLSpanElement, TextProps>(
    ({ className, type, strong, ...props }, ref) => (
        <span
            ref={ref}
            className={cn(textVariants({ type, strong }), "text-sm", className)}
            {...props}
        />
    )
);
Text.displayName = "Text";

export interface ParagraphProps
    extends
        React.HTMLAttributes<HTMLParagraphElement>,
        VariantProps<typeof textVariants> {}

const Paragraph = React.forwardRef<HTMLParagraphElement, ParagraphProps>(
    ({ className, type, strong, ...props }, ref) => (
        <p
            ref={ref}
            className={cn(
                textVariants({ type, strong }),
                "text-sm leading-normal [&:not(:last-child)]:mb-sm",
                className
            )}
            {...props}
        />
    )
);
Paragraph.displayName = "Paragraph";

const Typography = { Title, Text, Paragraph };

export { Paragraph, Text, Title, Typography };
