import styled from "@emotion/styled";
import { Tag, Typography } from "antd";

import {
    breakpoints,
    fontSize,
    fontWeight,
    radius,
    space,
    touchTargetCoarse
} from "../../theme/tokens";

export const ChatTabLayout = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    height: 100%;
    min-height: 0;
`;

export const MessageRow = styled.div<{ $isUser: boolean }>`
    margin-bottom: ${space.sm}px;
    text-align: ${(props) => (props.$isUser ? "right" : "left")};
`;

/**
 * Chat bubble. Centralizing the bubble's background, padding, and width
 * cap here means a tweak to the chat visual language is one edit instead
 * of three duplicated inline-style objects.
 */
export const MessageBubble = styled(Typography.Paragraph)<{ $isUser: boolean }>`
    && {
        background: ${(props) =>
            props.$isUser
                ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.10))"
                : "var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04))"};
        border-radius: ${radius.md}px;
        color: var(--ant-color-text, inherit);
        display: inline-block;
        margin-bottom: 0;
        max-width: min(100%, 36rem);
        padding: ${space.xs}px ${space.sm}px;
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
    }

    && pre,
    && code {
        max-width: 100%;
        overflow-x: auto;
    }
`;

/**
 * AntD's `Typography.Text` with `code` looks heavy here; this is a
 * lightweight pseudo-cursor that pulses while tokens stream in. The
 * bare span avoids a re-render storm from CSS animations on every chunk.
 */
export const StreamingCursor = styled.span`
    display: inline-block;
    margin-inline-start: 2px;
    animation: aiCursorBlink 1s steps(1) infinite;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));

    @keyframes aiCursorBlink {
        50% {
            opacity: 0;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`;

/**
 * Attribution row above each assistant bubble (P2-5). The sparkle is
 * decorative — the visible "Board Copilot" label is what screen readers
 * announce. Pairing the model name with the bubble matches the
 * ChatGPT/Claude convention so users always know the source of the text.
 */
export const AssistantAttribution = styled.div`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: 4px;
    margin-bottom: ${space.xxs}px;
    max-width: min(100%, 36rem);
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
`;

/**
 * "AI · review before using" footnote below each assistant bubble (P2-2).
 * Kept intentionally low-contrast so it sits out of the reading flow but
 * remains discoverable when users are calibrating trust on a response.
 */
export const AssistantDisclaimer = styled.div`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    font-size: ${fontSize.xs}px;
    margin-top: 2px;
`;

export const AssistantActionRow = styled.div`
    display: inline-flex;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
    margin-top: ${space.xxs}px;
    max-width: min(100%, 36rem);
    text-align: left;

    && .ant-btn {
        flex: 0 0 auto;
    }

    @media (pointer: coarse) {
        && .ant-btn {
            min-height: ${touchTargetCoarse}px;
            min-width: ${touchTargetCoarse}px;
        }
    }
`;

export const ComposerControlRow = styled.div`
    align-items: flex-end;
    display: flex;
    gap: ${space.xs}px;
    min-width: 0;
    width: 100%;

    && textarea.ant-input {
        flex: 1 1 auto;
        min-height: 40px;
        min-width: 0;
    }

    && .ant-btn {
        flex: 0 0 auto;
        min-height: 40px;
        white-space: nowrap;
    }

    @media (max-width: ${breakpoints.sm}px) {
        gap: ${space.xxs}px;

        && .ant-btn {
            min-width: ${touchTargetCoarse}px;
            padding-inline: 0;
            width: ${touchTargetCoarse}px;
        }

        && .ai-chat-composer-button-text {
            display: none;
        }
    }

    @media (pointer: coarse) {
        && textarea.ant-input,
        && .ant-btn {
            min-height: ${touchTargetCoarse}px;
        }

        && .ant-btn {
            min-width: ${touchTargetCoarse}px;
        }
    }
`;

export const ToolPayloadPanel = styled.div`
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.02));
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.xs}px;
    margin: ${space.xxs}px 0;
    padding: ${space.xxs}px ${space.xs}px;
`;

/**
 * Underlying styled chip — bare `Tag.CheckableTag` with a pill radius
 * and a focus ring re-painted so keyboard users have a visible target.
 * Exported so the `SamplePrompt` wrapper (in `samplePrompt.tsx`) can
 * compose it with the keyboard-activation behaviour.
 *
 * AntD's CheckableTag renders as a bare <span> with no tabIndex, role,
 * or keyboard handler — the wrapper adds those a11y props (Bug 3 in
 * `docs/design/ui-ux-comprehensive-review-2026-05.md`).
 */
export const StyledSamplePromptChip = styled(Tag.CheckableTag)`
    && {
        border-radius: ${radius.pill}px;
        font-weight: ${fontWeight.medium};
        padding: ${space.xxs}px ${space.sm}px;
    }

    &&:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 2px;
    }
`;
