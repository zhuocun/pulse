/**
 * Remote-agent path tests for AiSearchInput.
 *
 * Tests the v2.1 streaming migration: when `aiUseLocalEngine` is false the
 * component uses `useAgent("search-agent")` and renders from
 * `surface:"search"` suggestion events; local-engine path is covered by
 * index.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { UseAgentResult } from "../../utils/hooks/useAgent";

jest.mock("../../utils/ai/agentClient", () => {
    const actual = jest.requireActual<
        typeof import("../../utils/ai/agentClient")
    >("../../utils/ai/agentClient");
    return {
        __esModule: true,
        ...actual,
        streamAgent: jest.fn()
    };
});

jest.mock("../../utils/hooks/useAgent", () => ({
    __esModule: true,
    default: jest.fn()
}));

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiBaseUrl: "https://agents.example",
        aiEnabled: true,
        aiUseLocalEngine: false,
        apiBaseUrl: "/api/v1"
    }
}));

// eslint-disable-next-line simple-import-sort/imports
import { streamAgent } from "../../utils/ai/agentClient";
import useAgent from "../../utils/hooks/useAgent";
import useAiEnabled from "../../utils/hooks/useAiEnabled";

import AiSearchInput from ".";

jest.mock("../../utils/hooks/useAiEnabled");

const mockedStream = streamAgent as unknown as jest.Mock;
const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const baseAgent = (
    overrides: Partial<UseAgentResult> = {}
): UseAgentResult => ({
    start: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn(),
    seedMessages: jest.fn(),
    isStreaming: false,
    status: "idle",
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
    isSlowTtft: false,
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
            note: "token expiry",
            projectId: "p1",
            storyPoints: 3,
            taskName: "Fix flaky login",
            type: "Bug"
        }
    ]
};

const renderInput = (agentOverrides: Partial<UseAgentResult> = {}) => {
    mockedUseAgent.mockReturnValue(baseAgent(agentOverrides));
    const queryClient = new QueryClient();
    const setSemanticIds = jest.fn();
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <AiSearchInput
                kind="tasks"
                projectContext={projectContext}
                semanticIds={undefined}
                setSemanticIds={setSemanticIds}
            />
        </QueryClientProvider>
    );
    return { ...utils, setSemanticIds };
};

describe("AiSearchInput — remote agent path", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedStream.mockReset();
        mockedUseAgent.mockReset();
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("calls agent.start with structured search input when the user submits", () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderInput({ start });

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            { target: { value: "login token" } }
        );
        fireEvent.click(
            screen.getByRole("button", { name: /Find related tasks/i })
        );

        expect(start).toHaveBeenCalledWith(
            { query: "login token", kind: "tasks" },
            { autonomy: "suggest" }
        );
        expect(mockedStream).not.toHaveBeenCalled();
    });

    it("renders search results from a surface:search suggestion event", async () => {
        const { setSemanticIds } = renderInput({
            lastSuggestion: {
                surface: "search",
                payload: {
                    ids: ["t-login"],
                    matches: [{ id: "t-login", strength: "strong" }],
                    rationale: "Login tasks match your query.",
                    expandedTerms: []
                }
            }
        });

        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalledWith("t-login");
        });
    });

    it("falls back to ids ordering when matches is absent", async () => {
        const { setSemanticIds } = renderInput({
            lastSuggestion: {
                surface: "search",
                payload: {
                    ids: ["t-login"],
                    rationale: "Match without strengths."
                }
            }
        });

        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalledWith("t-login");
        });
    });

    it("shows streaming indicator while agent is streaming", () => {
        renderInput({ isStreaming: true });

        expect(screen.getAllByText(/Searching/i).length).toBeGreaterThan(0);
    });

    it("ignores suggestion events with surface other than 'search'", () => {
        const { setSemanticIds } = renderInput({
            lastSuggestion: {
                surface: "brief",
                payload: { notSearch: true }
            }
        });

        expect(setSemanticIds).not.toHaveBeenCalled();
    });

    it("calls agent.abort and clearSuggestion when clear button is clicked", () => {
        const abort = jest.fn();
        const clearSuggestion = jest.fn();
        mockedUseAgent.mockReturnValue(baseAgent({ abort, clearSuggestion }));

        render(
            <QueryClientProvider client={new QueryClient()}>
                <AiSearchInput
                    kind="tasks"
                    projectContext={projectContext}
                    semanticIds="t-login"
                    setSemanticIds={jest.fn()}
                />
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByLabelText("Clear AI search"));
        expect(abort).toHaveBeenCalled();
        expect(clearSuggestion).toHaveBeenCalled();
    });

    it("calls agent.abort and clearSuggestion on unmount", () => {
        const abort = jest.fn();
        const clearSuggestion = jest.fn();
        mockedUseAgent.mockReturnValue(baseAgent({ abort, clearSuggestion }));

        const { unmount } = render(
            <QueryClientProvider client={new QueryClient()}>
                <AiSearchInput
                    kind="tasks"
                    projectContext={projectContext}
                    semanticIds={undefined}
                    setSemanticIds={jest.fn()}
                />
            </QueryClientProvider>
        );

        unmount();
        expect(abort).toHaveBeenCalled();
        expect(clearSuggestion).toHaveBeenCalled();
    });

    it("does not abort an active remote search on rerenders caused by agent state updates", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        const abort = jest.fn();
        const clearSuggestion = jest.fn();

        const queryClient = new QueryClient();
        const setSemanticIds = jest.fn();

        const Harness = () => {
            const [streaming, setStreaming] = useState(false);

            mockedUseAgent.mockImplementation(() =>
                baseAgent({
                    start,
                    abort,
                    clearSuggestion,
                    isStreaming: streaming
                })
            );

            return (
                <>
                    <button onClick={() => setStreaming(true)} type="button">
                        Toggle streaming
                    </button>
                    <AiSearchInput
                        kind="tasks"
                        projectContext={projectContext}
                        semanticIds={undefined}
                        setSemanticIds={setSemanticIds}
                    />
                </>
            );
        };

        render(
            <QueryClientProvider client={queryClient}>
                <Harness />
            </QueryClientProvider>
        );

        fireEvent.change(
            screen.getByRole("textbox", {
                name: /Find related tasks with AI/i
            }),
            { target: { value: "login token" } }
        );
        fireEvent.click(
            screen.getByRole("button", { name: /Find related tasks/i })
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        expect(abort).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", { name: "Toggle streaming" })
        );

        await waitFor(() => {
            expect(abort).not.toHaveBeenCalled();
        });
    });

    it("surfaces agent error as an error alert", () => {
        renderInput({ error: new Error("Search agent timed out") });

        // aiErrorView replaces the raw message with the surface-specific heading
        expect(screen.getAllByText(/Search failed/i).length).toBeGreaterThan(0);
        expect(
            screen.queryByText("Search agent timed out")
        ).not.toBeInTheDocument();
    });

    it("uses submitted query for reformulations when draft changes before remote result returns", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        const clearSuggestion = jest.fn();
        const submittedQuery = "fix flaky login button issue";

        let agentState: Pick<
            UseAgentResult,
            "isStreaming" | "lastSuggestion"
        > = {
            isStreaming: false,
            lastSuggestion: null
        };

        mockedUseAgent.mockImplementation(() =>
            baseAgent({
                start,
                clearSuggestion,
                isStreaming: agentState.isStreaming,
                lastSuggestion: agentState.lastSuggestion
            })
        );

        const queryClient = new QueryClient();
        const setSemanticIds = jest.fn();

        const Harness = ({ revision }: { revision: number }) => (
            <QueryClientProvider client={queryClient}>
                <span data-revision={revision} hidden />
                <AiSearchInput
                    kind="tasks"
                    projectContext={projectContext}
                    semanticIds={undefined}
                    setSemanticIds={setSemanticIds}
                />
            </QueryClientProvider>
        );

        const { rerender } = render(<Harness revision={0} />);

        const input = screen.getByRole("textbox", {
            name: /Find related tasks with AI/i
        });
        fireEvent.change(input, { target: { value: submittedQuery } });
        fireEvent.click(
            screen.getByRole("button", { name: /Find related tasks/i })
        );

        expect(start).toHaveBeenCalledWith(
            { query: submittedQuery, kind: "tasks" },
            { autonomy: "suggest" }
        );

        fireEvent.change(input, {
            target: { value: "quantum entanglement" }
        });

        agentState = {
            isStreaming: false,
            lastSuggestion: {
                surface: "search",
                payload: {
                    ids: [],
                    rationale: "No tasks matched your query.",
                    expandedTerms: []
                }
            }
        };
        rerender(<Harness revision={1} />);

        await waitFor(() => {
            expect(setSemanticIds).toHaveBeenCalledWith(undefined);
        });

        expect(screen.getByText("fix flaky")).toBeInTheDocument();
        expect(
            screen.queryByText("tasks about quantum entanglement")
        ).not.toBeInTheDocument();
    });
});
