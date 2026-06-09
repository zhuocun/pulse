import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";
import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";

/*
 * Phase 3 A1 / PRD-GAP-006 — flag-on / kill-switch mount coverage for
 * the CopilotDock.
 *
 * The dock mounts in `MainLayout` via `CopilotDockHost` so it survives
 * project-route navigations; these tests render the host alongside the
 * page so the mount/no-mount assertions exercise the dock from the
 * shape it has in production. The dock is now the live AI surface
 * (default ON) and the legacy `<AiChatDrawer>` / `<BoardBriefDrawer>`
 * standalone mounts have been removed entirely — so when the kill-switch
 * (`copilotDockEnabled = false`) is engaged the board renders NO AI
 * surface at all.
 *
 * The flag is checked at module load through
 * `environment.copilotDockEnabled`, so we mock `constants/env` per
 * scenario and re-require `pages/board` / the host after mutating the
 * mock.
 */

type DragDropContextMockProps = {
    children: ReactNode;
    onDragEnd?: unknown;
};

type DraggableProvidedMock = {
    dragHandleProps: Record<string, string>;
    draggableProps: Record<string, string | number>;
    innerRef: jest.Mock;
};

type DraggableMockProps = {
    children: (provided: DraggableProvidedMock) => ReactNode;
    draggableId: string;
    index: number;
    isDragDisabled?: boolean;
};

type DroppableProvidedMock = {
    droppableProps: Record<string, string>;
    innerRef: jest.Mock;
    placeholder: ReactNode;
};

type DroppableMockProps = {
    children: (provided: DroppableProvidedMock) => ReactNode;
    droppableId: string;
};

jest.mock("@hello-pangea/dnd", () => {
    const React = jest.requireActual("react");
    return {
        DragDropContext: ({
            children,
            onDragEnd
        }: DragDropContextMockProps) => (
            <div data-has-drag-end={String(Boolean(onDragEnd))}>{children}</div>
        ),
        Draggable: ({
            children,
            draggableId,
            index,
            isDragDisabled
        }: DraggableMockProps) =>
            children({
                dragHandleProps: {
                    "data-drag-handle-id": draggableId
                },
                draggableProps: {
                    "data-drag-disabled": String(Boolean(isDragDisabled)),
                    "data-draggable-id": draggableId,
                    "data-draggable-index": index
                },
                innerRef: jest.fn()
            }),
        Droppable: ({ children, droppableId }: DroppableMockProps) =>
            children({
                droppableProps: {
                    "data-droppable-id": droppableId
                },
                innerRef: jest.fn(),
                placeholder: React.createElement("span", {
                    "data-testid": `placeholder-${droppableId}`
                })
            })
    };
});

// Mutable env mock shared by all tests in this file. Tests flip the
// `copilotDockEnabled` field between renders to exercise both flag
// states without re-mocking the module.
const mockEnv: Record<string, unknown> = {
    apiBaseUrl: "/api/v1",
    aiBaseUrl: "",
    aiEnabled: true,
    aiUseLocalEngine: true,
    aiMutationProposalsEnabled: true,
    aiKnowledgeCutoff: "January 2026",
    bottomNavEnabled: true,
    taskPanelRouted: false,
    copilotDockEnabled: false
};

jest.mock("../constants/env", () => ({
    __esModule: true,
    get default() {
        return mockEnv;
    }
}));

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
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

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const members = [member()];
const columns = [column({ _id: "column-1", columnName: "Todo", index: 0 })];
const tasks = [task()];

const response = (body: unknown, ok = true) =>
    ({
        ok,
        status: ok ? 200 : 400,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body))
    }) as unknown as Response;

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

// Imported lazily after the env mock is installed so the module's
// `environment.copilotDockEnabled` read picks up the mutable mock.
// eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
const BoardPage = require("./board").default as React.ComponentType;
// eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
const CopilotDockHost = require("../components/copilotDock/copilotDockHost")
    .default as React.ComponentType;

