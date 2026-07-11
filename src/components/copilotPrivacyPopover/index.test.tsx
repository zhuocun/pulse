import { fireEvent, render, screen } from "@testing-library/react";

import { declaresTouchTarget } from "@/components/ui/testHelpers";

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

    it("declares a coarse-pointer touch target of at least 44 px", () => {
        render(<CopilotPrivacyPopover />);
        const trigger = screen.getByRole("button", {
            name: microcopy.ai.privacyLink
        });
        // The Tailwind primitives express the 44px coarse floor via the
        // canonical `TOUCH_TARGET` utility class rather than an emotion
        // rule, since Tailwind's compiled stylesheet is not loaded in jsdom.
        expect(declaresTouchTarget(trigger)).toBe(true);
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

    /*
     * Lane M follow-up (PR #309 review): the ghost-text surface used
     * to fall back to the generic global disclosure copy because
     * `task-note` wasn't a key in `AI_DATA_SCOPES`. Now that
     * `aiDataScope` carries a dedicated entry, asserting the
     * route-specific summary appears confirms the wiring is complete.
     */
    it("renders the task-note specific scope copy when route=task-note", () => {
        render(<CopilotPrivacyPopover route="task-note" />);
        fireEvent.click(
            screen.getByRole("button", { name: microcopy.ai.privacyLink })
        );
        // The summary is the load-bearing contract — it's the first
        // line a user reads when the popover opens and it varies by
        // surface. A regression that drops the `task-note` scope
        // entry would surface the generic privacy disclosure here.
        expect(
            screen.getByText(/Ghost-text completions use the task/i)
        ).toBeInTheDocument();
        // The bullet list also has to call out the ghost-text-only
        // fields (column, task name + type, in-progress note text)
        // so the user can see exactly what the engine reads.
        expect(
            screen.getByText(/The column you're editing in/i)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/The in-progress note text/i)
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

    /*
     * Followup C (PR #308 review): users who dismissed the legacy
     * global `boardCopilot:privacyShown` key before the F10 fix shipped
     * must not be re-prompted on every route the next time they open a
     * Copilot surface. The migration treats the legacy "dismissed"
     * signal as global dismissal — when the new route-scoped key is
     * unset *and* the legacy key is "1", the disclosure stays
     * acknowledged.
     */
    describe("Followup C — legacy storage-key migration", () => {
        it("honors a legacy global dismissal on a fresh route (no re-prompt)", () => {
            // Pre-existing user: dismissed under the legacy global key
            // before the route-scoped split.
            window.localStorage.setItem("boardCopilot:privacyShown", "1");
            const { container } = render(
                <CopilotPrivacyDisclosure route="estimate" />
            );
            // Even though `boardCopilot:privacyShown:estimate` was
            // never set, the legacy "1" suppresses the disclosure.
            expect(container.firstChild).toBeNull();
        });

        it("still renders the disclosure when no keys are set at all", () => {
            // Net-new user, neither key seeded.
            render(<CopilotPrivacyDisclosure route="estimate" />);
            expect(
                screen.getByText(microcopy.ai.privacyTitle)
            ).toBeInTheDocument();
        });

        it("does not honor the legacy key when the caller passes an explicit storageKey override", () => {
            // Legacy global key is set, but the caller supplied its own
            // storageKey — the migration must respect that override and
            // surface the disclosure normally.
            window.localStorage.setItem("boardCopilot:privacyShown", "1");
            render(<CopilotPrivacyDisclosure storageKey="test:explicit" />);
            expect(
                screen.getByText(microcopy.ai.privacyTitle)
            ).toBeInTheDocument();
        });
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
