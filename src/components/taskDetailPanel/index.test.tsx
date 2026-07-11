import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";

import TaskDetailPanel from ".";

/*
 * The transient Undo toast and the delete-failure error toast both route
 * through the out-of-Batch-B, AntD-backed `useUndoToast` / `useAppMessage`
 * hooks. Mock them so this suite stays free of AntD's global message
 * container while still asserting the panel raises the toast with the right
 * copy and that the undo closures replay the inverse PUT / POST.
 */
interface UndoOptions {
    description: string;
    undo: () => void | Promise<void>;
    analyticsTag?: string;
    dismissOnUnmount?: boolean;
}
let mockLastUndoOptions: UndoOptions | null = null;
const mockShowUndoToast = jest.fn((options: UndoOptions) => {
    mockLastUndoOptions = options;
    return { dismiss: jest.fn() };
});
const mockMessageError = jest.fn();
jest.mock("../../utils/hooks/useUndoToast", () => ({
    __esModule: true,
    default: () => ({ show: mockShowUndoToast })
}));
jest.mock("../../utils/hooks/useAppMessage", () => ({
    __esModule: true,
    default: () => ({
        error: mockMessageError,
        success: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
        loading: jest.fn(),
        open: jest.fn(),
        destroy: jest.fn()
    })
}));

/*
 * Radix `Popover` (SelectField / MultiSelectField) and `DropdownMenu`
 * (the comments mention picker) drive their surfaces with pointer-capture
 * and `scrollIntoView`, neither of which jsdom implements.
 */
Element.prototype.scrollIntoView = jest.fn();
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = jest.fn(() => false);
}
if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = jest.fn();
}
if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = jest.fn();
}

