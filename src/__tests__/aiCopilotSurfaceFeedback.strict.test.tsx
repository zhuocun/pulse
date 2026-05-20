/**
 * Asserts thumbs analytics on non-chat Copilot surfaces backed by stubs
 * (local `useAi` + inactive `useAgent`) so LangGraph hooks cannot wedge `isStreaming` in jsdom.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    cleanup,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntdApp, ConfigProvider } from "antd";
import React from "react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import { store } from "../store";

import AiTaskAssistPanel from "../components/aiTaskAssistPanel";
import BoardBriefDrawer from "../components/boardBriefDrawer";
import * as analytics from "../constants/analytics";
import { microcopy } from "../constants/microcopy";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true
    }
}));

jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useAiEnabled", () => ({
    __esModule: true,
    default: jest.fn(),
    useAutonomyLevel: jest.fn(() => ({
        level: "plan",
        setLevel: jest.fn()
    }))
}));
jest.mock("../utils/hooks/useColorScheme");

jest.mock("../utils/hooks/useReactMutation", () => ({
    __esModule: true,
    default: () => ({
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn()
    })
}));

jest.mock("../utils/hooks/useApi", () => ({
    __esModule: true,
    default: jest.fn().mockResolvedValue({})
}));

jest.mock("../utils/hooks/useAi", () => ({
    __esModule: true,
    assertRunPayloadProjectsAiAllowed: jest.fn(),
    default: jest.fn()
}));

jest.mock("../constants/analytics", () => {
    const actual = jest.requireActual<typeof import("../constants/analytics")>(
        "../constants/analytics"
    );
    return {
        __esModule: true,
        ...actual,
        track: jest.fn()
    };
});

jest.mock("../components/copilotRemoteConsentNotice", () => ({
    __esModule: true,
    default: () => null
}));

jest.mock("../components/copilotPrivacyPopover", () => {
    const ReactLib = require("react");
    return {
        __esModule: true,
        default: () =>
            ReactLib.createElement(
                "button",
                { type: "button", "aria-label": "Privacy info" },
                "Privacy"
            ),
        CopilotPrivacyDisclosure: () => null
    };
});

jest.mock("../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn() })
}));

jest.mock("react-router-dom", () => {
    const actual = jest.requireActual("react-router-dom");
    return {
        ...actual,
        useParams: () => ({ projectId: "proj-1" })
    };
});

jest.mock("../utils/hooks/useTaskModal", () => ({
    __esModule: true,
    default: () => ({ startEditing: jest.fn() })
}));

jest.mock("../utils/hooks/useAgent", () => {
    const noop = (): void => undefined;
    const start = jest.fn().mockResolvedValue(undefined);
    const resume = jest.fn().mockResolvedValue(undefined);
    const stub = {
        abort: noop,
        citations: [],
        clearPendingProposal: noop,
        clearSuggestion: noop,
        dismissNudge: noop,
        error: null,
        isSlowTtft: false,
        isStreaming: false,
        lastSuggestion: null,
        nudges: [],
        pendingInterrupt: null,
        pendingProposal: null,
        reset: noop,
        resume,
        seedMessages: noop,
        start,
        state: { messages: [] },
        status: "idle" as const,
        threadId: "stub-thread",
        ttftMs: null
    };
    return {
        __esModule: true,
        default: () => stub
    };
});

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;

const SAMPLE_USER: IUser = {
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice"
};

const SAMPLE_PROJECT: IProject = {
    _id: "proj-1",
    projectName: "Jira Clone",
    organization: "Acme Corp",
    managerId: "u1"
};

const SAMPLE_COLUMNS: IColumn[] = [
    { _id: "col-1", columnName: "To Do", projectId: "proj-1", index: 0 },
    { _id: "col-2", columnName: "In Progress", projectId: "proj-1", index: 1 },
    { _id: "col-3", columnName: "Done", projectId: "proj-1", index: 2 }
];

const SAMPLE_MEMBERS: IMember[] = [
    { _id: "m1", username: "Alice", email: "alice@example.com" },
    { _id: "m2", username: "Bob", email: "bob@example.com" }
];

const SAMPLE_TASKS: ITask[] = [
    {
        _id: "task-1",
        taskName: "Build login form",
        type: "Task",
        projectId: "proj-1",
        columnId: "col-1",
        coordinatorId: "m1",
        storyPoints: 3,
        epic: "Auth epic",
        note: "Use React Hook Form",
        index: 0
    }
];

const SAMPLE_BOARD_BRIEF: IBoardBrief = {
    headline: "Board looks healthy",
    counts: [
        { columnId: "col-1", columnName: "To Do", count: 5 },
        { columnId: "col-2", columnName: "In Progress", count: 2 },
        { columnId: "col-3", columnName: "Done", count: 8 }
    ],
    largestUnstarted: [],
    unowned: [],
    workload: [],
    recommendation: "Consider assigning the unowned bug to Alice.",
    recommendationDetail: {
        text: "Alice has capacity and the bug is high priority.",
        strength: "moderate",
        basis: "Alice has 3 open tasks vs team average of 5.",
        sources: [{ taskId: "task-2", taskName: "Fix header bug" }]
    }
};

const makeQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });

const Wrapper: React.FC<{ children: React.ReactNode; qc?: QueryClient }> = ({
    children,
    qc
}) => {
    const client = qc ?? makeQueryClient();
    return (
        <Provider store={store}>
            <QueryClientProvider client={client}>
                <BrowserRouter>
                    <ConfigProvider>
                        <AntdApp component={false}>{children}</AntdApp>
                    </ConfigProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </Provider>
    );
};

const renderWithProviders = (
    ui: React.ReactElement,
    qc?: QueryClient
): ReturnType<typeof render> => render(<Wrapper qc={qc}>{ui}</Wrapper>);

const thumbsPayloadCalls = (): Array<Record<string, unknown>> =>
    jest
        .mocked(analytics.track)
        .mock.calls.filter(([event]) => event === "agent.feedback.thumbs")
        .map(([, payload]) => payload as Record<string, unknown>);

describe("AiCopilotSurfaceFeedback integration", () => {
    const estimateRunStable = jest.fn().mockResolvedValue(null);
    const estimateResetStable = jest.fn();
    const readinessRunStable = jest.fn().mockResolvedValue(null);
    const readinessResetStable = jest.fn();
    const boardBriefRunStable = jest.fn().mockResolvedValue(SAMPLE_BOARD_BRIEF);
    const boardBriefResetStable = jest.fn();

    const taskAssistEstimateGroupName = (): string =>
        (microcopy.feedback.taskAssistTitle as string).replace(
            "{section}",
            String(microcopy.ai.suggestedStoryPoints)
        );

    const taskAssistReadinessGroupName = (): string =>
        (microcopy.feedback.taskAssistTitle as string).replace(
            "{section}",
            String(microcopy.ai.readinessCheck)
        );

    const briefRecommendationGroupName = (): string =>
        (microcopy.feedback.boardBriefTitle as string).replace(
            "{section}",
            String(microcopy.brief.recommendedNextStep)
        );

    const setupGlobalHooks = (): void => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: true,
            user: SAMPLE_USER
        });
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        mockedUseColorScheme.mockReturnValue({
            preference: "light",
            scheme: "light",
            setPreference: jest.fn()
        });
    };

    const setupTaskAssistMocks = (): void => {
        const useAi = require("../utils/hooks/useAi").default as jest.Mock;
        useAi.mockImplementation((opts: { route: string }) => {
            if (opts.route === "estimate") {
                return {
                    data: {
                        storyPoints: 5,
                        confidence: 0.82,
                        rationale:
                            "Similar task 'Add OAuth flow' was estimated at 5.",
                        similar: [
                            { _id: "task-2", reason: "Auth work with hooks" }
                        ]
                    } satisfies IEstimateSuggestion,
                    error: null,
                    isLoading: false,
                    reset: estimateResetStable,
                    run: estimateRunStable
                };
            }
            if (opts.route === "readiness") {
                return {
                    data: {
                        issues: [
                            {
                                field: "note" as const,
                                severity: "warn" as const,
                                message: "Note is too brief",
                                suggestion:
                                    "Add acceptance criteria to the note."
                            }
                        ]
                    } satisfies IReadinessReport,
                    error: null,
                    isLoading: false,
                    reset: readinessResetStable,
                    run: readinessRunStable
                };
            }
            return {
                data: null,
                error: null,
                isLoading: false,
                reset: jest.fn(),
                run: jest.fn().mockResolvedValue(null)
            };
        });
    };

    beforeEach(() => {
        jest.mocked(analytics.track).mockClear();
        estimateRunStable.mockClear();
        estimateResetStable.mockClear();
        readinessRunStable.mockClear();
        readinessResetStable.mockClear();
        boardBriefRunStable.mockClear();
        boardBriefResetStable.mockClear();
        setupGlobalHooks();
    });

    afterEach(() => {
        cleanup();
    });

    it("task assist estimate rail exposes ARIA name and records thumbs feedback", async () => {
        setupTaskAssistMocks();
        const qc = makeQueryClient();
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);

        renderWithProviders(
            <AiTaskAssistPanel
                excludeTaskId={undefined}
                onApplyStoryPoints={jest.fn()}
                onApplySuggestion={jest.fn()}
                onOpenSimilarTask={jest.fn()}
                values={{
                    taskName: "Build login form",
                    note: "Use React Hook Form",
                    type: "Task",
                    epic: "Auth epic",
                    coordinatorId: "m1",
                    storyPoints: 3 as const
                }}
            />,
            qc
        );

        await waitFor(() => {
            expect(
                screen.getByRole("group", {
                    name: taskAssistEstimateGroupName()
                })
            ).toBeInTheDocument();
        });

        const estimateGroup = screen.getByRole("group", {
            name: taskAssistEstimateGroupName()
        });
        await userEvent.click(
            within(estimateGroup).getByRole("button", {
                name: microcopy.a11y.helpfulAnswer
            })
        );
        expect(thumbsPayloadCalls().length).toBeGreaterThanOrEqual(1);
        expect(thumbsPayloadCalls().at(-1)).toEqual(
            expect.objectContaining({
                citationCount: 0,
                suggestionId: expect.stringContaining(":estimate"),
                surface: "task-assist",
                value: "up"
            })
        );
    });

    it("task assist readiness rail records thumbs-down analytics with categories", async () => {
        setupTaskAssistMocks();
        const qc = makeQueryClient();
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);

        renderWithProviders(
            <AiTaskAssistPanel
                excludeTaskId={undefined}
                onApplyStoryPoints={jest.fn()}
                onApplySuggestion={jest.fn()}
                onOpenSimilarTask={jest.fn()}
                values={{
                    taskName: "Build login form",
                    note: "Use React Hook Form",
                    type: "Task",
                    epic: "Auth epic",
                    coordinatorId: "m1",
                    storyPoints: 3 as const
                }}
            />,
            qc
        );

        const readinessGroup = await screen.findByRole("group", {
            name: taskAssistReadinessGroupName()
        });
        await userEvent.click(
            within(readinessGroup).getByRole("button", {
                name: microcopy.a11y.notHelpfulGiveFeedback
            })
        );

        await userEvent.click(
            await screen.findByRole("checkbox", {
                name: microcopy.ai.feedbackCategories.incorrect
            })
        );
        await userEvent.click(
            screen.getByRole("button", { name: microcopy.ai.feedbackSubmit })
        );

        expect(thumbsPayloadCalls().length).toBeGreaterThanOrEqual(1);
        expect(thumbsPayloadCalls().at(-1)).toEqual(
            expect.objectContaining({
                categories: ["incorrect"],
                hasNote: false,
                citationCount: 0,
                suggestionId: expect.stringContaining(":readiness"),
                surface: "task-assist",
                value: "down"
            })
        );
    });

    it("board brief recommendation rail exposes ARIA name and tracks thumbs feedback", async () => {
        const useAi = require("../utils/hooks/useAi").default as jest.Mock;
        useAi.mockReturnValue({
            data: SAMPLE_BOARD_BRIEF,
            error: null,
            isLoading: false,
            reset: boardBriefResetStable,
            run: boardBriefRunStable
        });

        renderWithProviders(
            <BoardBriefDrawer
                columns={SAMPLE_COLUMNS}
                members={SAMPLE_MEMBERS}
                onClose={jest.fn()}
                open
                project={SAMPLE_PROJECT}
                tasks={SAMPLE_TASKS}
            />
        );

        await waitFor(() =>
            expect(document.querySelector(".ant-drawer-section")).not.toBeNull()
        );

        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: briefRecommendationGroupName()
                })
            ).toBeInTheDocument()
        );

        const briefFeedback = screen.getByRole("group", {
            name: briefRecommendationGroupName()
        });

        await userEvent.click(
            within(briefFeedback).getByRole("button", {
                name: microcopy.a11y.helpfulAnswer
            })
        );
        expect(thumbsPayloadCalls().length).toBeGreaterThanOrEqual(1);
        expect(thumbsPayloadCalls().at(-1)).toEqual(
            expect.objectContaining({
                citationCount: 0,
                surface: "board-brief",
                value: "up"
            })
        );
    });
});
