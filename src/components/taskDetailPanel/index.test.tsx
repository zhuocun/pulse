import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "antd";
import { Provider } from "react-redux";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

import TaskDetailPanel from ".";

/*
 * Focused unit tests for the routed TaskDetailPanel (Phase 3 A2).
 * The panel co-exists with TaskModal behind the
 * `environment.taskPanelRouted` flag; these tests target the new
 * component directly without going through the route layer. Route-
 * shape coverage (flag on vs off) lives in `src/routes/index.test.tsx`.
 *
 * We use `createMemoryRouter` for the dirty-guard / blocker tests
 * because `useBlocker` only fires under a data router. The simpler
 * tests use `MemoryRouter` for terseness.
 */

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
    note: "No note",
    projectId: "project-1",
    storyPoints: 3,
    taskName: "Build task",
    type: "Task",
    ...overrides
});

const members = [
    member(),
    member({ _id: "member-2", email: "bob@example.com", username: "Bob" })
];

const installAntdBrowserMocks = () => {
    const impl = (query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    });
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: impl
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

const installCoarsePointerMock = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches:
                query === "(pointer: coarse)" ||
                query.includes("max-width: 767px"),
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

/*
 * Desktop-lg viewport mock for the Phase 3 A2 docked rail. The panel's
 * `isDesktopRail` predicate is `!isPhone && screens.lg`, so we need:
 *   - `pointer: coarse` to match false (NOT phone)
 *   - the AntD breakpoint hook to resolve `screens.lg === true`
 *
 * AntD's `Grid.useBreakpoint` reads `window.matchMedia` for each
 * breakpoint band. `lg` is `(min-width: 1024px)`; we return true for
 * that AND for the lower bands (sm, md) since AntD treats breakpoints
 * cumulatively. Anything narrower (xl, xxl) returns false.
 */
const installDesktopLgMock = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => {
            const isLgOrBelow =
                query.includes("min-width: 576px") ||
                query.includes("min-width: 768px") ||
                query.includes("min-width: 992px") ||
                query.includes("min-width: 1024px");
            return {
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: isLgOrBelow,
                media: query,
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            };
        }
    });
};

const seedQueryClient = (
    initialTasks: ITask[] | undefined,
    initialColumns?: IColumn[]
) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    queryClient.setQueryData(["users/members"], members);
    if (initialTasks !== undefined) {
        queryClient.setQueryData(
            ["tasks", { projectId: "project-1" }],
            initialTasks
        );
    }
    // Sibling navigation reads the `boards` cache for the column-task
    // order. Seed it whenever the caller provides columns; default to
    // a single column so the multi-sibling tests in this suite have
    // explicit data without polluting the legacy single-task tests.
    if (initialColumns !== undefined) {
        queryClient.setQueryData(
            ["boards", { projectId: "project-1" }],
            initialColumns
        );
    }
    return queryClient;
};

interface RenderOptions {
    initialTasks?: ITask[] | undefined;
    initialColumns?: IColumn[];
    taskId?: string;
    projectId?: string;
    boardAiOn?: boolean;
}

const renderPanelAt = (path: string, options: RenderOptions = {}) => {
    const initialTasks = Object.prototype.hasOwnProperty.call(
        options,
        "initialTasks"
    )
        ? options.initialTasks
        : [task()];
    const queryClient = seedQueryClient(initialTasks, options.initialColumns);
    const router = createMemoryRouter(
        [
            {
                path: "/projects/:projectId/board",
                element: (
                    <div>
                        <div data-testid="board-mock">Kanban board</div>
                        <Outlet />
                    </div>
                ),
                children: [
                    {
                        path: "task/:taskId",
                        element: (
                            <TaskDetailPanel
                                boardAiOn={options.boardAiOn ?? true}
                                projectId={options.projectId ?? "project-1"}
                                taskId={options.taskId ?? "task-1"}
                            />
                        )
                    }
                ]
            }
        ],
        { initialEntries: [path] }
    );
    return {
        router,
        ...render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </Provider>
        )
    };
};

