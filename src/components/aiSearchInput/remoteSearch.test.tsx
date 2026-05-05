import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiBaseUrl: "https://copilot.example",
        aiEnabled: true,
        aiUseLocalEngine: false,
        apiBaseUrl: "/api/v1"
    }
}));

jest.mock("../../utils/hooks/useAgent", () => ({
    __esModule: true,
    default: jest.fn()
}));

import useAgent from "../../utils/hooks/useAgent";
import type { UseAgentResult } from "../../utils/hooks/useAgent";

jest.mock("../../utils/hooks/useAiEnabled", () => ({
    __esModule: true,
    default: () => ({
        available: true,
        enabled: true,
        setEnabled: jest.fn()
    })
}));

import AiSearchInput from ".";

const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;

const baseAgent = (
    overrides: Partial<UseAgentResult> = {}
): UseAgentResult => ({
    start: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn(),
    isStreaming: false,
    state: { messages: [] },
    pendingInterrupt: null,
    pendingProposal: null,
    citations: [],
    nudges: [],
    lastSuggestion: null,
    error: null,
    reset: jest.fn(),
    threadId: "t_test",
    ttftMs: null,
    clearPendingProposal: jest.fn(),
    clearSuggestion: jest.fn(),
    dismissNudge: jest.fn(),
    ...overrides
});

const projectContext = {
    project: { _id: "p1", projectName: "Roadmap" },
    columns: [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }],
    members: [{ _id: "m1", email: "a@b.c", username: "Alice" }],
    tasks: [
        {
            _id: "t-login",
            columnId: "c1",
            coordinatorId: "m1",
            epic: "Auth",
            index: 0,
            note: "",
            projectId: "p1",
            storyPoints: 3,
            taskName: "Fix flaky login",
            type: "Bug"
        }
    ]
};

describe("AiSearchInput remote search transport", () => {
    beforeEach(() => {
        mockedUseAgent.mockReset();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("shows a failure hint when the remote agent errors", async () => {
        mockedUseAgent.mockReturnValue(
            baseAgent({ error: new Error("Agent stream failed") })
        );

        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={jest.fn()}
            />
        );

        await waitFor(() => {
            expect(
                screen.getAllByText(/Search failed/i).length
            ).toBeGreaterThan(0);
        });
    });

    it("dismisses the remote search failure alert", async () => {
        mockedUseAgent.mockReturnValue(
            baseAgent({ error: new Error("Agent stream failed") })
        );

        render(
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={jest.fn()}
            />
        );

        await waitFor(() => {
            expect(
                screen.getAllByText(/Search failed/i).length
            ).toBeGreaterThan(0);
        });

        const alerts = screen.getAllByRole("alert");
        const failureAlert = alerts.find((el) =>
            el.textContent?.includes("Search failed")
        );
        expect(failureAlert).toBeTruthy();
        fireEvent.click(
            failureAlert!.querySelector(".ant-alert-close-icon") as HTMLElement
        );

        await waitFor(() => {
            expect(
                screen.queryByText(/Search failed\. Try again\./i)
            ).not.toBeInTheDocument();
        });
    });
});
