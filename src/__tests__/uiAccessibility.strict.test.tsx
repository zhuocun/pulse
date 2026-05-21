/**
 * Minimal axe accessibility audit over the major non-AI and AI surfaces.
 *
 * Each surface is rendered once in its default / populated state and
 * jest-axe asserts no violations. Heavy AI hooks (`useAi`, `useAiChat`,
 * `useAgent`) are mocked so the components can render without a query
 * client subscriber.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import AiChatDrawer from "../components/aiChatDrawer";
import AiSearchInput from "../components/aiSearchInput";
import AiTaskAssistPanel from "../components/aiTaskAssistPanel";
import AiTaskDraftModal from "../components/aiTaskDraftModal";
import BoardBriefDrawer from "../components/boardBriefDrawer";
import EmptyState from "../components/emptyState";
import ErrorBox from "../components/errorBox";
import Header from "../components/header";
import LoginForm from "../components/loginForm";
import RegisterForm from "../components/registerForm";
import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";

expect.extend(toHaveNoViolations);

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
jest.mock("../utils/hooks/useAi", () => ({
    __esModule: true,
    assertRunPayloadProjectsAiAllowed: jest.fn(),
    default: jest.fn(() => ({
        data: null,
        error: null,
        isLoading: false,
        reset: jest.fn(),
        run: jest.fn().mockResolvedValue(null)
    }))
}));
jest.mock("../utils/hooks/useAgent", () => {
    const noop = () => undefined;
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
        resume: jest.fn().mockResolvedValue(undefined),
        seedMessages: noop,
        start: jest.fn().mockResolvedValue(undefined),
        state: { messages: [] },
        status: "idle" as const,
        threadId: "stub-thread",
        ttftMs: null
    };
    return { __esModule: true, default: () => stub };
});
jest.mock("../utils/hooks/useAiChat", () => {
    const noop = () => undefined;
    const stub = {
        abort: noop,
        dismissError: noop,
        error: null,
        isLoading: false,
        messages: [],
        reset: noop,
        seedMessages: noop,
        send: () => Promise.resolve(),
        streamingText: ""
    };
    return { __esModule: true, default: () => stub };
});
jest.mock("../utils/hooks/useAgentChat", () => {
    const noop = () => undefined;
    const stub = {
        abort: noop,
        citations: [],
        dismissError: noop,
        dismissNudge: noop,
        error: null,
        isLoading: false,
        messages: [],
        pendingNudges: [],
        pendingProposal: null,
        reset: noop,
        resumeProposal: noop,
        seedMessages: noop,
        send: () => Promise.resolve(),
        streamingText: ""
    };
    return { __esModule: true, default: () => stub };
});
jest.mock("../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn() })
}));
jest.mock("../constants/analytics", () => ({
    __esModule: true,
    ANALYTICS_EVENTS: {},
    track: jest.fn()
}));
jest.mock("../assets/logo-software.svg?react", () => {
    const ReactLib = require("react");
    return {
        __esModule: true,
        default: (props: Record<string, unknown>) =>
            ReactLib.createElement("svg", { "data-testid": "logo", ...props })
    };
});
jest.mock("../components/memberPopover", () => {
    const ReactLib = require("react");
    return {
        __esModule: true,
        default: () => ReactLib.createElement("span", null, "Members")
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

// ─── jsdom gaps ─────────────────────────────────────────────────────────────

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

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        value: 800
    });
});

// ─── Hook defaults ──────────────────────────────────────────────────────────

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
    { _id: "col-1", columnName: "To Do", projectId: "proj-1", index: 0 }
];

const SAMPLE_MEMBERS: IMember[] = [
    { _id: "m1", username: "Alice", email: "alice@example.com" }
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
});

// ─── Provider wrapper (intentionally minimal — no AntdApp/ConfigProvider) ───

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });
    return (
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>{children}</BrowserRouter>
            </QueryClientProvider>
        </Provider>
    );
};

const renderInWrapper = (ui: React.ReactElement) =>
    render(<Wrapper>{ui}</Wrapper>);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("UI quality :: axe accessibility audit", () => {
    it("LoginForm has no axe violations", async () => {
        const { container } = renderInWrapper(
            <LoginForm onError={jest.fn()} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("RegisterForm has no axe violations", async () => {
        const { container } = renderInWrapper(
            <RegisterForm onError={jest.fn()} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("EmptyState with CTA has no axe violations", async () => {
        const { container } = renderInWrapper(
            <EmptyState
                cta={
                    <button type="button">
                        {microcopy.actions.createProject}
                    </button>
                }
                description="Get started"
                title="No projects yet"
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("ErrorBox in alert state has no axe violations", async () => {
        const { container } = renderInWrapper(
            <ErrorBox error={new Error("Server unavailable")} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("Header has no axe violations when user is signed in", async () => {
        const { container } = renderInWrapper(<Header />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

describe("AI a11y :: axe accessibility audit", () => {
    it("BoardBriefDrawer (open) has no axe violations", async () => {
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
            expect(document.querySelector("[role='dialog']")).not.toBeNull();
        });
        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });

    it("AiTaskDraftModal (initial) has no axe violations", async () => {
        renderInWrapper(<AiTaskDraftModal onClose={jest.fn()} open />);
        await waitFor(() => {
            expect(document.querySelector("[role='dialog']")).not.toBeNull();
        });
        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });

    it("AiTaskAssistPanel has no axe violations", async () => {
        const { container } = renderInWrapper(
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
                    storyPoints: 3
                }}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("AiSearchInput (tasks kind, empty) has no axe violations", async () => {
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

    it("AiChatDrawer (open) has no axe violations", async () => {
        // Render without `AntdApp` to stay consistent with the other AI
        // surfaces here — wrapping with `<AntdApp component={false}>` would
        // re-trigger AntD's cssVar warning and the jsdom NaN-height path.
        // `App.useApp()` inside the drawer falls back to a no-op message
        // bag when no provider is present, which is fine because nothing
        // in this test triggers a feedback toast.
        renderInWrapper(
            <AiChatDrawer
                columns={SAMPLE_COLUMNS}
                knownProjectIds={[SAMPLE_PROJECT._id]}
                members={SAMPLE_MEMBERS}
                onClose={jest.fn()}
                open
                project={SAMPLE_PROJECT}
                tasks={SAMPLE_TASKS}
            />
        );
        await waitFor(() => {
            expect(document.querySelector("[role='dialog']")).not.toBeNull();
        });
        const results = await axe(document.body);
        expect(results).toHaveNoViolations();
    });
});
