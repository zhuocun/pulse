import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import environment from "../../constants/env";
import type { AutonomyLevel } from "../../interfaces/agent";
import * as agentClient from "../../utils/ai/agentClient";
import CopilotAboutPopover from "./index";

const setLocal = (value: boolean) => {
    Object.defineProperty(environment, "aiUseLocalEngine", {
        configurable: true,
        value,
        writable: true
    });
};

const setAiBaseUrl = (value: string) => {
    Object.defineProperty(environment, "aiBaseUrl", {
        configurable: true,
        value,
        writable: true
    });
};

describe("CopilotAboutPopover", () => {
    const originalUseLocal = environment.aiUseLocalEngine;
    const originalAiBaseUrl = environment.aiBaseUrl;

    afterEach(() => {
        setLocal(originalUseLocal);
        setAiBaseUrl(originalAiBaseUrl);
        agentClient.clearAgentMetadataSessionCache();
        jest.restoreAllMocks();
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
            screen.getByText("Knowledge cutoff: January 2026")
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

    it("does not render server metadata section in local mode", () => {
        const getMetadataSpy = jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        );
        setLocal(true);
        setAiBaseUrl("https://agents.example");
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(
            screen.queryByText("Server-advertised limits")
        ).not.toBeInTheDocument();
        expect(getMetadataSpy).not.toHaveBeenCalled();
    });

    it("does not render server metadata section when remote base URL is empty", () => {
        const getMetadataSpy = jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        );
        setLocal(false);
        setAiBaseUrl("");
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(
            screen.queryByText("Server-advertised limits")
        ).not.toBeInTheDocument();
        expect(getMetadataSpy).not.toHaveBeenCalled();
    });

    it("shows server limits from chat-agent metadata when remote with base URL", async () => {
        jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        ).mockResolvedValue({
            name: "chat-agent",
            version: "1.1.0",
            description: "chat",
            status: "active",
            allowed_autonomy: ["suggest", "plan"] as AutonomyLevel[],
            rate_limit: { per_minute: 20, per_hour: 200 },
            recursion_limit: 12,
            tags: ["stable", "fast-path"],
            context_schema: {
                project_id: "string",
                thread_id: "string"
            }
        });
        setLocal(false);
        setAiBaseUrl("https://agents.example");
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        expect(
            screen.getByText("Server-advertised limits")
        ).toBeInTheDocument();
        await waitFor(() => {
            expect(
                screen.getByText("Rate limit: 20 / min · 200 / hour")
            ).toBeInTheDocument();
        });
        expect(screen.getByText("Recursion limit: 12")).toBeInTheDocument();
        expect(screen.getByText("Tags:")).toBeInTheDocument();
        expect(screen.getByText("stable")).toBeInTheDocument();
        expect(screen.getByText("fast-path")).toBeInTheDocument();
        expect(
            screen.getByText("Context schema keys: project_id, thread_id")
        ).toBeInTheDocument();
        expect(screen.getByText("suggest")).toBeInTheDocument();
        expect(screen.getByText("plan")).toBeInTheDocument();
    });

    it("shows a graceful empty state when metadata has no disclosed limits", async () => {
        jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        ).mockResolvedValue({
            name: "chat-agent",
            version: "1.1.0",
            description: "chat",
            status: "active",
            allowed_autonomy: []
        });
        setLocal(false);
        setAiBaseUrl("https://agents.example");
        render(<CopilotAboutPopover />);
        fireEvent.click(
            screen.getByRole("button", { name: "About Board Copilot" })
        );
        await waitFor(() => {
            expect(
                screen.getByText(
                    "Server did not publish additional limit details."
                )
            ).toBeInTheDocument();
        });
    });
});
