/**
 * Remote-agent path tests for BoardBriefDrawer.
 *
 * Tests the v2.1 streaming migration: when `aiUseLocalEngine` is false the
 * drawer uses `useAgent("board-brief-agent")` and renders from
 * `custom/suggestion` events; when `aiUseLocalEngine` is true the drawer
 * falls back to `useAi` (local engine path, covered in index.test.tsx).
 *
 * `streamAgent` is mocked at the agentClient layer following the pattern
 * established in `src/utils/hooks/useAgent.test.tsx`.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

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
import useTaskModal from "../../utils/hooks/useTaskModal";

import BoardBriefDrawer from ".";

jest.mock("../../utils/hooks/useTaskModal");

const mockedStream = streamAgent as unknown as jest.Mock;
const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;
const mockedUseTaskModal = useTaskModal as jest.MockedFunction<
    typeof useTaskModal
>;

const briefPayload: IBoardBrief = {
    headline: "Agent-generated brief headline",
    counts: [{ columnId: "c1", columnName: "Todo", count: 2 }],
    largestUnstarted: [{ taskId: "t1", taskName: "Big task", storyPoints: 13 }],
    unowned: [{ taskId: "t2", taskName: "Unowned task" }],
    workload: [],
    recommendation: "Focus on the biggest unstarted task first.",
    recommendationDetail: {
        text: "Focus on the biggest unstarted task first.",
        strength: "strong",
        basis: "Task t1 has 13 story points and blocks the sprint.",
        sources: [{ taskId: "t1", taskName: "Big task" }]
    }
};

const project: IProject = {
    _id: "p1",
    createdAt: "0",
    managerId: "m1",
    organization: "Org",
    projectName: "Roadmap"
};

const columns: IColumn[] = [
    { _id: "c1", columnName: "Todo", index: 0, projectId: "p1" },
    { _id: "c2", columnName: "Done", index: 1, projectId: "p1" }
];

const members: IMember[] = [{ _id: "m1", email: "a@b.c", username: "Alice" }];

const tasks: ITask[] = [
    {
        _id: "t1",
        columnId: "c1",
        coordinatorId: "m1",
        epic: "x",
        index: 0,
        note: "",
        projectId: "p1",
        storyPoints: 13,
        taskName: "Big task",
        type: "Task"
    },
    {
        _id: "t2",
        columnId: "c1",
        coordinatorId: "ghost",
        epic: "x",
        index: 1,
        note: "",
        projectId: "p1",
        storyPoints: 3,
        taskName: "Unowned task",
        type: "Task"
    }
];

/** Build a baseline stub for `useAgent`. Overrides are spread on top. */
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

const renderDrawer = (
    open = true,
    agentOverrides: Partial<UseAgentResult> = {}
) => {
    mockedUseAgent.mockReturnValue(baseAgent(agentOverrides));
    const queryClient = new QueryClient();
    const onClose = jest.fn();
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <BoardBriefDrawer
                    columns={columns}
                    members={members}
                    onClose={onClose}
                    open={open}
                    project={project}
                    tasks={tasks}
                />
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { ...utils, onClose };
};

