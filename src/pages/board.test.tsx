import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";

import BoardPage from "./board";

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

const LocationProbe = () => {
    const location = useLocation();

    return <div data-testid="current-search">{location.search}</div>;
};

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

const members = [
    member(),
    member({
        _id: "member-2",
        email: "bob@example.com",
        username: "Bob"
    })
];

const defaultColumns = [
    column({ _id: "column-1", columnName: "Todo", index: 0 }),
    column({ _id: "column-2", columnName: "Done", index: 1 }),
    column({ _id: "mock", columnName: "Mock", index: 2 })
];

const defaultTasks = [
    task(),
    task({
        _id: "task-2",
        columnId: "column-1",
        coordinatorId: "member-2",
        taskName: "Fix bug",
        type: "Bug"
    }),
    task({
        _id: "mock",
        columnId: "column-2",
        taskName: "Optimistic task"
    })
];

const response = (body: unknown, ok = true) =>
    ({
        ok,
        status: ok ? 200 : 400,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body))
    }) as unknown as Response;

const silenceExpectedConsoleErrors = (expectedMessages: string[][]) => {
    return jest
        .spyOn(console, "error")
        .mockImplementation((...args: Parameters<typeof console.error>) => {
            const message = args.map(String).join(" ");

            if (
                expectedMessages.some((fragments) =>
                    fragments.every((fragment) => message.includes(fragment))
                )
            ) {
                return;
            }

            throw new Error(`Unexpected console.error: ${message}`);
        });
};

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

