import { fireEvent, render, screen } from "@testing-library/react";

import environment from "../../constants/env";
import CopilotAboutPopover from "./index";

const setLocal = (value: boolean) => {
    Object.defineProperty(environment, "aiUseLocalEngine", {
        configurable: true,
        value,
        writable: true
    });
};

describe("CopilotAboutPopover", () => {
    const originalUseLocal = environment.aiUseLocalEngine;

    afterEach(() => {
        setLocal(originalUseLocal);
    });

    it("renders the trigger button with the correct aria-label", () => {
        render(<CopilotAboutPopover />);
        expect(
            screen.getByRole("button", { name: "About Board Copilot" })
        ).toBeInTheDocument();
    });

    it("opens the popover and shows capabilities content when clicked", () => {
        render(<CopilotAboutPopover />);
        const trigger = screen.getByRole("button", {
            name: "About Board Copilot"
        });
        fireEvent.click(trigger);
        expect(screen.getByText("About Board Copilot")).toBeInTheDocument();
        expect(
            screen.getByText("What Board Copilot can help with")
        ).toBeInTheDocument();
        expect(screen.getByText("Search and filter tasks")).toBeInTheDocument();
        expect(screen.getByText("Summarize board status")).toBeInTheDocument();
        expect(screen.getByText("Draft new tasks")).toBeInTheDocument();
        expect(
            screen.getByText("Estimate effort for tasks")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Answer questions about your project")
        ).toBeInTheDocument();
    });

    it("shows limitations section when popover is open", () => {
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(screen.getByText("What it cannot do")).toBeInTheDocument();
        expect(
            screen.getByText("Access the internet or external data")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Modify tasks without your review (in Plan mode)")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Remember conversations from previous sessions")
        ).toBeInTheDocument();
    });

    it("shows knowledge cutoff when popover is open", () => {
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(
            screen.getByText("Knowledge cutoff: January 2025")
        ).toBeInTheDocument();
    });

    it("shows remote model info and tag when using a remote engine", () => {
        setLocal(false);
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(screen.getByText("Remote model")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Powered by a remote AI model. Your data is processed according to your privacy settings."
            )
        ).toBeInTheDocument();
    });

    it("shows local engine info and tag when using the local engine", () => {
        setLocal(true);
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(screen.getByText("Local engine")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Running on a local AI engine. Your data stays on this device."
            )
        ).toBeInTheDocument();
    });
});
