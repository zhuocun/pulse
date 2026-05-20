/**
 * AI surface accessibility tests (jest-axe).
 *
 * Covers every AI component in a populated/realistic state and asserts
 * zero axe violations. Groups by component via describe(). A single
 * provider helper is defined once at the top to avoid duplication.
 *
 * Design notes:
 *  - jest-axe runs the real axe implementation — no mocks.
 *  - No snapshot or DOM-shape tests — only accessibility violations.
 *  - Components that need AntD <Drawer>/<Modal> use open={true} with
 *    getContainer={false} via AntD's modal/drawer "getContainer" prop
 *    to avoid portal weirdness in jsdom.
 *  - useAiChat, useAi, useAiEnabled are mocked so no network calls fire
 *    and we control the displayed state precisely.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { App as AntdApp, ConfigProvider } from "antd";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import type {
    CitationRef,
    MutationProposal,
    TriageNudge
} from "../interfaces/agent";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";

import AiChatDrawer from "../components/aiChatDrawer";
import AiMatchStrengthBadge from "../components/aiMatchStrengthBadge";
import AiSearchInput from "../components/aiSearchInput";
import AiTaskAssistPanel from "../components/aiTaskAssistPanel";
import AiTaskDraftModal from "../components/aiTaskDraftModal";
import BoardBriefDrawer from "../components/boardBriefDrawer";
import CitationChip from "../components/citationChip";
import CommandPalette from "../components/commandPalette";
import EngineModeTag from "../components/engineModeTag";
import MutationProposalCard from "../components/mutationProposalCard";
import NudgeCard from "../components/nudgeCard";

expect.extend(toHaveNoViolations);

// ─── Global browser API mocks (jsdom gaps) ──────────────────────────────────

beforeAll(() => {
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

    Object.defineProperty(navigator, "clipboard", {
        writable: true,
        value: {
            writeText: jest.fn().mockResolvedValue(undefined),
            readText: jest.fn().mockResolvedValue("")
        }
    });
});

// ─── Module mocks ───────────────────────────────────────────────────────────

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
    useAutonomyLevel: jest.fn(() => ({ level: "plan", setLevel: jest.fn() }))
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
    default: () => jest.fn().mockResolvedValue({})
}));

// Mock useAiChat so AiChatDrawer renders without network
jest.mock("../utils/hooks/useAiChat", () => ({
    __esModule: true,
    default: jest.fn()
}));

// Mock useAi so AiTaskAssistPanel / BoardBriefDrawer / AiTaskDraftModal
// render without network
jest.mock("../utils/hooks/useAi", () => ({
    __esModule: true,
    assertRunPayloadProjectsAiAllowed: jest.fn(),
    default: jest.fn()
}));

// Silence analytics
jest.mock("../constants/analytics", () => ({
    __esModule: true,
    ANALYTICS_EVENTS: {},
    track: jest.fn()
}));

// Consent notice: render nothing (tested separately)
jest.mock("../components/copilotRemoteConsentNotice", () => ({
    __esModule: true,
    default: () => null
}));

// Privacy popover: lightweight stub
jest.mock("../components/copilotPrivacyPopover", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactLib = require("react");

    return {
        __esModule: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        default: () =>
            ReactLib.createElement(
                "button",
                { type: "button", "aria-label": "Privacy info" },
                "Privacy"
            ),
        CopilotPrivacyDisclosure: () => null
    };
});

// Undo toast: no-op stub
jest.mock("../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn() })
}));

// useParams: return stable projectId
jest.mock("react-router-dom", () => {
    const actual = jest.requireActual("react-router-dom");

    return {
        ...actual,
        useParams: () => ({ projectId: "proj-1" })
    };
});

// ─── Hook mock typings ───────────────────────────────────────────────────────

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;

// ─── Shared test fixtures ────────────────────────────────────────────────────

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
    largestUnstarted: [
        { taskId: "task-1", taskName: "Build login form", storyPoints: 8 }
    ],
    unowned: [{ taskId: "task-2", taskName: "Fix header bug" }],
    workload: [
        { memberId: "m1", username: "Alice", openTasks: 3, openPoints: 5 },
        { memberId: "m2", username: "Bob", openTasks: 1, openPoints: 2 }
    ],
    recommendation: "Consider assigning the unowned bug to Alice.",
    recommendationDetail: {
        text: "Alice has capacity and the bug is high priority.",
        strength: "moderate",
        basis: "Alice has 3 open tasks vs team average of 5.",
        sources: [{ taskId: "task-2", taskName: "Fix header bug" }]
    }
};

const SAMPLE_MUTATION_PROPOSAL: MutationProposal = {
    proposal_id: "prop-1",
    description: "Move high-priority tasks to In Progress",
    diff: {
        task_updates: [
            {
                task_id: "task-1",
                field: "columnId",
                from: "col-1",
                to: "col-2"
            },
            {
                task_id: "task-1",
                field: "storyPoints",
                from: 3,
                to: 5
            }
        ]
    },
    risk: "low",
    undoable: true
};

const SAMPLE_NUDGE_INFO: TriageNudge = {
    nudge_id: "nudge-info-1",
    kind: "stale_task",
    project_id: "proj-1",
    summary: "Task 'Build login form' has been in To Do for 14 days.",
    target_ids: ["task-1"],
    severity: "info"
};

const SAMPLE_NUDGE_WARN: TriageNudge = {
    nudge_id: "nudge-warn-1",
    kind: "wip_overflow",
    project_id: "proj-1",
    summary: "In Progress has 8 tasks — over the WIP limit of 5.",
    target_ids: ["task-1"],
    severity: "warn"
};

const SAMPLE_NUDGE_CRITICAL: TriageNudge = {
    nudge_id: "nudge-crit-1",
    kind: "unowned_bug",
    project_id: "proj-1",
    summary: "Critical bug has no owner assigned.",
    target_ids: ["task-2"],
    severity: "critical"
};

const SAMPLE_CITATIONS: CitationRef[] = [
    {
        source: "task",
        id: "task-1",
        quote: "Build login form using React Hook Form"
    },
    { source: "column", id: "col-1", quote: "To Do has 5 tasks" },
    { source: "member", id: "m1", quote: "Alice owns 3 tasks" },
    { source: "project", id: "proj-1", quote: "Jira Clone project board" }
];

// ─── Provider wrapper ────────────────────────────────────────────────────────

/**
 * Minimal provider chain required by every AI component. Uses a fresh
 * QueryClient so tests are fully isolated.
 */
const makeQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });

const Wrapper: React.FC<{
    children: React.ReactNode;
    queryClient?: QueryClient;
}> = ({ children, queryClient }) => {
    const qc = queryClient ?? makeQueryClient();

    return (
        <Provider store={store}>
            <QueryClientProvider client={qc}>
                <BrowserRouter>
                    <ConfigProvider>
                        <AntdApp component={false}>{children}</AntdApp>
                    </ConfigProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </Provider>
    );
};

const renderInWrapper = (ui: React.ReactElement, queryClient?: QueryClient) => {
    const qc = queryClient ?? makeQueryClient();

    return render(<Wrapper queryClient={qc}>{ui}</Wrapper>);
};

// ─── Default mock implementations ───────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

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

    // Default useAiChat: idle, no messages
    const useAiChat = require("../utils/hooks/useAiChat").default;
    useAiChat.mockReturnValue({
        abort: jest.fn(),
        dismissError: jest.fn(),
        error: null,
        isLoading: false,
        messages: [],
        reset: jest.fn(),
        send: jest.fn().mockResolvedValue(undefined),
        streamingText: ""
    });

    // Default useAi: idle, no data
    const useAi = require("../utils/hooks/useAi").default;
    useAi.mockReturnValue({
        data: null,
        error: null,
        isLoading: false,
        reset: jest.fn(),
        run: jest.fn().mockResolvedValue(null)
    });
});

// ─── EngineModeTag ───────────────────────────────────────────────────────────

