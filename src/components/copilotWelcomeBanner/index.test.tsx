import { fireEvent, render, screen } from "@testing-library/react";

import { microcopy } from "../../constants/microcopy";
import CopilotWelcomeBanner from "./index";

const KEY = "test:welcome";

describe("CopilotWelcomeBanner", () => {
    beforeEach(() => {
        try {
            window.localStorage.clear();
        } catch {
            /* private-mode browsers raise here; ignore */
        }
    });

    it("renders the welcome copy on first mount", () => {
        render(<CopilotWelcomeBanner storageKey={KEY} />);
        expect(
            screen.getByText(microcopy.ai.welcomeBannerTitle)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.ai.welcomeBannerBody)
        ).toBeInTheDocument();
    });

    it("dismisses and never re-renders after the close button is pressed", () => {
        const { rerender } = render(<CopilotWelcomeBanner storageKey={KEY} />);
        // Two buttons share the dismiss aria-label (the X icon and the
        // text "Dismiss"); pick the icon button via the close icon path.
        const dismissButtons = screen.getAllByRole("button", {
            name: microcopy.ai.welcomeBannerDismiss
        });
        fireEvent.click(dismissButtons[0]);
        expect(
            screen.queryByText(microcopy.ai.welcomeBannerTitle)
        ).not.toBeInTheDocument();
        // Mounting fresh should still see the dismissed state via storage.
        rerender(<CopilotWelcomeBanner storageKey={KEY} />);
        expect(
            screen.queryByText(microcopy.ai.welcomeBannerTitle)
        ).not.toBeInTheDocument();
    });

    it("invokes onCta when supplied and dismisses the banner", () => {
        const onCta = jest.fn();
        render(<CopilotWelcomeBanner storageKey={KEY} onCta={onCta} />);
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.welcomeBannerCta
            })
        );
        expect(onCta).toHaveBeenCalledTimes(1);
        expect(
            screen.queryByText(microcopy.ai.welcomeBannerTitle)
        ).not.toBeInTheDocument();
    });

    it("dispatches `boardCopilot:openChat` with the canonical prompt when no onCta is supplied", () => {
        // The default CTA opens chat pre-filled with "Summarize this
        // board" — see PRD §8.1 + the 04·F11 review note. The host page
        // already listens for `boardCopilot:openChat` (board.tsx /
        // project.tsx); reusing that hook keeps the chat-open path
        // single-sourced.
        const handler = jest.fn();
        window.addEventListener("boardCopilot:openChat", handler);
        try {
            render(<CopilotWelcomeBanner storageKey={KEY} />);
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.ai.welcomeBannerCta
                })
            );
            expect(handler).toHaveBeenCalledTimes(1);
            const event = handler.mock.calls[0][0] as CustomEvent<{
                prompt: string;
            }>;
            expect(event.detail?.prompt).toBe(
                microcopy.ai.welcomeBannerCtaPrompt
            );
            expect(
                screen.queryByText(microcopy.ai.welcomeBannerTitle)
            ).not.toBeInTheDocument();
        } finally {
            window.removeEventListener("boardCopilot:openChat", handler);
        }
    });

    it("does not dispatch `boardCopilot:openChat` when onCta is supplied (host owns the open)", () => {
        const handler = jest.fn();
        window.addEventListener("boardCopilot:openChat", handler);
        try {
            const onCta = jest.fn();
            render(<CopilotWelcomeBanner storageKey={KEY} onCta={onCta} />);
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.ai.welcomeBannerCta
                })
            );
            expect(onCta).toHaveBeenCalledTimes(1);
            expect(handler).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener("boardCopilot:openChat", handler);
        }
    });
});
