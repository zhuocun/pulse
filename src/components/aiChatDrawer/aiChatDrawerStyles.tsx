import * as React from "react";

import { Paragraph } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/**
 * Chat-surface layout primitives, ported from Emotion to Tailwind. Each
 * export keeps its original name and call shape so the `ChatTabBody` and
 * `AiChatComposer` call sites migrate by import-path only. Colors and
 * spacing thread the `--ui-*` / `--pulse-*` token layer via Tailwind
 * utilities — no re-derived literals.
 */

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export const ChatTabLayout = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn("flex h-full min-h-0 flex-1 flex-col", className)}
            {...props}
        />
    )
);
ChatTabLayout.displayName = "ChatTabLayout";

export interface MessageRowProps extends DivProps {
    $isUser: boolean;
}

export const MessageRow = React.forwardRef<HTMLDivElement, MessageRowProps>(
    ({ className, $isUser, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "mb-sm",
                $isUser ? "text-right" : "text-left",
                className
            )}
            {...props}
        />
    )
);
MessageRow.displayName = "MessageRow";

export interface MessageBubbleProps extends React.HTMLAttributes<HTMLParagraphElement> {
    $isUser: boolean;
}

/**
 * Chat bubble. Centralizing the bubble's background, padding, and width
 * cap here means a tweak to the chat visual language is one edit instead
 * of three duplicated inline-style objects.
 */
export const MessageBubble = React.forwardRef<
    HTMLParagraphElement,
    MessageBubbleProps
>(({ className, $isUser, ...props }, ref) => (
    <Paragraph
        ref={ref}
        className={cn(
            "inline-block mb-0 max-w-[min(100%,36rem)] rounded-md px-sm py-xs text-left text-foreground [white-space:pre-wrap] [word-break:break-word] [&:not(:last-child)]:mb-0",
            "[&_code]:max-w-full [&_code]:overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto",
            $isUser ? "bg-primary/10" : "bg-muted",
            className
        )}
        {...props}
    />
));
MessageBubble.displayName = "MessageBubble";

/**
 * Lightweight pseudo-cursor that pulses while tokens stream in. The bare
 * span avoids a re-render storm from CSS animations on every chunk and
 * disables the animation under `prefers-reduced-motion`.
 */
export const StreamingCursor = React.forwardRef<
    HTMLSpanElement,
    React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
    <span
        ref={ref}
        className={cn(
            "ms-[2px] inline-block animate-pulse text-muted-foreground motion-reduce:animate-none",
            className
        )}
        {...props}
    />
));
StreamingCursor.displayName = "StreamingCursor";

/**
 * Attribution row above each assistant bubble. The sparkle is decorative —
 * the visible "Board Copilot" label is what screen readers announce.
 */
export const AssistantAttribution = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "mb-xxs inline-flex w-full max-w-[min(100%,36rem)] flex-wrap items-center justify-between gap-[4px] text-xs font-medium text-muted-foreground",
                className
            )}
            {...props}
        />
    )
);
AssistantAttribution.displayName = "AssistantAttribution";

/** "AI · review before using" footnote below each assistant bubble. */
export const AssistantDisclaimer = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "mt-[2px] text-sm font-medium text-muted-foreground",
                className
            )}
            {...props}
        />
    )
);
AssistantDisclaimer.displayName = "AssistantDisclaimer";

export const AssistantActionRow = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "mt-xxs inline-flex max-w-[min(100%,36rem)] flex-wrap gap-xxs text-left [&_button]:flex-none",
                className
            )}
            {...props}
        />
    )
);
AssistantActionRow.displayName = "AssistantActionRow";

export const ComposerControlRow = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "flex w-full min-w-0 items-end gap-xs",
                "[&_textarea]:min-h-[40px] [&_textarea]:min-w-0 [&_textarea]:flex-1",
                "[&_button]:min-h-[40px] [&_button]:flex-none [&_button]:whitespace-nowrap",
                "max-sm:gap-xxs",
                "max-sm:[&_.ai-chat-composer-button-text]:hidden",
                "max-sm:[&_button]:w-[44px] max-sm:[&_button]:min-w-[44px] max-sm:[&_button]:px-0",
                "coarse:[&_textarea]:min-h-[44px]",
                "coarse:[&_button]:min-h-[44px] coarse:[&_button]:min-w-[44px]",
                className
            )}
            {...props}
        />
    )
);
ComposerControlRow.displayName = "ComposerControlRow";

export const ToolPayloadPanel = React.forwardRef<HTMLDivElement, DivProps>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn(
                "my-xxs rounded-sm bg-muted/40 px-xs py-xxs text-xs text-muted-foreground",
                className
            )}
            {...props}
        />
    )
);
ToolPayloadPanel.displayName = "ToolPayloadPanel";