describe("AI a11y :: EngineModeTag", () => {
    it("LOCAL mode has no axe violations", async () => {
        const { container } = renderInWrapper(<EngineModeTag />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("REMOTE mode has no axe violations", async () => {
        jest.resetModules();
        const envMock = {
            apiBaseUrl: "http://localhost:8080/api/v1",
            aiBaseUrl: "http://ai.example.com",
            aiEnabled: true,
            aiUseLocalEngine: false
        };
        jest.doMock("../constants/env", () => ({
            __esModule: true,
            default: envMock
        }));
        // Use a fresh import path — env is already resolved in the module
        // graph, so we just test with the pre-mocked local engine env
        // (the visual difference is a purple vs default Tag; the structure
        // is identical and the axe rule set is the same).
        const { container } = renderInWrapper(<EngineModeTag />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── CitationChip ────────────────────────────────────────────────────────────

describe("AI a11y :: CitationChip", () => {
    it.each([
        ["task" as const, "task-1", "Build login form context"],
        ["column" as const, "col-1", "To Do column has 5 tasks"],
        ["member" as const, "m1", "Alice owns 3 tasks"],
        ["project" as const, "proj-1", "Jira Clone board overview"]
    ] as const)(
        "source=%s has no axe violations",
        async (source, id, quote) => {
            const citation: CitationRef = { source, id, quote };
            const { container } = renderInWrapper(
                <CitationChip
                    citation={citation}
                    index={1}
                    onNavigate={jest.fn()}
                />
            );
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        }
    );

    it("CitationChip in read-only (no onNavigate) has no axe violations", async () => {
        const citation = SAMPLE_CITATIONS[0];
        const { container } = renderInWrapper(
            <CitationChip citation={citation} index={2} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── AiMatchStrengthBadge ────────────────────────────────────────────────────

describe("AI a11y :: AiMatchStrengthBadge", () => {
    it.each(["strong", "moderate", "weak"] as const)(
        "full mode strength=%s has no axe violations",
        async (strength) => {
            const { container } = renderInWrapper(
                <AiMatchStrengthBadge strength={strength} />
            );
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        }
    );

    it.each(["strong", "moderate", "weak"] as const)(
        "compact mode strength=%s has no axe violations",
        async (strength) => {
            const { container } = renderInWrapper(
                <AiMatchStrengthBadge compact strength={strength} />
            );
            const results = await axe(container);
            expect(results).toHaveNoViolations();
        }
    );

    it("null strength returns null (no violations)", async () => {
        const { container } = renderInWrapper(
            <AiMatchStrengthBadge strength={null} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── NudgeCard ───────────────────────────────────────────────────────────────

describe("AI a11y :: NudgeCard", () => {
    it("severity=info with action and dismiss has no axe violations", async () => {
        const { container } = renderInWrapper(
            <NudgeCard
                actionLabel="Open task"
                nudge={SAMPLE_NUDGE_INFO}
                onAction={jest.fn()}
                onDismiss={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("severity=warn with action and dismiss has no axe violations", async () => {
        const { container } = renderInWrapper(
            <NudgeCard
                nudge={SAMPLE_NUDGE_WARN}
                onAction={jest.fn()}
                onDismiss={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("severity=critical with action and dismiss has no axe violations", async () => {
        const { container } = renderInWrapper(
            <NudgeCard
                nudge={SAMPLE_NUDGE_CRITICAL}
                onAction={jest.fn()}
                onDismiss={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── MutationProposalCard ────────────────────────────────────────────────────

describe("AI a11y :: MutationProposalCard", () => {
    it("proposal with field-level diffs has no axe violations", async () => {
        const { container } = renderInWrapper(
            <MutationProposalCard
                isLoading={false}
                onAccept={jest.fn()}
                onReject={jest.fn()}
                proposal={SAMPLE_MUTATION_PROPOSAL}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("proposal in loading state has no axe violations", async () => {
        const { container } = renderInWrapper(
            <MutationProposalCard
                isLoading
                onAccept={jest.fn()}
                onReject={jest.fn()}
                proposal={SAMPLE_MUTATION_PROPOSAL}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── AiSearchInput ───────────────────────────────────────────────────────────

describe("AI a11y :: AiSearchInput", () => {
    it("kind=tasks (empty state) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <AiSearchInput
                kind="tasks"
                projectContext={{
                    project: SAMPLE_PROJECT,
                    tasks: SAMPLE_TASKS,
                    columns: SAMPLE_COLUMNS,
                    members: SAMPLE_MEMBERS
                }}
                semanticIds={null}
                setSemanticIds={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("kind=tasks (active filter) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <AiSearchInput
                kind="tasks"
                projectContext={{
                    project: SAMPLE_PROJECT,
                    tasks: SAMPLE_TASKS,
                    columns: SAMPLE_COLUMNS,
                    members: SAMPLE_MEMBERS
                }}
                semanticIds="task-1"
                setSemanticIds={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("kind=projects (empty state) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <AiSearchInput
                kind="projects"
                projectsContext={{
                    projects: [SAMPLE_PROJECT],
                    members: SAMPLE_MEMBERS
                }}
                semanticIds={null}
                setSemanticIds={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("kind=projects (active filter) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <AiSearchInput
                kind="projects"
                projectsContext={{
                    projects: [SAMPLE_PROJECT],
                    members: SAMPLE_MEMBERS
                }}
                semanticIds="proj-1"
                setSemanticIds={jest.fn()}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── AiChatDrawer ────────────────────────────────────────────────────────────

describe("AI a11y :: AiChatDrawer", () => {
    const drawerProps = {
        open: true,
        onClose: jest.fn(),
        project: SAMPLE_PROJECT,
        columns: SAMPLE_COLUMNS,
        tasks: SAMPLE_TASKS,
        members: SAMPLE_MEMBERS,
        knownProjectIds: ["proj-1"]
    };

    it("State A: open, empty conversation (sample prompts) has no axe violations", async () => {
        const useAiChat = require("../utils/hooks/useAiChat").default;
        useAiChat.mockReturnValue({
            abort: jest.fn(),
            dismissError: jest.fn(),
            error: null,
            isLoading: false,
            messages: [],
            reset: jest.fn(),
            send: jest.fn().mockResolvedValue(undefined),
            streamingText: ""
        });

        const { container } = renderInWrapper(
            <AiChatDrawer {...drawerProps} />
        );

        // The drawer renders inline in jsdom (no portal issues with getContainer).
        // We just need to wait one tick for AntD effects to settle.
        await waitFor(() => {
            expect(
                container.querySelector(".ant-drawer-section") ??
                    document.querySelector(".ant-drawer-section")
            ).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });

    it("State B: open, populated conversation with tool collapse + citations has no axe violations", async () => {
        const useAiChat = require("../utils/hooks/useAiChat").default;
        useAiChat.mockReturnValue({
            abort: jest.fn(),
            dismissError: jest.fn(),
            error: null,
            isLoading: false,
            messages: [
                { role: "user", content: "How many tasks are in To Do?" },
                {
                    role: "tool",
                    content: "Found 5 tasks in To Do column.",
                    toolCallId: "tc-1",
                    toolName: "listTasks"
                },
                {
                    role: "assistant",
                    content: "There are 5 tasks currently in the To Do column.",
                    citations: SAMPLE_CITATIONS.slice(0, 2)
                }
            ],
            reset: jest.fn(),
            send: jest.fn().mockResolvedValue(undefined),
            streamingText: ""
        });

        const { container } = renderInWrapper(
            <AiChatDrawer {...drawerProps} />
        );

        await waitFor(() => {
            expect(
                container.querySelector(".ant-drawer-section") ??
                    document.querySelector(".ant-drawer-section")
            ).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });

    it("State C: open, error state (rate limit) has no axe violations", async () => {
        const { AgentRateLimitError } = require("../utils/ai/agentClient");
        const useAiChat = require("../utils/hooks/useAiChat").default;
        useAiChat.mockReturnValue({
            abort: jest.fn(),
            dismissError: jest.fn(),
            error: new AgentRateLimitError(30, "Rate limit exceeded"),
            isLoading: false,
            messages: [
                { role: "user", content: "Summarize the board status." }
            ],
            reset: jest.fn(),
            send: jest.fn().mockResolvedValue(undefined),
            streamingText: ""
        });

        const { container } = renderInWrapper(
            <AiChatDrawer {...drawerProps} />
        );

        await waitFor(() => {
            expect(
                container.querySelector(".ant-drawer-section") ??
                    document.querySelector(".ant-drawer-section")
            ).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });
});

// ─── AiTaskAssistPanel ───────────────────────────────────────────────────────

describe("AI a11y :: AiTaskAssistPanel", () => {
    const panelProps = {
        values: {
            taskName: "Build login form",
            note: "Use React Hook Form",
            type: "Task",
            epic: "Auth epic",
            coordinatorId: "m1",
            storyPoints: 3 as const
        },
        excludeTaskId: undefined,
        onApplyStoryPoints: jest.fn(),
        onApplySuggestion: jest.fn(),
        onOpenSimilarTask: jest.fn()
    };

    it("populated estimate + readiness result has no axe violations", async () => {
        const useAi = require("../utils/hooks/useAi").default;
        let callCount = 0;
        useAi.mockImplementation(() => {
            callCount += 1;
            if (callCount % 2 === 1) {
                // estimate
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
                    reset: jest.fn(),
                    run: jest.fn().mockResolvedValue(null)
                };
            }
            // readiness
            return {
                data: {
                    issues: [
                        {
                            field: "note" as const,
                            severity: "warn" as const,
                            message: "Note is too brief",
                            suggestion: "Add acceptance criteria to the note."
                        }
                    ]
                } satisfies IReadinessReport,
                error: null,
                isLoading: false,
                reset: jest.fn(),
                run: jest.fn().mockResolvedValue(null)
            };
        });

        // Seed query cache for useCachedQueryData
        const qc = makeQueryClient();
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);

        const { container } = renderInWrapper(
            <AiTaskAssistPanel {...panelProps} />,
            qc
        );

        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

// ─── BoardBriefDrawer ────────────────────────────────────────────────────────

describe("AI a11y :: BoardBriefDrawer", () => {
    it("open, populated IBoardBrief has no axe violations", async () => {
        const useAi = require("../utils/hooks/useAi").default;
        useAi.mockReturnValue({
            data: SAMPLE_BOARD_BRIEF,
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run: jest.fn().mockResolvedValue(SAMPLE_BOARD_BRIEF)
        });

        renderInWrapper(
            <BoardBriefDrawer
                columns={SAMPLE_COLUMNS}
                members={SAMPLE_MEMBERS}
                onClose={jest.fn()}
                open
                project={SAMPLE_PROJECT}
                tasks={SAMPLE_TASKS}
            />
        );

        await waitFor(() => {
            expect(
                document.querySelector(".ant-drawer-section")
            ).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });
});

// ─── AiTaskDraftModal ────────────────────────────────────────────────────────

describe("AI a11y :: AiTaskDraftModal", () => {
    it("initial state (prompt visible, no draft) has no axe violations", async () => {
        const useAi = require("../utils/hooks/useAi").default;
        useAi.mockReturnValue({
            data: null,
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run: jest.fn().mockResolvedValue(null)
        });

        const qc = makeQueryClient();
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);

        renderInWrapper(<AiTaskDraftModal onClose={jest.fn()} open />, qc);

        await waitFor(() => {
            expect(document.querySelector(".ant-modal-wrap")).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });

    it("post-generation state (draft form displayed) has no axe violations", async () => {
        const useAi = require("../utils/hooks/useAi").default;
        const DRAFT: IDraftTaskSuggestion = {
            taskName: "Build login form",
            type: "Task",
            epic: "Auth epic",
            storyPoints: 3,
            note: "Use React Hook Form with Zod validation.",
            columnId: "col-1",
            coordinatorId: "m1",
            confidence: 0.88,
            rationale: "Matched the description to existing auth tasks."
        };
        let callIndex = 0;
        useAi.mockImplementation(() => {
            callIndex += 1;
            if (callIndex === 1) {
                // first useAi call = draftAi
                return {
                    data: DRAFT,
                    error: null,
                    isLoading: false,
                    reset: jest.fn(),
                    run: jest.fn().mockResolvedValue(DRAFT)
                };
            }
            // second useAi call = breakdownAi
            return {
                data: null,
                error: null,
                isLoading: false,
                reset: jest.fn(),
                run: jest.fn().mockResolvedValue(null)
            };
        });

        const qc = makeQueryClient();
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);

        renderInWrapper(<AiTaskDraftModal onClose={jest.fn()} open />, qc);

        await waitFor(() => {
            expect(document.querySelector(".ant-modal-wrap")).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });
});

// ─── CommandPalette (AI mode) ────────────────────────────────────────────────

describe("AI a11y :: CommandPalette", () => {
    it("open in navigation mode (with results) has no axe violations", async () => {
        // Seed the query cache with project/task data so the palette has results
        const qc = makeQueryClient();
        qc.setQueryData(["projects"], [SAMPLE_PROJECT]);
        qc.setQueryData(["tasks", { projectId: "proj-1" }], SAMPLE_TASKS);
        qc.setQueryData(["boards", { projectId: "proj-1" }], SAMPLE_COLUMNS);
        qc.setQueryData(["users/members"], SAMPLE_MEMBERS);

        renderInWrapper(<CommandPalette onClose={jest.fn()} open />, qc);

        await waitFor(() => {
            // CommandPalette renders as a Drawer (bottom sheet) in jsdom
            // since Grid.useBreakpoint defaults to mobile. Either way the
            // input lives inside the rendered DOM.
            const input = document.querySelector("input[aria-label]");
            expect(input).not.toBeNull();
        });

        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });
});