describe("TaskDetailPanel", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        // The tasks endpoint resolves to an ITask[]. The members
        // endpoint resolves to an IMember[]. Our cache pre-seeds
        // both, but react-query will still fire a background fetch
        // when staleTime is the default — the mock keeps the array
        // shape so the panel sees a list either way.
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/tasks")
                ? [task()]
                : url.includes("/users/members")
                  ? members
                  : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("renders the panel with the resolved task data when the route matches", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");

        // The drawer surface is mounted (and the board beneath stays
        // visible — the layout outlet test).
        expect(
            await screen.findByText(/edit task · build task/i)
        ).toBeInTheDocument();
        expect(screen.getByTestId("board-mock")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Build task")).toBeInTheDocument();
    });

    it("mounts as a right-placement drawer on desktop/tablet (default jsdom mocks)", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");

        await screen.findByText(/edit task · build task/i);

        // Assert on the public `data-placement` attribute so we don't
        // couple to AntD's internal `.ant-drawer-*` classnames (B-T2).
        // jsdom default mocks `pointer: coarse` to false, so
        // `useIsPhoneChrome()` returns false and the right-drawer
        // branch wins.
        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        );
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute("data-placement")).toBe("right");
    });

    it("mounts as a bottom-sheet on coarse-pointer phone viewports", async () => {
        installCoarsePointerMock();
        renderPanelAt("/projects/project-1/board/task/task-1");
        await screen.findByText(/edit task · build task/i);

        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        );
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute("data-placement")).toBe("bottom");
        // Restore default mock for subsequent tests.
        installAntdBrowserMocks();
    });

    it("submits a changed task via the same PUT mutation as TaskModal", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");
        const input = await screen.findByDisplayValue("Build task");

        fireEvent.change(input, {
            target: { value: "Build task details" }
        });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        // Filter the call list down to PUT /tasks calls (the panel
        // also background-fetches the task list + members on mount,
        // both via GET).
        await waitFor(() => {
            const putCalls = fetchMock.mock.calls.filter(
                (call) => (call[1] as RequestInit | undefined)?.method === "PUT"
            );
            expect(putCalls.length).toBeGreaterThanOrEqual(1);
        });
        const putCall = fetchMock.mock.calls.find(
            (call) => (call[1] as RequestInit | undefined)?.method === "PUT"
        )!;
        expect(putCall[0]).toContain("/api/v1/tasks");
        expect(JSON.parse(putCall[1]?.body as string)).toEqual(
            expect.objectContaining({
                _id: "task-1",
                taskName: "Build task details"
            })
        );
    });

    it("deletes the task via the same DELETE mutation as TaskModal", async () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });

        renderPanelAt("/projects/project-1/board/task/task-1");
        await screen.findByText(/edit task · build task/i);
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => {
            const deleteCalls = fetchMock.mock.calls.filter(
                (call) =>
                    (call[1] as RequestInit | undefined)?.method === "DELETE"
            );
            expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
        });
        const deleteCall = fetchMock.mock.calls.find(
            (call) => (call[1] as RequestInit | undefined)?.method === "DELETE"
        )!;
        // DELETE requests pass data as a querystring rather than a
        // body — see `src/utils/hooks/useApi.ts`. Assert the URL
        // carries the right task id.
        expect(deleteCall[0]).toContain("/api/v1/tasks");
        expect(deleteCall[0]).toContain("taskId=task-1");
        confirmSpy.mockRestore();
    });

    it("shows the Bug 3 removed-by-others banner when the task vanishes mid-edit (Bug 3 still resolved)", async () => {
        // Render with initial task present, then edit it, then
        // simulate it vanishing. Mirrors TaskModal's Bug 3 fix.
        const queryClient = seedQueryClient([task()]);
        const router = createMemoryRouter(
            [
                {
                    path: "/projects/:projectId/board",
                    element: <Outlet />,
                    children: [
                        {
                            path: "task/:taskId",
                            element: (
                                <TaskDetailPanel
                                    projectId="project-1"
                                    taskId="task-1"
                                />
                            )
                        }
                    ]
                }
            ],
            {
                initialEntries: ["/projects/project-1/board/task/task-1"]
            }
        );
        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </Provider>
        );

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited locally" } });

        // Simulate a concurrent delete — the task disappears from
        // the cache but the user has dirty edits.
        act(() => {
            queryClient.setQueryData(["tasks", { projectId: "project-1" }], []);
        });

        // Banner appears with the removedByOthers copy. The panel
        // does NOT auto-close with edits in flight — Bug 3 is
        // preserved.
        expect(
            await screen.findByText(
                microcopy.taskModal.removedByOthersTitle as string
            )
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: microcopy.taskModal.discardEdits as string
            })
        ).toBeInTheDocument();
    });

    it("shows the dirty-state confirm dialog on mask click when the form is dirty", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });

        // Drawer mask is rendered as `.ant-drawer-mask`. Clicking
        // it fires the Drawer's onClose, which we route through
        // `requestClose`.
        const mask = document.querySelector(".ant-drawer-mask");
        expect(mask).not.toBeNull();
        fireEvent.click(mask as Element);

        // Confirm dialog appears with the Phase 3 A2 microcopy.
        expect(
            await screen.findByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            )
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                microcopy.taskDetailPanel.confirmDiscardBody as string
            )
        ).toBeInTheDocument();
    });

    it("links the confirm body to the dialog via aria-describedby (B-M4)", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });
        fireEvent.click(document.querySelector(".ant-drawer-mask") as Element);

        await screen.findByText(
            microcopy.taskDetailPanel.confirmDiscardTitle as string
        );

        // The body wrapper exposes the explicit id used by aria-describedby.
        const body = document.getElementById("task-detail-panel-discard-body");
        expect(body).not.toBeNull();
        // The aria-describedby attribute references the body id from
        // within the rendered modal so screen readers announce the
        // description after the title.
        const describer = document.querySelector(
            "[aria-describedby='task-detail-panel-discard-body']"
        );
        expect(describer).not.toBeNull();
    });

    it("dismisses the confirm dialog and keeps the panel open when 'Keep editing' is clicked", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });
        fireEvent.click(document.querySelector(".ant-drawer-mask") as Element);

        await screen.findByText(
            microcopy.taskDetailPanel.confirmDiscardTitle as string
        );
        const keepEditingButton = screen.getByRole("button", {
            name: microcopy.taskDetailPanel.confirmDiscardCancel as string
        });
        fireEvent.click(keepEditingButton);

        // Panel is still open — the task title is still visible
        // and the user's edit is still in the input.
        expect(screen.getByDisplayValue("Edited")).toBeInTheDocument();
        // Confirm dialog gets hidden. AntD's Modal animates the
        // close, so we look at the visible state rather than DOM
        // removal — the wrapper retains the title node but the
        // modal switches to `aria-hidden`.
        await waitFor(() => {
            const dialog = screen.queryByRole("dialog", {
                hidden: false,
                name: microcopy.taskDetailPanel.confirmDiscardTitle as string
            });
            expect(dialog).toBeNull();
        });
    });

    it("blocks programmatic navigation while dirty and shows the confirm dialog", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1"
        );

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });

        // Simulate a browser back / iOS swipe-back / Android system
        // back by programmatically navigating to a sibling task —
        // the parent board URL is an explicit close target and bypasses
        // the blocker. react-router 7's `useBlocker` intercepts the
        // call — the URL doesn't move immediately, and the confirm
        // dialog fires.
        act(() => {
            router.navigate("/projects/project-1/board/task/task-2");
        });

        expect(
            await screen.findByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            )
        ).toBeInTheDocument();
        // URL is still on the panel — the navigation is paused.
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("proceeds with navigation when the user clicks 'Discard' on the blocker confirm", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1"
        );

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });

        act(() => {
            router.navigate("/projects/project-1/board/task/task-2");
        });

        await screen.findByText(
            microcopy.taskDetailPanel.confirmDiscardTitle as string
        );
        const discardButton = screen.getByRole("button", {
            name: microcopy.taskDetailPanel.confirmDiscardOk as string
        });

        await act(async () => {
            await userEvent.click(discardButton);
        });

        // Navigation completed — we're on the sibling task URL.
        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-2"
            );
        });
    });

    it("keeps the panel open and surfaces the error when PUT fails (B-T1)", async () => {
        fetchMock.mockImplementation(async (input, init) => {
            const url = typeof input === "string" ? input : input.toString();
            const method = (init as RequestInit | undefined)?.method;
            if (method === "PUT") {
                return {
                    json: jest
                        .fn()
                        .mockResolvedValue({ error: "Save failed: boom" }),
                    ok: false,
                    status: 500
                } as unknown as Response;
            }
            const body = url.includes("/tasks")
                ? [task()]
                : url.includes("/users/members")
                  ? members
                  : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });

        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1"
        );
        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Build task v2" } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        // ErrorBox surfaces the rejection message; panel stays open.
        expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("keeps the panel open and surfaces the error when DELETE fails (B-T1)", async () => {
        const messageErrorSpy = jest
            .spyOn(
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require("antd").message,
                "error"
            )
            .mockImplementation(() => undefined);
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        fetchMock.mockImplementation(async (input, init) => {
            const url = typeof input === "string" ? input : input.toString();
            const method = (init as RequestInit | undefined)?.method;
            if (method === "DELETE") {
                return {
                    json: jest
                        .fn()
                        .mockResolvedValue({ error: "Delete forbidden" }),
                    ok: false,
                    status: 403
                } as unknown as Response;
            }
            const body = url.includes("/tasks")
                ? [task()]
                : url.includes("/users/members")
                  ? members
                  : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });

        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1"
        );
        await screen.findByText(/edit task · build task/i);
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        // The DELETE failure path fires `message.error` — assert the
        // spy was called and the panel stayed at the task route.
        await waitFor(() => {
            expect(messageErrorSpy).toHaveBeenCalled();
        });
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );

        confirmSpy.mockRestore();
        messageErrorSpy.mockRestore();
    });

    it("deep-links: rendering the panel route directly opens the panel on the board", async () => {
        // Equivalent to opening the URL in a fresh browser tab. The
        // initialEntries here is the panel route; the board layout
        // wraps the panel via the Outlet, so both render.
        renderPanelAt("/projects/project-1/board/task/task-1");

        expect(await screen.findByTestId("board-mock")).toBeInTheDocument();
        expect(
            await screen.findByText(/edit task · build task/i)
        ).toBeInTheDocument();
    });

    it("renders nothing-breaking when the resolved task is undefined and the form is pristine", async () => {
        // Mirror the modal's behavior — when the task is gone and
        // there are NO dirty edits, the panel auto-closes (navigates
        // to /board). This is the "concurrent delete on a clean
        // viewer" path; only the Bug 3 banner branch fires when
        // edits exist.
        const queryClient = seedQueryClient([]);
        const router = createMemoryRouter(
            [
                {
                    path: "/projects/:projectId/board",
                    element: (
                        <div>
                            <div data-testid="board-mock-2">Board</div>
                            <Outlet />
                        </div>
                    ),
                    children: [
                        {
                            path: "task/:taskId",
                            element: (
                                <TaskDetailPanel
                                    projectId="project-1"
                                    taskId="task-1"
                                />
                            )
                        }
                    ]
                }
            ],
            { initialEntries: ["/projects/project-1/board/task/task-1"] }
        );
        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </Provider>
        );

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board"
            );
        });
    });
});

