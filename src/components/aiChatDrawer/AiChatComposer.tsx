import { Send, Square } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/typography";

import { microcopy } from "../../constants/microcopy";
import type { AgentHealthStatus } from "../../utils/hooks/useAgentHealth";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";

import { ComposerControlRow } from "./aiChatDrawerStyles";

export interface AiChatComposerProps {
    input: string;
    setInput: (value: string) => void;
    isLoading: boolean;
    onSend: () => void;
    onAbort: () => void;
    promptCharHintText: string;
    promptCharHintWarning: boolean;
    remoteHealthEnabled: boolean;
    healthStatus: AgentHealthStatus;
    inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Auto-size ceiling: the textarea grows to at most four rows, then scrolls. */
const COMPOSER_MAX_ROWS = 4;

export const AiChatComposer: React.FC<AiChatComposerProps> = ({
    input,
    setInput,
    isLoading,
    onSend,
    onAbort,
    promptCharHintText,
    promptCharHintWarning,
    remoteHealthEnabled,
    healthStatus,
    inputRef
}) => {
    /**
     * Submission guard (AI UX best practices §2.1). The textarea stays
     * editable during streaming so the user can compose the next prompt
     * while reading the in-flight reply; only `dispatch` is gated. A
     * dedicated Stop button sits in place of Send during loading.
     *
     * IME composition guard: the CJK input methods (Chinese / Japanese /
     * Korean) commit the candidate with Enter. Returning early when
     * `isComposing` is true keeps that first commit-Enter from sending
     * the message instead of accepting the candidate.
     */
    const handleSubmit = () => {
        if (isLoading) return;
        onSend();
    };

    // Auto-grow the textarea 1→4 rows as the prompt wraps. Grows on every
    // controlled `input` change; caps at four rows then scrolls.
    const localRef = useRef<HTMLTextAreaElement | null>(null);
    const setRefs = useCallback(
        (node: HTMLTextAreaElement | null) => {
            localRef.current = node;
            inputRef.current = node;
        },
        [inputRef]
    );

    useLayoutEffect(() => {
        const el = localRef.current;
        if (!el) return;
        el.style.height = "auto";
        const styles = window.getComputedStyle(el);
        const lineHeight = parseFloat(styles.lineHeight) || 20;
        const verticalPadding =
            parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) ||
            0;
        const maxHeight = lineHeight * COMPOSER_MAX_ROWS + verticalPadding;
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
        el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [input]);

    /*
     * Coarse-pointer chrome has no hardware keyboard, so the
     * "(Shift+Enter for a new line)" hint reads as noise there — touch
     * users get the hint-less placeholder variant instead.
     */
    const isPhoneChrome = useIsPhoneChrome();
    return (
        <>
            <ComposerControlRow data-testid="ai-chat-composer-row">
                <Textarea
                    aria-label={microcopy.a11y.messageBoardCopilot}
                    autoComplete="off"
                    className="min-h-[40px] resize-none"
                    enterKeyHint="send"
                    inputMode="text"
                    maxLength={microcopy.ai.characterCounterMax}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (e.nativeEvent.isComposing) return;
                        if (e.shiftKey) return;
                        e.preventDefault();
                        handleSubmit();
                    }}
                    placeholder={
                        isPhoneChrome
                            ? microcopy.placeholders.chatAskTouch
                            : microcopy.placeholders.chatAsk
                    }
                    ref={setRefs}
                    rows={1}
                    value={input}
                />
                {isLoading ? (
                    <Button
                        aria-label={microcopy.ai.stopResponse}
                        onClick={onAbort}
                        variant="destructive"
                    >
                        <Square aria-hidden />
                        <span className="ai-chat-composer-button-text">
                            {microcopy.actions.stop}
                        </span>
                    </Button>
                ) : (
                    <Button
                        aria-label={microcopy.a11y.sendMessage}
                        disabled={
                            !input.trim() ||
                            (remoteHealthEnabled && healthStatus === "offline")
                        }
                        onClick={handleSubmit}
                        variant="primary"
                    >
                        <Send aria-hidden />
                        <span className="ai-chat-composer-button-text">
                            {microcopy.actions.send}
                        </span>
                    </Button>
                )}
            </ComposerControlRow>
            <Text
                className="mt-[4px] block text-right text-xs"
                data-testid="chat-prompt-char-hint"
                type={promptCharHintWarning ? "warning" : "secondary"}
            >
                {promptCharHintText}
            </Text>
        </>
    );
};