const renderBoard = (route = "/projects/project-1/board") => {
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

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={
                                <>
                                    <BoardPage />
                                    <LocationProbe />
                                </>
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("BoardPage", () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const oldTitle = document.title;
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        installAntdBrowserMocks();
        consoleErrorSpy = silenceExpectedConsoleErrors([
            ["Warning: An update to", "BoardPage", "not wrapped in act"]
        ]);
    });

    beforeEach(() => {
        localStorage.clear();
        fetchMock.mockReset();
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(response(project()));
            }
            if (url.includes("boards")) {
                return Promise.resolve(response(defaultColumns));
            }
            if (url.includes("tasks")) {
                return Promise.resolve(response(defaultTasks));
            }

            return Promise.resolve(response({}));
        });
    });

    afterEach(() => {
        document.title = oldTitle;
    });

    afterAll(() => {
        consoleErrorSpy.mockRestore();
        fetchMock.mockRestore();
    });

    it("hides board-scoped AI when Project AI is disabled for this project", async () => {
        localStorage.setItem(
            "boardCopilot:disabledProjectIds",
            JSON.stringify(["project-1"])
        );
        renderBoard();

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", {
                name: /Board Copilot menu/i
            })
        ).not.toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /Board Copilot settings/i })
        );
        expect(
            await screen.findByRole("switch", {
                name: /Board Copilot for this project/i
            })
        ).not.toBeChecked();
    });

    it("mounts MemberPopover in the BoardActions row, surfacing team avatars when members are present (QW-12)", async () => {
        renderBoard();
        // Wait for the board to settle so members query resolves.
        await screen.findByText("Roadmap board");

        // The MemberPopover trigger advertises itself with the
        // "View team members" aria-label and shows the count + initials of
        // the first three members as a small avatar stack. With two
        // members in fixture data we expect both Alice (A) and Bob (B)
        // initials rendered inside the trigger button.
        const trigger = await screen.findByRole("button", {
            name: /view team members/i
        });
        await waitFor(() => {
            expect(trigger.textContent).toContain("2");
        });
        expect(trigger.textContent).toContain("A");
        expect(trigger.textContent).toContain("B");
    });

    it("clears semanticIds from the URL when Project AI is off so the board is not stuck filtered", async () => {
        localStorage.setItem(
            "boardCopilot:disabledProjectIds",
            JSON.stringify(["project-1"])
        );
        renderBoard("/projects/project-1/board?semanticIds=task-1");

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByTestId("current-search")).not.toHaveTextContent(
                "semanticIds"
            );
            expect(screen.getByText("Fix bug")).toBeInTheDocument();
        });
    });

    it("shows the Copilot launcher again after turning Project AI back on", async () => {
        localStorage.setItem(
            "boardCopilot:disabledProjectIds",
            JSON.stringify(["project-1"])
        );
        renderBoard();

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: /Board Copilot settings/i })
        );
        fireEvent.click(
            await screen.findByRole("switch", {
                name: /Board Copilot for this project/i
            })
        );

        expect(
            await screen.findByRole("button", {
                name: /Board Copilot menu/i
            })
        ).toBeInTheDocument();
    });

    it("shows loading, then renders the project board, columns, tasks, and disabled mock drags", async () => {
        let resolveProject: (value: Response) => void = () => undefined;
        let resolveBoards: (value: Response) => void = () => undefined;
        const pendingTaskResolves: Array<(value: Response) => void> = [];
        const flushTasks = (value: Response) => {
            while (pendingTaskResolves.length > 0) {
                const resolve = pendingTaskResolves.shift();
                resolve?.(value);
            }
        };
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return new Promise<Response>((resolve) => {
                    resolveProject = resolve;
                });
            }
            if (url.includes("boards")) {
                return new Promise<Response>((resolve) => {
                    resolveBoards = resolve;
                });
            }
            if (url.includes("tasks")) {
                return new Promise<Response>((resolve) => {
                    pendingTaskResolves.push(resolve);
                });
            }

            return Promise.resolve(response({}));
        });
        const { container } = renderBoard();

        expect(document.title).toBe("Board");
        expect(
            screen.getByLabelText("Loading project name")
        ).toBeInTheDocument();
        // The board no longer renders a redundant <Spin> alongside the
        // skeleton placeholders; the skeleton itself carries the
        // `.ant-skeleton` class.
        expect(container.querySelector(".ant-skeleton")).toBeInTheDocument();

        resolveProject(response(project()));
        await act(async () => {
            await Promise.resolve();
        });
        resolveBoards(response(defaultColumns));
        await act(async () => {
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(pendingTaskResolves.length).toBeGreaterThan(0);
        });
        flushTasks(response(defaultTasks));
        await act(async () => {
            await Promise.resolve();
        });

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        expect(await screen.findByText("Build task")).toBeInTheDocument();
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.getByText("Optimistic task")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Add column" })
        ).toBeInTheDocument();

        const headings = screen
            .getAllByRole("heading", { level: 4 })
            .map((heading) => heading.textContent);
        expect(headings).toEqual(["Todo", "Done", "Mock"]);
        expect(
            screen.getByText("Mock").closest("[data-draggable-id='columnmock']")
        ).toHaveAttribute("data-drag-disabled", "true");
        expect(
            screen
                .getByText("Optimistic task")
                .closest("[data-draggable-id='taskmock']")
        ).toHaveAttribute("data-drag-disabled", "true");
    });

    it("passes URL filters through to columns", async () => {
        renderBoard(
            "/projects/project-1/board?taskName=Fix&type=Bug&coordinatorId=member-2"
        );

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.queryByText("Build task")).not.toBeInTheDocument();
        expect(
            screen.getByPlaceholderText("Search this board")
        ).toBeInTheDocument();
    });

    it("opens the task modal when the Redux store has an editingTaskId", async () => {
        renderBoard();
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
    });

    it("shows a board error alert and retries the board query", async () => {
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(response(project()));
            }
            if (url.includes("boards")) {
                return Promise.resolve(response({}, false));
            }
            if (url.includes("tasks")) {
                return Promise.resolve(response(defaultTasks));
            }

            return Promise.resolve(response({}));
        });
        renderBoard();

        expect(
            await screen.findByText("Couldn't load. Please try again.")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));

        await waitFor(() => {
            const boardRequests = fetchMock.mock.calls.filter(([request]) =>
                String(request).includes("boards")
            );
            expect(boardRequests).toHaveLength(2);
        });
    });

    it("renders an empty board with a first-column CTA and fallback creator", async () => {
        fetchMock.mockImplementation((input) => {
            const url = String(input);

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects")) {
                return Promise.resolve(response(project()));
            }
            if (url.includes("boards")) {
                return Promise.resolve(response([]));
            }
            if (url.includes("tasks")) {
                return Promise.resolve(response([]));
            }

            return Promise.resolve(response({}));
        });
        renderBoard();

        expect(await screen.findByText("Roadmap board")).toBeInTheDocument();
        expect(screen.getByText("Add your first column")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Create your first column" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Add column" })
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Create your first column" })
        );
        expect(
            await screen.findByLabelText("New column name")
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { level: 4 })
        ).not.toBeInTheDocument();
    });
});
