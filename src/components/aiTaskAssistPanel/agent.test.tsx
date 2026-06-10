/**
 * Remote-agent path tests for AiTaskAssistPanel.
 *
 * Tests the v2.1 streaming migration: when `aiUseLocalEngine` is false the
 * panel uses `useAgent("task-estimation-agent")` and renders from
 * `custom/suggestion` events with surface "estimate"; when `aiUseLocalEngine`
 * is true the panel falls back to `useAi` (covered in index.test.tsx).
 *
 * Mirrors the pattern from boardBriefDrawer/agent.test.tsx.
 */
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { microcopy } from "../../constants/microcopy";
import { streamAgent } from "../../utils/ai/agentClient";
import {
    acknowledgeRemoteAi,
    resetRemoteAiConsentForTests
} from "../../utils/ai/remoteAiConsent";
import useAgent from "../../utils/hooks/useAgent";
import { store } from "../../store";

import AiTaskAssistPanel from ".";

const mockedStream = streamAgent as unknown as jest.Mock;
const mockedUseAgent = useAgent as jest.MockedFunction<typeof useAgent>;

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

const estimateSuggestionPayload = {
    estimate: {
        storyPoints: 5 as StoryPoints,
        confidence: 0.82,
        rationale: "Similar to other medium authentication tasks.",
        similar: [{ _id: "t1", reason: "Same epic, same story size" }]
    },
    readiness: {
        ready: false,
        missing: [
            {
                field: "note",
                severity: "warn",
                message: "Add acceptance criteria to the description.",
                suggestion: "Add acceptance criteria before implementation."
            }
        ],
        rationale: "Missing acceptance criteria."
    }
};

const estimateSuggestionWithV21IssuesPayload = {
    estimate: {
        storyPoints: 3 as StoryPoints,
        confidence: "moderate",
        rationale: "Comparable scope to other authentication tasks.",
        similar: []
    },
    readiness: {
        ready: false,
        issues: [
            {
                field: "note",
                severity: "warning",
                message: "Acceptance criteria are missing.",
                suggestion: "Add concrete acceptance criteria."
            }
        ],
        rationale: "The task needs clearer completion criteria."
    }
};

const renderPanel = (
    agentOverrides: Partial<UseAgentResult> = {},
    values: {
        taskName?: string;
        note?: string;
        type?: string;
        epic?: string;
        coordinatorId?: string;
        storyPoints?: number;
    } = { taskName: "Implement OAuth login" }
) => {
    mockedUseAgent.mockReturnValue(baseAgent(agentOverrides));
    const queryClient = new QueryClient();
    const onApplyStoryPoints = jest.fn();
    const onApplySuggestion = jest.fn();
    const onOpenSimilarTask = jest.fn();
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <AiTaskAssistPanel
                                    onApplyStoryPoints={onApplyStoryPoints}
                                    onApplySuggestion={onApplySuggestion}
                                    onOpenSimilarTask={onOpenSimilarTask}
                                    values={values}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return {
        ...utils,
        onApplyStoryPoints,
        onApplySuggestion,
        onOpenSimilarTask
    };
};