describe("feature flag", () => {
    /*
     * When `environment.taskPanelRouted === false` the new route is
     * NOT registered (see `src/routes/index.test.tsx`), so
     * `useTaskModal` continues to drive every task open. This block
     * just guards the inverse: the component is reachable when the
     * caller imports + renders it directly, which is what the route
     * adapter does when the flag is on.
     */
    it("is importable as a standalone component (callers gate by flag)", () => {
        expect(typeof TaskDetailPanel).toBe("function");
    });
});

/*
 * Phase 3 A2 — desktop docked rail (>= lg). When `screens.lg` resolves
 * true AND the pointer is fine (not phone), the panel renders as a
 * docked `<aside>` rather than an AntD Drawer. The board's columns
 * reflow because the route shell wraps both surfaces in a flex row.
 */
describe("TaskDetailPanel — desktop docked rail (Phase 3 A2)", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/boards")
                ? []
                : url.includes("/tasks")
                  ? [task()]
                  : url.includes("/users/members")
                    ? members
                    : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
        installAntdBrowserMocks();
    });

    it("renders as a docked rail (NO AntD Drawer wrapper) at lg+ viewports", async () => {
        installDesktopLgMock();
        renderPanelAt("/projects/project-1/board/task/task-1");

        await screen.findByText(/edit task · build task/i);

        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        );
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute("data-placement")).toBe("rail");
        // CRITICAL: the rail mode must NOT mount an AntD Drawer
        // surface — the rail is part of the board layout, not an
        // overlay. The discard-confirm Modal still renders inside
        // (as it does in every chassis), but no `.ant-drawer` element
        // should exist when the rail is the active chassis.
        expect(document.querySelector(".ant-drawer")).toBeNull();
        // The surface itself is a <aside> element so AT users hear it
        // as a complementary landmark.
        expect(panel?.tagName.toLowerCase()).toBe("aside");
        installAntdBrowserMocks();
    });

    it("the rail aside has the expected 480px width contract", async () => {
        installDesktopLgMock();
        renderPanelAt("/projects/project-1/board/task/task-1");

        await screen.findByText(/edit task · build task/i);

        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        ) as HTMLElement | null;
        expect(panel).not.toBeNull();
        // The rail width is set inline via `flex: 0 0 480px`. We
        // assert the inline style carries the load-bearing value so a
        // future refactor that breaks the contract surfaces here.
        const style = panel?.getAttribute("style") ?? "";
        expect(style).toContain("480px");
        installAntdBrowserMocks();
    });

    it("renders the form body inside the rail (same fields as the Drawer)", async () => {
        installDesktopLgMock();
        renderPanelAt("/projects/project-1/board/task/task-1");

        // The body content is identical across chassis modes; the
        // form input for taskName must render even when the rail
        // wraps it instead of the Drawer.
        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        installAntdBrowserMocks();
    });

    it("keeps the dirty-state guard wired in rail mode", async () => {
        installDesktopLgMock();
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1"
        );

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });

        // Programmatic navigate to a sibling task — the blocker fires
        // because the form is dirty AND we're not navigating to the
        // parent board URL.
        act(() => {
            router.navigate("/projects/project-1/board/task/task-2");
        });

        expect(
            await screen.findByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            )
        ).toBeInTheDocument();
        installAntdBrowserMocks();
    });

    it("falls back to AntD Drawer on coarse-pointer phone even at >= lg width", async () => {
        // Touchscreen-laptop case: pointer:coarse=true AND screens.lg=true.
        // useIsPhoneChrome wins — the bottom-sheet Drawer is the right
        // call because the user is still tapping with a thumb.
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: (query: string) => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches:
                    query === "(pointer: coarse)" ||
                    query.includes("min-width: 576px") ||
                    query.includes("min-width: 768px") ||
                    query.includes("min-width: 992px") ||
                    query.includes("min-width: 1024px"),
                media: query,
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            })
        });
        renderPanelAt("/projects/project-1/board/task/task-1");
        await screen.findByText(/edit task · build task/i);

        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        );
        expect(panel).not.toBeNull();
        // Phone branch wins even though screens.lg is true.
        expect(panel?.getAttribute("data-placement")).toBe("bottom");
        installAntdBrowserMocks();
    });
});

