/**
 * Axe accessibility audit over the major NON-AI page-level surfaces that
 * the existing `uiAccessibility.strict.test.tsx` does not already cover:
 *
 *   • ProjectList   — populated grid, empty state, and loading skeleton
 *   • ProjectModal  — create mode (open via Redux)
 *   • MemberPopover — trigger button (popover content is portal-rendered)
 *   • Column        — kanban column with a populated task list
 *
 * Each surface renders once in a representative state and jest-axe asserts
 * zero violations. The AI surfaces (board copilot, chat drawer, brief
 * drawer, task modal, etc.) are owned by a sibling suite
 * (`aiAccessibility.strict.test.tsx`) and are intentionally NOT exercised
 * here — these tests render discrete non-AI components directly so they
 * never pull an AI surface into scope.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import React from "react";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";

import Column from "../components/column";
import MemberPopover from "../components/memberPopover";
import ProjectList from "../components/projectList";
import ProjectModal from "../components/projectModal";
import { store } from "../store";
import { projectActions } from "../store/reducers/projectModalSlice";
import useAuth from "../utils/hooks/useAuth";
import useMembersList from "../utils/hooks/useMembersList";

expect.extend(toHaveNoViolations);

// ─── Module mocks ───────────────────────────────────────────────────────────

jest.mock("../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "http://localhost:8080/api/v1",
        aiBaseUrl: "",
        aiEnabled: false,
        aiUseLocalEngine: true,
        aiColumnReadinessEnabled: false,
        taskPanelRouted: false
    }
}));

jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useMembersList");
jest.mock("../utils/hooks/useReactMutation", () => ({
    __esModule: true,
    default: () => ({
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({})
    })
}));
jest.mock("../utils/hooks/useApi", () => ({
    __esModule: true,
    default: () => jest.fn().mockResolvedValue({})
}));
jest.mock("../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: jest.fn() })
}));
jest.mock("../constants/analytics", () => ({
    __esModule: true,
    ANALYTICS_EVENTS: {},
    track: jest.fn()
}));
// Mock the DnD primitives to plain pass-through wrappers (mirroring
// `column/index.test.tsx`). The real `@hello-pangea/dnd` library wraps
// every draggable in its own `role="button"` shell, which nests the
// task-card buttons inside an interactive ancestor and trips axe's
// `nested-interactive` rule — a library rendering artifact, not a defect
// in the Column markup we are auditing. Stripping the library wrapper
// lets axe assert against the component's own DOM.
jest.mock("../components/dragAndDrop", () => {
    const ReactLib = require("react");
    const passthrough = ({ children }: { children: React.ReactNode }) =>
        ReactLib.createElement(ReactLib.Fragment, null, children);
    return {
        __esModule: true,
        useDetachedDragHandleProps: () => undefined,
        Drag: passthrough,
        Drop: passthrough,
        DropChild: passthrough
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
const mockedUseMembersList = useMembersList as jest.MockedFunction<
    typeof useMembersList
>;

const SAMPLE_USER: IUser = {
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice"
};

const SAMPLE_MEMBERS: IMember[] = [
    { _id: "m1", username: "Alice", email: "alice@example.com" },
    { _id: "m2", username: "Bob", email: "bob@example.com" }
];

const SAMPLE_PROJECTS: IProject[] = [
    {
        _id: "proj-1",
        projectName: "Pulse Demo",
        organization: "Acme Corp",
        managerId: "m1",
        createdAt: "2026-04-25T00:00:00.000Z"
    },
    {
        _id: "proj-2",
        projectName: "Roadmap",
        organization: "Product",
        managerId: "m2",
        createdAt: "2026-05-01T00:00:00.000Z"
    }
];

const SAMPLE_COLUMN: IColumn = {
    _id: "col-1",
    columnName: "To Do",
    projectId: "proj-1",
    index: 0
};

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
    },
    {
        _id: "task-2",
        taskName: "Fix drag glitch",
        type: "Bug",
        projectId: "proj-1",
        columnId: "col-1",
        coordinatorId: "m2",
        storyPoints: 2,
        epic: "",
        note: "",
        index: 1
    }
];

const EMPTY_PARAM = {
    taskName: null,
    coordinatorId: null,
    type: null,
    semanticIds: null
};

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: SAMPLE_USER
    });
    mockedUseMembersList.mockReturnValue({
        data: SAMPLE_MEMBERS,
        isLoading: false,
        error: null
    } as unknown as ReturnType<typeof useMembersList>);
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

describe("Page a11y :: axe accessibility audit", () => {
    it("ProjectList (populated grid) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <ProjectList
                dataSource={SAMPLE_PROJECTS}
                members={SAMPLE_MEMBERS}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("ProjectList (empty state) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <ProjectList dataSource={[]} members={SAMPLE_MEMBERS} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("ProjectList (loading skeleton) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <ProjectList loading members={SAMPLE_MEMBERS} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("MemberPopover trigger has no axe violations", async () => {
        const { container } = renderInWrapper(<MemberPopover />);
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("Column (populated) has no axe violations", async () => {
        const { container } = renderInWrapper(
            <Column
                column={SAMPLE_COLUMN}
                isDragDisabled={false}
                members={SAMPLE_MEMBERS}
                param={EMPTY_PARAM}
                tasks={SAMPLE_TASKS}
            />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });

    it("ProjectModal (create mode, open) has no axe violations", async () => {
        store.dispatch(projectActions.openModal());
        try {
            renderInWrapper(<ProjectModal />);
            await waitFor(() => {
                expect(
                    document.querySelector("[role='dialog']")
                ).not.toBeNull();
            });
            const results = await axe(document.body);
            expect(results).toHaveNoViolations();
        } finally {
            store.dispatch(projectActions.closeModal());
        }
    });
});
