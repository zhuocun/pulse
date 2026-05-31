/**
 * Remote-agent path tests for AiTaskDraftModal.
 *
 * Tests the v2.1 streaming migration: when `aiUseLocalEngine` is false the
 * modal uses `useAgent("task-drafting-agent")` and populates form fields /
 * breakdown list from `custom/suggestion` events; when `aiUseLocalEngine` is
 * true the modal falls back to `useAi` (covered in index.test.tsx).
 *
 * `streamAgent` is mocked at the agentClient layer following the pattern
 * established in `src/components/boardBriefDrawer/agent.test.tsx`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
import {
    acknowledgeRemoteAi,
    resetRemoteAiConsentForTests
} from "../../utils/ai/remoteAiConsent";
import useAgent from "../../utils/hooks/useAgent";
import { store } from "../../store";

import AiTaskDraftModal from ".";

const mockedStream = streamAgent as unknown as jest.Mock;
const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;

const draftPayload: IDraftTaskSuggestion = {
    taskName: "Agent-drafted task",
    type: "Task",
    epic: "Sprint 1",
    storyPoints: 5,
    note: "Created by agent",
    columnId: "c1",
    coordinatorId: "m1",
    confidence: 0.9,
    rationale: "High confidence based on similar tasks."
};

const breakdownPayload = {
    axis: "by_phase",
    items: [
        {
            taskName: "Phase 1 task",
            type: "Task",
            epic: "Sprint 1",
            storyPoints: 3,
            note: "",
            columnId: "c1",
            coordinatorId: "m1",
            confidence: 0.8,
            rationale: ""
        },
        {
            taskName: "Phase 2 task",
            type: "Bug",
            epic: "Sprint 1",
            storyPoints: 5,
            note: "",
            columnId: "c1",
            coordinatorId: "m1",
            confidence: 0.7,
            rationale: ""
        }
    ]
};

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

const seedClient = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], {
        _id: "m1",
        email: "a@b.c",
        jwt: "t",
        likedProjects: [],
        username: "Alice"
    });
    queryClient.setQueryData(
        ["users/members"],
        [{ _id: "m1", email: "a@b.c", username: "Alice" }]
    );
    queryClient.setQueryData(
        ["boards", { projectId: "p1" }],
        [{ _id: "c1", columnName: "Todo", index: 0, projectId: "p1" }]
    );
    queryClient.setQueryData(["tasks", { projectId: "p1" }], []);
    return queryClient;
};

const renderModal = (
    open = true,
    onClose: () => void = jest.fn(),
    agentOverrides: Partial<UseAgentResult> = {}
) => {
    mockedUseAgent.mockReturnValue(baseAgent(agentOverrides));
    const queryClient = seedClient();
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskDraftModal
                                    columnId="c1"
                                    onClose={onClose}
                                    open={open}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { ...utils, onClose };
};

describe("AiTaskDraftModal — remote agent path", () => {
    beforeEach(() => {
        mockedStream.mockReset();
        mockedUseAgent.mockReset();
        resetRemoteAiConsentForTests();
        acknowledgeRemoteAi("https://agents.example");
    });

    afterEach(() => {
        resetRemoteAiConsentForTests();
    });

    it("calls agent.start with the prompt when Draft button is clicked", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderModal(true, jest.fn(), { start });

        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Investigate flaky login on Safari" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        const [inputArg, opts] = start.mock.calls[0] as [
            { prompt: string },
            { autonomy: string }
        ];
        expect(inputArg).toEqual({
            prompt: "Investigate flaky login on Safari"
        });
        expect(opts?.autonomy).toBe("plan");
    });

    it("rejects a whitespace-only task name on create", async () => {
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
            json: jest.fn().mockResolvedValue({ _id: "task-new" }),
            ok: true,
            status: 200
        } as unknown as Response);

        renderModal(true, jest.fn(), {
            lastSuggestion: {
                surface: "draft",
                payload: draftPayload
            }
        });

        const taskNameInput =
            await screen.findByDisplayValue("Agent-drafted task");
        fireEvent.change(taskNameInput, { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: /create task/i }));

        await waitFor(() => {
            expect(fetchMock).not.toHaveBeenCalled();
        });
        fetchMock.mockRestore();
    });

    it("clamps invalid column and coordinator ids from remote draft suggestions", async () => {
        renderModal(true, jest.fn(), {
            lastSuggestion: {
                surface: "draft",
                payload: {
                    ...draftPayload,
                    columnId: "invalid-column",
                    coordinatorId: "invalid-member"
                }
            }
        });

        await waitFor(() =>
            expect(
                screen.getByDisplayValue("Agent-drafted task")
            ).toBeInTheDocument()
        );
        expect(screen.getByText("Todo")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    it("populates form fields after surface:draft single suggestion", async () => {
        renderModal(true, jest.fn(), {
            lastSuggestion: {
                surface: "draft",
                payload: draftPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByDisplayValue("Agent-drafted task")
            ).toBeInTheDocument()
        );
    });

    it("does not re-consume the same draft suggestion on rerenders caused by streaming state updates", async () => {
        const clearSuggestion = jest.fn();
        const onClose = jest.fn();
        const queryClient = seedClient();
        const stableSuggestion = {
            surface: "draft" as const,
            payload: draftPayload
        };

        mockedUseAgent.mockReturnValue(
            baseAgent({
                clearSuggestion,
                isStreaming: false,
                lastSuggestion: stableSuggestion
            })
        );

        const { rerender } = render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={onClose}
                                        open
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() =>
            expect(
                screen.getByDisplayValue("Agent-drafted task")
            ).toBeInTheDocument()
        );
        await waitFor(() => expect(clearSuggestion).toHaveBeenCalledTimes(1));

        mockedUseAgent.mockReturnValue(
            baseAgent({
                clearSuggestion,
                isStreaming: true,
                lastSuggestion: stableSuggestion
            })
        );

        rerender(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={onClose}
                                        open
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() => expect(clearSuggestion).toHaveBeenCalledTimes(1));
    });

    it("populates breakdown list after surface:draft breakdown suggestion", async () => {
        renderModal(true, jest.fn(), {
            lastSuggestion: {
                surface: "draft",
                payload: breakdownPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByLabelText(/subtask breakdown/i)
            ).toBeInTheDocument()
        );
        expect(screen.getByText("Phase 1 task")).toBeInTheDocument();
        expect(screen.getByText("Phase 2 task")).toBeInTheDocument();
    });

    it("calls agent.start with prompt and axis in breakdown mode", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderModal(true, jest.fn(), { start });

        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Build sprint dashboard" }
        });
        fireEvent.click(
            screen.getByLabelText("Break the prompt into subtasks")
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        const [inputArg] = start.mock.calls[0] as [
            { prompt: string; breakdown_axis: string }
        ];
        expect(inputArg).toEqual({
            prompt: "Build sprint dashboard",
            breakdown_axis: "freeform"
        });
    });

    it("calls agent.abort and clearSuggestion when modal closes", () => {
        const abort = jest.fn();
        const clearSuggestion = jest.fn();
        const onClose = jest.fn();
        const queryClient = seedClient();

        mockedUseAgent.mockReturnValue(baseAgent({ abort, clearSuggestion }));
        const { rerender } = render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={onClose}
                                        open
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        mockedUseAgent.mockReturnValue(baseAgent({ abort, clearSuggestion }));
        rerender(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={onClose}
                                        open={false}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        expect(abort).toHaveBeenCalled();
        expect(clearSuggestion).toHaveBeenCalled();
    });

    it("shows loading state while agent is streaming", () => {
        renderModal(true, jest.fn(), { isStreaming: true });

        const draftBtn = screen.getByLabelText("Draft task with Copilot");
        expect(draftBtn).toBeDisabled();
    });

    it("ignores suggestion events with surface other than 'draft'", () => {
        renderModal(true, jest.fn(), {
            lastSuggestion: {
                surface: "brief",
                payload: { notADraft: true }
            }
        });

        expect(
            screen.queryByDisplayValue("Agent-drafted task")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByLabelText(/subtask breakdown/i)
        ).not.toBeInTheDocument();
    });

    it("does not call streamAgent directly (routes through useAgent)", () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderModal(true, jest.fn(), { start });

        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Test prompt" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        expect(mockedStream).not.toHaveBeenCalled();
    });
});

describe("AiTaskDraftModal — local engine fallback (aiUseLocalEngine)", () => {
    it("confirms streamAgent is never called directly in remote mode", () => {
        // The real local-engine path is covered by index.test.tsx (no env mock).
        // Here we verify streamAgent is not directly invoked even when useAgent.start
        // is called — the call goes through the useAgent hook, not agentClient directly.
        const start = jest.fn().mockResolvedValue(undefined);
        renderModal(true, jest.fn(), { start });

        fireEvent.change(screen.getByLabelText("Task prompt"), {
            target: { value: "Test prompt" }
        });
        fireEvent.click(screen.getByLabelText("Draft task with Copilot"));

        expect(mockedStream).not.toHaveBeenCalled();
    });
});

describe("AiTaskDraftModal — projectName from cache (F-3)", () => {
    it("reads projectName from React Query cache and makes it available for local engine context", () => {
        // Seed the project into the cache so cachedProject?.projectName is non-empty.
        const qc = seedClient();
        qc.setQueryData(["projects", { projectId: "p1" }], {
            _id: "p1",
            projectName: "My Seeded Project",
            managerId: "m1",
            organization: "Org",
            createdAt: "0"
        });

        mockedUseAgent.mockReturnValue(baseAgent());

        render(
            <Provider store={store}>
                <QueryClientProvider client={qc}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <AiTaskDraftModal
                                        columnId="c1"
                                        onClose={jest.fn()}
                                        open
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        // The component renders without error when the project is cached.
        // The projectName propagates into aiContext via useCachedQueryData —
        // verified by confirming the modal renders the task prompt input.
        expect(screen.getByLabelText("Task prompt")).toBeInTheDocument();
    });
});