describe("AiTaskAssistPanel — remote agent path", () => {
    beforeAll(() => {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: () => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: false,
                media: "",
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            })
        });
        jest.useFakeTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    beforeEach(() => {
        mockedStream.mockReset();
        mockedUseAgent.mockReset();
        resetRemoteAiConsentForTests();
        acknowledgeRemoteAi("https://agents.example");
    });

    afterEach(() => {
        resetRemoteAiConsentForTests();
    });

    it("renders estimate UI (story-point label + confidence) from a surface:estimate suggestion", async () => {
        renderPanel({
            lastSuggestion: {
                surface: "estimate",
                payload: estimateSuggestionPayload
            }
        });

        // Story-point label (aria-label contains the number)
        await waitFor(() =>
            expect(
                screen.getByLabelText(/Suggested story points: 5/i)
            ).toBeInTheDocument()
        );
        // Rationale text is now disclosed via the "Why?" affordance.
        fireEvent.click(screen.getByRole("button", { name: /^Why\?/ }));
        expect(
            await screen.findByText(
                /Similar to other medium authentication tasks\./
            )
        ).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            /Suggestion ready\./i
        );
    });

    it("renders readiness issues from the same surface:estimate suggestion payload", async () => {
        const { container, onApplySuggestion } = renderPanel({
            lastSuggestion: {
                surface: "estimate",
                payload: estimateSuggestionPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByText(/Add acceptance criteria to the description\./)
            ).toBeInTheDocument()
        );
        expect(
            screen.getByText(/Add acceptance criteria before implementation\./)
        ).toBeInTheDocument();
        expect(
            container.querySelector(".ant-alert-warning")
        ).toBeInTheDocument();

        act(() => {
            screen
                .getByLabelText(/Apply readiness suggestion for note/)
                .click();
        });

        expect(onApplySuggestion).toHaveBeenCalledWith(
            "note",
            "Add acceptance criteria before implementation."
        );
    });

    it("adapts v2.1 readiness issues and string confidence from a surface:estimate payload", async () => {
        const { container, onApplySuggestion } = renderPanel({
            lastSuggestion: {
                surface: "estimate",
                payload: estimateSuggestionWithV21IssuesPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByLabelText(/Confidence moderate, 60%/i)
            ).toBeInTheDocument()
        );
        expect(
            screen.getByText(/Acceptance criteria are missing\./)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Add concrete acceptance criteria\./)
        ).toBeInTheDocument();
        expect(
            container.querySelector(".ant-alert-warning")
        ).toBeInTheDocument();

        act(() => {
            screen
                .getByLabelText(/Apply readiness suggestion for note/)
                .click();
        });

        expect(onApplySuggestion).toHaveBeenCalledWith(
            "note",
            "Add concrete acceptance criteria."
        );
    });

    it("shows skeleton while agent is streaming and no suggestion has arrived", () => {
        const { container } = renderPanel({
            isStreaming: true,
            lastSuggestion: null
        });

        // useDelayedFlag requires 250ms before the skeleton appears.
        act(() => {
            jest.advanceTimersByTime(300);
        });

        // Antd Skeleton renders .ant-skeleton; the aria-label prop on <Skeleton>
        // is not forwarded to a DOM attribute, so we assert on the CSS class.
        expect(container.querySelector(".ant-skeleton")).toBeInTheDocument();
    });

    it("does not show skeleton once a suggestion has arrived", async () => {
        const { container } = renderPanel({
            isStreaming: false,
            lastSuggestion: {
                surface: "estimate",
                payload: estimateSuggestionPayload
            }
        });

        await waitFor(() =>
            expect(
                screen.getByLabelText(/Suggested story points: 5/i)
            ).toBeInTheDocument()
        );
        // With isStreaming: false the delayed flag never fires — no skeleton.
        expect(
            container.querySelector(".ant-skeleton-active")
        ).not.toBeInTheDocument();
    });

    it("calls agent.start with structured task draft input when the task name is present", () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderPanel({ start });

        expect(start).toHaveBeenCalledWith(
            expect.objectContaining({
                task_draft: expect.objectContaining({
                    taskName: "Implement OAuth login"
                })
            }),
            expect.objectContaining({ autonomy: "plan" })
        );
    });

    it("collapses both suggestion sections while remote consent is pending, then restores them on acknowledgement", () => {
        resetRemoteAiConsentForTests();
        const start = jest.fn().mockResolvedValue(undefined);
        renderPanel({ start });

        // Consent notice owns the panel — no bare headings over
        // permanently-empty bodies, and no remote request fires.
        expect(
            screen.getByText(microcopy.ai.remoteConsentTitle)
        ).toBeInTheDocument();
        expect(
            screen.queryByText(microcopy.ai.suggestedStoryPoints)
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(microcopy.ai.readinessCheck)
        ).not.toBeInTheDocument();
        expect(start).not.toHaveBeenCalled();

        act(() => {
            fireEvent.click(
                screen.getByRole("button", {
                    name: microcopy.ai.remoteConsentAccept
                })
            );
        });

        expect(
            screen.getByText(microcopy.ai.suggestedStoryPoints)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.ai.readinessCheck)
        ).toBeInTheDocument();
        expect(start).toHaveBeenCalled();
    });

    it("does not restart the remote agent when unrelated tasks cache updates leave the draft unchanged", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        const queryClient = new QueryClient();
        const initialTasks: ITask[] = [
            {
                _id: "t1",
                columnId: "c1",
                coordinatorId: "m1",
                epic: "Auth",
                index: 0,
                note: "old",
                projectId: "p1",
                storyPoints: 5,
                taskName: "Old login bug",
                type: "Bug"
            }
        ];
        queryClient.setQueryData(["tasks", { projectId: "p1" }], initialTasks);

        const TasksCacheBumper = () => {
            useEffect(() => {
                queryClient.setQueryData(
                    ["tasks", { projectId: "p1" }],
                    [
                        ...initialTasks,
                        {
                            _id: "t2",
                            columnId: "c1",
                            coordinatorId: "m1",
                            epic: "Auth",
                            index: 1,
                            note: "new",
                            projectId: "p1",
                            storyPoints: 2,
                            taskName: "Unrelated board update",
                            type: "Task"
                        }
                    ]
                );
            }, []);

            return (
                <AiTaskAssistPanel
                    onApplyStoryPoints={jest.fn()}
                    onApplySuggestion={jest.fn()}
                    onOpenSimilarTask={jest.fn()}
                    values={{ taskName: "Implement OAuth login" }}
                />
            );
        };

        mockedUseAgent.mockReturnValue(baseAgent({ start }));

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={<TasksCacheBumper />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

        act(() => {
            jest.advanceTimersByTime(1000);
        });

        await waitFor(() => {
            expect(start).toHaveBeenCalledTimes(1);
        });
    });

    it("restarts the remote agent when debounced draft fields change", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        mockedUseAgent.mockReturnValue(baseAgent({ start }));

        const DraftChanger = () => {
            const [taskName, setTaskName] = useState("Implement OAuth login");
            const values = useMemo(() => ({ taskName }), [taskName]);

            return (
                <>
                    <button
                        onClick={() => setTaskName("Implement OAuth login v2")}
                        type="button"
                    >
                        Change draft
                    </button>
                    <AiTaskAssistPanel
                        onApplyStoryPoints={jest.fn()}
                        onApplySuggestion={jest.fn()}
                        onOpenSimilarTask={jest.fn()}
                        values={values}
                    />
                </>
            );
        };

        render(
            <Provider store={store}>
                <QueryClientProvider client={new QueryClient()}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={<DraftChanger />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

        act(() => {
            screen.getByRole("button", { name: "Change draft" }).click();
        });
        act(() => {
            jest.advanceTimersByTime(1000);
        });

        await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
        expect(start).toHaveBeenLastCalledWith(
            expect.objectContaining({
                task_draft: expect.objectContaining({
                    taskName: "Implement OAuth login v2"
                })
            }),
            expect.objectContaining({ autonomy: "plan" })
        );
    });

    it("does not restart the remote agent on rerenders caused by streaming state updates", async () => {
        const start = jest.fn().mockResolvedValue(undefined);
        const abort = jest.fn();
        const clearSuggestion = jest.fn();

        const queryClient = new QueryClient();

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
                    <AiTaskAssistPanel
                        onApplyStoryPoints={jest.fn()}
                        onApplySuggestion={jest.fn()}
                        onOpenSimilarTask={jest.fn()}
                        values={{ taskName: "Implement OAuth login" }}
                    />
                </>
            );
        };

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={<Harness />}
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

        act(() => {
            screen.getByRole("button", { name: "Toggle streaming" }).click();
        });

        await waitFor(() => {
            expect(start).toHaveBeenCalledTimes(1);
        });
    });

    it("calls agent.abort and clearSuggestion on unmount", () => {
        const abort = jest.fn();
        const clearSuggestion = jest.fn();
        const { unmount } = renderPanel({ abort, clearSuggestion });

        unmount();

        expect(abort).toHaveBeenCalled();
        expect(clearSuggestion).toHaveBeenCalled();
    });

    it("ignores suggestion events with a surface other than 'estimate'", () => {
        renderPanel({
            lastSuggestion: {
                surface: "brief",
                payload: { notAnEstimate: true }
            }
        });

        expect(
            screen.queryByLabelText(/Suggested story points/i)
        ).not.toBeInTheDocument();
    });

    it("surfaces agent error when present and no suggestion has arrived", () => {
        renderPanel({
            error: new Error("Agent timed out"),
            lastSuggestion: null
        });

        expect(
            screen.getByText(/Board Copilot hit an error/i)
        ).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            /Couldn't load suggestions\./i
        );
    });

    it("does not call streamAgent directly (goes through useAgent)", () => {
        const start = jest.fn().mockResolvedValue(undefined);
        renderPanel({ start });

        // useAgent abstracts streamAgent; this panel should never call it directly.
        expect(mockedStream).not.toHaveBeenCalled();
    });
});