const renderBoard = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users"], user());
    store.dispatch(overlaysActions.closeTaskModal());
    store.dispatch(overlaysActions.closeChatDrawer());
    store.dispatch(overlaysActions.closeBoardBrief());
    store.dispatch(overlaysActions.closeAiDraft());
    store.dispatch(overlaysActions.closeCopilotDock());
    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/project-1/board"]}>
                    {/*
                     * Mirror production layering: the host mounts
                     * ABOVE the routed page in `MainLayout`. Render
                     * it here so the dock surface comes from the
                     * same callsite as in prod (R-A M1).
                     */}
                    <CopilotDockHost />
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<BoardPage />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("BoardPage · CopilotDock flag", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        localStorage.clear();
        // Reset the env mock for each test. Individual tests opt in to
        // `copilotDockEnabled = true` before rendering.
        mockEnv.copilotDockEnabled = false;
        fetchMock.mockReset();
        fetchMock.mockImplementation((input) => {
            const url = String(input);
            if (url.includes("users/members"))
                return Promise.resolve(response(members));
            if (url.includes("projects"))
                return Promise.resolve(response(project()));
            if (url.includes("boards"))
                return Promise.resolve(response(columns));
            if (url.includes("tasks")) return Promise.resolve(response(tasks));
            return Promise.resolve(response({}));
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("renders no AI surface when copilotDockEnabled is off (rollback kill-switch)", async () => {
        mockEnv.copilotDockEnabled = false;
        renderBoard();
        await screen.findByText("Roadmap");

        // Open the chat drawer via the Redux action — with the dock
        // kill-switch off and the legacy drawers removed, nothing should
        // mount: neither the dock shell nor a chat composer.
        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        await waitFor(() => {
            expect(
                screen.queryByTestId("copilot-dock")
            ).not.toBeInTheDocument();
        });
        expect(
            screen.queryByRole("textbox", {
                name: /message board copilot/i
            })
        ).not.toBeInTheDocument();

        // GAP-006: the board-page launchers (CopilotMenu split button +
        // first-run welcome banner) are dead controls when the dock
        // host is killed, so they must not render either. Assert by the
        // launcher's accessible names / banner region + title, plus the
        // shared launcher-badge test id the CopilotMenu wraps.
        expect(
            screen.queryByTestId("copilot-launcher-badge")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", {
                name: microcopy.a11y.boardCopilotMenu
            })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("region", {
                name: microcopy.a11y.boardCopilotWelcome
            })
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(microcopy.ai.welcomeBannerTitle)
        ).not.toBeInTheDocument();
    });

    it("mounts the CopilotDock instead of the legacy drawers when copilotDockEnabled is on", async () => {
        mockEnv.copilotDockEnabled = true;
        renderBoard();
        await screen.findByText("Roadmap");

        // Same Redux trigger — but with the flag on the dock owns the
        // surface and the legacy drawers do not mount their own
        // Drawer shells.
        act(() => {
            store.dispatch(overlaysActions.openChatDrawer());
        });
        const dock = await screen.findByTestId("copilot-dock");
        expect(dock).toBeInTheDocument();
        // Tab list confirms it's the dock chrome, not the legacy
        // drawer header.
        expect(screen.getByRole("tablist")).toBeInTheDocument();
        // GAP-006: with the kill-switch on, the board launchers are
        // live controls and must render so a click reaches the dock.
        expect(
            screen.getByRole("button", {
                name: microcopy.a11y.boardCopilotMenu
            })
        ).toBeInTheDocument();
    });

    it("switches to the Brief tab when the brief overlay flag is the active surface", async () => {
        mockEnv.copilotDockEnabled = true;
        renderBoard();
        await screen.findByText("Roadmap");

        act(() => {
            store.dispatch(overlaysActions.openBoardBrief());
        });
        await screen.findByTestId("copilot-dock");

        // The brief tab is the active one — AntD marks it via
        // aria-selected=true on the role=tab.
        const briefTab = screen.getByRole("tab", { name: /Brief/i });
        expect(briefTab).toHaveAttribute("aria-selected", "true");
    });
});