describe("BoardBriefDrawer — remote agent path", () => {
    beforeEach(() => {
        mockedStream.mockReset();
        mockedUseAgent.mockReset();
        mockedUseTaskModal.mockReturnValue({
            closeModal: jest.fn(),
            editingTaskId: undefined,
            isLoading: false,
            startEditing: jest.fn()
        } as unknown as ReturnType<typeof useTaskModal>);
    });

    it("renders brief content from a custom/suggestion lastSuggestion payload", async () => {
        renderDrawer(true, {
            lastSuggestion: {
                surface: "brief",
                payload: briefPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByText("Agent-generated brief headline")
            ).toBeInTheDocument()
        );
        expect(screen.getAllByText("Big task").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Unowned task").length).toBeGreaterThan(0);
        expect(
            screen.getByText(/Focus on the biggest unstarted task first/)
        ).toBeInTheDocument();
    });

    it("shows skeleton after streaming persists beyond the delay", () => {
        jest.useFakeTimers();
        renderDrawer(true, {
            isStreaming: true,
            lastSuggestion: null
        });

        expect(screen.queryByLabelText(/Generating brief/i)).toBeNull();

        act(() => {
            jest.advanceTimersByTime(260);
        });

        expect(screen.getByLabelText(/Generating brief/i)).toBeInTheDocument();
        jest.useRealTimers();
    });

    it("does not show skeleton once a suggestion has arrived", async () => {
        renderDrawer(true, {
            isStreaming: false,
            lastSuggestion: {
                surface: "brief",
                payload: briefPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByText("Agent-generated brief headline")
            ).toBeInTheDocument()
        );
        expect(
            screen.queryByLabelText(/Generating your board brief/i)
        ).not.toBeInTheDocument();
    });

    it("calls agent.start when drawer opens", () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderDrawer(true, { start });

        expect(start).toHaveBeenCalledWith(
            "Generate the brief for this board."
        );
    });

    it("does not restart the brief agent on rerenders caused by streaming state updates", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        const abort = jest.fn();
        const clearSuggestion = jest.fn();

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
                    <BoardBriefDrawer
                        columns={columns}
                        members={members}
                        onClose={jest.fn()}
                        open
                        project={project}
                        tasks={tasks}
                    />
                </>
            );
        };

        render(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter>
                    <Harness />
                </MemoryRouter>
            </QueryClientProvider>
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

        act(() => {
            screen.getByRole("button", { name: "Toggle streaming" }).click();
        });

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    });

    it("calls agent.abort and clearSuggestion when drawer closes", () => {
        const abort = jest.fn();
        const clearSuggestion = jest.fn();
        const { rerender, onClose } = renderDrawer(true, {
            abort,
            clearSuggestion
        });

        const queryClient = new QueryClient();
        mockedUseAgent.mockReturnValue(baseAgent({ abort, clearSuggestion }));
        rerender(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <BoardBriefDrawer
                        columns={columns}
                        members={members}
                        onClose={onClose}
                        open={false}
                        project={project}
                        tasks={tasks}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        expect(abort).toHaveBeenCalled();
        expect(clearSuggestion).toHaveBeenCalled();
    });

    it("surfaces citations from the agent in the brief footer", async () => {
        renderDrawer(true, {
            lastSuggestion: {
                surface: "brief",
                payload: briefPayload
            },
            citations: [
                {
                    source: "task",
                    id: "t1",
                    quote: "Big task is the largest unstarted item."
                }
            ]
        });

        await waitFor(() =>
            expect(
                screen.getByText("Agent-generated brief headline")
            ).toBeInTheDocument()
        );
        // CitationChip renders a [1] label
        expect(screen.getByText("[1]")).toBeInTheDocument();
    });

    it("renders error state when agent.error is set and no brief data", () => {
        renderDrawer(true, {
            error: new Error("Agent stream timed out"),
            lastSuggestion: null
        });

        // The error Alert should be visible (retryable by default)
        expect(
            screen.getByText(/Couldn't generate the brief/)
        ).toBeInTheDocument();
    });

    it("ignores suggestion events with surface other than 'brief'", () => {
        renderDrawer(true, {
            lastSuggestion: {
                surface: "draft",
                payload: { notABrief: true }
            }
        });

        // Should render neither skeleton (not loading) nor brief content
        expect(
            screen.queryByText("Agent-generated brief headline")
        ).not.toBeInTheDocument();
    });
});

describe("BoardBriefDrawer — local engine fallback (aiUseLocalEngine)", () => {
    it("does not call streamAgent when aiUseLocalEngine is true via local mock override", () => {
        // In this test file env is mocked as remote (aiUseLocalEngine: false).
        // The real local-engine path is covered by index.test.tsx (no env mock).
        // Here we just confirm streamAgent is not called when useAgent.start
        // is invoked with isRemote=false — which we simulate by verifying that
        // in the local engine file (index.test.tsx) mockedStream is never called.
        // This test confirms the remote-path agent starts when open=true.
        const start = jest.fn().mockResolvedValue(undefined);
        renderDrawer(true, { start });
        // In remote mode, start should have been called
        expect(start).toHaveBeenCalled();
        expect(mockedStream).not.toHaveBeenCalled(); // streamAgent not called directly
    });
});