/*
 * Phase 3 A2 — swipe-between-tasks. The TaskDetailPanel attaches
 * touch handlers to the body surface; a left-swipe routes through
 * `goToNext` (which uses the same `navigate(...)` as every other
 * close path), and a right-swipe routes through `goToPrev`. The
 * dirty-state guard intercepts via `useBlocker`. Tests dispatch
 * native touch events at the panel surface so the handlers fire as
 * they would on a real device.
 */
describe("TaskDetailPanel — swipe-between-tasks (Phase 3 A2)", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    const columns = [
        {
            _id: "column-1",
            columnName: "Todo",
            index: 0,
            projectId: "project-1"
        },
        {
            _id: "column-2",
            columnName: "Done",
            index: 1,
            projectId: "project-1"
        }
    ] satisfies IColumn[];

    const buildSiblingTasks = (): ITask[] => [
        task({ _id: "task-1", index: 0, columnId: "column-1" }),
        task({ _id: "task-2", index: 1, columnId: "column-1" }),
        task({ _id: "task-3", index: 0, columnId: "column-2" })
    ];

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/boards")
                ? columns
                : url.includes("/tasks")
                  ? buildSiblingTasks()
                  : url.includes("/users/members")
                    ? members
                    : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    /*
     * Helper: dispatch a synthetic left/right swipe on the panel
     * surface. `touches` on touchstart and `changedTouches` on
     * touchend must carry the SAME identifier so the panel matches
     * them up correctly.
     */
    const swipe = (
        element: HTMLElement,
        direction: "left" | "right",
        distance = 80
    ) => {
        const startX = direction === "left" ? 200 : 100;
        const endX =
            direction === "left" ? startX - distance : startX + distance;
        fireEvent.touchStart(element, {
            touches: [{ clientX: startX, clientY: 100, identifier: 0 }]
        });
        fireEvent.touchEnd(element, {
            changedTouches: [{ clientX: endX, clientY: 100, identifier: 0 }]
        });
    };

    it("left-swipe advances to the next sibling task URL", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns
            }
        );

        await screen.findByDisplayValue("Build task");

        // The Drawer surface portals its body to document.body, so
        // the swipe target is a dedicated test-id inside the body.
        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        act(() => {
            swipe(swipeTarget, "left", 80);
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-2"
            );
        });
    });

    it("right-swipe goes to the previous sibling task URL", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-2",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns,
                taskId: "task-2"
            }
        );

        // Wait for the panel to mount; the form values for task-2
        // start blank because the seeded "Build task" name belongs to
        // task-1 — we only need the panel surface to mount.
        await screen.findByText(/edit task/i);

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        act(() => {
            swipe(swipeTarget, "right", 80);
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-1"
            );
        });
    });

    it("does NOT navigate when the swipe is below the threshold", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns
            }
        );

        await screen.findByDisplayValue("Build task");

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        // 30px is below the 50px threshold; no navigation should
        // happen. Wait a tick before asserting so any race resolves.
        act(() => {
            swipe(swipeTarget, "left", 30);
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("does NOT navigate when the gesture is vertical-dominant (scroll)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns
            }
        );

        await screen.findByDisplayValue("Build task");

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        // 80px horizontal + 200px vertical → the gesture is
        // scroll-dominant and the swipe handler bails.
        act(() => {
            fireEvent.touchStart(swipeTarget, {
                touches: [{ clientX: 200, clientY: 100, identifier: 0 }]
            });
            fireEvent.touchEnd(swipeTarget, {
                changedTouches: [{ clientX: 120, clientY: 300, identifier: 0 }]
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("intercepts swipe-between-tasks when the form is dirty (Phase 3 A2 dirty-guard)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-1",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns
            }
        );

        const input = await screen.findByDisplayValue("Build task");
        fireEvent.change(input, { target: { value: "Edited" } });

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        act(() => {
            swipe(swipeTarget, "left", 80);
        });

        // Confirm dialog fires; URL stays on task-1.
        expect(
            await screen.findByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            )
        ).toBeInTheDocument();
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("left-swipe on the last task is a no-op (no sibling to advance to)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-3",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns,
                taskId: "task-3"
            }
        );

        await screen.findByText(/edit task/i);

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        act(() => {
            swipe(swipeTarget, "left", 80);
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        // No next sibling exists for task-3 — URL is unchanged.
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-3"
        );
    });
});
