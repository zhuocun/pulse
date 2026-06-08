import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { store } from "../store";
import { overlaysActions } from "../store/reducers/overlaysSlice";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";

import BoardPage from "./board";

/*
 * `useIsPhoneChrome` is `(pointer: coarse)`; jsdom defaults to desktop
 * (false). Mock it so the existing suite keeps the desktop branch and a
 * focused test can flip to the phone branch to assert the Liquid Glass
 * toolbar cluster. The default factory returns `false` so every test
 * that doesn't opt in stays on the desktop layout.
 */
jest.mock("../utils/hooks/useIsPhoneChrome");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;

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
    store.dispatch(overlaysActions.closeTrashDrawer());
    store.dispatch(overlaysActions.closeArchiveDrawer());
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
        // Default to the desktop chrome; the phone-cluster test opts into
        // the coarse-pointer branch explicitly.
        mockedUseIsPhoneChrome.mockReturnValue(false);
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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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
        await screen.findByText("Roadmap");

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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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

    /*
     * Phase 4 A8 review M2 regression: the launcher-badge aria-label
     * MUST render as a human-readable sentence, NOT raw template
     * syntax. The original locale embedded ICU plural braces
     * (`{count, plural, one {nudge} other {nudges}}`) but this codebase
     * has no ICU formatter — call sites used plain `.replace("{count}", …)`
     * which left the ICU syntax intact and exposed it to screen-reader
     * users (e.g. "3 unread Copilot {count, plural, one {nudge} other {nudges}}").
     * Replaced with two static one/other keys; the call site picks the
     * right key off the count.
     */
    it("renders the launcher badge aria-label as a human-readable string (no ICU template syntax)", async () => {
        store.dispatch(overlaysActions.setCopilotDockInboxUnread(3));
        renderBoard();
        await screen.findByText("Roadmap");

        const badge = screen.getByTestId("copilot-launcher-badge");
        const ariaLabel = badge.getAttribute("aria-label") ?? "";
        expect(ariaLabel).toBe("3 unread Copilot nudges");
        expect(ariaLabel).not.toContain("{count");
        expect(ariaLabel).not.toContain("plural");

        store.dispatch(overlaysActions.setCopilotDockInboxUnread(0));
    });

    it("uses the singular badge aria-label when the unread count is exactly 1", async () => {
        store.dispatch(overlaysActions.setCopilotDockInboxUnread(1));
        renderBoard();
        await screen.findByText("Roadmap");

        const badge = screen.getByTestId("copilot-launcher-badge");
        expect(badge.getAttribute("aria-label")).toBe("1 unread Copilot nudge");

        store.dispatch(overlaysActions.setCopilotDockInboxUnread(0));
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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
        expect(screen.getByText("Fix bug")).toBeInTheDocument();
        expect(screen.queryByText("Build task")).not.toBeInTheDocument();
        expect(
            screen.getByPlaceholderText("Search this board")
        ).toBeInTheDocument();
    });

    it("opens the task modal when the Redux store has an editingTaskId", async () => {
        renderBoard();
        store.dispatch(overlaysActions.startEditingTask("task-1"));

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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

        expect(await screen.findByText("Roadmap")).toBeInTheDocument();
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

    describe("A7 lenses", () => {
        it("mounts the lens chip row behind the lenses toggle", async () => {
            renderBoard();

            expect(await screen.findByText("Roadmap")).toBeInTheDocument();

            expect(
                screen.queryByRole("group", { name: /board lenses/i })
            ).not.toBeInTheDocument();

            await userEvent.click(screen.getByTestId("board-lenses-toggle"));

            expect(
                screen.getByRole("group", { name: /board lenses/i })
            ).toBeInTheDocument();
            expect(
                screen.getByRole("button", { name: /mine/i })
            ).toBeInTheDocument();
            expect(
                screen.getByRole("button", { name: /this week/i })
            ).toBeInTheDocument();
        });

        it("applies the Mine lens after the filter rail, narrowing to the current user's tasks", async () => {
            renderBoard("/projects/project-1/board?lens=mine");

            // Wait for the board to render; the seeded user is member-1
            // (Alice), so only "Build task" (coordinatorId: member-1)
            // should remain on the board. "Fix bug" belongs to member-2.
            expect(await screen.findByText("Roadmap")).toBeInTheDocument();
            await waitFor(() => {
                expect(screen.getByText("Build task")).toBeInTheDocument();
            });
            expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();

            // The filter rail's underlying field still shows in the URL —
            // lens layers on top of (does not replace) the existing rail.
            expect(screen.getByTestId("current-search")).toHaveTextContent(
                "lens=mine"
            );
        });

        it("layers the lens predicate on top of filter-rail filters (AND semantics)", async () => {
            // Filter rail narrows to type=Task; lens narrows to mine.
            // Both must apply.
            renderBoard("/projects/project-1/board?lens=mine&type=Task");

            expect(await screen.findByText("Roadmap")).toBeInTheDocument();
            // Build task is type=Task AND coordinated by member-1 → visible.
            expect(screen.getByText("Build task")).toBeInTheDocument();
            // Fix bug is type=Bug AND coordinated by member-2 → hidden by
            // both filters.
            expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();
        });

        it("graceful-skips the Today lens (no dueDate on ITask yet) — board renders unchanged", async () => {
            renderBoard("/projects/project-1/board?lens=today");

            expect(await screen.findByText("Roadmap")).toBeInTheDocument();
            // No dueDate → predicate is a no-op → both tasks visible.
            await waitFor(() => {
                expect(screen.getByText("Build task")).toBeInTheDocument();
            });
            expect(screen.getByText("Fix bug")).toBeInTheDocument();
        });

        it("toggles the lens via URL when chips are clicked, and clears on re-click", async () => {
            renderBoard();

            expect(await screen.findByText("Roadmap")).toBeInTheDocument();

            await userEvent.click(screen.getByTestId("board-lenses-toggle"));

            const mineChip = screen.getByRole("button", { name: /mine/i });
            fireEvent.click(mineChip);

            await waitFor(() => {
                expect(screen.getByTestId("current-search")).toHaveTextContent(
                    "lens=mine"
                );
            });
            // Board now only renders the current user's task.
            expect(screen.queryByText("Fix bug")).not.toBeInTheDocument();

            // Re-clicking the active lens clears it back to All.
            fireEvent.click(screen.getByRole("button", { name: /mine/i }));
            await waitFor(() => {
                expect(
                    screen.getByTestId("current-search")
                ).not.toHaveTextContent("lens");
            });
            expect(screen.getByText("Fix bug")).toBeInTheDocument();
        });
    });

    describe("toolbar Liquid Glass cluster (phone)", () => {
        it("clusters the toolbar controls into the shared glass capsule on phone", async () => {
            mockedUseIsPhoneChrome.mockReturnValue(true);
            renderBoard();

            await screen.findByText("Roadmap");

            const cluster = await screen.findByTestId("board-actions-cluster");
            // MemberPopover trigger is clustered.
            expect(cluster).toContainElement(
                screen.getByRole("button", { name: /view team members/i })
            );
            // Wave 6 — the phone-only refresh button is the first segment
            // in the capsule (the board has no vertical pull-to-refresh
            // gesture, so the toolbar button is the honest affordance).
            expect(cluster).toContainElement(
                screen.getByTestId("board-refresh")
            );
            expect(cluster).toContainElement(
                screen.getByTestId("board-more-actions")
            );
            // Copilot is reachable from the bottom tab bar on phone — not
            // duplicated in the board header capsule.
            expect(
                screen.queryByTestId("copilot-launcher-badge")
            ).not.toBeInTheDocument();
            // Trash + Archive move into the overflow menu on phone to keep
            // the capsule within the viewport.
            expect(screen.queryByTestId("board-trash")).not.toBeInTheDocument();
            expect(
                screen.queryByTestId("board-archive")
            ).not.toBeInTheDocument();
            // Refresh + Members + More = 3 slots.
            expect(
                cluster.querySelectorAll(".pulse-cluster-slot")
            ).toHaveLength(3);
            // The controls remain individually focusable inside the
            // capsule — the shared glass background is purely visual.
            const moreActions = screen.getByTestId("board-more-actions");
            moreActions.focus();
            expect(moreActions).toHaveFocus();
        });

        it("renders the toolbar controls in the plain BoardActions row on desktop (no capsule)", async () => {
            mockedUseIsPhoneChrome.mockReturnValue(false);
            renderBoard();

            await screen.findByText("Roadmap");

            // No glass capsule on desktop.
            expect(
                screen.queryByTestId("board-actions-cluster")
            ).not.toBeInTheDocument();
            // The same controls still render — just in the flat flex row.
            expect(
                screen.getByTestId("copilot-launcher-badge")
            ).toBeInTheDocument();
            expect(
                screen.getByRole("button", {
                    name: /Board Copilot settings/i
                })
            ).toBeInTheDocument();
            // The Wave 6 refresh button is phone-only — never on desktop,
            // where the board has its own in-page refresh affordances.
            expect(
                screen.queryByTestId("board-refresh")
            ).not.toBeInTheDocument();
        });
    });

    describe("Trash drawer entry point (work-management-depth §5.4/§5.6)", () => {
        it("renders a Trash button in the BoardActions row that opens the drawer", async () => {
            // The trash drawer filters its widened `?includeTrashed=true`
            // response to only `deletedAt`-set rows, so the default board
            // fixtures (all active) would surface zero rows. Return a
            // genuinely-trashed task for the trash GET while keeping the
            // active fixtures for the board's own `?projectId=…` GET.
            const trashedTask = task({
                _id: "trashed-1",
                taskName: "Trashed task",
                deletedAt: "2026-01-01T00:00:00.000Z"
            });
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
                if (url.includes("includeTrashed")) {
                    return Promise.resolve(response([trashedTask]));
                }
                if (url.includes("tasks")) {
                    return Promise.resolve(response(defaultTasks));
                }
                return Promise.resolve(response({}));
            });
            renderBoard();
            await screen.findByText("Roadmap");

            // Closed by default — the drawer body is not mounted.
            expect(
                screen.queryByTestId("trash-drawer-body")
            ).not.toBeInTheDocument();

            const trashButton = screen.getByTestId("board-trash");
            expect(trashButton).toHaveAccessibleName(/open trash/i);
            fireEvent.click(trashButton);

            // The drawer opens and lists the project's trashed tasks. The
            // `?includeTrashed=true` GET returns one trashed fixture, so the
            // body surfaces a row.
            expect(
                await screen.findByTestId("trash-drawer-body")
            ).toBeInTheDocument();
            await waitFor(() =>
                expect(
                    screen.getAllByTestId("trash-drawer-row").length
                ).toBeGreaterThan(0)
            );
            // The drawer's open state is owned by the overlays slice.
            expect(store.getState().overlays.trashDrawerOpen).toBe(true);
        });
    });
});