beforeEach(() => {
    mockShowUndoToast.mockClear();
    mockMessageError.mockClear();
    mockLastUndoOptions = null;
});

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

        // jsdom default mocks `pointer: coarse` to false, so
        // `useIsPhoneChrome()` returns false and the right-overlay
        // branch wins — the shared `<Sheet>` primitive renders its
        // shadcn `<Sheet>` fallback at `side="right"`. The placement
        // now lives in the content's Tailwind side classes
        // (`right-0` for the right shelf, `bottom-0` for the phone
        // bottom sheet) rather than the legacy `.ant-drawer-*` chrome.
        const panel = screen.getByTestId("task-detail-panel");
        expect(panel).toBeInTheDocument();
        expect(panel.className).toContain("right-0");
        expect(panel.className).not.toContain("bottom-0");
    });

    it("mounts as an animated Sheet surface on coarse-pointer phone viewports", async () => {
        installCoarsePointerMock();
        renderPanelAt("/projects/project-1/board/task/task-1");
        await screen.findByText(/edit task · build task/i);

        // Phase 6 Wave 3 Phase 2 — the phone branch now renders the
        // Sheet primitive's animated multi-detent surface (not an AntD
        // Drawer). Assert the Sheet's portal'd testids instead of the
        // legacy `.ant-drawer-bottom` placement class.
        expect(screen.getByTestId("task-detail-panel")).toBeInTheDocument();
        const surface = screen.getByTestId("task-detail-panel-surface");
        expect(surface).toBeInTheDocument();
        // Consumer configures `defaultDetent="large"`.
        expect(surface).toHaveAttribute("data-detent", "large");
        expect(
            screen.getByTestId("task-detail-panel-grabber")
        ).toBeInTheDocument();
        // The Drawer-fallback wrapper should NOT be present on phone.
        expect(document.querySelector(".ant-drawer-bottom")).toBeNull();
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

    it("surfaces an Undo toast after a save and re-PUTs the before-state on click", async () => {
        // §2.A.4 — a task update is reversible, so a successful save shows
        // a transient Undo toast. The panel navigates to the board on save,
        // so the toast must outlive the unmounting panel (dismissOnUnmount:
        // false); clicking Undo replays the inverse PUT with the pre-edit
        // name.
        renderPanelAt("/projects/project-1/board/task/task-1");
        const input = await screen.findByDisplayValue("Build task");

        fireEvent.change(input, { target: { value: "Build task details" } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        // The reversible save raises the Undo toast with the "task saved"
        // copy; invoking the captured undo closure replays the inverse PUT
        // with the pre-edit name.
        await waitFor(() => expect(mockShowUndoToast).toHaveBeenCalled());
        expect(mockLastUndoOptions?.description).toBe(
            microcopy.feedback.taskSaved
        );
        await act(async () => {
            await mockLastUndoOptions?.undo();
        });

        await waitFor(() => {
            const putCalls = fetchMock.mock.calls.filter(
                (call) => (call[1] as RequestInit | undefined)?.method === "PUT"
            );
            expect(putCalls.length).toBeGreaterThanOrEqual(2);
            const lastPut = putCalls.at(-1)!;
            expect(JSON.parse(lastPut[1]?.body as string)).toEqual(
                expect.objectContaining({
                    _id: "task-1",
                    taskName: "Build task"
                })
            );
        });
    });

    it("normalizes an out-of-vocabulary task type to 'Task' in the select and the title tag", async () => {
        const legacyTask = task({ epic: "Auth", type: "feature" });
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/tasks")
                ? [legacyTask]
                : url.includes("/users/members")
                  ? members
                  : { _id: "task-1" };
            return {
                json: jest.fn().mockResolvedValue(body),
                ok: true,
                status: 200
            } as unknown as Response;
        });
        renderPanelAt("/projects/project-1/board/task/task-1", {
            initialTasks: [legacyTask]
        });

        expect(
            await screen.findByText(/edit task · build task/i)
        ).toBeInTheDocument();
        // The raw wire value must not leak into any control — the card
        // coerces it to "Task", so the panel has to agree.
        expect(screen.queryByText("feature")).not.toBeInTheDocument();
        // Both the title tag and the type select read the canonical label.
        expect(
            screen.getAllByText(microcopy.options.taskTypes.task as string)
                .length
        ).toBeGreaterThanOrEqual(2);
    });

    it("saves an untouched legacy-type task without firing a needless PUT", async () => {
        const legacyTask = task({ epic: "Auth", type: "feature" });
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/tasks")
                ? [legacyTask]
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
            "/projects/project-1/board/task/task-1",
            { initialTasks: [legacyTask] }
        );

        expect(
            await screen.findByDisplayValue("Build task")
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        // The dirty-check compares against the same normalized baseline
        // the form binds, so the untouched panel closes with no PUT.
        await waitFor(() =>
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board"
            )
        );
        const putCalls = fetchMock.mock.calls.filter(
            (call) => (call[1] as RequestInit | undefined)?.method === "PUT"
        );
        expect(putCalls).toHaveLength(0);
    });

    it("deletes the task immediately (no confirm) and surfaces an Undo toast", async () => {
        // §2.A.4 — task delete is reversible, so it skips a confirm dialog
        // and goes straight to an optimistic DELETE + Undo toast.
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
        // No discard-confirm dialog fired for the reversible delete.
        expect(
            screen.queryByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            )
        ).not.toBeInTheDocument();
        const deleteCall = fetchMock.mock.calls.find(
            (call) => (call[1] as RequestInit | undefined)?.method === "DELETE"
        )!;
        // DELETE requests pass data as a querystring rather than a
        // body — see `src/utils/hooks/useApi.ts`. Assert the URL
        // carries the right task id.
        expect(deleteCall[0]).toContain("/api/v1/tasks");
        expect(deleteCall[0]).toContain("taskId=task-1");
        // The reversible delete raises the Undo toast with the "task
        // deleted" copy and a working undo closure.
        expect(mockShowUndoToast).toHaveBeenCalled();
        expect(mockLastUndoOptions?.description).toBe(
            microcopy.feedback.taskDeleted
        );
    });

    it("re-creates the task via a POST when the Undo toast is clicked", async () => {
        renderPanelAt("/projects/project-1/board/task/task-1");
        await screen.findByText(/edit task · build task/i);
        fireEvent.click(
            screen.getByRole("button", { name: /^delete build task$/i })
        );

        await waitFor(() => expect(mockShowUndoToast).toHaveBeenCalled());
        await act(async () => {
            await mockLastUndoOptions?.undo();
        });

        // Undo replays the inverse mutation: a POST re-creating the task.
        await waitFor(() => {
            const postCalls = fetchMock.mock.calls.filter(
                (call) =>
                    (call[1] as RequestInit | undefined)?.method === "POST"
            );
            expect(postCalls.length).toBeGreaterThanOrEqual(1);
        });
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

        // Pressing Escape routes the Sheet's `onClose` through
        // `requestClose`; with dirty edits that surfaces the discard
        // confirm dialog (the migrated equivalent of the old drawer
        // mask-click path).
        fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

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
        fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

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
        fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

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
        // Confirm dialog is dismissed — the shadcn `Dialog` unmounts
        // its content on close, so the titled dialog is gone.
        await waitFor(() => {
            const dialog = screen.queryByRole("dialog", {
                hidden: false,
                name: microcopy.taskDetailPanel.confirmDiscardTitle as string
            });
            expect(dialog).toBeNull();
        });
    });

    it("surfaces the discard confirm Modal above the Sheet on phone scrim click", async () => {
        // Phase 6 Wave 3 Phase 2 — the phone branch routes dirty-close
        // through Sheet's scrim. Verify the discard Modal still
        // renders (and renders above the Sheet) when the user taps
        // the scrim with unsaved edits. AntD Modal sits at
        // `zIndex.modal` (1050) > Sheet at `zIndex.drawer` (1000-1001),
        // so the Modal naturally stacks above the Sheet without any
        // explicit z-index work on the consumer side.
        installCoarsePointerMock();
        try {
            renderPanelAt("/projects/project-1/board/task/task-1");

            const input = await screen.findByDisplayValue("Build task");
            fireEvent.change(input, { target: { value: "Edited" } });

            // Click the Sheet's portal'd scrim — the consumer routes
            // `Sheet.onClose` to `requestClose`, which then opens the
            // discard Modal because the form is dirty.
            const scrim = await screen.findByTestId("task-detail-panel-scrim");
            fireEvent.click(scrim);

            // Confirm Modal title appears above the Sheet surface.
            const dialog = await screen.findByText(
                microcopy.taskDetailPanel.confirmDiscardTitle as string
            );
            expect(dialog).toBeInTheDocument();
            // Sheet's animated surface is still mounted (no auto-close
            // race) — the discard guard intercepts cleanly.
            expect(
                screen.getByTestId("task-detail-panel-surface")
            ).toBeInTheDocument();
        } finally {
            installAntdBrowserMocks();
        }
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

    it("surfaces the error (and still closes the panel) when DELETE fails (B-T1)", async () => {
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

        // The optimistic delete closes the panel to the board route
        // immediately; the failure surfaces a task-specific error toast
        // (the optimistic-update layer rolls the task back into the cache).
        await waitFor(() => {
            expect(mockMessageError).toHaveBeenCalled();
        });
        await waitFor(() =>
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board"
            )
        );
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

    it("moves focus into the aside on mount in rail mode (R-B H1)", async () => {
        installDesktopLgMock();
        renderPanelAt("/projects/project-1/board/task/task-1");

        await screen.findByText(/edit task · build task/i);

        // The rail mount effect moves focus to the aside landmark so
        // screen readers announce the panel; assert by walking up from
        // document.activeElement to the rail surface.
        const panel = document.querySelector(
            "[data-testid='task-detail-panel']"
        );
        expect(panel).not.toBeNull();
        await waitFor(() => {
            expect(document.activeElement).toBe(panel);
        });
        installAntdBrowserMocks();
    });

    it("falls back to the animated Sheet on coarse-pointer phone even at >= lg width", async () => {
        // Touchscreen-laptop case: pointer:coarse=true AND screens.lg=true.
        // useIsPhoneChrome wins — the animated bottom Sheet is the right
        // call because the user is still tapping with a thumb. Phase 6
        // Wave 3 Phase 2 routes the phone chassis through the shared
        // `<Sheet>` primitive instead of the legacy AntD Drawer with
        // `placement="bottom"`.
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

        // Phone branch wins even though screens.lg is true — the Sheet's
        // animated surface mounts and no AntD `.ant-drawer` chrome
        // appears for the panel chassis.
        expect(
            screen.getByTestId("task-detail-panel-surface")
        ).toBeInTheDocument();
        expect(document.querySelector(".ant-drawer-bottom")).toBeNull();
        installAntdBrowserMocks();
    });
});

/*
 * Phase 3 A2 / R-B L — swipe-between-tasks. The TaskDetailPanel
 * attaches PointerEvent handlers to the body surface; a left-swipe
 * routes through `goToNext` (which uses the same `navigate(...)` as
 * every other close path), and a right-swipe routes through
 * `goToPrev`. The dirty-state guard intercepts via `useBlocker`.
 * Tests dispatch native pointer events at the panel surface so the
 * handlers fire as they would on a real device.
 *
 * jsdom does NOT ship `PointerEvent` (jest-environment-jsdom ≤30
 * inherits the omission from upstream jsdom). `fireEvent.pointerDown`
 * falls back to a base `Event` in that case, which drops `clientX` /
 * `pointerType` / `pointerId` on the floor. The polyfill below
 * subclasses `MouseEvent` and copies the pointer-specific props so
 * `fireEvent.pointerDown` and friends construct events the panel
 * handlers can read. The polyfill is scoped to this suite to avoid
 * leaking into tests that rely on the absence of `PointerEvent`
 * (none today, but future-proof).
 *
 * jsdom also lacks `setPointerCapture` / `releasePointerCapture` on
 * `Element`; we stub them as no-ops on `HTMLElement.prototype` for
 * the same scope so the panel's feature-detected calls succeed.
 */
describe("TaskDetailPanel — swipe-between-tasks (Phase 3 A2 / R-B L)", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    type PointerEventInitLite = MouseEventInit & {
        pointerId?: number;
        pointerType?: string;
        isPrimary?: boolean;
    };

    class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;

        readonly pointerType: string;

        readonly isPrimary: boolean;

        constructor(type: string, params: PointerEventInitLite = {}) {
            super(type, params);
            this.pointerId = params.pointerId ?? 0;
            this.pointerType = params.pointerType ?? "";
            this.isPrimary = params.isPrimary ?? true;
        }
    }

    type CaptureProto = HTMLElement & {
        setPointerCapture?: (pointerId: number) => void;
        releasePointerCapture?: (pointerId: number) => void;
        hasPointerCapture?: (pointerId: number) => boolean;
    };

    const originalPointerEvent = (
        globalThis as { PointerEvent?: typeof PointerEvent }
    ).PointerEvent;
    const proto = HTMLElement.prototype as unknown as CaptureProto;
    const originalSetPointerCapture = proto.setPointerCapture;
    const originalReleasePointerCapture = proto.releasePointerCapture;
    const originalHasPointerCapture = proto.hasPointerCapture;
    const originalInnerWidth = Object.getOwnPropertyDescriptor(
        window,
        "innerWidth"
    );

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
        // PointerEvent + capture polyfill — see suite header.
        (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
            TestPointerEvent as unknown as typeof PointerEvent;
        proto.setPointerCapture = function setPointerCapture() {
            /* no-op for jsdom */
        };
        proto.releasePointerCapture = function releasePointerCapture() {
            /* no-op for jsdom */
        };
        proto.hasPointerCapture = function hasPointerCapture() {
            return false;
        };
        // jsdom defaults `innerWidth` to 1024; pin it so the edge
        // guard tests don't drift if the upstream default changes.
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1024,
            writable: true
        });
    });

    afterAll(() => {
        if (originalPointerEvent === undefined) {
            delete (globalThis as { PointerEvent?: typeof PointerEvent })
                .PointerEvent;
        } else {
            (
                globalThis as { PointerEvent?: typeof PointerEvent }
            ).PointerEvent = originalPointerEvent;
        }
        proto.setPointerCapture = originalSetPointerCapture;
        proto.releasePointerCapture = originalReleasePointerCapture;
        proto.hasPointerCapture = originalHasPointerCapture;
        if (originalInnerWidth) {
            Object.defineProperty(window, "innerWidth", originalInnerWidth);
        }
        fetchMock.mockRestore();
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

    /*
     * Helper: dispatch a synthetic left/right swipe on the panel
     * surface via PointerEvents. pointerdown sets the origin,
     * pointerup carries the final delta. `pointerType` defaults to
     * "touch" so the desktop-mouse filter doesn't reject the gesture;
     * caller can override (e.g. `pointerType: "mouse"`) to assert
     * the mouse-reject path.
     */
    const swipe = (
        element: HTMLElement,
        direction: "left" | "right",
        distance = 80,
        overrides: { pointerType?: string; startY?: number; endY?: number } = {}
    ) => {
        const startX = direction === "left" ? 200 : 100;
        const endX =
            direction === "left" ? startX - distance : startX + distance;
        const pointerType = overrides.pointerType ?? "touch";
        const startY = overrides.startY ?? 100;
        const endY = overrides.endY ?? startY;
        fireEvent.pointerDown(element, {
            button: 0,
            clientX: startX,
            clientY: startY,
            pointerId: 1,
            pointerType
        });
        fireEvent.pointerUp(element, {
            button: 0,
            clientX: endX,
            clientY: endY,
            pointerId: 1,
            pointerType
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
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 200,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 120,
                clientY: 300,
                pointerId: 1,
                pointerType: "touch"
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

    /*
     * R-B L: pointerdown that lands within the 20 px edge band on the
     * LEFT side of the viewport is skipped entirely. On iOS Safari
     * that band is reserved for the native swipe-back gesture; without
     * the guard, every iOS back-swipe would also fire our right-swipe
     * → previous-task and the user would navigate twice.
     */
    it("ignores pointerdown within the 20 px left-edge guard band (R-B L)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-2",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns,
                taskId: "task-2"
            }
        );

        await screen.findByText(/edit task/i);

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        // Origin at clientX = 5 px (inside the 20 px guard band).
        // Even with a clearly-horizontal 100 px delta the handler
        // bails before recording the origin, so pointerup is a no-op.
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 5,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 105,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        // Right-swipe from inside the left guard would normally route
        // to task-1; the guard suppresses it.
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-2"
        );
    });

    /*
     * R-B L mirror: pointerdown within the 20 px band on the RIGHT
     * side of the viewport (iOS forward-swipe territory) is also
     * skipped. Window is pinned to innerWidth = 1024 in `beforeAll`,
     * and the source uses strict `clientX > viewportWidth - GUARD`, so
     * the right guard activates at clientX > 1004 (i.e. 1005 and
     * above is guarded; 1004 is the last safe-side coordinate).
     */
    it("ignores pointerdown within the 20 px right-edge guard band (R-B L)", async () => {
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
        // Origin at clientX = 1020 px (inside the 20 px right guard
        // — innerWidth is 1024). A 100 px leftward drag would
        // normally fire goToNext → task-2; the guard suppresses it.
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 1020,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 920,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    /*
     * R-B L boundary tests: the edge-guard check uses STRICT inequality
     * (`event.clientX < SWIPE_EDGE_GUARD_PX` and
     * `event.clientX > viewportWidth - SWIPE_EDGE_GUARD_PX`). The four
     * tests below pin the exact boundaries so a sloppy refactor that
     * flips `<` to `<=` or `>` to `>=` would change the outcome at the
     * edge coordinate and fail. Without the boundary cases, the broad
     * 5px / 1020px tests would still pass against either operator and
     * the regression would slip through.
     */
    it("guards a pointerdown at clientX=19 (last guarded pixel on the left edge, R-B L)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-2",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns,
                taskId: "task-2"
            }
        );

        await screen.findByText(/edit task/i);

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        // 19 < 20 → strict `<` guards the gesture. A 100 px right-swipe
        // from inside the band would otherwise navigate to task-1.
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 19,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 119,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-2"
        );
    });

    it("allows a pointerdown at clientX=20 (first safe pixel past the left edge, R-B L)", async () => {
        const { router } = renderPanelAt(
            "/projects/project-1/board/task/task-2",
            {
                initialTasks: buildSiblingTasks(),
                initialColumns: columns,
                taskId: "task-2"
            }
        );

        await screen.findByText(/edit task/i);

        const swipeTarget = await screen.findByTestId(
            "task-detail-panel-swipe-target"
        );
        // 20 is NOT strict-less-than 20 → the guard does NOT fire, and
        // the 100 px right-swipe routes to the previous task (task-1).
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 20,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 120,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-1"
            );
        });
    });

    it("guards a pointerdown at clientX=1005 (first guarded pixel on the right edge, R-B L)", async () => {
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
        // 1005 > 1004 (innerWidth 1024 - guard 20) → strict `>` guards
        // the gesture. A 100 px left-swipe from inside the band would
        // otherwise navigate to task-2.
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 1005,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 905,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    it("allows a pointerdown at clientX=1004 (last safe pixel before the right edge, R-B L)", async () => {
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
        // 1004 is NOT strict-greater-than 1004 → the guard does NOT
        // fire, and the 100 px left-swipe routes to the next task
        // (task-2).
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 1004,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 904,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-2"
            );
        });
    });

    /*
     * pointercancel fires when the OS or browser reclaims the
     * gesture (multi-finger zoom promotion, system back-swipe
     * committing, scroll inertia kicking in). The handler must drop
     * the origin so the next pointerup — which may arrive moments
     * later as the OS finishes cleanup — does NOT navigate.
     */
    it("does NOT navigate when the gesture is cancelled mid-swipe (R-B L)", async () => {
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
        act(() => {
            fireEvent.pointerDown(swipeTarget, {
                button: 0,
                clientX: 200,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            fireEvent.pointerCancel(swipeTarget, {
                button: 0,
                clientX: 120,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
            // Stale pointerup after cancel must be a no-op.
            fireEvent.pointerUp(swipeTarget, {
                button: 0,
                clientX: 120,
                clientY: 100,
                pointerId: 1,
                pointerType: "touch"
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    /*
     * Desktop mice share the pointer surface but should NOT trigger
     * the swipe gesture — text selection inside the form, scrollbar
     * drags, and link-clicks all fire pointerdown/up with horizontal
     * deltas exceeding the threshold, and reading them as swipes
     * would break the desktop UX entirely.
     */
    it("does NOT navigate when pointerType is 'mouse' (R-B L)", async () => {
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
        act(() => {
            // Same 80 px leftward drag that the touch path uses to
            // advance — but with pointerType "mouse" it must NOT
            // navigate.
            swipe(swipeTarget, "left", 80, { pointerType: "mouse" });
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(router.state.location.pathname).toBe(
            "/projects/project-1/board/task/task-1"
        );
    });

    /*
     * Pen pointer-type still triggers — the swipe is touch + pen
     * inclusive. Guards against accidentally over-narrowing the
     * pointerType filter to "touch" only.
     */
    it("allows pointerType 'pen' to trigger the swipe (R-B L)", async () => {
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
        act(() => {
            swipe(swipeTarget, "left", 80, { pointerType: "pen" });
        });

        await waitFor(() => {
            expect(router.state.location.pathname).toBe(
                "/projects/project-1/board/task/task-2"
            );
        });
    });
});

/*
 * PRD-GAP-009 / PRD-GAP-010 — richness fields + comments thread parity
 * with `TaskModal`. The routed `TaskDetailPanel` is the surface
 * `REACT_APP_TASK_PANEL_ROUTED=true` activates; these tests render it
 * directly (the route adapter does the same when the flag is on) and
 * prove no richness field is lost vs the legacy modal, that a cleared
 * scalar FK reaches the wire as `null` (the GAP-005 `preserveNullKeys`
 * pattern), and that the comments thread mounts.
 */
describe("TaskDetailPanel — richness fields + comments (GAP-009/010)", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    const labelFixtures: ILabel[] = [
        {
            _id: "label-1",
            projectId: "project-1",
            name: "Backend",
            color: "blue"
        },
        {
            _id: "label-2",
            projectId: "project-1",
            name: "Frontend",
            color: "geekblue"
        }
    ];
    const projectMemberFixtures: IProjectMember[] = [
        {
            _id: "member-1",
            email: "alice@example.com",
            username: "Alice",
            role: "owner"
        },
        {
            _id: "member-2",
            email: "bob@example.com",
            username: "Bob",
            role: "coordinator"
        }
    ];
    const siblingTasks: ITask[] = [
        task({ _id: "task-1", taskName: "Build task" }),
        task({ _id: "task-2", taskName: "Fix bug" })
    ];

    interface RichnessRenderOptions {
        initialTasks?: ITask[];
        comments?: IComment[];
    }

    // Mutable backing list for the `GET /tasks` mock so a per-test task
    // shape (e.g. a seeded `parentTaskId` / dates) survives react-query's
    // background refetch instead of being clobbered by the default fixture.
    let currentTasks: ITask[] = siblingTasks;

    const renderRichnessPanel = (options: RichnessRenderOptions = {}) => {
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        const initialTasks = options.initialTasks ?? siblingTasks;
        currentTasks = initialTasks;
        queryClient.setQueryData(["users/members"], members);
        queryClient.setQueryData(
            ["tasks", { projectId: "project-1" }],
            initialTasks
        );
        queryClient.setQueryData(
            ["labels", { projectId: "project-1" }],
            labelFixtures
        );
        queryClient.setQueryData(
            ["projects/members", { projectId: "project-1" }],
            projectMemberFixtures
        );
        queryClient.setQueryData(
            ["comments", { taskId: "task-1" }],
            options.comments ?? []
        );
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
                                    boardAiOn={false}
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
        return {
            queryClient,
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

    const lastPutBody = () => {
        const putCall = fetchMock.mock.calls.find(
            ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
        );
        return JSON.parse(
            (putCall?.[1] as RequestInit)?.body as string
        ) as Record<string, unknown>;
    };

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        currentTasks = siblingTasks;
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (input) => {
            const url = typeof input === "string" ? input : input.toString();
            const body = url.includes("/labels")
                ? labelFixtures
                : url.includes("/projects/members")
                  ? projectMemberFixtures
                  : url.includes("/comments")
                    ? []
                    : url.includes("/notifications")
                      ? []
                      : url.includes("/tasks")
                        ? currentTasks
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

    it("renders the new richness field controls (start/due date, labels, assignees, parent task)", async () => {
        renderRichnessPanel();
        await screen.findByDisplayValue("Build task");

        expect(screen.getByText("Start date")).toBeInTheDocument();
        expect(screen.getByText("Due date")).toBeInTheDocument();
        expect(screen.getByText("Labels")).toBeInTheDocument();
        expect(screen.getByText("Assignees")).toBeInTheDocument();
        expect(screen.getByText("Parent task")).toBeInTheDocument();
    });

    it("excludes the editing task itself from the parent-task options", async () => {
        renderRichnessPanel();
        await screen.findByDisplayValue("Build task");

        const parentSelect = screen.getByRole("combobox", {
            name: /parent task/i
        });
        fireEvent.click(parentSelect);
        await screen.findByRole("option", { name: "Fix bug" });
        const optionLabels = screen
            .getAllByRole("option")
            .map((el) => el.textContent);
        expect(optionLabels).toContain("Fix bug");
        expect(optionLabels).not.toContain("Build task");
    });

    it("includes labels, assignees, and parent in the PUT payload on save (parity with TaskModal)", async () => {
        renderRichnessPanel();
        await screen.findByDisplayValue("Build task");

        fireEvent.click(screen.getByRole("combobox", { name: /labels/i }));
        fireEvent.click(await screen.findByRole("option", { name: "Backend" }));

        fireEvent.click(screen.getByRole("combobox", { name: /assignees/i }));
        fireEvent.click(await screen.findByRole("option", { name: "Bob" }));

        fireEvent.click(screen.getByRole("combobox", { name: /parent task/i }));
        fireEvent.click(await screen.findByRole("option", { name: "Fix bug" }));

        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([, init]) =>
                        (init as RequestInit | undefined)?.method === "PUT"
                )
            ).toBe(true)
        );
        expect(lastPutBody()).toEqual(
            expect.objectContaining({
                _id: "task-1",
                labelIds: ["label-1"],
                assigneeIds: ["member-2"],
                parentTaskId: "task-2"
            })
        );
    });

    it("serializes a chosen due date as a YYYY-MM-DD string in the PUT payload", async () => {
        renderRichnessPanel();
        await screen.findByDisplayValue("Build task");

        const dueInput = screen.getByPlaceholderText(
            "Select a due date"
        ) as HTMLInputElement;
        fireEvent.mouseDown(dueInput);
        fireEvent.change(dueInput, { target: { value: "2026-12-25" } });
        fireEvent.keyDown(dueInput, { key: "Enter", code: "Enter" });

        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([, init]) =>
                        (init as RequestInit | undefined)?.method === "PUT"
                )
            ).toBe(true)
        );
        expect(lastPutBody().dueDate).toBe("2026-12-25");
    });

    it("seeds the date pickers from the task's stored ISO date strings", async () => {
        renderRichnessPanel({
            initialTasks: [
                task({
                    _id: "task-1",
                    taskName: "Build task",
                    startDate: "2026-03-01",
                    dueDate: "2026-03-15"
                })
            ]
        });
        await screen.findByDisplayValue("Build task");

        expect(screen.getByDisplayValue("2026-03-01")).toBeInTheDocument();
        expect(screen.getByDisplayValue("2026-03-15")).toBeInTheDocument();
    });

    it("clearing a set parent task sends parentTaskId: null so the backend unassigns it (GAP-005)", async () => {
        renderRichnessPanel({
            initialTasks: [
                task({
                    _id: "task-1",
                    taskName: "Build task",
                    parentTaskId: "task-2"
                }),
                task({ _id: "task-2", taskName: "Fix bug" })
            ]
        });
        await screen.findByDisplayValue("Build task");

        // The parent `SelectField` renders its clear affordance (a
        // "Clear" button) only when a value is set; it's the only
        // clearable control in the form, so it's unambiguous here.
        const clearButton = screen.getByRole("button", {
            name: microcopy.actions.clear as string
        });
        fireEvent.click(clearButton);

        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([, init]) =>
                        (init as RequestInit | undefined)?.method === "PUT"
                )
            ).toBe(true)
        );
        const body = lastPutBody();
        expect(body._id).toBe("task-1");
        // The cleared parent reaches the wire as an explicit `null` (not
        // dropped), so the backend unassigns it.
        expect(body.parentTaskId).toBeNull();
    });

    it("mounts the comments thread for a real task (GAP-010)", async () => {
        renderRichnessPanel({
            comments: [
                {
                    _id: "comment-1",
                    taskId: "task-1",
                    projectId: "project-1",
                    authorId: "member-1",
                    body: "First comment",
                    createdAt: "2026-05-01T10:00:00.000Z"
                } as IComment
            ]
        });
        await screen.findByDisplayValue("Build task");

        // The thread renders its composer and the seeded comment.
        expect(
            await screen.findByTestId("comment-composer-input")
        ).toBeInTheDocument();
        expect(screen.getByText("First comment")).toBeInTheDocument();
    });

    it("invalidates the notifications query when a mention-bearing comment is posted (GAP-010)", async () => {
        const { queryClient } = renderRichnessPanel();
        await screen.findByDisplayValue("Build task");

        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

        // Compose a comment and add a mention via the member multi-select.
        // Mention Bob (Alice is the seeded coordinator and shows as a
        // selected-value duplicate, so its text isn't uniquely queryable).
        const composer = await screen.findByTestId("comment-composer-input");
        fireEvent.change(composer, { target: { value: "Ping @Bob" } });

        // The mention picker is now a `DropdownMenu` of checkbox items;
        // open it and check Bob (Alice is the seeded coordinator).
        const menuUser = userEvent.setup({ pointerEventsCheck: 0 });
        await menuUser.click(screen.getByTestId("comment-mention-select"));
        await menuUser.click(
            await screen.findByRole("menuitemcheckbox", { name: "Bob" })
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId("comment-post"));
        });

        await waitFor(() => {
            const postedComment = fetchMock.mock.calls.some(
                ([url, init]) =>
                    (init as RequestInit | undefined)?.method === "POST" &&
                    String(url).includes("/comments")
            );
            expect(postedComment).toBe(true);
        });
        // The mention triggers a cross-resource refresh of the bell badge.
        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith(
                expect.objectContaining({ queryKey: ["notifications"] })
            );
        });
        invalidateSpy.mockRestore();
    });
});
