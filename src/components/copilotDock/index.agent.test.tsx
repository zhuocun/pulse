/**
 * Remote-agent path tests for CopilotDock.
 *
 * The dock and bodies behave differently when `aiUseLocalEngine=false`:
 * Brief uses `useAgent("board-brief-agent")` and the start/abort lifecycle
 * is wired through that hook instead of the local `useAi` request. These
 * tests exist in their own file because they need a file-wide
 * `jest.mock("constants/env", ...)` to flip the engine — the dock-level
 * tests in `index.test.tsx` run under the default test-env local engine
 * and would break if env were globally overridden there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        aiBaseUrl: "https://agents.example",
        aiEnabled: true,
        aiUseLocalEngine: false,
        aiMutationProposalsEnabled: false,
        aiKnowledgeCutoff: "January 2026",
        bottomNavEnabled: true,
        taskPanelRouted: false,
        copilotDockEnabled: true,
        apiBaseUrl: "/api/v1"
    }
}));

jest.mock("../../utils/hooks/useAgent", () => ({
    __esModule: true,
    default: jest.fn()
}));

jest.mock("../../utils/hooks/useAgentChat", () => ({
    __esModule: true,
    default: jest.fn()
}));

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

// eslint-disable-next-line simple-import-sort/imports
import useAgent from "../../utils/hooks/useAgent";
import useAgentChat from "../../utils/hooks/useAgentChat";
import {
    acknowledgeRemoteAi,
    resetRemoteAiConsentForTests
} from "../../utils/ai/remoteAiConsent";
import type { UseAgentResult } from "../../utils/hooks/useAgent";
import type { UseAgentChatResult } from "../../utils/hooks/useAgentChat";

import CopilotDock, { type CopilotDockTab } from ".";

const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;
const mockedUseAgentChat = useAgentChat as jest.MockedFunction<
    typeof useAgentChat
>;

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

const baseAgentChat = (
    overrides: Partial<UseAgentChatResult> = {}
): UseAgentChatResult => ({
    abort: jest.fn(),
    dismissError: jest.fn(),
    error: null,
    isLoading: false,
    messages: [],
    reset: jest.fn(),
    seedMessages: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
    streamingText: "",
    pendingProposal: null,
    pendingNudges: [],
    citations: [],
    resumeProposal: jest.fn(),
    dismissNudge: jest.fn(),
    ...overrides
});

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
    class ResizeObserverMock {
        observe = jest.fn();
        unobserve = jest.fn();
        disconnect = jest.fn();
    }
    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    index: 0,
    projectId: "project-1",
    ...overrides
});

interface ControlledDockProps {
    initialTab?: CopilotDockTab;
}

const ControlledDock: React.FC<ControlledDockProps> = ({
    initialTab = "brief"
}) => {
    const [activeTab, setActiveTab] = useState<CopilotDockTab>(initialTab);
    return (
        <CopilotDock
            activeTab={activeTab}
            columns={[column()]}
            knownProjectIds={["project-1"]}
            members={[member()]}
            onClose={jest.fn()}
            onTabChange={setActiveTab}
            open
            project={project()}
            tasks={[]}
        />
    );
};

const renderControlled = (props: ControlledDockProps = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AntdApp>
                        <ControlledDock {...props} />
                    </AntdApp>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("CopilotDock — remote agent path", () => {
    beforeEach(() => {
        installAntdBrowserMocks();
        resetRemoteAiConsentForTests();
        acknowledgeRemoteAi("https://agents.example");
        mockedUseAgent.mockReset();
        mockedUseAgentChat.mockReset();
        mockedUseAgent.mockReturnValue(baseAgent());
        mockedUseAgentChat.mockReturnValue(baseAgentChat());
    });

    afterEach(() => {
        resetRemoteAiConsentForTests();
    });

    it("does not show or enforce the offline health state before remote AI consent", () => {
        resetRemoteAiConsentForTests();
        renderControlled({ initialTab: "chat" });

        expect(
            screen.getByText(microcopy.ai.remoteConsentTitle)
        ).toBeInTheDocument();
        expect(
            screen.queryByText(microcopy.ai.healthOffline)
        ).not.toBeInTheDocument();

        fireEvent.change(
            screen.getByLabelText(microcopy.a11y.messageBoardCopilot),
            { target: { value: "What should I look at first?" } }
        );
        expect(
            screen.getByRole("button", { name: microcopy.a11y.sendMessage })
        ).toBeEnabled();
    });

    /*
     * R-A H1 / R-A L2: switching from Brief → Chat → Brief while a brief
     * stream is in flight (or has rendered) must NOT re-dispatch
     * `startRemoteBrief`. The previous effect re-fired start on every
     * surfaceVisible flip, which aborted the in-flight stream and reset
     * the per-turn state inside `useAgent` for no user-visible reason.
     *
     * Stateful mock: first render returns `isStreaming=false` so the
     * gate (`!isStreaming && !suggestion`) lets the initial start
     * through; after that we flip the stub to `isStreaming=true` so a
     * repeat surfaceVisible flip (tab switch back) is correctly blocked.
     */
    it("only calls startRemoteBrief once across a Brief → Chat → Brief round-trip (R-A H1/L2)", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        let streaming = false;
        // Each call to useAgent re-reads the closed-over `streaming` so
        // re-renders pick up the flip without React.useState churn.
        mockedUseAgent.mockImplementation(() =>
            baseAgent({ start, isStreaming: streaming })
        );
        // Once start is called, simulate the agent entering streaming
        // mode so subsequent re-renders see the gate as closed.
        start.mockImplementation(async () => {
            streaming = true;
        });
        renderControlled({ initialTab: "brief" });

        // First mount on Brief → exactly one start call.
        await waitFor(() => {
            expect(start).toHaveBeenCalledTimes(1);
        });
        expect(start).toHaveBeenCalledWith(
            microcopy.ai.generateBoardBriefPrompt,
            { autonomy: "suggest" }
        );

        // Switch to Chat. surfaceVisible flips false on Brief; the
        // teardown branch is gated on `dockOpen` (still true), so no
        // abort either.
        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabChat as string
            })
        );
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabChat as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });
        expect(start).toHaveBeenCalledTimes(1);

        // Switch back to Brief. surfaceVisible flips true again; the
        // fix gates the start call on `!isStreaming && !lastSuggestion`,
        // so it must NOT fire again — the in-flight stream from the
        // first call is still running and would be aborted by a second
        // start (useAgent.start() calls controllerRef.current?.abort()).
        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabBrief as string
            })
        );
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });

        // The critical assertion: still exactly one call.
        expect(start).toHaveBeenCalledTimes(1);
    });

    /*
     * Even when the brief has already streamed to completion (no longer
     * `isStreaming`, suggestion rendered), returning to the tab must
     * NOT restart it — the cached suggestion is what the user is
     * looking at, and a restart would clear it via the per-turn reset
     * inside `useAgent.start()`.
     */
    it("does not restart when a suggestion is already rendered", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        mockedUseAgent.mockReturnValue(
            baseAgent({
                start,
                isStreaming: false,
                lastSuggestion: {
                    surface: "brief",
                    payload: {
                        headline: "Cached",
                        counts: [],
                        largestUnstarted: [],
                        unowned: [],
                        workload: []
                    }
                }
            })
        );
        renderControlled({ initialTab: "brief" });

        // Suggestion already present → no first start either.
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });
        expect(start).not.toHaveBeenCalled();

        // Round-trip Chat → Brief.
        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabChat as string
            })
        );
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabChat as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });
        fireEvent.click(
            screen.getByRole("tab", {
                name: microcopy.copilotDock.tabBrief as string
            })
        );
        await waitFor(() => {
            expect(
                screen.getByRole("tab", {
                    name: microcopy.copilotDock.tabBrief as string,
                    selected: true
                })
            ).toBeInTheDocument();
        });

        // Still zero starts — the cached suggestion stays put.
        expect(start).not.toHaveBeenCalled();
    });
});
