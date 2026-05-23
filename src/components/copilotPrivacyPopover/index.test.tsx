import { fireEvent, render, screen } from "@testing-library/react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import CopilotPrivacyPopover, { CopilotPrivacyDisclosure } from "./index";

const setLocal = (value: boolean) => {
    Object.defineProperty(environment, "aiUseLocalEngine", {
        configurable: true,
        value,
        writable: true
    });
};

describe("CopilotPrivacyPopover", () => {
    const originalUseLocal = environment.aiUseLocalEngine;

    afterEach(() => {
        setLocal(originalUseLocal);
    });

    it("renders the inline trigger with the privacy link copy", () => {
        render(<CopilotPrivacyPopover />);
        expect(
            screen.getByRole("button", { name: microcopy.ai.privacyLink })
        ).toBeInTheDocument();
    });

    it("opens the popover and shows the route-specific scope when route is set", () => {
        render(<CopilotPrivacyPopover route="board-brief" />);
        const trigger = screen.getByRole("button", {
            name: microcopy.ai.privacyLink
        });
        fireEvent.click(trigger);
        // board-brief explicitly does not include task notes — the
        // bullet list copy is asserted as the contract surface that
        // backstops the data scope.
        expect(screen.getByText(/no task notes are sent/i)).toBeInTheDocument();
    });

    it("shows the local engine label and disclosure in local mode", () => {
        setLocal(true);
        render(<CopilotPrivacyPopover route="chat" />);
        fireEvent.click(
            screen.getByRole("button", { name: microcopy.ai.privacyLink })
        );
        expect(
            screen.getByText(microcopy.ai.processingModeLocalLabel)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.ai.localProcessingDisclosure)
        ).toBeInTheDocument();
    });
});

describe("CopilotPrivacyDisclosure", () => {
    beforeEach(() => {
        // Each test starts with a fresh acknowledgement state.
        try {
            window.localStorage.clear();
        } catch {
            /* private-mode browsers raise here; ignore */
        }
    });

    it("renders by default and disappears once acknowledged", () => {
        render(<CopilotPrivacyDisclosure storageKey="test:privacy" />);
        expect(screen.getByText(microcopy.ai.privacyTitle)).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.privacyAcknowledge
            })
        );
        expect(
            screen.queryByText(microcopy.ai.privacyTitle)
        ).not.toBeInTheDocument();
    });

    it("stays dismissed across remounts via localStorage", () => {
        const key = "test:privacy:persistent";
        window.localStorage.setItem(key, "1");
        const { container } = render(
            <CopilotPrivacyDisclosure storageKey={key} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("namespaces the default storage key by route (Review F10)", () => {
        // Each surface ships a different data scope; acknowledging chat
        // must not silently dismiss the estimate disclosure (and vice
        // versa). Pre-seeding the chat-scoped key should leave the
        // estimate-route render untouched.
        window.localStorage.setItem("boardCopilot:privacyShown:chat", "1");
        // Chat is acknowledged → null render.
        const { container, unmount } = render(
            <CopilotPrivacyDisclosure route="chat" />
        );
        expect(container.firstChild).toBeNull();
        unmount();
        // A fresh mount on a different route still surfaces the
        // disclosure because that key was never set.
        render(<CopilotPrivacyDisclosure route="estimate" />);
        expect(screen.getByText(microcopy.ai.privacyTitle)).toBeInTheDocument();
    });

    it("writes the route-scoped key when the user acknowledges", () => {
        render(<CopilotPrivacyDisclosure route="board-brief" />);
        fireEvent.click(
            screen.getByRole("button", {
                name: microcopy.ai.privacyAcknowledge
            })
        );
        expect(
            window.localStorage.getItem("boardCopilot:privacyShown:board-brief")
        ).toBe("1");
        // Other routes remain untouched.
        expect(
            window.localStorage.getItem("boardCopilot:privacyShown:chat")
        ).toBeNull();
    });
});
