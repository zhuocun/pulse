/*
 * Phase 4 W3 — TaskModal ghost-text integration check.
 *
 * Targets the conditional in `index.tsx` that swaps the bare
 * `Input.TextArea` for the `<AiGhostText>`-wrapped variant when the
 * `REACT_APP_AI_GHOST_TEXT_ENABLED` flag is on AND the user has
 * acknowledged the route-scoped privacy disclosure. Avoids re-running
 * the entire mutation/lifecycle suite — those live in `index.test.tsx`.
 */
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import { overlaysActions } from "../../store/reducers/overlaysSlice";

import TaskModal from ".";

jest.mock("../../constants/env", () => ({
    __esModule: true,
    default: {
        apiBaseUrl: "/api/v1",
        aiBaseUrl: "",
        aiEnabled: true,
        aiUseLocalEngine: true,
        aiMutationProposalsEnabled: true,
        aiKnowledgeCutoff: "January 2026",
        bottomNavEnabled: true,
        taskPanelRouted: false,
        copilotDockEnabled: false,
        aiColumnReadinessEnabled: false,
        aiGhostTextEnabled: false
    }
}));

const setFlag = (value: boolean) => {
    jest.requireMock("../../constants/env").default.aiGhostTextEnabled = value;
};

const installAntdBrowserMocks = () => {
    // setupTests.ts already wires matchMedia + ResizeObserver as
    // writable but not configurable, so we re-assign the value rather
    // than re-defining the property.
    (
        window as unknown as { matchMedia: (query: string) => MediaQueryList }
    ).matchMedia = ((query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    })) as unknown as (query: string) => MediaQueryList;
};

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const renderModal = () => {
    store.dispatch(overlaysActions.startEditingTask("task-1"));
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], [member()]);
    queryClient.setQueryData(["projects", { projectId: "project-1" }], {
        _id: "project-1",
        projectName: "Roadmap",
        organization: "Acme",
        managerId: "member-1",
        createdAt: "2026-01-01"
    });
    queryClient.setQueryData(
        ["boards", { projectId: "project-1" }],
        [
            {
                _id: "column-1",
                columnName: "Backlog",
                index: 0,
                projectId: "project-1"
            }
        ]
    );
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<TaskModal tasks={[task()]} />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    setFlag(false);
});

afterEach(() => {
    act(() => {
        jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    store.dispatch(overlaysActions.closeTaskModal());
});

describe("TaskModal ghost-text integration", () => {
    it("renders the plain notes textarea when the ghost-text flag is off", async () => {
        setFlag(false);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        // Note field should mount as the bare AntD textarea — no
        // ghost-text shell.
        await screen.findByText(/edit task · build task/i);
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("renders the plain notes textarea when the flag is on but consent is missing", async () => {
        setFlag(true);
        // localStorage cleared in beforeEach → no consent
        renderModal();
        await screen.findByText(/edit task · build task/i);
        // The privacy disclosure should be visible (consent gate
        // surfaced for the user to acknowledge).
        expect(screen.getAllByText(/got it/i).length).toBeGreaterThan(0);
        // But the wrapper shell is *not* mounted because consent is
        // still false (AiGhostText falls through to the bare child).
        expect(screen.queryByTestId("ai-ghost-text")).not.toBeInTheDocument();
    });

    it("activates the ghost-text wrapper when the flag is on and consent is given", async () => {
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        await screen.findByText(/edit task · build task/i);
        await waitFor(() => {
            expect(screen.getByTestId("ai-ghost-text")).toBeInTheDocument();
        });
    });

    it("renders the overlay after typing and waiting for the debounce", async () => {
        setFlag(true);
        window.localStorage.setItem("boardCopilot:privacyShown:task-note", "1");
        renderModal();
        await screen.findByText(/edit task · build task/i);
        const noteFields = screen
            .getAllByRole("textbox")
            .filter((el) => el.tagName.toLowerCase() === "textarea");
        expect(noteFields.length).toBeGreaterThan(0);
        const note = noteFields[0] as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(note, {
                target: { value: "Customers cannot complete checkout" }
            });
        });
        await act(async () => {
            jest.advanceTimersByTime(600);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId("ai-ghost-text-overlay")
            ).toBeInTheDocument();
        });
    });
});
