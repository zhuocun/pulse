import { fireEvent, render, screen } from "@testing-library/react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { createRef } from "react";

import { microcopy } from "../../constants/microcopy";
import {
    coarseTouchTargetsFor,
    mediaRuleTextsFor,
    ruleTextsFor,
    styledClassFor
} from "../../testUtils/styleRules";

import { AiChatComposer } from "./AiChatComposer";

const renderComposer = (
    overrides: Partial<React.ComponentProps<typeof AiChatComposer>> = {}
) => {
    const onSend = jest.fn();
    const onAbort = jest.fn();
    const setInput = jest.fn();
    const inputRef = createRef<TextAreaRef>();
    const props: React.ComponentProps<typeof AiChatComposer> = {
        input: "hello",
        setInput,
        isLoading: false,
        onSend,
        onAbort,
        promptCharHintText: "0 / 2000",
        promptCharHintWarning: false,
        remoteHealthEnabled: false,
        healthStatus: "ok",
        inputRef,
        ...overrides
    };
    const utils = render(<AiChatComposer {...props} />);
    return { ...utils, onSend, onAbort, setInput };
};

describe("AiChatComposer", () => {
    it("keeps the textarea editable while streaming so the user can type the next prompt", () => {
        // AI UX best practices §2.1: input stays editable, only dispatch
        // is gated. The textarea has no `disabled` attribute during
        // streaming — instead a Stop button replaces Send.
        renderComposer({ isLoading: true });
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        ) as HTMLTextAreaElement;
        expect(textarea).not.toBeDisabled();
        // Typing while loading must not throw and the change handler fires.
        const { setInput } = renderComposer({
            isLoading: true,
            input: ""
        });
        fireEvent.change(
            screen.getAllByLabelText(
                microcopy.a11y.messageBoardCopilot
            )[1] as HTMLTextAreaElement,
            { target: { value: "next question" } }
        );
        expect(setInput).toHaveBeenCalledWith("next question");
    });

    it("does not submit when Enter is pressed during streaming", () => {
        const { onSend } = renderComposer({ isLoading: true });
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        );
        fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
        expect(onSend).not.toHaveBeenCalled();
    });

    it("submits on plain Enter when not loading", () => {
        const { onSend } = renderComposer();
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        );
        fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("does not submit when Shift+Enter is pressed (newline)", () => {
        const { onSend } = renderComposer();
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        );
        fireEvent.keyDown(textarea, {
            key: "Enter",
            code: "Enter",
            shiftKey: true
        });
        expect(onSend).not.toHaveBeenCalled();
    });

    it("ignores Enter while an IME composition is active (CJK candidate accept)", () => {
        const { onSend } = renderComposer();
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        );
        // Native event carries isComposing=true while the IME candidate
        // window is open; the first Enter should accept the candidate,
        // not submit the message.
        fireEvent.keyDown(textarea, {
            key: "Enter",
            code: "Enter",
            // jsdom KeyboardEvent supports `isComposing` directly on the
            // event object; the composer reads `e.nativeEvent.isComposing`.
            isComposing: true
        });
        expect(onSend).not.toHaveBeenCalled();
    });

    it("submits on Enter when IME composition has finished", () => {
        const { onSend } = renderComposer();
        const textarea = screen.getByLabelText(
            microcopy.a11y.messageBoardCopilot
        );
        fireEvent.keyDown(textarea, {
            key: "Enter",
            code: "Enter",
            isComposing: false
        });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it("does not invoke onSend when the Send button is clicked during streaming", () => {
        // Defense-in-depth: even if a parent reroutes click to handleSubmit
        // during loading, the submit guard short-circuits the call.
        const { onSend } = renderComposer({ isLoading: true });
        // Send button is replaced by Stop while loading.
        expect(
            screen.queryByLabelText(microcopy.a11y.sendMessage)
        ).not.toBeInTheDocument();
        expect(
            screen.getByLabelText(microcopy.ai.stopResponse)
        ).toBeInTheDocument();
        // Verifying the loading branch's guard via Enter-press, which
        // goes through the same `handleSubmit` path:
        fireEvent.keyDown(
            screen.getByLabelText(microcopy.a11y.messageBoardCopilot),
            { key: "Enter", code: "Enter" }
        );
        expect(onSend).not.toHaveBeenCalled();
    });

    it("renders the character hint text", () => {
        renderComposer({ promptCharHintText: "12 / 2000" });
        expect(screen.getByTestId("chat-prompt-char-hint")).toHaveTextContent(
            "12 / 2000"
        );
    });

    it("renders a flex composer row with coarse-pointer touch targets", () => {
        renderComposer();
        const row = screen.getByTestId("ai-chat-composer-row");
        const styledClass = styledClassFor(row);
        expect(styledClass).toBeTruthy();
        const ruleText = ruleTextsFor(styledClass ?? "").join("\n");
        expect(ruleText).toContain("display: flex");
        expect(ruleText).toContain("min-width: 0");
        const { heights, widths } = coarseTouchTargetsFor(styledClass ?? "");
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(...widths)).toBeGreaterThanOrEqual(44);
    });

    it("keeps mobile composer controls compact below the small breakpoint", () => {
        renderComposer();
        const row = screen.getByTestId("ai-chat-composer-row");
        const styledClass = styledClassFor(row);
        expect(styledClass).toBeTruthy();

        const mobileRules = mediaRuleTextsFor(styledClass ?? "", "480px").join(
            "\n"
        );
        expect(mobileRules).toContain("width: 44px");
        expect(mobileRules).toContain("display: none");
    });
});
