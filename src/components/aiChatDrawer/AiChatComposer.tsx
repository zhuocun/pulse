import { SendOutlined, StopOutlined } from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { RefObject } from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize } from "../../theme/tokens";
import type { AgentHealthStatus } from "../../utils/hooks/useAgentHealth";

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
    inputRef: RefObject<TextAreaRef | null>;
}

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
    return (
        <>
            <ComposerControlRow data-testid="ai-chat-composer-row">
                <Input.TextArea
                    aria-label={microcopy.a11y.messageBoardCopilot}
                    autoComplete="off"
                    autoSize={{ maxRows: 4, minRows: 1 }}
                    enterKeyHint="send"
                    inputMode="text"
                    maxLength={microcopy.ai.characterCounterMax}
                    onChange={(e) => setInput(e.target.value)}
                    onPressEnter={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.shiftKey) return;
                        e.preventDefault();
                        handleSubmit();
                    }}
                    placeholder={microcopy.placeholders.chatAsk}
                    ref={inputRef}
                    value={input}
                />
                {isLoading ? (
                    <Button
                        aria-label={microcopy.ai.stopResponse}
                        danger
                        icon={<StopOutlined aria-hidden />}
                        onClick={onAbort}
                        type="default"
                    >
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
                        icon={<SendOutlined aria-hidden />}
                        onClick={handleSubmit}
                        type="primary"
                    >
                        <span className="ai-chat-composer-button-text">
                            {microcopy.actions.send}
                        </span>
                    </Button>
                )}
            </ComposerControlRow>
            <Typography.Text
                data-testid="chat-prompt-char-hint"
                style={{
                    display: "block",
                    fontSize: fontSize.xs,
                    marginTop: 4,
                    textAlign: "right"
                }}
                type={promptCharHintWarning ? "warning" : "secondary"}
            >
                {promptCharHintText}
            </Typography.Text>
        </>
    );
};
